/**
 * The save sync: the round trip that keeps this console and the server
 * holding the same progress.
 *
 *   inventory the local saves ─┐
 *                              ├─► POST /api/sync/negotiate
 *   the server's saves (list) ─┘         │
 *                                         ▼
 *                     operations: upload · download · conflict · delete · no_op
 *                                         │
 *                              execute each, then complete the session
 *
 * The negotiate scope is every installed rom, not only the ones that hold
 * a local save: the console never deletes saves on its own, so a save the
 * server holds for an installed rom that this console lacks is a download
 * (`restore_unlisted`), and a save made elsewhere (mGBA on a PC, say) is
 * how a user carries progress to the console at all.
 *
 * On top of the negotiated saves, save states are reconciled separately
 * (the server's states route has no slot concept): the local `Foo.state`
 * against the server's newest state for the rom, newest wins by mtime.
 *
 * Conflicts (both sides changed) never lose data silently: an
 * `onConflict` callback decides (keep mine / take theirs / skip) when the
 * caller can ask; the unattended boot path takes the safe default —
 * skip, and report it so the user sees it happened.
 */
import { setActivity } from '../activity';
import {
	confirmSaveDownloaded,
	getStates,
	getSaves,
	heartbeat,
	ingestPlaySessions,
	completeSyncSession,
	negotiateSync,
	uploadSave,
	uploadState,
	type RommSave,
	type SyncOperation,
} from '../romm/play';
import type { RommClient } from '../romm';
import { saveManifest, type Manifest } from '../manifest';
import { ensureDevice } from './device';
import { localSaveFiles, type LocalSaveFile } from './inventory';
import { baseNameOf, platformSlug, PATHS } from '../retroarch/layout';
import { emulatorNameForCoreFile } from '../retroarch/cores';
import {
	appendBinary,
	exists,
	fileMtime,
	fileSize,
	move,
	readBinary,
	readText,
	remove,
	writeText,
} from '../fs';
import { log } from '../log';

/** What one sync run did (for the report + the status line). */
export interface SyncReport {
	uploaded: number;
	downloaded: number;
	deleted: number;
	conflicts: number;
	noOps: number;
	states: number;
	/** Human error ('' when the sync ran — or had nothing to do). */
	error: string;
}

/** A conflict the caller may resolve interactively. */
export interface SyncConflict {
	romId: number;
	fileName: string;
	slot: string | null;
	/** The server's version (for "take theirs"). */
	save: RommSave | null;
	/** The local file the "keep mine" side would upload. */
	localPath: string;
}

export type ConflictResolution = 'keep' | 'take' | 'skip';

export interface SyncOptions {
	signal?: AbortSignal;
	/** Scope the sync to these roms (a per-game sync); all when absent. */
	romIds?: number[];
	/**
	 * How a conflict is resolved. Absent = the unattended default: skip
	 * (both copies stay put, the conflict is only counted + reported).
	 */
	onConflict?: (conflict: SyncConflict) => Promise<ConflictResolution>;
}

/** The pending-session marker (see the module comment in `launch.ts`). */
export interface PendingSession {
	/** The rom that was launched; 0 when it could not be determined. */
	romId: number;
	/** ISO timestamp the play session started. */
	start: string;
	/** The save files' state at launch (for the change detection). */
	saves: Array<{ path: string; size: number; mtime: number; hash: string }>;
}

/** Read the pending-session marker, or null when there is none. */
export async function readPendingSession(): Promise<PendingSession | null> {
	const text = await readText(PATHS.pendingSession);
	if (text === null) return null;
	try {
		const raw = JSON.parse(text) as Partial<PendingSession>;
		if (typeof raw.romId !== 'number' || typeof raw.start !== 'string') return null;
		return {
			romId: raw.romId,
			start: raw.start,
			saves: Array.isArray(raw.saves) ? raw.saves : [],
		};
	} catch {
		return null;
	}
}

/** Write the pending-session marker (the app's last act before it leaves). */
export async function writePendingSession(
	romId: number,
	saves: Array<{ path: string; size: number; mtime: number; hash: string }>,
): Promise<void> {
	const marker: PendingSession = { romId, start: new Date().toISOString(), saves };
	await writeText(PATHS.pendingSession, JSON.stringify(marker, null, 1));
}

