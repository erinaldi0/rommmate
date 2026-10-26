/**
 * The dashboard's featured game — the hero.
 *
 * The dashboard's redesign leads with one game: the most recently played
 * title (else the most recently added, else the first), drawn large with
 * its facts, install state and actions. This module builds that model —
 * pure construction, no React — plus the small pieces of the Play-state
 * vocabulary (`primaryRow`, the state chip map, byte formatting) that the
 * hero and the detail screen both need. Keeping them here means the two
 * screens can never disagree about what a state implies.
 */
import { colors } from '../../theme';
import { play } from '../../play';
import type { PlayState } from '../../play';
import type { Fit } from '../../covers';
import type { ChipTone } from '../ui/Chip';
import type { RommGame, RommTitle } from '../../romm';

/** Human readable file size (empty for an unknown size). */
export function formatBytes(bytes: number): string {
	if (bytes <= 0) return '';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * A status pill: its text and colours. The `tone` is the design-system
 * form — the home screen draws the pill with the shared `StatusChip`, so
 * its colour comes from the status ramp and can never drift from any
 * other chip in the app. The `fill` / `textFill` pair stays because the
 * detail screen still draws its own pills from it (Phase 3 will move it
 * over); the two must keep agreeing until then.
 */
export interface Chip {
	text: string;
	fill: string;
	textFill: string;
	/** The status-ramp tone the design-system chip draws this state as. */
	tone?: ChipTone;
}

/** The install-state pill for one PlayState. */
export function stateChip(state: PlayState): Chip {
	switch (state.kind) {
		case 'demo':
			return { text: 'Demo', fill: colors.surfaceRaised, textFill: colors.textMuted, tone: 'neutral' };
		case 'unsupported':
			return { text: 'No core', fill: colors.surfaceRaised, textFill: colors.warning, tone: 'warning' };
		case 'not-installed':
			return { text: 'Not installed', fill: colors.surfaceRaised, textFill: colors.textMuted, tone: 'surface' };
		case 'installing':
			return { text: 'Installing…', fill: colors.accentMuted, textFill: colors.accent, tone: 'accent' };
		case 'ready':
			return { text: 'Installed', fill: colors.surfaceRaised, textFill: colors.success, tone: 'success' };
		case 'stale':
			return { text: 'Outdated', fill: colors.surfaceRaised, textFill: colors.warning, tone: 'warning' };
	}
}

/**
 * The primary action, from the game's play state. Its label follows the
 * verb the state implies — the same button reads "Install game", then
 * "Installing…", then "Play game" — and when it cannot do anything it
 * says why.
 */
/** The primary action, as `primaryRow` returns it. */
export interface PrimaryAction {
	label: string;
	detail: string;
	tone: 'ok' | 'warn' | 'dim' | 'accent';
	enabled: boolean;
	run: () => void;
}

export function primaryRow(
	game: RommGame,
	state: PlayState,
	notify: (message: string) => void,
): PrimaryAction {
	const sizeText = game.sizeBytes > 0 ? ` · ${formatBytes(game.sizeBytes)}` : '';
	switch (state.kind) {
		case 'demo':
			return { label: 'Play game', detail: 'demo mode — connect a server', tone: 'dim', enabled: false, run: () => {} };
		case 'unsupported':
			return {
				label: 'Play game',
				detail: `no core for ${game.platform || 'this platform'}`,
				tone: 'warn',
				enabled: false,
				run: () => {},
			};
		case 'not-installed':
			return {
				label: 'Install game',
				detail: `download${sizeText}`,
				tone: 'accent',
				enabled: true,
				run: () => {
					void play.install(game).then(notify);
				},
			};
		case 'installing':
			return { label: 'Installing…', detail: '', tone: 'accent', enabled: false, run: () => {} };
		case 'stale':
			return {
				label: 'Re-download',
				detail: 'changed on the server',
				tone: 'warn',
				enabled: true,
				run: () => {
					void play.install(game).then(notify);
				},
			};
		default:
			return {
				label: 'Play game',
				detail: '',
				tone: 'accent',
				enabled: true,
				run: () => {
					void play.play(game).then(notify);
				},
			};
	}
}

/** The dashboard hero: the featured title and everything it displays. */
export interface Hero {
	title: RommTitle;
	/** The disc the hero represents (the player's choice, else the main disc). */
	disc: RommGame;
	/** Index (into `title.discs`) of the shown disc. */
	discIndex: number;
	/** The disc's 1-based position within the release (stubs included). */
	discSlot: number;
	/** Every disc of the release the server knows about, stubs included. */
	knownDiscs: number;
	/** The cover art of the shown disc, else the title's cover. */
	coverUrl: string;
	/** How the cover art fits the hero box (disc covers have the box's aspect). */
	coverFit?: Fit;
	platform: string;
	/** First two genre names, " · " -joined (empty when unknown). */
	genre: string;
	/** `YYYY`, or '' when the server gave no release date. */
	year: string;
	summary: string;
	sizeBytes: number;
}

/**
 * The hero model for one title: the shown disc (the player's choice, or
 * an explicitly forced one for the focus-preview) and everything the
 * hero's columns display.
 */
function heroOf(title: RommTitle, discSelections: Record<number, number>, forcedIndex?: number): Hero | null {
	const rawIndex = forcedIndex ?? discSelections[title.key] ?? title.mainIndex;
	const discIndex = Math.min(Math.max(0, rawIndex), title.discs.length - 1);
	const disc = title.discs[discIndex];
	if (disc === undefined) return null;

	return {
		title,
		disc,
		discIndex,
		discSlot: title.discReleaseSlots[discIndex] ?? discIndex + 1,
		knownDiscs: title.knownDiscs,
		coverUrl: disc.coverUrl !== '' ? disc.coverUrl : title.coverUrl,
		platform: title.platform,
		genre: disc.genres.slice(0, 2).join(' · '),
		year: disc.releaseDate.slice(0, 4),
		summary: disc.summary,
		sizeBytes: disc.sizeBytes,
	};
}

/**
 * The featured title: most recently played, else most recently added,
 * else the first of the library (the dashboard needs a face even before
 * any play history exists).
 */
export function buildHero(titles: RommTitle[], discSelections: Record<number, number>): Hero | null {
	if (titles.length === 0) return null;
	const byRecency = (a: RommTitle, b: RommTitle) => (a.lastPlayedAt > b.lastPlayedAt ? -1 : a.lastPlayedAt < b.lastPlayedAt ? 1 : 0);
	const played = titles.filter((t) => t.lastPlayedAt !== '').sort(byRecency)[0];
	const added = titles
		.filter((t) => t.createdAt !== '')
		.sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0))[0];
	const title = played ?? added ?? titles[0];
	if (title === undefined) return null;
	return heroOf(title, discSelections);
}

/**
 * The hero for an arbitrary title, one disc forced — the focus preview:
 * a row tile holds the focus and the hero follows it.
 */
export function heroForTile(title: RommTitle, discIndex: number): Hero | null {
	return heroOf(title, {}, discIndex);
}
