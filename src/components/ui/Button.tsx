/**
 * The button primitive: one component for the four button roles the app uses.
 *
 * It consolidates the button math that was previously duplicated by hand in
 * `HeroCard` and `GameDetail` (measure the label, draw the rect, stroke it on
 * focus, hang the keycap off the right edge). It is *presentational*: the
 * focused / disabled / keycap state arrives as props from the screen's focus
 * system and the action's availability, so the same button reads correctly on
 * both the home hero and the detail screen.
 *
 * The gamepad trigger (what A does) is the *screen's* job — it owns the action
 * and calls the same `run` it always did. `onPress` is an optional pointer /
 * touch callback (wired to react-tela's `onClick`) for where a tap lands.
 */
import React from 'react';
import { Rect, useParent } from 'react-tela';
import { colors, fontSize, radius } from '../../theme';
import { measure, type TextContext } from '../../text';
import { Keycap } from './Keycap';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

/** The geometry of a button size. */
const GEOM: Record<ButtonSize, { h: number; pad: number; labelSize: number; detailSize: number; keycap: number }> = {
	md: { h: 44, pad: 16, labelSize: fontSize.tiny, detailSize: fontSize.micro, keycap: 24 },
	lg: { h: 56, pad: 22, labelSize: fontSize.label, detailSize: fontSize.tiny, keycap: 30 },
};

const DETAIL_GAP = 12; // label → detail
const KEYCAP_GAP = 8; // keycap → the right edge it rides

/** The resolved colours for a variant in a given state. */
interface Look {
	fill: string;
	stroke: string | null;
	label: string;
	detail: string;
}

function resolveLook(variant: ButtonVariant, focused: boolean, enabled: boolean): Look {
	// Disabled is the same across variants: a quiet, dimmed, do-not-touch
	// block. Focus is still shown on it (a raised fill + the accent
	// stroke, with the label staying dim) — the player has to see where
	// the cursor is even when the action there is inert.
	if (!enabled) {
		return focused
			? { fill: colors.surfaceRaised, stroke: colors.accent, label: colors.textFaint, detail: colors.textFaint }
			: { fill: colors.surface, stroke: colors.border, label: colors.textFaint, detail: colors.textFaint };
	}
	switch (variant) {
		case 'primary':
			// Dark ink on the light-blue fill; a bright stroke makes focus unmistakable.
			return { fill: colors.accent, stroke: focused ? colors.textPrimary : colors.accentDark, label: colors.bg, detail: colors.bg };
		case 'danger':
			// A red outline that "ignites" on focus.
			return {
				fill: focused ? colors.danger : colors.surface,
				stroke: colors.danger,
				label: focused ? colors.bg : colors.danger,
				detail: focused ? colors.bg : colors.danger,
			};
		case 'ghost':
			return {
				fill: focused ? colors.surfaceRaised : 'rgba(0,0,0,0)',
				stroke: focused ? colors.accent : null,
				label: focused ? colors.textPrimary : colors.textSecondary,
				detail: colors.textMuted,
			};
		case 'secondary':
			return {
				fill: focused ? colors.surfaceRaised : colors.surface,
				stroke: focused ? colors.accent : colors.border,
				label: colors.textPrimary,
				detail: colors.textMuted,
			};
	}
}

/**
 * The width a button needs for its label, plus room for a trailing detail and
 * a keycap. Exposed so a caller that lays out a row of buttons (the hero's
 * action row) can position them without re-deriving the math.
 */
export function buttonSize(
	ctx: TextContext,
	label: string,
	size: ButtonSize,
	opts: { keycap?: string; detail?: string } = {},
): number {
	const g = GEOM[size];
	const labelW = measure(ctx, label, g.labelSize);
	const detailW = opts.detail !== undefined && opts.detail !== '' ? measure(ctx, opts.detail, g.detailSize) : 0;
	const keycapW = opts.keycap !== undefined ? g.keycap + KEYCAP_GAP : 0;
	return Math.ceil(g.pad + labelW + (detailW > 0 ? DETAIL_GAP + detailW : 0) + keycapW + g.pad);
}

