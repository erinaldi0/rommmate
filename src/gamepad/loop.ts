/**
 * Gamepad input loop for nx.js (Web Gamepad API).
 *
 * Ported from TooTallNate/switch-nsp-forwarder (MIT License, Nathan
 * Rajlich): an rAF-driven loop with edge-triggered button callbacks,
 * optional auto-repeat, and stick-direction tracking. The runtime's
 * `navigator.getGamepads()` returns the connected controllers and
 * `@nx.js/constants` `Button` maps named Switch buttons to their
 * (non-standard) HID-report indices.
 *
 * The loop is a process-wide singleton: one rAF chain reads the
 * controller, and the React hooks in `hooks/use-gamepad` register
 * callbacks with it (see there for the register/unregister side).
 */
import { Button } from '@nx.js/constants';
import { getVirtualKeyboard, type VirtualKeyboardLike } from '../vk';

export type ButtonName = keyof typeof Button;
export type Direction = Extract<ButtonName, 'Up' | 'Down' | 'Left' | 'Right'>;

interface CallbackConfig {
	callback: () => void;
	repeat: boolean;
	initialDelay: number;
	repeatDelay: number;
}

/**
 * Repeat timing, owned by the loop and keyed per input (`btn:A`, `stk:Up`,
 * `esc:B`).
 *
 * React re-registers a callback whenever its deps change (a fresh function
 * identity on every relevant re-render). The repeat state used to live on
 * the config object, so every re-registration reset `lastTriggerTime` to
 * zero: "time since last trigger" then looked like it had been forever,
 * and a still-pressed button auto-repeated on every frame until released.
 * Holding the timing here (per button, not per callback) means a
 * re-registration resumes where it left off: a deliberate press is one
 * action, a held button repeats at the configured cadence.
 */
interface RepeatState {
	lastTriggerTime: number;
	hasMetRepeatDelay: boolean;
}

const defaultInitialDelay = 500;
const defaultRepeatDelay = 100;

