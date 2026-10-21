import React from 'react';
import { Rect, Text, useDimensions, useParent } from 'react-tela';
import { colors, fontFamily, fontSize, radius, space } from '../theme';
import { measure } from '../text';

interface Props {
	/**
	 * Controller hints, e.g. `['A open', 'B back']`. The part before the
	 * space is drawn as a button badge, the rest as the description.
	 */
	hints: string[];
}

const BADGE_W = 34;
const BADGE_H = 26;
const BADGE_GAP = 8;
const ITEM_GAP = 26;

/**
 * The bottom hint bar.
 *
 * It answers the only question a player has when they pick up the
 * controller: "what does this button do?". The hints change with the
 * focused screen, so the bar always describes the current context rather
 * than the app in general.
 */
export function HintBar({ hints }: Props) {
	const dims = useDimensions();
	const { ctx } = useParent();

	const items = hints.map((hint) => {
		const [button, ...rest] = hint.split(' ');
		const label = rest.join(' ');
		return {
			button,
			label,
			width:
				BADGE_W +
				BADGE_GAP +
				measure(ctx, label, fontSize.small),
		};
	});

	const total =
		items.reduce((sum, item) => sum + item.width, 0) +
		ITEM_GAP * Math.max(0, items.length - 1);

	let x = (dims.width - total) / 2;
	const y = dims.height - 52;

	return (
		<>
			{items.map((item) => {
				const itemX = x;
				x += item.width + ITEM_GAP;
				return (
					<React.Fragment key={`${item.button}-${item.label}`}>
						<Rect
							x={itemX}
							y={y}
							width={BADGE_W}
							height={BADGE_H}
							fill={colors.surfaceRaised}
							stroke={colors.borderStrong}
							lineWidth={1}
							borderRadius={radius.sm}
						/>
						<Text
							x={itemX + BADGE_W / 2}
							y={y + 6}
							fontFamily={fontFamily}
							fontSize={fontSize.tiny}
							fontWeight="bold"
							fill={colors.accent}
							textAlign="center"
						>
							{item.button}
						</Text>
						<Text
							x={itemX + BADGE_W + BADGE_GAP}
							y={y + 5}
							fontFamily={fontFamily}
							fontSize={fontSize.small}
							fill={colors.textMuted}
						>
							{item.label}
						</Text>
					</React.Fragment>
		);
			})}
		</>
	);
}

/** The strip the hints sit on — keeps the bar readable over cover art. */
export function HintBarBackdrop({ height = 72 }: { height?: number }) {
	const dims = useDimensions();
	return (
		<Rect
			x={0}
			y={dims.height - height}
			width={dims.width}
			height={height}
			fill={colors.bg}
		/>
	);
}
