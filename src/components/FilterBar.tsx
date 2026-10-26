import React, { useEffect, useRef } from 'react';
import { Rect, Text, useDimensions, useParent } from 'react-tela';
import { colors, fontFamily, fontSize, radius, space } from '../theme';
import { measure, truncate, type TextContext } from '../text';
import { SEARCH_KEY, type FilterChip } from '../lib/library-filters';
import { PlatformIcon } from './PlatformIcon';
import { platformIconSlug } from '../platform-icons';

interface Props {
	items: FilterChip[];
	/** Index of the chip that owns the focus. */
	focusedIndex: number;
	/** True when the bar (rather than the grid) owns the focus. */
	focused: boolean;
	/** Right-aligned summary, e.g. "12 of 56 games". */
	summary: string;
}

const CHIP_H = 38;
const CHIP_PAD_X = 14;
const CHIP_GAP = 10;
const COUNT_GAP = 12;
const MAX_LABEL_W = 220;
/** The platform icon and the gap behind it (the search chip has none). */
const ICON = 22;
const ICON_GAP = 8;

/** Width of a chip, given its label and count. */
function chipWidth(ctx: TextContext, item: FilterChip): number {
	const label = truncate(ctx, item.label, MAX_LABEL_W, fontSize.small);
	const icon = item.key === SEARCH_KEY ? 0 : ICON + ICON_GAP;
	let width = CHIP_PAD_X + icon + measure(ctx, label, fontSize.small) + CHIP_PAD_X;
	if (item.count !== undefined) {
		width += COUNT_GAP + measure(ctx, String(item.count), fontSize.tiny);
	}
	return width;
}

/**
 * The platform / search filter row.
 *
 * The chips form a horizontally scrollable strip: with a full RomM library
 * there can be dozens of platforms, and the strip scrolls to keep the
 * focused chip on screen instead of wrapping into a second line (which
 * would steal vertical space from the grid).
 */
export function FilterBar({ items, focusedIndex, focused, summary }: Props) {
	const dims = useDimensions();
	const { ctx } = useParent();

	const summaryWidth = summary === '' ? 0 : measure(ctx, summary, fontSize.small);
	const viewLeft = space.xl;
	const viewRight = dims.width - space.xl - summaryWidth - space.lg;
	const viewWidth = Math.max(120, viewRight - viewLeft);

	// Lay the chips out in a strip wider than the screen.
	const widths = items.map((item) => chipWidth(ctx, item));
	const offsets: number[] = [];
	let cursor = 0;
	for (const width of widths) {
		offsets.push(cursor);
		cursor += width + CHIP_GAP;
	}
	const stripWidth = Math.max(0, cursor - CHIP_GAP);
	const scrollMax = Math.max(0, stripWidth - viewWidth);

	const [scroll, setScroll] = React.useState(0);
	const scrollRef = useRef(0);
	const layoutRef = useRef({ offsets, widths, scrollMax });
	layoutRef.current = { offsets, widths, scrollMax };

	// Keep the focused chip inside the visible window.
	useEffect(() => {
		const { offsets: offs, widths: ws, scrollMax: max } = layoutRef.current;
		const entry = offs[focusedIndex];
		if (entry === undefined) return;

		let next = scrollRef.current;
		if (entry < next) {
			next = entry;
		} else if (entry + ws[focusedIndex] > next + viewWidth) {
			next = entry + ws[focusedIndex] - viewWidth;
		}
		next = Math.max(0, Math.min(next, max));
		if (next !== scrollRef.current) {
			scrollRef.current = next;
			setScroll(next);
		}
	}, [focusedIndex, viewWidth, items.length, stripWidth]);

	const y = space.xl + 62;

	return (
		<>
			{items.map((item, i) => {
				const width = widths[i];
				const x = viewLeft + offsets[i] - scroll;
				// Cull the chips that are outside the strip.
				if (x + width < viewLeft - 4 || x > viewRight + 4) return null;

				const isFocused = focused && i === focusedIndex;
				const label = truncate(ctx, item.label, MAX_LABEL_W, fontSize.small);
				// The platform chips wear their platform's icon; the search chip
				// stays plain (it is an action, not a platform).
				const slug = item.key === SEARCH_KEY ? '' : platformIconSlug(item.label, '');
				const iconRoom = slug === '' ? 0 : ICON + ICON_GAP;

				return (
					<React.Fragment key={item.key}>
						<Rect
							x={x}
							y={y}
							width={width}
							height={CHIP_H}
							fill={
								item.active
									? colors.accent
									: isFocused
										? colors.surfaceRaised
										: colors.surface
							}
							stroke={isFocused ? colors.accent : colors.border}
							lineWidth={isFocused ? 2 : 1}
							borderRadius={radius.pill}
							alpha={focused ? 1 : 0.5}
						/>
						{slug !== '' && (
							<PlatformIcon slug={slug} x={x + CHIP_PAD_X} y={y + (CHIP_H - ICON) / 2} size={ICON} />
						)}
						<Text
							x={x + CHIP_PAD_X + iconRoom}
							y={y + 11}
							fontFamily={fontFamily}
							fontSize={fontSize.small}
							fill={
								item.active
									? colors.textPrimary
									: isFocused
										? colors.textPrimary
										: colors.textSecondary
							}
							alpha={focused ? 1 : 0.6}
						>
							{label}
						</Text>
						{item.count !== undefined && (
							<Text
								x={x + width - CHIP_PAD_X}
								y={y + 13}
								fontFamily={fontFamily}
								fontSize={fontSize.tiny}
								fill={item.active ? colors.textPrimary : colors.textFaint}
								textAlign="right"
								alpha={focused ? 1 : 0.6}
							>
								{String(item.count)}
							</Text>
						)}
					</React.Fragment>
				);
			})}

			{summary !== '' && (
				<Text
					x={dims.width - space.xl}
					y={y + 12}
					fontFamily={fontFamily}
					fontSize={fontSize.small}
					fill={colors.textMuted}
					textAlign="right"
				>
					{summary}
				</Text>
			)}
		</>
	);
}
