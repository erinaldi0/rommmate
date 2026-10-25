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
 *                     description, genres, release date, rom size, play
 *                     state and the multi-disc sibling group), walked page
 *                     by page until the library is exhausted; the optional
 *                     `favorite=true` and `collection_id` filters power the
 *                     favourites and collections sections
 *   GET /api/collections — the saved collections (a 5.x-only feature)
 *
 * RomM versions drift in the details, so parsing stays defensive:
 *   - 5.x answers `limit`/`offset` with `{ items, total, limit, offset, ... }`
 *     and keeps genres / release date in a `metadatum` blob.
 *   - ≤4.x ignores those parameters and answers with a bare array (or a
 *     `data` / `results` wrapper) of its own default page size; the client
 *     then falls back to FastAPI's `_limit`/`_page` to keep paging.
 * The dialect is sniffed from the shape of the first page.
 */

/** One disc of a multi-disc release, as reported by the server. */
export interface RommSibling {
	id: number;
	/** Disc ordering key provided by the server (empty when it gave none). */
	sort: string;
	/** File name, for display in the disc picker. */
	fsName: string;
	/** Identified name, when the server knows one. */
	name: string;
	/** True when the server marks this disc as the main one. */
	isMain: boolean;
}

export interface RommGame {
	id: number;
	name: string;
	/** The server's id of the platform this rom belongs to; 0 when unknown. */
	platformId: number;
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
	/**
	 * Canonical id of the game (release) this rom belongs to: the smallest
	 * disc id of the group, or a negative content hash for unidentified roms.
	 * All discs of one game share it, so it doubles as the grouping key.
	 */
	gameKey: number;
	/** Every known disc of the game, this one included. */
	siblings: RommSibling[];
	/** True when this rom is the user-designated main disc. */
	isMain: boolean;
	/** File name (no extension) — the disc's identity in the picker. */
	fsName: string;
	/** ISO timestamp of the last play, or "" when never played. */
	lastPlayedAt: string;
	/** ISO timestamp of when the rom was added, or "" when unknown. */
	createdAt: string;
	/** True when the server reports the rom as a favourite. */
	favorite: boolean;
}

/**
 * A game as the library is actually browsed: all discs of one release
 * grouped under one title. A single-disc game is a one-disc title.
 */
export interface RommTitle {
	/** The group key (see `RommGame.gameKey`). */
	key: number;
	/** Display name of the release. */
	name: string;
	/** The server's id of the release's platform; 0 when unknown. */
	platformId: number;
	/** Platform name of the release, or of its represented disc. */
	platform: string;
	/** Cover of the main disc, else the first disc that has one. */
	coverUrl: string;
	/** Screenshot of the main disc, else the first disc that has one. */
	screenshotUrl: string;
	/** Every disc with a full entry, in the server's disc order. */
	discs: RommGame[];
	/**
	 * How many discs the release is known to have, stubs included — every
	 * sibling list seen sharpens it. It is ≥ `discs.length` (a favourites
	 * walk fetches only the favoured roms, but their sibling stubs still
	 * count the whole release), and it is what the multi-disc badge shows.
	 */
	knownDiscs: number;
	/**
	 * For each disc in `discs`: its 1-based position within the whole
	 * release (stubs included). It equals the disc's own index plus one
	 * for a full title, and keeps the badge naming the *same* disc in a
	 * partial one (a favourites walk) as in the rows that hold it all.
	 */
	discReleaseSlots: number[];
	/** Index (into `discs`) of the disc the title represents by default. */
	mainIndex: number;
	/** Latest play across the discs, "" when none. */
	lastPlayedAt: string;
	/** Latest addition across the discs, "" when unknown. */
	createdAt: string;
}

/** A saved collection on the server (RomM 5.x). */
export interface RommCollection {
	id: number;
	name: string;
	romCount: number;
	/** Absolute URL to the collection cover, or "" when none. */
	coverUrl: string;
	/**
	 * Which `collection` filter parameter selects it: regular, smart
	 * (rule-based) and virtual (search-backed) collections use distinct
	 * parameters on the roms endpoint.
	 */
	kind: 'user' | 'smart' | 'virtual';
}

