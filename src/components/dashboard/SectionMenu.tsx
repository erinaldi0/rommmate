/**
 * The section menu (X): the overlay that jumps straight to any part of
 * the dashboard — the hero first, then every row that exists.
 *
 * Presentational: the screener owns the focus index and the input; this
 * paints the dimmed backdrop, the panel (the one legitimately *floating*
 * surface — a modal earns the shadow) and the item list.
 */
import React from 'react';
import { Rect, useDimensions } from 'react-tela';
import { colors, fontSize, radius } from '../../theme';
import { Panel, Text } from '../ui';

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
			<Rect x={0} y={0} width={dims.width} height={dims.height} fill={colors.sunken} alpha={0.72} pointerEvents={false} />
			<Panel x={panelX} y={panelY} width={PANEL_W} height={panelH} elevation="floating" />
			<Text x={panelX + 24} y={panelY + 34} variant="micro" color={colors.textFaint}>
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
							pointerEvents={false}
						/>
						<Text
							x={panelX + 28}
							y={y + (ROW_H - 6) / 2}
							variant="label"
							size={fontSize.small}
							baseline="middle"
							color={focused ? colors.textPrimary : colors.textSecondary}
						>
							{item.label}
						</Text>
						<Text
							x={panelX + PANEL_W - 28}
							y={y + (ROW_H - 6) / 2}
							variant="micro"
							baseline="middle"
							align="right"
							color={focused ? colors.textSecondary : colors.textFaint}
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
