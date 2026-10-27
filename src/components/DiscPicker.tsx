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
import { windowFollow } from '../lib/focus-nav';
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

/**
 * The tail of a file name that remains once the release name is stripped —
 * the `(Disc 2)` tag. An identified release hands every disc the same
 * *name*, so the name identifies nothing and the row must show the tag
 * instead; '' when the file name adds nothing to the release name.
 *
 * The archive/media extension is not news (`(Disc 2).zip` → `(Disc 2)`),
 * and the short tail is what the row's narrow label column can actually
 * show: the whole file name would ellipsis away the very marker we are
 * after.
 */
const TRAILING_EXT = /\.(zip|7z|rar|iso|bin|cbs|mdf|nrg|cue|lst|gba|sfc|nes|smc|n64|v64|chd)$/i;
function nameMarker(titleName: string, fsName: string): string {
	if (titleName === '' || fsName === '') return '';
	const tn = titleName.trim();
	const fn = fsName.trim();
	const t = tn.toLowerCase();
	const f = fn.toLowerCase();
	if (f.length <= t.length || f.indexOf(t) !== 0) return '';
	return fn.slice(t.length).trim().replace(TRAILING_EXT, '');
}

export function DiscPicker({ title, initial, onPick, onClose }: Props) {
	const dims = useDimensions();
	const { ctx } = useParent();

	const count = title.discs.length;
	const [focus, setFocus] = useState(Math.min(Math.max(0, initial), Math.max(0, count - 1)));
	/** First row visible (the list scrolls when it exceeds the panel). */
	const [view, setView] = useState(0);

	// Keep the focused row inside the visible window — the shared
	// window-follow rule (move the window exactly when the focus falls
	// outside it, never for its own sake). One press is one row: the
	// directions deliberately have no auto-repeat.
	const moveFocus = (delta: number) => {
		const next = Math.min(Math.max(0, focus + delta), Math.max(0, count - 1));
		if (next === focus) return;
		setFocus(next);
		setView((v) => windowFollow(next, Math.min(count, MAX_ROWS), v));
	};
	useDirection('Up', () => moveFocus(-1), [focus, count]);
	useDirection('Down', () => moveFocus(1), [focus, count]);
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
				// When every disc wears the release's name (identification
				// does), the name identifies nothing: the file name's
				// trailing tag — "(Disc 2)" — is what the row shows. A
				// distinguishing name (a manual rename) always wins.
				const marker = nameMarker(title.name, disc.fsName);
				const label =
					disc.name !== '' && disc.name !== title.name
						? disc.name
						: marker !== ''
							? marker
							: disc.name !== ''
								? disc.name
								: disc.fsName !== ''
									? disc.fsName
									: `Disc ${i + 1}`;
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
