/**
 * The multi-disc chooser.
 *
 * A title with more than one disc does not open its detail screen directly:
 * the player picks which disc to play first. The picker lists every known
 * disc (in the server's disc order), marks the release's main disc, and
 * hands the chosen index back to the library, which remembers it.
 */
import React, { useState } from 'react';
import { Rect, Text, useDimensions, useParent } from 'react-tela';
import { colors, fontFamily, fontSize, radius } from '../theme';
import { truncate } from '../text';
import { useGamepadButton, useDirection } from '../hooks/use-gamepad';
import { Header } from './Header';
import { HintBar } from './HintBar';
import { BUILD_ID } from '../version';
import type { RommTitle } from '../romm';

interface Props {
	/** The title whose disc is being chosen. */
	title: RommTitle;
	/** The disc index the player starts on (0-based). */
	initial: number;
	/** A disc was chosen: the index into `title.discs`. */
	onPick: (index: number) => void;
	/** The player backed out; the previous selection stands. */
	onClose: () => void;
}

/** Panel geometry. */
const PANEL_W = 680;
const ROW_H = 58;
/** How many rows fit in the panel before it scrolls. */
const MAX_ROWS = 8;

export function DiscPicker({ title, initial, onPick, onClose }: Props) {
	const dims = useDimensions();
	const { ctx } = useParent();

	const count = title.discs.length;
	const [focus, setFocus] = useState(Math.min(Math.max(0, initial), Math.max(0, count - 1)));
	/** First row visible (the list scrolls when it exceeds the panel). */
	const [view, setView] = useState(0);

	// Keep the focused row inside the visible window.
	useDirection(
		'Up',
		() => {
			setFocus((f) => {
				const nf = Math.max(0, f - 1);
				setView((v) => Math.min(v, Math.max(0, nf - (MAX_ROWS - 1))));
				return nf;
			});
		},
		[],
	);
	useDirection(
		'Down',
		() => {
			setFocus((f) => {
				const nf = Math.min(Math.max(0, count - 1), f + 1);
				setView((v) => Math.min(v, Math.max(0, nf - MAX_ROWS + 1)));
				return nf;
			});
		},
		[count],
	);
	useGamepadButton(
		'A',
		() => onPick(focus),
		[focus, onPick],
	);
	useGamepadButton('B', onClose, [onClose]);

	const panelH = 84 + Math.min(count, MAX_ROWS) * ROW_H + 24;
	const panelX = (dims.width - PANEL_W) / 2;
	const panelY = (dims.height - panelH) / 2 - 12;
	const visibleRows = Math.min(count, MAX_ROWS);
	const name = truncate(ctx, title.name, PANEL_W - 80, fontSize.title);

	return (
		<>
			{/* Opaque backdrop: the grid behind must not compete for input. */}
			<Rect width={dims.width} height={dims.height} fill={colors.bg} />

			<Header title={name} subtitle={`${title.knownDiscs} discs`} build={BUILD_ID} />

			<Rect
				x={panelX}
				y={panelY}
				width={PANEL_W}
				height={panelH}
				fill={colors.surface}
				stroke={colors.borderStrong}
				lineWidth={1}
				borderRadius={radius.xl}
			/>
			<Text
				x={panelX + 32}
				y={panelY + 20}
				fontFamily={fontFamily}
				fontSize={fontSize.heading}
				fill={colors.textPrimary}
			>
				Which disc do you want to play?
			</Text>

			{title.discs.map((disc, i) => {
				if (i < view || i >= view + visibleRows) return null;
				const rowY = panelY + 84 + (i - view) * ROW_H;
				const isFocus = i === focus;
				const label = disc.name || disc.fsName || `Disc ${i + 1}`;
				const isMain = i === title.mainIndex;
				return (
					<React.Fragment key={disc.id || i}>
						{isFocus && (
							<Rect
								x={panelX + 12}
								y={rowY}
								width={PANEL_W - 24}
								height={ROW_H - 8}
								fill={colors.accentMuted}
								borderRadius={radius.md}
							/>
						)}
						<Text
							x={panelX + 28}
							y={rowY + 8}
							fontFamily={fontFamily}
							fontSize={fontSize.small}
							fill={isFocus ? colors.accent : colors.textFaint}
						>
							{/* The release's disc number (a partial walk still
						    counts the whole release), not the row's position. */}
						{`Disc ${title.discReleaseSlots[i] ?? i + 1}`}
						</Text>
						<Text
							x={panelX + 120}
							y={rowY + 6}
							fontFamily={fontFamily}
							fontSize={fontSize.label}
							fill={isFocus ? colors.textPrimary : colors.textSecondary}
							maxWidth={PANEL_W - 320}
							overflow="ellipsis"
						>
							{label}
						</Text>
						{isMain && (
							<Text
								x={panelX + PANEL_W - 120}
								y={rowY + 8}
								fontFamily={fontFamily}
								fontSize={fontSize.tiny}
								fill={colors.textFaint}
								textAlign="right"
							>
								{'default'}
							</Text>
						)}
					</React.Fragment>
				);
			})}

			<HintBar hints={['A play', 'B back', '↑↓ disc']} />
		</>
	);
}
