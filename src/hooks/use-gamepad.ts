/**
 * React bindings for the gamepad input loop (`gamepad/loop.ts`).
 *
 * Each hook registers a callback with the process-wide loop for the
 * lifetime of the effect, and the `focused` flag gates it (a screen that
 * does not own the input — the detail overlay, the disc picker — passes
 * `paused` through). Callbacks re-register whenever their deps change;
 * the loop keys repeat timing per button, so a re-registration resumes
 * the cadence instead of restarting it (see `GamepadLoop`).
 */
import { type DependencyList, useCallback, useEffect } from 'react';
import { gamepadLoop, forceResumeGamepadLoop, type ButtonName, type Direction } from '../gamepad/loop';

export { forceResumeGamepadLoop };
export type { ButtonName, Direction };

export function useGamepadButton(
	button: ButtonName,
	callback: () => void,
	deps: DependencyList = [],
	focused = true,
	repeat?: boolean,
	initialDelay?: number,
	repeatDelay?: number,
) {
	const cb = useCallback(callback, deps);

	useEffect(() => {
		if (!focused) {
			gamepadLoop.delete(cb);
			return;
		}
		gamepadLoop.add(cb, button, repeat, initialDelay, repeatDelay);
		return () => {
			gamepadLoop.delete(cb);
		};
	}, [focused, cb, button, repeat, initialDelay, repeatDelay]);
}

export function useJoystick(
	direction: Direction,
	callback: () => void,
	deps: DependencyList = [],
	focused = true,
	repeat?: boolean,
	initialDelay?: number,
	repeatDelay?: number,
) {
	const cb = useCallback(callback, deps);

	useEffect(() => {
		if (!focused) {
			gamepadLoop.delete(cb);
			return;
		}
		gamepadLoop.addStick(cb, direction, repeat, initialDelay, repeatDelay);
		return () => {
			gamepadLoop.delete(cb);
		};
	}, [focused, cb, direction, repeat, initialDelay, repeatDelay]);
}

/**
 * Listen for both d-pad and stick directions together
 */
export function useDirection(
	direction: Direction,
	callback: () => void,
	deps: DependencyList = [],
	focused = true,
	repeat?: boolean,
	initialDelay?: number,
	repeatDelay?: number,
) {
	const cb = useCallback(callback, deps);

	useEffect(() => {
		if (!focused) {
			gamepadLoop.delete(cb);
			return;
		}

		// Add both callbacks with their respective configs
		gamepadLoop.add(cb, direction, repeat, initialDelay, repeatDelay);
		gamepadLoop.addStick(cb, direction, repeat, initialDelay, repeatDelay);

		return () => {
			gamepadLoop.delete(cb);
		};
	}, [focused, cb, direction, repeat, initialDelay, repeatDelay]);
}

/**
 * A button callback that fires only while the system keyboard is up.
 *
 * Registered for B by the screen that opens the keyboard: everything else
 * is owned by the keyboard, but B stays live so a keyboard that captured
 * input without ever becoming visible (headless on emulators) can still be
 * dismissed.
 */
export function useGamepadEscape(
	button: ButtonName,
	callback: () => void,
	deps: DependencyList = [],
) {
	const cb = useCallback(callback, deps);

	useEffect(() => {
		gamepadLoop.addEscape(cb, button);
		return () => {
			gamepadLoop.deleteEscape(cb);
		};
	}, [cb, button]);
}
