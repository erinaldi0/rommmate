/**
 * The game cover card: artwork, a backing plate, a placeholder, the title,
 * the platform line, an optional badge, and the focus ring — one reusable unit.
 *
 * It is the design-system form of `CoverTile`. It takes *primitives* (name,
 * platform, cover url) rather than a full `RommGame`, so it is decoupled from
 * the RomM model and genuinely reusable: the same card serves a 216-px grid
 * tile, a dashboard row, or a larger feature slot, and the detail screen can
 * compose the same lower atoms (`Text`, `Field`, `Chip`, …) around a bigger
 * cover.
 *
 * The load-restart + transparent-plate invariants from `CoverTile` are
 * preserved: the artwork is child one; the plate is drawn *after* it and turns
 * transparent the moment the art lands, so a re-inserted card can never paint
 * a dark plate over live artwork (the renderer's `insertBefore` quirk). The
 * focus *state* is a controlled prop; only the artwork's own lifecycle is
 * internal.
 */
import React, { useEffect, useState } from 'react';
import { Rect, useParent } from 'react-tela';
import { colors, fontSize, radius } from '../../theme';
import { measure, wrapLines } from '../../text';
import { CoverImage, type CoverStatus } from '../CoverImage';
import type { Fit } from '../../covers';
import { FocusRing } from './FocusRing';
import { Badge } from './Chip';
import { Text } from './Text';

export interface CoverCardProps {
	/** Top-left of the cover box. */
	x: number;
	y: number;
	/** Cover box width. */
	width: number;
	/** Cover box height. */
	height: number;
	/** Artwork URL; empty means "there is none" (the placeholder shows). */
	coverUrl: string;
	/** The title to print under the cover. */
	name: string;
	/** The platform line, under the title (omitted when empty). */
	platform?: string;
	/** True when this card owns the focus. */
	focused?: boolean;
	/**
	 * Whether the artwork should be fetched. A card the screen has decided is
	 * off-screen keeps its placeholder and downloads nothing (the on-device
	 * memory gate) — the screen drives culling by mounting / unmounting.
	 */
	enabled?: boolean;
	/** How the artwork fits the box. */
	fit?: Fit;
	/** A small tag over the top corner, e.g. the "2/4" disc badge. */
	badge?: string;
	/** Draw the focus ring; defaults to following `focused`. */
	showRing?: boolean;
	/** How far the ring sits outside the cover. */
	ringPad?: number;
}

/** The height of the text block under the cover (two title lines + platform). */
const TITLE_LINE_H = 21;
const PLATFORM_LINE_H = 17;

/** The total text block: export it so a screen can size a row (cover + text). */
export const coverCardTextH = TITLE_LINE_H * 2 + PLATFORM_LINE_H;

/**
 * A game's cover card. See the module docs for the invariants it keeps.
 */
export function CoverCard({
	x,
	y,
	width,
	height,
	coverUrl,
	name,
	platform,
	focused = false,
	enabled = true,
	fit = 'cover',
	badge,
	showRing,
	ringPad = 6,
}: CoverCardProps) {
	const { ctx } = useParent();

	const title = name !== '' ? name : 'Untitled';
	const titleLines = wrapLines(ctx, title, width - 4, 2, fontSize.label);

	// The artwork's lifecycle: keep the plate + glyph while the bytes are not
	// ready. A card reused for a different cover resets with its url.
	const [status, setStatus] = useState<CoverStatus>(coverUrl === '' ? 'ready' : 'loading');
	useEffect(() => {
		setStatus(coverUrl === '' ? 'ready' : 'loading');
	}, [coverUrl]);
	const placeholder = coverUrl === '' || status !== 'ready';

	// The placeholder glyph scales with the cover, so the card reads the same
	// at any size.
	const glyphSize = Math.round(Math.min(width, height) * 0.3);

	const ringOn = showRing ?? focused;
	const textTop = y + height + 8;

	return (
		<>
			<CoverImage url={coverUrl} x={x} y={y} width={width} height={height} fit={fit} enabled={enabled} onStatus={setStatus} />

			{/* Backing plate: opaque only while the placeholder shows. */}
			<Rect
				x={x}
				y={y}
				width={width}
				height={height}
				fill={placeholder ? colors.coverBg : undefined}
				stroke={colors.border}
				lineWidth={1}
				borderRadius={radius.md}
				pointerEvents={false}
			/>

			{placeholder && (
				<Text
					x={x + width / 2}
					y={y + height / 2 - Math.round(glyphSize * 0.55)}
					variant="display"
					size={glyphSize}
					align="center"
					color={colors.coverGlyph}
				>
					{title.trim().charAt(0).toUpperCase() || '?'}
				</Text>
			)}

			{badge !== undefined && badge !== '' && <Badge x={x + 8} y={y + 8} text={badge} />}

			{titleLines.map((line, i) => (
				<Text
					key={`title-${i}`}
					x={x + 2}
					y={textTop + i * TITLE_LINE_H}
					variant="label"
					color={focused ? colors.textPrimary : colors.textSecondary}
				>
					{line}
				</Text>
			))}

			{platform !== undefined && platform !== '' && (
				<Text
					x={x + 2}
					y={textTop + titleLines.length * TITLE_LINE_H}
					variant="caption"
					size={fontSize.tiny}
					color={colors.textFaint}
					maxWidth={width - 4}
					overflow="ellipsis"
				>
					{platform}
				</Text>
			)}

			{ringOn && <FocusRing x={x} y={y} width={width} height={height} radius={radius.md} pad={ringPad} />}
		</>
	);
}
