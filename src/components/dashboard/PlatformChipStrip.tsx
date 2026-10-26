/**
 * The platform chip strip: one pill per platform, the platform's own logo
 * on its left, the biggest libraries first, and the library's rom count
 * beside the name — compact, visually distinct filters for the library.
 *
 * The strip scrolls itself: horizontally, to keep the focused chip inside
 * the visible window (the same rule the grid's FilterBar applies), and it
 * culls the chips that fall outside (a chip's logo is a cover job, and
 * the on-device rule is fetch only what is displayed). The focused chip is
 * the *selected* platform: a raised fill, the accent stroke and the count
 * turning accent make it unmistakable. The focus stroke is the ring — no
 * separate outline is drawn above the bands.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Rect, useDimensions, useParent } from 'react-tela';
import { colors, radius } from '../../theme';
import { measure, truncate } from '../../text';
import { CoverImage } from '../CoverImage';
import { Text } from '../ui';
import { CHIP_GAP, MARGIN_X, TILE_X0 } from './layout';
import type { PlatformChip } from './section-rows';

const CHIP_H = 44;
const ICON = 24;
const MAX_LABEL_W = 200;
const LABEL_FS = 14;
const COUNT_FS = 12;

interface Props {
	chips: PlatformChip[];
	/** The chip strip's top edge on screen (already scrolled). */
	y: number;
	/** Index of the chip that owns the focus; -1 when the strip does not
	 * own the focus (the screener normalises it — see the memo note). */
	focusSel: number;
	/** True when the strip's row owns the focus. */
	focused: boolean;
}

/**
 * Memoised like `TileRow`: the screener re-renders on every focus move,
 * and the strip's layout is a pure function of these props (plus its own
 * scroll state). The screener normalises `focusSel` to -1 for strips that
 * do not own the focus, so a horizontal move elsewhere skips the re-measure
 * of every chip label here.
 */
export const PlatformChipStrip = React.memo(function PlatformChipStrip({ chips, y, focusSel, focused }: Props) {
	const dims = useDimensions();
	const { ctx } = useParent();

	const viewWidth = dims.width - TILE_X0 - MARGIN_X;

	// The strip's layout, measured per render pass.
	const widths = useMemo(() => {
		return chips.map((c) => {
			const textW = measure(ctx, truncate(ctx, c.name, MAX_LABEL_W, LABEL_FS), LABEL_FS);
			const countW = measure(ctx, `${c.count}`, COUNT_FS);
			const iconW = c.logoUrl === '' ? 0 : ICON + 8;
			return 12 + iconW + textW + 10 + countW + 14;
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [chips]);
	const offsets: number[] = [];
	let cursor = 0;
	for (const w of widths) {
		offsets.push(cursor);
		cursor += w + CHIP_GAP;
	}
	const stripWidth = Math.max(0, cursor - CHIP_GAP);
	const scrollMax = Math.max(0, stripWidth - viewWidth);

	// Keep the focused chip inside the visible window.
	const [scroll, setScroll] = useState(0);
	const scrollRef = useRef(0);
	const layoutRef = useRef({ offsets, widths, scrollMax, viewWidth });
	layoutRef.current = { offsets, widths, scrollMax, viewWidth };

	useEffect(() => {
		const { offsets: offs, widths: ws, scrollMax: max, viewWidth: vw } = layoutRef.current;
		const entry = offs[focusSel];
		if (entry === undefined) return;
		let next = scrollRef.current;
		if (entry < next) {
			next = entry;
		} else if (entry + ws[focusSel] > next + vw) {
			next = entry + ws[focusSel] - vw;
		}
		next = Math.max(0, Math.min(next, max));
		if (next !== scrollRef.current) {
			scrollRef.current = next;
			setScroll(next);
		}
	}, [focusSel, chips, scrollMax]);

	return (
		<>
			{chips.map((c, i) => {
				const width = widths[i];
				const x = TILE_X0 + offsets[i] - scroll;
				// Cull the chips that are outside the strip.
				if (x + width < MARGIN_X - 4 || x > dims.width - MARGIN_X + 4) return null;

				const isFocused = focused && i === focusSel;
				const label = truncate(ctx, c.name, MAX_LABEL_W, LABEL_FS);
				const iconW = c.logoUrl === '' ? 0 : ICON + 8;
				const labelX = x + 12 + iconW;
				const labelW = measure(ctx, label, LABEL_FS);
				const countX = labelX + labelW + 10;

				return (
					<React.Fragment key={c.key}>
						<Rect
							x={x}
							y={y}
							width={width}
							height={CHIP_H}
							fill={isFocused ? colors.surfaceRaised : colors.surface}
							stroke={isFocused ? colors.accent : colors.border}
							lineWidth={isFocused ? 2 : 1}
							borderRadius={radius.pill}
							pointerEvents={false}
						/>
						{c.logoUrl !== '' && (
							<CoverImage
								url={c.logoUrl}
								x={x + 12}
								y={y + (CHIP_H - ICON) / 2}
								width={ICON}
								height={ICON}
								fit="contain"
								enabled={x <= dims.width - MARGIN_X}
								onStatus={() => {}}
							/>
						)}
						<Text
							x={labelX}
							y={y + CHIP_H / 2}
							variant="label"
							size={LABEL_FS}
							baseline="middle"
							maxWidth={MAX_LABEL_W}
							overflow="ellipsis"
							color={isFocused ? colors.textPrimary : colors.textSecondary}
						>
							{label}
						</Text>
						<Text
							x={countX}
							y={y + CHIP_H / 2}
							variant="micro"
							size={COUNT_FS}
							baseline="middle"
							color={isFocused ? colors.accent : colors.textMuted}
						>
							{`${c.count}`}
						</Text>
					</React.Fragment>
				);
			})}
		</>
	);
});
