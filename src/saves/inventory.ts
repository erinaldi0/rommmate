/**
 * The local inventory: what save files and save states actually exist on
 * the SD, matched against the installed roms.
 *
 * RetroArch names a save after the rom's base name (`Foo (USA).gba` →
 * `Foo (USA).srm`, `…mcr`, `…nvram`, `…bflash`, …) in whatever directory
 * the cfg points at — and *we* point the cfg at our own `saves/` and
 * `states/` directories. So the inventory is a directory walk plus a
 * base-name join against the manifest's installed roms, and it is cheap
 * enough to run at every boot (a few hundred entries at most).
 *
 * The join is by base name, case-insensitive, so the sync layer can tell
 * "this save belongs to installed rom #1234" without the server involved.
 * Files that match no installed rom are reported (the sync can still see
 * them) but are never uploaded.
 */
import { baseName, baseNameOf, PATHS } from '../retroarch/layout';
import { fileSize, fileMtime, listDir } from '../fs';
import { md5File } from '../hash';
import type { Manifest } from '../manifest';

/** One save/state file found on the SD. */
export interface LocalSaveFile {
	/** The full `sdmc:` path. */
	path: string;
	/** The file name (what RetroArch wrote). */
	fileName: string;
	/** Base name without extension — the join key. */
	baseName: string;
	/** The installed rom it belongs to, 0 when it matches none. */
	romId: number;
	/** The installed rom's display name ('' when unmatched). */
	romName: string;
	/** True for save states, false for persistent saves. */
	isState: boolean;
	/**
	 * The sync "slot" the server pairs by (saves are paired on
	 * rom id + slot). mGBA-family saves use the server's own `autosave`
	 * naming, so a save written by mGBA elsewhere pairs with the one the
	 * RetroArch mgba core writes; everything else uses the file extension
	 * (`mcr`, `nvram`, …) so two memory types of one rom do not collide.
	 * States are all `state`.
	 */
	slot: string;
	size: number;
	/** epoch ms, 0 when the runtime could not read it. */
	mtime: number;
	/**
	 * The content MD5, computed lazily: only files that actually changed
	 * since the last sync (per the manifest snapshot) are hashed.
	 * '' when unchanged and the snapshot already holds a hash.
	 */
	hash: string;
	/** True when the file is new or changed since the last sync. */
	changed: boolean;
}

/**
 * Whether `path` is considered changed against the manifest's snapshot of
 * it. A missing snapshot means "never synced" — changed.
 */
function isChanged(
	path: string,
	size: number,
	mtime: number,
	manifest: Manifest,
): boolean {
	const snap = manifest.saveSnapshot[path];
	if (snap === undefined) return true;
	if (snap.size !== size) return true;
	if (mtime > 0 && snap.mtime !== mtime) return true;
	return false;
}

/**
 * The base names (lowercased) → rom id/name of every installed rom, for
 * the join. A rom contributes its launch path's base name (the real game
 * file for an extracted zip) and each raw file's base name (the archive
 * itself when RetroArch opens it as-is).
 */
function romBaseIndex(manifest: Manifest): Map<string, { romId: number; name: string }> {
	const index = new Map<string, { romId: number; name: string }>();
	for (const rom of Object.values(manifest.roms)) {
		const targets: string[] = [];
		if (rom.playPath !== '') targets.push(baseNameOf(rom.playPath));
		for (const file of rom.files) {
			targets.push(baseNameOf(file.path));
		}
		for (const t of targets) {
			const key = t.toLowerCase();
			// First registration wins: the launch path is pushed first and
			// is the one RetroArch actually names saves after.
			if (!index.has(key)) index.set(key, { romId: rom.romId, name: rom.name });
		}
	}
	return index;
}

/**
 * A state file's base name: RetroArch writes `Foo.state` for slot 0 and
 * `Foo.001.state` for slot 1, so the trailing `.<n>` is stripped before
 * the join.
 */
function stateBaseName(fileName: string): string {
	const noExt = baseName(fileName);
	return noExt.replace(/\.(\d{1,3})$/, '');
}

/**
 * The slot label for one file (see `LocalSaveFile.slot`).
 *
 * `.srm` (GBA) and `.gbs` (GB/GBC) are the mGBA memory-save formats. The
 * RomM server's own mGBA clients name that slot `autosave`, so a save the
 * user made elsewhere with mGBA pairs with the one the mgba core writes
 * here — without the mapping the server would never pair them and would
 * re-offer the same save on every sync.
 */
function slotFor(fileName: string, isState: boolean): string {
	if (isState) return 'state';
	const dot = fileName.lastIndexOf('.');
	const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : 'save';
	return ext === 'srm' || ext === 'gbs' ? 'autosave' : ext;
}

/**
 * Walk the saves and states directories and match every file against the
 * installed roms.
 *
 * @param manifest the live manifest (installed roms + last-sync snapshot).
 * @returns one `LocalSaveFile` per file found — including unmatched ones
 *          (with `romId` 0), so the caller can report or ignore them.
 */
export async function localSaveFiles(manifest: Manifest): Promise<LocalSaveFile[]> {
	const index = romBaseIndex(manifest);
	const out: LocalSaveFile[] = [];

	const scanDir = async (dir: string, isState: boolean, romIdFromDir?: number) => {
		const entries = await listDir(dir);
		if (entries === null) return;
		for (const entry of entries) {
			const path = `${dir}/${entry.name}`;
			if (entry.isFile) {
				const size = await fileSize(path);
				if (size < 0) continue; // a vanished file (deleted mid-walk)
				const mtime = await fileMtime(path);
				const base = isState ? stateBaseName(entry.name) : baseName(entry.name);
				const match = index.get(base.toLowerCase());
				// A file inside a per-rom dir (<romId>/<file>) takes its romId
				// from the directory name; a flat file at the root is matched
				// by base name against the installed roms.
				const romId = romIdFromDir ?? match?.romId ?? 0;

				const changed = isChanged(path, size, mtime, manifest);
				const snap = manifest.saveSnapshot[path];
				// Hash only what moved; otherwise reuse the remembered hash.
				const hash = changed ? (await md5File(path)) ?? '' : snap?.hash ?? '';

				out.push({
					path,
					fileName: entry.name,
					baseName: base,
					romId,
					romName: match?.name ?? '',
					isState,
					slot: slotFor(entry.name, isState),
					size,
					mtime,
					hash,
					changed,
				});
			} else {
				// A subdirectory at the root is a per-rom folder: its name
				// is the rom id. Recurse into it with that rom id.
				const dirRomId = Number(entry.name);
				if (Number.isFinite(dirRomId) && dirRomId > 0) {
					await scanDir(path, isState, dirRomId);
				}
			}
		}
	};

	await scanDir(PATHS.savesDir, false);
	await scanDir(PATHS.statesDir, true);
	return out;
}
