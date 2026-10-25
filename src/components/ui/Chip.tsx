/**
 * Chips, status chips and badges: small rounded tags.
 *
 * A `Chip` is a fully-rounded pill (status / platform / filter). A `StatusChip`
 * is the same pill with a status tone, the reusable home+detail form of the
 * install-state vocabulary that `hero.ts` currently hand-maps. A `Badge` is a
 * compact, less-rounded tag for counts and cover overlays (the "2/4" disc tag).
 */
import React from 'react';
import { Rect, useParent } from 'react-tela';
import { colors, fontSize, radius } from '../../theme';
import { measure, type TextContext } from '../../text';
import { Text } from './Text';

export type ChipTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'surface';

/** The fill / text / hairline for each chip tone. */
const CHIP_TONE: Record<ChipTone, { fill: string; text: string; stroke: string | null }> = {
	neutral: { fill: colors.surfaceRaised, text: colors.textSecondary, stroke: null },
	accent: { fill: colors.accentMuted, text: colors.accent, stroke: null },
	success: { fill: colors.successMuted, text: colors.success, stroke: null },
	warning: { fill: colors.warningMuted, text: colors.warning, stroke: null },
	danger: { fill: colors.dangerMuted, text: colors.danger, stroke: null },
	surface: { fill: colors.surface, text: colors.textMuted, stroke: colors.border },
};

/** The geometry of a chip size. */
const CHIP_SIZE = {
	sm: { h: 24, fs: fontSize.micro, pad: 12 },
	md: { h: 30, fs: 14, pad: 15 },
} as const;

export type ChipSize = keyof typeof CHIP_SIZE;

/** The width a chip of `text` needs (for laying a row of chips out). */
export function chipWidth(ctx: TextContext, text: string, size: ChipSize = 'md'): number {
	const s = CHIP_SIZE[size];
	return Math.ceil(measure(ctx, text, s.fs) + s.pad * 2);
}

export interface ChipProps {
	x: number;
	y: number;
	text: string;
	tone?: ChipTone;
	size?: ChipSize;
	/** Width in pixels; auto-computed from the text when omitted. */
	width?: number;
	/** An accent hairline around the chip. */
	focused?: boolean;
	/** Override the tone's fill. */
	fill?: string;
	/** Override the tone's text colour. */
	textColor?: string;
}

/** A fully-rounded pill: the reusable form of a status / platform / filter tag. */
export function Chip({ x, y, text, tone = 'neutral', size = 'md', width, focused = false, fill, textColor }: ChipProps) {
	const { ctx } = useParent();
	const s = CHIP_SIZE[size];
	const t = CHIP_TONE[tone];
	const w = width ?? chipWidth(ctx, text, size);
	return (
		<>
			<Rect
				x={x}
				y={y}
				width={w}
				height={s.h}
				fill={fill ?? t.fill}
				stroke={focused ? colors.accent : t.stroke ?? undefined}
				lineWidth={focused ? 2 : 1}
				borderRadius={s.h / 2}
				pointerEvents={false}
			/>
			<Text x={x + w / 2} y={y + s.h / 2} variant="micro" size={s.fs} align="center" baseline="middle" color={textColor ?? t.text}>
				{text}
			</Text>
		</>
	);
}

export type StatusChipProps = Omit<ChipProps, 'tone'> & { tone?: ChipTone };

/**
 * A status pill: the shared home + detail form of an install / sync state.
 *
 * Semantically a `Chip`; the separate name marks "this communicates a status"
 * so the two screens can never drift apart on what a state implies. The
 * `tone` maps onto the status ramp (success / warning / accent / neutral).
 */
export function StatusChip({ tone = 'neutral', ...rest }: StatusChipProps) {
	return <Chip tone={tone} {...rest} />;
}

export type BadgeTone = 'accent' | 'neutral' | 'danger';

const BADGE_TONE: Record<BadgeTone, { fill: string; text: string }> = {
	accent: { fill: colors.accent, text: colors.bg },
	neutral: { fill: colors.surfaceRaised, text: colors.textSecondary },
	danger: { fill: colors.danger, text: colors.bg },
};

export interface BadgeProps {
	/** Top-left of the badge. */
	x: number;
	y: number;
	text: string;
	tone?: BadgeTone;
	/** Badge height in pixels (the font scales with it). */
	size?: number;
}

/** A compact tag for a count or a cover overlay, e.g. the "2/4" disc badge. */
export function Badge({ x, y, text, tone = 'accent', size = 20 }: BadgeProps) {
	const { ctx } = useParent();
	const t = BADGE_TONE[tone];
	const fs = Math.round(size * 0.6);
	const w = Math.ceil(measure(ctx, text, fs) + 12);
	return (
		<>
			<Rect x={x} y={y} width={w} height={size} fill={t.fill} borderRadius={radius.sm} pointerEvents={false} />
			<Text x={x + w / 2} y={y + size / 2} variant="micro" size={fs} align="center" baseline="middle" color={t.text}>
				{text}
			</Text>
		</>
	);
}
