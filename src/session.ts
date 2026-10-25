/**
 * The connection session: the part of "connect" that lives between the
 * saved Config and a live `RommClient`.
 *
 * Two jobs, both kept here so `App.tsx` stays pure orchestration (state,
 * routing, the walks):
 *
 * - Token acquisition. The sign-in methods of the settings screen differ
 *   in how the bearer token is obtained: a plain API token needs nothing,
 *   the password grant exchanges username+password (or refreshes a stored
 *   refresh token, falling back to the password grant when the refresh
 *   token is rotated or revoked), and the pairing code is exchanged once
 *   for a client API token.
 * - 401 recovery. `RommClient` calls `onRefresh` before reporting a 401.
 *   The password method refreshes the access token — deduped, because the
 *   library walk fires pages in parallel and several can 401 at once
 *   (RomM rotates refresh tokens: a second, parallel exchange would race
 *   the first and invalidate it). The pairing method re-exchanges the
 *   code (a stored pairing token can expire).
 */
import { DEFAULT_AUTH_METHOD, type Config } from './config';
import { exchangePasswordToken, exchangePairingCode, refreshAccessToken } from './auth';
import { RommClient } from './romm';
import { log } from './log';

/**
 * The live ends of a connection attempt: everything the session does
 * reports through it, and every await it makes checks it first, so a
 * superseded attempt (the user re-saved settings, or demo mode) does no
 * further work and writes no state.
 */
export interface SessionContext {
	/** Aborts the in-flight exchanges. */
	signal: AbortSignal;
	/** True once this connection attempt has been superseded by a newer one. */
	isStale: () => boolean;
	/** Persist and publish a config change (fresh token, rotated refresh, exchanged code). */
	applyConfig: (patch: Partial<Config>) => void;
	/** Update the on-screen status line. */
	setStatus: (message: string) => void;
}

/**
 * The token step of a connect: `ok` with the config updated in place
 * (through `SessionContext.applyConfig`), or a human-readable error the
 * caller turns into its status line.
 */
export type TokenOutcome =
	| { ok: true }
	| { ok: false; error: string };

/**
 * Obtain a fresh bearer token for the chosen sign-in method.
 *
 * The `token` method has nothing to exchange: the stored API token is the
 * session as-is.
 */
export async function ensureToken(config: Config, ctx: SessionContext): Promise<TokenOutcome> {
	const method = config.authMethod ?? DEFAULT_AUTH_METHOD;

	if (method === 'password') {
		const username = (config.username ?? '').trim();
		const password = config.password ?? '';
		if (username === '' || password === '') {
			return { ok: false, error: 'username and password are required' };
		}
		const refresh = (config.refreshToken ?? '').trim();
		const fresh = config.token.trim() !== '' && (config.tokenExpiresAt ?? 0) > Date.now() + 60_000;
		if (!fresh) {
			ctx.setStatus(refresh !== '' ? 'Refreshing session…' : 'Signing in…');
			let res =
				refresh !== ''
					? await refreshAccessToken(config.baseUrl, refresh, ctx.signal)
					: await exchangePasswordToken(config.baseUrl, username, password, ctx.signal);
			if (ctx.isStale()) return { ok: true };
			if (!res.ok && refresh !== '') {
				// A rotated or revoked refresh token: fall back to the
				// full password grant once.
				ctx.setStatus('Signing in…');
				log('token', 'refresh token dead — retrying with the password grant');
				res = await exchangePasswordToken(config.baseUrl, username, password, ctx.signal);
				if (ctx.isStale()) return { ok: true };
			}
			if (!res.ok) {
				log('error', `password grant: ${res.error}`);
				return { ok: false, error: res.error };
			}
			log('token', 'password grant ok');
			ctx.applyConfig({
				token: res.value.accessToken,
				refreshToken: res.value.refreshToken,
				tokenExpiresAt: Date.now() + res.value.expiresIn * 1000,
			});
		}
	} else if (method === 'pairing') {
		const code = (config.pairingCode ?? '').trim();
		if (code === '') {
			return { ok: false, error: 'a pairing code is required' };
		}
		// A pairing token from a previous exchange is reused; the code
		// itself is single-use, so only exchange when we hold none yet.
		if (config.token.trim() === '' || (config.pairingToken ?? '').trim() === '') {
			ctx.setStatus('Exchanging pairing code…');
			const res = await exchangePairingCode(config.baseUrl, code, ctx.signal);
			if (ctx.isStale()) return { ok: true };
			if (!res.ok) {
				log('error', `pairing exchange: ${res.error}`);
				return { ok: false, error: res.error };
			}
			if (res.value.rawToken === '') {
				log('error', 'pairing exchange: server returned an empty token');
				return { ok: false, error: 'server returned no token for the code' };
			}
			log('token', 'pairing exchange ok');
			ctx.applyConfig({ token: res.value.rawToken, pairingToken: res.value.rawToken });
		}
	}

	return { ok: true };
}

/**
 * Build the client and its 401 recovery (see the module comment for which
 * method refreshes what).
 *
 * `getConfig` is a getter, not a snapshot: the refresh flow applies rotated
 * credentials through `SessionContext.applyConfig`, and a *later* refresh
 * must see them (RomM rotates refresh tokens — a second refresh with the
 * old one would fail and end the session mid-library).
 */
export function buildClient(getConfig: () => Config, ctx: SessionContext): RommClient {
	const method = getConfig().authMethod ?? DEFAULT_AUTH_METHOD;

	// Several requests can 401 together when the access token expires
	// mid-walk; only one refresh may run at a time.
	let refreshInFlight: Promise<string | null> | null = null;

	const onRefresh = async (): Promise<string | null> => {
		if (method === 'password') {
			const cur = getConfig();
			const refresh = (cur.refreshToken ?? '').trim();
			if (refresh === '') return null;
			if (refreshInFlight !== null) return refreshInFlight;
			refreshInFlight = (async () => {
				const res = await refreshAccessToken(cur.baseUrl, refresh, ctx.signal);
				if (!res.ok) {
					log('error', `refresh: ${res.error}`);
					return null;
				}
				log('token', 'refreshed access token');
				ctx.applyConfig({
					token: res.value.accessToken,
					refreshToken: res.value.refreshToken,
					tokenExpiresAt: Date.now() + res.value.expiresIn * 1000,
				});
				return res.value.accessToken;
			})();
			try {
				return await refreshInFlight;
			} finally {
				refreshInFlight = null;
			}
		}
		if (method === 'pairing') {
			const cur = getConfig();
			const code = (cur.pairingCode ?? '').trim();
			if (code === '') return null;
			const res = await exchangePairingCode(cur.baseUrl, code, ctx.signal);
			if (!res.ok) {
				log('error', `pairing re-exchange: ${res.error}`);
				return null;
			}
			if (res.value.rawToken === '') {
				log('error', 'pairing re-exchange: server returned an empty token');
				return null;
			}
			log('token', 're-exchanged pairing code after 401');
			ctx.applyConfig({ token: res.value.rawToken, pairingToken: res.value.rawToken });
			return res.value.rawToken;
		}
		return null;
	};

	return new RommClient(getConfig().baseUrl, getConfig().token, onRefresh);
}
