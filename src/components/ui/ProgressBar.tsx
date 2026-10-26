/**
 * The progress bar: one reusable form of the install / sync / download meter.
 *
 * The dashboard's install panel and the detail screen's installation card both
 * need "a track, a fill, and the facts around it". This is that, as one
 * component: a pill track, a pill fill (`value` 0..1), and optional label /
 * right / caption text positioned around the bar. The `value` is a controlled
 * prop — the progress comes in from the play / download service, never from
 * here.
 */
import React from 'react';
import { Rect } from 'react-tela';
import { colors, fontSize } from '../../theme';
import { Text } from './Text';

export type ProgressTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

const TONE: Record<ProgressTone, string> = {
	accent: colors.accent,
	success: colors.success,
	warning: colors.warning,
	danger: colors.danger,
	neutral: colors.textMuted,
};

export interface ProgressBarProps {
	/** The bar's top-left. */
	x: number;
	y: number;
	/** The track's width. */
	width: number;
	/** Completion, 0..1 (clamped). */
	value: number;
	/** Bar height in pixels (the fill and track are pills of this height). */
	height?: number;
	tone?: ProgressTone;
	/** Small label above the bar, left (e.g. "INSTALL"). */
	label?: string;
	/** Small text above the bar, right (e.g. "42% · 1.2 GB"). */
	right?: string;
	/** A caption below the bar (the last action's outcome, ellipsised). */
	caption?: string;
	captionColor?: string;
}

/**
 * A progress bar with its surrounding facts.
 *
 * The bar sits at `(x, y)`; `label` and `right` render just above it, `caption`
 * just below. A non-zero `value` always shows at least a dot, so a download
 * that has started is never mistaken for a bar that never began.
 */
export function ProgressBar({ x, y, width, value, height = 6, tone = 'accent', label, right, caption, captionColor }: ProgressBarProps) {
	const v = Math.min(1, Math.max(0, value));
	const fillW = Math.max(height / 2, width * v);
	const labelColor =
		tone === 'success'
			? colors.success
			: tone === 'warning'
				? colors.warning
				: tone === 'danger'
					? colors.danger
					: colors.textSecondary;

	return (
		<>
			{label !== undefined && label !== '' && (
				<Text x={x} y={y - 12} variant="micro" color={colors.textFaint}>
					{label}
				</Text>
			)}
			{right !== undefined && right !== '' && (
				<Text x={x + width} y={y - 12} variant="micro" align="right" color={labelColor}>
					{right}
				</Text>
			)}
			<Rect x={x} y={y} width={width} height={height} fill={colors.border} borderRadius={height / 2} pointerEvents={false} />
			{v > 0 && (
				<Rect x={x} y={y} width={fillW} height={height} fill={TONE[tone]} borderRadius={height / 2} pointerEvents={false} />
			)}
			{caption !== undefined && caption !== '' && (
				<Text x={x} y={y + height + 8} variant="micro" color={captionColor ?? colors.textMuted} maxWidth={width} overflow="ellipsis">
					{caption}
				</Text>
			)}
		</>
	);
}

/** The small progress label size (kept for callers that position text by hand). */
export const PROGRESS_FONT = fontSize.micro;
