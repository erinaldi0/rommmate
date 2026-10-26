/**
 * The library screen: a filter bar on top, a grid of covers below.
 *
 * Two focus zones share the screen. The grid is the default; the filter bar
 * is reached by pressing Up from the top row (and left again with Down), so
 * the vertical stack of the screen doubles as its navigation order.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Rect, useDimensions } from 'react-tela';
import { SwkbdType } from '@nx.js/constants';
import { useDirection, useGamepadButton } from '../hooks/use-gamepad';
import { useDragScroll } from '../hooks/use-drag-scroll';
import { getVirtualKeyboard } from '../vk';
import { prefetchCovers, type CoverRequest } from '../covers';
import { BUILD_ID } from '../version';
import { colors, radius } from '../theme';
import { followScroll } from '../lib/focus-nav';
import { saveFocus, takeFocus } from '../lib/focus-memory';
import { CoverTile, TITLE_BLOCK_H } from './CoverTile';
import { FocusRing } from './ui';
import { FilterBar } from './FilterBar';
import {
	SEARCH_KEY,
	activeChipIndex,
	buildFilterChips,
	filterTitles,
	shownDisc,
	type FilterChip,
} from '../lib/library-filters';
import { Header } from './Header';
import { HintBar, HintBarBackdrop } from './HintBar';
import { EmptyState } from './EmptyState';
import { Spinner } from './Spinner';
import { groupTitles, type RommGame, type RommTitle } from '../romm';

const COLS = 5;
const COVER_W = 216;
const COVER_H = 288; // 3:4 cover art
const GAP_X = 24;
/** Cover + title block + the gap below it. */
const TILE_H = COVER_H + TITLE_BLOCK_H + 20;

/** Where the scrolling grid starts and ends. */
const VIEW_Y = 140;
const VIEW_H = 508;

type Zone = 'grid' | 'filter';

interface Props {
	games: RommGame[];
	/** Status line from the client (load result, etc.). */
	status: string;
	/** True when the games are mocked rather than fetched from RomM. */
	demo?: boolean;
	/** True while the connection (and its background walk) is in flight. */
	busy?: boolean;
	/** Header title (the section's name when opened from the dashboard). */
	title?: string;
	/** Heading of the loading state (the connect message by default). */
	busyTitle?: string;
	/** Per-title disc selection (title key → disc index). */
	discSelections?: Record<number, number>;
	/** The focused title has several discs: ask which one to play. */
	onPickDisc?: (title: RommTitle) => void;
	onBack: () => void;
	/** Open the detail screen for a game. */
	onOpen: (game: RommGame) => void;
	/** True while another screen owns the input (the detail overlay). */
	paused?: boolean;
	/**
	 * The key this screen's position is remembered under (App passes the
	 * section key, the same one that remounts the screen — see
	 * `lib/focus-memory`). Omitted, the screen starts fresh (the preview
	 * harness, which drives deterministic states).
	 */
	focusKey?: string;
	/** Initial scroll offset (preview harness only; defaults to the top). */
	initialScroll?: number;
	/** Initially focused tile index (preview harness only). */
	initialFocus?: number;
	/** Initially focused zone (preview harness only). */
	initialZone?: Zone;
	/** Initial search query (preview harness only). */
	initialQuery?: string;
	/** Initial platform filter (preview harness only). */
	initialPlatform?: string;
}

const NO_SELECTIONS: Record<number, number> = {};

