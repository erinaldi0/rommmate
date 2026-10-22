/**
 * App configuration, persisted via the runtime's `localStorage`
 * (backed by the Switch Save Data filesystem — no SD file juggling).
 */

const KEY_BASE_URL = 'rommate.baseUrl';
const KEY_TOKEN = 'rommate.token';
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

export interface Config {
	/** RomM instance base URL, e.g. "http://192.168.1.50:11700". */
	baseUrl: string;
	/** RomM Client API Token ("rmm_..."). */
	token: string;
	/** Which keyboard opens for the text fields (default: built-in). */
	keyboard?: KeyboardMode;
}

export function loadConfig(): Config {
	try {
		const ls = localStorage;
		const keyboard = ls?.getItem(KEY_KEYBOARD);
		return {
			baseUrl: ls?.getItem(KEY_BASE_URL) ?? '',
			token: ls?.getItem(KEY_TOKEN) ?? '',
			keyboard: KEYBOARD_MODES.includes(keyboard as KeyboardMode)
				? (keyboard as KeyboardMode)
				: DEFAULT_KEYBOARD,
		};
	} catch {
		return { baseUrl: '', token: '', keyboard: DEFAULT_KEYBOARD };
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
		localStorage?.setItem(KEY_KEYBOARD, cfg.keyboard ?? DEFAULT_KEYBOARD);
	} catch {
		// Save Data is unavailable (or full) — the session still works, the
		// credentials just are not remembered across launches.
	}
}

export function hasConfig(cfg: Config): boolean {
	return cfg.baseUrl.trim() !== '' && cfg.token.trim() !== '';
}
