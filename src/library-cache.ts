/**
 * The local library cache: the parsed result of a full rom walk, kept as
 * NDJSON on the SD card (`library.ndjson` — one game per line, next to
 * the manifest).
 *
 * This is what makes the dashboard instant: at boot the cache is read
 * (in windows, one line at a time — never the whole file as one string)
 * and shown while the live walk refreshes it in the background. The
 * write side is equally gentle: lines are appended in small batches and
 * the file is swapped in with an atomic rename, so a crash mid-write can
 * only ever leave the previous cache in place.
 *
 * The first line is a header (`{"_cache":…}`) that versions the file and
 * records the instance base URL the walk came from — a config change
 * reads absolute cover URLs that point at the old server, so a mismatch
 * discards the cache.
 */
import { appendBinary, fileSize, move, readBinary, readText, remove, writeText } from './fs';
import { PATHS } from './retroarch/layout';
import type { RommGame, RommPlatform } from './romm';

const CACHE_PATH = `${PATHS.appDir}/library.ndjson`;
const TMP_PATH = `${PATHS.appDir}/library.ndjson.tmp`;

/**
 * Bump when the RommGame shape changes in a way old caches cannot satisfy.
 * v2: the RA fields (`raId`/`raHash`) joined the game — v1 lines lack them,
 * so a v1 cache is discarded and the next walk rewrites it.
 */
const CACHE_VERSION = 2;

interface CacheHeader {
	/** The literal `_cache: 1` marks the line as the header. */
	_cache: number;
	v: number;
	base: string;
	ts: number;
}

/** How many bytes are read (and parsed) per window at boot. */
const READ_WINDOW = 262144;
/** Appends are batched to roughly this many characters per write. */
const WRITE_BATCH = 32768;

function headerLine(base: string): string {
	const header: CacheHeader = { _cache: 1, v: CACHE_VERSION, base, ts: Date.now() };
	return JSON.stringify(header);
}

/**
 * Read the cached library for `base` (the *normalized* instance base the
 * walk used). Returns null when there is no cache, it belongs to another
 * instance, or it is corrupt — callers just walk the network then.
 */
export async function readLibraryCache(base: string): Promise<RommGame[] | null> {
	const size = await fileSize(CACHE_PATH);
	if (size <= 0) return null;

	const decoder = new TextDecoder();
	const games: RommGame[] = [];
	let header: CacheHeader | null = null;
	let carry: Uint8Array | null = null;

	/** Decode one complete-line segment and consume its lines. */
	const consume = (segment: Uint8Array): boolean => {
		let text: string;
		try {
			text = decoder.decode(segment);
		} catch {
			return false;
		}
		for (const line of text.split('\n')) {
			const t = line.trim();
			if (t === '') continue;
			if (header === null) {
				// The header must be the very first line.
				if (!t.startsWith('{"_cache"')) return false;
				try {
					const parsed = JSON.parse(t) as CacheHeader;
					if (parsed._cache !== 1 || parsed.v !== CACHE_VERSION) return false;
					if (typeof parsed.base !== 'string' || parsed.base !== base) return false;
					header = parsed;
				} catch {
					return false;
				}
				continue;
			}
			try {
				const game = JSON.parse(t) as RommGame;
				if (typeof game.id !== 'number' || typeof game.name !== 'string') continue;
				// Defence in depth: a line missing the RA fields (an older
				// writer, or a version reset) normalises to "no match"
				// rather than an `undefined` that could slip past the badge.
				if (typeof game.raId !== 'number') game.raId = 0;
				if (typeof game.raHash !== 'string') game.raHash = '';
				games.push(game);
			} catch {
				// One bad line costs its game, never the cache.
			}
		}
		return true;
	};

	// Windowed read, `end` exclusive (the device runtime's actual semantics
	// — its docs say inclusive but it returns one byte less). The next
	// window starts where the last one ACTUALLY ended: a fixed
	// `start += READ_WINDOW` would skip the one byte each short window
	// leaves behind, and a byte missing from the middle of a line corrupts
	// that game's JSON.
	let start = 0;
	while (start < size) {
		const buf = await readBinary(CACHE_PATH, {
			start,
			end: Math.min(size, start + READ_WINDOW),
		});
		if (buf === null) return null;
		const chunk = new Uint8Array(buf);
		if (chunk.length === 0) break; // a failed read: stop, never spin
		start += chunk.length;
		const joined: Uint8Array = carry === null ? chunk : concatBytes(carry, chunk);
		// Split at the last newline: UTF-8 continuation bytes are always
		// ≥ 0x80, so a split at \n can never cut a character in half.
		let lastNl = -1;
		for (let i = joined.length - 1; i >= 0; i--) {
			if (joined[i] === 0x0a) {
				lastNl = i;
				break;
			}
		}
		if (lastNl === -1) {
			carry = joined;
			continue;
		}
		if (!consume(joined.subarray(0, lastNl + 1))) return null;
		carry = lastNl + 1 < joined.length ? joined.slice(lastNl + 1) : null;
	}
	// A final line without its newline (the writer always adds one, but
	// be tolerant — a truncated tail costs its line, not the cache).
	if (carry !== null && carry.length > 0 && !consume(carry)) return null;

	if (header === null) return null;
	return games;
}