class GamepadLoop {
	#callbacks = new Map<CallbackConfig, ButtonName>();
	#stickCallbacks = new Map<CallbackConfig, Direction>();
	/**
	 * Callbacks checked only while the system keyboard is up: the keyboard
	 * owns the controller then, but B stays live as the way out of a
	 * keyboard that captured input without ever becoming visible (the
	 * inline swkbd is headless on emulators).
	 */
	#escapeCallbacks = new Map<CallbackConfig, ButtonName>();
	/** Repeat timing, keyed by `btn:<name>` / `stk:<dir>` / `esc:<name>`. */
	#timing = new Map<string, RepeatState>();
	/** The pending animation frame, or 0 when the chain is idle. */
	#frame = 0;
	/** True while the frame chain is alive. */
	#running = false;
	#virtualKeyboard: VirtualKeyboardLike | null = null;
	#keyboardBound = false;
	/** True while the system on-screen keyboard reports itself up. */
	#keyboardUp = false;
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
		this.#keyboardUp = (this.#virtualKeyboard?.boundingRect.height ?? 0) > 0;
	}

	/**
	 * The on-screen keyboard, if the runtime has one.
	 *
	 * The listener is attached once: while the keyboard is up the loop
	 * switches to escape-only mode (the player is typing then, not
	 * navigating), and resumes normally when it closes.
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
		if (
			this.#callbacks.size === 0 &&
			this.#stickCallbacks.size === 0 &&
			this.#escapeCallbacks.size === 0
		) {
			return;
		}
		this.#running = true;
		this.#schedule();
	}

	/**
	 * Take the controller back even if the runtime's keyboard state lags
	 * behind (some emulators keep a non-zero rect after hide).
	 */
	forceResume() {
		this.#keyboardUp = false;
		this.buttonState = [];
		this.queueLoop();
	}

	#onVirtualKeyboardGeometryChange = () => {
		const up = (this.#keyboard()?.boundingRect.height ?? 0) > 0;
		if (up === this.#keyboardUp) return;
		this.#keyboardUp = up;
		if (!up) {
			// Clean slate: button state gathered while the keyboard owned
			// the input must not produce stale edges on resume.
			this.buttonState = [];
		}
		this.queueLoop();
	};

	#handleCallback(
		config: CallbackConfig,
		wasPressed: boolean,
		isPressed: boolean,
		currentTime: number,
		key: string,
	) {
		let t = this.#timing.get(key);
		if (!t) {
			t = { lastTriggerTime: 0, hasMetRepeatDelay: false };
			this.#timing.set(key, t);
		}
		const timeSinceLastTrigger = currentTime - t.lastTriggerTime;

		if (!wasPressed && isPressed) {
			// First press — trigger immediately
			config.callback();
			t.hasMetRepeatDelay = false; // reset to wait for initial delay
			t.lastTriggerTime = currentTime;
		} else if (isPressed && config.repeat) {
			// For repeats, check that we've waited long enough
			const delay = t.hasMetRepeatDelay ? config.repeatDelay : config.initialDelay;
			if (timeSinceLastTrigger >= delay) {
				config.callback();
				t.lastTriggerTime = currentTime;
				t.hasMetRepeatDelay = true; // mark that we've met initial delay
			}
		} else if (!isPressed) {
			t.hasMetRepeatDelay = false;
			t.lastTriggerTime = 0;
		}
	}

	/** Track the pressed edge of one button in the shared state. */
	#trackButton(buttonNum: number, isPressed: boolean): boolean {
		const wasPressed = this.buttonState[buttonNum] ?? false;
		if (!wasPressed && isPressed) {
			this.buttonState[buttonNum] = true;
		} else if (wasPressed && !isPressed) {
			this.buttonState[buttonNum] = false;
		}
		return wasPressed;
	}

	loop = () => {
		this.#frame = 0;

		if (
			this.#callbacks.size === 0 &&
			this.#stickCallbacks.size === 0 &&
			this.#escapeCallbacks.size === 0
		) {
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
			if (this.#keyboardUp) {
				/*
				 * The system keyboard owns the controller. Everything except
				 * the escape callbacks is skipped, but the button state is
				 * kept current so edges are correct when it closes.
				 */
				for (const [config, button] of this.#escapeCallbacks) {
					const buttonNum = Button[button];
					const isPressed = gp.buttons[buttonNum]?.pressed ?? false;
					const wasPressed = this.#trackButton(buttonNum, isPressed);
					if (!wasPressed && isPressed) config.callback();
				}
			} else {
				// Handle button callbacks
				for (const [config, button] of this.#callbacks) {
					const buttonNum = Button[button];
					const isPressed = gp.buttons[buttonNum]?.pressed ?? false;
					const wasPressed = this.#trackButton(buttonNum, isPressed);
					this.#handleCallback(config, wasPressed, isPressed, currentTime, `btn:${button}`);
				}

				const currentStickDirection = this.#getCurrentStickDirection(gp);

				// Handle stick callbacks
				for (const [config, direction] of this.#stickCallbacks) {
					const wasPressed = this.stickDirection[direction];
					const isPressed = currentStickDirection[direction];
					this.#handleCallback(config, wasPressed, isPressed, currentTime, `stk:${direction}`);
				}

				this.stickDirection = currentStickDirection;
			}
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

	#makeConfig(
		cb: () => void,
		repeat = false,
		initialDelay = defaultInitialDelay,
		repeatDelay = defaultRepeatDelay,
	): CallbackConfig {
		return { callback: cb, repeat, initialDelay, repeatDelay };
	}

	add(
		cb: () => void,
		button: ButtonName,
		repeat = false,
		initialDelay = defaultInitialDelay,
		repeatDelay = defaultRepeatDelay,
	) {
		this.#callbacks.set(this.#makeConfig(cb, repeat, initialDelay, repeatDelay), button);
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
		this.#stickCallbacks.set(this.#makeConfig(cb, repeat, initialDelay, repeatDelay), direction);
		this.queueLoop();
	}

	/**
	 * A callback checked only while the system keyboard is up (edge-triggered,
	 * never repeated). B is registered here by the screen that opens the
	 * keyboard, so an invisible keyboard can always be dismissed.
	 */
	addEscape(cb: () => void, button: ButtonName) {
		this.#escapeCallbacks.set(this.#makeConfig(cb, false), button);
		this.queueLoop();
	}

	/**
	 * Remove a callback.
	 *
	 * Every registration of the callback is removed: the same function can
	 * be registered for several buttons (or for a button and a direction),
	 * and a leftover registration would keep firing forever. Repeat timing
	 * for keys that no longer have any registration is dropped.
	 */
	delete(cb: () => void) {
		for (const [config] of [...this.#callbacks]) {
			if (config.callback === cb) this.#callbacks.delete(config);
		}
		for (const [config] of [...this.#stickCallbacks]) {
			if (config.callback === cb) this.#stickCallbacks.delete(config);
		}
		for (const [config] of [...this.#escapeCallbacks]) {
			if (config.callback === cb) this.#escapeCallbacks.delete(config);
		}
		this.#pruneTiming();
		if (
			this.#callbacks.size === 0 &&
			this.#stickCallbacks.size === 0 &&
			this.#escapeCallbacks.size === 0
		) {
			this.#stop();
		}
	}

	deleteEscape(cb: () => void) {
		for (const [config] of [...this.#escapeCallbacks]) {
			if (config.callback === cb) this.#escapeCallbacks.delete(config);
		}
		this.#pruneTiming();
	}

	#pruneTiming() {
		const alive = new Set<string>();
		for (const name of this.#callbacks.values()) alive.add(`btn:${name}`);
		for (const dir of this.#stickCallbacks.values()) alive.add(`stk:${dir}`);
		for (const name of this.#escapeCallbacks.values()) alive.add(`esc:${name}`);
		for (const key of [...this.#timing.keys()]) {
			if (!alive.has(key)) this.#timing.delete(key);
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

/** The process-wide loop the React hooks register callbacks with. */
export const gamepadLoop = new GamepadLoop();

/**
 * Force the input loop back to normal handling, even if the runtime's
 * keyboard rect lags behind a hide (see `GamepadLoop.forceResume`).
 */
export function forceResumeGamepadLoop(): void {
	gamepadLoop.forceResume();
}
