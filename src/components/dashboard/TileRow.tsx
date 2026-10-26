/**
 * One horizontal row of cover cards: the Continue playing / Favourites /
 * Recently added / Collections rows, each drawn through the design
 * system's one `CoverCard` — the same card everywhere, so a cover's
 * artwork, placeholder, title, second line, disc badge and focus ring can
 * never drift between the rows that show it.
 *
 * Presentational: the screener culls rows to the viewport, hands one row
 * in with its current focus index, and the focused card draws its own
 * ring (the focused row is always fully scrolled into view, so an inline
 * ring never meets the masking bands).
 */
import React from 'react';
import { CoverCard } from '../ui';
import { COVER_H, COVER_W, PITCH_X, TILE_X0, fsTileSub, fsTileTitle } from './layout';
import type { DisplayRow } from './section-rows';

interface Props {
	row: DisplayRow;
	/** The row's top edge on screen (already scrolled). */
	y: number;
	/** True when this row owns the focus. */
	focused: boolean;
	/** The focused cover's index (≥ 0; the label is handled by the screener). */
	focusSel: number;
	/**
	 * How many columns fit the screen: tiles beyond it never display, so
	 * their covers must not download either (the on-device discipline).
	 */
	maxCol: number;
}

export function TileRow({ row, y, focused, focusSel, maxCol }: Props) {
	return (
		<>
			{/* The header text is drawn by the screener (it also sizes the
				focus ring around it); here only the covers and their text. */}
			{row.tiles.map((t, ti) => {
				const x = TILE_X0 + ti * PITCH_X;
				const enabled = ti <= maxCol || (focused && ti === focusSel);
				const badge =
					t.discCount !== undefined && t.discCount > 1 && t.discIndex !== undefined
						? `${t.discIndex}/${t.discCount}`
						: undefined;
				return (
					<CoverCard
						key={t.key}
						x={x}
						y={y + 26}
						width={COVER_W}
						height={COVER_H}
						coverUrl={t.coverUrl}
						name={t.name}
						platform={t.sub}
						fit={t.fit}
						focused={focused && ti === focusSel}
						enabled={enabled}
						badge={badge}
						titleSize={fsTileTitle}
						titleLines={1}
						platformSize={fsTileSub}
					/>
				);
			})}
		</>
	);
}
