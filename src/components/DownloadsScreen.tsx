import React, { useSyncExternalStore, useState } from 'react';
import { Rect, Text, useDimensions } from 'react-tela';
import { colors, fontFamily, fontSize, radius, space } from '../theme';
import { useGamepadButton, useDirection } from '../hooks/use-gamepad';
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
	const cx = dims.width / 2;
	const rowX = cx - ROW_W / 2;
	const focusClamped = items.length > 0 ? Math.min(focus, items.length - 1) : 0;

	useDirection(
		'Up',
		() => setFocus((f) => Math.max(0, f - 1)),
		[],
		items.length > 0,
	);
	useDirection(
		'Down',
		() => setFocus((f) => Math.min(items.length - 1, f + 1)),
		[items.length],
		items.length > 0,
	);
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
				return item.size > 0
					? `${Math.floor(item.progress * 100)}% · ${fmtBytes(item.transferred)} / ${fmtBytes(item.size)}`
					: `${fmtBytes(item.transferred)}`;
			case 'done':
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

	return (
		<>
			<Rect width={dims.width} height={dims.height} fill={colors.bg} />
			<Header title="Downloads" subtitle={`${items.length} in the queue`} build={BUILD_ID} />

			{items.length === 0 ? (
				<Text x={cx} y={300} fontSize={24} fill={colors.textFaint} textAlign="center">
					Nothing in the queue — use Install on a game's page.
				</Text>
			) : (
				items.map((item, i) => {
					const y = ROW_TOP + i * (ROW_H + ROW_GAP);
					if (y > dims.height - 90) return null; // keep the last rows off-screen
					const focused = i === focusClamped;
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
								fill={item.status === 'error' ? colors.danger : colors.textFaint}
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

			<HintBar hints={['A dismiss / cancel', 'B back']} />
		</>
	);
}
