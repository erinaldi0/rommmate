/**
 * Config-store test (node, no device): stubs the `Switch` namespace with
 * an in-memory SD and `localStorage` with a map, then exercises the
 * SD-first / localStorage-fallback / migration behaviour.
 */
import { loadConfig, saveConfig, hasConfig, type Config } from '../src/config';

interface FakeStorage {
	map: Map<string, string>;
	getItem(k: string): string | null;
	setItem(k: string, v: string): void;
}

const g = globalThis as {
	Switch?: Record<string, unknown>;
	localStorage?: FakeStorage;
};

/** In-memory SD card: `path → bytes`, plus the operations fs.ts uses. */
const sd = {
	store: new Map<string, Uint8Array>(),
	readFileSync(path: string): ArrayBuffer | null {
		const b = sd.store.get(path);
		return b === undefined ? null : b.slice().buffer;
	},
	writeFileSync(path: string, data: string | Uint8Array): void {
		const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
		sd.store.set(path, new Uint8Array(bytes));
	},
};
const CONFIG_PATH = 'sdmc:/switch/rommmate/config.json';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || detail === '' ? '' : ` — ${detail}`}`);
	if (!ok) failures += 1;
}

function sample(): Config {
	return {
		baseUrl: 'http://10.147.18.46:8200',
		token: 'rmm_abc123',
		authMethod: 'password',
		username: 'eman',
		password: 'hunter2',
		refreshToken: 'rt_x',
		tokenExpiresAt: 1760000000000,
		pairingCode: '',
		pairingToken: '',
		keyboard: 'system',
		autoSync: false,
		coreChoices: { n64: 'mupen64plus' },
	};
}

// ── 1. SD round-trip ────────────────────────────────────────────────────────
g.Switch = sd;
g.localStorage = undefined; // no Save Data: the SD copy must carry it alone
saveConfig(sample());
check('sd: file written', sd.store.has(CONFIG_PATH));
const back = loadConfig();
check('sd: round-trip identical', JSON.stringify(back) === JSON.stringify(sample()), JSON.stringify(back));
check('sd: hasConfig', hasConfig(back));

// ── 2. Sanitization ─────────────────────────────────────────────────────────
saveConfig({ ...sample(), baseUrl: 'http://x\uFFFD\u0007y', token: 't\u001Fz' });
const clean = loadConfig();
check('sanitize: baseUrl', clean.baseUrl === 'http://xy', clean.baseUrl);
check('sanitize: token', clean.token === 'tz', clean.token);

// ── 3. Corrupt SD file falls back to localStorage ──────────────────────────
sd.store.set(CONFIG_PATH, new TextEncoder().encode('{not json'));
const ls = { map: new Map<string, string>() };
g.localStorage = {
	getItem: (k) => ls.map.get(k) ?? null,
	setItem: (k, v) => void ls.map.set(k, v),
};
saveConfig(sample()); // localStorage gets the copy; the SD stays corrupt
const fromLs = loadConfig();
check('fallback: localStorage serves', fromLs.baseUrl === sample().baseUrl && fromLs.token === sample().token);
check('fallback: sd promoted again', JSON.parse(new TextDecoder().decode(sd.store.get(CONFIG_PATH)!)) !== undefined
	? new TextDecoder().decode(sd.store.get(CONFIG_PATH)!).includes('"rmm_abc123"')
	: false);

// ── 4. Migration: no SD file + a localStorage config ───────────────────────
sd.store.delete(CONFIG_PATH);
ls.map.clear();
ls.map.set('rommate.baseUrl', 'http://old:8200');
ls.map.set('rommate.token', 'rmm_old');
const migrated = loadConfig();
check('migration: loaded from localStorage', migrated.baseUrl === 'http://old:8200' && migrated.token === 'rmm_old');
check('migration: sd file now exists', sd.store.has(CONFIG_PATH));
const afterMigrate = loadConfig();
check('migration: next boot reads the SD', afterMigrate.baseUrl === 'http://old:8200');

// ── 5. Empty everywhere ─────────────────────────────────────────────────────
sd.store.delete(CONFIG_PATH);
ls.map.clear();
const empty = loadConfig();
check('empty: no crash, no config', empty.baseUrl === '' && !hasConfig(empty));

console.log(failures === 0 ? '\nall config-store checks passed' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
