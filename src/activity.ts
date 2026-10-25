/**
 * Background activity, reported into a tiny external store and rendered by
 * `<ActivityBadge/>` (top-right of every screen).
 *
 * The app does real work that the main flow never shows: the library page
 * walk at connect time, and the artwork prefetch that keeps running while
 * the user browses. The badge is the single visible trace of all of it —
 * one short line per running activity, nothing more.
 *
 * The store is deliberately React-free: `covers.ts` (a plain module) and
 * `App.tsx` (React) both report into it, and the badge subscribes with
 * `useSyncExternalStore`. There are no timers — a badge only re-renders
 * when a label actually changes, which keeps it off the coarse-tick path.
 */

export type ActivityKey = 'library' | 'artwork' | 'download' | 'sync';

export interface Activity {
	key: ActivityKey;
	label: string;
}

const listeners = new Set<() => void>();
const active = new Map<ActivityKey, string>();
let snapshot: Activity[] = [];

function emit(): void {
	snapshot = [...active.entries()].map(([key, label]) => ({ key, label }));
	for (const listener of listeners) listener();
}

/**
 * Set the label of a background activity, or clear it with `null`.
 * No-ops (same label, or clearing an absent activity) do not wake the
 * badge, so per-cover prefetch chatter does not repaint the canvas.
 */
export function setActivity(key: ActivityKey, label: string | null): void {
	if (label === null || label === '') {
		if (!active.has(key)) return;
		active.delete(key);
		emit();
		return;
	}
	if (active.get(key) === label) return;
	active.set(key, label);
	emit();
}

/** Subscribe to activity changes; returns the unsubscribe function. */
export function subscribeActivity(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** The current activities (stable identity until something changes). */
export function getActivities(): Activity[] {
	return snapshot;
}

/** Test seam: forget every activity. */
export function resetActivities(): void {
	if (active.size === 0) return;
	active.clear();
	emit();
}
