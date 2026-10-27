/**
 * RetroArch provisioning: the loader, its config, and per-platform cores.
 *
 * Everything the emulator needs is *content on the server*, under a
 * platform the user creates once in the RomM web UI ("RetroArch"): the
 * loader (the official release's `switch/retroarch_switch.nro`, as a bare
 * NRO or a zip of the `switch/` folder) and the core NROs the library's
 * platforms need. Provisioning walks that platform, matches files against
 * the core map, downloads what is missing or stale, and lays the tree
 * out (see `layout.ts`).
 *
 * Staleness is the server's own fingerprint (size + hash + last-modified)
 * recorded in the manifest at install time: a file that changed on the
 * server re-downloads on the next check, so a user who uploads a newer
 * RetroArch build simply gets it — no version constants in the app.
 */
import { unzipSync } from 'fflate';
import type { Config } from '../config';
import type { RommClient, RommGame, RommPlatform } from '../romm';
import { getFirmware } from '../romm/play';
import { PATHS, platformSlug } from './layout';
import { coreEntryFor, type CoreChoice } from './cores';
import { sevenZipExtract } from './zip7';
import { downloadQueue } from '../roms/download';
import { saveManifest, type Manifest, type ManifestFile } from '../manifest';
import { exists, move, readBinary, readText, remove, sdFreeSpace, writeBinary, writeText } from '../fs';
import { log } from '../log';

/**
 * The tooling platform's name, as created in the RomM web UI. It is not a
 * game platform — it holds the emulator itself — so the library hides it.
 */
export const TOOLING_PLATFORM = 'RetroArch';

/**
 * The stable release as libretro's buildbot serves it: one 7z containing
 * the Switch loader NRO, the launcher icon and the whole core set. This
 * is the web source for the loader when the server's uploads lack one —
 * unpacked by `zip7.ts` (7z-wasm), taking only the two files we need.
 */
const RETROARCH_7Z_URL = 'https://buildbot.libretro.com/stable/1.22.2/nintendo/switch/libnx/RetroArch.7z';

/** Matched recursively (see zip7) against the release archive's inner paths. */
const LOADER_7Z_PATTERNS = ['retroarch_switch.nro', 'retroarch.jpg'];

/** One file from the tooling platform, as the server reports it. */
export interface ToolingFile {
	romId: number;
	/** The file name (what the user uploaded). */
	fileName: string;
	size: number;
	/** The server's MD5, when it computed one. */
	md5: string;
	/** The server's last-modified (ISO, '' when unknown). */
	modified: string;
}

export interface ProvisionResult {
	ok: boolean;
	/** Human explanation when not ok ('' otherwise). */
	error: string;
	/** What the server has — for the provisioning outcome. */
	onServer: boolean;
	/** What is installed locally. */
	installed: boolean;
}

/** The server's fingerprint of a tooling file, for staleness. */
function fingerprint(file: ToolingFile): { hash: string; size: number; modified: string } {
	return { hash: file.md5, size: file.size, modified: file.modified };
}

/** True when a manifest record still matches the server's current file. */
function manifestIsCurrent(record: ManifestFile | null | undefined, file: ToolingFile): boolean {
	if (record === null || record === undefined) return false;
	if (file.md5 !== '' && record.serverHash !== file.md5) return false;
	if (file.size > 0 && record.serverSize !== file.size) return false;
	return true;
}

/**
 * The tooling platform, by name (a case-insensitive match on the display
 * name — the user types it, we find it).
 */
export async function findToolingPlatform(
	client: RommClient,
	signal?: AbortSignal,
): Promise<RommPlatform | null> {
	const { platforms, error } = await client.getPlatforms(signal);
	if (error !== null) return null;
	return platforms.find((p) => p.name.trim().toLowerCase() === TOOLING_PLATFORM.toLowerCase()) ?? null;
}

/**
 * Every file the user has uploaded to the tooling platform: the roms list
 * filtered to that platform (each uploaded file becomes one rom entry).
 */
