/**
 * RomM REST client — TypeScript port of the v1 C++/libcurl implementation
 * (see git history 6cc4721 for the original; kept as reference for the
 * defensive JSON shapes).
 *
 * Auth: long-lived RomM Client API Token ("rmm_...") sent as
 * `Authorization: Bearer <token>` on every request.
 *
 * Endpoints used:
 *   GET /api/roms   — the game list (name, platform, cover art, screenshot,
 *                     description, genres, release date and rom size),
 *                     walked page by page until the library is exhausted
 *
 * RomM versions drift in the details, so parsing stays defensive:
 *   - 5.x answers `limit`/`offset` with `{ items, total, limit, offset, ... }`
 *     and keeps genres / release date in a `metadatum` blob.
 *   - ≤4.x ignores those parameters and answers with a bare array (or a
 *     `data` / `results` wrapper) of its own default page size; the client
 *     then falls back to FastAPI's `_limit`/`_page` to keep paging.
 * The dialect is sniffed from the shape of the first page.
 */

export interface RommGame {
	id: number;
	name: string;
	/** e.g. "Nintendo 64" — empty when unknown. */
	platform: string;
	/** Absolute URL to cover art, or "" when none. */
	coverUrl: string;
	/** Absolute URL to a 16:9 screenshot, or "" when none. */
	screenshotUrl: string;
	/** Long description, or "" when unknown. */
	summary: string;
	/** Release date (`YYYY-MM-DD`), or "" when unknown. */
	releaseDate: string;
	/** Genre names — empty when unknown. */
	genres: string[];
	/** Size of the rom file in bytes; 0 when unknown. */
	sizeBytes: number;
}

/**
 * How many roms to request per page. 100 sits comfortably inside the page
 * size bounds of every RomM generation (5.x allows up to 10000, the older
 * FastAPI-backed builds cap at 100–1000).
 */
const PAGE_SIZE = 100;

/**
 * Older builds are asked for the smaller 50 — that is the FastAPI default,
 * so a page that comes back full of it is guaranteed to be a full page.
 * (Requesting more risks the server capping the page, which would make a
 * genuinely full page look short and end the walk early.)
 */
const LEGACY_PAGE_SIZE = 50;

/**
 * Safety cap on the number of pages, so a server that refuses to advance
 * (or that grows while the library is being walked) cannot loop forever.
 * 50 pages cover 5000 roms on the modern dialect — far beyond any real
 * Switch library.
 */
const MAX_PAGES = 50;

/**
 * How many pages may be in flight at once. nx.js is a single V8 thread, but
 * the network is not: fanning the walk out across a few concurrent `fetch`es
 * turns a 13-page waterfall into three or four waves, while each in-flight
 * page is only a few hundred KB of JSON.
 */
