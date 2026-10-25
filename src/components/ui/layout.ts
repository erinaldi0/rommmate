/**
 * Pure layout helpers — no React, no canvas, just arithmetic.
 *
 * The grid and the dashboard rows each hand-roll the same discipline: compute
 * the full list in JS, render only the slice that intersects the viewport, and
 * mask the overflow. These helpers factor that out so a screen reuses the math
 * instead of re-deriving it (the renderer has no flexbox — layout is manual).
 */

/** Clamp a scroll offset into `[0, content − viewport]`. */
export function clampScroll(scroll: number, contentHeight: number, viewportHeight: number): number {
	const max = Math.max(0, contentHeight - viewportHeight);
	return Math.max(0, Math.min(scroll, max));
}

/**
 * The range of item indices that intersect a viewport of `viewportHeight`, for
 * `count` items of `itemHeight`. `last` is `first - 1` when nothing intersects.
 */
export function visibleRange(
	scroll: number,
	viewportHeight: number,
	itemHeight: number,
	count: number,
): { first: number; last: number } {
	if (itemHeight <= 0 || count <= 0) return { first: 0, last: -1 };
	const first = Math.max(0, Math.floor(scroll / itemHeight));
	const last = Math.min(count - 1, Math.floor((scroll + viewportHeight - 1) / itemHeight));
	return { first, last };
}

/** The x that centres an item of `itemW` within a bound of `boundW` at `boundX`. */
export function centerX(boundX: number, boundW: number, itemW: number): number {
	return boundX + (boundW - itemW) / 2;
}

/** The x of column `col` in a grid of `itemW`-wide items. */
export function colX(originX: number, col: number, itemW: number, gutter: number): number {
	return originX + col * (itemW + gutter);
}

/** The y of row `row`, scrolled by `scroll`. */
export function rowY(originY: number, row: number, itemH: number, gutter: number, scroll: number): number {
	return originY + row * (itemH + gutter) - scroll;
}
