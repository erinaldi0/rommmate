/**
 * The library dashboard: instead of dumping every rom into one grid, the
 * library is offered as five horizontal rows —
 *
 *   1. Continue playing  (last played, most recent first)
 *   2. Favourites
 *   3. Platforms         (every platform, one cover each)
 *   4. Recently added
 *   5. Collections       (the server's saved collections)
 *
 * A row's label opens the row's full grid; a cover opens its content
 * (a title, a platform's games, a collection). Empty rows collapse, so a
 * fresh library shows only the rows that already have something to say.
 *
 * While the library is still streaming in, the rows fill in progressively
 * as pages arrive — the dashboard is the streamed library's face.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Rect, Text, useDimensions, useParent } from 'react-tela';
import { colors, fontFamily, fontSize, radius } from '../theme';
import { useDirection, useGamepadButton } from '../hooks/use-gamepad';
import { useDragScroll } from '../hooks/use-drag-scroll';
import { BUILD_ID } from '../version';
import { relativeTime, formatDate } from '../time';
import { Header } from './Header';
import { HintBar, HintBarBackdrop } from './HintBar';
import { EmptyState } from './EmptyState';
import { Spinner } from './Spinner';
import { CoverImage, type CoverStatus } from './CoverImage';
import type { LibrarySection, RommCollection, RommTitle } from '../romm';

interface Props {
	/** Status line from the client (load result, etc.). */
	status: string;
	/** True while the connection (and its background walk) is in flight. */
	busy: boolean;
	/** True while the library shows mocked data instead of a real RomM server. */
	demo?: boolean;
	/** The whole library, grouped into titles. */
	titles: RommTitle[];
	/** Favourites, as a separate filtered walk reported them (grouped). */
	favoriteTitles: RommTitle[];
	/** The server's saved collections. */
	collections: RommCollection[];
	/** Per-title disc selection (title key → disc index). */
	discSelections: Record<number, number>;
	/** A cover was chosen: open its title (disc picker or detail). */
	onOpenTitle: (title: RommTitle) => void;
	/** A row label (or platform / collection cover) was chosen. */
	onOpenSection: (section: LibrarySection) => void;
	/** Back out of the dashboard (to the settings screen). */
	onBack: () => void;
	/** True while another screen owns the input (detail / disc picker). */
	paused?: boolean;
}

// ── layout ─────────────────────────────────────────────────────────────────

/** Where the rows live. */
const AREA_Y = 108;
/** How tall one row is: cover + two text lines + breathing room. */
const ROW_H = 196;
/** The rows' viewport — the hint bar owns the bottom of the screen. */
const AREA_H = 560;
/** Row label column (wide enough for "Continue playing" at heading size). */
const LABEL_X = 24;
const LABEL_W = 190;
/** First cover of a row. */
const TILE_X0 = LABEL_X + LABEL_W + 10;
const COVER_W = 108;
const COVER_H = 144; // 3:4 cover art
/**
 * Horizontal tile pitch. Seven covers per row — the same count the RomM
 * web UI shows — so the artwork keeps its share of the screen instead of
 * the row being crammed with tiny thumbnails.
 */
const PITCH_X = 128;
/**
 * Platform rows use the wider geometry: platform names are the point of
 * that row, and a narrow label ellipsises "Nintendo 64" unceremoniously.
 */
const WIDE_PITCH_X = 132;
const WIDE_COVER_W = 112;
const WIDE_COVER_H = 149;
/** How many covers one row shows; the rest live in the row's grid. */
const MAX_TILES = 7;

interface Tile {
	key: string;
	coverUrl: string;
	/** First line under the cover. */
	name: string;
	/** Second line (relative time, count, date…). */
	sub: string;
	/** The disc the tile shows, for multi-disc titles. */
	discIndex?: number;
	discCount?: number;
	/** What A does with this cover. */
	section: LibrarySection;
	title?: RommTitle;
}

