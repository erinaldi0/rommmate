/**
 * The RomM "Play" API surface: the routes v13 adds on top of the browsing
 * client.
 *
 *   firmware      BIOS files, per platform, with their content
 *   saves         persistent save files (SRAM / memory cards)
 *   states        save states (the "save point" snapshots)
 *   devices       this console, registered once and reused
 *   sync          the negotiate → upload/download/delete round trip
 *   play-sessions  start/end times that feed the "Continue playing" row
 *
 * Every route is a RomM 5.x addition. The whole module treats a 404 as
 * "the server predates this" and returns an empty result with an error
 * note, so a pre-5.x instance simply hides the feature instead of failing
 * a request. (The same discipline the client already applies to
 * collections and platforms.)
 *
 * All the heavy lifting (token, 401 refresh, URL normalisation) lives in
 * `RommClient`; these functions only know the route shapes.
 */
import type { RommClient } from './client';
import { log } from '../log';

// ── shapes the app works with ───────────────────────────────────────────────

/** One BIOS file the server has for a platform. */
export interface RommFirmware {
	id: number;
	platformId: number;
	/** The file name, e.g. `scph1001.bin`. */
	fileName: string;
	extension: string;
	sizeBytes: number;
	/** The server's SHA1 — the 5.x firmware fingerprint (staleness). */
	hash: string;
	/**
	 * The server's MD5, or '' when the schema has none. Only an MD5 can
	 * verify a downloaded file (our hash helper computes MD5).
	 */
	md5Hash: string;
	/** True when the server reports the file absent from its own disk. */
	missingFromFs: boolean;
}

/** One persistent save file on the server. */
export interface RommSave {
	id: number;
	romId: number;
	fileName: string;
	/** The slot name (e.g. `autosave`); null for an archival manual save. */
	slot: string | null;
	emulator: string | null;
	sizeBytes: number;
	/** The server's content hash (md5 in 5.x) — what we compare against. */
	contentHash: string | null;
	/** When the server last saw this save change. */
	updatedAt: string;
}

/** One save state on the server. */
export interface RommState {
	id: number;
	romId: number;
	fileName: string;
	emulator: string | null;
	sizeBytes: number;
	contentHash: string | null;
	updatedAt: string;
}

/** A registered device (this console). */
export interface RommDevice {
	id: string;
	name: string;
	platform: string | null;
	client: string | null;
	clientVersion: string | null;
	syncMode: string | null;
	lastSeen: string | null;
}

/** The current on-device state of one save, as `sync/negotiate` wants it. */
export interface ClientSaveState {
	romId: number;
	fileName: string;
	slot: string | null;
	emulator: string | null;
	/** MD5 of the local file — the pairing + change-detection key. */
	contentHash: string | null;
	/** ISO timestamp of the local file's last modification. */
	updatedAt: string;
	sizeBytes: number;
}

/** One operation the server wants the client to perform. */
export interface SyncOperation {
	action: 'upload' | 'download' | 'conflict' | 'no_op' | 'delete';
	romId: number;
	saveId: number | null;
	fileName: string;
	slot: string | null;
	emulator: string | null;
	reason: string;
	/** The server's content hash, for the download / conflict cases. */
	contentHash: string | null;
	/** The server's last-modified, for the download / conflict cases. */
	updatedAt: string | null;
}

/** The result of a `sync/negotiate` round trip. */
export interface SyncNegotiateResult {
	sessionId: number;
	operations: SyncOperation[];
	totalUpload: number;
	totalDownload: number;
	totalConflict: number;
	totalNoOp: number;
	totalDelete: number;
}

/** A play session to ingest (feeds the "Continue playing" row). */
export interface PlaySessionEntry {
	romId: number | null;
	saveSlot: string | null;
	/** ISO start. */
	startTime: string;
	/** ISO end. */
	endTime: string;
	durationMs: number;
}

// ── defensive field readers ─────────────────────────────────────────────────

function asString(v: unknown): string | null {
	return typeof v === 'string' && v !== '' ? v : null;
}

function asNullableString(v: unknown): string | null {
	if (v === null) return null;
	return asString(v);
}

function asNumber(v: unknown): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// ── firmware (BIOS) ─────────────────────────────────────────────────────────

