/**
 * Text entry for settings rows: the system inline keyboard, its two silent
 * failure modes, and the built-in keyboard fallback that covers them.
 *
 * The system keyboard fails in two silent ways, and both are covered:
 * when the object could not be created at all, and when its *appear* call
 * fails (the object exists, but the runtime never shows it and the
 * bounding rect stays zero — on emulators the inline swkbd is headless).
 * Either way the built-in `InAppKeyboard` takes over, so the field stays
 * editable.
 *
 * `builtin` mode skips the system keyboard entirely and goes straight to
 * the built-in one, because on emulators the invisible system keyboard
 * would sit there "up", capture every key, and fill the field with
 * garbage the player cannot see.
 *
 * The hook owns all of that state (pending field, draft, keyboard
 * generation counters) plus the B-escape that dismisses a system keyboard
 * that captured input without ever becoming visible. The screen keeps
 * only what is its own: the rows, the focus, and the non-keyboard
 * buttons.
 */
import { useEffect, useRef, useState } from 'react';
import { SwkbdType } from '@nx.js/constants';
import { getVirtualKeyboard, virtualKeyboardError } from '../vk';
import { forceResumeGamepadLoop, useGamepadEscape } from './use-gamepad';
import type { KeyboardMode } from '../config';

/** One editable settings field. */
export type Field = 'baseUrl' | 'token' | 'username' | 'password' | 'pairingCode';

export interface TextEntryOptions {
	/** The Keyboard row's mode (auto → system → built-in); `builtin` skips the system keyboard. */
	keyboardMode?: KeyboardMode;
	/** True while a connection is in flight. */
	busy: boolean;
	/**
	 * Cancel the in-flight connection. A field the user explicitly reopens
	 * while the connection is running (a tap on the row, or A/ZR on it)
	 * cancels it and lets the edit happen — otherwise a launch with saved
	 * credentials would leave the rows untouchable for the whole load.
	 */
	onCancel?: () => void;
	/** The current value of a field (pre-fill for the keyboards). */
	fieldValue: (field: Field) => string;
	/** A keyboard committed its text (system OK, or built-in submit). */
	onValue: (field: Field, value: string) => void;
}

export interface TextEntry {
	/** The field the built-in keyboard is editing, or null when it is closed. */
	kbd: { field: Field; note: string } | null;
	/** The text currently being typed (the echo of the active keyboard). */
	draft: string;
	/** True while the system keyboard has a non-zero rect (i.e. it is up). */
	sysKbd: boolean;
	/** Set the live echo (the built-in keyboard types through it). */
	setDraft: (value: string) => void;
	/** True for a field some keyboard owns right now (system or built-in). */
	editing: (field: Field) => boolean;
	/** Open the keyboard for a field (see the module comment for `force`). */
	openField: (field: Field, force?: boolean) => void;
	/** Close the built-in keyboard; when `commit`, apply the draft. */
	closeField: (commit: boolean) => void;
}

