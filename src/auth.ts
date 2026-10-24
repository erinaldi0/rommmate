/**
 * RomM authentication flows beyond the raw Client API Token:
 *
 * - Password: OAuth2 password grant → `POST /api/token` → short-lived
 *   access token + refresh token.
 * - Pairing code: exchange a short code (e.g. "M2DX-ZWQF") →
 *   `POST /api/client-tokens/exchange` → a client API token.
 *
 * Each returns the bearer token to use for API calls, plus anything needed
 * to keep the session alive (refresh token, expiry).
 */

import { normalizeBaseUrl } from './romm';

export interface PasswordResult {
	accessToken: string;
	refreshToken: string;
	expiresIn: number; // seconds until the access token expires
}

export interface PairingResult {
	rawToken: string;
	name: string;
	scopes: string[];
	expiresAt: string | null;
}

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };
type Result<T> = Ok<T> | Err;

/** Scopes the app needs to browse the library and fetch cover art. */
const BROWSING_SCOPES = [
	'roms.read',
	'roms.write',
	'me.read',
	'platforms.read',
	'collections.read',
	'firmware.read',
	'assets.read',
	'assets.write',
	'devices.read',
	'devices.write',
].join(' ');

/**
 * Parse the token lifetime. `Number(null)` is 0 and `Number('x')` is NaN —
 * `?? 1800` would catch neither, so an absent/garbage `expires` field must
 * be defaulted explicitly (RomM's usual lifetime is 30 minutes).
 */
function expiresSeconds(v: unknown): number {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : 1800;
}

/**
 * Exchange a username + password for an access token (OAuth2 password
 * grant). RomM mints HS256-signed JWTs; the access token is short-lived,
 * so the caller should refresh via `refreshAccessToken` before it expires.
 */
export async function exchangePasswordToken(
	baseUrl: string,
	username: string,
	password: string,
	signal?: AbortSignal,
): Promise<Result<PasswordResult>> {
	try {
		const res = await fetch(`${normalizeBaseUrl(baseUrl)}/api/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body:
				`grant_type=password&` +
				`username=${encodeURIComponent(username)}&` +
				`password=${encodeURIComponent(password)}&` +
				`scope=${encodeURIComponent(BROWSING_SCOPES)}`,
			signal,
		});
		if (!res.ok) {
			if (res.status === 401) return { ok: false, error: 'invalid username or password' };
			return { ok: false, error: `token request failed (HTTP ${res.status})` };
		}
		const json = await res.json();
		return {
			ok: true,
			value: {
				accessToken: String(json.access_token ?? ''),
				refreshToken: String(json.refresh_token ?? ''),
				expiresIn: expiresSeconds(json.expires),
			},
		};
	} catch (err) {
		return { ok: false, error: `cannot reach RomM (${String(err)})` };
	}
}

/**
 * Refresh an expired access token using its refresh token. RomM rotates
 * refresh tokens, so the returned `refreshToken` replaces the previous one.
 */
export async function refreshAccessToken(
	baseUrl: string,
	refreshToken: string,
	signal?: AbortSignal,
): Promise<Result<PasswordResult>> {
	try {
		const res = await fetch(`${normalizeBaseUrl(baseUrl)}/api/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
			signal,
		});
		if (!res.ok) {
			return { ok: false, error: `token refresh failed (HTTP ${res.status})` };
		}
		const json = await res.json();
		return {
			ok: true,
			value: {
				accessToken: String(json.access_token ?? ''),
				refreshToken: String(json.refresh_token ?? refreshToken),
				expiresIn: expiresSeconds(json.expires),
			},
		};
	} catch (err) {
		return { ok: false, error: `cannot reach RomM (${String(err)})` };
	}
}

/**
 * Exchange a short pairing code (generated in the RomM web interface under
 * Client API Tokens) for a client API token. Single-use: once exchanged,
 * the code is invalid for anyone else.
 */
export async function exchangePairingCode(
	baseUrl: string,
	code: string,
	signal?: AbortSignal,
): Promise<Result<PairingResult>> {
	try {
		const res = await fetch(`${normalizeBaseUrl(baseUrl)}/api/client-tokens/exchange`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ code }),
			signal,
		});
		if (!res.ok) {
			if (res.status === 401 || res.status === 404) {
				return { ok: false, error: 'invalid or expired pairing code' };
			}
			return { ok: false, error: `code exchange failed (HTTP ${res.status})` };
		}
		const json = await res.json();
		return {
			ok: true,
			value: {
				rawToken: String(json.raw_token ?? ''),
				name: String(json.name ?? ''),
				scopes: Array.isArray(json.scopes) ? (json.scopes as string[]) : [],
				expiresAt: json.expires_at ?? null,
			},
		};
	} catch (err) {
		return { ok: false, error: `cannot reach RomM (${String(err)})` };
	}
}
