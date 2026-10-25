/**
 * The section menu (X): the overlay that jumps straight to any part of
 * the dashboard — the hero first, then every row that exists.
 *
 * Presentational: the screener owns the focus index and the input; this
 * paints the dimmed backdrop, the panel and the item list.
 */
import React from 'react';
import { Rect, Text, useDimensions } from 'react-tela';
import { colors, fontFamily, radius, fontSize } from '../../theme';

interface Item {
	label: string;
	/** A right-aligned hint, e.g. the row's count or the featured game. */
	detail: string;
}

interface Props {
	items: Item[];
	/** Index of the focused item. */
	focus: number;
}

const PANEL_W = 440;
const ROW_H = 44;

export function SectionMenu({ items, focus }: Props) {
	const dims = useDimensions();
	const panelX = (dims.width - PANEL_W) / 2;
	const panelY = 120;
	const panelH = 24 + 46 + items.length * ROW_H + 12;

	return (
		<>
			<Rect x={0} y={0} width={dims.width} height={dims.height} fill={colors.sunken} alpha={0.72} />
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
				x={panelX + 24}
				y={panelY + 18}
				fontFamily={fontFamily}
				fontSize={fontSize.small}
				textBaseline="alphabetic"
				fill={colors.textFaint}
			>
				SECTIONS
			</Text>
			{items.map((item, i) => {
				const focused = i === focus;
				const y = panelY + 46 + i * ROW_H;
				return (
					<React.Fragment key={`${item.label}-${item.detail}`}>
						<Rect
							x={panelX + 12}
							y={y}
							width={PANEL_W - 24}
							height={ROW_H - 6}
							fill={focused ? colors.surfaceRaised : undefined}
							stroke={focused ? colors.accent : undefined}
							lineWidth={focused ? 2 : 1}
							borderRadius={radius.md}
						/>
						<Text
							x={panelX + 28}
							y={y + (ROW_H - 6) / 2}
							fontFamily={fontFamily}
							fontSize={15}
							textBaseline="middle"
							fill={focused ? colors.textPrimary : colors.textSecondary}
						>
							{item.label}
						</Text>
						<Text
							x={panelX + PANEL_W - 28}
							y={y + (ROW_H - 6) / 2}
							fontFamily={fontFamily}
							fontSize={12}
							textBaseline="middle"
							fill={focused ? colors.textSecondary : colors.textFaint}
							textAlign="right"
							maxWidth={220}
							overflow="ellipsis"
						>
							{item.detail}
						</Text>
					</React.Fragment>
				);
			})}
		</>
	);
}
