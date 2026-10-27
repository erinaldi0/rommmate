/**
 * The RetroAchievements screen for one game: the published achievement set,
 * joined with the user's progress on it, plus a progress summary on top.
 *
 * The data comes through RomM (`play.raGameView`): the achievement catalog
 * from RomM's `merged_ra_metadata`, the user's unlocks from RomM's
 * `ra_progression` (which this screen asks RomM to refresh first, so
 * progress earned inside RetroArch shows up). Everything degrades: a game
 * RomM has not matched, a user with no linked RA account, and a server
 * without RA routes all end in a calm "nothing to show" rather than a hole.
 *
 * Layout: the summary panel on top, then one row per achievement —
 * a status dot (unlocked / hardcore / locked), the title and its one-line
 * description, the points, a hardcore tag, and the unlock date. The list
 * scrolls (gamepad up/down, or a finger drag) through only the rows that
 * intersect the viewport.
 */
import React, { useEffect, useState } from 'react';
import { Rect, useDimensions } from 'react-tela';
import { useDragScroll } from '../hooks/use-drag-scroll';
import { useDirection, useGamepadButton } from '../hooks/use-gamepad';
import { Header } from './Header';
import { colors } from '../theme';
import { play } from '../play';
import { raSummary, type RaGameView } from '../ra';
import {
	AmbientBackdrop,
	Chip,
	EmptyState,
	Field,
	HintBar,
	LoadingState,
	Panel,
	ProgressBar,
	Text,
	type ProgressTone,
} from './ui';
import { clampScroll, visibleRange } from './ui/layout';
import type { RommGame } from '../romm';

interface Props {
	/** The game whose achievements to show (always RA-matched when opened). */
	game: RommGame;
	/** True in demo mode (there is no live RomM, so nothing to fetch). */
	demo: boolean;
	/** Return to the game detail (B). */
	onBack: () => void;
}

// ── geometry ───────────────────────────────────────────────────────────────
const MARGIN = 64;
const PANEL_X = MARGIN;
const PANEL_W = 1280 - MARGIN * 2;
const PANEL_Y = 104;
const PANEL_H = 100;
const PAD = 20;

const LIST_TOP = PANEL_Y + PANEL_H + 16;
const LIST_BOTTOM = 648; // the hint bar's strip starts at 648
const ROW_H = 48;
const LIST_W = PANEL_W;

/** Right-aligned columns of a row (fixed, so rows never re-flow). */
const POINTS_X = MARGIN + LIST_W - 230;
const HC_X = MARGIN + LIST_W - 170;
const DATE_X = MARGIN + LIST_W - 12;