/**
 * A platform as the server knows it. The dashboard shows one tile per
 * platform that has roms in the library, with the platform's own logo
 * (the same artwork the RomM web UI shows on its platforms page).
 */
export interface RommPlatform {
	id: number;
	/** Display name (a user rename wins), or "" when unknown. */
	name: string;
	/** Absolute URL to the platform's logo, or "" when it has none. */
	logoUrl: string;
	/** How many roms the server has on this platform. */
	romCount: number;
}

/**
 * A browseable section of the library dashboard. Opening one shows the
 * grid with that slice of the library.
 */
export type LibrarySection =
	| { kind: 'continue' }
	| { kind: 'favourites' }
	| { kind: 'recent' }
	| { kind: 'platform'; platform: string }
	| { kind: 'collection'; collection: RommCollection };

/** Options for a filtered `getGames` walk. */
export interface GetGamesOptions {
	/** Only roms the user marked as favourite (a 5.x filter). */
	favoriteOnly?: boolean;
	/** Only the roms of one saved collection. */
	collection?: RommCollection;
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
function modernQuery(limit: number, offset: number, extra = ''): string {
	// The web UI extras (the full rom id index, per-letter counts, filter
	// values) are not needed and would ride along on every page.
	const base = `limit=${limit}&offset=${offset}&with_rom_id_index=false&with_char_index=false&with_filter_values=false`;
	return extra === '' ? base : `${base}&${extra}`;
}

/**
 * Query string for one page of the legacy (≤4.x) dialect.
 */
function legacyQuery(page: number, extra = ''): string {
	const base = `_limit=${LEGACY_PAGE_SIZE}&_page=${page}`;
	return extra === '' ? base : `${base}&${extra}`;
}

/**
 * Turn the filter options of a walk into an extra query fragment
 * (`favorite=true`, `collection_id=…`), or '' when the walk is unfiltered.
 */
function filterQuery(options: GetGamesOptions | undefined): string {
	if (!options) return '';
	const parts: string[] = [];
	if (options.favoriteOnly) parts.push('favorite=true');
	const col = options.collection;
	if (col) {
		if (col.kind === 'smart') parts.push(`smart_collection_id=${col.id}`);
		else if (col.kind === 'virtual') parts.push(`virtual_collection_id=${col.id}`);
		else parts.push(`collection_id=${col.id}`);
	}
	return parts.join('&');
}

/** A small, stable string hash (djb2) — for content keys of id-less roms. */
function hashKey(s: string): number {
	let h = 5381;
	for (let i = 0; i < s.length; i++) {
		h = ((h << 5) + h + s.charCodeAt(i)) | 0;
	}
	return h;
}

/**
 * Group raw rom entries into titles: every disc of one release becomes a
 * single browsable game.
 *
 * The group key is the smallest disc id (unidentified roms fall back to a
 * content hash, kept negative so it can never collide with a real id).
 * Discs order by the server's `sort_comparator` when it gave one, then by
 * file name — RomM computes that key from the release structure, so it is
 * the only ordering that is right for "Disc 2" versus "disc 02" versus
 * "Part II". The title represents the user's main disc, or the first one.
 *
 * The input may be partial (a walk still streaming): a disc whose entry has
 * not arrived yet is still shown, from its sibling stub.
 *
 * @param games the rom entries, in the order the server served them.
 * @returns one title per game, first appearance first (stable across
 *          re-runs on the same input).
 */
export function groupTitles(games: RommGame[]): RommTitle[] {
	interface Bucket {
		key: number;
		order: number;
		discs: Map<string, RommGame>;
		/** Per-disc ordering key, from every sibling list seen so far. */
		sort: Map<string, string>;
		stubName: Map<string, string>;
		stubFs: Map<string, string>;
		main: Map<string, boolean>;
	}

	const buckets = new Map<number, Bucket>();

	/** The map key for one disc of a bucket: real ids, or a slot for id-less roms. */
	const slot = (bucket: Bucket, id: number): string => (id > 0 ? `${id}` : `s${bucket.discs.size}`);

	games.forEach((g, i) => {
		let b = buckets.get(g.gameKey);
		if (b === undefined) {
			b = {
				key: g.gameKey,
				order: i,
				discs: new Map(),
				sort: new Map(),
				stubName: new Map(),
				stubFs: new Map(),
				main: new Map(),
			};
			buckets.set(g.gameKey, b);
		}

		const k = slot(b, g.id);
		b.discs.set(k, g);

		// Every sibling list seen sharpens the picture of the whole group:
		// ordering, display names and the main-disc flag.
		for (const s of g.siblings) {
			const sk = s.id > 0 ? `${s.id}` : k;
			const sort = b.sort.get(sk);
			if (s.sort !== '' && (sort === undefined || sort === '')) b.sort.set(sk, s.sort);
			if (s.name !== '' && (b.stubName.get(sk) ?? '') === '') b.stubName.set(sk, s.name);
			if (s.fsName !== '' && (b.stubFs.get(sk) ?? '') === '') b.stubFs.set(sk, s.fsName);
			if (s.isMain) b.main.set(sk, true);
		}
		if (g.isMain) b.main.set(k, true);
	});

	// First-appearance order (the bucket recorded it), which keeps the
	// library in the order the server served it.
	const ordered = [...buckets.values()].sort((a, z) => a.order - z.order);

	const titles: RommTitle[] = [];
	for (const b of ordered) {
		// A disc is identified either by its own entry or by a stub left
		// behind in a sibling list; the entry wins wherever both exist.
		const keys = new Set<string>([...b.discs.keys(), ...b.sort.keys(), ...b.stubName.keys(), ...b.stubFs.keys()]);

		const discs: Array<{ key: string; game: RommGame | null; label: string; sort: string; isMain: boolean }> = [];
		for (const k of keys) {
			const game = b.discs.get(k) ?? null;
			const id = k.startsWith('s') ? 0 : Number(k);
			const label = game?.name || b.stubName.get(k) || b.stubFs.get(k) || (id > 0 ? `Game #${id}` : 'Unknown game');
			const sort = b.sort.get(k) ?? game?.fsName ?? game?.name ?? k;
			discs.push({ key: k, game, label, sort, isMain: game?.isMain === true || b.main.get(k) === true });
		}
		discs.sort((a, z) => (a.sort === z.sort ? 0 : a.sort < z.sort ? -1 : 1));

		const fullDiscs: RommGame[] = [];
		const discReleaseSlots: number[] = [];
		{
			let slot = 0;
			for (const d of discs) {
				slot += 1;
				if (d.game !== null) {
					fullDiscs.push(d.game);
					discReleaseSlots.push(slot);
				}
			}
		}
		// Stubs only cannot happen for a bucket (buckets come from entries),
		// but never emit an empty title if the shape ever does.
		if (fullDiscs.length === 0) continue;

		// The disc the title represents: the main disc when the group has
		// one, else the first in disc order. The main entry may still be
		// arriving (a streaming walk), so it is only *authoritative* for the
		// name once it is here; `mainIndex` is a position in `fullDiscs`.
		const mainSlot = discs.findIndex((d) => d.isMain);
		const shown = mainSlot >= 0 ? discs[mainSlot] : discs[0];
		let mainIndex = 0;
		if (shown.game !== null) {
			const idx = fullDiscs.findIndex((g) => g.id === shown.game?.id);
			if (idx >= 0) mainIndex = idx;
		}

		const name = shown.game?.name || shown.label;
		let coverUrl = shown.game?.coverUrl ?? '';
		if (coverUrl === '') coverUrl = fullDiscs.find((g) => g.coverUrl !== '')?.coverUrl ?? '';
		let screenshotUrl = shown.game?.screenshotUrl ?? '';
		if (screenshotUrl === '') screenshotUrl = fullDiscs.find((g) => g.screenshotUrl !== '')?.screenshotUrl ?? '';

		let lastPlayedAt = '';
		let createdAt = '';
		for (const g of fullDiscs) {
			if (g.lastPlayedAt > lastPlayedAt) lastPlayedAt = g.lastPlayedAt;
			if (g.createdAt > createdAt) createdAt = g.createdAt;
		}

		titles.push({
			key: b.key,
			name,
			platformId: shown.game?.platformId ?? fullDiscs[0].platformId,
			platform: shown.game?.platform ?? fullDiscs[0].platform,
			coverUrl,
			screenshotUrl,
			discs: fullDiscs,
			knownDiscs: discs.length,
			discReleaseSlots,
			mainIndex,
			lastPlayedAt,
			createdAt,
		});
	}

	return titles;
}

/**
 * Normalise a user-typed instance URL: trim, strip trailing slashes, and
 * make a schemeless "host:port" explicit.
 *
 * The scheme matters more than it looks: without it the URL parser treats
 * the string as *relative* and resolves it against the app's own base —
 * `romfs:/` — so `POST /api/token` becomes `POST romfs:/api/token`, which
 * nx.js rejects with `GET method must be used when fetching "romfs:"
 * protocol (got POST)`.
 */
export function normalizeBaseUrl(baseUrl: string): string {
	let base = baseUrl.trim().replace(/\/+$/, '');
	if (!/^https?:\/\//i.test(base)) {
		base = `http://${base}`;
	}
	return base;
}

export class RommClient {
	#baseUrl: string;
	#token: string;
	/** Optional callback that obtains a fresh access token on a 401. */
	#onRefresh?: () => Promise<string | null>;

