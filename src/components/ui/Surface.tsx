/**
 * Surface primitives: the rounded panels, cards and gradient scrims the UI is
 * built from.
 *
 * Everything here is a single, plain react-tela entity (a `Rect`, or a `Rect`
 * filled with a gradient). The offscreen `<Group>` / `<Canvas>` compositing
 * path is deliberately never used — a failure inside it aborts the whole
 * frame, so a "panel" is one rectangle, not a container. Layout and stacking
 * are the caller's job; these atoms only paint.
 */
import React from 'react';
import { Rect, useLinearGradient } from 'react-tela';
import { colors, elevation, radius, type ElevationName } from '../../theme';

/** Default corner radius for a surface (a raised panel). */
const PANEL_RADIUS = radius.xl;

export interface SurfaceProps {
	x: number;
	y: number;
	width: number;
	height: number;
	/** How far the surface lifts off the background (see `elevation`). */
	elevation?: ElevationName;
	/** Corner radius; defaults to a panel's radius. */
	radius?: number;
	/** Override the elevation's fill. */
	fill?: string;
	/** Override the elevation's hairline stroke. */
	stroke?: string;
	/** Opacity (a `Scrim`-less translucent panel). */
	alpha?: number;
	/**
	 * Whether this rect answers pointer events. Surfaces are backgrounds, so
	 * this defaults to `false`; the app hit-tests its own tap targets via the
	 * canvas, not per-entity.
	 */
	pointerEvents?: boolean;
}

/**
 * One rounded rectangle with an elevation.
 *
 * The `elevation` picks the fill + hairline from the token map; only
 * `floating` adds a shadow (the one real-but-costly effect, kept opt-in).
 * Pass `elevation="flat"` for a background panel, `"raised"` / `"overlay"`
 * for cards and rows, and `"floating"` for the few things that genuinely
 * float (the disc picker, a context menu).
 */
export function Surface({
	x,
	y,
	width,
	height,
	elevation: level = 'raised',
	radius: corner = PANEL_RADIUS,
	fill,
	stroke,
	alpha = 1,
	pointerEvents = false,
}: SurfaceProps) {
	const style = elevation[level];
	return (
		<Rect
			x={x}
			y={y}
			width={width}
			height={height}
			fill={fill ?? style.fill}
			stroke={stroke ?? style.stroke ?? undefined}
			lineWidth={1}
			borderRadius={corner}
			alpha={alpha}
			pointerEvents={pointerEvents}
			{...(style.shadow !== null
				? {
						shadowColor: style.shadow.color,
						shadowBlur: style.shadow.blur,
						shadowOffsetY: style.shadow.offsetY,
				  }
				: {})}
		/>
	);
}

export type PanelProps = SurfaceProps;

/**
 * A named `Surface` for a panel: a raised (or higher) card with a soft hairline.
 * Semantically identical to `Surface` with the panel defaults, but the name
 * reads better at a call site that wants "a card", not "a rect".
 */
export function Panel({
	elevation: level = 'raised',
	radius: corner = PANEL_RADIUS,
	...rest
}: PanelProps) {
	return <Surface {...rest} elevation={level} radius={corner} />;
}

export type ScrimDirection = 'left' | 'right' | 'top' | 'bottom' | 'fade';

export interface ScrimProps {
	x: number;
	y: number;
	width: number;
	height: number;
	/**
	 * Which edge the scrim is *opaque* on. `'left'` is dark at the left, fading
	 * to transparent at the right — the console-dashboard signature for making
	 * identity text legible over cover art (the blur substitute: `filter` is a
	 * silent no-op on the runtime).
	 */
	direction?: ScrimDirection;
	/** The transparent end of the gradient. */
	from?: string;
	/** The opaque end of the gradient. */
	to?: string;
	/** Overall strength of the scrim. */
	opacity?: number;
}

/**
 * A translucent gradient overlay.
 *
 * The device has no `ctx.filter`, so real blur is unavailable; a dark gradient
 * reads as the same "dim the art so the text pops" treatment for the cost of
 * one gradient fill. It is a plain `Rect`, so it is safe in the tree.
 */
export function Scrim({
	x,
	y,
	width,
	height,
	direction = 'left',
	from = 'rgba(10,10,18,0)',
	to = 'rgba(10,10,18,0.82)',
	opacity = 1,
}: ScrimProps) {
	// Resolve the gradient's axis and the colour at each end. `from` is the
	// transparent side, `to` the opaque side; the direction picks which edge
	// each sits on.
	let x0 = x;
	let y0 = y;
	let x1 = x + width;
	let y1 = y + height;
	let c0 = from;
	let c1 = to;
	switch (direction) {
		case 'left': // opaque at the left
			y0 = y + height / 2;
			y1 = y + height / 2;
			c0 = to;
			c1 = from;
			break;
		case 'right': // opaque at the right
			y0 = y + height / 2;
			y1 = y + height / 2;
			c0 = from;
			c1 = to;
			break;
		case 'top': // opaque at the top
			x0 = x + width / 2;
			x1 = x + width / 2;
			c0 = to;
			c1 = from;
			break;
		case 'bottom': // opaque at the bottom
			x0 = x + width / 2;
			x1 = x + width / 2;
			c0 = from;
			c1 = to;
			break;
		case 'fade': // a flat dim, no gradient
			x1 = x;
			y1 = y;
			c0 = to;
			c1 = to;
			break;
	}

	const gradient = useLinearGradient(x0, y0, x1, y1, [
		[0, c0],
		[1, c1],
	]);

	return <Rect x={x} y={y} width={width} height={height} fill={gradient} alpha={opacity} pointerEvents={false} />;
}

/** The app background as a single full-bleed panel (a `flat` surface). */
export function Backdrop({ width, height, color = colors.bg }: { width: number; height: number; color?: string }) {
	return <Rect x={0} y={0} width={width} height={height} fill={color} pointerEvents={false} />;
}
