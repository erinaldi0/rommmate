/**
 * The install manifest: the app's registry of everything the Play feature
 * has placed on the SD card.
 *
 * One JSON file (`sdmc:/switch/rommmate/manifest.json`) — or a plain object
 * in the browser preview, where there is no SD to persist to. Every file we
 * write (emulator, cores, BIOS, roms) is recorded with the *server-side*
 * fingerprint it was fetched with, so a later boot can tell "up to date"
 * from "the file changed on the server" without re-downloading: the check
 * is a manifest lookup, not a network call.
 *
 * The manifest also keeps the sync layer's bookkeeping: the RomM device
 * id, and the last-seen hash/size/mtime of every local save + state file
 * (the change detector that decides which files get re-hashed).
 *
 * It is written atomically-ish (temp + rename) so a crash mid-write never
 * leaves a half-JSON file that the next boot cannot parse.
 */
import { exists, move, readText, remove, writeText } from './fs';
import { PATHS } from './retroarch/layout';

/** One file we have installed, with the server fingerprint we used for it. */
export interface ManifestFile {
	/** Where it lives on the SD. */
	path: string;
	/** Local size in bytes (0 when unknown). */
	size: number;
	/** The local MD5, verified at install time ('' when unverified). */
	hash: string;
	/** The server's fingerprint (its MD5 or SHA1) — for staleness. */
	serverHash: string;
	/** The server's reported size, for staleness (0 when unknown). */
	serverSize: number;
	/** The server's last-modified, for staleness (ISO, '' when unknown). */
	serverModified: string;
	/** When we installed this copy (ISO). */
	installedAt: string;
}

/** One installed rom (a single disc), with its launch target. */
export interface ManifestRom {
	/** The server rom id — the key for saves, sync and play sessions. */
	romId: number;
	/** Display name at install time. */
	name: string;
	/** The platform name at install time. */
	platform: string;
	/** The rom's platform id at install time (for BIOS lookups). */
	platformId: number;
	/** The installed files. */
	files: ManifestFile[];
	/** Unpacked-zip directories created for this rom (removed on uninstall). */
	extractDirs: string[];
	/**
	 * The path to hand RetroArch as the game — the extracted member for a
	 * single-file zip, the archive itself otherwise ('' when the rom
	 * cannot be launched, which keeps it installable but unplayable).
	 */
	playPath: string;
	/** True when any installed file is known stale against the server. */
	outdated: boolean;
}

/** The snapshot of one local save/state file at the last sync. */
export interface SaveSnapshot {
	/** MD5 at the last sync ('' when never hashed). */
	hash: string;
	size: number;
	/** epoch ms of the file at the last sync. */
	mtime: number;
}

export interface Manifest {
	/** Format version — future writers can migrate or refuse. */
	version: 1;
	/** This console's RomM device id (once registered). */
	deviceId: string | null;
	/** The RetroArch loader NRO, when installed. */
	emulator: ManifestFile | null;
	/** The launcher icon, when installed. */
	icon: ManifestFile | null;
	/** Core per platform slug (see `retroarch/cores.ts`). */
	cores: Record<string, ManifestFile>;
	/** BIOS files, keyed by file name. */
	bios: Record<string, ManifestFile>;
	/** Installed roms, keyed by `String(romId)`. */
	roms: Record<string, ManifestRom>;
	/** Last-sync snapshot per local save/state path (change detection). */
	saveSnapshot: Record<string, SaveSnapshot>;
}

export function freshManifest(): Manifest {
	return {
		version: 1,
		deviceId: null,
		emulator: null,
		icon: null,
		cores: {},
		bios: {},
		roms: {},
		saveSnapshot: {},
	};
}

const TEMP_PATH = PATHS.appDir + '/manifest.json.tmp';

/**
 * Load the manifest, falling back to a fresh one when the file is absent
 * or unparseable (a corrupted manifest must never block the app — the
 * download queue simply re-verifies everything it touches).
 */
export async function loadManifest(): Promise<Manifest> {
	const base = freshManifest();
	try {
		if (!(await exists(PATHS.manifest))) return base;
		const text = await readText(PATHS.manifest);
		if (text === null) return base;
		const parsed: unknown = JSON.parse(text);
		if (typeof parsed !== 'object' || parsed === null) return base;
		const m = parsed as Partial<Manifest>;
		return {
			version: 1,
			deviceId: typeof m.deviceId === 'string' ? m.deviceId : null,
			emulator: m.emulator ?? null,
			icon: m.icon ?? null,
			cores: m.cores ?? {},
			bios: m.bios ?? {},
			roms: m.roms ?? {},
			saveSnapshot: m.saveSnapshot ?? {},
		};
	} catch {
		return base;
	}
}

/**
 * Persist the manifest (temp + rename). Best-effort: in the browser
 * preview this writes to the in-memory tree, on the Switch to the SD.
 * The caller keeps its in-memory copy regardless — a failed write means
 * the next boot re-verifies, not that the install is wrong.
 */
export async function saveManifest(manifest: Manifest): Promise<void> {
	try {
		await writeText(TEMP_PATH, JSON.stringify(manifest, null, 1));
		await move(TEMP_PATH, PATHS.manifest);
	} catch {
		try {
			await remove(TEMP_PATH);
		} catch {
			/* nothing else to do */
		}
	}
}
