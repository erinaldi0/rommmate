/**
 * Defensive per-field parsers for one rom entry.
 *
 * RomM generations disagree about where every field lives (flat vs a
 * `metadatum` blob, local paths vs external URLs, seconds vs milliseconds),
 * so each parser tries the known shapes in order and returns the first
 * sensible value — an unknown schema degrades to an empty field instead of
 * a parse failure. `RommClient` runs every entry through these.
 */
import type {
	RommRomFile,
	RomRAchievement,
	RomRAEarnedAchievement,
	RomRAGameProgression,
	RomRAProgression,
} from './types';

/**
 * Read one entry of a RomM `assets` object (≤4.x). Asset values come in two
 * shapes across versions:
 *   "box_2d": "/assets/games/123/abc.png"                  (plain path)
 *   "box_2d": { "path": "/assets/games/123/abc.png", ... } (object)
 */
function assetPath(assets: unknown, key: string): string {
	if (typeof assets !== 'object' || assets === null) return '';

	const v = (assets as Record<string, unknown>)[key];
	if (typeof v === 'string') return v;

	if (typeof v === 'object' && v !== null) {
		const o = v as Record<string, unknown>;
		for (const member of ['path', 'url']) {
			const s = o[member];
			if (typeof s === 'string' && s !== '') return s;
		}
	}

	return '';
}

/** First non-empty string among `keys`. */
export function firstString(source: Record<string, unknown>, keys: string[]): string {
	for (const key of keys) {
		const v = source[key];
		if (typeof v === 'string' && v.trim() !== '') return v.trim();
	}
	return '';
}

/** First positive number among `keys` (numbers or numeric strings). */
function firstNumber(source: Record<string, unknown>, keys: string[]): number {
	for (const key of keys) {
		const v = source[key];
		if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
		if (typeof v === 'string') {
			const n = Number(v);
			if (Number.isFinite(n) && n > 0) return n;
		}
	}
	return 0;
}