export async function listToolingFiles(
	client: RommClient,
	platformId: number,
	signal?: AbortSignal,
): Promise<ToolingFile[]> {
	const { games, error } = await client.getGames(
		() => {},
		undefined,
		signal,
		{ platformId },
	);
	if (error !== null) return [];
	return games
		.filter((g: RommGame) => g.fsName !== '')
		.map((g: RommGame) => ({
			romId: g.id,
			fileName: g.fsName,
			size: g.sizeBytes,
			md5: g.md5Hash,
			modified: g.createdAt,
		}));
}

/** The loader among the tooling files (a zip of `switch/`, or a bare NRO). */
function pickLoader(files: ToolingFile[]): ToolingFile | null {
	const isArch = (f: ToolingFile) => /\.(zip|nro)$/i.test(f.fileName);
	const isCore = (f: ToolingFile) => /libretro|_core/i.test(f.fileName);
	const candidates = files.filter((f) => !isCore(f) && isArch(f));
	if (candidates.length === 0) return null;
	// The user may name it anything: a "loader" in the name wins, then a
	// zip (which can carry the icon too), then any remaining NRO.
	return (
		candidates.find((f) => /loader/i.test(f.fileName)) ??
		candidates.find((f) => /\.zip$/i.test(f.fileName)) ??
		candidates[0]
	);
}

/**
 * Libretro's buildbot: the per-core zips RetroArch's own core updater
 * pulls (one zip per core, containing the ready-to-run
 * `<base>_libretro_libnx.nro`). Cores whose `bb` name is set download
 * from here directly — no server upload needed — and fall back to the
 * tooling platform when the buildbot does not have them.
 */
const BUILDBOT_CORE_URL = 'https://buildbot.libretro.com/nightly/nintendo/switch/libnx/latest';

/** The buildbot zip for a core, or null when it is not published there. */
export function buildbotCoreZip(choice: CoreChoice): string | null {
	return choice.bb === undefined ? null : `${BUILDBOT_CORE_URL}/${choice.bb}_libretro_libnx.nro.zip`;
}

/**
 * A plain (unauthenticated) fetch bound for a public URL, shaped like the
 * queue's `fetchPart` — Range-resumable like every other transfer.
 */
function webFetchPart(url: string): (signal: AbortSignal, rangeStart: number) => Promise<Response> {
	return (signal, rangeStart) =>
		fetch(url, rangeStart > 0 ? { signal, headers: { Range: `bytes=${rangeStart}-` } } : { signal });
}

/**
 * Is libretro's buildbot reachable at all from this session? The probe
 * (`linkStamp`) and prior transfer results vote: the Switch's network
 * stack sometimes cannot get through to public https hosts at all —
 * Cloudflare (the buildbot's edge) cuts the Switch's TLS handshake with
 * an EOF — and in that case the server fallback is the only route. One
 * failed attempt poisons this for the session so every launch does not
 * re-pay the handshake timeout.
 */
let webProbe: 'ok' | 'down' | null = null;

/**
 * A public URL answered a HEAD: its `Last-Modified` / body size. Null
 * when the answer says the file is not there (`'missing'` — a 404 on
 * Cloudflare, say) or the request could not even be made (`'offline'` —
 * unreachable, TLS EOF, no server answer). The distinction matters: a
 * missing file means the source will never deliver, so the caller must
 * not even try; an offline HEAD lets a launch trust the local copy.
 */
type LinkStamp = { modified: string; size: number; state: 'ok' };
type LinkProbe = LinkStamp | { state: 'missing' | 'offline'; modified?: undefined; size?: undefined };

async function linkStamp(url: string): Promise<LinkProbe> {
	if (webProbe === 'down') return { state: 'offline' };
	try {
		const head = await fetch(url, { method: 'HEAD' });
		if (!head.ok) return { state: 'missing' };
		const modified = head.headers.get('last-modified') ?? '';
		const size = Number(head.headers.get('content-length'));
		if (webProbe === null) webProbe = 'ok';
		return { state: 'ok', modified, size: Number.isFinite(size) && size > 0 ? size : 0 };
	} catch {
		if (webProbe === null) webProbe = 'down';
		return { state: 'offline' };
	}
}