/** Concatenate two byte arrays into one (small: window + partial line). */
function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
	const out = new Uint8Array(a.length + b.length);
	out.set(a, 0);
	out.set(b, a.length);
	return out;
}

/**
 * Persist a completed walk as the new cache (best-effort).
 *
 * Lines go to a temp file in small appended batches — the whole library
 * is never one string — and the temp file is renamed over the old cache
 * when the last line is down, so the old copy survives a mid-write
 * crash. A failed write leaves the previous cache: the next boot simply
 * refreshes over it again.
 */
export async function writeLibraryCache(base: string, games: RommGame[]): Promise<void> {
	try {
		await remove(TMP_PATH);
		let pending = headerLine(base) + '\n';
		for (const game of games) {
			pending += JSON.stringify(game) + '\n';
			if (pending.length >= WRITE_BATCH) {
				await appendBinary(TMP_PATH, new TextEncoder().encode(pending));
				pending = '';
			}
		}
		if (pending !== '') {
			await appendBinary(TMP_PATH, new TextEncoder().encode(pending));
		}
		await move(TMP_PATH, CACHE_PATH);
	} catch (err) {
		try {
			await remove(TMP_PATH);
		} catch {
			/* nothing else to do */
		}
		throw err;
	}
}

// ── Incremental sync ─────────────────────────────────────────────────────
//
// A full walk of a real library is minutes of paging; most boots change
// nothing. The sync state records when the walk finished and what the
// server's per-platform rom counts were then. At boot the app refetches
// the platform list (one small request it makes anyway, for the logos)
// and:
//   - a platform whose count changed is re-walked — its cached roms are
//     replaced wholesale, so removals are caught for free;
//   - a sweep of `updated_after: <state.ts>` picks up metadata/covers
//     refreshes that do not change any count (RomM >= 3.6 filters on the
//     rom's `updated_at`; older servers answer nothing for it — the state
//     keeps no ts then, forcing a full walk once and never starving);
//   - platforms that no longer exist have their roms dropped.
//
// Deletions within a platform that leave its count unchanged are invisible
// to both signals (N removed, N added) — accepted: the next count change
// or metadata refresh heals it.

const SYNC_PATH = `${PATHS.appDir}/library.sync`;

interface SyncState {
	v: 1;
	/** The normalized instance base these counts belong to. */
	base: string;
	/** When the incorporated walk finished (epoch ms), 0 when unknown. */
	ts: number;
	/** Per server platform id → rom_count at that moment. */
	counts: Record<string, number>;
}

