import React, { useState } from 'react';
import { Rect, Text, useParent } from 'react-tela';
import { colors, fontFamily, fontSize, radius } from '../theme';
import { measure, wrapLines } from '../text';
import { CoverImage, type CoverStatus } from './CoverImage';
import type { RommGame } from '../romm';

interface Props {
	game: RommGame;
	/** Top-left corner of the cover. */
	x: number;
	y: number;
	/** Cover width in pixels. */
	width: number;
	/** Cover height in pixels. */
	height: number;
	/** True when this tile owns the focus ring. */
	focused: boolean;
	/**
	 * Name to print under the cover, overriding `game.name`. Multi-disc
	 * titles show the release name, not the name of the disc on screen.
	 */
	nameOverride?: string;
	/** 1-based position of the disc the tile is showing, for multi-disc games. */
	discIndex?: number;
	/** How many discs the game has; the badge only appears above 1. */
	discCount?: number;
}

/** Height of one title line. */
export const TITLE_LINE_H = 21;
/** Height of the platform line under the title. */
export const PLATFORM_LINE_H = 17;
/** Vertical space the text block below the cover needs. */
export const TITLE_BLOCK_H = TITLE_LINE_H * 2 + PLATFORM_LINE_H;

/**
 * One game in the grid: cover art, title, platform.
 *
 * The tile is drawn as a stack of plain entities on the root canvas — the
 * offscreen `<Group>` of react-tela is deliberately avoided, because a
 * failure inside it aborts the whole frame.
 */
export function CoverTile({
	game,
	x,
	y,
	width,
	height,
	focused,
	nameOverride = '',
	discIndex,
	discCount,
}: Props) {
	const { ctx } = useParent();

	const name = nameOverride !== '' ? nameOverride : game.name || `Game #${game.id}`;
	const titleLines = wrapLines(ctx, name, width - 8, 2, fontSize.label);

	// The plate and the glyph are only needed while the artwork is absent.
	// CoverImage reports its lifecycle so the two can step aside; a cover
	// that never existed keeps them for good.
	const [coverStatus, setCoverStatus] = useState<CoverStatus>(
		game.coverUrl === '' ? 'ready' : 'loading',
	);
	// A tile that is reused for a different game resets its placeholder
	// state with the url (CoverImage reports the same, this just avoids a
	// stale frame in between).
	React.useEffect(() => {
		setCoverStatus(game.coverUrl === '' ? 'ready' : 'loading');
	}, [game.coverUrl]);
	const placeholderVisible = game.coverUrl === '' || coverStatus !== 'ready';

	// A multi-disc release wears a small badge over the corner of the cover:
	// which disc is on screen, of how many there are.
	const multi = discCount !== undefined && discCount > 1 && discIndex !== undefined;
	const badgeText = multi ? `${discIndex}/${discCount}` : '';
	const badgeW = badgeText === '' ? 0 : measure(ctx, badgeText, 13) + 12;

	return (
		<>
			<CoverImage
				url={game.coverUrl}
				x={x}
				y={y}
				width={width}
				height={height}
				onStatus={setCoverStatus}
			/>

			{/*
			 * Backing plate and hairline in one rect, drawn *after* the
			 * artwork. react-tela's insertBefore splices a re-inserted
			 * tile's children back in reversed order when the grid re-sorts,
			 * so a plate that sits beneath the image in the JSX ends up
			 * painted *over* it — a tile with its cover fully loaded renders
			 * dark. The plate therefore turns transparent the moment the
			 * artwork lands: a transparent frame is harmless whichever way
			 * the block landed, and it is the opaque placeholder while the
			 * cover is still missing.
			 */}
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

			{/*
			 * Placeholder glyph, above the plate. It exists only while the
			 * placeholder does: a cover that arrives unmounts it, so it can
			 * never sit on top of the artwork whichever order the tile
			 * landed in.
			 */}
			{placeholderVisible && (
				<Text
					x={x + width / 2}
					y={y + height / 2 - 42}
					fontFamily={fontFamily}
					fontSize={64}
					fill={colors.coverGlyph}
					textAlign="center"
				>
					{name.trim().charAt(0).toUpperCase() || '?'}
				</Text>
			)}

			{multi && (
				<>
					<Rect
						x={x + 8}
						y={y + 8}
						width={badgeW}
						height={20}
						fill={colors.accent}
						borderRadius={radius.sm}
					/>
					<Text
						x={x + 8 + badgeW / 2}
						y={y + 12}
						fontFamily={fontFamily}
						fontSize={13}
						fontWeight="bold"
						fill={colors.bg}
						textAlign="center"
					>
						{badgeText}
					</Text>
				</>
			)}

			{titleLines.map((line, i) => (
				<Text
					key={`title-${i}`}
					x={x + 2}
					y={y + height + 8 + i * TITLE_LINE_H}
					fontFamily={fontFamily}
					fontSize={fontSize.label}
					fill={focused ? colors.textPrimary : colors.textSecondary}
				>
					{line}
				</Text>
			))}

			{game.platform !== '' && (
				<Text
					x={x + 2}
					y={y + height + 8 + titleLines.length * TITLE_LINE_H}
					fontFamily={fontFamily}
					fontSize={fontSize.tiny}
					fill={colors.textFaint}
					maxWidth={width - 4}
					overflow="ellipsis"
				>
					{game.platform}
				</Text>
			)}
		</>
	);
}

/**
 * The focus ring around the focused cover.
 *
 * It is drawn separately from the tile so the library screen can paint it
 * *after* the bands that mask the overflowing rows — otherwise the ring of
 * a half-scrolled tile would be clipped by the mask.
 */
export function CoverFocusRing({
	x,
	y,
	width,
	height,
}: {
	x: number;
	y: number;
	width: number;
	height: number;
}) {
	return (
		<Rect
			x={x - 6}
			y={y - 6}
			width={width + 12}
			height={height + 12}
			stroke={colors.accent}
			lineWidth={4}
			borderRadius={radius.xl}
		/>
	);
}
