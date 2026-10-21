import React, { useEffect, useRef, useState } from 'react';
import { Image, Rect, Text, useDimensions } from 'react-tela';
import { useDirection, useGamepadButton } from '../hooks/use-gamepad';
import { BUILD_ID } from '../version';
import type { RommGame } from '../romm';

const COLS = 4;
const COVER_W = 260;
const COVER_H = 347; // 3:4 cover art
const TILE_H = 400; // cover + title line + row spacing
const GAP_X = 24;

const VIEW_W = 1280;
const VIEW_X = 0;
const VIEW_Y = 110;
const VIEW_H = 520;

const GRID_W = COLS * COVER_W + (COLS - 1) * GAP_X; // 1112
const GRID_X = (VIEW_W - GRID_W) / 2; // 84

interface Props {
	games: RommGame[];
	/** Status line from the client (load result, etc.). */
	status: string;
	onBack: () => void;
	/** Initial scroll offset (preview harness only; defaults to the top). */
	initialScroll?: number;
	/** Initially focused tile index (preview harness only). */
	initialFocus?: number;
}

export function LibraryGrid({
	games,
	status,
	onBack,
	initialScroll = 0,
	initialFocus = 0,
}: Props) {
	const dims = useDimensions();
	const [focus, setFocus] = useState(initialFocus);
	const [scrollTop, setScrollTop] = useState(initialScroll);
	const [selected, setSelected] = useState('');

	const rows = Math.max(1, Math.ceil(games.length / COLS));
	const contentH = rows * TILE_H;
	const maxScroll = Math.max(0, contentH - VIEW_H);

	// Keep the focused tile inside the visible window.
	useEffect(() => {
		const rowTop = Math.floor(focus / COLS) * TILE_H;
		const rowBottom = rowTop + TILE_H;
		if (rowTop < scrollTop) setScrollTop(rowTop);
		else if (rowBottom > scrollTop + VIEW_H) setScrollTop(rowBottom - VIEW_H);
	}, [focus, contentH, scrollTop]);

	// Grid navigation (d-pad and stick, with auto-repeat for long grids).
	useDirection('Up', () => setFocus((f) => Math.max(0, f - COLS)), [], true, true);
	useDirection(
		'Down',
		() => setFocus((f) => Math.min(Math.max(0, games.length - 1), f + COLS)),
		[games.length],
		true,
		true,
	);
	useDirection('Left', () => setFocus((f) => Math.max(0, f - 1)), [], true, true);
	useDirection(
		'Right',
		() => setFocus((f) => Math.min(Math.max(0, games.length - 1), f + 1)),
		[games.length],
		true,
		true,
	);

	// A: select (v0.2 announces the choice; the detail screen comes next).
	useGamepadButton(
		'A',
		() => {
			const g = games[focus];
			if (g) setSelected(g.name || `Game #${g.id}`);
		},
		[focus, games],
	);
	useGamepadButton('B', onBack, [onBack]);

	// Touch: drag to scroll.
	const lastTouch = useRef<{ x: number; y: number } | null>(null);

	// Only the rows that intersect the viewport are emitted. react-tela's
	// <Group> viewport (offscreen canvas + drawImage) is avoided for the same
	// reason as on the settings screen: culling gives the same result without
	// any offscreen compositing.
	const firstRow = Math.max(0, Math.floor(scrollTop / TILE_H));
	const lastRow = Math.min(rows - 1, Math.floor((scrollTop + VIEW_H - 1) / TILE_H));

	const tiles: React.ReactNode[] = [];
	games.forEach((g, i) => {
		const row = Math.floor(i / COLS);
		if (row < firstRow || row > lastRow) return;

		const x = GRID_X + (i % COLS) * (COVER_W + GAP_X);
		const y = VIEW_Y + row * TILE_H - scrollTop;
		const isFocused = i === focus;
		const key = g.id || `rom-${i}`;

		tiles.push(
			<Rect
				key={`${key}-bg`}
				x={x}
				y={y}
				width={COVER_W}
				height={COVER_H}
				fill="#1c1c2a"
				borderRadius={8}
			/>,
		);
		if (g.coverUrl !== '') {
			tiles.push(
				<Image
					key={`${key}-cover`}
					src={g.coverUrl}
					x={x}
					y={y}
					width={COVER_W}
					height={COVER_H}
				/>,
			);
		}
		tiles.push(
			<Text
				key={`${key}-title`}
				x={x + 10}
				y={y + COVER_H + 10}
				maxWidth={COVER_W - 20}
				fontSize={20}
				lineHeight={1.15}
				fill={isFocused ? '#ffffff' : '#9a9ab0'}
				overflow="ellipsis"
			>
				{g.name || `Game #${g.id}`}
			</Text>,
		);
		if (isFocused) {
			tiles.push(
				<Rect
					key={`${key}-focus`}
					x={x - 6}
					y={y - 6}
					width={COVER_W + 12}
					height={COVER_H + 12}
					stroke="#5b8cff"
					lineWidth={4}
					borderRadius={12}
				/>,
			);
		}
	});

	return (
		<>
			<Rect width={dims.width} height={dims.height} fill="#101018" />

			{tiles}

			{/*
			 * The old <Group> viewport clipped the tiles; without it the
			 * partially visible top/bottom rows bleed into the header and the
			 * footer. Two opaque bands mask the overflow, and the chrome is
			 * drawn on top of them.
			 */}
			<Rect x={0} y={0} width={dims.width} height={VIEW_Y} fill="#101018" />
			<Rect
				x={0}
				y={VIEW_Y + VIEW_H}
				width={dims.width}
				height={Math.max(0, dims.height - VIEW_Y - VIEW_H)}
				fill="#101018"
			/>

			{/* Viewport frame — purely decorative, marks the scroll area. */}
			<Rect
				x={VIEW_X + 8}
				y={VIEW_Y - 6}
				width={VIEW_W - 16}
				height={VIEW_H + 12}
				stroke="#1e1e2c"
				lineWidth={2}
				borderRadius={10}
			/>

			<Text x={24} y={28} fontSize={42} fill="#ffffff">
				RomMmate
			</Text>
			<Text x={dims.width - 24} y={40} fontSize={24} fill="#9a9ab0" textAlign="right">
				{`${games.length} games`}
			</Text>
			<Text x={24} y={80} fontSize={20} fill="#6a6a85">
				{status}
			</Text>
			<Text x={dims.width - 24} y={82} fontSize={16} fill="#4a4a60" textAlign="right">
				{`build ${BUILD_ID}`}
			</Text>

			<Text
				x={dims.width / 2}
				y={dims.height - 52}
				fontSize={22}
				fill={selected !== '' ? '#c8c8e0' : '#6a6a85'}
				textAlign="center"
			>
				{selected !== ''
					? `Selected: ${selected}`
					: 'A select · B back · stick or d-pad to move · drag to scroll'}
			</Text>
		</>
	);
}