/** A full transfer through the queue failed on a web source. */
function webSourceFailed(url: string): void {
	if (webProbe === null || webProbe === 'ok') webProbe = 'down';
	log('error', `the public source is unreachable this session (${url.replace(/^.*\//, '')}) — using the RomM server instead`);
}

/** Where a freshly downloaded tooling file waits before being placed. */
function cachePath(file: ToolingFile): string {
	return `${PATHS.appDir}/cache/${file.fileName.replace(/[/\\]/g, '_')}`;
}

/**
 * The RetroArch loader: try libretro's buildbot release archive first
 * (the official stable `RetroArch.7z` — download, unpack the loader NRO +
 * icon with 7z-wasm, place them), and fall back to the tooling platform's
 * uploads on the server when the web source does not deliver. After
 * placement the config is made to point at our directories. Idempotent —
 * a current install costs one manifest lookup.
 */
export async function ensureEmulator(
	client: RommClient,
	manifest: Manifest,
	signal?: AbortSignal,
	config: Config | null = null,
): Promise<ProvisionResult> {
	const record = manifest.emulator;
	const installed = record !== null && (await exists(PATHS.loader));

	// ── web source (buildbot stable 7z) ───────────────────────────────
	// Same cheap-HEAD staleness contract the cores use. An unstamped
	// record (a probe-less install) trusts the placed loader — a launch
	// must never cost a 308 MB re-pull because HEAD never answered.
	if (installed && record !== null) {
		if (record.serverModified === '' && record.serverSize === 0) {
			await ensureCfg(config);
			return { ok: true, error: '', onServer: true, installed: true };
		}
		const stamp = await linkStamp(RETROARCH_7Z_URL);
		// Trust the local copy when the buildbot cannot be seen (or has
		// changed size only — modified is what the stamp compares).
		if (
			stamp.state !== 'ok' ||
			stamp.modified === record.serverModified ||
			(stamp.size > 0 && record.serverSize === stamp.size)
		) {
			await ensureCfg(config);
			return { ok: true, error: '', onServer: true, installed: true };
		}
	}

	// The size for the space guard, from the one cheap HEAD we need
	// anyway for the install stamp. A HEAD that fails downloads blind
	// (the queue's header probe still guards the transfer). A 404 probe
	// means the web source will not deliver — skip straight to the server.
	const stamp = await linkStamp(RETROARCH_7Z_URL);
	if (stamp.state === 'ok') {
		const tempPath = `${PATHS.appDir}/cache/RetroArch.7z`;
		const status = await downloadQueue.add({
			id: 'emulator:web',
			kind: 'emulator',
			label: 'RetroArch loader (buildbot)',
			dest: tempPath,
			size: stamp?.size ?? 0,
			hash: '', // no digest published for the 7z
			fetchPart: webFetchPart(RETROARCH_7Z_URL),
		});

		if (status === 'done') {
			const members = await sevenZipExtract(
				tempPath,
				LOADER_7Z_PATTERNS,
				(line) => log('emulator', `7z: ${line}`),
			);
			const lower = (n: string) => n.replace(/^.*\//, '').toLowerCase();
			const nro =
				members.find((x) => lower(x.name) === 'retroarch_switch.nro') ??
				members.find((x) => lower(x.name).endsWith('.nro'));
			if (nro !== undefined) {
				await writeBinary(PATHS.loader, nro.data);
				const icon = members.find((x) => lower(x.name) === 'retroarch.jpg');
				if (icon !== undefined) {
					await writeBinary(PATHS.icon, icon.data);
					manifest.icon = {
						path: PATHS.icon,
						size: icon.data.length,
						hash: '',
						serverHash: '',
						serverSize: 0,
						serverModified: '',
						installedAt: new Date().toISOString(),
					};
				}
				manifest.emulator = {
					path: PATHS.loader,
					size: nro.data.length,
					hash: '',
					serverHash: '',
					serverSize: stamp?.size ?? 0,
					serverModified: stamp?.modified ?? '',
					installedAt: new Date().toISOString(),
				};
				await ensureCfg(config);
				await saveManifest(manifest);
				// The 308 MB archive has served its purpose on SD too.
				await remove(tempPath);
				log('emulator', `loader placed from the buildbot release (${stamp?.modified ?? 'unprobed'})`);
				return { ok: true, error: '', onServer: true, installed: true };
			}
			log('error', 'the buildbot release unpacked without a loader NRO');
			// Nothing placed: fall through to the server below.
		} else if (status === 'cancelled') {
			return { ok: false, error: 'cancelled', onServer: true, installed };
		} else {
			webSourceFailed(RETROARCH_7Z_URL);
		}
	}
	// A failed (or NRO-less) web pull falls back to the server's uploads:
	// their error messages only land when the fallback fails too.

	const platform = await findToolingPlatform(client, signal);
	if (platform === null) {
		return {
			ok: false,
			error: `The server has no "${TOOLING_PLATFORM}" platform — create it in the RomM web UI and upload the loader`,
			onServer: false,
			installed: manifest.emulator !== null,
		};
	}

	const files = await listToolingFiles(client, platform.id, signal);
	const loader = pickLoader(files);

	if (loader === null) {
		return {
			ok: false,
			error: `The "${TOOLING_PLATFORM}" platform has no loader — upload the RetroArch NRO (or a zip of the switch/ folder)`,
			onServer: false,
			installed,
		};
	}

	if (manifestIsCurrent(manifest.emulator, loader) && installed) {
		await ensureCfg(config);
		return { ok: true, error: '', onServer: true, installed: true };
	}

	// Fetch into the cache, then place whatever the archive contains.
	const fallbackStatus = await downloadQueue.add({
		id: `emulator:${loader.romId}`,
		kind: 'emulator',
		label: 'RetroArch loader',
		dest: cachePath(loader),
		size: loader.size,
		hash: loader.md5,
		fetchPart: (sig, rangeStart) =>
			client.request(
				`/api/roms/${loader.romId}/content/${encodeURIComponent(loader.fileName)}`,
				rangeStart > 0 ? { headers: { Range: `bytes=${rangeStart}-` } } : {},
				sig,
			),
	});

	if (fallbackStatus !== 'done') {
		return { ok: false, error: `could not download the loader (${loader.fileName})`, onServer: true, installed };
	}

	const placed = await placeLoader(cachePath(loader), loader.fileName, manifest);
	if (placed !== null) {
		return { ok: false, error: placed, onServer: true, installed: false };
	}

	manifest.emulator = {
		path: PATHS.loader,
		size: loader.size,
		hash: loader.md5,
		serverHash: loader.md5,
		serverSize: loader.size,
		serverModified: loader.modified,
		installedAt: new Date().toISOString(),
	};
	await ensureCfg(config);
	await saveManifest(manifest);
	log('emulator', `loader placed from ${loader.fileName}`);
	return { ok: true, error: '', onServer: true, installed: true };
}

/**
 * Place a downloaded loader (zip or NRO) into its final home.
 *
 * @returns an error string, or null on success.
 */
async function placeLoader(
	cached: string,
	sourceName: string,
	manifest: Manifest,
): Promise<string | null> {
	if (/\.nro$/i.test(sourceName)) {
		try {
			await remove(PATHS.loader);
			await move(cached, PATHS.loader);
		} catch (err) {
			return `placing the loader failed (${err instanceof Error ? err.message : String(err)})`;
		}
		return null;
	}
	if (!/\.zip$/i.test(sourceName)) {
		return `the loader file must be a .nro or .zip (got ${sourceName})`;
	}

	const buf = await readBinary(cached);
	if (buf === null) return 'the downloaded loader archive is unreadable';
	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipSync(new Uint8Array(buf));
	} catch (err) {
		return `the loader archive would not unpack (${err instanceof Error ? err.message : String(err)})`;
	}

	let nro: string | null = null;
	let icon: string | null = null;
	for (const [name, bytes] of Object.entries(entries)) {
		void bytes;
		const lower = name.toLowerCase();
		if (lower.endsWith('retroarch_switch.nro') || (lower.endsWith('.nro') && lower.includes('switch'))) {
			nro = name;
		}
		if (lower.endsWith('retroarch.jpg')) {
			icon = name;
		}
	}
	if (nro === null) {
		// Anything NRO-shaped in the archive is a reasonable loader.
		nro = Object.keys(entries).find((k) => k.toLowerCase().endsWith('.nro')) ?? null;
	}
	if (nro === null) {
		return 'the loader archive contains no RetroArch NRO — re-upload a zip of the switch/ folder';
	}

	const payload = entries[nro];
	await writeBinary(PATHS.loader, payload);
	if (icon !== null) {
		const iconBytes = entries[icon];
		if (iconBytes instanceof Uint8Array) {
			await writeBinary(PATHS.icon, iconBytes);
			manifest.icon = {
				path: PATHS.icon,
				size: iconBytes.length,
				hash: '',
				serverHash: '',
				serverSize: 0,
				serverModified: '',
				installedAt: new Date().toISOString(),
			};
		}
	}
	// The cache copy has served its purpose.
	await remove(cached);
	return null;
}