/** Remove the pending-session marker (it has been ingested). */
export async function clearPendingSession(): Promise<void> {
	await remove(PATHS.pendingSession);
}

/**
 * The boot hook: if a play session is pending (RetroArch was launched,
 * the user came home, the app re-opened), ingest it into the server's
 * play history and heartbeats.
 *
 * @returns true when a session was ingested — the caller should then run
 *          a save sync (the user may have saved during the session).
 */
export async function ingestPendingSession(
	client: RommClient,
	manifest: Manifest,
	signal?: AbortSignal,
): Promise<boolean> {
	const marker = await readPendingSession();
	if (marker === null) return false;

	const end = new Date().toISOString();
	const durationMs = Math.max(0, Date.parse(end) - Date.parse(marker.start));

	if (marker.romId > 0) {
		await ingestPlaySessions(
			client,
			{
				deviceId: manifest.deviceId,
				sessions: [
					{
						romId: marker.romId,
						saveSlot: null,
						startTime: marker.start,
						endTime: end,
						durationMs,
					},
				],
			},
			signal,
		);
		if (manifest.deviceId !== null) {
			await heartbeat(client, { romId: marker.romId, deviceId: manifest.deviceId }, signal);
		}
	}
	await clearPendingSession();
	log('play-session', `ingested (${marker.romId}, ${Math.round(durationMs / 1000)}s)`);
	return true;
}

/**
 * Run the full sync.
 *
 * @returns the report — `error` non-empty when the sync could not run at
 *          all (no device route, negotiate failed); partial failures
 *          inside the operation loop are counted, not fatal.
 */
