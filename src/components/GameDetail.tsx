/**
 * The detail screen for a single game — the game page.
 *
 * The home screen's design system applied to one game: the same
 * atmosphere (`AmbientBackdrop`), the same atoms (`Panel`, `ProgressBar`,
 * `Field`, `Button`, `StatusChip`, `Keycap`), the same state vocabulary
 * (`dashboard/hero` — the hero and this screen can never disagree about
 * what a Play state means). Three columns, loudest first:
 *
 *   LEFT    the box art (3:4, on the hero's softly-shadowed plate) and,
 *           when the server has one, the 16:9 screenshot beneath it.
 *   CENTER  the name, the identity line (platform · genre · year ·
 *           discs), the status pill, the description, and the actions —
 *           one unmistakable primary above the quieter secondaries.
 *   RIGHT   the installation card (phase, live progress from the
 *           download queue, the last *confirmed* outcome), the fact
 *           grid, the disc position, and the save-sync status.
 *
 * Input is the existing model, now complete: Up/Down walk the actions
 * (0 is the primary, 1.. the secondaries), A runs the focused one, Y
 * expands the description, X opens the downloads queue, B goes back.
 * `paused` hands the controller to the disc picker while it is open.
 * Every status line shown is the resolution of a Play-service action and
 * every percent is the download queue's own accounting — this screen
 * invents nothing, and never reports success before the service does.
 */
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Rect, useDimensions, useParent } from 'react-tela';
import { colors, fontSize, radius } from '../theme';
import { wrapLines } from '../text';
import { useCanvasTap } from '../hooks/use-canvas-tap';
import { useDirection, useGamepadButton } from '../hooks/use-gamepad';
import { CoverImage, type CoverStatus } from './CoverImage';
import { PlatformIcon } from './PlatformIcon';
import { platformIconSlug } from '../platform-icons';
import { play, usePlayState } from '../play';
import { downloadQueue } from '../roms/download';
import { localSaveFiles } from '../saves/inventory';
import { formatBytes, primaryRow, stateChip as stateChipFor } from './dashboard/hero';
import {
	AmbientBackdrop,
	Button,
	buttonSize,
	Field,
	HintBar,
	Keycap,
	Panel,
	ProgressBar,
	Spinner,
	StatusChip,
	Text,
	type ButtonVariant,
	type ProgressTone,
} from './ui';
import type { RommGame } from '../romm';

interface Props {
	game: RommGame;
	/** Return to the library. */
	onBack: () => void;
	/** The disc's position in its release, when the game has several. */
	disc?: { index: number; count: number };
	/** Open the downloads queue (X). */
	onOpenDownloads?: () => void;
	/** Open the disc picker (the Discs action). */
	onDiscs?: () => void;
	/** True while a screen over this one (the disc picker) owns the input. */
	paused?: boolean;
}

/** One of the quieter actions under the primary. */
interface SecondaryAction {
	label: string;
	variant: ButtonVariant;
	run: () => void;
}

// ── Layout ───────────────────────────────────────────────────────────────
/** The page's left/right margin — a detail page breathes more than a grid. */
const MARGIN = 64;

/** LEFT — the artwork column. */
const COVER_X = MARGIN;
const COVER_Y = 56;
const COVER_W = 300;
const COVER_H = 400; // 3:4 box art
/** The 16:9 screenshot under the cover, when the server has one. */
const SHOT_W = COVER_W;
const SHOT_H = 169;
const SHOT_Y = COVER_Y + COVER_H + 12;

/** CENTER — the identity, description and actions column. */
const COL_X = COVER_X + COVER_W + 36;
const COL_W = 456;
/** The title block: the display role, at most two lines. */
const TITLE_BASE = 92;
const TITLE_LINE_H = 46;
/** The description: body size, collapsed to three lines, Y expands. */
const DESC_LINE_H = 28;
const DESC_COLLAPSED = 3;
/** How many description lines exist at most (the raw text is capped too). */
const SUMMARY_MAX = 24;

