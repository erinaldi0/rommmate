/**
 * The canonical focus ring.
 *
 * Every focusable thing in the app (a cover, a chip, a button, a row) marks its
 * focus with the same treatment: an accent ring just outside its bounds. Keeping
 * it in one place is what makes "focus" read as one product behaviour instead of
 * five hand-tuned strokes. It is a single stroked `Rect` — no offscreen
 * compositing, no shadow — so it is cheap and safe anywhere in the tree.
 *
 * Callers that mask overflow (the grid's bands) should paint their ring *after*
 * the bands so a half-scrolled target keeps its full outline; the ring is drawn
 * `pad` outside its target, so pass the target's own `x`/`y`/`width`/`height`.
 */
import React from 'react';
import { Rect } from 'react-tela';
import { colors, radius } from '../../theme';

export interface FocusRingProps {
	/** The target's left. */
	x: number;
	/** The target's top. */
	y: number;
	/** The target's width. */
	width: number;
	/** The target's height. */
	height: number;
	/** The target's corner radius (the ring's radius is this + `pad`). */
	radius?: number;
	/** How far outside the target the ring sits. */
	pad?: number;
	color?: string;
	/** Draw nothing when `false` (a target that does not own the focus). */
	active?: boolean;
	lineWidth?: number;
	/**
	 * A soft accent halo under the stroke — the focused target's glow.
	 * `shadowBlur` is the one real-but-costly effect on the 32-bit heap, so
	 * it is opt-in: the screens gate it to the single focused target (one
	 * glowing ring on screen at a time), never to whole rows of them.
	 */
	glow?: boolean;
}

/** The accent focus ring around a target, sitting `pad` outside its bounds. */
export function FocusRing({
	x,
	y,
	width,
	height,
	radius: corner = radius.xl,
	pad = 6,
	color = colors.accent,
	active = true,
	lineWidth = 4,
	glow = false,
}: FocusRingProps) {
	if (!active) return null;
	return (
		<Rect
			x={x - pad}
			y={y - pad}
			width={width + pad * 2}
			height={height + pad * 2}
			stroke={color}
			lineWidth={lineWidth}
			borderRadius={corner + pad}
			shadowColor={glow ? colors.accentGlow : undefined}
			shadowBlur={glow ? 14 : undefined}
			pointerEvents={false}
		/>
	);
}
