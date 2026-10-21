import React, { useEffect, useRef, useState } from 'react';
import { Group, Image, Rect, Text, useDimensions } from 'react-tela';
import { useDirection, useGamepadButton } from '../hooks/use-gamepad';
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
}

export function LibraryGrid({ games, status, onBack }: Props) {
	const dims = useDimensions();
	const [focus, setFocus] = useState(0);
	const [scrollTop, setScrollTop] = useState(0);
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

	const tiles = games.map((g, i) => {
		const x = GRID_X + (i % COLS) * (COVER_W + GAP_X);
		const y = Math.floor(i / COLS) * TILE_H;
		const isFocused = i === focus;
		return (
			<Group key={g.id || `rom-${i}`} x={x} y={y} width={COVER_W} height={TILE_H}>
				<Rect width={COVER_W} height={COVER_H} fill="#1c1c2a" borderRadius={8} />
				{g.coverUrl !== '' && <Image src={g.coverUrl} width={COVER_W} height={COVER_H} />}
				<Text
					x={10}
					y={COVER_H + 10}
					maxWidth={COVER_W - 20}
					fontSize={20}
					lineHeight={1.15}
					fill={isFocused ? '#ffffff' : '#9a9ab0'}
					overflow="ellipsis"
				>
					{g.name || `Game #${g.id}`}
				</Text>
				{isFocused && (
					<Rect
						x={-6}
						y={-6}
						width={COVER_W + 12}
						height={TILE_H + 12}
						stroke="#5b8cff"
						lineWidth={4}
						borderRadius={12}
					/>
				)}
			</Group>
		);
	});

	return (
		<>
			<Rect width={dims.width} height={dims.height} fill="#101018" />

			<Text x={24} y={28} fontSize={42} fill="#ffffff">
				RomMmate
			</Text>
			<Text x={dims.width} y={40} fontSize={24} fill="#9a9ab0" textAlign="right">
				{`${games.length} games`}
			</Text>
			<Text x={24} y={80} fontSize={20} fill="#6a6a85">
				{status}
			</Text>

			<Group
				x={VIEW_X}
				y={VIEW_Y}
				width={VIEW_W}
				height={VIEW_H}
				contentWidth={VIEW_W}
				contentHeight={contentH}
				scrollTop={scrollTop}
				onTouchMove={(e) => {
					const t = e.changedTouches[0];
					if (lastTouch.current) {
						const dy = lastTouch.current.y - t.clientY;
						setScrollTop((s) => Math.min(maxScroll, Math.max(0, s + dy)));
					}
					lastTouch.current = { x: t.clientX, y: t.clientY };
				}}
				onTouchEnd={() => {
					lastTouch.current = null;
				}}
			>
				{tiles}
			</Group>

			<Text x={dims.width / 2} y={dims.height - 52} fontSize={22} fill={selected !== '' ? '#c8c8e0' : '#6a6a85'} textAlign="center">
				{selected !== '' ? `Selected: ${selected}` : 'A select · B back · stick or d-pad to move · drag to scroll'}
			</Text>
		</>
	);
}