export function useTextEntry(options: TextEntryOptions): TextEntry {
	const { keyboardMode, busy, onCancel } = options;

	// The option callbacks are read through a ref: they change identity on
	// every render of the screen, and the listener effect below must not
	// re-run on that (re-attaching mid-edit would restart the edit).
	const optionsRef = useRef(options);
	optionsRef.current = options;

	const vk = getVirtualKeyboard();
	/** The field the built-in keyboard is editing, or null when it is closed. */
	const [kbd, setKbd] = useState<{ field: Field; note: string } | null>(null);
	/** Mirror of `kbd` for listeners that cannot see the state (geometrychange). */
	const kbdRef = useRef<{ field: Field; note: string } | null>(null);
	/** Monotonic counter for the delayed appear-failure check. */
	const kbdGen = useRef(0);

	/** The field the system keyboard is editing, or null when it is not. */
	const pending = useRef<Field | null>(null);
	/** Live echo of the field being typed. */
	const [draft, setDraft] = useState('');

	/** True once the system keyboard has a non-zero rect (i.e. it is up). */
	const sysKbdUp = useRef(false);
	/** State mirror of `sysKbdUp`, for the on-screen indicator only. */
	const [sysKbd, setSysKbd] = useState(false);

	function startFallback(field: Field, note: string) {
		kbdGen.current += 1;
		pending.current = null;
		kbdRef.current = { field, note };
		setKbd({ field, note });
		setDraft(optionsRef.current.fieldValue(field));
	}

	function closeFallback(commit: boolean) {
		kbdGen.current += 1;
		const field = kbdRef.current?.field;
		kbdRef.current = null;
		setKbd(null);
		setDraft('');
		if (commit && field) {
			optionsRef.current.onValue(field, draft);
		}
	}

	/**
	 * Dismiss the system keyboard and take the input back. Only reachable
	 * while it is up (the loop runs B through the escape path then): on
	 * emulators the inline keyboard is headless, so without this the player
	 * could open it and have no way to close it.
	 */
	function dismissSystemKbd() {
		pending.current = null;
		setDraft('');
		sysKbdUp.current = false;
		setSysKbd(false);
		try {
			vk?.hide();
		} catch {
			/* a hide that fails is still a dismissal for our purposes */
		}
		// Some emulators keep a non-zero rect after hide. If the rect never
		// drops to zero, force the input loop back to normal handling.
		setTimeout(() => {
			if ((vk?.boundingRect.height ?? 0) > 0) forceResumeGamepadLoop();
		}, 400);
	}

	/**
	 * Open the on-screen keyboard for a field.
	 *
	 * `force` is for the user explicitly asking to change a field while a
	 * connection is in flight: the walk is running on the values being
	 * edited anyway, so cancel it and let the edit happen.
	 */
	function openField(field: Field, force = false) {
		if (busy && !force) return;
		if (busy) onCancel?.();

		// A field re-open closes whatever keyboard was open before.
		kbdGen.current += 1;
		kbdRef.current = null;
		setKbd(null);

		if ((keyboardMode ?? 'builtin') === 'builtin') {
			startFallback(field, 'Built-in keyboard (Keyboard setting)');
			return;
		}

		if (vk === null) {
			const err = virtualKeyboardError();
			startFallback(field, `System keyboard unavailable — using built-in${err ? ` (${err.slice(0, 30)})` : ''}`);
			return;
		}

		pending.current = field;
		// SwkbdType has no password variant, so the system keyboard cannot
		// mask — for secrets prefer the built-in Keyboard setting.
		vk.type = SwkbdType.Normal;
		vk.okButtonText = 'Done';
		vk.value = optionsRef.current.fieldValue(field);
		setDraft(vk.value);
		vk.show();

		// A failed appear leaves the rect at zero (the runtime ignores the
		// failure). Give the keyboard a moment to come up; if it never
		// does, fall back to the built-in one so the field is editable.
		kbdGen.current += 1;
		const gen = kbdGen.current;
		sysKbdUp.current = (vk.boundingRect.height ?? 0) > 0;
		if (!sysKbdUp.current) {
			setTimeout(() => {
				if (gen !== kbdGen.current) return;
				sysKbdUp.current = (vk.boundingRect.height ?? 0) > 0;
				if (!sysKbdUp.current) {
					startFallback(field, 'System keyboard did not appear — using built-in keyboard');
				}
			}, 1200);
		}
	}

	// Commit the keyboard contents when it closes (OK, Back, or any other
	// path that hides it). `pending` guards against stray commits.
	useEffect(() => {
		if (!vk) return;
		const commit = () => {
			const field = pending.current;
			if (!field) return;
			pending.current = null;
			const value = vk.value;
			setDraft('');
			optionsRef.current.onValue(field, value);
		};
		const onGeom = () => {
			setSysKbd((vk.boundingRect.height ?? 0) > 0);
			if (vk.boundingRect.height === 0) {
				commit();
			} else if (kbdRef.current !== null) {
				// The system keyboard came up (perhaps late, after a
				// failed first appear) while the built-in one was open:
				// it owns the bottom of the screen, so hide it and close
				// the built-in one.
				sysKbdUp.current = true;
				kbdGen.current += 1;
				vk.hide();
				kbdRef.current = null;
				setKbd(null);
				setDraft('');
			} else {
				sysKbdUp.current = true;
			}
		};
		const onInput = () => {
			// Only while we are actually editing through the system
			// keyboard: after a B-dismiss the field is ours again, and a
			// zombie keyboard must not overwrite the draft (a headless
			// emulator keyboard keeps pushing its buffer forever).
			if (pending.current !== null) setDraft(vk.value);
		};
		vk.addEventListener('submit', commit);
		vk.addEventListener('cancel', commit);
		vk.addEventListener('geometrychange', onGeom);
		vk.addEventListener('change', onInput);
		vk.addEventListener('cursormove', onInput);
		return () => {
			vk.removeEventListener('submit', commit);
			vk.removeEventListener('cancel', commit);
			vk.removeEventListener('geometrychange', onGeom);
			vk.removeEventListener('change', onInput);
			vk.removeEventListener('cursormove', onInput);
		};
	}, [vk]);

	// While the system keyboard is up the loop ignores the normal buttons
	// (the keyboard owns the controller); B stays live through the escape
	// path so a keyboard that never becomes visible can still be dismissed.
	useGamepadEscape(
		'B',
		() => {
			if (pending.current !== null) dismissSystemKbd();
		},
		[vk, pending],
	);

	return {
		kbd,
		draft,
		sysKbd,
		setDraft,
		editing: (field: Field) => pending.current === field || kbd?.field === field,
		openField,
		closeField: closeFallback,
	};
}
