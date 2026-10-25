/**
 * The detail screen for a single game.
 *
 * One visual hierarchy, loudest first: the game's identity (cover, name,
 * platform line), then its status (state pill + the installation card),
 * then the actions (one primary button, quieter secondary ones), and the
 * technical details (summary, more-details toggle) in between. The build
 * stamp lives in Settings, not here — this is a page about a game, not
 * about the app.
 */
import React, { useEffect, useState } from 'react';
import { Rect, Text, useDimensions, useParent } from 'react-tela';
import { colors, fontFamily, fontSize, radius } from '../theme';
import { truncate, wrapLines, measure } from '../text';
import { useGamepadButton, useDirection } from '../hooks/use-gamepad';
import { Header } from './Header';
import { HintBar } from './HintBar';
import { CoverImage, type CoverStatus } from './CoverImage';
import { Spinner } from './Spinner';
import { play, usePlayState } from '../play';
import { primaryRow, stateChip as stateChipFor, formatBytes, type Chip } from './dashboard/hero';
import type { RommGame } from '../romm';

interface Props {
	game: RommGame;
	/** Return to the library. */
	onBack: () => void;
	/** The disc's position in its release, when the game has several. */
	disc?: { index: number; count: number };
	/** Open the downloads queue (X). */
	onOpenDownloads?: () => void;
	/** Open the disc picker (the disc card / A). */
	onDiscs?: () => void;
}

// ── Layout ───────────────────────────────────────────────────────────────
const COVER_X = 72;
const COVER_Y = 112;
const COVER_W = 300;
const COVER_H = 400;
/** The right column: facts, summary, installation card, actions. */
const COL_X = 428;
const COL_W = 1280 - COL_X - 72;

const TITLE_Y = 104;
const META_Y = 156;
const CHIPS_Y = 184;
const CHIPS_H = 32;
const SUMMARY_TOP = 232;
const SUMMARY_LINE_H = 26;
/** How many summary lines exist at most (the raw source is capped too). */
const SUMMARY_MAX = 24;

const CARD_H = 84;
/** Buttons are anchored to the bottom, above the hint bar's backdrop. */
const BTN_H = 56;
const SEC_H = 48;
const BTN_GAP = 12;

