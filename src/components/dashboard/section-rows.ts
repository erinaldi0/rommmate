/**
 * The dashboard's row model: how the library is summarised into the five
 * horizontal rows of `LibrarySections`, and each row's cover tiles.
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

interface Tile {
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
	discCount?: number;
	/** What A does with this cover. */
	section: LibrarySection;
	title?: RommTitle;
}

interface Row {
	id: string;
	/** The header above the row. */
	label: string;
	/** The small count after the header. */
	countLabel: string;
	/** What A on the header opens. */
	section: LibrarySection;
	tiles: Tile[];
}
/** How many covers one row shows; the rest live in the row's grid. */
export const MAX_TILES = 9;
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

	// Platforms: the platform's own logo per row (the same artwork the
	// RomM web UI shows), the biggest libraries first. A platform the
	// server reports no logo for falls back to one of its covers.
	const platformById = new Map<number, RommPlatform>();
	for (const p of platforms) {
		if (p.id > 0) platformById.set(p.id, p);
	}
	const byPlatform = new Map<string, { count: number; cover: string; platformId: number }>();
	for (const t of titles) {
		if (t.platform === '') continue;
		const entry = byPlatform.get(t.platform);
		if (entry === undefined) {
			byPlatform.set(t.platform, { count: 1, cover: t.coverUrl, platformId: t.platformId });
		} else {
			entry.count += 1;
			if (entry.cover === '' && t.coverUrl !== '') entry.cover = t.coverUrl;
		}
	}
	const platformRows = [...byPlatform.entries()].sort(
		(a, b) => (a[1].count !== b[1].count ? b[1].count - a[1].count : a[0] < b[0] ? -1 : 1),
	);
	if (platformRows.length > 0) {
		out.push({
			id: 'platforms',
			label: 'Platforms',
			countLabel: `${platformRows.length} ${platformRows.length === 1 ? 'platform' : 'platforms'}`,
			section: { kind: 'recent' }, // headers never open this one; covers do
			tiles: platformRows.slice(0, MAX_TILES).map(([name, info]) => {
				const known = info.platformId > 0 ? platformById.get(info.platformId) : undefined;
				const logo = known?.logoUrl ?? '';
				return {
					key: `platform-${name}`,
					// The logo is letterboxed (its aspect is the IGDB
					// one, not the cover box's); a cover stand-in fills.
					coverUrl: logo !== '' ? logo : info.cover,
					fit: logo !== '' ? ('contain' as const) : undefined,
					name,
					sub: `${info.count} ${info.count === 1 ? 'game' : 'games'}`,
					section: { kind: 'platform', platform: name },
				};
			}),
		});
	}

	const recent = titles
		.filter((t) => t.createdAt !== '')
		.sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0))
		.slice(0, MAX_TILES);
	if (recent.length > 0) {
		out.push({
			id: 'recent',
			label: 'Recently added',
			countLabel: `${titles.filter((t) => t.createdAt !== '').length} games`,
			section: { kind: 'recent' },
			tiles: recent.map((t) => tileFromTitle(t, discSelections, formatDate(t.createdAt))),
		});
	}

	if (collections.length > 0) {
		out.push({
			id: 'collections',
			label: 'Collections',
			countLabel: `${collections.length} ${collections.length === 1 ? 'collection' : 'collections'}`,
			section: { kind: 'recent' }, // ditto
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
	discCount: t.knownDiscs > 1 ? t.knownDiscs : undefined,
	section: { kind: 'recent' }, // the label opens the row; covers open the title
	title: t,
};
}
