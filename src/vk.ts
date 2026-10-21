/**
 * Access to the runtime's virtual keyboard (`navigator.virtualKeyboard`).
 *
 * Kept behind a small structural type so this code typechecks even if the
 * runtime's d.ts doesn't declare every member on `navigator`.
 *
 * The runtime *lazily creates* the keyboard on first access: the creation
 * call (`swkbdInlineCreate` + `swkbdInlineLaunchForLibraryApplet`) can fail
 * on some systems, in which case the property getter **throws**. The keyboard
 * is also known to fail its *appear* call silently (the object exists, but
 * the system never shows it and the bounding rect stays zero).
 *
 * Both failures are turned into a readable error here, so the caller can
 * fall back to the in-app keyboard (`InAppKeyboard`) instead of leaving the
 * field uneditable.
 */
export interface VirtualKeyboardLike {
	boundingRect: { height: number };
	value: string;
	/** SwkbdType (from @nx.js/constants) — keyboard layout. */
	type?: number;
	/** Text of the OK button (max 8 chars). */
	okButtonText?: string;
	show(): void;
	hide(): void;
	addEventListener(type: string, listener: () => void): void;
	removeEventListener(type: string, listener: () => void): void;
}

let creationError: string | null = null;

export function getVirtualKeyboard(): VirtualKeyboardLike | null {
	try {
		creationError = null;
		return (navigator as unknown as { virtualKeyboard?: VirtualKeyboardLike }).virtualKeyboard ?? null;
	} catch (err) {
		creationError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
		console.error(`RomMmate: virtual keyboard unavailable (${creationError})`);
		return null;
	}
}

/**
 * Why the keyboard object could not be created, or null when it is (or was
 * last) healthy. `getVirtualKeyboard()` retries creation on every call while
 * it is failing, so this always reflects the latest attempt.
 */
export function virtualKeyboardError(): string | null {
	return creationError;
}
