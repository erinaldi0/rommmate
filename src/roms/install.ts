/**
 * Installing and uninstalling a game.
 *
 * Install is "download the rom's files into our roms tree and remember
 * where they went":
 *
 *   1. resolve the file list (the rom entry's `files`, or — on instances
 *      that omit it from the list — the single-rom route);
 *   2. skip files that are already on the SD with the server's hash;
 *   3. queue the rest through the download queue (streaming, resumable,
 *      MD5-verified);
 *   4. when a small zip lands, unpack it so the core gets a plain file,
 *      and record the path to hand RetroArch.
 *
 * Zips above `EXTRACT_MAX` are left as archives: RetroArch opens them
 * natively, and unpacking a 1.5 GB archive in a 32-bit V8 heap is exactly
 * the kind of thing that must not happen.
 */
import { unzipSync } from 'fflate';
import type { RommClient, RommGame, RommRomFile } from '../romm';
import { baseName, platformSlug, romDir, romPath } from '../retroarch/layout';
import { downloadQueue } from './download';
import { saveManifest, type Manifest, type ManifestFile, type ManifestRom } from '../manifest';
import { exists, fileSize, readBinary, remove, writeBinary } from '../fs';
import { md5File } from '../hash';
import { log } from '../log';

/** Zips at or under this size are unpacked for the core; bigger stay zipped. */
export const EXTRACT_MAX = 8 * 1024 * 1024;

/** A planned placement of one file. */
export interface InstallPlan {
	file: RommRomFile;
	/** Where the downloaded file lands. */
	dest: string;
	/** Where its contents get unpacked (zips at or under `EXTRACT_MAX`). */
	extractDir: string | null;
}

/** The result of an install request. */
export interface InstallResult {
	ok: boolean;
	/** Files queued for download. */
	queued: number;
	/** Files already up to date on the SD. */
	skipped: number;
	/** Human error, when the request could not even be queued. */
	error: string;
}

/**
 * The rom's files, from the single-rom route — or, when it cannot be
 * reached, from the library entry.
 *
 * The single-rom route comes FIRST on purpose: the `game` in hand may be a
 * library entry read from the local cache, and the file list it carries
 * (sizes, MD5s) is whatever the server reported at the last walk. The file
 * on the server may have been re-scanned or replaced since, and a download
 * planned against stale sizes is how the app ends up "mentioning" 507 MB
 * while writing a 525 MB file. One small `GET /api/roms/{id}` per install
 * keeps the plan honest; the cached entry's own files are the fallback when
 * the fetch fails (offline), and the fs_name the last resort.
 */
async function resolveFiles(
	client: RommClient,
	game: RommGame,
	signal?: AbortSignal,
): Promise<RommRomFile[]> {
	const { game: fresh } = await client.getRom(game.id, signal);
	if (fresh !== null && fresh.files.length > 0) return fresh.files;
	if (game.files.length > 0) return game.files;
	// Last resort: the fs_name (single-file roms carry it) — the fresh
	// record's when the server answered, the cached entry's otherwise. The
	// single-rom route keeps the file's own MD5 at the top level, so a
	// single-file rom from a live answer still verifies.
	const name = fresh !== null && fresh.fsName !== '' ? fresh.fsName : game.fsName;
	if (name !== '') {
		return [
			{
				fileName: name,
				sizeBytes: fresh !== null && fresh.sizeBytes > 0 ? fresh.sizeBytes : game.sizeBytes,
				md5Hash: fresh !== null && fresh.hasMultipleFiles === false ? fresh.md5Hash : '',
				extension: name.includes('.')
					? name.slice(name.lastIndexOf('.') + 1).toLowerCase()
					: '',
				topLevel: true,
				memberCount: 0,
			},
		];
	}
	return [];
}

/**
 * Whether a local copy of `file` at `dest` is still current.
 *
 * Recorded in the manifest: current when the file is present and the
 * server's fingerprint has not moved since install (a re-`install` of an
 * unchanged rom is a no-op; a changed one re-downloads).
 *
 * Not recorded (a file someone put there by hand): current when it exists
 * and matches what the server reported — with an actual MD5 check for
 * small files, because "the size matches" is the only signal a large file
 * can afford (hashing a multi-GB rom to prove a guess is not free).
 */
