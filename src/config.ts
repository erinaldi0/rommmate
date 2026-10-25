/**
 * App configuration.
 *
 * The primary store is a small JSON file on the SD card
 * (`sdmc:/switch/rommmate/config.json`). The runtime's `localStorage`
 * is Save-Data backed, which needs a selected user profile and a
 * save-data mount to exist — launched from the homebrew menu it can
 * silently no-op, losing every setting between launches. The SD file
 * has neither dependency, and its synchronous calls
 * (`readFileSync`/`writeFileSync`) keep `loadConfig`/`saveConfig`
 * signature-compatible with the boot flow that uses them.
 *
 * `localStorage` stays as a second copy: the preview's only store, and
 * the migration source for a device that did manage to save there.
 * Either store alone is enough to boot from.
 */
import { readTextSync, writeTextSync } from './fs';
import { log } from './log';
import { PATHS } from './retroarch/layout';

const CONFIG_PATH = `${PATHS.appDir}/config.json`;

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
const KEY_AUTO_SYNC = 'rommate.autoSync';
const KEY_CORE_CHOICES = 'rommate.coreChoices';

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
	/**
	 * Run the save sync automatically at boot (default: true). A pending
	 * play session is always ingested; this gates only the sync that
	 * follows it.
	 */
	autoSync?: boolean;
	/**
	 * Per-platform core picks: the platform slug → the core id from the
	 * core map (see `retroarch/cores.ts`). Absent = the map's first
	 * (recommended) choice.
	 */
	coreChoices?: Record<string, string>;
}

/** Validate an untrusted value as the per-platform core picks. */
function coreChoicesFrom(raw: unknown): Record<string, string> | undefined {
	if (typeof raw === 'string') {
		try {
			raw = JSON.parse(raw) as unknown;
		} catch {
			return undefined; // a corrupt pick degrades to the default
		}
	}
	if (typeof raw !== 'object' || raw === null) return undefined;
	return Object.fromEntries(
		Object.entries(raw as Record<string, unknown>)
			.filter(([, v]) => typeof v === 'string')
			.map(([k, v]) => [k, v as string]),
	);
}

/** Parse a stored SD-file JSON into a Config; null when unusable. */
function configFromJson(raw: string): Config | null {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return null;
		const o = parsed as Record<string, unknown>;
		if (typeof o.baseUrl !== 'string') return null;
		const str = (v: unknown): string => (typeof v === 'string' ? v : '');
		return {
			baseUrl: o.baseUrl,
			token: str(o.token),
			authMethod: AUTH_METHODS.includes(o.authMethod as AuthMethod)
				? (o.authMethod as AuthMethod)
				: DEFAULT_AUTH_METHOD,
			username: str(o.username),
			password: str(o.password),
			refreshToken: str(o.refreshToken),
			tokenExpiresAt:
				typeof o.tokenExpiresAt === 'number' && Number.isFinite(o.tokenExpiresAt)
					? o.tokenExpiresAt
					: 0,
			pairingCode: str(o.pairingCode),
			pairingToken: str(o.pairingToken),
			keyboard: KEYBOARD_MODES.includes(o.keyboard as KeyboardMode)
				? (o.keyboard as KeyboardMode)
				: DEFAULT_KEYBOARD,
			// The default is on: the stored value only matters when off.
			autoSync: o.autoSync !== false,
			coreChoices: coreChoicesFrom(o.coreChoices),
		};
	} catch {
		return null;
	}
}

export function loadConfig(): Config {
	// The SD copy is the primary store — read synchronously so the boot
	// flow (a `useState` initializer) keeps its shape.
	const sdRaw = readTextSync(CONFIG_PATH);
	if (sdRaw !== null) {
		const sd = configFromJson(sdRaw);
		if (sd !== null) return sd;
		log('config', 'sd config unreadable — trying localStorage');
	}
	try {
		const ls = localStorage;
		const keyboard = ls?.getItem(KEY_KEYBOARD);
		const authMethod = ls?.getItem(KEY_AUTH_METHOD);
		const autoSync = ls?.getItem(KEY_AUTO_SYNC);
		const cfg: Config = {
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
			// The default is on: the stored value only matters when off.
			autoSync: autoSync !== 'false',
			coreChoices: coreChoicesFrom(ls?.getItem(KEY_CORE_CHOICES) ?? ''),
		};
		// First boot on a device that only ever had the Save-Data copy:
		// promote it to the SD so the profile-less launches keep it too.
		if (cfg.baseUrl !== '' && writeTextSync(CONFIG_PATH, JSON.stringify(cfg))) {
			log('config', 'migrated the localStorage copy to the SD card');
		}
		return cfg;
	} catch {
		return {
			baseUrl: '',
			token: '',
			authMethod: DEFAULT_AUTH_METHOD,
			keyboard: DEFAULT_KEYBOARD,
			autoSync: true,
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
	// Sanitized once: both stores receive the same cleaned values.
	const clean = {
		baseUrl: sanitize(cfg.baseUrl),
		token: sanitize(cfg.token),
		authMethod: cfg.authMethod ?? DEFAULT_AUTH_METHOD,
		username: sanitize(cfg.username ?? ''),
		password: sanitize(cfg.password ?? ''),
		refreshToken: sanitize(cfg.refreshToken ?? ''),
		tokenExpiresAt: cfg.tokenExpiresAt ?? 0,
		pairingCode: sanitize(cfg.pairingCode ?? ''),
		pairingToken: sanitize(cfg.pairingToken ?? ''),
		keyboard: cfg.keyboard ?? DEFAULT_KEYBOARD,
		autoSync: cfg.autoSync !== false,
		coreChoices: cfg.coreChoices,
	};
	// Primary: the SD file (no profile or save-data dependency). A
	// power-cut mid-write costs the file — the localStorage copy below
	// is the independent second store to boot from.
	if (!writeTextSync(CONFIG_PATH, JSON.stringify(clean))) {
		log('config', 'sd write failed — localStorage only');
	}
	// Secondary: Save Data (the preview's store; a redundant copy on
	// device — either store surviving is enough for the next launch).
	try {
		localStorage?.setItem(KEY_BASE_URL, clean.baseUrl);
		localStorage?.setItem(KEY_TOKEN, clean.token);
		localStorage?.setItem(KEY_AUTH_METHOD, clean.authMethod);
		localStorage?.setItem(KEY_USERNAME, clean.username);
		localStorage?.setItem(KEY_PASSWORD, clean.password);
		localStorage?.setItem(KEY_REFRESH_TOKEN, clean.refreshToken);
		localStorage?.setItem(KEY_TOKEN_EXPIRES_AT, String(clean.tokenExpiresAt));
		localStorage?.setItem(KEY_PAIRING_CODE, clean.pairingCode);
		localStorage?.setItem(KEY_PAIRING_TOKEN, clean.pairingToken);
		localStorage?.setItem(KEY_KEYBOARD, clean.keyboard);
		localStorage?.setItem(KEY_AUTO_SYNC, clean.autoSync ? 'true' : 'false');
		try {
			localStorage?.setItem(
				KEY_CORE_CHOICES,
				clean.coreChoices !== undefined ? JSON.stringify(clean.coreChoices) : '',
			);
		} catch {
			// The pick is the least-critical field: losing it costs one
			// re-pick at most, not the session.
		}
	} catch {
		// Save Data is unavailable (or full) — the SD copy above is what
		// the next launch reads.
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
