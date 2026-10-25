/**
 * Defensive per-field parsers for one rom entry.
 *
 * RomM generations disagree about where every field lives (flat vs a
 * `metadatum` blob, local paths vs external URLs, seconds vs milliseconds),
 * so each parser tries the known shapes in order and returns the first
 * sensible value — an unknown schema degrades to an empty field instead of
 * a parse failure. `RommClient` runs every entry through these.
 */

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
/** A small, stable string hash (djb2) — for content keys of id-less roms. */
export function hashKey(s: string): number {
	let h = 5381;
	for (let i = 0; i < s.length; i++) {
		h = ((h << 5) + h + s.charCodeAt(i)) | 0;
	}
	return h;
}
