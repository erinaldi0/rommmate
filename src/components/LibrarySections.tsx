/**
 * The library dashboard: the home screen the app leads with.
 *
 * Composition only — the pieces each carry the knowledge of their own
 * drawing:
 *
 *   hero.ts            the featured game's model (pure data)
 *   HeroCard           its box art, identity, chips, summary and actions
 *   InstallPanel       the installation card: progress, facts, disc pager
 *   TileRow            one horizontal row of cover tiles
 *   PlatformChipStrip  the platform chips (self-scrolling)
 *   SectionMenu        the X jump-menu overlay
 *   cover-slot.tsx     the cover frame every tile draws through
 *
 * What remains here is the part that must be in one mind: the focus
 * state machine (hero targets and row indices), the row scroll, the
 * gamepad input, and the paint order that masks the scrolled rows.
 *
 * Above the fold sits the hero — the featured game (most recently played,
 * else most recently added, else the first) — with inline actions: the
 * primary button installs or plays, "Sync saves" syncs the disc's saves,
 * "More" opens the detail screen. The hero is also the *preview*: a row
 * cover's focus moves the featured content to that game (identity, facts,
 * actions), and the featured game returns when the focus comes home.
 * Below it, the library continues as
 * horizontal rows: Continue playing, Favourites, Platforms (chips),
 * Recently added, Collections. X opens the section menu.
 *
 * While the library is still streaming in, the rows fill in progressively
 * as pages arrive — the dashboard is the streamed library's face.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Rect, Text, useDimensions, useParent } from 'react-tela';
import { colors, fontFamily, radius } from '../theme';
import { useDirection, useGamepadButton } from '../hooks/use-gamepad';
import { useDragScroll } from '../hooks/use-drag-scroll';
import { BUILD_ID } from '../version';
import { measure } from '../text';
import { DashboardHeader } from './DashboardHeader';
import { HintBar, HintBarBackdrop } from './HintBar';
import { EmptyState } from './EmptyState';
import { Spinner } from './Spinner';
import { play, usePlayState } from '../play';
import { buildHero, heroForTile, primaryRow } from './dashboard/hero';
import {
	COVER_H,
	COVER_W,
	HERO_PAGER,
	MARGIN_X,
	PITCH_X,
	ROWS_H,
	ROWS_Y,
	ROW_H,
	TILE_X0,
} from './dashboard/layout';
import { buildDisplayRows, type DisplayRow } from './dashboard/section-rows';
import { HeroCard } from './dashboard/HeroCard';
import { InstallPanel } from './dashboard/InstallPanel';
import { PlatformChipStrip } from './dashboard/PlatformChipStrip';
import { SectionMenu } from './dashboard/SectionMenu';
import { TileRow } from './dashboard/TileRow';
import type { LibrarySection, RommCollection, RommGame, RommPlatform, RommTitle } from '../romm';

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
	/** The server's platforms (the artwork of the platforms strip). */
	platforms?: RommPlatform[];
	/** The server's saved collections. */
	collections: RommCollection[];
	/** Per-title disc selection (title key → disc index). */
	discSelections: Record<number, number>;
	/** A cover was chosen: open its title (disc picker or detail). */
	onOpenTitle: (title: RommTitle) => void;
	/** A row label (or platform / collection cover) was chosen. */
	onOpenSection: (section: LibrarySection) => void;
	/** The hero's More (or a chosen disc when it has one): the detail screen. */
	onOpenDetail?: (game: RommGame, disc?: { index: number; count: number }) => void;
	/** The hero's disc pager moved: remember the choice. */
	onSelectDisc?: (titleKey: number, index: number) => void;
	/** Back out of the dashboard (to the settings screen). */
	onBack: () => void;
	/** True while another screen owns the input (detail / disc picker). */
	paused?: boolean;
}