function parseFirmware(entry: unknown): RommFirmware | null {
	if (typeof entry !== 'object' || entry === null) return null;
	const e = entry as Record<string, unknown>;
	const id = asNumber(e['id']);
	if (id === 0) return null;
	return {
		id,
		platformId: asNumber(e['platform_id']),
		fileName: asString(e['file_name']) ?? '',
		extension: asString(e['file_extension']) ?? '',
		sizeBytes: asNumber(e['file_size_bytes']),
		hash: asString(e['sha1_hash']) ?? asString(e['md5_hash']) ?? '',
		md5Hash: asString(e['md5_hash']) ?? '',
		missingFromFs: e['missing_from_fs'] === true,
	};
}

/**
 * The firmware (BIOS) files the server has, optionally for one platform.
 *
 * @returns the files, or null when the route is absent (pre-5.x).
 */
export async function getFirmware(
	client: RommClient,
	platformId?: number,
	signal?: AbortSignal,
): Promise<RommFirmware[] | null> {
	try {
		const query = platformId !== undefined ? `?platform_id=${platformId}` : '';
		const res = await client.request(`/api/firmware${query}`, {}, signal);
		if (res.status === 404) return null;
		if (!res.ok) return null;
		const json: unknown = await res.json();
		let items: unknown[] = [];
		if (Array.isArray(json)) items = json;
		else if (typeof json === 'object' && json !== null) {
			const o = json as Record<string, unknown>;
			for (const key of ['items', 'data', 'results']) {
				if (Array.isArray(o[key])) {
					items = o[key] as unknown[];
					break;
				}
			}
		}
		const out: RommFirmware[] = [];
		for (const entry of items) {
			const f = parseFirmware(entry);
			if (f !== null) out.push(f);
		}
		return out;
	} catch {
		return null;
	}
}

/**
 * An absolute URL that streams the bytes of one firmware file, for the
 * download queue. The token rides along as a header (the client adds it).
 */
export function firmwareContentUrl(client: RommClient, firmware: RommFirmware): string {
	return `${client.base}/api/firmware/${firmware.id}/content/${encodeURIComponent(firmware.fileName)}`;
}

// ── saves ───────────────────────────────────────────────────────────────────

function parseSave(entry: unknown): RommSave | null {
	if (typeof entry !== 'object' || entry === null) return null;
	const e = entry as Record<string, unknown>;
	const id = asNumber(e['id']);
	if (id === 0) return null;
	return {
		id,
		romId: asNumber(e['rom_id']),
		fileName: asString(e['file_name']) ?? '',
		slot: asNullableString(e['slot']),
		emulator: asNullableString(e['emulator']),
		sizeBytes: asNumber(e['file_size_bytes']),
		contentHash: asNullableString(e['content_hash']),
		updatedAt: asString(e['updated_at']) ?? asString(e['created_at']) ?? '',
	};
}

/**
 * The server's save files, optionally scoped to a set of roms.
 *
 * @returns the saves, or null when the route is absent (pre-5.x).
 */
export async function getSaves(
	client: RommClient,
	romIds?: number[],
	signal?: AbortSignal,
): Promise<RommSave[] | null> {
	try {
		const params = new URLSearchParams();
		if (romIds !== undefined && romIds.length > 0) {
			for (const id of romIds) params.append('rom_ids', String(id));
		}
		const query = params.toString();
		const res = await client.request(`/api/saves${query !== '' ? `?${query}` : ''}`, {}, signal);
		if (res.status === 404) return null;
		if (!res.ok) return null;
		const json: unknown = await res.json();
		let items: unknown[] = [];
		if (Array.isArray(json)) items = json;
		else if (typeof json === 'object' && json !== null) {
			const o = json as Record<string, unknown>;
			for (const key of ['items', 'data', 'results']) {
				if (Array.isArray(o[key])) {
					items = o[key] as unknown[];
					break;
				}
			}
		}
		const out: RommSave[] = [];
		for (const entry of items) {
			const s = parseSave(entry);
			if (s !== null) out.push(s);
		}
		return out;
	} catch {
		return null;
	}
}

/** An absolute URL that streams the bytes of one save file. */
export function saveContentUrl(client: RommClient, save: RommSave): string {
	return `${client.base}/api/saves/${save.id}/content`;
}

