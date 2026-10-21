import { useEffect, useRef } from 'react';
import { useParent } from 'react-tela';

/** A point in canvas coordinates (logical 1280×720 space). */
export interface TapPoint {
	x: number;
	y: number;
}

/**
 * Tap (touch or mouse) on the canvas, delivered as logical canvas
 * coordinates.
 *
 * Same pattern as `useDragScroll`: the canvas is the listener target, the
 * event is read through a small structural type (the runtime turns the DOM
 * lib off, so there is no `MouseEvent` to lean on), and the callback is kept
 * in a ref so the listener is attached once instead of being re-subscribed on
 * every render.
 *
 * Touch (the Switch screen) arrives as `touchstart` with `touches[0]`; the
 * browser preview reports the same coordinates for a mouse press, so one code
 * path covers both. When the element exposes a bounding rect (the preview
 * window, which a user could scale) the coordinates are normalised to the
 * canvas' logical size, so hit-testing keeps working; on the runtime the
 * canvas *is* the screen and the ratio is 1:1.
 */
export function useCanvasTap(enabled: boolean, onTap: (p: TapPoint) => void): void {
	const { ctx } = useParent();
	const cbRef = useRef(onTap);
	cbRef.current = onTap;

	useEffect(() => {
		if (!enabled) return;

		const canvas = ctx.canvas as unknown as {
			width: number;
			height: number;
			addEventListener(type: string, listener: (event: Event) => void): void;
			removeEventListener(type: string, listener: (event: Event) => void): void;
			getBoundingClientRect?: () => { left: number; top: number; width: number; height: number };
		};

		const point = (event: Event): TapPoint | null => {
			// Touch first, then mouse: a press carries the point on the
			// touch (or, for a plain mouse event, on the event itself).
			const touch =
				(event as { touches?: ArrayLike<{ clientX?: number; clientY?: number }> }).touches?.[0] ??
				(event as { changedTouches?: ArrayLike<{ clientX?: number; clientY?: number }> }).changedTouches
					?.[0];
			let x = touch?.clientX ?? (event as { clientX?: number }).clientX;
			let y = touch?.clientY ?? (event as { clientY?: number }).clientY;
			if (typeof x !== 'number' || typeof y !== 'number') return null;

			// Map element (CSS) pixels to logical canvas pixels.
			if (typeof canvas.getBoundingClientRect === 'function') {
				const rect = canvas.getBoundingClientRect();
				if (rect.width > 0 && rect.height > 0) {
					x = (x - rect.left) * (canvas.width / rect.width);
					y = (y - rect.top) * (canvas.height / rect.height);
				}
			}
			return { x, y };
		};

		const onDown = (event: Event) => {
			const p = point(event);
			if (p !== null) cbRef.current(p);
		};

		canvas.addEventListener('touchstart', onDown);
		canvas.addEventListener('mousedown', onDown);

		return () => {
			canvas.removeEventListener('touchstart', onDown);
			canvas.removeEventListener('mousedown', onDown);
		};
	}, [ctx, enabled]);
}
