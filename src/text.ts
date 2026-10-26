/**
 * Text measuring and wrapping helpers.
 *
 * react-tela's `<Text>` can wrap on its own, but it cannot limit the number
 * of lines: a long title would grow downwards and overlap whatever sits
 * below it. Measuring here lets the layout decide how many lines a string
 * gets and ellipsise the last one when it does not fit.
 *
 * Every result is memoised. Canvas measurement is repeated for identical
 * inputs on every commit — the dashboard alone re-measures dozens of
 * labels per focus move — and `truncate` re-measures once per character
 * while it scans. Results depend only on the arguments (`measure` sets the
 * font itself, the family is a constant, and the app draws on one canvas),
 * so flat tables answer the repeats without touching the canvas.
 */
import { fontFamily } from './theme';

const ELLIPSIS = '…';

/**
 * The memo tables, capped coarsely: a long session with a large library
 * grows them, and an occasional clear is cheaper than an LRU. The entries
 * are short strings, so the worst case is bounded memory for unbounded
 * time.
 */
const MEASURE_CACHE_MAX = 5000;
const measureCache = new Map<string, number>();
const truncateCache = new Map<string, string>();
const wrapCache = new Map<string, string[]>();

/**
 * The slice of a canvas context the helpers below need.
 *
 * The nx.js runtime ships its own type declarations and turns the DOM lib
 * off (`/// <reference no-default-lib="true" />`), while react-tela hands
 * out its own `ICanvasRenderingContext2D`. Describing just the two members
 * that are used keeps the helpers independent of all of that.
 */
export interface TextContext {
	font: string;
	measureText(text: string): { width: number };
}

/**
 * Sets the font on a context and returns the width of `text` in pixels.
 *
 * The `weight` parameter was dropped deliberately: the nx.js runtime cannot
 * produce a bold face at all (its `set font` keeps a normal-weight system
 * face for every request), so `bold` strings never rendered bold — but each
 * distinct bold string permanently missed the runtime's FontFaceSet and
 * re-added two FontFaces (each backed by a copy of the shared system font)
 * *per render*, until the native arena filled and the process OOM'd, while
 * the ever-growing set made every subsequent lookup slower (fps decay).
 * Fat strings measured identically as normal anyway, so measurement uses
 * normal-weight strings only.
 */
export function measure(
	ctx: TextContext,
	text: string,
	size: number,
): number {
	const key = `${size}|${text}`;
	const hit = measureCache.get(key);
	if (hit !== undefined) return hit;

	ctx.font = `${size}px ${fontFamily}`;
	const width = ctx.measureText(text).width;
	if (measureCache.size >= MEASURE_CACHE_MAX) measureCache.clear();
	measureCache.set(key, width);
	return width;
}

/**
 * Greedy word wrap with a hard line limit.
 *
 * Words longer than `maxWidth` are left intact on their own line (breaking
 * them would mangle names like "F-Zero"). When the text does not fit in
 * `maxLines`, the overflow is folded into the last line and ellipsised.
 *
 * The returned array is shared between calls with the same arguments —
 * callers must treat it as read-only.
 */
export function wrapLines(
	ctx: TextContext,
	text: string,
	maxWidth: number,
	maxLines: number,
	size: number,
): string[] {
	const key = `${size}|${maxWidth}|${maxLines}|${text}`;
	const hit = wrapCache.get(key);
	if (hit !== undefined) return hit;

	const lines = wrapLinesUncached(ctx, text, maxWidth, maxLines, size);
	if (wrapCache.size >= MEASURE_CACHE_MAX) wrapCache.clear();
	wrapCache.set(key, lines);
	return lines;
}

/** `wrapLines` without the memo table (see the cache note at the top). */
function wrapLinesUncached(
	ctx: TextContext,
	text: string,
	maxWidth: number,
	maxLines: number,
	size: number,
): string[] {
	const clean = text.replace(/\s+/g, ' ').trim();
	if (clean === '' || maxLines <= 0) return [];

	const words = clean.split(' ');
	const lines: string[] = [];
	let current = '';

	for (const word of words) {
		const candidate = current === '' ? word : `${current} ${word}`;
		if (current !== '' && measure(ctx, candidate, size) > maxWidth) {
			lines.push(current);
			current = word;
			if (lines.length === maxLines) break;
		} else {
			current = candidate;
		}
	}
	if (lines.length < maxLines && current !== '') lines.push(current);

	// Text left over (or a last line that is too wide) is folded into the
	// final line and truncated with an ellipsis.
	if (lines.length === 0) return [truncate(ctx, clean, maxWidth, size)];

	const consumed = lines.join(' ');
	const rest = clean.slice(consumed.length).trim();
	const last = lines[lines.length - 1];

	if (rest !== '' || measure(ctx, last, size) > maxWidth) {
		lines[lines.length - 1] = truncate(ctx, `${last} ${rest}`.trim(), maxWidth, size);
	}

	return lines;
}

/** Cuts `text` down to `maxWidth`, ending with an ellipsis when it was cut. */
export function truncate(
	ctx: TextContext,
	text: string,
	maxWidth: number,
	size: number,
): string {
	const key = `${size}|${maxWidth}|${text}`;
	const hit = truncateCache.get(key);
	if (hit !== undefined) return hit;

	const cut = truncateUncached(ctx, text, maxWidth, size);
	if (truncateCache.size >= MEASURE_CACHE_MAX) truncateCache.clear();
	truncateCache.set(key, cut);
	return cut;
}

/** `truncate` without the memo table (see the cache note at the top). */
function truncateUncached(
	ctx: TextContext,
	text: string,
	maxWidth: number,
	size: number,
): string {
	if (measure(ctx, text, size) <= maxWidth) return text;

	let out = text;
	while (out.length > 0) {
		out = out.slice(0, -1);
		if (measure(ctx, out + ELLIPSIS, size) <= maxWidth) return out + ELLIPSIS;
	}
	return ELLIPSIS;
}