/**
 * The RetroArch config, owned by us: it pins saves and states to the
 * directories the sync layer walks, the system directory to where the BIOS
 * lives, and — when the user enabled RetroAchievements — the `cheevos_*`
 * options that make RetroArch's own RAClient track, save and detect
 * achievements while a core runs.
 *
 * Every line we own is written as `key = "value"` (RetroArch's cfg quoting)
 * and patched in place: an existing file keeps its other tuning, only our
 * lines move. The full cheevos set is written on every pass (enable +
 * credentials + display flags), so toggling achievements off cleanly blanks
 * the credentials and disables tracking rather than leaving stale values.
 */
export async function ensureCfg(config: Config | null = null): Promise<void> {
	const dirs: Array<[string, string]> = [
		['save_directory', PATHS.savesDir],
		['state_directory', PATHS.statesDir],
		['system_directory', PATHS.biosDir],
	];

	// The RetroAchievements options. When disabled the credentials are
	// written blank (not omitted) so a previously-enabled cfg stops tracking.
	const flag = (v: boolean) => (v ? 'true' : 'false');
	const enabled = config?.raEnabled === true;
	const cheevos: Array<[string, string]> = [
		['cheevos_enable', flag(enabled)],
		['cheevos_username', enabled ? (config?.raUsername ?? '').trim() : ''],
		['cheevos_password', enabled ? (config?.raPassword ?? '').trim() : ''],
		['cheevos_hardcore', flag(enabled && config?.raHardcore === true)],
		['cheevos_show_instantly', 'true'],
		['cheevos_unofficial_roms_allowed', flag(enabled && config?.raUnofficialRoms === true)],
		['cheevos_rich_presence', 'true'],
	];
	const owned: Array<[string, string]> = [...dirs, ...cheevos];

	const text = await readText(PATHS.raCfg);
	let cfg =
		text ??
		[
			'# RetroArch config — generated by RomMmate.',
			'# Saves/states/BIOS land where RomMmate manages them;',
			'# cheevos_* drive RetroAchievements (enable + credentials).',
			...owned.map(([k, v]) => `${k} = "${v}"`),
		].join('\n');

	if (text !== null) {
		for (const [key, value] of owned) {
			const re = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
			const replacement = `${key} = "${value}"`;
			cfg = re.test(cfg) ? cfg.replace(re, replacement) : `${cfg}\n${replacement}`;
		}
	}

	await writeText(PATHS.raCfg, cfg);
}

