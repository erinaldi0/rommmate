/**
 * The platform chip strip: one pill per platform, the platform's own logo
 * on its left, the biggest libraries first.
 *
 * The strip scrolls itself: horizontally, to keep the focused chip inside
 * the visible window (the same rule the grid's FilterBar applies), and it
 * culls the chips that fall outside (a chip's logo is a cover job, and
 * the on-device rule is fetch only what is displayed). The chip's focus
 * stroke is the ring — no separate outline is drawn above the bands.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Rect, Text, useDimensions, useParent } from 'react-tela';
import { colors, fontFamily, radius } from '../../theme';
import { measure, truncate } from '../../text';
import { CoverImage } from '../CoverImage';
import { CHIP_GAP, MARGIN_X, TILE_X0 } from './layout';
import type { PlatformChip } from './section-rows';

const CHIP_H = 40;
const ICON = 24;
const MAX_LABEL_W = 200;

interface Props {
	chips: PlatformChip[];
	/** The chip strip's top edge on screen (already scrolled). */
	y: number;
	/** Index of the chip that owns the focus. */
	focusSel: number;
	/** True when the strip's row owns the focus. */
	focused: boolean;
}

export function PlatformChipStrip({ chips, y, focusSel, focused }: Props) {
	const dims = useDimensions();
	const { ctx } = useParent();

	const viewWidth = dims.width - TILE_X0 - MARGIN_X;

	// The strip's layout, measured per render pass.
	const widths = useMemo(() => {
		return chips.map((c) => {
			const textW = measure(ctx, truncate(ctx, c.name, MAX_LABEL_W, 13), 13);
			const iconW = c.logoUrl === '' ? 0 : ICON + 8;
			return 12 + iconW + textW + 14;
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
				const label = truncate(ctx, c.name, MAX_LABEL_W, 13);

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
							x={x + 12 + (c.logoUrl !== '' ? ICON + 8 : 0)}
							y={y + CHIP_H / 2}
							fontFamily={fontFamily}
							fontSize={13}
							textBaseline="middle"
							fill={isFocused ? colors.textPrimary : colors.textSecondary}
							maxWidth={width - (c.logoUrl !== '' ? ICON + 32 : 24)}
							overflow="ellipsis"
						>
							{label}
						</Text>
					</React.Fragment>
				);
			})}
		</>
	);
}
