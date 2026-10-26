/**
 * The dashboard's row model: how the library is summarised into the
 * horizontal rows of `LibrarySections`, and each row's cover tiles.
 *
 * The platform row is deliberately not built here: the redesigned dashboard
 * shows platforms as a strip of logo chips rather than as cover tiles, so
 * `buildPlatformChips` (the same aggregation, a different shape) builds it
 * separately.
 *
 * Pure construction, no React: a row is a label, a count, what A opens,
 * and up to `MAX_TILES` covers. Empty rows are simply not built, so a
 * fresh library shows only the rows that have something to say. Kept out
 * of the screen file so the row rules are readable (and testable) on
 * their own.
 */
import type { Fit } from '../../covers';
import { relativeTime, formatDate } from '../../time';
import type { LibrarySection, RommCollection, RommPlatform, RommTitle } from '../../romm';

/** A cover tile of one row. Exported for the row renderers. */
export interface Tile {
	key: string;
	coverUrl: string;
	/** First line under the cover. */
	name: string;
	/** Second line (relative time, count, date…). */
	sub: string;
	/** How the artwork fits the cover box (platform logos letterbox). */
	fit?: Fit;
	/** The disc the tile shows, for multi-disc titles. */
	discIndex?: number;
	/**
	 * The shown disc's 0-based position in `title.discs` — what the hero
	 * preview indexes the title's discs with (`discIndex` is the 1-based
	 * release slot the badge prints; the two only agree on single-disc
	 * titles).
	 */
	discRealIndex?: number;
	discCount?: number;
	/** What A does with this cover (title tiles open the title instead). */
	section?: LibrarySection;
	title?: RommTitle;
}

interface Row {
	id: string;
	/** The header above the row. */
	label: string;
	/** The small count after the header. */
	countLabel: string;
	/**
	 * What A on the header opens. Null for rows that are pure browsing
	 * aids (platforms, recent, collections — their covers navigate): the
	 * library is never shown whole, so their headers open nothing.
	 */
	section: LibrarySection | null;
	tiles: Tile[];
}
/** How many covers one row shows; the rest live in the row's grid. */
export const MAX_TILES = 9;

/** One platform chip of the strip row. */
export interface PlatformChip {
	key: string;
	name: string;
	/** The platform's own logo, or '' (a text-only chip is drawn). */
	logoUrl: string;
	/** How many roms this platform holds in the library. */
	count: number;
	section: LibrarySection;
}

/**
 * The platforms strip: every platform the library has roms for, the
 * biggest libraries first, wearing the platform's own logo (the same
 * artwork the RomM web UI shows). A platform the server reports no logo
 * for renders as a text-only chip.
 */
export function buildPlatformChips(
	titles: RommTitle[],
	platforms: RommPlatform[]
): PlatformChip[] {
	const platformById = new Map<number, RommPlatform>();
	for (const p of platforms) {
		if (p.id > 0) platformById.set(p.id, p);
	}
	const byPlatform = new Map<string, { count: number; platformId: number }>();
	for (const t of titles) {
		if (t.platform === '') continue;
		const entry = byPlatform.get(t.platform);
		if (entry === undefined) {
			byPlatform.set(t.platform, { count: 1, platformId: t.platformId });
		} else {
			entry.count += 1;
		}
	}
	return [...byPlatform.entries()]
		.sort((a, b) => (a[1].count !== b[1].count ? b[1].count - a[1].count : a[0] < b[0] ? -1 : 1))
		.map(([name, info]) => {
			const known = info.platformId > 0 ? platformById.get(info.platformId) : undefined;
			return {
				key: `platform-${name}`,
				name,
				logoUrl: known?.logoUrl ?? '',
				count: info.count,
				section: { kind: 'platform' as const, platform: name },
			};
		});
}

