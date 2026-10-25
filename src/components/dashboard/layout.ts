/**
 * The dashboard's shared geometry.
 *
 * One table for every screen-level position the dashboard's subcomponents
 * agree on: the screen's left margin, the row grid, the hero's zone and
 * the installation panel's column. The subcomponents (`HeroCard`,
 * `InstallPanel`, `TileRow`, `PlatformChipStrip`, `SectionMenu`) lay their
 * own internals out against these, so a coordinate change happens here
 * once, never three screens apart.
 *
 * Vertical budget at 720p: header 0–84, hero 88–338, rows 344–648, and
 * the hint bar owns the last 72 px.
 */

/** Left margin: the header, hero and covers share it. */
export const MARGIN_X = 24;

/** Where the rows live (below the header's 84 px and the hero). */
export const ROWS_Y = 344;
/** How tall one row is: header + cover + two text lines. */
export const ROW_H = 184;
/** The rows' viewport — the hint bar owns the bottom of the screen. */
export const ROWS_H = 304;

/** The tile grid: first cover, its size (3:4 covers) and pitch. */
export const TILE_X0 = MARGIN_X;
export const COVER_W = 88;
export const COVER_H = 117; // 3:4 cover art
export const PITCH_X = COVER_W + 10;

/** The hero: box art on the left, facts and actions to its right. */
export const HERO_Y = 88;
export const HERO_COVER_W = 188;
export const HERO_COVER_H = 250; // 3:4 box art
export const HERO_COL_X = MARGIN_X + 212;

/** The right-hand installation panel's column. */
export const PANEL_X = 948;
export const PANEL_W = 1280 - PANEL_X - MARGIN_X;
export const PANEL_H = 250;

/** Hero focus target index of the disc pager (after cover/primary/sync/more). */
export const HERO_PAGER = 4;

/** The chip strip's gap. */
export const CHIP_GAP = 10;

// Local type-scale shorthands (the hero's and rows' sizes sit between
// the theme tokens; keeping them named here keeps the components honest
// about what each glyph's size is).
export const fsChip = 13; // platform chip label / tile name
export const fsButton = 15; // hero action button labels
