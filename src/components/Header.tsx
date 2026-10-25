import React from 'react';
import { Rect, Text, useDimensions, useParent } from 'react-tela';
import { colors, fontFamily, fontSize, radius, space } from '../theme';
import { measure } from '../text';

interface Props {
	/** Product name, top-left. */
	title: string;
	/** Status line under the title (library name, load result…). */
	subtitle?: string;
	/** Right-aligned count, e.g. "56 games". */
	meta?: string;
	/** Small pill next to the title, e.g. "DEMO". */
	badge?: string;
	/** Build identifier, bottom-right of the header. */
	build?: string;
}

const BADGE_W = 74;
const BADGE_H = 30;

/**
 * The top bar shared by every screen.
 *
 * The header is deliberately quiet: a title, one line of status and a
 * build stamp. Cover art and the focused element should be the loudest
 * things on screen, so nothing here competes with them.
 */
export function Header({ title, subtitle = '', meta = '', badge = '', build = '' }: Props) {
	const dims = useDimensions();
	const { ctx } = useParent();

	const titleWidth = measure(ctx, title, fontSize.display);
	const badgeX = space.xl + titleWidth + space.md;

	return (
		<>
			<Text
				x={space.xl}
				y={14}
				fontFamily={fontFamily}
				fontSize={fontSize.display}
				fill={colors.textPrimary}
			>
				{title}
			</Text>

			{badge !== '' && (
				<>
					<Rect
						x={badgeX}
						y={22}
						width={BADGE_W}
						height={BADGE_H}
						fill={colors.accent}
						borderRadius={radius.sm}
					/>
					<Text
						x={badgeX + BADGE_W / 2}
						y={29}
						fontFamily={fontFamily}
						fontSize={fontSize.tiny}
						fill={colors.textPrimary}
						textAlign="center"
					>
						{badge}
					</Text>
				</>
			)}

			{subtitle !== '' && (
				<Text
					x={space.xl}
					y={58}
					fontFamily={fontFamily}
					fontSize={fontSize.small}
					fill={colors.textMuted}
					maxWidth={dims.width - space.xl * 2}
					overflow="ellipsis"
				>
					{subtitle}
				</Text>
			)}

			{meta !== '' && (
				<Text
					x={dims.width - space.xl}
					y={22}
					fontFamily={fontFamily}
					fontSize={fontSize.heading}
					fill={colors.textSecondary}
					textAlign="right"
				>
					{meta}
				</Text>
			)}

			{build !== '' && (
				<Text
					x={dims.width - space.xl}
					y={58}
					fontFamily={fontFamily}
					fontSize={fontSize.tiny}
					fill={colors.textFaint}
					textAlign="right"
				>
					{`build ${build}`}
				</Text>
			)}
		</>
	);
}
