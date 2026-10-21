/**
 * Gamepad input loop for nx.js (Web Gamepad API).
 *
 * Ported from TooTallNate/switch-nsp-forwarder (MIT License, Nathan
 * Rajlich): an rAF-driven loop with edge-triggered button callbacks,
 * optional auto-repeat, and stick-direction tracking. The runtime's
 * `navigator.getGamepads()` returns the connected controllers and
 * `@nx.js/constants` `Button` maps named Switch buttons to their
 * (non-standard) HID-report indices.
 */
import { Button } from '@nx.js/constants';
import { type DependencyList, useCallback, useEffect } from 'react';
import { getVirtualKeyboard, type VirtualKeyboardLike } from '../vk';

export type ButtonName = keyof typeof Button;
type Direction = Extract<ButtonName, 'Up' | 'Down' | 'Left' | 'Right'>;

interface CallbackConfig {
	callback: () => void;
	repeat: boolean;
	initialDelay: number;
	repeatDelay: number;
	lastTriggerTime: number;
	hasMetRepeatDelay: boolean;
}

const defaultInitialDelay = 500;
const defaultRepeatDelay = 100;

class GamepadLoop {
	#callbacks = new Map<CallbackConfig, ButtonName>();
	#stickCallbacks = new Map<CallbackConfig, Direction>();
	/** The pending animation frame, or 0 when the chain is idle. */
	#frame = 0;
	/** True while the frame chain is alive. */
	#running = false;
	#virtualKeyboard: VirtualKeyboardLike | null = null;
	#keyboardBound = false;
	stickDirection = {
		Up: false,
		Down: false,
		Left: false,
		Right: false,
	} as Record<Direction, boolean>;
	buttonState: boolean[] = [];

	constructor() {
		// Resolved eagerly, but `#keyboard()` retries while it is missing, so
		// a keyboard that shows up later is still picked up.
		this.#keyboard();
	}

