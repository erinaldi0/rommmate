/**
 * The library grid's filter model: the search needle, the platform chips,
 * and the composition of the two.
 *
 * Pure functions over titles — no React, no canvas — so the rules
 * (what the search matches, how the chips count, which chip is "active")
 * live in one readable place and the screen only applies the results.
 */
import type { RommGame, RommTitle } from '../romm';

/** One entry of the filter bar. */
export interface FilterChip {
	/** Stable identity of the chip. */
	key: string;
	label: string;
	/** How many games this chip matches. Omitted when it means nothing. */
	count?: number;
	/** True when this chip is the applied filter. */
	active: boolean;
}

/** Chip that opens the search keyboard. */
export const SEARCH_KEY = '__search';
/** Chip that clears the platform filter. */
export const ALL_KEY = '__all';

/** A disc to show for a title: the player's choice, else the main disc. */
export function shownDisc(t: RommTitle, selections: Record<number, number>): RommGame {
	const i = selections[t.key] ?? t.mainIndex;
	const clamped = Math.min(Math.max(0, i), t.discs.length - 1);
	// `discs` is never empty for a grouped title (groupTitles guarantees it).
	return t.discs[clamped] ?? t.discs[0] as RommGame;
}

/**
 * Apply the search. The search matches the title name only: platforms have
 * their own chips, and a fuzzy two-axis search would be harder to predict
 * than it is useful.
 */
export function searchTitles(titles: RommTitle[], query: string): RommTitle[] {
	const needle = query.trim().toLowerCase();
	return needle === '' ? titles : titles.filter((t) => t.name.toLowerCase().includes(needle));
}

/**
 * Apply the search and the platform chip together (they compose: the
 * platform chip narrows whatever the search left).
 */
export function filterTitles(titles: RommTitle[], query: string, platform: string): RommTitle[] {
	const searched = searchTitles(titles, query);
	return platform === '' ? searched : searched.filter((t) => t.platform === platform);
}

/**
 * Platform names, in a stable order, from the whole library (the chips do
 * not disappear when the search empties their count — the counts say it).
 */
export function platformNames(titles: RommTitle[]): string[] {
	const names = new Set<string>();
	for (const t of titles) if (t.platform !== '') names.add(t.platform);
	return Array.from(names).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The filter bar's chips: the search, "All", and one per platform. The
 * platform counts are taken from the *searched* set, so the two filters
 * compose in what the bar shows.
 */
export function buildFilterChips(titles: RommTitle[], query: string, platform: string): FilterChip[] {
	const needle = query.trim().toLowerCase();
	const searched = searchTitles(titles, query);

	const out: FilterChip[] = [
		{
			key: SEARCH_KEY,
			label: needle === '' ? 'Search' : `Search: ${query.trim()}`,
			active: needle !== '',
		},
		{ key: ALL_KEY, label: 'All', count: searched.length, active: platform === '' },
	];
	for (const name of platformNames(titles)) {
		out.push({
			key: name,
			label: name,
			count: searched.filter((t) => t.platform === name).length,
			active: platform === name,
		});
	}
	return out;
}

/** The chip that should own the focus when the filter bar is entered. */
export function activeChipIndex(chips: FilterChip[]): number {
	const i = chips.findIndex((c) => c.active && c.key !== SEARCH_KEY && c.key !== ALL_KEY);
	return i >= 0 ? i : 1;
}
