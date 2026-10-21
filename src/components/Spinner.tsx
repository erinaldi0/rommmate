/**
 * The "something is happening" indicator.
 *
 * The canvas UI has no CSS animations, so a spinner is a coarse tick that
 * moves a few dots around. It is deliberately cheap: three dots, redrawn a
 * few times per second, and only while something is actually loading.
 */
import React from 'react';
import { Rect } from 'react-tela';
import { colors } from '../theme';
import { useTick } from '../hooks/use-tick';

interface Props {
	/** Centre of the dot cluster. */
	x: number;
	y: number;
	/** True while the work is still running; false hides the indicator. */
	active?: boolean;
}

/** How often the dots move on. */
const TICK_MS = 300;
/** Distance between the dots. */
const DOT_GAP = 22;
/** Radius of the dot that is "active". */
const BIG_R = 7;
/** Radius of the dots that are not. */
const SMALL_R = 4;

/**
 * Three dots, one of them growing at a time.
 *
 * A spinner is only worth drawing while there is something to wait for, so
 * the component draws nothing when it is inactive.
 */
export function Spinner({ x, y, active = true }: Props) {
	const tick = useTick(TICK_MS, active);
	if (!active) return null;

	const step = tick % 3;

	return (
		<>
			{[0, 1, 2].map((i) => {
				const on = i === step;
				const r = on ? BIG_R : SMALL_R;
				return (
					<Rect
						key={i}
						x={x + (i - 1) * DOT_GAP - r}
						y={y - r}
						width={r * 2}
						height={r * 2}
						fill={on ? colors.accent : colors.coverGlyph}
						borderRadius={r}
					/>
				);
			})}
		</>
	);
}
