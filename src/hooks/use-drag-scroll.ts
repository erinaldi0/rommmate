import { useEffect, useRef } from 'react';
import { useParent } from 'react-tela';

/**
 * Drag-to-scroll on the canvas.
 *
 * Both touch (the Switch screen) and mouse (the browser preview harness)
 * are handled: the runtime reports touches with `clientX`/`clientY`, and
 * the browser reports the same for mouse events, so one code path covers
 * both.
 *
 * The events are read through small structural types rather than the DOM
 * ones — the nx.js runtime turns the DOM lib off, so `MouseEvent` has no
 * `clientY` there.
 *
 * The callback is kept in a ref so the listener is attached once instead of
 * being re-subscribed on every frame.
 */

/** A point of contact, as reported by a touch or a mouse. */
interface PointLike {
	clientY?: number;
}

/** Vertical position of an event, or null when it carries none. */
function pointY(event: Event): number | null {
	const touches = (event as { touches?: ArrayLike<PointLike> }).touches;
	if (touches && touches.length > 0) {
		const y = touches[0].clientY;
		return typeof y === 'number' ? y : null;
	}

	const y = (event as { clientY?: number }).clientY;
	return typeof y === 'number' ? y : null;
}

export function useDragScroll(enabled: boolean, onDelta: (dy: number) => void): void {
	const { ctx } = useParent();
	const deltaRef = useRef(onDelta);
	deltaRef.current = onDelta;

	useEffect(() => {
		if (!enabled) return;

		const canvas = ctx.canvas as unknown as EventTarget;
		let lastY: number | null = null;

		const onStart = (event: Event) => {
			lastY = pointY(event);
		};

		const onMove = (event: Event) => {
			const y = pointY(event);
			if (y === null) return;
			if (lastY === null) {
				lastY = y;
				return;
			}
			const dy = lastY - y;
			lastY = y;
			if (dy !== 0) deltaRef.current(dy);
		};

		const onEnd = () => {
			lastY = null;
		};

		canvas.addEventListener('touchstart', onStart);
		canvas.addEventListener('touchmove', onMove);
		canvas.addEventListener('touchend', onEnd);
		canvas.addEventListener('mousedown', onStart);
		canvas.addEventListener('mousemove', onMove);
		canvas.addEventListener('mouseup', onEnd);

		return () => {
			canvas.removeEventListener('touchstart', onStart);
			canvas.removeEventListener('touchmove', onMove);
			canvas.removeEventListener('touchend', onEnd);
			canvas.removeEventListener('mousedown', onStart);
			canvas.removeEventListener('mousemove', onMove);
			canvas.removeEventListener('mouseup', onEnd);
		};
	}, [ctx, enabled]);
}
