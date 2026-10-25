/**
 * One row cover: the artwork, its frame, and the placeholder that stands
 * in while it is missing.
 *
 * The frame rect doubles as the backing plate: its fill is the dark plate
 * while the artwork is absent and transparent once it has landed. It is
 * deliberately drawn *after* the artwork, because react-tela's
 * `insertBefore` splices a re-inserted tile's children back in reversed
 * order when a row re-sorts mid-stream — a plate that sits beneath the
 * image in the JSX ends up painted *over* it, darkening a tile whose
 * cover is fully loaded. A transparent frame is harmless whichever way
 * the block lands, so the tile renders correctly in both orders.
 */
import React, { useState } from 'react';
import { Rect, Text } from 'react-tela';
import { colors, fontFamily, radius } from '../../theme';
import { CoverImage, type CoverStatus } from '../CoverImage';
import type { Fit } from '../../covers';

interface Props {
	url: string;
	/** One-letter placeholder, shown only while there is no artwork. */
	glyph: string;
	x: number;
	y: number;
	width: number;
	height: number;
	fit?: Fit;
	/** False keeps the placeholder up and downloads nothing (off-screen). */
	enabled?: boolean;
}

export function CoverSlot({ url, glyph, x, y, width, height, fit = 'cover', enabled = true }: Props) {
	const [status, setStatus] = useState<CoverStatus>(url === '' ? 'ready' : 'loading');
	// The plate is needed whenever the artwork is not on screen: the cover
	// never existed, or it has not landed yet (or it failed).
	const placeholderVisible = url === '' || status !== 'ready';
	return (
		<>
			<CoverImage
				url={url}
				x={x}
				y={y}
				width={width}
				height={height}
				fit={fit}
				enabled={enabled}
				onStatus={setStatus}
			/>
			<Rect
				x={x}
				y={y}
				width={width}
				height={height}
				fill={placeholderVisible ? colors.coverBg : undefined}
				stroke={colors.border}
				lineWidth={1}
				borderRadius={radius.md}
			/>
			{glyph !== '' && placeholderVisible && (
				<Text
					x={x + width / 2}
					y={y + height / 2 - 36}
					fontFamily={fontFamily}
					fontSize={56}
					fill={colors.coverGlyph}
					textAlign="center"
				>
					{glyph}
				</Text>
			)}
		</>
	);
}