/** One ISO date the way a player reads it (the day). */
function shortDate(iso: string | null): string {
	if (iso === null || iso === '') return '';
	const d = iso.slice(0, 10);
	return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

export function RAAchievementsScreen({ game, demo, onBack }: Props) {
	const dims = useDimensions();
	const [loading, setLoading] = useState(!demo);
	const [view, setView] = useState<RaGameView | null>(null);
	const [raUser, setRaUser] = useState<string | null>(null);
	const [scroll, setScroll] = useState(0);

	// The data: refresh the user's progress (so unlocks earned inside
	// RetroArch are current), then compose the view for this game.
	useEffect(() => {
		if (demo) return;
		let alive = true;
		setLoading(true);
		void (async () => {
			const tag = await play.raTag();
			if (!alive) return;
			setRaUser(tag?.raUsername ?? null);
			if (tag !== null && tag.userId > 0) await play.refreshRa();
			const v = await play.raGameView(game);
			if (!alive) return;
			setView(v);
			setLoading(false);
		})();
		return () => {
			alive = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [game.id, demo]);

	const official = view !== null && view.official;
	const rows = view?.achievements ?? [];
	const viewH = LIST_BOTTOM - LIST_TOP;
	const contentH = rows.length * ROW_H;
	const scrollClamped = clampScroll(scroll, contentH, viewH);
	const canScroll = contentH > viewH;

	const scrollBy = (delta: number) =>
		setScroll((s) => clampScroll(s + delta, contentH, viewH));
	useDirection('Up', () => scrollBy(-ROW_H), [canScroll], official && !demo && !loading);
	useDirection('Down', () => scrollBy(ROW_H), [canScroll], official && !demo && !loading);
	useGamepadButton('B', onBack, [onBack]);
	useDragScroll(official && !loading, (dy) => setScroll((s) => clampScroll(s - dy, contentH, viewH)));

	// ── the summary ──────────────────────────────────────────────────────
	const earned = view?.earned ?? 0;
	const total = view?.total ?? 0;
	const pct = total > 0 ? Math.round((earned / total) * 100) : 0;
	const tone: ProgressTone =
		total > 0 && earned >= total ? 'success' : official ? 'accent' : 'neutral';
	const summary = official ? raSummary(view) : '';
	const caption =
		demo
			? 'Demo mode — achievements need a live RomM connection'
			: raUser === null
				? 'Link your RA account in RomM to see your progress'
				: summary !== ''
					? summary
					: official
						? 'no unlocks yet'
						: '';
	const hardcore = view !== null && view.hardcore;
	const last = shortDate(view?.lastAwarded ?? null);

	// ── the rows ─────────────────────────────────────────────────────────
	const { first, last: lastRow } = visibleRange(scrollClamped, viewH, ROW_H, rows.length);
	const rowEntities: React.ReactNode[] = [];
	if (official) {
		for (let i = first; i <= lastRow; i++) {
			const row = rows[i];
			if (row === undefined) continue;
			const y = LIST_TOP + i * ROW_H - scrollClamped;
			const dotX = MARGIN + 18;
			const dotY = y + 18;
			rowEntities.push(
				<Rect
					key={`dot-${row.id}`}
					x={dotX}
					y={dotY}
					width={12}
					height={12}
					borderRadius={6}
					fill={row.earnedHardcore ? colors.accent : row.earned ? colors.success : 'transparent'}
					stroke={row.earned ? undefined : colors.textFaint}
					lineWidth={row.earned ? 0 : 2}
					pointerEvents={false}
				/>,
				<Text
					key={`title-${row.id}`}
					x={dotX + 28}
					y={y + 10}
					variant="body"
					size={20}
					color={row.earned ? colors.textPrimary : colors.textSecondary}
					maxWidth={LIST_W - 360}
					overflow="ellipsis"
				>
					{row.title}
				</Text>,
				<Text
					key={`desc-${row.id}`}
					x={dotX + 28}
					y={y + 32}
					variant="caption"
					color={colors.textMuted}
					maxWidth={LIST_W - 360}
					overflow="ellipsis"
				>
					{row.description}
				</Text>,
				row.earnedHardcore ? (
					<Chip
						key={`hc-${row.id}`}
						x={HC_X}
						y={y + 12}
						text="HARD"
						tone="accent"
						size="sm"
					/>
				) : null,
				<RowRight row={row} y={y} pointsX={POINTS_X} dateX={DATE_X} />,
			);
			// A hairline under every row but the last (the list's rhythm).
			if (i < rows.length - 1) {
				rowEntities.push(
					<Rect
						key={`rule-${row.id}`}
						x={MARGIN}
						y={y + ROW_H - 1}
						width={LIST_W}
						height={1}
						fill={colors.border}
						pointerEvents={false}
					/>,
				);
			}
		}
	}

	const title = game.name !== '' ? game.name : `Game #${game.id}`;

	return (
		<>
			<Rect width={dims.width} height={dims.height} fill={colors.bg} />
			<AmbientBackdrop width={dims.width} height={dims.height} />
			<Header
				title="Achievements"
				subtitle={`${title} · RetroAchievements`}
			/>

			{/* ── the summary ───────────────────────────────────────────── */}
			<Panel x={PANEL_X} y={PANEL_Y} width={PANEL_W} height={PANEL_H} />
			<ProgressBar
				x={PANEL_X + PAD}
				y={PANEL_Y + 52}
				width={560}
				value={total > 0 ? earned / total : 0}
				tone={tone}
				label="PROGRESS"
				right={official ? `${earned} / ${total} · ${pct}%` : ''}
				caption={caption}
				captionColor={raUser === null && !demo ? colors.warning : undefined}
			/>
			<Field
				x={PANEL_X + PAD + 620}
				y={PANEL_Y + 26}
				label="RA ACCOUNT"
				value={demo ? '—' : raUser ?? 'not linked in RomM'}
				width={180}
				valueSize={16}
			/>
			<Field
				x={PANEL_X + PAD + 830}
				y={PANEL_Y + 26}
				label="HARD CORE"
				value={hardcore ? 'yes' : official ? 'no' : '—'}
				width={140}
				valueSize={16}
				valueColor={hardcore ? colors.success : undefined}
			/>
			<Field
				x={PANEL_X + PAD + 1010}
				y={PANEL_Y + 26}
				label="LAST UNLOCK"
				value={last !== '' ? last : '—'}
				width={120}
				valueSize={16}
			/>

			{/* ── the list ──────────────────────────────────────────────── */}
			{demo ? (
				<EmptyState
					title="No live data in demo mode"
					detail="Achievements are read through your RomM instance. Connect to a real server to see them."
					centerY={LIST_TOP + viewH / 2}
				/>
			) : loading ? (
				<LoadingState
					label="Loading achievements…"
					centerY={LIST_TOP + viewH / 2}
				/>
			) : !official ? (
				<EmptyState
					title="No achievements here"
					detail={
						view === null
							? 'The server could not provide this game’s achievement set right now.'
							: 'RetroAchievements has no published set for this game yet.'
					}
					centerY={LIST_TOP + viewH / 2}
				/>
			) : (
				<>
					{rowEntities}
					{canScroll && (
						<Text
							x={MARGIN + LIST_W}
							y={LIST_BOTTOM - 24}
							variant="micro"
							align="right"
							color={colors.textFaint}
						>
							{`${lastRow - first + 1} of ${rows.length} achievements shown`}
						</Text>
					)}
				</>
			)}

			<HintBar hints={[canScroll ? '↑↓ scroll' : '', 'B back'].filter((h) => h !== '')} />
		</>
	);
}

/** The right-hand fact columns of a row: points (always) and the date (when earned). */
function RowRight({
	row,
	y,
	pointsX,
	dateX,
}: {
	row: { points: number; earned: boolean; dateEarned: string | null };
	y: number;
	pointsX: number;
	dateX: number;
}) {
	const pts = row.points > 0 ? `${row.points} pts` : '';
	const date = row.earned ? shortDate(row.dateEarned) : '';
	return (
		<>
			{pts !== '' && (
				<Text x={pointsX} y={y + 22} variant="caption" align="right" color={row.earned ? colors.textSecondary : colors.textMuted}>
					{pts}
				</Text>
			)}
			{date !== '' && (
				<Text x={dateX} y={y + 22} variant="caption" align="right" color={colors.textFaint}>
					{date}
				</Text>
			)}
		</>
	);
}
