/**
 * The Play service: the single object the UI talks to for everything the
 * detail screen's action rows do (install / play / sync / uninstall) and
 * for the boot-time work (pending-session ingest, auto sync, doctor).
 *
 * It is a process-wide singleton (like the download queue) with a tiny
 * external store: React screens subscribe with `useSyncExternalStore` and
 * re-render when a game's play state changes (a download finishing flips
 * "installing" → "ready"), so no polling and no prop-drilled progress.
 *
 * It owns the one in-memory `Manifest` instance; every worker (install,
 * provisioning, sync) mutates that same object and persists it, so the
 * store and the disk can never drift within a session.
 */
import { useSyncExternalStore } from 'react';
import { loadManifest, type Manifest } from './manifest';
import {
	coreEntryFor,
	chosenChoice,
	isEmulablePlatform,
	type CoreChoice,
} from './retroarch/cores';
import {
	ensureCore,
	ensureEmulator,
	ensureReadyFor,
	findToolingPlatform,
	listToolingFiles,
	type ToolingFile,
} from './retroarch/emulator';
import { sdFreeSpace } from './fs';
import { installGame, uninstallGame, onManifestChanged } from './roms/install';
import { downloadQueue } from './roms/download';
import {
	runSaveSync,
	type SyncReport,
	readPendingSession,
	ingestPendingSession,
	writePendingSession,
} from './saves/sync';
import { localSaveFiles } from './saves/inventory';
import { PATHS, platformSlug } from './retroarch/layout';
import { launchRetroArch } from './launch';
import { setActivity } from './activity';
import type { Config } from './config';
import type { RommClient, RommGame } from './romm';
import { getFirmware, getDevices } from './romm/play';

/** The UI-facing state of one game's Play capability. */
export type PlayState =
	| { kind: 'demo' }
	| { kind: 'unsupported' }
	| { kind: 'not-installed'; sizeBytes: number }
	| { kind: 'installing'; progress: number }
	| { kind: 'ready' }
	| { kind: 'stale' };

/** One checklist line for the setup/doctor screen. */
export interface DoctorRow {
	label: string;
	ok: boolean;
	/** Shown when not ok (what to do about it). */
	note: string;
}

export interface DoctorReport {
	rows: DoctorRow[];
	/** True when there is anything to fix. */
	needsWork: boolean;
}

class PlayService {
	#manifest: Manifest | null = null;
	/** Per-rom play state (stable object identity until it changes). */
	#states = new Map<number, PlayState>();
	/** The last game object seen per rom (platform/size for derivation). */
	#games = new Map<number, RommGame>();
	/** Bound session, set on connect (null in demo mode). */
	#client: RommClient | null = null;
	#config: Config | null = null;
	#bootSyncDone = false;
	/** The tooling platform's files, cached per client (one walk). */
	#toolingClient: RommClient | null = null;
	#toolingCache: ToolingFile[] | null = null;
	/** The download-queue subscription (keeps "installing" progress fresh). */
	#queueUnsub: (() => void) | null = null;
	/** The last sync report (for the status line). */
	lastReport: SyncReport | null = null;

	// ── the external store ──────────────────────────────────────────────

	get version(): number {
		return storeVersion;
	}

	subscribe = (listener: () => void): (() => void) => {
		storeListeners.add(listener);
		return () => {
			storeListeners.delete(listener);
		};
	};

	get manifest(): Manifest | null {
		return this.#manifest;
	}

	get client(): RommClient | null {
		return this.#client;
	}