export function LibrarySections({
	status,
	busy,
	demo = false,
	titles,
	favoriteTitles,
	platforms = [],
	collections,
	discSelections,
	onOpenTitle,
	onOpenSection,
	onOpenDetail,
	onSelectDisc,
	onBack,
	paused = false,
}: Props) {
	const dims = useDimensions();
	const { ctx } = useParent();

	// ── the featured game, and the rows ───────────────────────────────────

	const featured = useMemo(
		() => buildHero(titles, discSelections),
		[titles, discSelections],
	);

	const rows = useMemo(
		() => buildDisplayRows(titles, favoriteTitles, platforms, collections, discSelections),
		// `platforms` feeds the chips' artwork: a late logo refresh must
		// re-render the strip (the same one-arrival-per-connect cadence).
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[titles, favoriteTitles, platforms, collections, discSelections],
	);

	// ── focus ─────────────────────────────────────────────────────────────

	// `sel` is -1 for the row label, 0+ for a cover. The hero keeps its own
	// index (`heroSel`): 0 cover, 1 primary, 2 sync, 3 more, 4 the pager
	// (only when the release has several discs). `row` is -1 for the hero.
	const [row, setRow] = useState(0);
	const [sel, setSel] = useState(0);
	const [heroSel, setHeroSel] = useState(1);

	// The section menu (X): null closed, else the focused item's index.
	const [menuFocus, setMenuFocus] = useState<number | null>(null);
	const menuOpen = menuFocus !== null;

	// A streaming library can grow or lose rows under the focus.
	const focusRow = featured === null ? Math.max(0, Math.min(row, Math.max(0, rows.length - 1))) : Math.min(row, rows.length - 1);
	// Rows without a section (platforms, recent, collections) have no
	// openable header — their focus stops at the first cover, so the
	// library is never shown whole.
	const activeRow = focusRow >= 0 ? rows[focusRow] : undefined;
	const focusMin = activeRow !== undefined && activeRow.section === null ? 0 : -1;
	const focusCount = activeRow === undefined ? 0 : activeRow.kind === 'chips' ? activeRow.chips.length : activeRow.tiles.length;
	const focusSel = Math.min(Math.max(sel, Math.max(focusMin, 0)), Math.max(focusMin, focusCount - 1));

	// ── the hero previews the focus ───────────────────────────────────────

	// The hero shows the featured game while the hero (a row label, or a
	// chips row) holds the focus; the moment a cover tile does, the hero
	// follows it — its identity, facts and actions become the focused
	// game's, like the home menu's preview pane. "Featured" below is the
	// *home* game it returns to.
	const hero = useMemo(() => {
		if (featured === null) return null;
		if (focusRow < 0) return featured;
		const r = rows[focusRow];
		if (r === undefined || r.kind !== 'tiles') return featured;
		const t = r.tiles[focusSel];
		if (t === undefined) return featured;
		if (t.title !== undefined) return heroForTile(t.title, t.discIndex ?? 0);
		return featured;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [featured, rows, focusRow, focusSel]);

	const heroMulti = hero !== null && hero.knownDiscs > 1;
	const heroMax = heroMulti ? HERO_PAGER : 3;
	// The play state of the shown disc (the actions' engine). The hook runs
	// unconditionally — with no hero it subscribes to rom 0 and shows a
	// "demo" state the dashboard never displays.
	const heroState = usePlayState(hero?.disc.id ?? 0);
	const heroPrimary = hero !== null ? primaryRow(hero.disc, heroState, (m) => setHeroMsg(m)) : null;

	// The hero feeds the play service, as the detail screen does: state
	// derivation for its rom, and the action targets.
	useEffect(() => {
		if (hero !== null) play.noteGame(hero.disc);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [hero?.disc.id, hero?.disc]);

	// A status line from an inline action (install/sync outcomes); cleared
	// when the hero moves on to another game or disc.
	const [heroMsg, setHeroMsg] = useState('');
	useEffect(() => {
		setHeroMsg('');
	}, [hero?.title.key, hero?.discIndex]);
	const heroSelCl = hero === null ? 1 : Math.min(Math.max(heroSel, 0), heroMax);

	const open = !paused && !menuOpen && (hero !== null || rows.length > 0);

	useDirection(
		'Up',
		() => {
			if (focusRow <= 0) {
				if (hero !== null) setRow(-1);
				return;
			}
			setRow((r) => Math.max(0, r - 1));
		},
		[focusRow, rows.length, hero],
		open,
	);
	useDirection(
		'Down',
		() => {
			if (focusRow < 0) {
				setRow(0);
				// Onto the first row's openable header (or its covers).
				setSel(-1);
				return;
			}
			setRow((r) => Math.min(rows.length - 1, r + 1));
		},
		[rows.length, focusRow],
		open,
	);
	useDirection(
		'Left',
		() => {
			if (focusRow < 0) {
				// The disc pager owns the arrows while it is focused.
				if (heroSelCl === HERO_PAGER) {
					if (hero !== null && onSelectDisc !== undefined && hero.discIndex > 0) {
						onSelectDisc(hero.title.key, hero.discIndex - 1);
					}
					return;
				}
				setHeroSel((s) => (Math.min(s, heroMax) === 0 ? heroMax : Math.min(s, heroMax) - 1));
				return;
			}
			setSel((s) => Math.max(focusMin, s - 1));
		},
		[rows, focusRow, focusMin, heroSelCl, heroMax, hero],
		open,
	);
	useDirection(
		'Right',
		() => {
			if (focusRow < 0) {
				if (heroSelCl === HERO_PAGER) {
					if (
						hero !== null &&
						onSelectDisc !== undefined &&
						hero.discIndex < Math.max(0, hero.title.discs.length - 1)
					) {
						onSelectDisc(hero.title.key, hero.discIndex + 1);
					}
					return;
				}
				setHeroSel((s) => (Math.min(s, heroMax) >= heroMax ? 0 : Math.min(s, heroMax) + 1));
				return;
			}
			setSel((s) => Math.min(focusCount - 1, s + 1));
		},
		[rows, focusRow, focusCount, heroSelCl, heroMax, hero],
		open,
	);

	useGamepadButton(
		'A',
		() => {
			if (focusRow < 0) {
				if (hero === null) return;
				switch (heroSelCl) {
					case 0:
						onOpenTitle(hero.title);
						return;
					case 1:
						heroPrimary?.run();
						return;
					case 2:
						void play.sync(hero.disc).then((m) => setHeroMsg(m));
						return;
					case 3:
						// More: the detail screen (the disc's own facts).
						onOpenDetail?.(
							hero.disc,
							heroMulti ? { index: hero.discSlot - 1, count: hero.knownDiscs } : undefined,
						);
						return;
					default:
						onOpenTitle(hero.title); // the disc picker
						return;
				}
			}
			const r = rows[focusRow];
			if (r === undefined) return;
			if (focusSel < 0) {
				if (r.section !== null) onOpenSection(r.section);
				return;
			}
			if (r.kind === 'chips') {
				const chip = r.chips[focusSel];
				if (chip !== undefined) onOpenSection(chip.section);
				return;
			}
			const tile = r.tiles[focusSel];
			if (tile === undefined) return;
			if (tile.title !== undefined) onOpenTitle(tile.title);
			else if (tile.section !== undefined) onOpenSection(tile.section);
		},
		[rows, focusRow, focusSel, heroSelCl, hero, heroPrimary, heroMulti, onOpenTitle, onOpenSection, onOpenDetail],
		open,
	);

	// The section menu (X): a small list of everything on the dashboard —
	// the hero first, then every row that exists.
	const menuItems: Array<{ label: string; detail: string; go: () => void }> = [];
	if (hero !== null) {
		menuItems.push({
			label: 'Featured',
			detail: hero.title.name,
			go: () => {
				setRow(-1);
				setHeroSel(1);
			},
		});
	}
	for (const r of rows) {
		menuItems.push({
			label: r.label,
			detail: r.countLabel,
			go: () => {
				const i = rows.indexOf(r);
				setRow(i);
				setSel(r.section === null || r.kind === 'chips' ? 0 : -1);
			},
		});
	}

	useGamepadButton(
		'X',
		() => {
			setMenuFocus((f) => (f === null ? (menuItems.length > 0 ? 0 : null) : null));
		},
		[menuItems.length],
		!paused,
	);
	useGamepadButton(
		'A',
		() => {
			const item = menuItems[Math.min(Math.max(0, menuFocus ?? 0), menuItems.length - 1)];
			item?.go();
			setMenuFocus(null);
		},
		[menuFocus, menuItems],
		menuOpen && !paused,
	);
	useDirection(
		'Up',
		() => setMenuFocus((f) => Math.max(0, (f ?? 0) - 1)),
		[],
		menuOpen && !paused,
	);
	useDirection(
		'Down',
		() => setMenuFocus((f) => Math.min(menuItems.length - 1, (f ?? 0) + 1)),
		[menuItems.length],
		menuOpen && !paused,
	);
	useGamepadButton('B', onBack, [onBack], !paused && !menuOpen);
	// Inside the menu, B closes it instead of backing out of the screen.
	useGamepadButton(
		'B',
		() => setMenuFocus(null),
		[],
		!paused && menuOpen,
	);

	// Plus: "browse" — a shortcut between the hero and the rows.
	useGamepadButton(
		'Plus',
		() => {
			if (focusRow < 0) {
				setRow(0);
				setSel(-1);
			} else if (hero !== null) {
				setRow(-1);
			}
		},
		[focusRow, rows.length, hero],
		open,
	);

	// ── scrolling ─────────────────────────────────────────────────────────

	// The rows scroll: the view follows the focused row, and a touch drag
	// pans it.
	const [scrollTop, setScrollTop] = useState(0);
	const maxScroll = Math.max(0, rows.length * ROW_H - ROWS_H);

	useEffect(() => {
		setScrollTop((s) => Math.max(0, Math.min(s, maxScroll)));
	}, [maxScroll]);

	// Keep the focused row inside the visible window (the same rule the
	// library grid applies to its focused tile).
	useEffect(() => {
		if (focusRow < 0) return;
		setScrollTop((s) => {
			const top = focusRow * ROW_H;
			const bottom = top + ROW_H;
			if (top < s) return Math.max(0, top);
			if (bottom > s + ROWS_H) return Math.min(maxScroll, bottom - ROWS_H);
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
	const empty = rows.length === 0 && hero === null;
	// The tagline normally; failures and connection progress keep the status
	// line, because losing "Saved library shown — update failed" silently
	// would strand the user.
	const headingInfo = status !== '' && (busy || /fail|cannot|cancel|shown|error/i.test(status));

	const rowTiles: React.ReactNode[] = [];
	const focusRing: React.ReactNode[] = [];

	// Only the rows that intersect the viewport are emitted (the grid's
	// culling rule, applied to section rows).
	const firstRow = Math.max(0, Math.floor(scrollTop / ROW_H));
	const lastRow = Math.min(rows.length - 1, Math.floor((scrollTop + ROWS_H - 1) / ROW_H));

	// How many columns of a row are actually on the screen: a tile past
	// the right edge is never seen, so its cover must not download either
	// (the on-device discipline: fetch only what is displayed — the rows
	// hold up to nine tiles, and a narrow viewport can show fewer). The
	// focused tile is always enabled, so a half-clipped focus target still
	// gets its artwork.
	const maxCol = Math.ceil((dims.width - TILE_X0 + 1) / PITCH_X);

	rows.forEach((r: DisplayRow, i) => {
		if (i < firstRow || i > lastRow) return;
		const rowY = ROWS_Y + i * ROW_H - scrollTop;
		const rowFocused = i === focusRow && open;

		// The header: the row's name and its count, above the covers.
		// It is the row's focus target: left from the first cover lands
		// on it, and A opens the row (chips rows focus their chips).
		//
		// `textBaseline="alphabetic"`: react-tela defaults to "top", which
		// anchors the *line box* — its height depends on the font, and the
		// device font's ascent is tall enough to push the glyphs into the
		// covers below. Baseline anchoring is font-stable, so the same
		// layout holds on the box and in the preview.
		const labelW = measure(ctx, r.label, 16);
		const countW = measure(ctx, r.countLabel, 11);
		rowTiles.push(
			<Text
				key={`${r.id}-label`}
				x={MARGIN_X}
				y={rowY + 18}
				fontFamily={fontFamily}
				fontSize={16}
				textBaseline="alphabetic"
				fill={rowFocused && focusSel < 0 ? colors.textPrimary : colors.textSecondary}
			>
				{r.label}
			</Text>,
			<Text
				key={`${r.id}-count`}
				x={MARGIN_X + labelW + 10}
				y={rowY + 18}
				fontFamily={fontFamily}
				fontSize={11}
				textBaseline="alphabetic"
				fill={colors.textFaint}
			>
				{r.countLabel}
			</Text>,
		);

		if (r.kind === 'chips') {
			rowTiles.push(
				<PlatformChipStrip
					key={`${r.id}-chips`}
					chips={r.chips}
					y={rowY + 26}
					focusSel={focusSel}
					focused={rowFocused}
				/>,
			);
			return;
		}

		rowTiles.push(<TileRow key={`${r.id}-tiles`} row={r} y={rowY} focused={rowFocused} focusSel={focusSel} maxCol={maxCol} />);

		// The focus ring: exactly one, around the header or the focused
		// cover. It is drawn above the masking bands, so it is pushed onto
		// its own array (the tiles must not).
		if (rowFocused && focusSel < 0) {
			focusRing.push(
				<Rect
					key={`ring-${r.id}-label`}
					x={MARGIN_X - 8}
					y={rowY + 2}
					width={labelW + countW + 34}
					height={30}
					stroke={colors.accent}
					lineWidth={3}
					borderRadius={radius.lg}
				/>,
			);
		} else if (rowFocused) {
			const t = r.tiles[focusSel];
			if (t !== undefined) {
				focusRing.push(
					<Rect
						key={`ring-${r.id}-${t.key}`}
						x={TILE_X0 + focusSel * PITCH_X - 5}
						y={rowY + 26 - 5}
						width={COVER_W + 10}
						height={COVER_H + 10}
						stroke={colors.accent}
						lineWidth={3}
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
			 * (the grid's trick). The hero and the chrome are drawn on top.
			 */}
			<Rect x={0} y={0} width={dims.width} height={ROWS_Y} fill={colors.bg} />
			<Rect
				x={0}
				y={ROWS_Y + ROWS_H}
				width={dims.width}
				height={Math.max(0, dims.height - ROWS_Y - ROWS_H)}
				fill={colors.bg}
			/>

			{focusRing}

			{/* ── the hero (fixed, above the masked rows) ────────────── */}
			{hero !== null && (
				<>
					<HeroCard
						hero={hero}
						state={heroState}
						primary={heroPrimary}
						focused={focusRow < 0 && !paused && !menuOpen}
						sel={heroSelCl}
						multiDisc={heroMulti}
					/>
					<InstallPanel
						hero={hero}
						state={heroState}
						msg={heroMsg}
						pagerFocused={focusRow < 0 && !paused && !menuOpen && heroSelCl === HERO_PAGER}
					/>
				</>
			)}

			<DashboardHeader
				meta={meta}
				build={BUILD_ID}
				subtitle={demo ? 'DEMO MODE — MOCKED DATA' : headingInfo ? status : ''}
				error={!demo && headingInfo && /fail|cannot|shown/i.test(status)}
				onSettings={onBack}
			/>

			{empty && (
				<>
					{busy && <Spinner x={dims.width / 2} y={ROWS_Y + 120} active />}
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
						centerY={ROWS_Y + 170}
					/>
				</>
			)}

			<HintBarBackdrop />
			{menuOpen ? <HintBar hints={['A jump', 'B close']} /> : <HintBar hints={['A select', 'B back', 'X sections', '+ browse']} />}

			{/* ── the section menu (X) ─────────────────────────────────── */}
			{menuOpen && <SectionMenu items={menuItems} focus={menuFocus ?? 0} />}
		</>
	);
}
