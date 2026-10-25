import React, { useEffect, useState } from 'react';
import { Rect, Text, useDimensions, useParent } from 'react-tela';
import { colors, fontFamily, fontSize, radius, space } from '../theme';
import { truncate, wrapLines } from '../text';
import { useGamepadButton, useDirection } from '../hooks/use-gamepad';
import { Header } from './Header';
import { HintBar } from './HintBar';
import { CoverImage, type CoverStatus } from './CoverImage';
import { Spinner } from './Spinner';
import { BUILD_ID } from '../version';
import type { RommGame } from '../romm';
import { play, usePlayState, type PlayState } from '../play';

interface Props {
	game: RommGame;
	/** Return to the library. */
	onBack: () => void;
	/** The disc's position in its release, when the game has several. */
	disc?: { index: number; count: number };
	/** Open the downloads queue (X). */
	onOpenDownloads?: () => void;
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
/** The action block sits at a fixed spot, clear of the hint bar. */
const ACTIONS_TOP = 512;
const ACTION_H = 26;
const ACTION_GAP = 8;

/** Human readable file size. */
function formatBytes(bytes: number): string {
	if (bytes <= 0) return '';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** One action row: what A does + its current status. */
interface ActionRow {
	label: string;
	status: string;
	/** The status colour (disabled rows dim, warnings warn). */
	tone: 'ok' | 'warn' | 'dim' | 'accent';
	enabled: boolean;
	/** The work A performs. */
	run: () => void;
	/** A thin progress bar under the row, when given. */
	progress: number | null;
}

/**
 * The four action rows, derived from the game's play state.
 *
 * Play is the primary verb; Install exists for everything (even the
 * platforms with no core — "download only"); Sync and Uninstall are the
 * housekeeping pair.
 */
function actionRows(
	game: RommGame,
	state: PlayState,
	notify: (message: string) => void,
): ActionRow[] {
	const size =
		state.kind === 'not-installed'
			? state.sizeBytes
			: game.sizeBytes;

	const playRow = (): ActionRow => {
		switch (state.kind) {
			case 'demo':
				return { label: 'Play', status: 'demo mode', tone: 'dim', enabled: false, run: () => {}, progress: null };
			case 'unsupported':
				return {
					label: 'Play',
					status: `no core for ${game.platform || 'this platform'}`,
					tone: 'warn',
					enabled: false,
					run: () => {},
					progress: null,
				};
			case 'not-installed':
				return { label: 'Play', status: 'install first', tone: 'dim', enabled: false, run: () => {}, progress: null };
			case 'installing':
				return { label: 'Play', status: 'preparing…', tone: 'dim', enabled: false, run: () => {}, progress: state.progress };
			case 'stale':
				return { label: 'Play', status: 'changed on the server — re-download', tone: 'warn', enabled: false, run: () => {}, progress: null };
			default:
				return {
					label: 'Play',
					status: 'launch',
					tone: 'accent',
					enabled: true,
					run: () => {
						void play.play(game).then(notify);
					},
					progress: null,
				};
		}
	};

	const installRow = (): ActionRow => {
		const sizeText = size > 0 ? ` · ${formatBytes(size)}` : '';
		switch (state.kind) {
			case 'demo':
				return { label: 'Install', status: 'demo mode', tone: 'dim', enabled: false, run: () => {}, progress: null };
			case 'not-installed':
				return {
					label: 'Install',
					status: `download${sizeText}`,
					tone: 'ok',
					enabled: true,
					run: () => {
						void play.install(game).then(notify);
					},
					progress: null,
				};
			case 'installing':
				return {
					label: 'Install',
					status: `${Math.floor(state.progress * 100)}%${sizeText}`,
					tone: 'accent',
					enabled: false,
					run: () => {},
					progress: state.progress,
				};
			case 'ready':
				return { label: 'Install', status: 'installed', tone: 'ok', enabled: false, run: () => {}, progress: null };
			case 'stale':
				return {
					label: 'Install',
					status: 're-download',
					tone: 'warn',
					enabled: true,
					run: () => {
						void play.install(game).then(notify);
					},
					progress: null,
				};
			default:
				// unsupported: download-only is still useful.
				return {
					label: 'Install',
					status: `download only${sizeText}`,
					tone: 'ok',
					enabled: true,
					run: () => {
						void play.install(game).then(notify);
					},
					progress: null,
				};
		}
	};

	const syncRow = (): ActionRow =>
		state.kind === 'demo'
			? { label: 'Sync saves', status: 'demo mode', tone: 'dim', enabled: false, run: () => {}, progress: null }
			: {
					label: 'Sync saves',
					status: 'saves + states',
					tone: 'ok',
					enabled: true,
					run: () => {
						void play.sync(game).then(notify);
					},
					progress: null,
				};

	const installed = state.kind === 'ready' || state.kind === 'stale';
	const uninstallRow = (): ActionRow =>
		state.kind === 'demo' || !installed
			? { label: 'Uninstall', status: state.kind === 'demo' ? 'demo mode' : 'not installed', tone: 'dim', enabled: false, run: () => {}, progress: null }
			: {
					label: 'Uninstall',
					status: 'remove files',
					tone: 'ok',
					enabled: true,
					run: () => {
						void play.uninstall(game).then(notify);
					},
					progress: null,
				};

	return [playRow(), installRow(), syncRow(), uninstallRow()];
}

/**
 * The detail screen for a single game.
 *
 * Two columns: artwork on the left, the facts, the blurb and the action
 * block (Play / Install / Sync / Uninstall) on the right. Everything is
 * optional — a rom with no description, no genres and no screenshot still
 * renders as a coherent page instead of a half empty one.
 */
export function GameDetail({ game, onBack, disc, onOpenDownloads }: Props) {
	const dims = useDimensions();
	const { ctx } = useParent();

	// The game feeds the play service (state derivation + actions).
	useEffect(() => {
		play.noteGame(game);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [game]);

	const state = usePlayState(game.id);
	const [focus, setFocus] = useState(0);
	const [status, setStatus] = useState('');
	const notify = (message: string) => setStatus(message);

	const rows = actionRows(game, state, notify);
	const focusClamped = Math.min(focus, rows.length - 1);

	useDirection('Up', () => setFocus((f) => Math.max(0, f - 1)), []);
	useDirection('Down', () => setFocus((f) => Math.min(rows.length - 1, f + 1)), []);
	useGamepadButton('A', () => rows[focusClamped]?.run(), [focusClamped, rows]);
	useGamepadButton('X', () => onOpenDownloads?.(), [onOpenDownloads]);
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

	const metaRows: Array<[string, string]> = [];
	if (disc !== undefined && disc.count > 1) metaRows.push(['Disc', `${disc.index + 1} of ${disc.count}`]);
	if (game.platform !== '') metaRows.push(['Platform', game.platform]);
	if (game.releaseDate !== '') metaRows.push(['Released', game.releaseDate]);
	if (game.genres.length > 0) metaRows.push(['Genres', game.genres.join(', ')]);
	if (game.sizeBytes > 0) metaRows.push(['Size', formatBytes(game.sizeBytes)]);

	// Six lines max: the summary must leave room for the action block.
	const summaryLines =
		game.summary === ''
			? []
			: wrapLines(ctx, game.summary, colW, 6, fontSize.body);

	const summaryY = 118 + metaRows.length * META_ROW_H + 28;

	const toneFill: Record<ActionRow['tone'], string> = {
		ok: colors.success,
		warn: colors.warning,
		dim: colors.textFaint,
		accent: colors.accent,
	};

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
			{metaRows.map(([label, value], i) => (
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

			{/* The last action result, when there is one to report. */}
			{status !== '' && (
				<Text
					x={COL_X}
					y={ACTIONS_TOP - 14}
					fontFamily={fontFamily}
					fontSize={fontSize.tiny}
					fill={/fail|missing|error|no /i.test(status) ? colors.danger : colors.textMuted}
					maxWidth={colW}
					overflow="ellipsis"
				>
					{status}
				</Text>
			)}

			{/* The action block. */}
			{rows.map((row, i) => {
				const y = ACTIONS_TOP + i * (ACTION_H + ACTION_GAP);
				const focused = i === focusClamped;
				return (
					<React.Fragment key={row.label}>
						<Rect
							x={COL_X - 10}
							y={y - 8}
							width={colW + 20}
							height={ACTION_H + 14}
							fill={focused ? colors.surfaceRaised : colors.surface}
							stroke={focused ? colors.accent : colors.border}
							lineWidth={focused ? 2 : 1}
							borderRadius={radius.sm}
						/>
						<Text
							x={COL_X + 8}
							y={y + 2}
							fontFamily={fontFamily}
							fontSize={fontSize.body}
							fontWeight={row.enabled ? 'bold' : ''}
							fill={row.enabled ? (focused ? colors.textPrimary : colors.textSecondary) : colors.textFaint}
						>
							{row.label}
						</Text>
						<Text
							x={COL_X + colW - 8}
							y={y + 2}
							fontFamily={fontFamily}
							fontSize={fontSize.small}
							fill={toneFill[row.tone]}
							textAlign="right"
							maxWidth={colW - 220}
							overflow="ellipsis"
						>
							{row.status}
						</Text>
						{row.progress !== null && (
							<Rect
								x={COL_X + 8}
								y={y + ACTION_H - 6}
								width={Math.max(4, (colW - 16) * row.progress)}
								height={4}
								fill={colors.accent}
								borderRadius={2}
							/>
						)}
					</React.Fragment>
				);
			})}

			<HintBar hints={['A ' + (rows[focusClamped]?.label.toLowerCase() ?? 'do'), 'X downloads', 'B back']} />
		</>
	);
}