const PAGE_CONCURRENCY = 4;

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
function firstString(source: Record<string, unknown>, keys: string[]): string {
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
function nonNegNumber(v: unknown): number | null {
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
function parsePlatform(e: Record<string, unknown>): string {
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
function parseCover(e: Record<string, unknown>): string {
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
function parseScreenshot(e: Record<string, unknown>): string {
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
function parseSize(e: Record<string, unknown>): number {
	return firstNumber(e, ['fs_size_bytes', 'rom_size_bytes', 'rom_size']);
}

/** Short description. `summary` in both major versions; `description` on older builds. */
function parseSummary(e: Record<string, unknown>): string {
	return firstString(e, ['summary', 'description', 'bios']);
}

/**
 * Genres arrive as `[{ id, name }]` on current RomM, but some versions (and
 * some imports) use plain strings. Both are accepted. 5.x nests them in
 * `metadatum`; ≤4.x keeps them at the top level.
 */
function parseGenres(e: Record<string, unknown>): string[] {
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
function parseReleaseDate(e: Record<string, unknown>): string {
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
 * Unwrap one page of `/api/roms` into a rom entry array.
 *
 *   5.x   : { "items": [...], "total": n, "limit": n, "offset": n, ... }
 *   ≤4.x  : [ ... ]  |  { "data": [...] }  |  { "results": [...] }
 *
 * `modern` tells the caller which request dialect produced the page (a
 * `results` wrapper from an old build is still the legacy dialect, even
 * though it is a wrapper).
 *
 * @returns the entries and the total the server reported (null when it did
 *          not), or null for a shape this client does not recognise.
 */
function parsePage(j: unknown): {
	items: unknown[];
	total: number | null;
	modern: boolean;
} | null {
	if (Array.isArray(j)) {
		return { items: j, total: null, modern: false };
	}
	if (typeof j === 'object' && j !== null) {
		const o = j as Record<string, unknown>;
		if (Array.isArray(o['items'])) {
			return { items: o['items'], total: nonNegNumber(o['total']), modern: true };
		}
		for (const key of ['data', 'results']) {
			if (Array.isArray(o[key])) {
				return { items: o[key] as unknown[], total: nonNegNumber(o['total']), modern: false };
			}
		}
	}
	return null;
}

/** Query string for one page of the modern (5.x) dialect. */
function modernQuery(limit: number, offset: number): string {
	// The web UI extras (the full rom id index, per-letter counts, filter
	// values) are not needed and would ride along on every page.
	return `limit=${limit}&offset=${offset}&with_rom_id_index=false&with_char_index=false&with_filter_values=false`;
}

export class RommClient {
	#baseUrl: string;
	#token: string;

	constructor(baseUrl: string, token: string) {
		// Normalise: strip trailing slashes so `baseUrl + path` joining never
		// produces "http://host//api/...".
		let base = baseUrl.trim().replace(/\/+$/, '');
		// A schemeless "host:port" is what people actually type; make the
		// scheme explicit so every transport (nx.js fetch, preview browser)
		// resolves it the same way.
		if (!/^https?:\/\//i.test(base)) {
			base = `http://${base}`;
		}
		this.#baseUrl = base;
		this.#token = token;
	}

	get base(): string {
		return this.#baseUrl;
	}

	#headers(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.#token}`,
			Accept: 'application/json',
		};
	}

	/**
	 * Resolve a (possibly relative) RomM asset path to an absolute URL.
	 *
	 * RomM stamps local asset paths with a `?ts=<date>` cache buster that
	 * contains a literal space (`?ts=2026-09-25 16:19:19`). `fetch` is
	 * supposed to percent-encode that itself, but it is normalised here so
	 * every transport (nx.js, browser preview) sees a clean URL.
	 */
	#absUrl(maybeRelative: string): string {
		if (!maybeRelative) return '';
		const url =
			maybeRelative.startsWith('http://') || maybeRelative.startsWith('https://')
				? maybeRelative
				: this.#baseUrl + (maybeRelative.startsWith('/') ? '' : '/') + maybeRelative;
		return url.replace(/ /g, '%20');
	}

	/**
	 * Validate the token with a lightweight authenticated GET. RomM
	 * authorises every /api route against the token, so a 200 proves the
	 * token works without pulling a large payload.
	 *
	 * The probe uses `/api/roms` rather than the older `/api/library`: the
	 * roms route exists in every RomM generation, while `/api/library` was
	 * removed in 5.x and would 404 there.
	 *
	 * @returns null on success, or a human-readable error message.
	 */
	async authenticate(signal?: AbortSignal): Promise<string | null> {
		try {
			const res = await fetch(this.#baseUrl + '/api/roms?limit=1', {
				headers: this.#headers(),
				signal,
			});
			if (res.status === 200) return null;
			if (res.status === 401 || res.status === 403) return 'invalid RomM API token';
			// A 404 on /api/roms means the server answered but does not
			// serve the API at that path — almost always a base-path issue
			// (RomM behind a reverse proxy at /romm/ or similar).
			if (res.status === 404) {
				return 'HTTP 404 from /api/roms — check the Base URL (sub-path?)';
			}
			return `server returned HTTP ${res.status}`;
		} catch (err) {
			return `cannot reach RomM (${String(err)})`;
		}
	}

	/**
	 * GET one page of `/api/roms` and parse the JSON body.
	 *
	 * @returns the parsed JSON, or a human-readable error message.
	 */
	async #fetchPage(query: string, signal?: AbortSignal): Promise<{ json: unknown } | { error: string }> {
		try {
			const res = await fetch(this.#baseUrl + '/api/roms?' + query, {
				headers: this.#headers(),
				signal,
			});
			if (!res.ok) {
				return { error: `HTTP ${res.status} from /api/roms` };
			}
			try {
				return { json: await res.json() };
			} catch {
				return { error: 'malformed JSON from /api/roms' };
			}
		} catch (err) {
			return { error: `cannot reach RomM (${String(err)})` };
		}
	}

	/**
	 * Parse one rom entry (any RomM generation) into a `RommGame`.
	 *
	 * @returns the game, or null for an entry that is not even an object.
	 */
	#parseRom(entry: unknown): RommGame | null {
		if (typeof entry !== 'object' || entry === null) return null;
		const e = entry as Record<string, unknown>;

		return {
			id: typeof e['id'] === 'number' ? e['id'] : 0,
			name: typeof e['name'] === 'string' ? e['name'].trim() : '',
			platform: parsePlatform(e),
			coverUrl: this.#absUrl(parseCover(e)),
			screenshotUrl: this.#absUrl(parseScreenshot(e)),
			summary: parseSummary(e),
			releaseDate: parseReleaseDate(e),
			genres: parseGenres(e),
			sizeBytes: parseSize(e),
		};
	}

	/**
	 * Fetch the user's whole game/ROM list, walking `/api/roms` page by
	 * page until the library is exhausted.
	 *
	 * The page size and the response wrapper differ between RomM
	 * generations, so the first page is requested in the modern (5.x)
	 * style and its shape picks the dialect for the rest of the walk:
	 *   - the modern server honours `limit`/`offset`, so the sniff page
	 *     is used as-is and pages advance by offset;
	 *   - a ≤4.x server ignored those parameters (its default page size
	 *     came back), so that page is discarded and the walk restarts
	 *     from page 1 in the legacy `_limit`/`_page` dialect.
	 *
	 * The walk stops on a short page, on reaching the reported total, on a
	 * page that adds no new roms (a server that will not advance), or on
	 * the `MAX_PAGES` safety cap.
	 *
	 * Pages are fetched `PAGE_CONCURRENCY` at a time: the network is the
	 * slow part, and nx.js's `fetch` runs off the V8 thread, so the UI
	 * keeps its input loop and repaints while the walk is in flight.
	 *
	 * @param onProgress called after each page with the number of roms
	 *                   collected so far and the total the server
	 *                   reported (null when it did not).
	 * @param signal aborts the walk: in-flight pages are cancelled and the
	 *               result comes back as `{ error: 'cancelled' }`.
	 * @returns the parsed games, and/or a human-readable error, and
	 *          whether the walk stopped before the library was fully read.
	 */
	async getGames(
		onProgress?: (loaded: number, total: number | null) => void,
		signal?: AbortSignal,
	): Promise<{ games: RommGame[]; error: string | null; truncated: boolean }> {
		const games: RommGame[] = [];
		const seen = new Set<string>();

		/** Append the page's new entries; returns how many were added. */
		const addPage = (items: unknown[]): number => {
			let added = 0;
			for (const entry of items) {
				const game = this.#parseRom(entry);
				if (game === null) continue;
				// An id-less (unidentified) rom falls back to its content,
				// so identical garbage entries collapse into one tile.
				const key =
					game.id > 0
						? `id:${game.id}`
						: `s:${game.name}|${game.platform}|${game.summary.slice(0, 32)}`;
				if (seen.has(key)) continue;
				seen.add(key);
				games.push(game);
				added += 1;
			}
			return added;
		};

		let total: number | null = null;
		let exhausted = false;
		let truncated = false;
		let rounds = 0;

		// 1. Sniff the dialect with a modern-style first page.
		const first = await this.#fetchPage(modernQuery(PAGE_SIZE, 0), signal);
		if ('error' in first) {
			return signal?.aborted
				? { games: [], error: 'cancelled', truncated: false }
				: { games: [], error: first.error, truncated: false };
		}
		const firstPage = parsePage(first.json);
		if (firstPage === null) {
			return {
				games: [],
				error: 'unexpected response shape from /api/roms',
				truncated: false,
			};
		}
		const modern = firstPage.modern;

		let modernOffset = 0;
		let legacyPage = 1;
		// How much of the result set one page actually covers. Reserved
		// offsets advance by this (not by the requested size): a server
		// that caps the page size would otherwise leave gaps, while a
		// smaller step can only overlap — and overlaps deduplicate away.
		let effectiveLimit = PAGE_SIZE;

		if (firstPage.modern) {
			// The modern server honoured the request: page 1 is usable.
			rounds = 1;
			addPage(firstPage.items);
			modernOffset += firstPage.items.length;
			if (firstPage.total !== null) total = firstPage.total;

			// A page that parsed to nothing is a structural problem (a
			// schema this client does not know), not an empty library —
			// say so instead of walking 50 garbage pages.
			if (firstPage.items.length > 0 && games.length === 0) {
				return {
					games: [],
					error: 'could not parse any games from /api/roms',
					truncated: false,
				};
			}

			// The echoed `limit` is the page size the server actually used
			// (it may cap a larger request); a full page has that many.
			const eff = nonNegNumber((first.json as Record<string, unknown>)['limit']) ?? PAGE_SIZE;
			effectiveLimit = Math.min(effectiveLimit, eff);
			const full = firstPage.items.length >= eff;
			if (!full) {
				exhausted = true;
			} else if (total !== null && games.length >= total) {
				exhausted = true;
			}
		} else {
			// Legacy: the sniff page came back at the server's own default
			// size, so it is discarded and the walk restarts from page 1.
			if (firstPage.total !== null) total = firstPage.total;
		}

		onProgress?.(games.length, total);

		// 2. Walk the remaining pages in parallel batches until the library
		//    is exhausted. Page coordinates are reserved before the batch
		//    fires (the walk must keep advancing to terminate) and results
		//    are processed in request order, so the library keeps the
		//    server's ordering even if the pages land in any order.
		while (!exhausted && rounds < MAX_PAGES && !signal?.aborted) {
			const queries: string[] = [];
			for (let i = 0; i < PAGE_CONCURRENCY; i++) {
				if (exhausted || rounds >= MAX_PAGES || signal?.aborted) break;
				if (total !== null && games.length >= total) {
					exhausted = true;
					break;
				}
				// With a known total, reserve only as many pages as the
				// library still needs — nothing is fetched past the end.
				// (If the library grows mid-walk, the fresh total from the
				// last page keeps the walk going; a short page is the
				// final arbiter either way.)
				if (modern && total !== null && i >= Math.ceil((total - games.length) / effectiveLimit)) {
					break;
				}
				queries.push(
					modern
						? modernQuery(PAGE_SIZE, modernOffset)
						: `_limit=${LEGACY_PAGE_SIZE}&_page=${legacyPage}`,
				);
				if (modern) {
					modernOffset += effectiveLimit;
				} else {
					// `_page` is 1-based and the server computes the window
					// from its own effective limit, so no gaps are possible.
					legacyPage += 1;
				}
				rounds += 1;
			}
			if (queries.length === 0) break;

			const results = await Promise.allSettled(
				queries.map((q) => this.#fetchPage(q, signal)),
			);

			for (const result of results) {
				// Aborted: the remaining in-flight pages reject on their
				// own; the walk simply stops caring about them.
				if (signal?.aborted) {
					return { games: [], error: 'cancelled', truncated: false };
				}
				if (result.status === 'rejected') {
					return signal?.aborted
						? { games: [], error: 'cancelled', truncated: false }
						: {
								games: [],
								error: `cannot reach RomM (${String(result.reason)})`,
								truncated: false,
							};
				}
				if ('error' in result.value) {
					// A mid-walk failure is a hard failure: partial libraries
					// silently lose their filter chips and totals.
					return { games: [], error: result.value.error, truncated: false };
				}
				const shape = parsePage(result.value.json);
				if (shape === null) {
					return {
						games: [],
						error: 'unexpected response shape from /api/roms',
						truncated: false,
					};
				}
				if (shape.total !== null) total = shape.total;

				// A full page has as many entries as the server actually
				// served (its echoed `limit` on 5.x, our request on ≤4.x).
				const eff = modern
					? (nonNegNumber((result.value.json as Record<string, unknown>)['limit']) ?? PAGE_SIZE)
					: LEGACY_PAGE_SIZE;
				const full = shape.items.length >= eff;
				if (modern) {
					effectiveLimit = Math.min(effectiveLimit, eff);
				}

				if (!full) {
					exhausted = true;
				}

				const added = addPage(shape.items);

				// A full page that contains nothing new means the server is
				// not advancing (it ignores the page parameters): stop, and
				// mark the walk as truncated because the library may
				// continue beyond it.
				if (!exhausted && full && shape.items.length > 0 && added === 0) {
					exhausted = true;
					truncated = true;
				}

				if (!exhausted && total !== null && games.length >= total) {
					exhausted = true;
				}

				onProgress?.(games.length, total);
			}
		}

		// Aborted (possibly between batches, where the loop exits quietly):
		// report it, so a caller cannot mistake a partial walk for a
		// completed one.
		if (signal?.aborted) {
			return { games: [], error: 'cancelled', truncated: false };
		}

		// Leaving the loop with the last page still full means the safety
		// cap was hit while the library continued — everything fetched is
		// kept, but the count is not the whole library.
		if (!exhausted) truncated = true;

		return { games, error: null, truncated };
	}
}