/**
 * Is the locally placed buildbot core still the one on the buildbot? A
 * cheap HEAD of the zip compares its `Last-Modified` (fallback: size)
 * against the manifest record. A HEAD that cannot be reached (offline)
 * trusts the local copy — a launch must not fail on a probe; a record
 * with no stamp at all counts as current too (trusting the placed file
 * beats re-pulling an 8 MB nightly on every launch).
 */
async function buildbotIsCurrent(
	record: ManifestFile | null | undefined,
	zipUrl: string,
): Promise<boolean> {
	if (record === null || record === undefined || !(await exists(record.path))) return false;
	if (record.serverModified === '' && record.serverSize === 0) return true;
	const stamp = await linkStamp(zipUrl);
	if (stamp.state !== 'ok') return true;
	if (stamp.modified !== '') return record.serverModified === stamp.modified;
	return stamp.size > 0 && record.serverSize === stamp.size;
}

/**
 * One platform's core: download it when missing or stale.
 *
 * Two sources, best first:
 * 1. libretro's buildbot (nightly cores, when the core is published
 *    there — see `cores.ts`'s `bb` names). No server involvement.
 * 2. the tooling platform's uploads on the server (the original flow,
 *    still covering the cores the buildbot does not carry).
 *
 * @param platformName the library platform (mapped through the core table).
 * @param choice the core to use (the user's picker, else the recommendation).
 * @returns the outcome, shaped for the caller.
 */