export function GameDetail({ game, onBack, disc, onOpenDownloads, onDiscs }: Props) {
	const dims = useDimensions();
	const { ctx } = useParent();

	// The game feeds the play service (state derivation + actions).
	useEffect(() => {
		play.noteGame(game);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [game]);

	const state = usePlayState(game.id);
	const primary = primaryRow(game, state, (m) => setStatus(m));
	const secondary: Array<{ label: string; enabled: boolean; run: () => void }> = [];
	if (state.kind !== 'demo') {
		secondary.push({
			label: 'Sync saves',
			enabled: true,
			run: () => {
				void play.sync(game).then((m) => setStatus(m));
			},
		});
	}
	if (disc !== undefined && disc.count > 1 && onDiscs !== undefined) {
		secondary.push({ label: 'Discs', enabled: true, run: onDiscs });
	}
	const installed = state.kind === 'ready' || state.kind === 'stale';
	if (installed) {
		secondary.push({
			label: 'Uninstall',
			enabled: true,
			run: () => {
				void play.uninstall(game).then((m) => setStatus(m));
			},
		});
	}

	const buttons = Math.max(1, secondary.length);
	const primaryY = dims.height - 72 - BTN_H - 16;
	// One secondary row is reserved when there is anything to put in it.
	const secondaryY = secondary.length > 0 ? primaryY - BTN_GAP - SEC_H : primaryY - BTN_GAP;
	const cardBottom = secondaryY - BTN_GAP;
	const cardY = cardBottom - CARD_H;
	const secW = (COL_W - BTN_GAP * (buttons - 1)) / buttons;

	const [focus, setFocus] = useState(0);
	const [status, setStatus] = useState('');
	const focusClamped = Math.min(focus, buttons - 1);

	useDirection('Up', () => setFocus((f) => Math.max(0, f - 1)), []);
	useDirection('Down', () => setFocus((f) => Math.min(buttons - 1, f + 1)), []);
	useGamepadButton(
		'A',
		() => (focusClamped === 0 ? primary.run() : secondary[focusClamped - 1]?.run()),
		[focusClamped, primary, secondary],
	);
	useGamepadButton('X', () => onOpenDownloads?.(), [onOpenDownloads]);
	useGamepadButton('B', onBack, [onBack]);

	// The summary: the raw text is wrapped for the biggest allowance we
	// can ever spend, then sliced to the space actually left. Collapsed
	// shows three deliberate lines; Y expands within the fitting space.
	const summaryBudget = wrapLines(ctx, game.summary, COL_W, SUMMARY_MAX, fontSize.body);
	const summaryFit = Math.max(
		3,
		Math.floor((cardBottom - 20 - SUMMARY_TOP) / SUMMARY_LINE_H),
	);
	const [expanded, setExpanded] = useState(false);
	const summaryShown = Math.min(expanded ? summaryFit : 3, summaryBudget.length);
	const clamped = summaryBudget.length > summaryShown;
	useGamepadButton('Y', () => setExpanded((e) => !e), [summaryFit, summaryBudget.length]);

	// The cover is downloaded in the background; the screen says so instead
	// of showing a placeholder that looks like the final artwork.
	const [coverStatus, setCoverStatus] = useState<CoverStatus>(
		game.coverUrl === '' ? 'ready' : 'loading',
	);
	const coverLoading = coverStatus === 'loading';
	const placeholderVisible = game.coverUrl === '' || coverStatus !== 'ready';

	const name = game.name || `Game #${game.id}`;
	const title = truncate(ctx, name, COL_W, fontSize.headline);

	// Identity line: platform · first genre · year.
	const year = game.releaseDate.slice(0, 4);
	const identity = [
		game.platform,
		game.genres[0] ?? '',
		game.releaseDate !== '' ? year : '',
	]
		.filter((s) => s !== '')
		.join(' · ');

	// The disc facts card, only when the release really has several discs.
	const multiDisc = disc !== undefined && disc.count > 1;

	// ── chips ────────────────────────────────────────────────────────────
	const stateChip = stateChipFor(state);
	const chips: Chip[] = [stateChip];
	if (multiDisc && disc !== undefined) {
		chips.push({ text: `${disc.count} discs`, fill: colors.surfaceRaised, textFill: colors.textMuted });
	}

	// The installation card: one progress component — phase text, bar,
	// percent + size — never competing with anything else.
	const installPhase = ((): { text: string; bar: number } => {
		switch (state.kind) {
			case 'installing':
				return {
					text: 'Downloading…',
					bar: Math.min(1, Math.max(0, state.progress)),
				};
			case 'ready':
				return { text: 'Installed', bar: 1 };
			case 'stale':
				return { text: 'Outdated on server', bar: 0 };
			case 'not-installed':
				return { text: 'Ready to begin', bar: 0 };
			default:
				// demo / unsupported: the card still names the phase.
				return { text: 'Unavailable', bar: 0 };
		}
	})();
	const cardCaption =
		status !== ''
			? status
			: installPhase.bar > 0 && installPhase.bar < 1
				? `${Math.floor(installPhase.bar * 100)}%${game.sizeBytes > 0 ? ` · ${formatBytes(game.sizeBytes)}` : ''}`
				: '';

	// ── the actions: primary first, secondaries quieter ──────────────
	const hints = [`A ${primary.label.toLowerCase()}`];
	if (clamped) hints.push(expanded ? 'Y less' : 'Y details');
	hints.push('X downloads', 'B back');

	return (
		<>
			{/* Opaque background — the detail screen covers the grid. */}
			<Rect width={dims.width} height={dims.height} fill={colors.bg} />

			<Header title={title} />
			{/* The hairline under the header gives the page its top edge. */}
			<Rect
				x={72}
				y={92}
				width={dims.width - 144}
				height={1}
				fill={colors.border}
			/>

			{/*
			 * Cover art (or its placeholder). The plate+frame rect is drawn
			 * after the artwork and fills only while the placeholder shows,
			 * so a re-inserted block can never paint over the cover (see
			 * CoverTile for why).
			 */}
			<CoverImage
				url={game.coverUrl}
				x={COVER_X}
				y={COVER_Y}
				width={COVER_W}
				height={COVER_H}
				onStatus={setCoverStatus}
			/>
			<Rect
				x={COVER_X}
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
					x={COVER_X + COVER_W / 2}
					y={COVER_Y + COVER_H / 2 - 40}
					fontFamily={fontFamily}
					fontSize={56}
					fill={colors.coverGlyph}
					textAlign="center"
				>
					{name.trim().charAt(0).toUpperCase() || '?'}
				</Text>
			)}
			{coverLoading && (
				<>
					<Spinner x={COVER_X + COVER_W / 2} y={COVER_Y + 186} />
					<Text
						x={COVER_X + COVER_W / 2}
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

			{/* The disc card, when this release has more than one disc. */}
			{multiDisc && disc !== undefined && (
				<>
					<Rect
						x={COVER_X}
						y={COVER_Y + COVER_H + 20}
						width={COVER_W}
						height={88}
						fill={colors.surface}
						stroke={colors.border}
						lineWidth={1}
						borderRadius={radius.md}
					/>
					<Text
						x={COVER_X + 16}
						y={COVER_Y + COVER_H + 40}
						fontFamily={fontFamily}
						fontSize={fontSize.label}
						fill={colors.accent}
					>
						{`Disc ${disc.index + 1} of ${disc.count}`}
					</Text>
					<Text
						x={COVER_X + 16}
						y={COVER_Y + COVER_H + 72}
						fontFamily={fontFamily}
						fontSize={fontSize.tiny}
						fill={colors.textMuted}
					>
						{`${disc.count}-disc game${game.sizeBytes > 0 ? ` · ${formatBytes(game.sizeBytes)}` : ''} — Discs action changes`}
					</Text>
				</>
			)}

			{/* ── identity ───────────────────────────────────────────── */}
			<Text
				x={COL_X}
				y={TITLE_Y}
				fontFamily={fontFamily}
				fontSize={fontSize.headline}
				fill={colors.textPrimary}
			>
				{title}
			</Text>
			{identity !== '' && (
				<Text
					x={COL_X}
					y={META_Y}
					fontFamily={fontFamily}
					fontSize={fontSize.small}
					fill={colors.textSecondary}
					maxWidth={COL_W}
					overflow="ellipsis"
				>
					{identity}
				</Text>
			)}

			{/* ── status chips ───────────────────────────────────────── */}
			{chips.map((chip, i) => {
				const w = measure(ctx, chip.text, fontSize.small) + 24;
				const x = COL_X + chips.slice(0, i).reduce((s, c) => s + measure(ctx, c.text, fontSize.small) + 24 + 10, 0);
				return (
					<React.Fragment key={chip.text}>
						<Rect
							x={x}
							y={CHIPS_Y}
							width={w}
							height={CHIPS_H}
							fill={chip.fill}
							borderRadius={CHIPS_H / 2}
						/>
						<Text
							x={x + w / 2}
							y={CHIPS_Y + CHIPS_H / 2}
							fontFamily={fontFamily}
							fontSize={fontSize.tiny}
							fill={chip.textFill}
							textAlign="center"
							textBaseline="middle"
						>
							{chip.text}
						</Text>
					</React.Fragment>
				);
			})}

			{/* ── summary ────────────────────────────────────────────── */}
			{summaryBudget.length === 0 ? (
				<Text
					x={COL_X}
					y={SUMMARY_TOP}
					fontFamily={fontFamily}
					fontSize={fontSize.body}
					fill={colors.textFaint}
				>
					No description for this game.
				</Text>
			) : (
				summaryBudget.slice(0, summaryShown).map((line, i) => (
					<Text
						key={`summary-${i}`}
						x={COL_X}
						y={SUMMARY_TOP + i * SUMMARY_LINE_H}
						fontFamily={fontFamily}
						fontSize={fontSize.body}
						fill={colors.textSecondary}
					>
						{line}
					</Text>
				))
			)}
			{clamped && (
				<Text
					x={COL_X}
					y={SUMMARY_TOP + summaryShown * SUMMARY_LINE_H}
					fontFamily={fontFamily}
					fontSize={fontSize.tiny}
					fill={colors.accent}
				>
					{expanded ? 'Less details' : 'More details'}
				</Text>
			)}

			{/* ── the installation card ──────────────────────────────── */}
			<Rect
				x={COL_X}
				y={cardY}
				width={COL_W}
				height={CARD_H}
				fill={colors.surface}
				borderRadius={radius.md}
			/>
			<Text
				x={COL_X + 20}
				y={cardY + 16}
				fontFamily={fontFamily}
				fontSize={fontSize.tiny}
				fill={colors.textFaint}
			>
				{state.kind === 'installing' ? 'INSTALL' : 'INSTALLATION'}
			</Text>
			<Text
				x={COL_X + COL_W - 20}
				y={cardY + 14}
				fontFamily={fontFamily}
				fontSize={fontSize.small}
				fill={state.kind === 'ready' ? colors.success : state.kind === 'installing' ? colors.accent : colors.textMuted}
				textAlign="right"
			>
				{installPhase.text}
			</Text>
			{/* The track is always drawn; the fill tells the progress. */}
			<Rect
				x={COL_X + 20}
				y={cardY + 48}
				width={COL_W - 40}
				height={6}
				fill={colors.border}
				borderRadius={3}
			/>
			{installPhase.bar > 0 && (
				<Rect
					x={COL_X + 20}
					y={cardY + 48}
					width={Math.max(6, (COL_W - 40) * installPhase.bar)}
					height={6}
					fill={colors.accent}
					borderRadius={3}
				/>
			)}
			{cardCaption !== '' && (
				<Text
					x={COL_X + 20}
					y={cardY + 60}
					fontFamily={fontFamily}
					fontSize={fontSize.tiny}
					fill={
						/fail|missing|error|no /i.test(status) ? colors.danger : colors.textMuted
					}
					maxWidth={COL_W - 40}
					overflow="ellipsis"
				>
					{cardCaption}
				</Text>
			)}

			{/* ── the actions: primary first, secondaries quieter ────── */}
			<Rect
				x={COL_X}
				y={primaryY}
				width={COL_W}
				height={BTN_H}
				fill={focusClamped === 0 && primary.enabled ? colors.accent : colors.surface}
				stroke={
					focusClamped === 0 && primary.enabled
						? colors.textPrimary
						: focusClamped === 0
							? colors.accent
							: colors.border
				}
				lineWidth={focusClamped === 0 ? 2 : 1}
				borderRadius={radius.md}
			/>
			{/* The focused primary is unmistakable: blue, with the A keycap. */}
			<Text
				x={COL_X + 20}
				y={primaryY + BTN_H / 2}
				fontFamily={fontFamily}
				fontSize={fontSize.label}
				fill={primary.enabled ? colors.textPrimary : colors.textFaint}
				textBaseline="middle"
			>
				{primary.label}
			</Text>
			{primary.detail !== '' && (
				<Text
					x={COL_X + 160}
					y={primaryY + BTN_H / 2}
					fontFamily={fontFamily}
					fontSize={fontSize.tiny}
					fill={primary.enabled ? colors.accentMuted : colors.textFaint}
					textBaseline="middle"
				>
					{primary.detail}
				</Text>
			)}
			{/* The keycap rides the right edge of the primary button. */}
			{(() => {
				const cap = focusClamped === 0 && primary.enabled;
				const capW = 34;
				return (
					<>
						<Rect
							x={COL_X + COL_W - capW - 16}
							y={primaryY + (BTN_H - 30) / 2}
							width={capW}
							height={30}
							fill={cap ? colors.textPrimary : colors.surfaceRaised}
							borderRadius={radius.sm}
						/>
						<Text
							x={COL_X + COL_W - capW / 2 - 16}
							y={primaryY + BTN_H / 2}
							fontFamily={fontFamily}
							fontSize={fontSize.small}
							fill={cap ? colors.accent : colors.textMuted}
							textAlign="center"
							textBaseline="middle"
						>
							A
						</Text>
					</>
				);
			})()}

			{secondary.map((row, i) => {
				const x = COL_X + i * (secW + BTN_GAP);
				const y = secondaryY;
				const focused = i + 1 === focusClamped;
				return (
					<React.Fragment key={row.label}>
						<Rect
							x={x}
							y={y}
							width={secW}
							height={SEC_H}
							fill={focused ? colors.surfaceRaised : colors.surface}
							stroke={focused ? colors.accent : colors.border}
							lineWidth={focused ? 2 : 1}
							borderRadius={radius.md}
						/>
						<Rect
							x={x}
							y={y}
							width={4}
							height={SEC_H}
							fill={colors.accent}
							borderRadius={2}
						/>
						<Text
							x={x + 16}
							y={y + SEC_H / 2}
							fontFamily={fontFamily}
							fontSize={fontSize.body}
							fill={focused ? colors.textPrimary : colors.textSecondary}
							textBaseline="middle"
						>
							{row.label}
						</Text>
					</React.Fragment>
				);
			})}

			<HintBar hints={hints} />
		</>
	);
}
