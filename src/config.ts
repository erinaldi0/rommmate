/**
 * App configuration, persisted via the runtime's `localStorage`
 * (backed by the Switch Save Data filesystem — no SD file juggling).
 */

const KEY_BASE_URL = 'rommate.baseUrl';
const KEY_TOKEN = 'rommate.token';

export interface Config {
	/** RomM instance base URL, e.g. "http://192.168.1.50:11700". */
	baseUrl: string;
	/** RomM Client API Token ("rmm_..."). */
	token: string;
}

export function loadConfig(): Config {
	try {
		const ls = localStorage;
		return {
			baseUrl: ls?.getItem(KEY_BASE_URL) ?? '',
			token: ls?.getItem(KEY_TOKEN) ?? '',
		};
	} catch {
		return { baseUrl: '', token: '' };
	}
}

export function saveConfig(cfg: Config): void {
	try {
		localStorage?.setItem(KEY_BASE_URL, cfg.baseUrl);
		localStorage?.setItem(KEY_TOKEN, cfg.token);
	} catch (err) {
		console.log(`rommate: failed to persist config: ${String(err)}`);
	}
}

export function hasConfig(cfg: Config): boolean {
	return cfg.baseUrl.trim() !== '' && cfg.token.trim() !== '';
}
