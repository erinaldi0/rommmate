/**
 * App configuration, persisted via the runtime's `localStorage`
 * (backed by the Switch Save Data filesystem — no SD file juggling).
 */

const KEY_BASE_URL = 'rommate.baseUrl';
const KEY_TOKEN = 'rommate.token';
const KEY_AUTH_METHOD = 'rommate.authMethod';
const KEY_USERNAME = 'rommate.username';
const KEY_PASSWORD = 'rommate.password';
const KEY_REFRESH_TOKEN = 'rommate.refreshToken';
const KEY_TOKEN_EXPIRES_AT = 'rommate.tokenExpiresAt';
const KEY_PAIRING_CODE = 'rommate.pairingCode';
const KEY_PAIRING_TOKEN = 'rommate.pairingToken';
const KEY_KEYBOARD = 'rommate.keyboard';

/**
 * Which keyboard opens for the text fields.
 *
 * `builtin` is the default: the built-in canvas keyboard always renders.
 * The system inline keyboard is headless on emulators — it reports itself
 * up, captures every key, and never shows, which makes the field look
 * dead while silently filling with garbage. `system` and `auto` are for
 * real hardware, where the OS keyboard is nicer.
 */
export type KeyboardMode = 'auto' | 'system' | 'builtin';

export const KEYBOARD_MODES: KeyboardMode[] = ['auto', 'system', 'builtin'];

export const DEFAULT_KEYBOARD: KeyboardMode = 'builtin';

/**
 * How the bearer token used for API calls is obtained.
 *
 * `token`   — a RomM Client API Token (`rmm_...`), typed in directly (the
 *             original flow).
 * `password` — the user's RomM username + password, exchanged via the
 *             OAuth2 password grant (`POST /api/token`) for a short-lived
 *             access token and a refresh token.
 * `pairing`  — a short pairing code (e.g. "M2DX-ZWQF") generated in the
 *             RomM web interface (Client API Tokens), exchanged via
 *             `POST /api/client-tokens/exchange` for a client API token.
 */
export type AuthMethod = 'token' | 'password' | 'pairing';

export const AUTH_METHODS: AuthMethod[] = ['token', 'password', 'pairing'];

export const DEFAULT_AUTH_METHOD: AuthMethod = 'token';

export interface Config {
	/** RomM instance base URL, e.g. "http://192.168.1.50:8200". */
	baseUrl: string;
	/** Bearer token currently in use for API calls (rmm_... or OAuth2 access token). */
	token: string;
	/** How to obtain/refresh the bearer token (default: token). */
	authMethod?: AuthMethod;
	/** Password method: RomM username. */
	username?: string;
	/** Password method: RomM password. */
	password?: string;
	/** Password method: OAuth2 refresh token (to renew the access token). */
	refreshToken?: string;
	/** Password method: access-token expiry (epoch ms). */
	tokenExpiresAt?: number;
	/** Pairing method: short code entered by the user (e.g. "M2DX-ZWQF"). */
	pairingCode?: string;
	/** Pairing method: resolved raw token from the code exchange. */
	pairingToken?: string;
	/** Which keyboard opens for the text fields (default: built-in). */
	keyboard?: KeyboardMode;
}

export function loadConfig(): Config {
	try {
		const ls = localStorage;
		const keyboard = ls?.getItem(KEY_KEYBOARD);
		const authMethod = ls?.getItem(KEY_AUTH_METHOD);
		return {
			baseUrl: ls?.getItem(KEY_BASE_URL) ?? '',
			token: ls?.getItem(KEY_TOKEN) ?? '',
			authMethod: AUTH_METHODS.includes(authMethod as AuthMethod)
				? (authMethod as AuthMethod)
				: DEFAULT_AUTH_METHOD,
			username: ls?.getItem(KEY_USERNAME) ?? '',
			password: ls?.getItem(KEY_PASSWORD) ?? '',
			refreshToken: ls?.getItem(KEY_REFRESH_TOKEN) ?? '',
			// `Number('')` is 0 but `Number('x')` is NaN — clamp either.
			tokenExpiresAt: Number(ls?.getItem(KEY_TOKEN_EXPIRES_AT) ?? 0) || 0,
			pairingCode: ls?.getItem(KEY_PAIRING_CODE) ?? '',
			pairingToken: ls?.getItem(KEY_PAIRING_TOKEN) ?? '',
			keyboard: KEYBOARD_MODES.includes(keyboard as KeyboardMode)
				? (keyboard as KeyboardMode)
				: DEFAULT_KEYBOARD,
		};
	} catch {
		return {
			baseUrl: '',
			token: '',
			authMethod: DEFAULT_AUTH_METHOD,
			keyboard: DEFAULT_KEYBOARD,
		};
	}
}

/**
 * Strip what the Switch keyboard can emit but a URL/token cannot contain:
 * the replacement character (unmappable keys show up as a box) and control
 * characters.
 */
function sanitize(value: string): string {
	return value.replace(/[\uFFFD\u0000-\u001F\u007F]/g, '');
}

export function saveConfig(cfg: Config): void {
	try {
		localStorage?.setItem(KEY_BASE_URL, sanitize(cfg.baseUrl));
		localStorage?.setItem(KEY_TOKEN, sanitize(cfg.token));
		localStorage?.setItem(KEY_AUTH_METHOD, cfg.authMethod ?? DEFAULT_AUTH_METHOD);
		localStorage?.setItem(KEY_USERNAME, sanitize(cfg.username ?? ''));
		localStorage?.setItem(KEY_PASSWORD, sanitize(cfg.password ?? ''));
		localStorage?.setItem(KEY_REFRESH_TOKEN, sanitize(cfg.refreshToken ?? ''));
		localStorage?.setItem(
			KEY_TOKEN_EXPIRES_AT,
			String(cfg.tokenExpiresAt ?? 0),
		);
		localStorage?.setItem(KEY_PAIRING_CODE, sanitize(cfg.pairingCode ?? ''));
		localStorage?.setItem(KEY_PAIRING_TOKEN, sanitize(cfg.pairingToken ?? ''));
		localStorage?.setItem(KEY_KEYBOARD, cfg.keyboard ?? DEFAULT_KEYBOARD);
	} catch {
		// Save Data is unavailable (or full) — the session still works, the
		// credentials just are not remembered across launches.
	}
}

export function hasConfig(cfg: Config): boolean {
	if (cfg.baseUrl.trim() === '') return false;
	if (cfg.token.trim() !== '') return true;
	const method = cfg.authMethod ?? DEFAULT_AUTH_METHOD;
	// Password method: we have the credentials to obtain a token.
	if (
		method === 'password' &&
		(cfg.username ?? '').trim() !== '' &&
		(cfg.password ?? '').trim() !== ''
	) {
		return true;
	}
	// Pairing method: we have a code to exchange.
	if (method === 'pairing' && (cfg.pairingCode ?? '').trim() !== '') {
		return true;
	}
	return false;
}

/** Label shown in the settings row for the credential field, per auth method. */
export function credentialLabel(method: AuthMethod): string {
	switch (method) {
		case 'password':
			return 'Username';
		case 'pairing':
			return 'Pairing Code';
		default:
			return 'API Token';
	}
}
