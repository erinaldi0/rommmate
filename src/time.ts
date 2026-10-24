/**
 * Human-readable times for the library sections.
 *
 * The canvas has no `Intl` niceties to lean on, so these are small,
 * deterministic formats: "3 d ago" on a cover row, a plain date elsewhere.
 */

/**
 * A compact relative time: "just now", "12 m ago", "3 h ago", "6 d ago",
 * or the date itself once the moment is older than a month.
 *
 * @param iso an ISO timestamp (as RomM sends it), or "" for no value.
 * @param now the reference time in milliseconds (injectable for tests).
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
	if (iso === '') return '';
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return '';

	const ago = now - then;
	if (ago < 0 || ago < 60_000) return 'just now';
	if (ago < 3_600_000) return `${Math.floor(ago / 60_000)} m ago`;
	if (ago < 86_400_000) return `${Math.floor(ago / 3_600_000)} h ago`;
	if (ago < 30 * 86_400_000) return `${Math.floor(ago / 86_400_000)} d ago`;
	return formatDate(iso);
}

/** "Oct 24, 2026" — the short date used under "Recently added" covers. */
export function formatDate(iso: string): string {
	if (iso === '') return '';
	const date = new Date(Date.parse(iso));
	if (Number.isNaN(date.getTime())) return '';

	// Local (not UTC) components: a date near midnight must read the same
	// day the user sees on the system clock.
	const MONTHS = [
		'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
		'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
	];
	return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}
