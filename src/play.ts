/**
 * The Play service: the single object the UI talks to for everything the
 * detail screen's action rows do (install / play / sync / uninstall) and
 * for the boot-time work (pending-session ingest, auto sync).
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
	ensureReadyFor,
	findToolingPlatform,
	listToolingFiles,
	scanExistingInstall,
	type ToolingFile,
} from './retroarch/emulator';
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
import type { RommClient, RommGame, RomRAchievement, RomRATag } from './romm';
import { buildRaGameView, type RaGameView } from './ra';
import { exists } from './fs';

/** The UI-facing state of one game's Play capability. */
export type PlayState =
	| { kind: 'demo' }
	| { kind: 'unsupported' }
	| { kind: 'not-installed'; sizeBytes: number }
	| { kind: 'installing'; progress: number }
	| { kind: 'verifying'; progress: number }
	| { kind: 'ready' }
	| { kind: 'stale' };

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
	/**
	 * The user's RA identity + progression (from RomM), cached per bind.
	 * Null = not fetched yet, or the user has no linked RA account.
	 */
	#raTag: RomRATag | null = null;
	/** Per-game published achievement sets, cached by rom id. */
	#raCache = new Map<number, RomRAchievement[]>();

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
		this.#raTag = null;
		this.#raCache.clear();
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
			(prev.kind === 'verifying' && next.kind === 'verifying' && prev.progress !== next.progress) ||
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
				(prev.kind === 'installing' && next.kind === 'installing' && prev.progress !== next.progress) ||
				(prev.kind === 'verifying' && next.kind === 'verifying' && prev.progress !== next.progress)
			) {
				this.#states.set(romId, next);
			}
		}
		notify();
	}

	/** Derive the state (without caching). */
	#derive(romId: number): PlayState {
		const manifest = this.#manifest;

		// No server client bound: if the ROM is installed locally we can
		// still play it offline. Derive from the manifest instead of
		// showing "demo mode" for every game.
		if (this.#client === null && manifest !== null) {
			const entry = manifest.roms[String(romId)];
			if (entry !== undefined && entry.files.length > 0) {
				if (entry.outdated) return { kind: 'stale' };
				return { kind: 'ready' };
			}
			return { kind: 'not-installed', sizeBytes: 0 };
		}

		if (this.#client === null) return { kind: 'demo' };
		const game = this.#games.get(romId) ?? null;

		// A download in flight for this rom wins the display. While the
		// finished part is being hashed the phase is "verifying"; once the
		// hash matches the part is committed and the game flips to "ready".
		const running = downloadQueue
			.getItems()
			.find((v) => v.id.startsWith(`rom:${romId}:`) && (v.status === 'running' || v.status === 'queued'));
		if (running !== undefined) {
			if (running.phase === 'verifying') {
				return { kind: 'verifying', progress: running.verifyProgress };
			}
			return { kind: 'installing', progress: running.progress };
		}

		// A failed transfer (hash mismatch, unreadable part, …) takes
		// priority over the manifest state: don't show "Outdated on server"
		// when the real problem is a verification error.
		const errored = downloadQueue.getItems().find((v) => v.id.startsWith(`rom:${romId}:`) && v.status === 'error');
		if (errored !== undefined) {
			return { kind: 'not-installed', sizeBytes: game?.sizeBytes ?? 0 };
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
		let { client, manifest } = this.#context();
		if (manifest === null) {
			manifest = await loadManifest();
			this.#manifest = manifest;
		}
		this.#games.set(game.id, game);

		const entry = manifest.roms[String(game.id)];
		if (entry === undefined || entry.playPath === '') {
			return 'install the rom first';
		}

		// No server client: populate the manifest from what is already on
		// the SD card (loader, icon, cores) so offline play works without
		// ever contacting the server or the buildbot.
		if (client === null) await scanExistingInstall(manifest);

		// Provision the core and emulator from whatever source is available:
		// buildbot (direct HTTPS, no server needed) first, then the server's
		// tooling platform as fallback. Works offline — the buildbot is a
		// direct web source, not a server endpoint.
		const tooling = client !== null ? await this.#toolingFiles(client) : [];
		const choice = this.#choiceFor(game.platform);
		const ready = await ensureReadyFor(
			client,
			manifest,
			game.platform,
			game.platformId,
			tooling,
			choice,
			this.#config,
		);
		if (!ready.ok) return ready.error;

		const core = manifest.cores[platformSlug(game.platform)];
		if (core === undefined) return 'no core installed for this platform';

		const saves = (await localSaveFiles(manifest)).filter((f) => f.romId === game.id);
		await writePendingSession(
			game.id,
			saves.map((f) => ({ path: f.path, size: f.size, mtime: f.mtime, hash: f.hash })),
		);

		const result = launchRetroArch(PATHS.loader, core.path, entry.playPath, this.#config);
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
		if (report.uploaded > 0) bits.push(`${report.uploaded} up`);
		if (report.downloaded > 0) bits.push(`${report.downloaded} down`);
		if (report.states > 0) bits.push(`${report.states} states`);
		if (report.conflicts > 0) bits.push(`${report.conflicts} conflicts`);
		return bits.length > 0 ? `synced: ${bits.join(' · ')}` : 'everything up to date';
	}

	/**
	 * The user's RA identity + progression (from RomM, cached per bind).
	 * Null in demo mode, or when the user has not linked an RA account in
	 * RomM (a pre-5.x server has no RA routes either).
	 */
	async raTag(): Promise<RomRATag | null> {
		const { client } = this.#context();
		if (client === null) return null;
		if (this.#raTag !== null) return this.#raTag;
		this.#raTag = await client.getRaTag();
		return this.#raTag;
	}

	/**
	 * Re-pull the user's RA progress from RetroAchievements (best-effort).
	 * The achievements screen calls this first, so progress earned inside
	 * RetroArch shows up rather than a stale RomM snapshot.
	 */
	async refreshRa(): Promise<void> {
		const { client } = this.#context();
		if (client === null) return;
		const tag = await this.raTag();
		if (tag === null || tag.userId <= 0) return;
		this.#raTag = null;
		await client.refreshRa(tag.userId);
		this.#raTag = await client.getRaTag();
	}

	/**
	 * The composed RA view for one game (the badge + achievements screen
	 * render from it). Reads the published set on demand and joins the user's
	 * progress by RA id. Returns null in demo mode or when the rom is not
	 * matched to an RA game (nothing to show).
	 */
	async raGameView(game: RommGame): Promise<RaGameView | null> {
		const { client } = this.#context();
		if (client === null) return null;
		// Fetch the achievement set regardless of `raId`: some servers
		// don't include `ra_id` in the rom entry, so a game can have RA
		// achievements even when `raId` is 0. `buildRaGameView` derives
		// `official` from the set itself, not from `raId`.

		let set = this.#raCache.get(game.id);
		if (set === undefined) {
			const fetched = await client.getGameRaAchievements(game.id);
			if (fetched === null) return null; // a hard fetch failure: show nothing
			set = fetched;
			this.#raCache.set(game.id, set);
		}
		const tag = await this.raTag();
		const progression =
			tag?.progression?.results.find((r) => r.romRaId === game.raId) ?? null;
		return buildRaGameView(game.raId, set, progression);
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
