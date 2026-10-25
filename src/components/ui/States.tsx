/**
 * The empty, loading and error states.
 *
 * Each is a self-contained, centred block built from the shared atoms. A
 * "nothing here" or "one second" screen is a normal outcome, not a failure, so
 * each gets the same careful treatment the populated screens do — the app never
 * looks broken. Motion is a single coarse tick (the spinner); there are no CSS
 * transitions or blurs. These are reusable on the home and detail screens and
 * take a centered position, so a screen can drop one in wherever it needs.
 */
import React from 'react';
import { Rect, useDimensions, useParent } from 'react-tela';
import { colors, fontSize, motion, radius } from '../../theme';
import { wrapLines, type TextContext } from '../../text';
import { useTick } from '../../hooks/use-tick';
import { Button, buttonSize } from './Button';
import { Text } from './Text';

/** A centred action a state can offer (the screen owns what it does). */
export interface StateAction {
	label: string;
	/** The pointer / gamepad-adjacent action (owned by the caller). */
	onPress?: () => void;
	disabled?: boolean;
}

export interface SpinnerProps {
	/** Centre of the dot cluster. */
	x: number;
	y: number;
	/** False hides the indicator entirely. */
	active?: boolean;
	/** A uniform scale, so the same spinner reads right at any size. */
	scale?: number;
}

/**
 * The "something is happening" indicator: three dots, one of them growing,
 * ticking on a coarse interval and only while `active`.
 */
export function Spinner({ x, y, active = true, scale = 1 }: SpinnerProps) {
	const tick = useTick(motion.spinnerTick, active);
	if (!active) return null;

	const step = tick % 3;
	const big = Math.round(7 * scale);
	const small = Math.round(4 * scale);
	const gap = Math.round(22 * scale);

	return (
		<>
			{[0, 1, 2].map((i) => {
				const on = i === step;
				const r = on ? big : small;
				return (
					<Rect
						key={i}
						x={x + (i - 1) * gap - r}
						y={y - r}
						width={r * 2}
						height={r * 2}
						fill={on ? colors.accent : colors.coverGlyph}
						borderRadius={r}
						pointerEvents={false}
					/>
				);
			})}
		</>
	);
}

export interface EmptyStateProps {
	/** Short headline, e.g. "No games match". */
	title: string;
	/** One or two lines of explanation under the headline. */
	detail?: string;
	/** A large muted glyph above the headline. */
	glyph?: string;
	/** Vertical centre of the block (defaults to the middle of the screen). */
	centerY?: number;
	/** Horizontal centre (defaults to the middle of the screen). */
	centerX?: number;
	/** An optional action offered below the text. */
	action?: StateAction;
}

/** The "nothing here" state. */
export function EmptyState({ title, detail = '', glyph = '', centerY, centerX, action }: EmptyStateProps) {
	const dims = useDimensions();
	const { ctx } = useParent();

	const cx = centerX ?? dims.width / 2;
	const cy = centerY ?? dims.height / 2;
	const lines = wrapLines(ctx, detail, Math.min(720, dims.width - 160), 2, fontSize.body);
	const hasGlyph = glyph !== '';

	const titleY = cy - (hasGlyph ? 34 : 0);
	const detailY = cy + (hasGlyph ? 34 : 6) + 20;
	const ruleY = detailY + lines.length * 26 + 10;

	return (
		<>
			{hasGlyph && (
				<Text x={cx} y={cy - 92} variant="display" size={72} align="center" baseline="middle" color={colors.coverGlyph}>
					{glyph}
				</Text>
			)}
			<Text x={cx} y={titleY} variant="title" align="center" baseline="middle" color={colors.textSecondary}>
				{title}
			</Text>
			{lines.map((line, i) => (
				<Text key={`detail-${i}`} x={cx} y={detailY + i * 26} variant="body" align="center" baseline="middle" color={colors.textMuted}>
					{line}
				</Text>
			))}
			{lines.length > 0 && <Rect x={cx - 40} y={ruleY} width={80} height={1} fill={colors.border} pointerEvents={false} />}
			{action !== undefined && <ActionButton x={cx} y={ruleY + 28} action={action} ctx={ctx} />}
		</>
	);
}

export interface LoadingStateProps {
	/** The label, e.g. "Loading your library". */
	label?: string;
	/** A second, quieter line (the client's status). */
	detail?: string;
	centerY?: number;
	centerX?: number;
}

/** The "one second" state: a spinner over a label. */
export function LoadingState({ label = '', detail = '', centerY, centerX }: LoadingStateProps) {
	const dims = useDimensions();
	const cx = centerX ?? dims.width / 2;
	const cy = centerY ?? dims.height / 2;
	return (
		<>
			<Spinner x={cx} y={cy - 28} />
			{label !== '' && (
				<Text x={cx} y={cy + 10} variant="body" align="center" baseline="middle" color={colors.textSecondary}>
					{label}
				</Text>
			)}
			{detail !== '' && (
				<Text x={cx} y={cy + 40} variant="caption" align="center" baseline="middle" color={colors.textMuted}>
					{detail}
				</Text>
			)}
		</>
	);
}

export interface ErrorStateProps {
	/** Short headline, e.g. "Connection failed". */
	title: string;
	/** Explanation / the friendly error detail. */
	detail?: string;
	centerY?: number;
	centerX?: number;
	/** An optional action (retry, edit settings, …). */
	action?: StateAction;
}

/** The "something went wrong" state: a warning mark, a headline, detail and an action. */
export function ErrorState({ title, detail = '', centerY, centerX, action }: ErrorStateProps) {
	const dims = useDimensions();
	const { ctx } = useParent();

	const cx = centerX ?? dims.width / 2;
	const cy = centerY ?? dims.height / 2;
	const lines = wrapLines(ctx, detail, Math.min(720, dims.width - 160), 3, fontSize.body);

	const titleY = cy - 40;
	const detailY = cy - 6;

	return (
		<>
			{/* A warning mark: a rounded cap with an exclamation (the font has no glyphs). */}
			<Rect
				x={cx - 36}
				y={cy - 128}
				width={72}
				height={72}
				fill={colors.dangerMuted}
				stroke={colors.danger}
				lineWidth={2}
				borderRadius={radius.xl}
				pointerEvents={false}
			/>
			<Text x={cx} y={cy - 92} variant="display" size={48} align="center" baseline="middle" color={colors.danger}>
				!
			</Text>

			<Text x={cx} y={titleY} variant="title" align="center" baseline="middle" color={colors.textPrimary}>
				{title}
			</Text>
			{lines.map((line, i) => (
				<Text key={`err-${i}`} x={cx} y={detailY + i * 26} variant="body" align="center" baseline="middle" color={colors.textMuted}>
					{line}
				</Text>
			))}
			{action !== undefined && <ActionButton x={cx} y={detailY + lines.length * 26 + 30} action={action} ctx={ctx} />}
		</>
	);
}

/** A centred action button shared by the empty / error states. */
function ActionButton({ x, y, action, ctx }: { x: number; y: number; action: StateAction; ctx: TextContext }) {
	const w = buttonSize(ctx, action.label, 'md');
	return (
		<Button
			x={x - w / 2}
			y={y}
			label={action.label}
			size="md"
			variant="secondary"
			align="center"
			disabled={action.disabled}
			onPress={action.onPress}
		/>
	);
}
