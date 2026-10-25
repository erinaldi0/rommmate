/**
 * Text primitives: a typed `Text`, a section heading, and a metadata field.
 *
 * The device font is normal-weight only, so hierarchy is carried by the `type`
 * roles (size + colour + baseline), not by bold. Each primitive here reads a
 * role from the `type` token map and lets the caller override any of the three,
 * so a call site states a *role* rather than a hand-tuned trio of props.
 *
 * All three are plain react-tela `Text`/`Rect` entities — no wrapping, no
 * offscreen compositing.
 */
import React from 'react';
import { Rect, Text as TelaText, type TextOverflow } from 'react-tela';
import { colors, fontFamily, layout, screen, type, type TypeRole } from '../../theme';

export interface TextProps {
	x: number;
	y: number;
	/** The content. Strings and/or numbers, single or multi-line (an array). */
	children: string | number | Array<string | number>;
	/** The role to draw as (see `type`). Defaults to body. */
	variant?: TypeRole;
	/** Override the role's size. */
	size?: number;
	/** Override the role's colour. */
	color?: string;
	/** Override the horizontal alignment. Defaults to left. */
	align?: CanvasTextAlign;
	/** Override the role's baseline. */
	baseline?: CanvasTextBaseline;
	/** Enables wrapping / truncation to a max width. */
	maxWidth?: number;
	/** What happens at `maxWidth`. Defaults to wrap. */
	overflow?: TextOverflow;
	/** Line-height multiplier (for wrapped text). */
	lineHeight?: number;
	/** Opacity. */
	alpha?: number;
	/** Override the family (the system font is used otherwise). */
	font?: string;
}

/**
 * A single piece of text with a type role.
 *
 * `<Text x y variant="label">Genres</Text>` is the whole contract; `size`,
 * `color`, `align`, `baseline` override the role's defaults when a particular
 * call site needs to. This is what makes the type scale reusable across the
 * home and detail screens without each re-deriving the same numbers.
 */
export function Text({
	x,
	y,
	children,
	variant = 'body',
	size,
	color,
	align,
	baseline,
	maxWidth,
	overflow,
	lineHeight,
	alpha,
	font,
}: TextProps) {
	const style = type[variant];
	return (
		<TelaText
			x={x}
			y={y}
			fontFamily={font ?? fontFamily}
			fontSize={size ?? style.size}
			fill={color ?? style.color}
			textAlign={align ?? 'start'}
			textBaseline={baseline ?? style.baseline}
			maxWidth={maxWidth}
			overflow={overflow}
			lineHeight={lineHeight}
			alpha={alpha}
			pointerEvents={false}
		>
			{children}
		</TelaText>
	);
}

export interface SectionHeadingProps {
	/** Left edge of the heading. */
	x: number;
	/** The text's baseline (the role anchors on the alphabetic baseline). */
	y: number;
	/** The title. */
	children: string | number;
	/** How wide the heading's row is; the meta right-aligns and the rule spans it. */
	width?: number;
	/** A right-aligned count / note (e.g. "12 games"). */
	meta?: string;
	/** Draw a hairline rule under the heading. */
	rule?: boolean;
	/** The title's role. Defaults to a heading. */
	variant?: TypeRole;
	color?: string;
}

/**
 * A labelled section header: a title, an optional right-aligned note and an
 * optional hairline rule. The dashboard's row headers and the detail screen's
 * section labels both reduce to this.
 */
export function SectionHeading({ x, y, width, children, meta, rule = false, variant = 'heading', color }: SectionHeadingProps) {
	const span = width ?? screen.width - layout.margin * 2;
	const ruleY = y + Math.round(type[variant].size * 0.55);
	return (
		<>
			<Text x={x} y={y} variant={variant} color={color}>
				{children}
			</Text>
			{meta !== undefined && meta !== '' && (
				<Text x={x + span} y={y} variant="caption" align="right" color={colors.textMuted}>
					{meta}
				</Text>
			)}
			{rule && <Rect x={x} y={ruleY} width={span} height={1} fill={colors.border} pointerEvents={false} />}
		</>
	);
}

export interface FieldProps {
	/** Top-left of the label (the value sits below it). */
	x: number;
	y: number;
	/** The small label, e.g. "PLATFORM". */
	label: string;
	/** The value, e.g. "Nintendo 64". */
	value: string;
	/** Max width the value wraps / ellipsizes to. */
	width?: number;
	labelColor?: string;
	valueColor?: string;
	/** Override the value's size (defaults to the `label` role). */
	valueSize?: number;
}

/**
 * A metadata label + value pair: a faint small-caps label over a value.
 *
 * The detail screen's identity line and the dashboard's facts grid both reduce
 * to a set of these, so the label/value vocabulary lives in one place.
 */
export function Field({ x, y, label, value, width, labelColor, valueColor, valueSize }: FieldProps) {
	const gap = Math.round(type.micro.size * 1.7) + 2;
	return (
		<>
			<Text x={x} y={y} variant="micro" color={labelColor ?? colors.textFaint}>
				{label}
			</Text>
			<Text
				x={x}
				y={y + gap}
				variant="label"
				size={valueSize}
				color={valueColor ?? colors.textSecondary}
				maxWidth={width}
				overflow={width !== undefined ? 'ellipsis' : undefined}
			>
				{value}
			</Text>
		</>
	);
}
