/**
 * One horizontal row of cover tiles: the header (label + count), the
 * covers, the multi-disc badges and the two text lines under each cover.
 *
 * Presentational: the screener culls rows to the viewport, hands one row
 * in with its current focus index, and draws the focus ring itself (the
 * ring must paint above the row-masking bands, which the tiles must not).
 */
import React from 'react';
import { Rect, Text } from 'react-tela';
import { colors, fontFamily, radius } from '../../theme';
import { COVER_H, COVER_W, PITCH_X, TILE_X0 } from './layout';
import { CoverSlot } from './cover-slot';
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
	const coverTop = y + 26;
	const nameW = PITCH_X - 6;

	return (
		<>
			{/* The header text is drawn by the screener (it also sizes the
				focus ring around it); here only the covers and their text. */}
			{row.tiles.map((t, ti) => {
				const x = TILE_X0 + ti * PITCH_X;
				const covered = t.coverUrl !== '' ? '' : (t.name.trim().charAt(0).toUpperCase() || '?');
				const enabled = ti <= maxCol || (focused && ti === focusSel);
				return (
					<React.Fragment key={t.key}>
						<CoverSlot
							url={t.coverUrl}
							glyph={covered}
							x={x}
							y={coverTop}
							width={COVER_W}
							height={COVER_H}
							enabled={enabled}
						/>

						{/* Multi-disc badge over the corner of the cover. */}
						{t.discCount !== undefined && t.discCount > 1 && t.discIndex !== undefined && (
							<Rect x={x + 6} y={coverTop + 6} width={30} height={18} fill={colors.accent} borderRadius={radius.sm} />
						)}
						{t.discCount !== undefined && t.discCount > 1 && t.discIndex !== undefined && (
							<Text
								x={x + 6 + 15}
								y={coverTop + 15}
								fontFamily={fontFamily}
								fontSize={10}
								fill={colors.textPrimary}
								textAlign="center"
								textBaseline="middle"
							>
								{`${t.discIndex}/${t.discCount}`}
							</Text>
						)}

						<Text
							x={x}
							y={coverTop + COVER_H + 15}
							fontFamily={fontFamily}
							fontSize={13}
							textBaseline="alphabetic"
							fill={focused && ti === focusSel ? colors.textPrimary : colors.textSecondary}
							maxWidth={nameW}
							overflow="ellipsis"
						>
							{t.name}
						</Text>
						{t.sub !== '' && (
							<Text
								x={x}
								y={coverTop + COVER_H + 32}
								fontFamily={fontFamily}
								fontSize={10}
								textBaseline="alphabetic"
								fill={colors.textFaint}
								maxWidth={nameW}
								overflow="ellipsis"
							>
								{t.sub}
							</Text>
						)}
					</React.Fragment>
				);
			})}
		</>
	);
}
