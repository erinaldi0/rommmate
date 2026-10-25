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
import type { RommClient, RommGame, RommPlatform } from '../romm';
import { getFirmware } from '../romm/play';
import { PATHS, platformSlug } from './layout';
import { coreEntryFor, type CoreChoice } from './cores';
import { downloadQueue } from '../roms/download';
import { saveManifest, type Manifest, type ManifestFile } from '../manifest';
import { exists, move, readBinary, readText, remove, sdFreeSpace, writeBinary, writeText } from '../fs';
import { log } from '../log';

/**
 * The tooling platform's name, as created in the RomM web UI. It is not a
 * game platform — it holds the emulator itself — so the library hides it.
 */
export const TOOLING_PLATFORM = 'RetroArch';

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
	/** What the server has — for the doctor screen's checklist. */
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

/** Where a freshly downloaded tooling file waits before being placed. */
function cachePath(file: ToolingFile): string {
	return `${PATHS.appDir}/cache/${file.fileName.replace(/[/\\]/g, '_')}`;
}

/**
 * The RetroArch loader: download it from the tooling platform when missing
 * or stale, place the NRO + icon, and make sure the config points at our
 * directories. Idempotent — a current install costs one manifest lookup.
 */
export async function ensureEmulator(
	client: RommClient,
	manifest: Manifest,
	signal?: AbortSignal,
): Promise<ProvisionResult> {
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
	const installed = manifest.emulator !== null && (await exists(PATHS.loader));

	if (loader === null) {
		return {
			ok: false,
			error: `The "${TOOLING_PLATFORM}" platform has no loader — upload the RetroArch NRO (or a zip of the switch/ folder)`,
			onServer: false,
			installed,
		};
	}

	if (manifestIsCurrent(manifest.emulator, loader) && installed) {
		await ensureCfg();
		return { ok: true, error: '', onServer: true, installed: true };
	}

	// Fetch into the cache, then place whatever the archive contains.
	const status = await downloadQueue.add({
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

	if (status !== 'done') {
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
	await ensureCfg();
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
 * directories the sync layer walks, and the system directory to where the
 * BIOS lives. An existing file is patched in place (only the three
 * directory lines are touched, so a user-tuned cfg keeps its tuning).
 */
export async function ensureCfg(): Promise<void> {
	const dirs: Array<[string, string]> = [
		['save_directory', PATHS.savesDir],
		['state_directory', PATHS.statesDir],
		['system_directory', PATHS.biosDir],
	];
	const text = await readText(PATHS.raCfg);
	let cfg =
		text ??
		[
			'# RetroArch config — generated by RomMmate.',
			'# Saves and states land where RomMmate syncs them; BIOS in system_directory.',
			...dirs.map(([k, v]) => `${k} = "${v}"`),
		].join('\n');

	if (text !== null) {
		for (const [key, value] of dirs) {
			const re = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
			const replacement = `${key} = "${value}"`;
			cfg = re.test(cfg) ? cfg.replace(re, replacement) : `${cfg}\n${replacement}`;
		}
	}

	await writeText(PATHS.raCfg, cfg);
}

/**
 * One platform's core: download it when missing or stale.
 *
 * @param platformName the library platform (mapped through the core table).
 * @param choice the core to use (the user's picker, else the recommendation).
 * @returns the outcome, shaped for the doctor screen.
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
	const installed =
		manifest.cores[slug] !== undefined && (await exists(manifest.cores[slug].path));

	const file = files.find((f) => choiceMatchesFile(choice, f.fileName));
	if (file === undefined) {
		return {
			ok: false,
			error: `the ${choice.label} core is not on the server — upload it to the ${TOOLING_PLATFORM} platform`,
			onServer: false,
			installed,
		};
	}

	if (manifestIsCurrent(manifest.cores[slug], file) && installed) {
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
 * The BIOS for a platform: whatever firmware the server has for its
 * platform id, downloaded into the system directory. Platforms whose
 * cores need no BIOS cost nothing.
 *
 * @returns the outcome, shaped for the doctor screen.
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

	const fw = await getFirmware(client, platformId, signal);
	if (fw === null) {
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
 * emulator itself (so a Play press never half-sets-up). Used by both the
 * doctor screen and the launch path.
 */
export async function ensureReadyFor(
	client: RommClient,
	manifest: Manifest,
	platformName: string,
	platformId: number,
	toolingFiles: ToolingFile[],
	choice: CoreChoice,
	signal?: AbortSignal,
): Promise<{ ok: boolean; error: string }> {
	const core = await ensureCore(client, manifest, platformName, choice, toolingFiles, signal);
	if (!core.ok) return { ok: false, error: core.error };
	const bios = await ensureBios(client, manifest, platformName, platformId, signal);
	if (!bios.ok) return { ok: false, error: bios.error };
	const emulator = await ensureEmulator(client, manifest, signal);
	if (!emulator.ok) return { ok: false, error: emulator.error };
	return { ok: true, error: '' };
}

/** The free-space helper the doctor screen shows (bytes, or null off-device). */
export { sdFreeSpace };