/** A non-negative finite number, or null when absent. */
export function nonNegNumber(v: unknown): number | null {
	return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * RomM 5.x nests some fields (genres, release date) in a `metadatum` blob;
 * ≤4.x keeps them at the top level. Returns the object that actually holds
 * them: the `metadatum` blob when present, the entry itself otherwise.
 */
function metaOf(e: Record<string, unknown>): Record<string, unknown> {
	const m = e['metadatum'];
	return typeof m === 'object' && m !== null ? (m as Record<string, unknown>) : e;
}

/**
 * Platform name. 5.x exposes it as flat `platform_custom_name` /
 * `platform_display_name` strings; ≤4.x as a `platform` object or string.
 * A user-renamed (custom) platform name wins over the display name.
 */
export function parsePlatform(e: Record<string, unknown>): string {
	const custom = firstString(e, ['platform_custom_name']);
	if (custom !== '') return custom;
	const display = firstString(e, ['platform_display_name']);
	if (display !== '') return display;

	const p = e['platform'];
	if (typeof p === 'string') return p.trim();
	if (typeof p === 'object' && p !== null) {
		const name = (p as { name?: unknown }).name;
		if (typeof name === 'string') return name.trim();
	}
	return '';
}

/**
 * Cover art path or URL. 5.x exposes local `/assets/…` paths
 * (`path_cover_large` / `path_cover_small`) and an external provider
 * `url_cover`; ≤4.x nests them under `assets`. Local paths are preferred:
 * they are served by the instance itself and can carry the token.
 */
export function parseCover(e: Record<string, unknown>): string {
	let p = firstString(e, ['path_cover_large', 'path_cover_small']);
	if (p === '') p = firstString(e, ['url_cover']);
	if (p === '') p = assetPath(e['assets'], 'box_2d');
	if (p === '') p = assetPath(e['assets'], 'screenshot_16x9');
	return p;
}

/**
 * Screenshot path or URL. 5.x has a single `screenshot_path` plus a
 * `merged_screenshots` array; ≤4.x nests it under `assets`.
 */
export function parseScreenshot(e: Record<string, unknown>): string {
	let p = firstString(e, ['screenshot_path']);
	if (p === '') {
		const merged = e['merged_screenshots'];
		if (Array.isArray(merged)) {
			for (const s of merged) {
				if (typeof s === 'string' && s.trim() !== '') {
					p = s;
					break;
				}
				if (typeof s === 'object' && s !== null) {
					const q = (s as { path?: unknown }).path;
					if (typeof q === 'string' && q.trim() !== '') {
						p = q;
						break;
					}
				}
			}
		}
	}
	if (p === '') p = assetPath(e['assets'], 'screenshot_16x9');
	return p;
}

/** Rom file size. 5.x reports `fs_size_bytes`; ≤4.x `rom_size_bytes`. */
export function parseSize(e: Record<string, unknown>): number {
	return firstNumber(e, ['fs_size_bytes', 'rom_size_bytes', 'rom_size']);
}

/** Short description. `summary` in both major versions; `description` on older builds. */
export function parseSummary(e: Record<string, unknown>): string {
	return firstString(e, ['summary', 'description', 'bios']);
}

/**
 * Genres arrive as `[{ id, name }]` on current RomM, but some versions (and
 * some imports) use plain strings. Both are accepted. 5.x nests them in
 * `metadatum`; ≤4.x keeps them at the top level.
 */
export function parseGenres(e: Record<string, unknown>): string[] {
	const value = metaOf(e)['genres'];
	if (!Array.isArray(value)) return [];

	const out: string[] = [];
	for (const entry of value) {
		if (typeof entry === 'string') {
			const name = entry.trim();
			if (name !== '') out.push(name);
			continue;
		}
		if (typeof entry === 'object' && entry !== null) {
			const name = (entry as { name?: unknown }).name;
			if (typeof name === 'string' && name.trim() !== '') out.push(name.trim());
		}
	}
	return out;
}

/**
 * RomM reports the release date as a unix timestamp (`first_release`) in
 * some versions, a millisecond timestamp (`first_release_date`) in 5.x, and
 * an ISO string (`release_date`) in others. All are normalised to
 * `YYYY-MM-DD`; anything implausible is dropped.
 */
export function parseReleaseDate(e: Record<string, unknown>): string {
	const src = metaOf(e);

	const iso = firstString(src, ['first_release_date', 'release_date', 'first_release']);
	if (iso !== '') {
		const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
		if (m) return m[0];
		// A bare year is still worth showing.
		const year = /^(\d{4})$/.exec(iso);
		if (year) return year[1];
	}

	const stamp = firstNumber(src, ['first_release', 'first_release_date', 'release_date']);
	if (stamp <= 0) return '';

	// Seconds in older versions, milliseconds in 5.x — the ms value is ~1000x larger.
	const ms = stamp > 1e11 ? stamp : stamp * 1000;
	const date = new Date(ms);
	if (Number.isNaN(date.getTime())) return '';

	const year = date.getUTCFullYear();
	if (year < 1970 || year > 2100) return '';

	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	const day = String(date.getUTCDate() + 0).padStart(2, '0');
	return `${year}-${month}-${day}`;
}
/**
 * The rom's files (the 5.x `files` array).
 *
 * Some instances omit the field from the list entirely, and members arrive
 * as objects (5.x `RomFileSchema`) or, on older builds, as plain strings.
 * Anything unparseable is dropped — an entry without a `file_name` is
 * useless to the download routes, which key on it.
 */
export function parseFiles(e: Record<string, unknown>): RommRomFile[] {
	const raw = e['files'];
	if (!Array.isArray(raw)) return [];

	const out: RommRomFile[] = [];
	for (const f of raw) {
		let fileName = '';
		let sizeBytes = 0;
		let md5Hash = '';
		let topLevel = false;
		let memberCount = 0;

		if (typeof f === 'string') {
			fileName = f.trim();
		} else if (typeof f === 'object' && f !== null) {
			const o = f as Record<string, unknown>;
			fileName = firstString(o, ['file_name', 'name']);
			sizeBytes = firstNumber(o, ['file_size_bytes', 'fs_size_bytes']);
			md5Hash = firstString(o, ['md5_hash']);
			topLevel = o['is_top_level'] === true;
			const members = o['archive_members'];
			if (Array.isArray(members)) memberCount = members.length;
		}

		if (fileName === '') continue;
		out.push({
			fileName,
			sizeBytes,
			md5Hash,
			extension: fileName.includes('.')
				? fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
				: '',
			topLevel,
			memberCount,
		});
	}
	return out;
}

/** A non-negative integer from a possibly-string JSON value, or 0 when absent. */
function raInt(v: unknown): number {
	if (typeof v === 'number' && Number.isFinite(v)) return v < 0 ? 0 : v;
	if (typeof v === 'string') {
		const n = Number(v);
		if (Number.isFinite(n)) return n < 0 ? 0 : n;
	}
	return 0;
}

/** A nullable integer: null when the field is absent, else the number. */
function optInt(v: unknown): number | null {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string' && v !== '') {
		const n = Number(v);
		if (Number.isFinite(n)) return n;
	}
	return null;
}

