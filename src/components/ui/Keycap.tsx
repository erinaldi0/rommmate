/**
 * Controller button hints: the keycap glyph, one hint, and a centred hint bar.
 *
 * The hint bar answers the one question a player has when they pick up the
 * controller: "what does this button do?". It is the design-system version of
 * the existing `HintBar` — same information, but built from the shared
 * `Keycap` + type tokens so the chrome reads identically wherever it appears.
 * The gamepad wiring lives with the screen, not here: this is presentation.
 */
import React from 'react';
import { Rect, useDimensions, useParent } from 'react-tela';
import { colors, fontSize } from '../../theme';
import { measure } from '../../text';
import { Text } from './Text';

export type KeycapTone = 'neutral' | 'accent' | 'filled';

/** The fill / stroke / letter colour for each keycap tone. */
const KEYCAP: Record<KeycapTone, { fill: string; stroke: string | null; text: string }> = {
	neutral: { fill: colors.surfaceRaised, stroke: colors.borderStrong, text: colors.textSecondary },
	accent: { fill: colors.surfaceRaised, stroke: colors.accent, text: colors.accent },
	// The inverse cap that rides a filled (primary) button: light, with the accent letter.
	filled: { fill: colors.textPrimary, stroke: null, text: colors.accentDark },
};

export interface KeycapProps {
	/** Top-left of the square cap. */
	x: number;
	y: number;
	/** The button glyph, e.g. "A". */
	label: string;
	/** Cap size in pixels. */
	size?: number;
	tone?: KeycapTone;
	textColor?: string;
}

/**
 * A single controller-button glyph in a rounded cap: the "A" / "B" chip.
 *
 * `neutral` is the resting hint-bar badge, `accent` is the focused one, and
 * `filled` is the inverse cap that sits on a filled primary button.
 */
export function Keycap({ x, y, label, size = 26, tone = 'neutral', textColor }: KeycapProps) {
	const cap = KEYCAP[tone];
	return (
		<>
			<Rect
				x={x}
				y={y}
				width={size}
				height={size}
				fill={cap.fill}
				stroke={cap.stroke ?? undefined}
				lineWidth={1}
				borderRadius={Math.round(size * 0.24)}
				pointerEvents={false}
			/>
			<Text
				x={x + size / 2}
				y={y + size / 2}
				variant="micro"
				size={Math.round(size * 0.48)}
				align="center"
				baseline="middle"
				color={textColor ?? cap.text}
			>
				{label}
			</Text>
		</>
	);
}

export interface HintProps {
	/** Top-left of the keycap (the label follows it to the right). */
	x: number;
	y: number;
	/** The button glyph, e.g. "A". */
	button: string;
	/** What the button does, e.g. "open". */
	label: string;
	/** True to render the accent (focused) keycap. */
	focused?: boolean;
	keycapSize?: number;
}

/** One hint: a keycap and its description, on a shared midline. */
export function Hint({ x, y, button, label, focused = false, keycapSize = 26 }: HintProps) {
	const mid = y + keycapSize / 2;
	return (
		<>
			<Keycap x={x} y={y} label={button} size={keycapSize} tone={focused ? 'accent' : 'neutral'} />
			<Text x={x + keycapSize + 8} y={mid} variant="caption" baseline="middle" color={colors.textMuted}>
				{label}
			</Text>
		</>
	);
}

export interface HintBarProps {
	/** Hints in "A open" form: the word before the space is the button glyph. */
	hints: string[];
	/** Vertical top of the row; defaults to just above the screen bottom. */
	y?: number;
	keycapSize?: number;
	/** Highlight every keycap in the accent tone. */
	focused?: boolean;
	/** Draw the opaque band the bar sits on (masks content behind it). */
	backdrop?: boolean;
	backdropHeight?: number;
}

/**
 * A centred row of controller hints, and (optionally) the band behind it.
 *
 * The items are measured so the row centres on the canvas; the band is a plain
 * `Rect` (the same "two opaque bands" discipline the grid uses to mask
 * overflow, here for the bar).
 */
export function HintBar({ hints, keycapSize = 26, focused = false, backdrop = false, backdropHeight = 72, y }: HintBarProps) {
	const dims = useDimensions();
	const { ctx } = useParent();

	const barY = y ?? dims.height - 52;
	const keycapLabelGap = 8;
	const itemGap = 26;

	const items = hints.map((hint) => {
		const [button, ...rest] = hint.split(' ');
		const label = rest.join(' ');
		return { button, label, width: keycapSize + keycapLabelGap + measure(ctx, label, fontSize.small) };
	});

	const total =
		items.reduce((sum, item) => sum + item.width, 0) + itemGap * Math.max(0, items.length - 1);

	let x = (dims.width - total) / 2;

	return (
		<>
			{backdrop && (
				<Rect
					x={0}
					y={dims.height - backdropHeight}
					width={dims.width}
					height={backdropHeight}
					fill={colors.bg}
					pointerEvents={false}
				/>
			)}
			{items.map((item) => {
				const itemX = x;
				x += item.width + itemGap;
				return (
					<Hint
						key={`${item.button} ${item.label}`}
						x={itemX}
						y={barY}
						button={item.button}
						label={item.label}
						focused={focused}
						keycapSize={keycapSize}
					/>
				);
			})}
		</>
	);
}