	constructor(
		baseUrl: string,
		token: string,
		onRefresh?: () => Promise<string | null>,
	) {
		this.#baseUrl = normalizeBaseUrl(baseUrl);
		this.#token = token;
		this.#onRefresh = onRefresh;
	}

	/** Replace the bearer token (used after a successful token refresh). */
	setToken(token: string) {
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
	 * Perform an authenticated request, transparently refreshing the access
	 * token once on a 401 (password method) before reporting failure.
	 */
	async #request(
		path: string,
		init: RequestInit,
		signal?: AbortSignal,
		retried = false,
	): Promise<Response> {
		const res = await fetch(`${this.#baseUrl}${path}`, {
			...init,
			headers: {
				...this.#headers(),
				...(init.headers ?? {}),
			},
			signal,
		});
		if (res.status === 401 && !retried && this.#onRefresh) {
			const refreshed = await this.#onRefresh();
			if (refreshed) {
				this.setToken(refreshed);
				return this.#request(path, init, signal, true);
			}
		}
		return res;
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
			const res = await this.#request('/api/roms?limit=1', {}, signal);
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
	 * Fetch the saved collections (a RomM 5.x feature).
	 *
	 * The endpoint is absent on older servers — a normal situation, reported
	 * as an error the caller can simply ignore (the collections section is
	 * omitted).
	 */
	async getCollections(signal?: AbortSignal): Promise<{
		collections: RommCollection[];
		error: string | null;
	}> {
		let json: unknown;
		try {
			const res = await this.#request('/api/collections', {}, signal);
			if (!res.ok) {
				return {
					collections: [],
					error:
						res.status === 404
							? 'this server has no collections'
							: `HTTP ${res.status} from /api/collections`,
				};
			}
			try {
				json = await res.json();
			} catch {
				return { collections: [], error: 'malformed JSON from /api/collections' };
			}
		} catch (err) {
			return { collections: [], error: `cannot reach RomM (${String(err)})` };
		}

		// Same shape tolerance as /api/roms: a bare array, or a wrapper.
		let items: unknown[] = [];
		if (Array.isArray(json)) {
			items = json;
		} else if (typeof json === 'object' && json !== null) {
			const o = json as Record<string, unknown>;
			for (const key of ['items', 'data', 'results']) {
				if (Array.isArray(o[key])) {
					items = o[key] as unknown[];
					break;
				}
			}
		}

		const collections: RommCollection[] = [];
		for (const entry of items) {
			if (typeof entry !== 'object' || entry === null) continue;
			const e = entry as Record<string, unknown>;
			const id = typeof e['id'] === 'number' && e['id'] > 0 ? e['id'] : 0;
			if (id === 0) continue;
			// Cover: local path first, then external URL — same rule as roms.
			// Collections without an explicit cover (the auto "Favorites"
			// collection never has one) offer the covers of their members
			// in `path_covers_*`; the first is a decent stand-in.
			let cover = firstString(e, ['path_cover_large', 'path_cover_small']);
			if (cover === '') cover = firstString(e, ['url_cover']);
			if (cover === '') {
				for (const key of ['path_covers_large', 'path_covers_small']) {
					const list = e[key];
					if (Array.isArray(list)) {
						for (const c of list) {
							if (typeof c === 'string' && c.trim() !== '') {
								cover = c;
								break;
							}
						}
					}
					if (cover !== '') break;
				}
			}
			const kind =
				e['is_smart'] === true ? 'smart' : e['is_virtual'] === true ? 'virtual' : 'user';
			collections.push({
				id,
				name: firstString(e, ['name']),
				romCount: nonNegNumber(e['rom_count']) ?? 0,
				coverUrl: this.#absUrl(cover),
				kind,
			});
		}
		return { collections, error: null };
	}

	/**
	 * Fetch the server's platforms (names and logo URLs) in one request.
	 *
	 * The dashboard uses the logo as the artwork of its platforms row —
	 * a random game cover stood in for it before, which looked like the
	 * row was full of unrelated games. The list is small (a dozen or so)
	 * and needs no paging; an older server without the route just leaves
	 * the row without logos (the cover stand-in returns).
	 */
	async getPlatforms(signal?: AbortSignal): Promise<{
		platforms: RommPlatform[];
		error: string | null;
	}> {
		let json: unknown;
		try {
			const res = await this.#request('/api/platforms?limit=100', {}, signal);
			if (!res.ok) {
				return {
					platforms: [],
					error:
						res.status === 404
							? 'this server has no platform list'
							: `HTTP ${res.status} from /api/platforms`,
				};
			}
			try {
				json = await res.json();
			} catch {
				return { platforms: [], error: 'malformed JSON from /api/platforms' };
			}
		} catch (err) {
			return { platforms: [], error: `cannot reach RomM (${String(err)})` };
		}

		// Same shape tolerance as the other list routes: a bare array, or
		// a wrapper with the items under one of the usual keys.
		let items: unknown[] = [];
		if (Array.isArray(json)) {
			items = json;
		} else if (typeof json === 'object' && json !== null) {
			const o = json as Record<string, unknown>;
			for (const key of ['items', 'data', 'results']) {
				if (Array.isArray(o[key])) {
					items = o[key] as unknown[];
					break;
				}
			}
		}

		const platforms: RommPlatform[] = [];
		for (const entry of items) {
			if (typeof entry !== 'object' || entry === null) continue;
			const e = entry as Record<string, unknown>;
			const id = typeof e['id'] === 'number' && e['id'] > 0 ? e['id'] : 0;
			if (id === 0) continue;
			// A user rename wins, mirroring `parsePlatform` on the roms.
			const name =
				firstString(e, ['custom_name']) || firstString(e, ['display_name']) || firstString(e, ['name']);
			// Local (server-hosted) icon first, then the external IGDB logo.
			const logo = firstString(e, ['icon_url']) || firstString(e, ['url_logo']);
			platforms.push({
				id,
				name,
				logoUrl: this.#absUrl(logo),
				romCount: nonNegNumber(e['rom_count']) ?? 0,
			});
		}
		return { platforms, error: null };
	}

	/**
	 * GET one page of `/api/roms` and parse the JSON body.
	 *
	 * @returns the parsed JSON, or a human-readable error message.
	 */
	async #fetchPage(query: string, signal?: AbortSignal): Promise<{ json: unknown } | { error: string }> {
		try {
			const res = await this.#request('/api/roms?' + query, {}, signal);
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

		const id = typeof e['id'] === 'number' ? e['id'] : 0;
		const name = typeof e['name'] === 'string' ? e['name'].trim() : '';
		const fsName = firstString(e, ['fs_name_no_tags', 'fs_name']);

		// Per-user state: 5.x nests it in `rom_user`; the list response of
		// other versions keeps the same fields at the top level.
		const ru =
			typeof e['rom_user'] === 'object' && e['rom_user'] !== null
				? (e['rom_user'] as Record<string, unknown>)
				: e;

		// Multi-disc: `sibling_roms` is the release this rom belongs to.
		// Not every version ships it (and some omit the rom itself), so the
		// own entry is always merged in — `groupTitles` dedupes on id.
		const siblings: RommSibling[] = [];
		const src = Array.isArray(e['sibling_roms']) ? (e['sibling_roms'] as unknown[]) : [];
		let sawSelf = false;
		for (const s of src) {
			if (typeof s !== 'object' || s === null) continue;
			const so = s as Record<string, unknown>;
			const sid = typeof so['id'] === 'number' ? so['id'] : 0;
			if (sid === id && id > 0) sawSelf = true;
			siblings.push({
				id: sid,
				sort: typeof so['sort_comparator'] === 'string' ? so['sort_comparator'] : '',
				fsName: firstString(so, ['fs_name_no_tags', 'fs_name_no_ext']),
				name: typeof so['name'] === 'string' ? so['name'].trim() : '',
				isMain: so['is_main_sibling'] === true,
			});
		}
		const isMain = ru['is_main_sibling'] === true;
		if (!sawSelf) {
			siblings.push({
				id,
				sort: '',
				fsName,
				name,
				isMain,
			});
		}

		// Canonical group key: the smallest disc id. An id-less rom cannot
		// group by id, so it hashes its own content instead — kept negative
		// so it can never collide with a real id, and stable so the same
		// unidentified file groups with itself across pages.
		let gameKey = 0;
		const ids = [...siblings.map((s) => s.id)].filter((n) => n > 0);
		if (ids.length > 0) {
			gameKey = Math.min(...ids);
		} else {
			gameKey = -Math.abs(hashKey(`${name}|${parsePlatform(e)}|${firstString(e, ['summary', 'description']).slice(0, 32)}`)) - 1;
		}

		return {
			id,
			name,
			platformId: typeof e['platform_id'] === 'number' ? (e['platform_id'] as number) : 0,
			platform: parsePlatform(e),
			coverUrl: this.#absUrl(parseCover(e)),
			screenshotUrl: this.#absUrl(parseScreenshot(e)),
			summary: parseSummary(e),
			releaseDate: parseReleaseDate(e),
			genres: parseGenres(e),
			sizeBytes: parseSize(e),
			gameKey,
			siblings,
			isMain,
			fsName,
			lastPlayedAt: typeof ru['last_played'] === 'string' ? ru['last_played'] : '',
			createdAt: firstString(e, ['created_at']),
			favorite: e['favorite'] === true || ru['is_favorite'] === true,
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
	 * The walk is streaming: `onPage` is called with each page's new games
	 * as they are parsed — starting with the first page — so the UI can
	 * show the library the moment the first chunk arrives and append the
	 * rest in the background while the user browses.
	 *
	 * @param onPage called with each page's NEW games (deduplicated),
	 *               starting with the first page (possibly empty for an
	 *               empty library).
	 * @param onProgress called after each page with the number of roms
	 *                   collected so far and the total the server
	 *                   reported (null when it did not).
	 * @param signal aborts the walk: in-flight pages are cancelled and the
	 *               result comes back as `{ error: 'cancelled' }`.
	 * @returns the parsed games (all of them on success; whatever had
	 *          already arrived before a mid-walk failure otherwise),
	 *          and/or a human-readable error, and whether the walk stopped
	 *          before the library was fully read.
	 */
	async getGames(
		onPage: (batch: RommGame[]) => void,
		onProgress?: (loaded: number, total: number | null) => void,
		signal?: AbortSignal,
		options?: GetGamesOptions,
	): Promise<{ games: RommGame[]; error: string | null; truncated: boolean }> {
		const games: RommGame[] = [];
		const seen = new Set<string>();
		// Filters that older servers cannot express are skipped deliberately
		// once the dialect is known to be legacy: an ignored filter would
		// silently report the whole library (the callers treat an error
		// here as "section unavailable", which is the honest answer).
		const extra = filterQuery(options);

		/** Append the page's new entries; returns the batch that was added. */
		const addPage = (items: unknown[]): RommGame[] => {
			const batch: RommGame[] = [];
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
				batch.push(game);
			}
			return batch;
		};

		let total: number | null = null;
		let exhausted = false;
		let truncated = false;
		let rounds = 0;

		// 1. Sniff the dialect with a modern-style first page.
		const first = await this.#fetchPage(modernQuery(PAGE_SIZE, 0, extra), signal);
		if ('error' in first) {
			return signal?.aborted
				? { games, error: 'cancelled', truncated: false }
				: { games, error: first.error, truncated: false };
		}
		const firstPage = parsePage(first.json);
		if (firstPage === null) {
			return {
				games,
				error: 'unexpected response shape from /api/roms',
				truncated: false,
			};
		}
		const modern = firstPage.modern;

		// A filtered walk against a legacy server is a lie: it would answer
		// with the whole library, because the filter is not understood.
		// Report an error so the caller hides the section instead.
		if (!modern && extra !== '') {
			return {
				games: [],
				error:
					options?.favoriteOnly && (options.collection === undefined || options.collection === null)
						? 'favourites filter is not available on this server'
						: 'collections are not available on this server',
				truncated: false,
			};
		}

		let modernOffset = 0;
		let legacyPage = 1;
		// How much of the result set one page actually covers. Reserved
		// offsets advance by this (not by the requested size): a server
		// that caps the page size would otherwise leave gaps, while a
		// smaller step can only overlap — and overlaps deduplicate away.
		let effectiveLimit = PAGE_SIZE;

		let firstBatch: RommGame[] | null = null;
		if (firstPage.modern) {
			// The modern server honoured the request: page 1 is usable.
			rounds = 1;
			firstBatch = addPage(firstPage.items);
			modernOffset += firstPage.items.length;
			if (firstPage.total !== null) total = firstPage.total;

			// A page that parsed to nothing is a structural problem (a
			// schema this client does not know), not an empty library —
			// say so instead of walking 50 garbage pages.
			if (firstPage.items.length > 0 && games.length === 0) {
				return {
					games,
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

		// The first usable page is the moment the UI can show the library
		// (it fires even for an empty library: the grid's empty state).
		if (firstBatch !== null) onPage(firstBatch);
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
						? modernQuery(PAGE_SIZE, modernOffset, extra)
						: legacyQuery(legacyPage, extra),
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
					return { games, error: 'cancelled', truncated: false };
				}
				if (result.status === 'rejected') {
					return signal?.aborted
						? { games, error: 'cancelled', truncated: false }
						: {
								games,
								error: `cannot reach RomM (${String(result.reason)})`,
								truncated: false,
							};
				}
				if ('error' in result.value) {
					// A mid-walk failure is not thrown away: the UI already
					// shows everything that arrived, so hand that back
					// alongside the error (the status line reports it).
					return { games, error: result.value.error, truncated: false };
				}
				const shape = parsePage(result.value.json);
				if (shape === null) {
					return {
						games,
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

				const batch = addPage(shape.items);

				// A full page that contains nothing new means the server is
				// not advancing (it ignores the page parameters): stop, and
				// mark the walk as truncated because the library may
				// continue beyond it.
				if (!exhausted && full && shape.items.length > 0 && batch.length === 0) {
					exhausted = true;
					truncated = true;
				}

				if (!exhausted && total !== null && games.length >= total) {
					exhausted = true;
				}

				onPage(batch);
				onProgress?.(games.length, total);
			}
		}

		// Aborted (possibly between batches, where the loop exits quietly):
		// report it, so a caller cannot mistake a partial walk for a
		// completed one.
		if (signal?.aborted) {
			return { games, error: 'cancelled', truncated: false };
		}

		// Leaving the loop with the last page still full means the safety
		// cap was hit while the library continued — everything fetched is
		// kept, but the count is not the whole library.
		if (!exhausted) truncated = true;

		return { games, error: null, truncated };
	}
}
