import React, { useEffect, useSyncExternalStore, useState } from 'react';
import { Rect, Text, useDimensions } from 'react-tela';
import { colors, fontFamily, fontSize, radius } from '../theme';
import { useGamepadButton, useDirection } from '../hooks/use-gamepad';
import { windowFollow } from '../lib/focus-nav';
import { Header } from './Header';
import { HintBar } from './HintBar';
import { BUILD_ID } from '../version';
import { downloadQueue, type QueueItemView } from '../roms/download';

interface Props {
	onBack: () => void;
}

const ROW_W = 1000;
const ROW_H = 56;
const ROW_GAP = 10;
const ROW_TOP = 132;

/** Human size, the way the queue paints it. */
function fmtBytes(bytes: number): string {
	if (bytes <= 0) return '';
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * The download queue: everything the Play feature pulls from the server
 * (loader, cores, BIOS, roms), one row per transfer with its progress.
 *
 * The list scrolls: the queue can hold every transfer of a long install
 * session, and the focused row is kept inside the visible window (the
 * same window-follow rule the disc picker uses) — before the window
 * existed, the focus could walk onto rows the screen never rendered.
 */
export function DownloadsScreen({ onBack }: Props) {
	const dims = useDimensions();
	// Arrow wrappers: the queue's methods are `this`-bound, and
	// `useSyncExternalStore` calls them with no receiver.
	const items = useSyncExternalStore(
		(listener) => downloadQueue.subscribe(listener),
		() => downloadQueue.getItems(),
		() => downloadQueue.getItems(),
	);
	const [focus, setFocus] = useState(0);
	/** First visible row (the window slides only to keep the focus visible). */
	const [view, setView] = useState(0);
	const cx = dims.width / 2;
	const rowX = cx - ROW_W / 2;

	// How many rows fit between the header and the hint bar.
	const visibleRows = Math.max(1, Math.floor((dims.height - 90 - ROW_TOP) / (ROW_H + ROW_GAP)));

	// The queue changes under the focus (transfers finish; A dismisses a
	// row), so every move starts from the clamped, displayed position —
	// the raw index can never point past the end of the list.
	const focusClamped = items.length > 0 ? Math.min(focus, items.length - 1) : 0;

	/**
	 * Move the focus by one row, following with the window exactly when
	 * the target falls outside it. One press is one row: the directions
	 * deliberately have no auto-repeat.
	 */
	const moveFocus = (delta: number) => {
		const next = Math.min(Math.max(0, focusClamped + delta), Math.max(0, items.length - 1));
		if (next === focusClamped) return;
		setFocus(next);
		setView((v) => windowFollow(next, Math.min(items.length, visibleRows), v));
	};
	useDirection('Up', () => moveFocus(-1), [focusClamped, items.length], items.length > 0);
	useDirection('Down', () => moveFocus(1), [focusClamped, items.length], items.length > 0);
	// The list can also change without a move (a row dismissed by its
	// transfer settling, in a future queue semantics): re-run the window
	// rule so the focused row stays visible however the list moved.
	useEffect(() => {
		setView((v) => windowFollow(focusClamped, Math.min(items.length, visibleRows), v));
	}, [items.length, focusClamped, visibleRows]);
	useGamepadButton(
		'A',
		() => {
			const item = items[focusClamped];
			if (item !== undefined) downloadQueue.cancel(item.id);
		},
		[items, focusClamped],
		items.length > 0,
	);
	useGamepadButton('B', onBack, [onBack]);

	/** One row's right-hand status text. */
	function statusText(item: QueueItemView): string {
		switch (item.status) {
			case 'queued':
				return 'waiting…';
			case 'running':
				if (item.phase === 'verifying') {
					return item.size > 0
						? `verifying · ${Math.floor(item.progress * 100)}%`
						: `verifying · ${fmtBytes(item.transferred)}`;
				}
				return item.size > 0
					? `${Math.floor(item.progress * 100)}% · ${fmtBytes(item.transferred)} / ${fmtBytes(item.size)}`
					: `${fmtBytes(item.transferred)}`;
			case 'done':
				// The note (a size the server sent that the library entry
				// did not list) rides on the done row, where a bare "done"
				// would paper over it.
				if (item.note !== '') {
					return item.size > 0
						? `done · ${fmtBytes(item.size)} — ${item.note}`
						: `done — ${item.note}`;
				}
				return item.size > 0 ? `done · ${fmtBytes(item.size)}` : 'done';
			case 'error':
				return item.error !== '' ? item.error : 'failed';
			default:
				return 'cancelled';
		}
	}

	const kindLabel: Record<QueueItemView['kind'], string> = {
		emulator: 'emulator',
		core: 'core',
		bios: 'bios',
		rom: 'game',
	};

	// Only the window is rendered; the rows outside it exist in the queue
	// but not on the canvas.
	const shown = items.slice(view, view + visibleRows);

	return (
		<>
			<Rect width={dims.width} height={dims.height} fill={colors.bg} />
			<Header title="Downloads" subtitle={`${items.length} in the queue`} build={BUILD_ID} />

			{items.length === 0 ? (
				<Text x={cx} y={300} fontSize={24} fill={colors.textFaint} textAlign="center">
					Nothing in the queue — use Install on a game's page.
				</Text>
			) : (
				shown.map((item, i) => {
					const idx = view + i;
					const y = ROW_TOP + i * (ROW_H + ROW_GAP);
					const focused = idx === focusClamped;
					return (
						<React.Fragment key={item.id}>
							<Rect
								x={rowX}
								y={y}
								width={ROW_W}
								height={ROW_H}
								fill={focused ? colors.surfaceRaised : colors.surface}
								stroke={focused ? colors.accent : colors.border}
								lineWidth={focused ? 3 : 1}
								borderRadius={radius.md}
							/>
							<Text x={rowX + 20} y={y + 14} fontFamily={fontFamily} fontSize={fontSize.small} fill={colors.accent}>
								{kindLabel[item.kind]}
							</Text>
							<Text
								x={rowX + 110}
								y={y + 12}
								fontFamily={fontFamily}
								fontSize={fontSize.body}
								fill={focused ? colors.textPrimary : colors.textSecondary}
								maxWidth={ROW_W - 430}
								overflow="ellipsis"
							>
								{item.label}
							</Text>
							<Text
								x={rowX + ROW_W - 20}
								y={y + 12}
								fontFamily={fontFamily}
								fontSize={fontSize.small}
								fill={
									item.status === 'error'
										? colors.danger
										: item.status === 'done' && item.note !== ''
											? colors.warning
											: colors.textFaint
								}
								textAlign="right"
								maxWidth={ROW_W - 560}
								overflow="ellipsis"
							>
								{statusText(item)}
							</Text>
							{/* The progress bar under the row, while moving. */}
							{item.status === 'running' && (
								<React.Fragment>
									<Rect
										x={rowX + 110}
										y={y + ROW_H - 18}
										width={ROW_W - 130}
										height={6}
										fill={colors.sunken}
										borderRadius={3}
									/>
									{item.progress > 0 && (
										<Rect
											x={rowX + 110}
											y={y + ROW_H - 18}
											width={Math.max(6, (ROW_W - 130) * item.progress)}
											height={6}
											fill={colors.accent}
											borderRadius={3}
										/>
									)}
								</React.Fragment>
							)}
						</React.Fragment>
					);
				})
			)}

			{/* The hints describe the actions that exist: with an empty
				queue there is nothing for A to dismiss, and the bar says so
				instead of advertising a dead button. */}
			<HintBar hints={items.length === 0 ? ['B back'] : ['A dismiss / cancel', 'B back']} />
		</>
	);
}