interface Row {
	id: string;
	/** Label in the left column. */
	label: string;
	/** Small line under the label. */
	countLabel: string;
	/** What A on the label opens. */
	section: LibrarySection;
	tiles: Tile[];
	/** Drawn with the wider tile geometry (platform names). */
	wide?: boolean;
}

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
function CoverSlot({
	url,
	/** One-letter placeholder, shown only while there is no artwork. */
	glyph,
	x,
	y,
	width,
	height,
}: {
	url: string;
	glyph: string;
	x: number;
	y: number;
	width: number;
	height: number;
}) {
	const [status, setStatus] = useState<CoverStatus>(url === '' ? 'ready' : 'loading');
	// The plate is needed whenever the artwork is not on screen: the cover
	// never existed, or it has not landed yet (or it failed).
	const placeholderVisible = url === '' || status !== 'ready';
	return (
		<>
			<CoverImage url={url} x={x} y={y} width={width} height={height} onStatus={setStatus} />
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

export function LibrarySections({
	status,
	busy,
	demo = false,
	titles,
	favoriteTitles,
	collections,
	discSelections,
	onOpenTitle,
	onOpenSection,
	onBack,
	paused = false,
}: Props) {
	const dims = useDimensions();
	const { ctx } = useParent();

	// ── rows ──────────────────────────────────────────────────────────────

	const rows: Row[] = useMemo(() => {
		const out: Row[] = [];

		const played = titles
			.filter((t) => t.lastPlayedAt !== '')
			.sort((a, b) => (a.lastPlayedAt > b.lastPlayedAt ? -1 : a.lastPlayedAt < b.lastPlayedAt ? 1 : 0))
			.slice(0, MAX_TILES);
		if (played.length > 0) {
			out.push({
				id: 'continue',
				label: 'Continue playing',
				countLabel: `${titles.filter((t) => t.lastPlayedAt !== '').length} played`,
				section: { kind: 'continue' },
				tiles: played.map((t) => tileFromTitle(t, discSelections, relativeTime(t.lastPlayedAt))),
			});
		}

		const favs = favoriteTitles
			.slice()
			.sort((a, b) => (a.lastPlayedAt > b.lastPlayedAt ? -1 : a.lastPlayedAt < b.lastPlayedAt ? 1 : 0))
			.slice(0, MAX_TILES);
		if (favs.length > 0) {
			out.push({
				id: 'favourites',
				label: 'Favourites',
				countLabel: `${favoriteTitles.length} games`,
				section: { kind: 'favourites' },
				tiles: favs.map((t) =>
					tileFromTitle(t, discSelections, relativeTime(t.lastPlayedAt) || 'favourite'),
				),
			});
		}

		// Platforms: one cover per platform, the biggest libraries first.
		const byPlatform = new Map<string, { count: number; cover: string }>();
		for (const t of titles) {
			if (t.platform === '') continue;
			const entry = byPlatform.get(t.platform);
			if (entry === undefined) {
				byPlatform.set(t.platform, { count: 1, cover: t.coverUrl });
			} else {
				entry.count += 1;
				if (entry.cover === '' && t.coverUrl !== '') entry.cover = t.coverUrl;
			}
		}
		const platforms = [...byPlatform.entries()].sort(
			(a, b) => (a[1].count !== b[1].count ? b[1].count - a[1].count : a[0] < b[0] ? -1 : 1),
		);
		if (platforms.length > 0) {
			out.push({
				id: 'platforms',
				label: 'Platforms',
				countLabel: `${platforms.length} ${platforms.length === 1 ? 'platform' : 'platforms'}`,
				section: { kind: 'recent' }, // labels never open this one; covers do
				wide: true,
				tiles: platforms.slice(0, MAX_TILES).map(([name, info]) => ({
					key: `platform-${name}`,
					coverUrl: info.cover,
					name,
					sub: `${info.count} ${info.count === 1 ? 'game' : 'games'}`,
					section: { kind: 'platform', platform: name },
				})),
			});
		}

		const recent = titles
			.filter((t) => t.createdAt !== '')
			.sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0))
			.slice(0, MAX_TILES);
		if (recent.length > 0) {
			out.push({
				id: 'recent',
				label: 'Recently added',
				countLabel: `${titles.filter((t) => t.createdAt !== '').length} games`,
				section: { kind: 'recent' },
				tiles: recent.map((t) => tileFromTitle(t, discSelections, formatDate(t.createdAt))),
			});
		}

		if (collections.length > 0) {
			out.push({
				id: 'collections',
				label: 'Collections',
				countLabel: `${collections.length} ${collections.length === 1 ? 'collection' : 'collections'}`,
				section: { kind: 'recent' }, // ditto
				tiles: collections.slice(0, MAX_TILES).map((c) => ({
					key: `collection-${c.id}`,
					coverUrl: c.coverUrl,
					name: c.name === '' ? `Collection ${c.id}` : c.name,
					sub: `${c.romCount} ${c.romCount === 1 ? 'rom' : 'roms'}`,
					section: { kind: 'collection', collection: c },
				})),
			});
		}

		return out;
	}, [titles, favoriteTitles, collections, discSelections]);

	// ── focus ─────────────────────────────────────────────────────────────

	// `sel` is -1 for the row label, 0+ for a cover.
	const [row, setRow] = useState(0);
	const [sel, setSel] = useState(0);

	// A streaming library can grow or lose rows under the focus.
	const focusRow = Math.min(row, Math.max(0, rows.length - 1));
	const focusSel = Math.min(sel, rows[focusRow]?.tiles.length ?? 0);

	useDirection(
		'Up',
		() => {
			setRow((r) => Math.max(0, r - 1));
		},
		[],
		!paused,
	);
	useDirection(
		'Down',
		() => {
			setRow((r) => Math.min(rows.length - 1, r + 1));
		},
		[rows.length],
		!paused,
	);
	useDirection(
		'Left',
		() => {
			setSel((s) => Math.max(-1, s - 1));
		},
		[],
		!paused,
	);
	useDirection(
		'Right',
		() => {
			setSel((s) => Math.min((rows[focusRow]?.tiles.length ?? 0) - 1, s + 1));
		},
		[rows, focusRow],
		!paused,
	);

	useGamepadButton(
		'A',
		() => {
			const r = rows[focusRow];
			if (r === undefined) return;
			if (focusSel < 0) {
				onOpenSection(r.section);
				return;
			}
			const tile = r.tiles[focusSel];
			if (tile === undefined) return;
			if (tile.title !== undefined) onOpenTitle(tile.title);
			else onOpenSection(tile.section);
		},
		[rows, focusRow, focusSel, onOpenTitle, onOpenSection],
		!paused,
	);
	useGamepadButton('B', onBack, [onBack], !paused);

	// ── scrolling ─────────────────────────────────────────────────────────

	// At this cover size five rows don't fit the viewport, so the rows
	// scroll: the view follows the focused row, and a touch drag pans it.
	const [scrollTop, setScrollTop] = useState(0);
	const maxScroll = Math.max(0, rows.length * ROW_H - AREA_H);

	useEffect(() => {
		setScrollTop((s) => Math.max(0, Math.min(s, maxScroll)));
	}, [maxScroll]);

	// Keep the focused row inside the visible window (the same rule the
	// library grid applies to its focused tile).
	useEffect(() => {
		setScrollTop((s) => {
			const top = focusRow * ROW_H;
			const bottom = top + ROW_H;
			if (top < s) return Math.max(0, top);
			if (bottom > s + AREA_H) return Math.min(maxScroll, bottom - AREA_H);
			return s;
		});
	}, [focusRow, rows.length, maxScroll]);

	useDragScroll(
		!paused && rows.length > 0,
		(dy) => {
			setScrollTop((s) => Math.max(0, Math.min(s + dy, maxScroll)));
		},
	);

	// ── rendering ─────────────────────────────────────────────────────────

	const meta = `${titles.length} games`;
	const empty = rows.length === 0;

	const rowTiles: React.ReactNode[] = [];
	const focusRing: React.ReactNode[] = [];

	// Only the rows that intersect the viewport are emitted (the grid's
	// culling rule, applied to section rows).
	const firstRow = Math.max(0, Math.floor(scrollTop / ROW_H));
	const lastRow = Math.min(rows.length - 1, Math.floor((scrollTop + AREA_H - 1) / ROW_H));

	rows.forEach((r, i) => {
		if (i < firstRow || i > lastRow) return;
		const rowY = AREA_Y + i * ROW_H - scrollTop;
		const rowFocused = i === focusRow && !paused;

		// The label.
		rowTiles.push(
			<Text
				key={`${r.id}-label`}
				x={LABEL_X}
				y={rowY + 56}
				fontFamily={fontFamily}
				fontSize={fontSize.heading}
				fill={rowFocused ? colors.textPrimary : colors.textSecondary}
				maxWidth={LABEL_W}
				overflow="ellipsis"
			>
				{r.label}
			</Text>,
			<Text
				key={`${r.id}-count`}
				x={LABEL_X}
				y={rowY + 84}
				fontFamily={fontFamily}
				fontSize={fontSize.tiny}
				fill={colors.textFaint}
			>
				{r.countLabel}
			</Text>,
		);

		// The covers.
		const coverW = r.wide ? WIDE_COVER_W : COVER_W;
		const coverH = r.wide ? WIDE_COVER_H : COVER_H;
		const pitch = r.wide ? WIDE_PITCH_X : PITCH_X;
		const nameSize = r.wide ? 14 : 15;
		const nameW = pitch - 8;

		r.tiles.forEach((t, ti) => {
			const x = TILE_X0 + ti * pitch;
			const covered = t.coverUrl !== '' ? '' : (t.name.trim().charAt(0).toUpperCase() || '?');
			rowTiles.push(
				<React.Fragment key={`${r.id}-${t.key}`}>
					<CoverSlot url={t.coverUrl} glyph={covered} x={x} y={rowY + 2} width={coverW} height={coverH} />

					{/* Multi-disc badge over the corner of the cover. */}
					{t.discCount !== undefined && t.discCount > 1 && t.discIndex !== undefined && (
						<Rect
							x={x + 6}
							y={rowY + 8}
							width={36}
							height={20}
							fill={colors.accent}
							borderRadius={radius.sm}
						/>
					)}
					{t.discCount !== undefined && t.discCount > 1 && t.discIndex !== undefined && (
						<Text x={x + 6 + 18} y={rowY + 10} fontFamily={fontFamily} fontSize={13} fontWeight="bold" fill={colors.bg} textAlign="center">
							{`${t.discIndex}/${t.discCount}`}
						</Text>
					)}

					<Text
						x={x}
						y={rowY + 152}
						fontFamily={fontFamily}
						fontSize={nameSize}
						fill={rowFocused && ti === focusSel ? colors.textPrimary : colors.textSecondary}
						maxWidth={nameW}
						overflow="ellipsis"
					>
						{t.name}
					</Text>
					{t.sub !== '' && (
						<Text
							x={x}
							y={rowY + 174}
							fontFamily={fontFamily}
							fontSize={12}
							fill={colors.textFaint}
							maxWidth={nameW}
							overflow="ellipsis"
						>
							{t.sub}
						</Text>
					)}
				</React.Fragment>,
			);
		});

		// The focus ring: exactly one, around the label or the focused cover.
		if (rowFocused && focusSel < 0) {
			focusRing.push(
				<Rect
					key={`ring-${r.id}-label`}
					x={LABEL_X - 6}
					y={rowY + 16}
					width={LABEL_W + 12}
					height={ROW_H - 32}
					stroke={colors.accent}
					lineWidth={4}
					borderRadius={radius.lg}
				/>,
			);
		} else if (rowFocused) {
			const t = r.tiles[focusSel];
			if (t !== undefined) {
				focusRing.push(
					<Rect
						key={`ring-${r.id}-${t.key}`}
						x={TILE_X0 + focusSel * pitch - 6}
						y={rowY - 6}
						width={coverW + 12}
						height={coverH + 12}
						stroke={colors.accent}
						lineWidth={4}
						borderRadius={radius.lg}
					/>,
				);
			}
		}
	});

	return (
		<>
			<Rect width={dims.width} height={dims.height} fill={colors.bg} />

			{rowTiles}

			{/*
			 * Two opaque bands mask the rows that overflow the viewport
			 * (the grid's trick). The chrome is drawn on top of them.
			 */}
			<Rect x={0} y={0} width={dims.width} height={AREA_Y} fill={colors.bg} />
			<Rect
				x={0}
				y={AREA_Y + AREA_H}
				width={dims.width}
				height={Math.max(0, dims.height - AREA_Y - AREA_H)}
				fill={colors.bg}
			/>

			{focusRing}

			<Header
				title="RomMmate"
				subtitle={status}
				meta={meta}
				badge={demo ? 'DEMO' : ''}
				build={BUILD_ID}
			/>

			{empty && (
				<>
					{busy && <Spinner x={dims.width / 2} y={AREA_Y + 120} active />}
					<EmptyState
						glyph={busy ? '' : '∅'}
						title={busy ? 'Connecting to RomM…' : 'Your library is empty'}
						detail={
							busy
								? status !== '' && status !== 'Connecting…'
									? status
									: 'Loading your library'
								: 'Once RomM has roms in it, they will show up here.'
						}
						centerY={AREA_Y + 220}
					/>
				</>
			)}

			<HintBarBackdrop />
			<HintBar hints={['A open', 'B back', '↑↓ sections', '←→ browse']} />
		</>
	);
}

/**
 * A title as a row cover: the disc the tile represents (the player's choice,
 * else the release's main disc), its name, and a badge when the release has
 * several discs.
 */
function tileFromTitle(
	t: RommTitle,
	discSelections: Record<number, number>,
	sub: string,
): Tile {
	const index = discSelections[t.key] ?? t.mainIndex;
	const disc = t.discs[Math.min(index, t.discs.length - 1)] ?? t.discs[0];
	return {
		key: `title-${t.key}`,
		coverUrl: disc?.coverUrl !== '' && disc?.coverUrl !== undefined ? disc.coverUrl : t.coverUrl,
		name: t.name,
		sub,
		discIndex: t.discs.length > 1 ? Math.min(index, t.discs.length - 1) + 1 : undefined,
		discCount: t.discs.length > 1 ? t.discs.length : undefined,
		section: { kind: 'recent' }, // the label opens the row; covers open the title
		title: t,
	};
}