export function LibraryGrid({
	games,
	status,
	demo = false,
	busy = false,
	title = 'RomMmate',
	busyTitle = 'Connecting to RomM…',
	discSelections = NO_SELECTIONS,
	onPickDisc,
	onBack,
	onOpen,
	paused = false,
	focusKey,
	initialScroll = 0,
	initialFocus = 0,
	initialZone = 'grid',
	initialQuery = '',
	initialPlatform = '',
}: Props) {
	const dims = useDimensions();

	// Where the player left this section (see `lib/focus-memory`): a
	// full-screen route (downloads) can unmount the screen, and the
	// remount used to reset it to the top tile. The section's search and
	// chips still start clean — the key remount belongs to them — only
	// the position (focus, zone, scroll) comes back, and every index is
	// re-clamped against the list that is actually on screen now.
	const remembered =
		focusKey !== undefined
			? takeFocus(focusKey, { focus: initialFocus, zone: initialZone, scroll: initialScroll })
			: null;

	const [zone, setZone] = useState<Zone>(remembered === null ? initialZone : remembered.zone === 'filter' ? 'filter' : 'grid');
	const [focus, setFocus] = useState(remembered === null ? initialFocus : remembered.focus);
	const [chip, setChip] = useState(0);
	const [platform, setPlatform] = useState(initialPlatform);
	const [query, setQuery] = useState(initialQuery);
	const [scrollTop, setScrollTop] = useState(remembered === null ? initialScroll : remembered.scroll);
	/** The latest position, for the unmount save (the ref outlives the state). */
	const navRef = useRef({ focus, zone, scroll: scrollTop });
	navRef.current = { focus, zone, scroll: scrollTop };
	useEffect(
		() => () => {
			if (focusKey !== undefined) saveFocus(focusKey, navRef.current);
		},
		[focusKey],
	);

	// ── filtering ──────────────────────────────────────────────────────────
	// The rules (what the search matches, how the chips count, which chip
	// is active) live in lib/library-filters; the screen applies the results.

	const needle = query.trim().toLowerCase();

	// The grid is browsed per release: every disc of one game groups into a
	// single title (a multi-disc badge marks them), so the filters work on
	// titles, not raw roms.
	const allTitles = useMemo(() => groupTitles(games), [games]);

	const visible = useMemo(() => filterTitles(allTitles, query, platform), [allTitles, query, platform]);

	const chips = useMemo(() => buildFilterChips(allTitles, query, platform), [allTitles, query, platform]);

	/** The chip that should own the focus when the bar is entered. */
	const activeChip = useMemo(() => activeChipIndex(chips), [chips]);

	// ── layout ────────────────────────────────────────────────────────────

	const gridW = COLS * COVER_W + (COLS - 1) * GAP_X;
	const gridX = (dims.width - gridW) / 2;

	const rows = Math.max(1, Math.ceil(visible.length / COLS));
	const contentH = rows * TILE_H;
	const maxScroll = Math.max(0, contentH - VIEW_H);

	/*
	 * Lazy artwork: the rows around the viewport prefetch their covers, so
	 * the artwork is usually ready by the time the row scrolls into view.
	 * The buffer is one row above and two below, because scrolling is
	 * mostly downward; anything else is picked up by the tile's own
	 * CoverImage when it mounts. The artwork the detail screen would show
	 * for the focused tile is warmed too, so pressing A does not add a
	 * third network round trip.
	 */
	useEffect(() => {
		const first = Math.max(0, Math.floor(scrollTop / TILE_H) - 1);
		const last = Math.min(rows - 1, Math.floor((scrollTop + VIEW_H - 1) / TILE_H) + 2);
		// Each request carries the box its artwork is drawn into: the
		// cover pipeline resolves the display-sized copy for that box (see
		// covers.ts), so the prefetch must name it.
		const requests: CoverRequest[] = [];
		for (let r = first; r <= last; r++) {
			for (let c = 0; c < COLS; c++) {
				const t = visible[r * COLS + c];
				if (t === undefined) continue;
				const url = shownDisc(t, discSelections).coverUrl;
				if (url !== '') requests.push({ url, width: COVER_W, height: COVER_H });
			}
		}
		const focused = visible[focus];
		if (focused !== undefined) {
			const url = shownDisc(focused, discSelections).screenshotUrl;
			if (url !== '') requests.push({ url, width: 320, height: 180 });
		}
		prefetchCovers(requests);
	}, [scrollTop, rows, visible, focus, discSelections]);

	// Keep the focused tile inside the visible window — the shared
	// follow-scroll rule (the same maths the dashboard applies to its
	// focused row: scroll exactly when the target is out of view).
	useEffect(() => {
		setScrollTop((current) =>
			followScroll(Math.floor(focus / COLS) * TILE_H, TILE_H, VIEW_H, current, maxScroll),
		);
	}, [focus, visible.length, maxScroll]);

	// The filter can shrink the list under the focused tile.
	useEffect(() => {
		setFocus((f) => Math.min(Math.max(0, visible.length - 1), f));
	}, [visible.length]);

	useEffect(() => {
		setScrollTop((s) => Math.max(0, Math.min(s, maxScroll)));
	}, [maxScroll]);

	useEffect(() => {
		setChip((c) => Math.min(Math.max(0, chips.length - 1), c));
	}, [chips.length]);

	// ── search keyboard ───────────────────────────────────────────────────

	/** The query in flight, or null when no search is open. */
	const pendingSearch = useRef<string | null>(null);

	const openSearch = useCallback(() => {
		const vk = getVirtualKeyboard();
		if (!vk) return;
		pendingSearch.current = query;
		vk.type = SwkbdType.Normal;
		vk.okButtonText = 'Search';
		vk.value = query;
		vk.show();
	}, [query]);

	useEffect(() => {
		const vk = getVirtualKeyboard();
		if (!vk) return;

		// The query is only applied when the keyboard is confirmed, so a
		// cancelled search leaves the library exactly as it was.
		const commit = () => {
			if (pendingSearch.current === null) return;
			pendingSearch.current = null;
			setQuery(vk.value.trim());
			setChip(0);
			setZone('filter');
		};
		const cancel = () => {
			pendingSearch.current = null;
		};
		const onGeometry = () => {
			if (vk.boundingRect.height === 0) commit();
		};

		vk.addEventListener('submit', commit);
		vk.addEventListener('cancel', cancel);
		vk.addEventListener('geometrychange', onGeometry);
		return () => {
			vk.removeEventListener('submit', commit);
			vk.removeEventListener('cancel', cancel);
			vk.removeEventListener('geometrychange', onGeometry);
		};
	}, []);

	const applyChip = useCallback(
		(item: FilterChip | undefined) => {
			if (!item) return;
			if (item.key === SEARCH_KEY) {
				openSearch();
				return;
			}
			// Platform chips switch between platforms; there is no "All"
			// chip — the library is never shown whole (the dashboard's
			// sections are the only ways in, and each one scopes its grid).
			setPlatform(item.key);
		},
		[openSearch],
	);

	// ── input ─────────────────────────────────────────────────────────────

	/*
	 * The directions are registered in both zones and decide for themselves
	 * what they mean: the grid and the filter bar share the same four
	 * directions, and a direction that is dead in one of them is a trap.
	 *
	 * They deliberately have NO auto-repeat: one press is exactly one step
	 * (one tile / one row). A held button used to repeat 10 times a second
	 * and blew through the whole library while still held — and the only
	 * way to land on a single tile was to tap faster than the repeat
	 * delay. (The keyboard cursor keeps its repeat: there, holding is how
	 * you type.)
	 */
	const gridFocused = !paused && zone === 'grid';

	useDirection(
		'Up',
		() => {
			if (zone === 'filter') return; // already at the top of the screen
			if (focus < COLS) {
				// Top row: hand the focus over to the filter bar.
				setZone('filter');
				setChip(activeChip);
				return;
			}
			setFocus(focus - COLS);
		},
		[zone, focus, activeChip],
		!paused,
	);

	useDirection(
		'Down',
		() => {
			if (zone === 'filter') {
				// Back to the grid, on the row the filter bar was left from.
				setZone('grid');
				return;
			}
			setFocus(Math.min(Math.max(0, visible.length - 1), focus + COLS));
		},
		[zone, focus, visible.length],
		!paused,
	);

	useDirection(
		'Left',
		() => {
			if (zone === 'filter') {
				setChip((c) => Math.max(0, c - 1));
				return;
			}
			setFocus(Math.max(0, focus - 1));
		},
		[zone, focus],
		!paused,
	);

	useDirection(
		'Right',
		() => {
			if (zone === 'filter') {
				setChip((c) => Math.min(chips.length - 1, c + 1));
				return;
			}
			setFocus(Math.min(Math.max(0, visible.length - 1), focus + 1));
		},
		[zone, focus, visible.length, chips.length],
		!paused,
	);

	useGamepadButton(
		'A',
		() => {
			if (zone === 'grid') {
				const t = visible[focus];
				if (t === undefined) return;
				// A multi-disc release chooses its disc before showing the
				// detail; a single-disc one goes straight to it.
				if (t.discs.length > 1 && onPickDisc !== undefined) {
					onPickDisc(t);
					return;
				}
				onOpen(shownDisc(t, discSelections));
			} else {
				applyChip(chips[chip]);
			}
		},
		[zone, focus, visible, chips, chip, discSelections, onOpen, onPickDisc, applyChip],
		!paused,
	);

	useGamepadButton(
		'B',
		() => {
			// B is "one level back": the filter bar returns to the grid, the
			// grid returns to the settings screen.
			if (zone === 'filter') setZone('grid');
			else onBack();
		},
		[zone, onBack],
		!paused,
	);

	useGamepadButton('Y', openSearch, [openSearch], !paused);

	// Touch: drag to scroll.
	const onDrag = useCallback(
		(dy: number) => {
			setScrollTop((s) => Math.max(0, Math.min(s + dy, maxScroll)));
		},
		[maxScroll],
	);
	useDragScroll(gridFocused, onDrag);

	// ── rendering ─────────────────────────────────────────────────────────

	// Only the rows that intersect the viewport are emitted. react-tela's
	// <Group> viewport (offscreen canvas + drawImage) is avoided for the same
	// reason as on the settings screen: culling gives the same result without
	// any offscreen compositing.
	const firstRow = Math.max(0, Math.floor(scrollTop / TILE_H));
	const lastRow = Math.min(rows - 1, Math.floor((scrollTop + VIEW_H - 1) / TILE_H));

	const tiles: React.ReactNode[] = [];
	visible.forEach((t, i) => {
		const row = Math.floor(i / COLS);
		if (row < firstRow || row > lastRow) return;

		const x = gridX + (i % COLS) * (COVER_W + GAP_X);
		const y = VIEW_Y + row * TILE_H - scrollTop;

		const disc = shownDisc(t, discSelections);
		const multi = t.discs.length > 1;
		// The badge mirrors the disc actually on screen (clamped, like
		// `shownDisc` does).
		const discIndex = Math.min(Math.max(0, discSelections[t.key] ?? t.mainIndex), t.discs.length - 1) + 1;

		tiles.push(
			<CoverTile
				key={String(t.key)}
				game={disc}
				x={x}
				y={y}
				width={COVER_W}
				height={COVER_H}
				focused={i === focus && gridFocused}
				nameOverride={t.name}
				discIndex={multi ? discIndex : undefined}
				discCount={multi ? t.discs.length : undefined}
			/>,
		);
	});

	/*
	 * The focus ring is drawn after the masking bands, so a half-scrolled
	 * tile keeps its full outline. It is the one shared `FocusRing` (with
	 * its glow — the screens gate the glow to the single focused target),
	 * the same ring a dashboard cover wears, so focus reads identically on
	 * both screens.
	 *
	 * It is also gated on the zone: while the filter bar owns the focus,
	 * the grid does not keep a second ring on the tile A would *not*
	 * act on — one focus indicator on screen at a time (the same rule
	 * the dashboard applies when its section menu opens).
	 */
	const focusTile = visible[focus];
	let focusRing: React.ReactNode = null;
	if (focusTile !== undefined && gridFocused) {
		const row = Math.floor(focus / COLS);
		const x = gridX + (focus % COLS) * (COVER_W + GAP_X);
		const y = VIEW_Y + row * TILE_H - scrollTop;
		focusRing = <FocusRing x={x} y={y} width={COVER_W} height={COVER_H} radius={radius.md} glow />;
	}

	const hints =
		zone === 'grid'
			? ['A open', 'B back', 'Y search', '↑ filters']
			: ['A apply', 'B back', '←→ chip', '↓ games', 'Y search'];

	/*
	 * The summary owns the right end of the filter bar, so the active
	 * query is part of it: a separate marker would collide with the
	 * chips, and the bar is dimmed while the grid has the focus.
	 */
	const summary =
		needle === ''
			? `${visible.length} of ${allTitles.length} games`
			: `"${query.trim()}" · ${visible.length} of ${allTitles.length}`;

	return (
		<>
			<Rect width={dims.width} height={dims.height} fill={colors.bg} />

			{tiles}

			{/*
			 * Two opaque bands mask the rows that overflow the viewport.
			 * The chrome is drawn on top of them.
			 */}
			<Rect x={0} y={0} width={dims.width} height={VIEW_Y} fill={colors.bg} />
			<Rect
				x={0}
				y={VIEW_Y + VIEW_H}
				width={dims.width}
				height={Math.max(0, dims.height - VIEW_Y - VIEW_H)}
				fill={colors.bg}
			/>

			{focusRing}

			<Header
				title={title}
				subtitle={status}
				meta={`${allTitles.length} games`}
				badge={demo ? 'DEMO' : ''}
				build={BUILD_ID}
			/>

			<FilterBar
				items={chips}
				focusedIndex={chip}
				focused={zone === 'filter' && !paused}
				summary={summary}
			/>

			{visible.length === 0 && (
				<>
					{/* While the connection is in flight the "empty" grid is a
					 * loading state, not an empty library. */}
					{busy && (
						<Spinner x={dims.width / 2} y={VIEW_Y + VIEW_H / 2 - 78} active />
					)}
					<EmptyState
						glyph={busy ? '' : '∅'}
						title={
							busy
								? busyTitle
								: games.length === 0
									? 'Your library is empty'
									: 'No games match'
						}
						detail={
							busy
								? status !== '' && status !== 'Connecting…'
									? status
									: 'Loading your library'
								: games.length === 0
									? 'Once RomM has roms in it, they will show up here.'
									: 'Try another platform, or clear the search.'
						}
						centerY={VIEW_Y + VIEW_H / 2}
					/>
				</>
			)}

			<HintBarBackdrop />
			<HintBar hints={hints} />
		</>
	);
}
