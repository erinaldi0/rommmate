/**
 * RetroAchievements display model.
 *
 * The raw achievement set comes from RomM's `merged_ra_metadata` (fetched on
 * demand) and the user's progress from RomM's `ra_progression` — this module
 * joins them by the RA game id into the single shape the two UI surfaces
 * (the detail badge and the achievements screen) render from.
 *
 * Everything is null-tolerant: a game RomM has not matched to RA (`raId` 0,
 * empty set) and a user with no linked account (null progression) both
 * degrade to an honest "nothing to show" rather than a crash.
 */
import type { RomRAchievement, RomRAGameProgression } from '../romm';

/** One achievement, joined with the user's unlock state for it. */
export interface RaAchievementView {
	id: number;
	title: string;
	description: string;
	points: number;
	/** How many players worldwide have it (softcore). */
	numAwarded: number;
	/** How many have it in hardcore. */
	numAwardedHardcore: number;
	displayOrder: number;
	/** True when the user has unlocked it (softcore). */
	earned: boolean;
	/** True when the user unlocked it in hardcore. */
	earnedHardcore: boolean;
	/** ISO date of the user's softcore unlock, or null when locked. */
	dateEarned: string | null;
	/** ISO date of the user's hardcore unlock, or null when none. */
	dateHardcore: string | null;
}

/** The composed per-game view the screens render. */
export interface RaGameView {
	/** The RA game id (0 = not matched). */
	raId: number;
	/** True when the game has a published achievement set. */
	official: boolean;
	/** The published set, ordered for display, joined with unlock state. */
	achievements: RaAchievementView[];
	/** How many achievements the set has. */
	total: number;
	/** How many the user has unlocked (softcore), null when unknown. */
	earned: number | null;
	/** The user's unlocked achievement ids (strings). */
	earnedIds: Set<string>;
	/** Points the user has earned, or null when the user has no progression. */
	earnedPoints: number | null;
	/** Total published points. */
	possiblePoints: number;
	/** True when the user has any hardcore unlock. */
	hardcore: boolean;
	/** ISO date of the most recent unlock, or null. */
	lastAwarded: string | null;
}

/** The cheap "compatible with RetroAchievements" signal (the detail badge). */
export function isRaCompatible(raId: number): boolean {
	return raId > 0;
}

/**
 * Join a game's published achievement set with the user's progress on it.
 *
 * @param raId the game's RA id (from `RommGame.raId`).
 * @param achievements the published set (from RomM), or null when none.
 * @param progression the user's progress for this RA game, or null.
 */
export function buildRaGameView(
	raId: number,
	achievements: RomRAchievement[] | null,
	progression: RomRAGameProgression | null,
): RaGameView {
	const set = achievements ?? [];

	// The earned set, both sides compared as strings (the server strings the
	// ids in `earned_achievements` but numbers them in the catalog).
	const earnedIds = new Set<string>();
	const hardcoreIds = new Set<string>();
	const earnedDates = new Map<string, { date: string; dateHardcore: string | null }>();
	if (progression !== null) {
		for (const e of progression.earned) {
			earnedIds.add(e.id);
			earnedDates.set(e.id, { date: e.date, dateHardcore: e.dateHardcore });
			if (e.dateHardcore !== null) hardcoreIds.add(e.id);
		}
	}

	const views: RaAchievementView[] = set.map((a) => {
		const key = String(a.id);
		const got = earnedDates.get(key);
		return {
			id: a.id,
			title: a.title,
			description: a.description,
			points: a.points,
			numAwarded: a.numAwarded,
			numAwardedHardcore: a.numAwardedHardcore,
			displayOrder: a.displayOrder,
			earned: earnedIds.has(key),
			earnedHardcore: hardcoreIds.has(key),
			dateEarned: got?.date !== '' ? got?.date ?? null : null,
			dateHardcore: got?.dateHardcore ?? null,
		};
	});
	views.sort((x, y) => x.displayOrder - y.displayOrder || x.id - y.id);

	const possiblePoints = views.reduce((s, v) => s + v.points, 0);
	// Count from the set is the fallback when the server gave no total; the
	// server's own `num_awarded` wins when present (it can include
	// achievements the list omits).
	const earnedFromSet = views.filter((v) => v.earned).length;
	const earned =
		progression !== null && progression.numAwarded !== null
			? progression.numAwarded
			: earnedFromSet;
	const earnedPoints = views.filter((v) => v.earned).reduce((s, v) => s + v.points, 0);

	return {
		raId,
		official: set.length > 0,
		achievements: views,
		total: views.length,
		earned,
		earnedIds,
		earnedPoints: progression !== null ? earnedPoints : null,
		possiblePoints,
		hardcore:
			(progression?.numAwardedHardcore ?? 0) > 0 || views.some((v) => v.earnedHardcore),
		lastAwarded: progression?.mostRecentAwardedDate ?? null,
	};
}

/**
 * One line of progress for the detail badge area: "3/12 achievements · 25% ·
 * 40/160 pts · hardcore" — '' when there is nothing to report.
 */
export function raSummary(view: RaGameView): string {
	if (!view.official) return '';
	const earned = view.earned ?? 0;
	const pct = view.total > 0 ? Math.round((earned / view.total) * 100) : 0;
	const bits = [`${earned}/${view.total} achievements`, `${pct}%`];
	if (view.possiblePoints > 0 && view.earnedPoints !== null) {
		bits.push(`${view.earnedPoints}/${view.possiblePoints} pts`);
	}
	if (view.hardcore) bits.push('hardcore');
	return bits.join(' · ');
}