/**
 * Upload (or replace) a save file.
 *
 * The RomM route takes `rom_id` as a query parameter and the file as
 * `multipart/form-data` under the field name `saveFile`.
 *
 * @returns the created/updated save, or null on failure.
 */
export async function uploadSave(
	client: RommClient,
	args: {
		romId: number;
		fileName: string;
		/** Raw file bytes. */
		bytes: ArrayBuffer | Uint8Array;
		slot?: string | null;
		emulator?: string | null;
		/** The local MD5 — the server stores it for change detection. */
		contentHash?: string | null;
		deviceId?: string | null;
		sessionId?: number | null;
		/** Replace an existing save at this (rom, slot) instead of 409-ing. */
		overwrite?: boolean;
	},
	signal?: AbortSignal,
): Promise<RommSave | null> {
	try {
		const params = new URLSearchParams();
		params.set('rom_id', String(args.romId));
		if (args.slot) params.set('slot', args.slot);
		if (args.emulator) params.set('emulator', args.emulator);
		if (args.contentHash) params.set('content_hash', args.contentHash);
		if (args.deviceId) params.set('device_id', args.deviceId);
		if (args.sessionId) params.set('session_id', String(args.sessionId));
		if (args.overwrite) params.set('overwrite', 'true');

		const form = new FormData();
		const bytes =
			args.bytes instanceof Uint8Array ? args.bytes : new Uint8Array(args.bytes);
		form.append('saveFile', new File([bytes], args.fileName), args.fileName);

		const res = await client.request(`/api/saves?${params.toString()}`, { method: 'POST', body: form }, signal);
		if (!res.ok) return null;
		const json: unknown = await res.json();
		return parseSave(json);
	} catch {
		return null;
	}
}

/**
 * Tell the server we now hold a copy of a save on this device (its
 * `downloaded` bookkeeping, so it knows which devices have it).
 */
export async function confirmSaveDownloaded(
	client: RommClient,
	saveId: number,
	deviceId: string,
	contentHash: string | null,
	signal?: AbortSignal,
): Promise<void> {
	try {
		await client.request(
			`/api/saves/${saveId}/downloaded`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ device_id: deviceId, content_hash: contentHash }),
			},
			signal,
		);
	} catch {
		/* best-effort bookkeeping */
	}
}

// ── states (save states) ────────────────────────────────────────────────────

function parseState(entry: unknown): RommState | null {
	if (typeof entry !== 'object' || entry === null) return null;
	const e = entry as Record<string, unknown>;
	const id = asNumber(e['id']);
	if (id === 0) return null;
	return {
		id,
		romId: asNumber(e['rom_id']),
		fileName: asString(e['file_name']) ?? '',
		emulator: asNullableString(e['emulator']),
		sizeBytes: asNumber(e['file_size_bytes']),
		contentHash: asNullableString(e['content_hash']),
		updatedAt: asString(e['updated_at']) ?? asString(e['created_at']) ?? '',
	};
}

/** The server's save states, optionally scoped to a set of roms. */
export async function getStates(
	client: RommClient,
	romIds?: number[],
	signal?: AbortSignal,
): Promise<RommState[] | null> {
	try {
		const params = new URLSearchParams();
		if (romIds !== undefined && romIds.length > 0) {
			for (const id of romIds) params.append('rom_ids', String(id));
		}
		const query = params.toString();
		const res = await client.request(`/api/states${query !== '' ? `?${query}` : ''}`, {}, signal);
		if (res.status === 404) return null;
		if (!res.ok) return null;
		const json: unknown = await res.json();
		let items: unknown[] = [];
		if (Array.isArray(json)) items = json;
		else if (typeof json === 'object' && json !== null) {
			const o = json as Record<string, unknown>;
			for (const key of ['items', 'data', 'results']) {
				if (Array.isArray(o[key])) {
					items = o[key] as unknown[];
					break;
				}
			}
		}
		const out: RommState[] = [];
		for (const entry of items) {
			const s = parseState(entry);
			if (s !== null) out.push(s);
		}
		return out;
	} catch {
		return null;
	}
}

/** An absolute URL that streams the bytes of one save state. */
export function stateContentUrl(client: RommClient, state: RommState): string {
	return `${client.base}/api/states/${state.id}/content`;
}