export async function runSaveSync(
	client: RommClient,
	manifest: Manifest,
	options: SyncOptions = {},
): Promise<SyncReport> {
	const signal = options.signal;
	const report: SyncReport = {
		uploaded: 0,
		downloaded: 0,
		deleted: 0,
		conflicts: 0,
		noOps: 0,
		states: 0,
		error: '',
	};
	const activity = (label: string | null) => setActivity('sync', label);

	// ── identity ──────────────────────────────────────────────────────────
	activity('Syncing saves…');
	const deviceId = await ensureDevice(client, manifest, signal);
	if (signal?.aborted) return report;

	// ── inventory ─────────────────────────────────────────────────────────
	const files = await localSaveFiles(manifest);
	const scope = options.romIds;
	const saves = files.filter(
		(f) =>
			!f.isState &&
			f.romId > 0 &&
			(scope === undefined || scope.includes(f.romId)),
	);
	const states = files.filter(
		(f) => f.isState && f.romId > 0 && (scope === undefined || scope.includes(f.romId)),
	);

	// The negotiate scope (see the module comment): the local saves' roms,
	// plus every installed rom — a server save for an installed rom that
	// this console lacks is a download, not nothing. A per-game sync
	// (options.romIds) keeps its scope on the requested roms only.
	const localRomIds = [...new Set([...saves, ...states].map((f) => f.romId))];
	const installedRomIds = [...new Set(Object.values(manifest.roms).map((r) => r.romId))];
	const romIds = [
		...new Set(
			scope === undefined
				? [...localRomIds, ...installedRomIds]
				: [...localRomIds, ...installedRomIds.filter((id) => scope.includes(id))],
		),
	].slice(0, 500); // the server's per-request cap
	const statesRomIds = [...new Set(states.map((s) => s.romId))];

	if (romIds.length === 0) {
		// Nothing installed, nothing local: a valid, honest "up to date".
		activity(null);
		return report;
	}

	// ── negotiate ─────────────────────────────────────────────────────────
	if (deviceId === null) {
		// The saves route may still exist on a server without devices:
		// fall back to a plain list comparison below (upload-only sync).
		report.error = 'this server has no device registration — sync is limited';
	}

	const negotiated =
		deviceId !== null
			? await negotiateSync(
					client,
					{
						deviceId,
						saves: saves.map((f) => ({
							romId: f.romId,
							fileName: f.fileName,
							slot: f.slot,
							emulator: emulatorFor(manifest, f.romId),
							contentHash: f.hash === '' ? null : f.hash,
							updatedAt: f.mtime > 0 ? new Date(f.mtime).toISOString() : '',
							sizeBytes: f.size,
						})),
						romIds,
						// RetroArch loads any core's save format, so the
						// server must not filter offers to one emulator —
						// a save another emulator wrote in the same slot is
						// exactly the one a user wants carried over.
						emulators: null,
						// The console never deletes saves on its own (its
						// storage is wiped by nothing), so an unlisted save
						// is missing, not deleted: offer it back.
						restoreUnlisted: true,
					},
					signal,
				)
			: null;

	if (deviceId === null || negotiated === null) {
		if (deviceId === null && negotiated === null) {
			// Pre-5.x server: no sync at all.
			if (report.error === '') {
				report.error = 'this server predates save sync';
			}
			activity(null);
			return report;
		}
		// A device exists but negotiate failed: fall through to a plain
		// list-diff upload-only sync rather than losing the user's saves.
		report.error = report.error !== '' ? report.error : 'sync negotiation failed — uploads only';
	}

	// ── execute the negotiated operations ─────────────────────────────────
	const localBySlot = new Map<string, LocalSaveFile>();
	for (const f of saves) {
		localBySlot.set(`${f.romId}:${f.slot}`, f);
	}

	const execute = async (op: SyncOperation) => {
		const local = localBySlot.get(`${op.romId}:${op.slot}`);

		switch (op.action) {
			case 'no_op': {
				report.noOps += 1;
				if (local !== undefined) snapshotFile(manifest, local);
				return;
			}

			case 'upload': {
				if (local === undefined) return;
				const bytes = await readBinary(local.path);
				if (bytes === null) return;
				const ok = await uploadSave(
					client,
					{
						romId: op.romId,
						fileName: local.fileName,
						bytes,
						slot: op.slot,
						emulator: emulatorFor(manifest, op.romId),
						contentHash: local.hash === '' ? null : local.hash,
						deviceId,
						sessionId: negotiated?.sessionId ?? null,
					},
					signal,
				);
				if (ok !== null) {
					report.uploaded += 1;
					snapshotFile(manifest, local);
				}
				return;
			}

			case 'download': {
				if (op.saveId === null || op.fileName === '') return;
				const dest = local?.path ?? downloadDest(manifest, op);
				const ok = await downloadSave(client, op.saveId, dest, signal);
				if (ok) {
					report.downloaded += 1;
					if (deviceId !== null) {
						await confirmSaveDownloaded(client, op.saveId, deviceId, op.contentHash, signal);
					}
					if (local !== undefined) {
						snapshotFile(manifest, local);
					} else {
						// No local file paired with this slot: remember the
						// server's copy anyway, so the next inventory pass
						// does not treat the restored file as changed and
						// rehash it from scratch.
						manifest.saveSnapshot[dest] = {
							hash: op.contentHash ?? '',
							size: await fileSize(dest),
							mtime: await fileMtime(dest),
						};
					}
				}
				return;
			}

			case 'delete': {
				if (local === undefined) return;
				await remove(local.path);
				delete manifest.saveSnapshot[local.path];
				report.deleted += 1;
				return;
			}

			case 'conflict': {
				report.conflicts += 1;
				const save = await findServerSave(client, op, signal);
				const resolution =
					options.onConflict !== undefined && local !== undefined
						? await options.onConflict({
								romId: op.romId,
								fileName: local.fileName,
								slot: op.slot,
								save,
								localPath: local.path,
							})
						: 'skip';
				if (resolution === 'skip') return;
				if (resolution === 'keep' && local !== undefined) {
					const bytes = await readBinary(local.path);
					if (bytes !== null) {
						const ok = await uploadSave(
							client,
							{
								romId: op.romId,
								fileName: local.fileName,
								bytes,
								slot: op.slot,
								emulator: emulatorFor(manifest, op.romId),
								contentHash: local.hash === '' ? null : local.hash,
								deviceId,
								sessionId: negotiated?.sessionId ?? null,
								overwrite: true,
							},
							signal,
						);
						if (ok !== null) {
							report.uploaded += 1;
							snapshotFile(manifest, local);
						}
					}
					return;
				}
				// take
				if (op.saveId !== null && op.fileName !== '') {
					const dest = local?.path ?? downloadDest(manifest, op);
					if (await downloadSave(client, op.saveId, dest, signal)) {
						report.downloaded += 1;
						if (local !== undefined) {
							snapshotFile(manifest, local);
						} else {
							manifest.saveSnapshot[dest] = {
								hash: op.contentHash ?? '',
								size: await fileSize(dest),
								mtime: await fileMtime(dest),
							};
						}
					}
				}
				return;
			}
		}
	};

	if (negotiated !== null) {
		for (const op of negotiated.operations) {
			if (signal?.aborted) break;
			await execute(op);
		}
		await completeSyncSession(client, negotiated.sessionId, signal);
	} else if (deviceId === null) {
		// Upload-only fallback (pre-5.x): push whatever changed.
		for (const f of saves) {
			if (signal?.aborted) break;
			if (!f.changed && f.hash !== '') continue;
			const bytes = await readBinary(f.path);
			if (bytes === null) continue;
			const ok = await uploadSave(
				client,
				{
					romId: f.romId,
					fileName: f.fileName,
					bytes,
					slot: f.slot,
					emulator: emulatorFor(manifest, f.romId),
					contentHash: f.hash === '' ? null : f.hash,
					deviceId: null,
				},
				signal,
			);
			if (ok !== null) {
				report.uploaded += 1;
				snapshotFile(manifest, f);
			}
		}
	}

	// ── save states (newest-wins per rom) ─────────────────────────────────
	if (statesRomIds.length > 0 && !signal?.aborted) {
		const serverStates = await getStates(client, statesRomIds, signal);
		if (serverStates !== null) {
			for (const local of states) {
				if (signal?.aborted) break;
				const remote = serverStates.find(
					(s) => s.romId === local.romId && baseEq(s.fileName, local.baseName),
				);
				const localHash = local.hash === '' ? (await hashOf(local)) : local.hash;
				const remoteHash = remote?.contentHash ?? null;

				if (remote === undefined || localHash === '') {
					// Only locally (or unhashable): push it.
					const bytes = await readBinary(local.path);
					if (bytes === null) continue;
					const ok = await uploadState(
						client,
						{
							romId: local.romId,
							fileName: local.fileName,
							bytes,
							emulator: emulatorFor(manifest, local.romId),
							contentHash: localHash,
							overwrite: true,
						},
						signal,
					);
					if (ok !== null) {
						report.states += 1;
						snapshotFile(manifest, local);
					}
					continue;
				}
				if (remoteHash !== null && localHash === remoteHash) {
					snapshotFile(manifest, local);
					continue;
				}
				// Both differ: newest wins by mtime.
				const remoteMtime = Date.parse(remote.updatedAt);
				const localIsNewer =
					local.mtime > 0 &&
					(!Number.isFinite(remoteMtime) || local.mtime >= remoteMtime);
				if (localIsNewer) {
					const bytes = await readBinary(local.path);
					if (bytes !== null) {
						const ok = await uploadState(
							client,
							{
								romId: local.romId,
								fileName: local.fileName,
								bytes,
								emulator: emulatorFor(manifest, local.romId),
								contentHash: localHash,
								overwrite: true,
							},
							signal,
						);
						if (ok !== null) {
							report.states += 1;
							snapshotFile(manifest, local);
						}
					}
				} else {
					const ok = await downloadState(client, remote, `${PATHS.statesDir}/${local.fileName}`, signal);
					if (ok) {
						report.states += 1;
						snapshotFile(manifest, local);
					}
				}
			}
		}
	}

	// ── record the snapshot + finish ──────────────────────────────────────
	await saveManifest(manifest);
	activity(null);
	log(
		'sync',
		`done — ↑${report.uploaded} ↓${report.downloaded} ✕${report.deleted} !${report.conflicts} =${report.noOps} states:${report.states}${report.error ? ` (${report.error})` : ''}`,
	);
	return report;
}