/** The actions, anchored above the hint bar's 72-px strip (648). */
const PRIMARY_Y = 576;
const SECONDARY_Y = 520;
const BTN_GAP = 12;

/** RIGHT — the installation card. */
const PANEL_X = 880;
const PANEL_W = 1280 - MARGIN - PANEL_X;
const PANEL_Y = COVER_Y;
const PANEL_PAD = 20;
/** The progress bar's row, then the blocks below it. */
const BAR_Y = PANEL_Y + 56;
const RULE_1 = BAR_Y + 40;
const FACTS_Y = RULE_1 + 30;
const FACT_COL_W = 132;
const FACT_COL_GAP = 12;
const FACT_ROW_H = 62;
const RULE_2 = FACTS_Y + FACT_ROW_H + 26;
const DISC_Y = RULE_2 + 28;
const SAVES_Y_MULTI = DISC_Y + 62;
const SAVES_Y_SINGLE = DISC_Y;

/** The back affordance, top-left (the home screen's brand spot). */
const BACK = { x: 24, y: 24, w: 26, hitW: 170, hitH: 44 };

export function GameDetail({ game, onBack, disc, onOpenDownloads, onDiscs, paused = false }: Props) {
	const dims = useDimensions();
	const { ctx } = useParent();
	const active = !paused;

	// The game feeds the play service (state derivation + actions).
	useEffect(() => {
		play.noteGame(game);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [game]);

	const state = usePlayState(game.id);

	// This rom's live transfer, straight from the queue: the phase while it
	// waits or streams, and the error line when it failed (the same store
	// the downloads screen reads — never a guess).
	const queue = useSyncExternalStore(
		(listener) => downloadQueue.subscribe(listener),
		() => downloadQueue.getItems(),
		() => downloadQueue.getItems(),
	);
	const romItems = queue.filter((v) => v.kind === 'rom' && v.id.startsWith(`rom:${game.id}:`));
	const queueItem =
		romItems.find((v) => v.status === 'error') ??
		romItems.find((v) => v.status === 'queued' || v.status === 'running') ??
		romItems[0];

	// ── the screen's own state ─────────────────────────────────────────
	const [focus, setFocus] = useState(0);
	const [expanded, setExpanded] = useState(false);
	const [coverStatus, setCoverStatus] = useState<CoverStatus>(
		game.coverUrl === '' ? 'ready' : 'loading',
	);
	const [shotStatus, setShotStatus] = useState<CoverStatus>(
		game.screenshotUrl === '' ? 'ready' : 'loading',
	);
	/** The last *confirmed* install / uninstall outcome for this game. */
	const [actMsg, setActMsg] = useState('');
	/** The last *confirmed* save-sync outcome for this game. */
	const [syncMsg, setSyncMsg] = useState('');
	/** True while this game's sync is actually running. */
	const [syncBusy, setSyncBusy] = useState(false);
	/** What actually exists on the SD for this game (saves + states). */
	const [savesInfo, setSavesInfo] = useState('');

	// The save inventory: the real files on the SD that belong to this
	// rom. Re-read once per game (the screen remounts per game) and after
	// a sync, which is exactly when the files can have changed.
	useEffect(() => {
		const manifest = play.manifest;
		if (manifest === null) {
			setSavesInfo('');
			return;
		}
		let cancelled = false;
		void localSaveFiles(manifest).then((files) => {
			if (cancelled) return;
			const mine = files.filter((f) => f.romId === game.id);
			const saves = mine.filter((f) => !f.isState).length;
			const states = mine.filter((f) => f.isState).length;
			const bits: string[] = [];
			if (saves > 0) bits.push(`${saves} save${saves === 1 ? '' : 's'}`);
			if (states > 0) bits.push(`${states} state${states === 1 ? '' : 's'}`);
			setSavesInfo(bits.length > 0 ? bits.join(' · ') : 'no local saves');
		});
		return () => {
			cancelled = true;
		};
	}, [game.id, syncMsg]);

	// ── the actions ────────────────────────────────────────────────────
	const primary = primaryRow(game, state, (m) => setActMsg(m));
	const secondary: SecondaryAction[] = [];
	if (state.kind !== 'demo') {
		secondary.push({
			label: 'Sync saves',
			variant: 'secondary',
			run: () => {
				setSyncBusy(true);
				void play.sync(game).then(
					(m) => {
						setSyncMsg(m);
						setSyncBusy(false);
					},
					() => {
						setSyncMsg('sync failed');
						setSyncBusy(false);
					},
				);
			},
		});
	}
	const multiDisc = disc !== undefined && disc.count > 1;
	if (multiDisc && onDiscs !== undefined) {
		secondary.push({ label: 'Discs', variant: 'secondary', run: onDiscs });
	}
	if (state.kind === 'ready' || state.kind === 'stale') {
		secondary.push({
			label: 'Uninstall',
			variant: 'danger',
			run: () => {
				void play.uninstall(game).then((m) => setActMsg(m));
			},
		});
	}

	// The focus walk: 0 is the primary, 1.. are the secondaries.
	const buttons = 1 + secondary.length;
	const focusClamped = Math.min(Math.max(0, focus), buttons - 1);

	useDirection('Up', () => setFocus((f) => Math.max(0, f - 1)), [], active);
	useDirection('Down', () => setFocus((f) => Math.min(buttons - 1, f + 1)), [buttons], active);
	useGamepadButton(
		'A',
		() => (focusClamped === 0 ? primary.run() : secondary[focusClamped - 1]?.run()),
		[focusClamped, primary, secondary],
		active,
	);
	useGamepadButton(
		'X',
		() => onOpenDownloads?.(),
		[onOpenDownloads],
		active && onOpenDownloads !== undefined,
	);
	useGamepadButton('B', onBack, [onBack], active);

	// The back pill's touch affordance (the gamepad path is B). The
	// hook holds the callback in a ref, so no dependency list.
	useCanvasTap(active, (p) => {
		if (
			p.x >= BACK.x - 10 &&
			p.x <= BACK.x + BACK.hitW &&
			p.y >= BACK.y - 10 &&
			p.y <= BACK.y + BACK.hitH
		) {
			onBack();
		}
	});

	// ── identity ────────────────────────────────────────────────────────
	const name = game.name || `Game #${game.id}`;
	const titleLines = wrapLines(ctx, name, COL_W, 2, fontSize.display);
	const titleBase = TITLE_BASE + (titleLines.length - 1) * TITLE_LINE_H;
	const metaY = titleBase + 34;
	const chipY = metaY + 12;
	const descTop = chipY + 30 + 26;

	// Platform · genre(s) · year · disc count, when each is known.
	const year = game.releaseDate.slice(0, 4);
	const identity = [
		game.platform,
		game.genres.slice(0, 2).join(' · '),
		game.releaseDate !== '' ? year : '',
		multiDisc && disc !== undefined ? `${disc.count} discs` : '',
	]
		.filter((s) => s !== '')
		.join(' · ');

	// ── the description ─────────────────────────────────────────────────
	// Wrapped for the biggest allowance the column can ever spend, then
	// sliced to the space that is actually left: collapsed shows three
	// deliberate lines, Y expands within the fitting space.
	const actionsTop = secondary.length > 0 ? SECONDARY_Y : PRIMARY_Y;
	const descBottom = actionsTop - 20;
	const summaryBudget = wrapLines(ctx, game.summary, COL_W, SUMMARY_MAX, fontSize.body);
	const summaryFit = Math.max(DESC_COLLAPSED, Math.floor((descBottom - descTop) / DESC_LINE_H));
	const summaryShown = Math.min(expanded ? summaryFit : DESC_COLLAPSED, summaryBudget.length);
	const clamped = summaryBudget.length > summaryShown;
	useGamepadButton('Y', () => setExpanded((e) => !e), [summaryFit, summaryBudget.length], active);

	// ── the installation card's model (home's InstallPanel vocabulary) ─
	const sizeText = formatBytes(game.sizeBytes);
	const installBar =
		state.kind === 'installing'
			? Math.min(1, Math.max(0, state.progress))
			: state.kind === 'ready'
				? 1
				: 0;
	const installTone: ProgressTone =
		state.kind === 'installing'
			? 'accent'
			: state.kind === 'ready'
				? 'success'
				: state.kind === 'stale'
					? 'warning'
					: 'neutral';
	const installError =
		queueItem !== undefined && queueItem.status === 'error'
			? queueItem.error !== ''
				? queueItem.error
				: 'download failed'
			: '';
	const phaseText =
		state.kind === 'installing'
			? queueItem?.status === 'queued'
				? 'Waiting in queue'
				: 'Downloading…'
			: state.kind === 'ready'
				? 'Installed'
				: state.kind === 'stale'
					? 'Outdated on server'
					: state.kind === 'not-installed'
						? 'Ready to begin'
						: 'Unavailable';
	// A live failure explains itself over the older messages; otherwise the
	// last confirmed outcome wins until the game changes (home's rule).
	const installCaption = installError !== '' ? installError : actMsg !== '' ? actMsg : phaseText;
	const captionDanger = installError !== '' || /fail|missing|error|no /i.test(actMsg);
	const pct = Math.floor(installBar * 100);
	const panelRight =
		state.kind === 'installing' || installBar >= 1 || state.kind === 'not-installed'
			? `${pct}%${sizeText !== '' ? ` · ${sizeText}` : ''}`
			: sizeText;

	// ── the save-sync row ──────────────────────────────────────────────
	const syncError = syncMsg !== '' && /fail|missing|error|no /i.test(syncMsg);
	const savesValue = syncBusy
		? 'syncing…'
		: syncMsg !== ''
			? syncMsg
			: savesInfo !== ''
				? savesInfo
				: '—';
	const savesColor = syncBusy
		? colors.textSecondary
		: syncMsg !== ''
			? syncError
				? colors.danger
				: colors.success
			: colors.textSecondary;

	// ── the fact grid (home's four facts) ───────────────────────────────
	const facts: Array<{ label: string; value: string }> = [
		{ label: 'PLATFORM', value: game.platform !== '' ? game.platform : 'Unknown' },
		{ label: 'GENRES', value: game.genres.slice(0, 2).join(' · ') || '—' },
		{ label: 'RELEASED', value: game.releaseDate !== '' ? game.releaseDate : '—' },
		{ label: 'SIZE', value: sizeText !== '' ? sizeText : '—' },
	];

	// ── the artwork's lifecycle ──────────────────────────────────────────
	const coverLoading = coverStatus === 'loading';
	const placeholderVisible = game.coverUrl === '' || coverStatus !== 'ready';
	const hasShot = game.screenshotUrl !== '';
	const shotLoading = hasShot && shotStatus === 'loading';

	// ── the panel's geometry (the blocks that exist decide its height) ─
	const innerX = PANEL_X + PANEL_PAD;
	const innerW = PANEL_W - PANEL_PAD * 2;
	const savesY = multiDisc ? SAVES_Y_MULTI : SAVES_Y_SINGLE;
	const panelH = savesY + 44 - PANEL_Y;

	// ── hints ──────────────────────────────────────────────────────────
	const stateChip = stateChipFor(state);
	// The footer describes the action the focused target actually
	// performs (home's rule): the primary says its own verb, a secondary
	// says its name, and a disabled target only offers selection.
	const focusedLabel =
		focusClamped === 0
			? primary.enabled
				? primary.label
				: 'Select'
			: (secondary[focusClamped - 1]?.label ?? primary.label);
	const hints = [`A ${focusedLabel.toLowerCase()}`];
	if (clamped) hints.push(expanded ? 'Y less' : 'Y details');
	if (onOpenDownloads !== undefined) hints.push('X downloads');
	hints.push('B back');

	// The secondary row: widths from the button primitive, the A-keycap's
	// space always reserved so the row never re-flows on a focus move.
	const secWidths = secondary.map((row) => buttonSize(ctx, row.label, 'md', { keycap: 'A' }));

	return (
		<>
			{/* The page sits in the same atmosphere as the home screen — a
				place, not a panel stack. Content never enters the hint bar's
				72-px strip, so the bar paints straight over the glow. */}
			<AmbientBackdrop width={dims.width} height={dims.height} />

			{/* ── the way back ─────────────────────────────────────────── */}
			<Keycap x={BACK.x} y={BACK.y} label="B" size={BACK.w} />
			<Text
				x={BACK.x + BACK.w + 8}
				y={BACK.y + BACK.w / 2}
				variant="caption"
				baseline="middle"
				color={colors.textMuted}
			>
				Library
			</Text>

			{/* ── LEFT: the artwork ───────────────────────────────────── */}
			{/*
			 * The plate: the hero's one real shadow — the depth cue that
			 * says "this is the game". It sits *under* the artwork; the
			 * frame below is drawn after the artwork and fills only while
			 * the placeholder shows, so a re-inserted block can never
			 * paint over live art (the renderer's `insertBefore` quirk —
			 * see CoverTile for the history).
			 */}
			<Rect
				x={COVER_X - 2}
				y={COVER_Y - 2}
				width={COVER_W + 4}
				height={COVER_H + 4}
				fill={colors.sunken}
				borderRadius={radius.md + 2}
				shadowColor="rgba(0,0,0,0.45)"
				shadowBlur={12}
				shadowOffsetY={4}
				pointerEvents={false}
			/>
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
				pointerEvents={false}
			/>
			{placeholderVisible && (
				<Text
					x={COVER_X + COVER_W / 2}
					y={COVER_Y + COVER_H / 2 - 48}
					variant="display"
					size={96}
					align="center"
					color={colors.coverGlyph}
				>
					{name.trim().charAt(0).toUpperCase() || '?'}
				</Text>
			)}
			{coverLoading && (
				<>
					<Spinner x={COVER_X + COVER_W / 2} y={COVER_Y + COVER_H / 2 + 42} />
					<Text
						x={COVER_X + COVER_W / 2}
						y={COVER_Y + COVER_H / 2 + 72}
						variant="micro"
						align="center"
						color={colors.textFaint}
					>
						loading artwork…
					</Text>
				</>
			)}

			{/* The secondary artwork, when the server has one — the same
				plate/frame invariant, subordinate to the cover. */}
			{hasShot && (
				<>
					<CoverImage
						url={game.screenshotUrl}
						x={COVER_X}
						y={SHOT_Y}
						width={SHOT_W}
						height={SHOT_H}
						onStatus={setShotStatus}
					/>
					<Rect
						x={COVER_X}
						y={SHOT_Y}
						width={SHOT_W}
						height={SHOT_H}
						fill={shotStatus !== 'ready' ? colors.coverBg : undefined}
						stroke={colors.border}
						lineWidth={1}
						borderRadius={radius.md}
						pointerEvents={false}
					/>
					{shotLoading && (
						<Spinner x={COVER_X + SHOT_W / 2} y={SHOT_Y + SHOT_H / 2} scale={0.7} />
					)}
				</>
			)}

			{/* ── CENTER: identity ────────────────────────────────────── */}
			{titleLines.map((line, i) => (
				<Text
					key={`title-${i}`}
					x={COL_X}
					y={TITLE_BASE + i * TITLE_LINE_H}
					variant="display"
					color={colors.textPrimary}
				>
					{line}
				</Text>
			))}
			{identity !== '' && (
				<>
					{/* The platform's own icon leads the identity line (the
						same prefix the home hero wears, so the two screens read
						alike). */}
					{game.platform !== '' && (
						<PlatformIcon
							slug={platformIconSlug(game.platform, '')}
							x={COL_X}
							y={metaY - 16}
							size={20}
						/>
					)}
					<Text
						x={COL_X + (game.platform !== '' ? 28 : 0)}
						y={metaY}
						variant="label"
						size={fontSize.small}
						color={colors.textSecondary}
						maxWidth={COL_W - (game.platform !== '' ? 28 : 0)}
						overflow="ellipsis"
					>
						{identity}
					</Text>
				</>
			)}

			{/* The status pill — the same chip the home hero shows, so a
				state reads identically on both screens. */}
			<StatusChip x={COL_X} y={chipY} text={stateChip.text} tone={stateChip.tone ?? 'neutral'} />

			{/* ── CENTER: the description ─────────────────────────────── */}
			{summaryBudget.length === 0 ? (
				<Text x={COL_X} y={descTop} variant="body" color={colors.textFaint}>
					No description for this game.
				</Text>
			) : (
				summaryBudget.slice(0, summaryShown).map((line, i) => (
					<Text
						key={`summary-${i}`}
						x={COL_X}
						y={descTop + i * DESC_LINE_H}
						variant="body"
						color={colors.textSecondary}
					>
						{line}
					</Text>
				))
			)}
			{clamped && (
				<Text
					x={COL_X}
					y={descTop + summaryShown * DESC_LINE_H}
					variant="micro"
					size={fontSize.tiny}
					color={colors.accent}
				>
					{expanded ? 'Less details' : 'More details'}
				</Text>
			)}

			{/* ── CENTER: the actions ─────────────────────────────────── */}
			<Button
				x={COL_X}
				y={PRIMARY_Y}
				width={COL_W}
				label={primary.label}
				variant="primary"
				size="lg"
				focused={focusClamped === 0}
				disabled={!primary.enabled}
				keycap="A"
				detail={primary.detail !== '' ? primary.detail : undefined}
				onPress={primary.enabled ? primary.run : undefined}
			/>
			{(() => {
				let bx = COL_X;
				return secondary.map((row, i) => {
					const x = bx;
					bx += secWidths[i] + BTN_GAP;
					return (
						<Button
							key={row.label}
							x={x}
							y={SECONDARY_Y}
							width={secWidths[i]}
							label={row.label}
							variant={row.variant}
							size="md"
							focused={focusClamped === i + 1}
							keycap="A"
							onPress={row.run}
						/>
					);
				});
			})()}

			{/* ── RIGHT: the installation card ────────────────────────── */}
			<Panel x={PANEL_X} y={PANEL_Y} width={PANEL_W} height={panelH} />
			<ProgressBar
				x={innerX}
				y={BAR_Y}
				width={innerW}
				value={installBar}
				tone={installTone}
				label={state.kind === 'installing' ? 'INSTALL' : 'INSTALLATION'}
				right={panelRight}
				caption={installCaption}
				captionColor={captionDanger ? colors.danger : undefined}
			/>
			<Rect x={innerX} y={RULE_1} width={innerW} height={1} fill={colors.border} pointerEvents={false} />

			{/* The facts, two columns of two — home's four, from the model. */}
			{facts.map((fact, i) => (
				<Field
					key={fact.label}
					x={innerX + (i % 2) * (FACT_COL_W + FACT_COL_GAP)}
					y={FACTS_Y + Math.floor(i / 2) * FACT_ROW_H}
					label={fact.label}
					value={fact.value}
					width={FACT_COL_W}
					valueSize={fontSize.small}
				/>
			))}
			<Rect x={innerX} y={RULE_2} width={innerW} height={1} fill={colors.border} pointerEvents={false} />

			{/* The disc position, when the release really has several. The
				Discs action is the way to change it. */}
			{multiDisc && disc !== undefined && (
				<Field
					x={innerX}
					y={DISC_Y}
					label="DISC"
					value={`Disc ${disc.index + 1} of ${disc.count}`}
					width={innerW}
					valueSize={fontSize.small}
				/>
			)}

			{/* The save-sync row: what exists locally, then — once a sync
				has actually run — its confirmed outcome. */}
			<Field
				x={innerX}
				y={savesY}
				label="SAVE SYNC"
				value={savesValue}
				valueColor={savesColor}
				width={innerW}
				valueSize={fontSize.small}
			/>
			{syncBusy && <Spinner x={PANEL_X + PANEL_W - 28} y={savesY + 30} scale={0.6} />}

			{/* ── the footer: contextual hints ─────────────────────────── */}
			<HintBar hints={hints} />
		</>
	);
}