	/**
	 * Bind a live session: load (or reset) the manifest and remember the
	 * client + config every action needs. Called on successful connect and
	 * on demo start (with nulls).
	 */
	async bind(client: RommClient | null, config: Config | null): Promise<void> {
		this.#client = client;
		this.#config = config;
		this.#bootSyncDone = false;
		this.#toolingClient = null;
		this.#toolingCache = null;
		this.lastReport = null;
		this.#manifest = await loadManifest();
		for (const game of this.#games.values()) {
			this.#recompute(game.id);
		}
		this.#queueUnsub?.();
		this.#queueUnsub = downloadQueue.subscribe(() => {
			// A queue move (item started / finished / cancelled) can flip a
			// rom's "installing" state; recompute every rom the queue knows.
			for (const view of downloadQueue.getItems()) {
				if (view.kind !== 'rom') continue;
				const match = /^rom:(\d+):/.exec(view.id);
				if (match !== null) this.#recompute(Number(match[1]));
			}
		});
		// The install bookkeeping lands in the manifest *after* the queue's
		// notify (it saves + merges asynchronously); this tap re-derives the
		// roms then, so a finished download flips the UI to "Play" at once.
		onManifestChanged(() => this.#recomputeAll());
		notify();
	}

	/**
	 * Update the bound config in place (a settings change) — without the
	 * full `bind` ceremony, which would re-arm the boot sync.
	 */
	setConfig(config: Config | null): void {
		this.#config = config;
	}

	/** Remember a game so its state can be derived without the UI passing it. */
	noteGame(game: RommGame): void {
		const fresh = this.#games.get(game.id) !== game;
		this.#games.set(game.id, game);
		this.#recompute(game.id);
		if (fresh) notify();
	}

	/**
	 * The UI-facing state of one game (a stable reference until it changes,
	 * as `useSyncExternalStore` requires).
	 */
	stateFor(romId: number): PlayState {
		const cached = this.#states.get(romId);
		if (cached !== undefined) return cached;
		const derived = this.#derive(romId);
		this.#states.set(romId, derived);
		return derived;
	}

	/** Recompute one game's state (and only notify when it actually moved). */
	#recompute(romId: number): void {
		const next = this.#derive(romId);
		const prev = this.#states.get(romId);
		if (
			prev === undefined ||
			prev.kind !== next.kind ||
			(prev.kind === 'installing' && next.kind === 'installing' && prev.progress !== next.progress) ||
			(prev.kind === 'not-installed' && next.kind === 'not-installed' && prev.sizeBytes !== next.sizeBytes)
		) {
			this.#states.set(romId, next);
			notify();
		}
	}

	/** Recompute every known game (after sync / uninstall / bind). */
	#recomputeAll(): void {
		for (const [romId] of this.#states) {
			const next = this.#derive(romId);
			const prev = this.#states.get(romId);
			if (
				prev === undefined ||
				prev.kind !== next.kind ||
				(prev.kind === 'installing' && next.kind === 'installing' && prev.progress !== next.progress)
			) {
				this.#states.set(romId, next);
			}
		}
		notify();
	}

	/** Derive the state (without caching). */
	#derive(romId: number): PlayState {
		if (this.#client === null) return { kind: 'demo' };
		const game = this.#games.get(romId) ?? null;
		const manifest = this.#manifest;

		// A download in flight for this rom wins the display.
		const running = downloadQueue
			.getItems()
			.find((v) => v.id.startsWith(`rom:${romId}:`) && (v.status === 'running' || v.status === 'queued'));
		if (running !== undefined) {
			return { kind: 'installing', progress: running.progress };
		}

		if (game !== null && !isEmulablePlatform(game.platform)) {
			return { kind: 'unsupported' };
		}
		if (manifest === null) {
			return { kind: 'not-installed', sizeBytes: game?.sizeBytes ?? 0 };
		}

		const entry = manifest.roms[String(romId)];
		if (entry === undefined || entry.files.length === 0) {
			return { kind: 'not-installed', sizeBytes: game?.sizeBytes ?? 0 };
		}
		if (entry.outdated) return { kind: 'stale' };
		return { kind: 'ready' };
	}

	// ── the actions ─────────────────────────────────────────────────────

	/** Install a game's files. Returns a status line for the UI. */
	async install(game: RommGame): Promise<string> {
		const { client, manifest } = this.#context();
		if (client === null || manifest === null) {
			return 'play needs a RomM server (demo mode has none)';
		}
		this.#games.set(game.id, game);
		const result = await installGame(client, game, manifest);
		if (result.error !== '') return result.error;
		if (result.queued === 0 && result.skipped > 0) {
			this.#recompute(game.id);
			return 'already installed';
		}
		this.#recompute(game.id);
		return `queued ${result.queued} file${result.queued === 1 ? '' : 's'} (${result.skipped} up to date)`;
	}

	/**
	 * Play a game: core + BIOS + emulator in place, saves snapshotted into
	 * the pending-session marker, RetroArch launched (the process leaves).
	 * Returns '' on success, or a human error.
	 */
	async play(game: RommGame): Promise<string> {
		const { client, manifest } = this.#context();
		if (client === null || manifest === null) {
			return 'play needs a RomM server (demo mode has none)';
		}
		this.#games.set(game.id, game);

		const entry = manifest.roms[String(game.id)];
		if (entry === undefined || entry.playPath === '') {
			return 'install the rom first';
		}

		const tooling = await this.#toolingFiles(client);
		const ready = await ensureReadyFor(
			client,
			manifest,
			game.platform,
			game.platformId,
			tooling,
			this.#choiceFor(game.platform),
		);
		if (!ready.ok) return ready.error;

		const core = manifest.cores[platformSlug(game.platform)];
		if (core === undefined) return 'no core installed for this platform';

		const saves = (await localSaveFiles(manifest)).filter((f) => f.romId === game.id);
		await writePendingSession(
			game.id,
			saves.map((f) => ({ path: f.path, size: f.size, mtime: f.mtime, hash: f.hash })),
		);

		const result = launchRetroArch(PATHS.loader, core.path, entry.playPath);
		if (!result.ok) return result.error ?? 'launch failed';
		return '';
	}

	/** Sync one game's saves — or everything when `game` is null. */
	async sync(game: RommGame | null): Promise<string> {
		const { client, manifest } = this.#context();
		if (client === null || manifest === null) {
			return 'sync needs a RomM server (demo mode has none)';
		}
		if (game !== null) this.#games.set(game.id, game);
		const report = await runSaveSync(client, manifest, {
			romIds: game !== null ? [game.id] : undefined,
		});
		this.lastReport = report;
		this.#recomputeAll();
		if (report.error !== '') return report.error;
		const bits: string[] = [];
		if (report.uploaded > 0) bits.push(`↑ ${report.uploaded}`);
		if (report.downloaded > 0) bits.push(`↓ ${report.downloaded}`);
		if (report.states > 0) bits.push(`${report.states} states`);
		if (report.conflicts > 0) bits.push(`${report.conflicts} conflicts`);
		return bits.length > 0 ? `synced: ${bits.join(' · ')}` : 'everything up to date';
	}

	/** Uninstall a game's files (saves are kept — they belong to the server). */
	async uninstall(game: RommGame): Promise<string> {
		const { manifest } = this.#context();
		if (manifest === null) return 'nothing installed (demo mode)';
		await uninstallGame(manifest, game);
		this.#recompute(game.id);
		return 'uninstalled';
	}

	/**
	 * The boot hook (once per session, after a successful connect): ingest
	 * a pending play session, then run the auto sync.
	 */
	async bootSync(): Promise<void> {
		if (this.#bootSyncDone) return;
		this.#bootSyncDone = true;
		const { client, manifest } = this.#context();
		if (client === null || manifest === null) return;
		if (this.#config?.autoSync === false) return;

		const marker = await readPendingSession();
		if (marker !== null) {
			setActivity('sync', 'Closing last play session…');
			await ingestPendingSession(client, manifest);
		}
		await runSaveSync(client, manifest);
	}

	/**
	 * The setup/doctor check: one row per prerequisite, with a note on
	 * what to do when it is not met.
	 *
	 * @param platforms the library's platforms (name + server id).
	 */
	async doctor(platforms: Array<{ name: string; id: number }>): Promise<DoctorReport> {
		const { client } = this.#context();
		const rows: DoctorRow[] = [];

		if (client === null) {
			return {
				rows: [
					{
						label: 'RomM server',
						ok: false,
						note: 'demo mode — connect a server to use play',
					},
				],
				needsWork: true,
			};
		}

		// 1. The sync routes (device registration is the gatekeeper).
		const devices = await getDevices(client);
		rows.push(
			devices !== null
				? { label: 'Save sync (5.x routes)', ok: true, note: '' }
				: {
						label: 'Save sync (5.x routes)',
						ok: false,
						note: 'this server predates sync — saves will not be saved',
					},
		);

		// 2. The tooling platform + loader.
		const platform = await findToolingPlatform(client);
		const files = platform === null ? [] : await listToolingFiles(client, platform.id);
		this.#toolingClient = client;
		this.#toolingCache = files;

		rows.push(
			platform === null
				? {
						label: 'RetroArch platform',
						ok: false,
						note: 'create a "RetroArch" platform in the RomM web UI',
					}
				: { label: 'RetroArch platform', ok: true, note: '' },
		);

		const loader = files.find((f) => /retroarch/i.test(f.fileName) && /\.(zip|nro)$/i.test(f.fileName));
		rows.push(
			loader === undefined
				? {
						label: 'RetroArch loader',
						ok: false,
						note: 'upload the RetroArch NRO (or a zip of switch/) to it',
					}
				: { label: 'RetroArch loader', ok: true, note: loader.fileName },
		);

		// 3. One core row per emulable platform the library actually has.
		const seen = new Set<string>();
		for (const p of platforms) {
			const entry = coreEntryFor(p.name);
			if (entry === null || seen.has(entry.display)) continue;
			seen.add(entry.display);
			const choice = this.#choiceFor(p.name);
			const onServer = files.some((f) => choiceMatches(choice, f.fileName));
			const installed =
				this.#manifest?.cores[platformSlug(p.name)] !== undefined;
			rows.push(
				onServer || installed
					? { label: `Core: ${entry.display}`, ok: true, note: choice.label }
					: {
							label: `Core: ${entry.display}`,
							ok: false,
							note: `upload the ${choice.label} core NRO to the RetroArch platform`,
						},
			);
			// 4. BIOS for the platforms that need one.
			if (entry.bios.length > 0 && p.id > 0) {
				const fw = await getFirmware(client, p.id);
				const have = fw !== null && fw.length > 0;
				const biosOk =
					have && Object.keys(this.#manifest?.bios ?? {}).length > 0;
				rows.push(
					have
						? { label: `BIOS: ${entry.display}`, ok: biosOk, note: biosOk ? '' : 'downloads on first play' }
						: {
								label: `BIOS: ${entry.display}`,
								ok: false,
								note: `upload a BIOS (e.g. ${entry.bios[0]}) in RomM's firmware section`,
							},
				);
			}
		}

		// 5. SD free space (informational; a warning, not a blocker).
		const free = sdFreeSpace();
		rows.push(
			free === null
				? { label: 'SD free space', ok: true, note: 'unknown (browser preview)' }
				: {
						label: 'SD free space',
						ok: free > 512 * 1024 * 1024,
						note: `${(free / 1024 / 1024 / 1024).toFixed(1)} GB free`,
					},
		);

		return { rows, needsWork: rows.some((r) => !r.ok) };
	}

	/**
	 * Download everything the doctor found missing: the loader, every core
	 * the installed games need, and the BIOS for the platforms that use one.
	 * The queue streams the rest; the doctor screen reports the outcome.
	 */
	async fix(): Promise<string> {
		const { client } = this.#context();
		const manifest = this.#manifest;
		if (client === null || manifest === null) return 'nothing to fix (no server)';

		const emulator = await ensureEmulator(client, manifest);
		if (!emulator.ok) return emulator.error;

		const tooling = await this.#toolingFiles(client);
		const wanted = new Map<string, RommGame>();
		for (const game of this.#games.values()) {
			const slug = platformSlug(game.platform);
			if (!wanted.has(slug)) wanted.set(slug, game);
		}
		let fixed = 0;
		let skipped = 0;
		for (const game of wanted.values()) {
			const entry = coreEntryFor(game.platform);
			if (entry === null) continue;
			const choice = this.#choiceFor(game.platform);
			const result = await ensureCore(
				client,
				manifest,
				game.platform,
				choice,
				tooling,
			);
			if (result.ok) fixed += 1;
			else skipped += 1; // a core the server does not have is reported, not fatal
		}
		return skipped > 0
			? `fetched ${fixed} piece${fixed === 1 ? '' : 's'} — ${skipped} missing on the server`
			: fixed > 0
			  ? `fetched ${fixed} piece${fixed === 1 ? '' : 's'}`
			  : 'everything already in place';
	}

	// ── internals ─────────────────────────────────────────────────────────

	#context(): { client: RommClient | null; manifest: Manifest | null } {
		return { client: this.#client, manifest: this.#manifest };
	}

	async #toolingFiles(client: RommClient): Promise<ToolingFile[]> {
		if (this.#toolingCache !== null && client === this.#toolingClient) {
			return this.#toolingCache;
		}
		const platform = await findToolingPlatform(client);
		const files = platform === null ? [] : await listToolingFiles(client, platform.id);
		this.#toolingClient = client;
		this.#toolingCache = files;
		return files;
	}

	#choiceFor(platformName: string): CoreChoice {
		const entry = coreEntryFor(platformName);
		if (entry === null) {
			return { id: 'none', label: platformName, match: /$^/ };
		}
		return chosenChoice(entry, this.#config?.coreChoices ?? {});
	}
}

/** The external-store plumbing (module-level, React-free). */
const storeListeners = new Set<() => void>();
let storeVersion = 0;
function notify(): void {
	storeVersion += 1;
	for (const listener of storeListeners) listener();
}

/** Does a file name match a core choice? (re-export of the core-map rule) */
function choiceMatches(choice: CoreChoice, fileName: string): boolean {
	return choice.match.test(fileName);
}

/** The process-wide service. */
export const play = new PlayService();

/**
 * The React binding: a game's play state, subscribed to the store.
 * `stateFor` returns a stable object reference until the state actually
 * changes, which is what `useSyncExternalStore` requires.
 */
export function usePlayState(romId: number): PlayState {
	return useSyncExternalStore(
		play.subscribe,
		() => play.stateFor(romId),
		() => play.stateFor(romId),
	);
}