async function localIsCurrent(
	file: RommRomFile,
	dest: string,
	manifest: Manifest,
	romId: number,
): Promise<boolean> {
	if (!(await exists(dest))) return false;

	const entry = manifest.roms[String(romId)];
	if (entry !== undefined) {
		const recorded = entry.files.find((f) => f.path === dest);
		if (recorded === undefined) return false;
		const hashMoved = file.md5Hash !== '' && recorded.serverHash !== file.md5Hash;
		const sizeMoved = file.sizeBytes > 0 && recorded.serverSize !== file.sizeBytes;
		return !(hashMoved || sizeMoved);
	}

	if (file.sizeBytes > 0 && (await fileSize(dest)) !== file.sizeBytes) return false;
	if (file.md5Hash !== '' && file.sizeBytes > 0 && file.sizeBytes <= EXTRACT_MAX) {
		const actual = await md5File(dest);
		return actual !== null && actual.toLowerCase() === file.md5Hash.toLowerCase();
	}
	return true;
}

/**
 * Queue the download of one game's files.
 *
 * @param game the rom (one disc) to install.
 * @param manifest the live manifest (read for staleness, updated as files land).
 * @returns what was queued, and what was already current.
 */
export async function installGame(
	client: RommClient,
	game: RommGame,
	manifest: Manifest,
	signal?: AbortSignal,
): Promise<InstallResult> {
	const files = await resolveFiles(client, game, signal);
	if (files.length === 0) {
		return {
			ok: false,
			queued: 0,
			skipped: 0,
			error: 'the server has no file information for this rom',
		};
	}

	let queued = 0;
	let skipped = 0;
	for (const file of files) {
		const dest = romPath(game.platform, file.fileName);
		if (await localIsCurrent(file, dest, manifest, game.id)) {
			skipped += 1;
			continue;
		}
		const smallZip = file.extension === 'zip' && file.sizeBytes <= EXTRACT_MAX;
		const plan: InstallPlan = {
			file,
			dest,
			extractDir: smallZip ? `${romDir(game.platform)}/${baseName(file.fileName)}` : null,
		};

		downloadQueue.add({
			id: `rom:${game.id}:${file.fileName}`,
			kind: 'rom',
			label: game.name !== '' ? game.name : file.fileName,
			dest,
			size: file.sizeBytes,
			hash: file.md5Hash,
			fetchPart: (sig, rangeStart) =>
				client.request(
					`/api/roms/${game.id}/content/${encodeURIComponent(file.fileName)}?purpose=play`,
					rangeStart > 0 ? { headers: { Range: `bytes=${rangeStart}-` } } : {},
					sig,
				),
			onDone: (status) => {
				void onRomFileDone(game, plan, status, manifest);
			},
		});
		// The file name makes it into the log: every disc of a release
		// shares the game's name, so "queued" alone would not say WHICH
		// disc is being pulled (the download queue's own lines carry only
		// the label).
		log('install', `${game.name !== '' ? game.name : `rom ${game.id}`}: queueing ${file.fileName}`);
		queued += 1;
	}

	return {
		ok: true,
		queued,
		skipped,
		error: '',
	};
}

/**
 * One file landed (or failed): merge it into the manifest's rom entry.
 * The entry appears as soon as the first file is placed, so the UI flips
 * from "installing" to "installed" without waiting for every file.
 *
 * The merge happens *after* the download queue's own completion notify,
 * so interested parties (the play service re-deriving rom states) are
 * told again here — without this a finished download left the game's
 * detail screen showing "download" until the next boot.
 */
let manifestChangeTap: (() => void) | null = null;
/** Register the callback fired whenever a rom entry changes on disk. */
export function onManifestChanged(tap: (() => void) | null): void {
	manifestChangeTap = tap;
}
function fireManifestChanged(): void {
	manifestChangeTap?.();
}