/** A nullable string: null for empty/absent values. */
function optStr(v: unknown): string | null {
	if (typeof v === 'string' && v !== '') return v;
	return null;
}

/**
 * The RA game id a rom is matched to (a positive integer), or 0 when the
 * server has no match. This is the "is this game RA-compatible" signal the
 * detail badge reads; it is cheap, so it is parsed in every list entry.
 */
export function parseRaId(e: Record<string, unknown>): number {
	const v = e['ra_id'];
	if (typeof v === 'number' && v > 0) return v;
	if (typeof v === 'string') {
		const n = Number(v);
		if (Number.isFinite(n) && n > 0) return n;
	}
	return 0;
}

/** The RA file hash the server matched against, or ''. */
export function parseRaHash(e: Record<string, unknown>): string {
	return firstString(e, ['ra_hash']);
}

/**
 * The game's published achievement set, from RomM's `merged_ra_metadata`
 * blob (a 5.x-only field; the achievements screen fetches it on demand via
 * the single-rom route, so the list walk never carries it). Returns [] when
 * the blob or its achievements are absent.
 */
export function parseRaAchievements(e: Record<string, unknown>): RomRAchievement[] {
	const meta = e['merged_ra_metadata'];
	if (typeof meta !== 'object' || meta === null) return [];
	const raw = (meta as Record<string, unknown>)['achievements'];
	if (!Array.isArray(raw)) return [];

	const out: RomRAchievement[] = [];
	for (const entry of raw) {
		if (typeof entry !== 'object' || entry === null) continue;
		const a = entry as Record<string, unknown>;
		const id = raInt(a['ra_id']);
		out.push({
			id,
			title: firstString(a, ['title']) || (id > 0 ? `Achievement ${id}` : 'Achievement'),
			description: firstString(a, ['description']),
			points: raInt(a['points']),
			numAwarded: raInt(a['num_awarded']),
			numAwardedHardcore: raInt(a['num_awarded_hardcore']),
			// `badge_url`/`badge_url_lock` are absolute; the `*_path` forms
			// are the relative fallback some builds emit.
			badgeUrl: firstString(a, ['badge_url', 'badge_path']),
			badgeUrlLocked: firstString(a, ['badge_url_lock', 'badge_path_lock']),
			displayOrder: raInt(a['display_order']),
		});
	}
	return out;
}

/**
 * The user's RA progression from `GET /api/users/me` (`ra_progression`), or
 * null when the field is absent (no linked RA account in RomM, or a
 * pre-5.x server). Kept whole so the achievements screen can join it to a
 * game by `rom_ra_id`.
 */
export function parseRaProgression(e: Record<string, unknown>): RomRAProgression | null {
	const raw = e['ra_progression'];
	if (typeof raw !== 'object' || raw === null) return null;
	const p = raw as Record<string, unknown>;

	const resultsRaw = p['results'];
	const results: RomRAGameProgression[] = [];
	if (Array.isArray(resultsRaw)) {
		for (const entry of resultsRaw) {
			if (typeof entry !== 'object' || entry === null) continue;
			const r = entry as Record<string, unknown>;
			const earnedRaw = r['earned_achievements'];
			const earned: RomRAEarnedAchievement[] = [];
			if (Array.isArray(earnedRaw)) {
				for (const ea of earnedRaw) {
					if (typeof ea !== 'object' || ea === null) continue;
					const eo = ea as Record<string, unknown>;
					const eid = eo['id'];
					const idStr =
						typeof eid === 'string' ? eid : typeof eid === 'number' ? String(eid) : '';
					if (idStr === '') continue;
					earned.push({
						id: idStr,
						date: typeof eo['date'] === 'string' ? eo['date'] : '',
						dateHardcore: typeof eo['date_hardcore'] === 'string' ? eo['date_hardcore'] : null,
					});
				}
			}
			results.push({
				romRaId: raInt(r['rom_ra_id']),
				maxPossible: optInt(r['max_possible']),
				numAwarded: optInt(r['num_awarded']),
				numAwardedHardcore: optInt(r['num_awarded_hardcore']),
				mostRecentAwardedDate: optStr(r['most_recent_awarded_date']),
				highestAwardKind: optStr(r['highest_award_kind']),
				earned,
			});
		}
	}
	return { total: raInt(p['total']), results };
}

/** A small, stable string hash (djb2) — for content keys of id-less roms. */
export function hashKey(s: string): number {
	let h = 5381;
	for (let i = 0; i < s.length; i++) {
		h = ((h << 5) + h + s.charCodeAt(i)) | 0;
	}
	return h;
}