/**
 * Where a downloaded save lands when no local file pairs with the slot.
 *
 * The server names its files with timestamps (`Foo [2026-09-25 …].srm`),
 * which would never join back to the installed rom by base name — and an
 * unjoinable file is re-offered as a download on every sync. Naming it
 * after the rom instead is also the name RetroArch will write to itself,
 * so a later in-game save updates the very same file.
 */
function downloadDest(manifest: Manifest, op: { romId: number; fileName: string }): string {
	const rom = manifest.roms[String(op.romId)];
	const dot = op.fileName.lastIndexOf('.');
	const ext = dot > 0 ? op.fileName.slice(dot) : '.sav';
	if (rom !== undefined && rom.playPath !== '') {
		return `${PATHS.savesDir}/${baseNameOf(rom.playPath)}${ext}`;
	}
	return `${PATHS.savesDir}/${op.fileName}`;
}

/**
 * The emulator name to record on a save of `romId`: the placed core of
 * that rom's platform (the mgba core *is* mGBA, so a save the user made
 * elsewhere with the stand-alone emulator keeps pairing on the server),
 * or `retroarch` when the rom or its core is unknown.
 */
function emulatorFor(manifest: Manifest, romId: number): string {
	const rom = manifest.roms[String(romId)];
	if (rom === undefined || rom.platform === '') return 'retroarch';
	const core = manifest.cores[platformSlug(rom.platform)];
	if (core === undefined || core.path === '') return 'retroarch';
	const file = core.path.split('/').pop();
	return file === undefined || file === '' ? 'retroarch' : emulatorNameForCoreFile(file);
}