	/**
	 * The on-screen keyboard, if the runtime has one.
	 *
	 * The listener is attached once: the keyboard pauses the input loop
	 * while it covers the screen, because the player is typing then, not
	 * navigating.
	 */
	#keyboard(): VirtualKeyboardLike | null {
		if (!this.#virtualKeyboard) {
			this.#virtualKeyboard = getVirtualKeyboard();
			if (this.#virtualKeyboard && !this.#keyboardBound) {
				this.#virtualKeyboard.addEventListener(
					'geometrychange',
					this.#onVirtualKeyboardGeometryChange,
				);
				this.#keyboardBound = true;
			}
		}
		return this.#virtualKeyboard;
	}

	/** The first connected controller, or null when there is none. */
	#readGamepad(): Gamepad | null {
		const pads = navigator.getGamepads();
		for (const pad of pads) {
			if (pad) return pad;
		}
		return null;
	}

	#schedule() {
		if (this.#frame) return;
		this.#frame = requestAnimationFrame(this.loop);
	}

	#stop() {
		this.#running = false;
		if (this.#frame) {
			cancelAnimationFrame(this.#frame);
			this.#frame = 0;
		}
	}

	queueLoop() {
		if (this.#running) return;
		const vk = this.#keyboard();
		// The on-screen keyboard owns the input while it is open.
		if ((vk?.boundingRect.height ?? 0) > 0) return;
		this.#running = true;
		this.#schedule();
	}

	#onVirtualKeyboardGeometryChange = () => {
		if ((this.#keyboard()?.boundingRect.height ?? 0) > 0) {
			this.#stop();
		} else {
			this.queueLoop();
		}
	};

	#handleCallback(
		config: CallbackConfig,
		wasPressed: boolean,
		isPressed: boolean,
		currentTime: number,
	) {
		const timeSinceLastTrigger = currentTime - config.lastTriggerTime;

		if (!wasPressed && isPressed) {
			// First press — trigger immediately
			config.callback();
			config.hasMetRepeatDelay = false; // reset to wait for initial delay
			config.lastTriggerTime = currentTime;
		} else if (isPressed && config.repeat) {
			// For repeats, check that we've waited long enough
			const delay = config.hasMetRepeatDelay
				? config.repeatDelay
				: config.initialDelay;
			if (timeSinceLastTrigger >= delay) {
				config.callback();
				config.lastTriggerTime = currentTime;
				config.hasMetRepeatDelay = true; // mark that we've met initial delay
			}
		} else if (!isPressed) {
			config.hasMetRepeatDelay = false;
			config.lastTriggerTime = 0;
		}
	}

	loop = () => {
		this.#frame = 0;

		if (this.#callbacks.size === 0 && this.#stickCallbacks.size === 0) {
			this.#running = false;
			return;
		}

		const currentTime = performance.now();
		const gp = this.#readGamepad();

		/*
		 * A missing controller is not fatal: nx.js returns an empty array
		 * when nothing is plugged in, and the player may connect a
		 * controller at any moment. The chain keeps running so the input
		 * comes back on its own.
		 */
		if (gp) {
			// Handle button callbacks
			for (const [config, button] of this.#callbacks) {
				const buttonNum = Button[button];
				const wasPressed = this.buttonState[buttonNum] ?? false;
				const isPressed = gp.buttons[buttonNum]?.pressed ?? false;

				if (!wasPressed && isPressed) {
					this.buttonState[buttonNum] = true;
				} else if (wasPressed && !isPressed) {
					this.buttonState[buttonNum] = false;
				}

				this.#handleCallback(config, wasPressed, isPressed, currentTime);
			}

			const currentStickDirection = this.#getCurrentStickDirection(gp);

			// Handle stick callbacks
			for (const [config, direction] of this.#stickCallbacks) {
				const wasPressed = this.stickDirection[direction];
				const isPressed = currentStickDirection[direction];
				this.#handleCallback(config, wasPressed, isPressed, currentTime);
			}

			this.stickDirection = currentStickDirection;
		} else {
			// A controller that goes away must not leave a button stuck
			// in the "pressed" state, or the next press is not an edge.
			this.buttonState = [];
			this.stickDirection = {
				Up: false,
				Down: false,
				Left: false,
				Right: false,
			};
		}

		this.#schedule();
	};

	add(
		cb: () => void,
		button: ButtonName,
		repeat = false,
		initialDelay = defaultInitialDelay,
		repeatDelay = defaultRepeatDelay,
	) {
		const config: CallbackConfig = {
			callback: cb,
			repeat,
			initialDelay,
			repeatDelay,
			lastTriggerTime: 0,
			hasMetRepeatDelay: false,
		};
		this.#callbacks.set(config, button);
		this.queueLoop();
	}

	// Only the left stick is checked for now.
	addStick(
		cb: () => void,
		direction: Direction,
		repeat = false,
		initialDelay = defaultInitialDelay,
		repeatDelay = defaultRepeatDelay,
	) {
		const config: CallbackConfig = {
			callback: cb,
			repeat,
			initialDelay,
			repeatDelay,
			lastTriggerTime: 0,
			hasMetRepeatDelay: false,
		};
		this.#stickCallbacks.set(config, direction);
		this.queueLoop();
	}

	/**
	 * Remove a callback.
	 *
	 * Every registration of the callback is removed: the same function can
	 * be registered for several buttons (or for a button and a direction),
	 * and a leftover registration would keep firing forever.
	 */
	delete(cb: () => void) {
		for (const [config] of this.#callbacks) {
			if (config.callback === cb) this.#callbacks.delete(config);
		}
		for (const [config] of this.#stickCallbacks) {
			if (config.callback === cb) this.#stickCallbacks.delete(config);
		}
		if (this.#callbacks.size === 0 && this.#stickCallbacks.size === 0) {
			this.#stop();
		}
	}

	#getCurrentStickDirection(gp: Gamepad) {
		const deadzone = 0.2; // avoid accidental triggers
		const threshold = 0.7; // threshold for the stick to count as pressed

		const [hAxis, vAxis] = gp.axes;

		const currentStickDirection = {
			Up: false,
			Down: false,
			Left: false,
			Right: false,
		} as Record<Direction, boolean>;

		// Only set one direction, based on whichever axis has the largest magnitude
		if (Math.abs(hAxis) > deadzone || Math.abs(vAxis) > deadzone) {
			if (Math.abs(hAxis) > Math.abs(vAxis)) {
				const direction = hAxis > 0 ? 'Right' : 'Left';
				const wasPressed = this.stickDirection[direction];
				if (!wasPressed && Math.abs(hAxis) > threshold) {
					currentStickDirection[direction] = true;
				} else if (wasPressed && Math.abs(hAxis) < deadzone) {
					currentStickDirection[direction] = false;
				} else {
					currentStickDirection[direction] = wasPressed;
				}
			} else {
				const direction = vAxis > 0 ? 'Down' : 'Up';
				const wasPressed = this.stickDirection[direction];
				if (!wasPressed && Math.abs(vAxis) > threshold) {
					currentStickDirection[direction] = true;
				} else if (wasPressed && Math.abs(vAxis) < deadzone) {
					currentStickDirection[direction] = false;
				} else {
					currentStickDirection[direction] = wasPressed;
				}
			}
		}
		return currentStickDirection;
	}
}

const gamepadLoop = new GamepadLoop();

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
