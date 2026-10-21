/**
 * Animation-frame shim for the browser preview (dev-only, not shipped).
 *
 * Headless Chrome (the way the layout screenshots are taken) produces a
 * single animation frame per page load, so any `requestAnimationFrame`
 * chain — the gamepad input loop, for one — dies after one frame and the
 * simulated input never reaches the app.
 *
 * The native frame is still used when the compositor produces one; a timer
 * is kept as a fallback so the chain keeps running when it does not. Both
 * paths call the callback exactly once.
 */

const nativeRequest = window.requestAnimationFrame.bind(window);
const nativeCancel = window.cancelAnimationFrame.bind(window);

let nextId = 1;
const fallbacks = new Map<number, number>();

window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
	const id = nextId++;
	let done = false;

	const run = (time: number) => {
		if (done) return;
		done = true;
		fallbacks.delete(id);
		callback(time);
	};

	const timer = window.setTimeout(() => run(performance.now()), 16);
	fallbacks.set(id, timer);
	nativeRequest(run);

	return id;
};

window.cancelAnimationFrame = (id: number): void => {
	const timer = fallbacks.get(id);
	if (timer !== undefined) {
		window.clearTimeout(timer);
		fallbacks.delete(id);
	}
	nativeCancel(id);
};
