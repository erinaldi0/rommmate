/**
 * RomM REST client — TypeScript port of the v1 C++/libcurl implementation
 * (see git history 6cc4721 for the original; kept as reference for the
 * defensive JSON shapes).
 *
 * Auth: long-lived RomM Client API Token ("rmm_...") sent as
 * `Authorization: Bearer <token>` on every request.
 *
 * Endpoints used:
 *   GET /api/roms   — the game list (name, platform, cover art, screenshot,
 *                     description, genres, release date, rom size, play
 *                     state and the multi-disc sibling group), walked page
 *                     by page until the library is exhausted; the optional
 *                     `favorite=true` and `collection_id` filters power the
 *                     favourites and collections sections
 *   GET /api/collections — the saved collections (a 5.x-only feature)
 *
 * RomM versions drift in the details, so parsing stays defensive:
 *   - 5.x answers `limit`/`offset` with `{ items, total, limit, offset, ... }`
 *     and keeps genres / release date in a `metadatum` blob.
 *   - ≤4.x ignores those parameters and answers with a bare array (or a
 *     `data` / `results` wrapper) of its own default page size; the client
 *     then falls back to FastAPI's `_limit`/`_page` to keep paging.
 * The dialect is sniffed from the shape of the first page.
 *
 * The module is split by concern:
 *   types.ts   — the shapes the app works with (RommGame, RommTitle, …)
 *   parse.ts   — the defensive per-field parsers across RomM generations
 *   dialect.ts — the two API dialects: page sizes, query strings, page shape
 *   group.ts   — grouping roms (discs) into browsable titles
 *   client.ts  — the RommClient itself (auth probe, walks, collections)
 * `./romm` resolves here, so importing side keeps the old single-module path.
 */

export type {
	RommCollection,
	RommGame,
	RommPlatform,
	RommRomFile,
	RommSibling,
	RommTitle,
	LibrarySection,
	GetGamesOptions,
	RomRATag,
	RomRAchievement,
	RomRAEarnedAchievement,
	RomRAGameProgression,
	RomRAProgression,
} from './types';
export { groupTitles } from './group';
export { normalizeBaseUrl, RommClient } from './client';
export type {
	ClientSaveState,
	PlaySessionEntry,
	RommDevice,
	RommFirmware,
	RommSave,
	RommState,
	SyncNegotiateResult,
	SyncOperation,
} from './play';
