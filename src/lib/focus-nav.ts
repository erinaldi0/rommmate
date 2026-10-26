/**
 * The shared focus-navigation model (pure helpers, no React).
 *
 * Every screen owns its own focus state — that is the app's convention —
 * but the *rules* of that state are one thing, not five:
 *
 *   - a focus index lives inside `[min, max]`, and anything that can
 *     shrink a list re-clamps it (never silently strands it out of range);
 *   - a vertical move between rows normalizes the horizontal position
 *     into the target row *before* the next press, so no press is ever
 *     swallowed (see `clampSel`);
 *   - the view follows the focus minimally: it scrolls exactly when the
 *     focused thing is not visible, never for its own sake
 *     (see `followScroll` / `windowFollow`).
 *
 * Keeping the rules here is what makes "focus" read as one product
 * behaviour: the dashboard rows, the library grid, the disc picker and
 * the download queue all move and scroll by the same maths.
 */

/** Pin `n` into `[lo, hi]` (`lo` wins when the range is empty). */
export function clamp(n: number, lo: number, hi: number): number {
	return Math.min(Math.max(n, lo), Math.max(lo, hi));
}

/**
 * Normalise a horizontal focus index for a target row.
 *
 * Moving vertically between rows of different lengths used to leave the
 * raw index pointing past the end of the new row: the *displayed* focus
 * was clamped, but the raw one was not, so the first Left/Right after
 * the move was spent clamping instead of moving — a swallowed press.
 * Every vertical row change runs the raw index through this instead.
 *
 * `min` is the row's lowest focusable index (a row whose header opens a
 * section focuses the header at -1; browsing-aid rows start at 0).
 */
export function clampSel(sel: number, min: number, count: number): number {
	return clamp(sel, min, Math.max(min, count - 1));
}

/**
 * The scroll position that puts `[itemTop, itemTop + itemH]` inside a
 * `[viewH]`-tall window, moving `current` as little as possible.
 *
 * This is "keep the focused thing visible", not "centre it": the view
 * scrolls exactly when the target falls outside the window, and by
 * exactly the distance that brings it back in. Used by every screen
 * that scrolls a long list behind a fixed viewport (the dashboard's
 * rows, the library grid's tiles).
 */
export function followScroll(
	itemTop: number,
	itemH: number,
	viewH: number,
	current: number,
	max: number,
): number {
	const bottom = itemTop + itemH;
	if (itemTop < current) return Math.max(0, itemTop);
	if (bottom > current + viewH) return clamp(bottom - viewH, 0, max);
	return current;
}

/**
 * The first visible index of a windowed list, moved as little as
 * possible so that index `focus` is inside `[first, first + visible - 1]`.
 *
 * Used by the windowed lists (the disc picker, the download queue),
 * where the rows are re-emitted from `first` rather than scrolled.
 */
export function windowFollow(focus: number, visible: number, current: number): number {
	if (focus < current) return focus;
	if (focus > current + visible - 1) return Math.max(0, focus - visible + 1);
	return current;
}