export interface SyncPlan {
	/** Full: no usable state/prelude — walk everything. */
	kind: 'full' | 'partial';
	/** Platform ids whose cached roms must be replaced by a fresh walk. */
	changedPids: number[];
	/** Platform ids that vanished — drop their roms, no walk possible. */
	droppedPids: number[];
	/** Span used for the `updated_after` sweep ('' = no sweep). */
	afterIso: string;
}

/** Per-platform rom counts of the list just fetched. */
export function countSnapshot(platforms: RommPlatform[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const p of platforms) counts[String(p.id)] = p.romCount;
	return counts;
}

export async function writeSyncState(
	base: string,
	counts: Record<string, number>,
	ts: number,
): Promise<void> {
	const state: SyncState = { v: 1, base, ts, counts };
	await writeText(SYNC_PATH, JSON.stringify(state));
}

export async function readSyncState(base: string): Promise<SyncState | null> {
	try {
		const text = await readText(SYNC_PATH);
		if (text === null) return null;
		const state = JSON.parse(text) as SyncState;
		if (state.v !== 1 || state.base !== base) return null;
		if (
			typeof state.counts !== 'object' ||
			state.counts === null ||
			Array.isArray(state.counts)
		) {
			return null;
		}
		if (typeof state.ts !== 'number') return null;
		return state;
	} catch {
		return null;
	}
}

/**
 * Decide what the boot must fetch, given the saved state and a fresh
 * platform list. The sweep span carries a 60 s backstop so a rom updated
 * moments before the last walk finished still arrives (an extra upsert
 * is free; a missed one waits for the next count change).
 *
 * Trap bis: an older server without `updated_after` silently ignores the
 * unknown parameter, so the sweep would return the whole library. That
 * degenerates into exactly today's full walk (upsert-merge of everything)
 * — never worse than the status quo, and once any server-side timestamps
 * exist the sweep only needs a round trip of zero items.
 */
export function planSync(state: SyncState | null, platforms: RommPlatform[]): SyncPlan {
	if (state === null) {
		return { kind: 'full', changedPids: [], droppedPids: [], afterIso: '' };
	}
	const changedPids: number[] = [];
	for (const p of platforms) {
		const prev = state.counts[String(p.id)];
		if (prev === undefined) {
			// This platform is new to us: its roms were never walked. If the
			// count is 0 there is nothing to fetch; anything else re-walks.
			if (p.romCount > 0) changedPids.push(p.id);
			continue;
		}
		if (prev !== p.romCount) changedPids.push(p.id);
	}
	const liveIds = new Set(platforms.map((p) => String(p.id)));
	const droppedPids: number[] = [];
	for (const key of Object.keys(state.counts)) {
		if (!liveIds.has(key) && state.counts[key]! !== 0) {
			const id = Number(key);
			if (!Number.isNaN(id)) droppedPids.push(id);
		}
	}
	return {
		kind: 'partial',
		changedPids,
		droppedPids,
		afterIso: state.ts > 0 ? new Date(state.ts - 60_000).toISOString() : '',
	};
}

/**
 * Merge the products of a partial sync into the cached list:
 * `upserts` replace the game with the same id, appended otherwise. Note
 * the caller pre-drops the changed/vanished platforms' games.
 */
export function mergeSynced(cached: RommGame[], upserts: RommGame[]): RommGame[] {
	const byId = new Map<number, number>(); // id → index in merged
	const merged = cached.slice();
	for (let i = 0; i < merged.length; i++) if (merged[i]!.id > 0) byId.set(merged[i]!.id, i);
	for (const game of upserts) {
		if (game.id <= 0) {
			merged.push(game);
			continue;
		}
		const at = byId.get(game.id);
		if (at === undefined) {
			byId.set(game.id, merged.length);
			merged.push(game);
		} else {
			merged[at] = game;
		}
	}
	return merged;
}