export async function ensureCore(
	client: RommClient,
	manifest: Manifest,
	platformName: string,
	choice: CoreChoice,
	files: ToolingFile[],
	signal?: AbortSignal,
): Promise<ProvisionResult> {
	const entry = coreEntryFor(platformName);
	if (entry === null) {
		return {
			ok: false,
			error: `no compatible core for ${platformName} on Switch`,
			onServer: false,
			installed: false,
		};
	}

	const slug = platformSlug(platformName);
	const record = manifest.cores[slug];
	const installed = record !== undefined && (await exists(record.path));

	// ── buildbot first ─────────────────────────────────────────────────
	const zipUrl = buildbotCoreZip(choice);
	if (zipUrl !== null) {
		const zipName = zipUrl.replace(/^.*\//, '');
		if (await buildbotIsCurrent(record, zipUrl)) {
			return { ok: true, error: '', onServer: true, installed: true };
		}

		// Attempt the buildbot download whenever the local copy is missing
		// or stale. The HEAD probe (linkStamp) is only used for the size
		// hint and the install stamp — a failed probe never prevents the
		// transfer itself.
		const stamp = await linkStamp(zipUrl);
		const status = await downloadQueue.add({
			id: `core:${slug}:${choice.id}`,
			kind: 'core',
			label: `${choice.label} core`,
			dest: `${PATHS.appDir}/cache/${zipName}`,
			size: stamp.state === 'ok' ? stamp.size : 0,
			hash: '', // nightly zips carry no digest we can know
			fetchPart: webFetchPart(zipUrl),
		});
		if (status === 'done') {
			const placedAt = await placeCore(`${PATHS.appDir}/cache/${zipName}`, zipName, slug);
			if (placedAt !== null) {
				// Stamp the record with the zip's Last-Modified (fallback:
				// size) so the staleness HEAD can short-circuit next launch.
				const finalStamp = await linkStamp(zipUrl);
				manifest.cores[slug] = {
					path: placedAt,
					size: 0,
					hash: '',
					serverHash: '',
					serverSize: finalStamp.state === 'ok' ? finalStamp.size : 0,
					serverModified: finalStamp.state === 'ok' ? finalStamp.modified : '',
					installedAt: new Date().toISOString(),
				};
				await saveManifest(manifest);
				log('core', `${platformName} → ${choice.label} (buildbot, ${placedAt})`);
				return { ok: true, error: '', onServer: true, installed: true };
			}
			return {
				ok: false,
				error: `the ${choice.label} core file is not a runnable .nro`,
				onServer: true,
				installed,
			};
		}
		if (status === 'cancelled') {
			return { ok: false, error: 'cancelled', onServer: true, installed };
		}
		// Otherwise (error): the buildbot attempt did not deliver — fall
		// through to the server, which may still have this core; its
		// error is only reported when it fails too.
		webSourceFailed(zipUrl);
	}

	// ── the server's uploads ───────────────────────────────────────────
	const file = files.find((f) => choiceMatchesFile(choice, f.fileName));
	if (file === undefined) {
		return {
			ok: false,
			error:
				zipUrl !== null
					? `the ${choice.label} core is unavailable — not on libretro's buildbot or the server (upload it to the ${TOOLING_PLATFORM} platform)`
					: `the ${choice.label} core is not on the server — upload it to the ${TOOLING_PLATFORM} platform`,
			onServer: false,
			installed,
		};
	}

	if (manifestIsCurrent(record, file) && installed) {
		return { ok: true, error: '', onServer: true, installed: true };
	}

	const status = await downloadQueue.add({
		id: `core:${slug}:${choice.id}`,
		kind: 'core',
		label: `${choice.label} core`,
		dest: cachePath(file),
		size: file.size,
		hash: file.md5,
		fetchPart: (sig, rangeStart) =>
			client.request(
				`/api/roms/${file.romId}/content/${encodeURIComponent(file.fileName)}`,
				rangeStart > 0 ? { headers: { Range: `bytes=${rangeStart}-` } } : {},
				sig,
			),
	});
	if (status !== 'done') {
		return { ok: false, error: `could not download the ${choice.label} core`, onServer: true, installed };
	}

	const placedAt = await placeCore(cachePath(file), file.fileName, slug);
	if (placedAt === null) {
		return { ok: false, error: `the ${choice.label} core file is not a runnable .nro`, onServer: true, installed };
	}

	manifest.cores[slug] = {
		path: placedAt,
		size: file.size,
		hash: file.md5,
		serverHash: file.md5,
		serverSize: file.size,
		serverModified: file.modified,
		installedAt: new Date().toISOString(),
	};
	await saveManifest(manifest);
	log('core', `${platformName} → ${choice.label} (${placedAt})`);
	return { ok: true, error: '', onServer: true, installed: true };
}

/**
 * Place a downloaded core (a bare NRO, or a zip wrapping one) in the cores
 * directory.
 *
 * @returns the path of the placed NRO, or null when nothing runnable was found.
 */
async function placeCore(cached: string, sourceName: string, slug: string): Promise<string | null> {
	const destName = sourceName.replace(/\.zip$/i, '');
	if (/\.nro$/i.test(sourceName)) {
		try {
			await move(cached, `${PATHS.coresDir}/${destName}`);
			return `${PATHS.coresDir}/${destName}`;
		} catch {
			return null;
		}
	}
	if (!/\.zip$/i.test(sourceName)) return null;

	const buf = await readBinary(cached);
	if (buf === null) return null;
	const entries = unzipSync(new Uint8Array(buf));
	if (entries === undefined) return null;

	const nros = Object.keys(entries).filter((k) => k.toLowerCase().endsWith('.nro'));
	const nro =
		nros.find((k) => k.toLowerCase().includes(slug)) ??
		(nros.length === 1 ? nros[0] : null) ??
		nros[0] ??
		null;
	if (nro === null) return null;

	const bytes = entries[nro];
	const payload = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(String(bytes));
	const base = nro.replace(/^.*\//, '').replace(/\.nro$/i, '');
	const dest = `${PATHS.coresDir}/${base}_libretro_libnx.nro`;
	await writeBinary(dest, payload);
	await remove(cached);
	return dest;
}

/** Does a server file name look like the given core? (see `cores.ts`). */
function choiceMatchesFile(choice: CoreChoice, fileName: string): boolean {
	return choice.match.test(fileName);
}

/**
 * Any BIOS file this install already has on disk (the offline-play test:
 * at least one record in the manifest whose file still exists).
 */
async function anyBiosOnDisk(manifest: Manifest): Promise<boolean> {
	for (const record of Object.values(manifest.bios)) {
		if (await exists(record.path)) return true;
	}
	return false;
}

/**
 * The BIOS for a platform: whatever firmware the server has for its
 * platform id, downloaded into the system directory. Platforms whose
 * cores need no BIOS cost nothing.
 *
 * @returns the outcome, shaped for the caller.
 */
export async function ensureBios(
	client: RommClient,
	manifest: Manifest,
	platformName: string,
	platformId: number,
	signal?: AbortSignal,
): Promise<ProvisionResult> {
	const entry = coreEntryFor(platformName);
	if (entry === null || entry.bios.length === 0) {
		// Nothing needs a BIOS: success (and nothing to check).
		return { ok: true, error: '', onServer: false, installed: false };
	}

	// Can we already play offline? A BIOS installed on the SD card never
	// lets a server outage block a launch: when the firmware listing
	// cannot be fetched (offline, error — getFirmware's null conflates
	// those), what we have locally is what we play with.
	const haveAny = await anyBiosOnDisk(manifest);

	const fw = await getFirmware(client, platformId, signal);
	if (fw === null) {
		if (haveAny) {
			log('bios', `firmware listing unavailable — playing with the installed BIOS (${platformName})`);
			return { ok: true, error: '', onServer: false, installed: true };
		}
		return {
			ok: false,
			error: `this platform needs a BIOS, but the server has no firmware — upload it in RomM's firmware section`,
			onServer: false,
			installed: false,
		};
	}

	let installed = false;
	for (const f of fw) {
		const dest = `${PATHS.biosDir}/${f.fileName}`;
		const present = manifest.bios[f.fileName] !== undefined && (await exists(dest));
		if (present) installed = true;

		const record = manifest.bios[f.fileName];
		const current =
			record !== undefined &&
			(await exists(dest)) &&
			(f.hash === '' || record.serverHash === f.hash) &&
			(f.sizeBytes === 0 || record.serverSize === f.sizeBytes);
		if (current) continue;

		const status = await downloadQueue.add({
			id: `bios:${f.id}`,
			kind: 'bios',
			label: f.fileName,
			dest,
			size: f.sizeBytes,
			hash: f.md5Hash, // '' = no MD5 in the schema = skip verification
			fetchPart: (sig, rangeStart) =>
				client.request(
					`/api/firmware/${f.id}/content/${encodeURIComponent(f.fileName)}`,
					rangeStart > 0 ? { headers: { Range: `bytes=${rangeStart}-` } } : {},
					sig,
				),
		});
		if (status === 'done') {
			manifest.bios[f.fileName] = {
				path: dest,
				size: f.sizeBytes,
				hash: f.md5Hash,
				serverHash: f.hash,
				serverSize: f.sizeBytes,
				serverModified: '',
				installedAt: new Date().toISOString(),
			};
			await saveManifest(manifest);
			installed = true;
		}
	}
	installed = installed || fw.length === 0;
	return {
		ok: installed,
		error: installed ? '' : `the BIOS for ${platformName} is missing on the server`,
		onServer: fw.length > 0,
		installed,
	};
}

/**
 * The full provisioning pass for one platform: core + BIOS, then the
 * emulator itself (so a Play press never half-sets-up). Used by the
 * launch path.
 */
export async function ensureReadyFor(
	client: RommClient,
	manifest: Manifest,
	platformName: string,
	platformId: number,
	toolingFiles: ToolingFile[],
	choice: CoreChoice,
	config: Config | null = null,
	signal?: AbortSignal,
): Promise<{ ok: boolean; error: string }> {
	const core = await ensureCore(client, manifest, platformName, choice, toolingFiles, signal);
	if (!core.ok) return { ok: false, error: core.error };
	const bios = await ensureBios(client, manifest, platformName, platformId, signal);
	if (!bios.ok) return { ok: false, error: bios.error };
	const emulator = await ensureEmulator(client, manifest, signal, config);
	if (!emulator.ok) return { ok: false, error: emulator.error };
	return { ok: true, error: '' };
}

/** The free-space helper (bytes, or null off-device). */
export { sdFreeSpace };