async function onRomFileDone(
	game: RommGame,
	plan: InstallPlan,
	status: string,
	manifest: Manifest,
): Promise<void> {
	const key = String(game.id);
	const entry: ManifestRom = manifest.roms[key] ?? {
		romId: game.id,
		name: game.name,
		platform: game.platform,
		platformId: game.platformId,
		files: [],
		extractDirs: [],
		playPath: '',
		outdated: false,
	};

	if (status !== 'done') {
		// A failed download changes nothing on disk — don't mark the
		// manifest outdated. The error surfaces via the queue item's
		// status text instead of a misleading "Outdated on server".
		fireManifestChanged();
		return;
	}

	// Unpack a small zip so the core gets a plain file; the launch path is
	// the extracted member (or, when extraction failed, the archive).
	let playPath = plan.dest;
	if (plan.extractDir !== null) {
		const extracted = await extractZip(plan.dest, plan.extractDir);
		if (extracted !== null) {
			playPath = extracted;
			if (!entry.extractDirs.includes(plan.extractDir)) {
				entry.extractDirs.push(plan.extractDir);
			}
		}
	}

	// The size actually written to disk, not the size the record claimed:
	// when the two differ (a file re-scanned or replaced on the server) the
	// local truth is what the next staleness check can rely on — the
	// `serverSize`/`serverHash` fields keep the record's values, so a later
	// record refresh still registers as a move.
	let size = plan.file.sizeBytes;
	const actual = await fileSize(plan.dest);
	if (actual > 0) size = actual;

	const file: ManifestFile = {
		path: plan.dest,
		size,
		hash: plan.file.md5Hash,
		serverHash: plan.file.md5Hash,
		serverSize: plan.file.sizeBytes,
		serverModified: game.createdAt,
		installedAt: new Date().toISOString(),
	};
	entry.files = entry.files.filter((f) => f.path !== plan.dest);
	entry.files.push(file);
	if (entry.playPath === '' && playPath !== '') entry.playPath = playPath;
	entry.outdated = false;

	manifest.roms[key] = entry;
	await saveManifest(manifest);
	fireManifestChanged();
	log('install', `${game.name}: ${plan.file.fileName} → ${plan.dest}`);
}

/**
 * Unpack a zip into `dir`, returning the path of the member to launch
 * (the only file member, or the biggest one when there are several).
 *
 * Directory entries are materialised as empty files (FAT32 needs no
 * marker, and the core reads by name); a zero-length "member" that the
 * archive lists as a directory is skipped as a launch target.
 *
 * @returns the launch path, or null when the archive would not unpack
 *          (the zip is left in place: RetroArch can still open it).
 */
async function extractZip(zipPath: string, dir: string): Promise<string | null> {
	const buf = await readBinary(zipPath);
	if (buf === null) return null;
	try {
		const entries = unzipSync(new Uint8Array(buf));

		let best: string | null = null;
		let bestSize = -1;
		for (const [name, bytes] of Object.entries(entries)) {
			const clean = name.replace(/^\/+/, '');
			if (clean === '' || clean.includes('/..')) continue;
			// A directory marker (trailing slash): the members inside it
			// create the path when they are written.
			if (clean.endsWith('/')) continue;
			const memberPath = `${dir}/${clean}`;
			await writeBinary(memberPath, bytes);
			if (bytes.length > bestSize) {
				bestSize = bytes.length;
				best = memberPath;
			}
		}
		return best;
	} catch (err) {
		log('error', `extract ${zipPath}: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
}

/**
 * Remove a game's installed files (the roms + unpacked trees) from the SD
 * and forget it in the manifest. Saves are kept on purpose: they belong
 * to the server via sync, and a reinstall should not lose them.
 */
export async function uninstallGame(manifest: Manifest, game: RommGame): Promise<void> {
	const key = String(game.id);
	const entry = manifest.roms[key];
	if (entry === undefined) return;

	for (const file of entry.files) {
		await remove(file.path);
	}
	for (const dir of entry.extractDirs) {
		await remove(dir);
	}
	delete manifest.roms[key];
	await saveManifest(manifest);
	log('uninstall', `${game.name} (${entry.files.length} file(s))`);
}
