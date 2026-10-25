/**
 * The client: an authenticated `fetch` wrapper (with one-shot 401 token
 * refresh) around RomM's `/api` routes — the roms walk, collections,
 * platforms, and the connect probe.
 */
import {
	firstString,
	hashKey,
	nonNegNumber,
	parseCover,
	parseFiles,
	parseGenres,
	parsePlatform,
	parseReleaseDate,
	parseScreenshot,
	parseSize,
	parseSummary,
} from './parse';
import {
	LEGACY_PAGE_SIZE,
	MAX_PAGES,
	PAGE_CONCURRENCY,
	PAGE_SIZE,
	filterQuery,
	legacyQuery,
	modernQuery,
	parsePage,
} from './dialect';
import type { GetGamesOptions, RommCollection, RommGame, RommPlatform, RommSibling } from './types';

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
	 * The raw authenticated request, exposed for the Play module
	 * (`romm/play.ts`): firmware, saves, states, sync, devices and
	 * play-sessions all reuse the client's token and its one-shot 401
	 * refresh instead of re-implementing either.
	 */
	request(path: string, init?: RequestInit, signal?: AbortSignal): Promise<Response> {
		return this.#request(path, init ?? {}, signal);
	}

	/** The `#absUrl` normalisation as a public helper (the `?ts=` space). */
	absUrl(maybeRelative: string): string {
		return this.#absUrl(maybeRelative);
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
			md5Hash: firstString(e, ['md5_hash']),
			files: parseFiles(e),
			hasMultipleFiles: e['has_multiple_files'] === true,
		};
	}

	/**
	 * Fetch one rom by id (the single-rom route, which carries the full
	 * `files` array on 5.x even when the list omits it).
	 *
	 * @returns the parsed game, or null on any failure (a 404 means the
	 *          rom is gone, which is not an error worth surfacing).
	 */
	async getRom(
		id: number,
		signal?: AbortSignal,
	): Promise<{ game: RommGame | null; error: string | null }> {
		try {
			const res = await this.#request(`/api/roms/${id}`, {}, signal);
			if (res.status === 404) return { game: null, error: null };
			if (!res.ok) return { game: null, error: `HTTP ${res.status}` };
			const json: unknown = await res.json();
			const game = this.#parseRom(json);
			return { game, error: null };
		} catch (err) {
			if (signal?.aborted) return { game: null, error: 'cancelled' };
			return { game: null, error: String(err) };
		}
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
					options !== undefined && options.platformId !== undefined && !options.favoriteOnly && options.collection === undefined
						? 'the platform filter is not available on this server'
						: options?.favoriteOnly && (options.collection === undefined || options.collection === null)
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
