import React from 'react';
import { Rect, Text, useParent } from 'react-tela';
import { colors, fontFamily, fontSize, radius } from '../theme';
import { wrapLines } from '../text';
import { CoverImage } from './CoverImage';
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
export function CoverTile({ game, x, y, width, height, focused }: Props) {
	const { ctx } = useParent();

	const name = game.name || `Game #${game.id}`;
	const titleLines = wrapLines(ctx, name, width - 8, 2, fontSize.label);

	return (
		<>
			{/* Cover backing plate — also the placeholder background. */}
			<Rect
				x={x}
				y={y}
				width={width}
				height={height}
				fill={colors.coverBg}
				borderRadius={radius.md}
			/>

			{/*
			 * Placeholder glyph. It sits *under* the artwork, so a cover
			 * that arrives later simply covers it — no layout change, no
			 * second render pass.
			 */}
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

			<CoverImage
				url={game.coverUrl}
				x={x}
				y={y}
				width={width}
				height={height}
			/>

			{/* Hairline on top of the artwork to keep the corners tidy. */}
			<Rect
				x={x}
				y={y}
				width={width}
				height={height}
				stroke={colors.border}
				lineWidth={1}
				borderRadius={radius.md}
			/>

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
