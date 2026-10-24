import React, { useState } from 'react';
import { Rect, Text, useDimensions, useParent } from 'react-tela';
import { colors, fontFamily, fontSize, radius, space } from '../theme';
import { truncate, wrapLines } from '../text';
import { useGamepadButton } from '../hooks/use-gamepad';
import { Header } from './Header';
import { HintBar } from './HintBar';
import { CoverImage, type CoverStatus } from './CoverImage';
import { Spinner } from './Spinner';
import { BUILD_ID } from '../version';
import type { RommGame } from '../romm';

interface Props {
	game: RommGame;
	/** Return to the library. */
	onBack: () => void;
	/** The disc's position in its release, when the game has several. */
	disc?: { index: number; count: number };
}

const COVER_W = 200;
const COVER_H = 267;
const LEFT_X = 72;
const COVER_Y = 112;
const SHOT_W = 320;
const SHOT_H = 180;
const SHOT_Y = 400;
/** The facts column starts clear of the screenshot on the left. */
const COL_X = 420;
const META_ROW_H = 30;
const SUMMARY_LINE_H = 27;

/** Human readable file size. */
function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * The detail screen for a single game.
 *
 * Two columns: artwork on the left, the facts and the blurb on the right.
 * Everything is optional — a rom with no description, no genres and no
 * screenshot still renders as a coherent page instead of a half empty one.
 */
export function GameDetail({ game, onBack, disc }: Props) {
	const dims = useDimensions();
	const { ctx } = useParent();

	useGamepadButton('B', onBack, [onBack]);

	// The cover is downloaded in the background; the screen says so instead
	// of showing a placeholder that looks like the final artwork.
	const [coverStatus, setCoverStatus] = useState<CoverStatus>(
		game.coverUrl === '' ? 'ready' : 'loading',
	);
	const coverLoading = coverStatus === 'loading';
	// The plate behind the cover is only needed while the artwork is absent.
	const placeholderVisible = game.coverUrl === '' || coverStatus !== 'ready';

	const name = game.name || `Game #${game.id}`;
	const title = truncate(ctx, name, dims.width - 320, fontSize.display);
	const colW = dims.width - COL_X - space.xl;

	const rows: Array<[string, string]> = [];
	if (disc !== undefined && disc.count > 1) rows.push(['Disc', `${disc.index + 1} of ${disc.count}`]);
	if (game.platform !== '') rows.push(['Platform', game.platform]);
	if (game.releaseDate !== '') rows.push(['Released', game.releaseDate]);
	if (game.genres.length > 0) rows.push(['Genres', game.genres.join(', ')]);
	if (game.sizeBytes > 0) rows.push(['Size', formatBytes(game.sizeBytes)]);

	const summaryLines =
		game.summary === ''
			? []
			: wrapLines(ctx, game.summary, colW, 9, fontSize.body);

	const summaryY = 118 + rows.length * META_ROW_H + 28;

	return (
		<>
			{/* Opaque background — the detail screen covers the grid. */}
			<Rect width={dims.width} height={dims.height} fill={colors.bg} />

			<Header
				title={title}
				subtitle={game.platform === '' ? '' : game.platform}
				build={BUILD_ID}
			/>

			{/*
			 * Cover art (or its placeholder). The plate+frame rect is drawn
			 * after the artwork and fills only while the placeholder shows,
			 * so a re-inserted block can never paint over the cover (see
			 * CoverTile for why).
			 */}
			<CoverImage
				url={game.coverUrl}
				x={LEFT_X}
				y={COVER_Y}
				width={COVER_W}
				height={COVER_H}
				onStatus={setCoverStatus}
			/>
			<Rect
				x={LEFT_X}
				y={COVER_Y}
				width={COVER_W}
				height={COVER_H}
				fill={placeholderVisible ? colors.coverBg : undefined}
				stroke={colors.border}
				lineWidth={1}
				borderRadius={radius.md}
			/>
			{placeholderVisible && (
				<Text
					x={LEFT_X + COVER_W / 2}
					y={COVER_Y + COVER_H / 2 - 40}
					fontFamily={fontFamily}
					fontSize={56}
					fill={colors.coverGlyph}
					textAlign="center"
				>
					{name.trim().charAt(0).toUpperCase() || '?'}
				</Text>
			)}

			{/* While the artwork is on its way, the box says so. */}
			{coverLoading && (
				<>
					<Spinner x={LEFT_X + COVER_W / 2} y={COVER_Y + 186} />
					<Text
						x={LEFT_X + COVER_W / 2}
						y={COVER_Y + 210}
						fontFamily={fontFamily}
						fontSize={fontSize.tiny}
						fill={colors.textFaint}
						textAlign="center"
					>
						loading artwork…
					</Text>
				</>
			)}

			{/* Screenshot, when the rom has one. */}
			<Rect
				x={LEFT_X}
				y={SHOT_Y}
				width={SHOT_W}
				height={SHOT_H}
				fill={game.screenshotUrl === '' ? colors.bg : colors.coverBg}
				stroke={colors.border}
				lineWidth={1}
				borderRadius={radius.md}
			/>
			{game.screenshotUrl !== '' ? (
				<CoverImage
					url={game.screenshotUrl}
					x={LEFT_X}
					y={SHOT_Y}
					width={SHOT_W}
					height={SHOT_H}
				/>
			) : (
				<Text
					x={LEFT_X + SHOT_W / 2}
					y={SHOT_Y + SHOT_H / 2 - 12}
					fontFamily={fontFamily}
					fontSize={fontSize.body}
					fill={colors.textFaint}
					textAlign="center"
				>
					No screenshots
				</Text>
			)}

			{/* Facts. */}
			{rows.map(([label, value], i) => (
				<React.Fragment key={label}>
					<Text
						x={COL_X}
						y={118 + i * META_ROW_H}
						fontFamily={fontFamily}
						fontSize={fontSize.small}
						fill={colors.textFaint}
					>
						{label}
					</Text>
					<Text
						x={COL_X + 120}
						y={118 + i * META_ROW_H}
						fontFamily={fontFamily}
						fontSize={fontSize.body}
						fill={colors.textSecondary}
						maxWidth={colW - 120}
						overflow="ellipsis"
					>
						{value}
					</Text>
				</React.Fragment>
			))}

			{/* Summary. */}
			{summaryLines.length > 0 ? (
				summaryLines.map((line, i) => (
					<Text
						key={`summary-${i}`}
						x={COL_X}
						y={summaryY + i * SUMMARY_LINE_H}
						fontFamily={fontFamily}
						fontSize={fontSize.body}
						fill={colors.textSecondary}
					>
						{line}
					</Text>
				))
			) : (
				<Text
					x={COL_X}
					y={summaryY}
					fontFamily={fontFamily}
					fontSize={fontSize.body}
					fill={colors.textFaint}
				>
					No description for this game.
				</Text>
			)}

			<HintBar hints={['B back to library']} />
		</>
	);
}