/** Upload (or replace) a save state. Field name is `stateFile`. */
export async function uploadState(
	client: RommClient,
	args: {
		romId: number;
		fileName: string;
		bytes: ArrayBuffer | Uint8Array;
		emulator?: string | null;
		contentHash?: string | null;
		overwrite?: boolean;
	},
	signal?: AbortSignal,
): Promise<RommState | null> {
	try {
		const params = new URLSearchParams();
		params.set('rom_id', String(args.romId));
		if (args.emulator) params.set('emulator', args.emulator);
		if (args.contentHash) params.set('content_hash', args.contentHash);
		if (args.overwrite) params.set('overwrite', 'true');

		const form = new FormData();
		const bytes = args.bytes instanceof Uint8Array ? args.bytes : new Uint8Array(args.bytes);
		form.append('stateFile', new File([bytes], args.fileName), args.fileName);

		const res = await client.request(`/api/states?${params.toString()}`, { method: 'POST', body: form }, signal);
		if (!res.ok) return null;
		const json: unknown = await res.json();
		return parseState(json);
	} catch {
		return null;
	}
}

// ── devices ─────────────────────────────────────────────────────────────────

/**
 * Register this console as a device, returning its id. The id is persisted
 * and reused, so the server can tie saves + sync + play sessions to one
 * stable identity across launches.
 *
 * @returns the device, or null when the route is absent (pre-5.x) or the
 *          call fails.
 */
