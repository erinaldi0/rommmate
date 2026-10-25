/**
 * The shapes the app works with.
 *
 * These are the normalised result of the defensive parsers (`parse.ts`) and
 * the disc grouping (`group.ts`): whatever RomM generation answered, the
 * rest of the app only ever sees these.
 */

/** One disc of a multi-disc release, as reported by the server. */
export interface RommSibling {
	id: number;
	/** Disc ordering key provided by the server (empty when it gave none). */
	sort: string;
	/** File name, for display in the disc picker. */
	fsName: string;
	/** Identified name, when the server knows one. */
	name: string;
	/** True when the server marks this disc as the main one. */
	isMain: boolean;
}

export interface RommGame {
	id: number;
	name: string;
	/** The server's id of the platform this rom belongs to; 0 when unknown. */
	platformId: number;
	/** e.g. "Nintendo 64" — empty when unknown. */
	platform: string;
	/** Absolute URL to cover art, or "" when none. */
	coverUrl: string;
	/** Absolute URL to a 16:9 screenshot, or "" when none. */
	screenshotUrl: string;
	/** Long description, or "" when unknown. */
	summary: string;
	/** Release date (`YYYY-MM-DD`), or "" when unknown. */
	releaseDate: string;
	/** Genre names — empty when unknown. */
	genres: string[];
	/** Size of the rom file in bytes; 0 when unknown. */
	sizeBytes: number;
	/**
	 * Canonical id of the game (release) this rom belongs to: the smallest
	 * disc id of the group, or a negative content hash for unidentified roms.
	 * All discs of one game share it, so it doubles as the grouping key.
	 */
	gameKey: number;
	/** Every known disc of the game, this one included. */
	siblings: RommSibling[];
	/** True when this rom is the user-designated main disc. */
	isMain: boolean;
	/** File name (no extension) — the disc's identity in the picker. */
	fsName: string;
	/** ISO timestamp of the last play, or "" when never played. */
	lastPlayedAt: string;
	/** ISO timestamp of when the rom was added, or "" when unknown. */
	createdAt: string;
	/** True when the server reports the rom as a favourite. */
	favorite: boolean;
}

/**
 * A game as the library is actually browsed: all discs of one release
 * grouped under one title. A single-disc game is a one-disc title.
 */
export interface RommTitle {
	/** The group key (see `RommGame.gameKey`). */
	key: number;
	/** Display name of the release. */
	name: string;
	/** The server's id of the release's platform; 0 when unknown. */
	platformId: number;
	/** Platform name of the release, or of its represented disc. */
	platform: string;
	/** Cover of the main disc, else the first disc that has one. */
	coverUrl: string;
	/** Screenshot of the main disc, else the first disc that has one. */
	screenshotUrl: string;
	/** Every disc with a full entry, in the server's disc order. */
	discs: RommGame[];
	/**
	 * How many discs the release is known to have, stubs included — every
	 * sibling list seen sharpens it. It is ≥ `discs.length` (a favourites
	 * walk fetches only the favoured roms, but their sibling stubs still
	 * count the whole release), and it is what the multi-disc badge shows.
	 */
	knownDiscs: number;
	/**
	 * For each disc in `discs`: its 1-based position within the whole
	 * release (stubs included). It equals the disc's own index plus one
	 * for a full title, and keeps the badge naming the *same* disc in a
	 * partial one (a favourites walk) as in the rows that hold it all.
	 */
	discReleaseSlots: number[];
	/** Index (into `discs`) of the disc the title represents by default. */
	mainIndex: number;
	/** Latest play across the discs, "" when none. */
	lastPlayedAt: string;
	/** Latest addition across the discs, "" when unknown. */
	createdAt: string;
}

/** A saved collection on the server (RomM 5.x). */
export interface RommCollection {
	id: number;
	name: string;
	romCount: number;
	/** Absolute URL to the collection cover, or "" when none. */
	coverUrl: string;
	/**
	 * Which `collection` filter parameter selects it: regular, smart
	 * (rule-based) and virtual (search-backed) collections use distinct
	 * parameters on the roms endpoint.
	 */
	kind: 'user' | 'smart' | 'virtual';
}

/**
 * A platform as the server knows it. The dashboard shows one tile per
 * platform that has roms in the library, with the platform's own logo
 * (the same artwork the RomM web UI shows on its platforms page).
 */
export interface RommPlatform {
	id: number;
	/** Display name (a user rename wins), or "" when unknown. */
	name: string;
	/** Absolute URL to the platform's logo, or "" when it has none. */
	logoUrl: string;
	/** How many roms the server has on this platform. */
	romCount: number;
}

/**
 * A browseable section of the library dashboard. Opening one shows the
 * grid with that slice of the library.
 */
export type LibrarySection =
	| { kind: 'continue' }
	| { kind: 'favourites' }
	| { kind: 'recent' }
	| { kind: 'platform'; platform: string }
	| { kind: 'collection'; collection: RommCollection };

/** Options for a filtered `getGames` walk. */
export interface GetGamesOptions {
	/** Only roms the user marked as favourite (a 5.x filter). */
	favoriteOnly?: boolean;
	/** Only the roms of one saved collection. */
	collection?: RommCollection;
}
