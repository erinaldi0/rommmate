/**
 * The two API dialects the walk understands: how to ask for a page, how big
 * a page is, and what shape the answer comes back in. The client sniffs the
 * dialect from the first page (`parsePage`) and keeps using it.
 */
import { nonNegNumber } from './parse';
import type { GetGamesOptions } from './types';

/**
 * How many roms to request per page. 100 sits comfortably inside the page
 * size bounds of every RomM generation (5.x allows up to 10000, the older
 * FastAPI-backed builds cap at 100–1000).
 */
export const PAGE_SIZE = 100;

/**
 * Older builds are asked for the smaller 50 — that is the FastAPI default,
 * so a page that comes back full of it is guaranteed to be a full page.
 * (Requesting more risks the server capping the page, which would make a
 * genuinely full page look short and end the walk early.)
 */
export const LEGACY_PAGE_SIZE = 50;

/**
 * Safety cap on the number of pages, so a server that refuses to advance
 * (or that grows while the library is being walked) cannot loop forever.
 * 50 pages cover 5000 roms on the modern dialect — far beyond any real
 * Switch library.
 */
export const MAX_PAGES = 50;

/**
 * How many pages may be in flight at once. nx.js is a single V8 thread, but
 * the network is not: fanning the walk out across a few concurrent `fetch`es
 * turns a 13-page waterfall into three or four waves, while each in-flight
 * page is only a few hundred KB of JSON.
 */
export const PAGE_CONCURRENCY = 4;
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
export function parsePage(j: unknown): {
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
export function modernQuery(limit: number, offset: number, extra = ''): string {
	// The web UI extras (the full rom id index, per-letter counts, filter
	// values) are not needed and would ride along on every page.
	const base = `limit=${limit}&offset=${offset}&with_rom_id_index=false&with_char_index=false&with_filter_values=false`;
	return extra === '' ? base : `${base}&${extra}`;
}

/**
 * Query string for one page of the legacy (≤4.x) dialect.
 */
export function legacyQuery(page: number, extra = ''): string {
	const base = `_limit=${LEGACY_PAGE_SIZE}&_page=${page}`;
	return extra === '' ? base : `${base}&${extra}`;
}

/**
 * Turn the filter options of a walk into an extra query fragment
 * (`favorite=true`, `collection_id=…`), or '' when the walk is unfiltered.
 */
export function filterQuery(options: GetGamesOptions | undefined): string {
	if (!options) return '';
	const parts: string[] = [];
	if (options.favoriteOnly) parts.push('favorite=true');
	if (options.platformId !== undefined && options.platformId > 0) {
		parts.push(`platform_id=${options.platformId}`);
	}
	if (options.updatedAfter !== undefined && options.updatedAfter !== '') {
		parts.push(`updated_after=${encodeURIComponent(options.updatedAfter)}`);
	}
	const col = options.collection;
	if (col) {
		if (col.kind === 'smart') parts.push(`smart_collection_id=${col.id}`);
		else if (col.kind === 'virtual') parts.push(`virtual_collection_id=${col.id}`);
		else parts.push(`collection_id=${col.id}`);
	}
	return parts.join('&');
}
