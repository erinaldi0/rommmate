/**
 * Access to the runtime's virtual keyboard (`navigator.virtualKeyboard`).
 *
 * Kept behind a small structural type so this code typechecks even if the
 * runtime's d.ts doesn't declare every member on `navigator`.
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

export function getVirtualKeyboard(): VirtualKeyboardLike | null {
	try {
		return (navigator as unknown as { virtualKeyboard?: VirtualKeyboardLike }).virtualKeyboard ?? null;
	} catch {
		return null;
	}
}