export interface ButtonProps {
	x: number;
	y: number;
	/** The action's label, e.g. "Play game". */
	label: string;
	/** Width in pixels; auto-computed from the content when omitted. */
	width?: number;
	/** Height in pixels; defaults to the size's height. */
	height?: number;
	variant?: ButtonVariant;
	size?: ButtonSize;
	/** True when this button owns the focus ring / treatment. */
	focused?: boolean;
	/** A disabled button is dimmed and inert. */
	disabled?: boolean;
	/** A button glyph (e.g. "A") shown at the right edge when focused + enabled. */
	keycap?: string;
	/** Small trailing text (e.g. "· 1.2 GB"). */
	detail?: string;
	/** Where the label sits. Defaults to left. */
	align?: 'left' | 'center';
	radius?: number;
	/** Optional pointer / touch action (the gamepad action is the screen's). */
	onPress?: () => void;
}

/**
 * A console button.
 *
 * `<Button x y label focused>` is the whole contract. `variant` picks the role
 * (primary / secondary / ghost / danger), `focused` + `disabled` pick the state,
 * and an optional `keycap` / `detail` decorate it. It auto-sizes from its label
 * so a call site does not have to measure; pass `width` to force a fixed box.
 */
export function Button({
	x,
	y,
	label,
	width,
	height,
	variant = 'primary',
	size = 'md',
	focused = false,
	disabled = false,
	keycap,
	detail,
	align = 'left',
	radius: corner,
	onPress,
}: ButtonProps) {
	const { ctx } = useParent();
	const g = GEOM[size];

	const w = width ?? buttonSize(ctx, label, size, { keycap, detail });
	const h = height ?? g.h;
	const enabled = !disabled;
	const look = resolveLook(variant, focused, enabled);

	const center = align === 'center';
	const labelX = center ? x + w / 2 : x + g.pad;
	const labelW = measure(ctx, label, g.labelSize);
	const keycapVisible = keycap !== undefined && focused && enabled;
	const detailVisible = detail !== undefined && detail !== '' && align === 'left';
	// The room the detail has: the button's width minus its own padding,
	// the label and the gap — and, when a keycap is reserved, the keycap's
	// space, so a long detail never runs under it. All relative to the
	// button: `x` is absolute screen space and must not leak into a width
	// computation (that was the bug that ellipsised the detail on every
	// fixed-width button down to a lone '…').
	const keycapRoom = keycap !== undefined ? g.keycap + KEYCAP_GAP : 0;
	const detailMax = Math.max(0, w - g.pad - labelW - DETAIL_GAP - keycapRoom - g.pad);

	return (
		<>
			<Rect
				x={x}
				y={y}
				width={w}
				height={h}
				fill={look.fill}
				stroke={look.stroke ?? undefined}
				lineWidth={focused ? 2 : 1}
				borderRadius={corner ?? radius.md}
				pointerEvents={onPress !== undefined}
				onClick={onPress !== undefined ? () => onPress() : undefined}
			/>
			<Text
				x={labelX}
				y={y + h / 2}
				variant="label"
				size={g.labelSize}
				align={center ? 'center' : 'start'}
				baseline="middle"
				color={look.label}
			>
				{label}
			</Text>
			{detailVisible && (
				<Text
					x={x + g.pad + labelW + DETAIL_GAP}
					y={y + h / 2}
					variant="micro"
					size={g.detailSize}
					align="start"
					baseline="middle"
					color={look.detail}
					maxWidth={detailMax}
					overflow="ellipsis"
				>
					{detail}
				</Text>
			)}
			{keycapVisible && keycap !== undefined && (
				<Keycap x={x + w - g.keycap - g.pad} y={y + (h - g.keycap) / 2} size={g.keycap} tone="filled" label={keycap} />
			)}
		</>
	);
}