/** Record a file's current state in the manifest snapshot. */
function snapshotFile(manifest: Manifest, file: LocalSaveFile): void {
	const size = file.size;
	manifest.saveSnapshot[file.path] = {
		hash: file.hash,
		size,
		mtime: file.mtime,
	};
}

/** Re-hash a file whose snapshot hash was missing (computed lazily). */
async function hashOf(file: LocalSaveFile): Promise<string> {
	if (file.hash !== '') return file.hash;
	const { md5File } = await import('../hash');
	return (await md5File(file.path)) ?? '';
}

/** Compare two file names by base name, case-insensitively. */
function baseEq(fileName: string, baseName: string): boolean {
	const i = fileName.lastIndexOf('.');
	const base = i > 0 ? fileName.slice(0, i) : fileName;
	return base.toLowerCase().replace(/\.(\d{1,3})$/, '') === baseName.toLowerCase();
}

/**
 * Stream one save's bytes from the server to `dest` (via `.part`),
 * without the download queue — saves are small, and this path needs the
 * slot-aware placement the queue does not track. Exported so the sync
 * tests (and the doctor) can drive it directly.
 */
export async function downloadSave(
	client: RommClient,
	saveId: number,
	dest: string,
	signal?: AbortSignal,
): Promise<boolean> {
	const part = dest + '.part';
	try {
		const res = await client.request(`/api/saves/${saveId}/content`, {}, signal);
		if (!res.ok) return false;
		const body = res.body;
		if (body === null) return false;
		const reader = body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value !== undefined) await appendBinary(part, value);
		}
		if (await exists(dest)) await remove(dest);
		await move(part, dest);
		return true;
	} catch (err) {
		log('error', `save download ${saveId}: ${err instanceof Error ? err.message : String(err)}`);
		await remove(part);
		return false;
	}
}

/** The states variant of `downloadSave`. */
async function downloadState(
	client: RommClient,
	state: { id: number },
	dest: string,
	signal?: AbortSignal,
): Promise<boolean> {
	const part = dest + '.part';
	try {
		const res = await client.request(`/api/states/${state.id}/content`, {}, signal);
		if (!res.ok) return false;
		const body = res.body;
		if (body === null) return false;
		const reader = body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value !== undefined) await appendBinary(part, value);
		}
		if (await exists(dest)) await remove(dest);
		await move(part, dest);
		return true;
	} catch {
		await remove(part);
		return false;
	}
}

/** Look up a server save for a conflict op (for the "take theirs" side). */
async function findServerSave(
	client: RommClient,
	op: SyncOperation,
	signal?: AbortSignal,
): Promise<RommSave | null> {
	if (op.saveId === null) return null;
	const saves = await getSaves(client, [op.romId], signal);
	if (saves === null) return null;
	return saves.find((s) => s.id === op.saveId) ?? null;
}
