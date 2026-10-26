/**
 * Focus memory: where the player was, remembered across an unmount.
 *
 * The library screens keep their focus while they stay mounted — the
 * detail screen paints over the grid, the disc picker floats above —
 * so a round trip through those restores focus for free. The routes
 * that *replace* the whole screen (the downloads queue, the setup
 * doctor) unmount the library, and a remount used to reset it to the
 * top: back from downloads, a 1 000-game library started over at tile 0.
 *
 * This is the small bridge over that gap: a screen saves its focus (and
 * scroll) on unmount under a key of its choosing, and restores it on
 * mount. Module-level on purpose — it lives exactly as long as the app
 * process, it is not persistence, and a library that changed while the
 * screen was away is handled by the screen's own clamps (every focus
 * index is re-clamped against the list it lands in).
 *
 * Kept separate from the focus state itself: this is a memory of it,
 * read once on mount and written once on unmount, never a live copy.
 */

/** One screen's remembered position. Opaque to this module. */
export interface FocusSnapshot {
	/** Indices the screen re-clamps against its own list lengths. */
	[key: string]: number | string | boolean;
}

const memory = new Map<string, FocusSnapshot>();

/** Remember `state` under `key` (called on unmount, from a ref). */
export function saveFocus(key: string, state: FocusSnapshot): void {
	memory.set(key, state);
}

/**
 * The position remembered under `key`, or `fallback` when there is
 * none (first visit — every screen starts at its sensible default).
 */
export function takeFocus<T extends FocusSnapshot>(key: string, fallback: T): T {
	return (memory.get(key) as T | undefined) ?? fallback;
}