export async function registerDevice(
	client: RommClient,
	args: {
		name: string;
		platform?: string | null;
		client?: string | null;
		clientVersion?: string | null;
		syncMode?: string | null;
	},
	signal?: AbortSignal,
): Promise<RommDevice | null> {
	try {
		const body: Record<string, unknown> = {
			name: args.name,
			platform: args.platform ?? null,
			client: args.client ?? null,
			client_version: args.clientVersion ?? null,
			sync_mode: args.syncMode ?? null,
			allow_existing: true,
		};
		const res = await client.request(
			'/api/devices',
			{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
			signal,
		);
		if (!res.ok) return null;
		const json = (await res.json()) as Record<string, unknown>;
		const id = asString(json['device_id']) ?? asString(json['id']);
		if (id === null) return null;
		return {
			id,
			name: asString(json['name']) ?? args.name,
			platform: asNullableString(json['platform']),
			client: asNullableString(json['client']),
			clientVersion: asNullableString(json['client_version']),
			syncMode: asNullableString(json['sync_mode']),
			lastSeen: asNullableString(json['last_seen']),
		};
	} catch {
		return null;
	}
}

/**
 * The device list, as a feature probe: does this server have the 5.x
 * device/sync routes at all?
 *
 * @returns how many devices are registered, or null when the route is
 *          absent (a pre-5.x server) or the call failed — the sync layer
 *          and the doctor screen treat null as "sync unavailable".
 */
export async function getDevices(
	client: RommClient,
	signal?: AbortSignal,
): Promise<number | null> {
	try {
		const res = await client.request('/api/devices?limit=100', {}, signal);
		if (!res.ok) return null;
		const json: unknown = await res.json();
		const list = Array.isArray(json)
			? json
			: typeof json === 'object' && json !== null
			  ? (json as Record<string, unknown>)['devices']
			  : null;
		return Array.isArray(list) ? list.length : 1;
	} catch {
		return null;
	}
}

// ── sync ────────────────────────────────────────────────────────────────────

/**
 * Ask the server to diff our local save state against its copy and hand
 * back the operations to reconcile them. This is the heart of save sync.
 *
 * @returns the negotiated operations, or null when the route is absent
 *          (pre-5.x) or the call fails.
 */
export async function negotiateSync(
	client: RommClient,
	args: {
		deviceId: string | null;
		saves: ClientSaveState[];
		/** Rom ids installed on the device — scopes the offers. */
		romIds?: number[];
		/**
		 * Emulators whose saves this client can load. Null = everything
		 * (RetroArch runs any core, so its saves all pair).
		 */
		emulators?: string[] | null;
		/** Offer every server save we did not list (a client that never deletes). */
		restoreUnlisted?: boolean;
	},
	signal?: AbortSignal,
): Promise<SyncNegotiateResult | null> {
	try {
		const body: Record<string, unknown> = {
			device_id: args.deviceId,
			// The schema is snake_case; the camelCase fields would be
			// silently dropped by Pydantic and every save would come back
			// without a rom id (a 422).
			saves: args.saves.map((s) => ({
				rom_id: s.romId,
				file_name: s.fileName,
				slot: s.slot,
				emulator: s.emulator,
				content_hash: s.contentHash,
				updated_at: s.updatedAt,
				file_size_bytes: s.sizeBytes,
			})),
			rom_ids: args.romIds,
			emulators: args.emulators,
			restore_unlisted: args.restoreUnlisted ?? false,
		};
		const res = await client.request(
			'/api/sync/negotiate',
			{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
			signal,
		);
		if (!res.ok) {
			// Log the server's complaint: a bare `null` here reads as "sync
			// negotiation failed" with no way to see WHICH field the schema
			// rejected (the 422's `loc`/`msg` is the whole diagnosis).
			try {
				log('error', `sync negotiate: HTTP ${res.status} — ${(await res.text()).slice(0, 600)}`);
			} catch {
				log('error', `sync negotiate: HTTP ${res.status}`);
			}
			return null;
		}
		const json = (await res.json()) as Record<string, unknown>;
		const sessionId = asNumber(json['session_id']);
		const rawOps = Array.isArray(json['operations']) ? (json['operations'] as unknown[]) : [];
		const operations: SyncOperation[] = [];
		for (const o of rawOps) {
			if (typeof o !== 'object' || o === null) continue;
			const op = o as Record<string, unknown>;
			const action = asString(op['action']);
			if (action === null) continue;
			// The 5.x schema prefixes the server-side fields (`server_content_hash`);
			// the un-prefixed forms are kept as a fallback for a dialect that
			// drops the prefix.
			operations.push({
				action: action as SyncOperation['action'],
				romId: asNumber(op['rom_id']),
				saveId: op['save_id'] === null ? null : asNumber(op['save_id']),
				fileName: asString(op['file_name']) ?? '',
				slot: asNullableString(op['slot']),
				emulator: asNullableString(op['emulator']),
				reason: asString(op['reason']) ?? '',
				contentHash: asNullableString(op['server_content_hash']) ??
					asNullableString(op['content_hash']),
				updatedAt: asNullableString(op['server_updated_at']) ??
					asNullableString(op['updated_at']),
			});
		}
		return {
			sessionId,
			operations,
			totalUpload: asNumber(json['total_upload']),
			totalDownload: asNumber(json['total_download']),
			totalConflict: asNumber(json['total_conflict']),
			totalNoOp: asNumber(json['total_no_op']),
			totalDelete: asNumber(json['total_delete']),
		};
	} catch {
		return null;
	}
}

/** Mark a negotiated sync session as done (closes it on the server). */
export async function completeSyncSession(
	client: RommClient,
	sessionId: number,
	signal?: AbortSignal,
): Promise<void> {
	try {
		await client.request(
			`/api/sync/sessions/${sessionId}/complete`,
			{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
			signal,
		);
	} catch {
		/* best-effort bookkeeping */
	}
}

// ── play sessions ───────────────────────────────────────────────────────────

/**
 * Ingest play sessions (start/end + duration). This is what keeps the
 * server's `last_played` current so the "Continue playing" row is honest.
 *
 * @returns true when the server accepted the batch.
 */
export async function ingestPlaySessions(
	client: RommClient,
	args: {
		deviceId: string | null;
		sessions: PlaySessionEntry[];
	},
	signal?: AbortSignal,
): Promise<boolean> {
	try {
		const body: Record<string, unknown> = {
			device_id: args.deviceId,
			sessions: args.sessions.map((s) => ({
				rom_id: s.romId,
				save_slot: s.saveSlot,
				start_time: s.startTime,
				end_time: s.endTime,
				duration_ms: s.durationMs,
			})),
		};
		const res = await client.request(
			'/api/play-sessions',
			{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
			signal,
		);
		return res.status === 200 || res.status === 201;
	} catch {
		return false;
	}
}

/** A lightweight "I am alive" ping for a device (feeds its last-seen). */
export async function heartbeat(
	client: RommClient,
	args: { romId: number; deviceId: string },
	signal?: AbortSignal,
): Promise<void> {
	try {
		await client.request(
			'/api/activity/heartbeat',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ rom_id: args.romId, device_id: args.deviceId }),
			},
			signal,
		);
	} catch {
		/* best-effort */
	}
}
