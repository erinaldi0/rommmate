/**
 * Text measuring and wrapping helpers.
 *
 * react-tela's `<Text>` can wrap on its own, but it cannot limit the number
 * of lines: a long title would grow downwards and overlap whatever sits
 * below it. Measuring here lets the layout decide how many lines a string
 * gets and ellipsise the last one when it does not fit.
 */
import { fontFamily } from './theme';

const ELLIPSIS = '…';

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
	ctx.font = `${size}px ${fontFamily}`;
	return ctx.measureText(text).width;
}

/**
 * Greedy word wrap with a hard line limit.
 *
 * Words longer than `maxWidth` are left intact on their own line (breaking
 * them would mangle names like "F-Zero"). When the text does not fit in
 * `maxLines`, the overflow is folded into the last line and ellipsised.
 */
export function wrapLines(
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
	if (measure(ctx, text, size) <= maxWidth) return text;

	let out = text;
	while (out.length > 0) {
		out = out.slice(0, -1);
		if (measure(ctx, out + ELLIPSIS, size) <= maxWidth) return out + ELLIPSIS;
	}
	return ELLIPSIS;
}