export function buildRows(
	titles: RommTitle[],
	favoriteTitles: RommTitle[],
	platforms: RommPlatform[],
	collections: RommCollection[],
	discSelections: Record<number, number>,
): Row[] {
	const out: Row[] = [];

	const played = titles
		.filter((t) => t.lastPlayedAt !== '')
		.sort((a, b) => (a.lastPlayedAt > b.lastPlayedAt ? -1 : a.lastPlayedAt < b.lastPlayedAt ? 1 : 0))
		.slice(0, MAX_TILES);
	if (played.length > 0) {
		out.push({
			id: 'continue',
			label: 'Continue playing',
			countLabel: `${titles.filter((t) => t.lastPlayedAt !== '').length} played`,
			section: { kind: 'continue' },
			tiles: played.map((t) => tileFromTitle(t, discSelections, relativeTime(t.lastPlayedAt))),
		});
	}

	const favs = favoriteTitles
		.slice()
		.sort((a, b) => (a.lastPlayedAt > b.lastPlayedAt ? -1 : a.lastPlayedAt < b.lastPlayedAt ? 1 : 0))
		.slice(0, MAX_TILES);
	if (favs.length > 0) {
		out.push({
			id: 'favourites',
			label: 'Favourites',
			countLabel: `${favoriteTitles.length} games`,
			section: { kind: 'favourites' },
			tiles: favs.map((t) =>
				tileFromTitle(t, discSelections, relativeTime(t.lastPlayedAt) || 'favourite'),
			),
		});
	}

	// (The platforms row moved into `buildPlatformChips`: the redesigned
	// dashboard renders platforms as a logo-chip strip, not cover tiles.)
	const recent = titles
		.filter((t) => t.createdAt !== '')
		.sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0))
		.slice(0, MAX_TILES);
	if (recent.length > 0) {
		out.push({
			id: 'recent',
			label: 'Recently added',
			countLabel: `${titles.filter((t) => t.createdAt !== '').length} games`,
			section: null, // a browsing aid: its covers open titles, never a grid
			tiles: recent.map((t) => tileFromTitle(t, discSelections, formatDate(t.createdAt))),
		});
	}

	if (collections.length > 0) {
		out.push({
			id: 'collections',
			label: 'Collections',
			countLabel: `${collections.length} ${collections.length === 1 ? 'collection' : 'collections'}`,
			section: null, // ditto
			tiles: collections.slice(0, MAX_TILES).map((c) => ({
				key: `collection-${c.id}`,
				coverUrl: c.coverUrl,
				name: c.name === '' ? `Collection ${c.id}` : c.name,
				sub: `${c.romCount} ${c.romCount === 1 ? 'rom' : 'roms'}`,
				section: { kind: 'collection', collection: c },
			})),
		});
	}

return out;
}

/**
 * A row as the screen displays it: `buildRows`'s tile rows with the
 * platform strip spliced in between Favourites and Recently added.
 */
export interface DisplayRow {
	id: string;
	/** The header above the row. */
	label: string;
	/** The small count after the header. */
	countLabel: string;
	/**
	 * What A on the header opens. Null for rows that are pure browsing
	 * aids (platforms, recent, collections — their covers navigate): the
	 * library is never shown whole, so their headers open nothing.
	 */
	section: LibrarySection | null;
	/** 'chips' rows render their chips instead of cover tiles. */
	kind: 'tiles' | 'chips';
	tiles: Tile[];
	chips: PlatformChip[];
}

/**
 * The dashboard's displayed rows, in screen order. An empty library yields
 * no rows at all (the screen then shows its empty state).
 */
export function buildDisplayRows(
	titles: RommTitle[],
	favoriteTitles: RommTitle[],
	platforms: RommPlatform[],
	collections: RommCollection[],
	discSelections: Record<number, number>,
): DisplayRow[] {
	const tileRows = buildRows(titles, favoriteTitles, platforms, collections, discSelections);
	const chips = buildPlatformChips(titles, platforms);
	const out: DisplayRow[] = [];
	let chipsPlaced = chips.length === 0;
	for (const r of tileRows) {
		if (r.id === 'recent' && !chipsPlaced) {
			out.push(makeChipsRow(chips));
			chipsPlaced = true;
		}
		out.push({ ...r, kind: 'tiles', chips: [] });
	}
	if (!chipsPlaced) out.push(makeChipsRow(chips));
	return out;
}

function makeChipsRow(chips: PlatformChip[]): DisplayRow {
	return {
		id: 'platforms',
		label: 'Platforms',
		countLabel: `${chips.length} ${chips.length === 1 ? 'platform' : 'platforms'}`,
		section: null, // chips navigate (into the platform's grid)
		kind: 'chips',
		tiles: [],
		chips,
	};
}

/**
 * A title as a row cover: the disc the tile represents (the player's choice,
 * else the release's main disc), its name, and a badge when the release has
 * several discs.
 */
function tileFromTitle(
t: RommTitle,
discSelections: Record<number, number>,
sub: string,
): Tile {
const index = discSelections[t.key] ?? t.mainIndex;
const realIndex = Math.min(index, t.discs.length - 1);
const disc = t.discs[realIndex] ?? t.discs[0];
// The badge counts the whole release (`knownDiscs`), not just the discs
// this list happens to hold: a favourites walk fetches only the
// favoured roms, but their sibling stubs still count the release — so a
// 4-disc game badges in favourites exactly as it does in the grid. The
// number itself is the disc's position in the release (stubs included),
// so the same disc wears the same badge in every row.
const releaseSlot = t.discReleaseSlots[realIndex] ?? realIndex + 1;
return {
	key: `title-${t.key}`,
	coverUrl: disc?.coverUrl !== '' && disc?.coverUrl !== undefined ? disc.coverUrl : t.coverUrl,
	name: t.name,
	sub,
	discIndex: t.knownDiscs > 1 ? releaseSlot : undefined,
	discRealIndex: realIndex,
	discCount: t.knownDiscs > 1 ? t.knownDiscs : undefined,
	title: t,
};
}
