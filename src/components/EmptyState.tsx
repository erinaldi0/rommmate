import React from 'react';
import { Rect, Text, useDimensions, useParent } from 'react-tela';
import { colors, fontFamily, fontSize, radius, space } from '../theme';
import { wrapLines } from '../text';

interface Props {
	/** Short headline, e.g. "No games match". */
	title: string;
	/** One line of explanation under the headline. */
	detail?: string;
	/** Large muted glyph above the headline. */
	glyph?: string;
	/** Vertical centre of the block. Defaults to the middle of the screen. */
	centerY?: number;
}

/**
 * The "nothing here" state.
 *
 * An empty library is a normal outcome (a filter that matches nothing, a
 * RomM instance with no roms) — not an error. It gets the same careful
 * treatment as a populated screen so the app never looks broken.
 */
export function EmptyState({ title, detail = '', glyph = '', centerY }: Props) {
	const dims = useDimensions();
	const { ctx } = useParent();

	const cx = dims.width / 2;
	const cy = centerY ?? dims.height / 2;
	const lines = wrapLines(ctx, detail, Math.min(720, dims.width - 160), 2, fontSize.body);

	const hasGlyph = glyph !== '';
	const titleY = cy + (hasGlyph ? 24 : 0);

	return (
		<>
			{hasGlyph && (
				<Text
					x={cx}
					y={cy - 78}
					fontFamily={fontFamily}
					fontSize={72}
					fill={colors.coverGlyph}
					textAlign="center"
				>
					{glyph}
				</Text>
			)}

			<Text
				x={cx}
				y={titleY}
				fontFamily={fontFamily}
				fontSize={fontSize.title}
				fill={colors.textSecondary}
				textAlign="center"
			>
				{title}
			</Text>

			{lines.map((line, i) => (
				<Text
					key={`detail-${i}`}
					x={cx}
					y={titleY + 44 + i * 26}
					fontFamily={fontFamily}
					fontSize={fontSize.body}
					fill={colors.textMuted}
					textAlign="center"
				>
					{line}
				</Text>
			))}

			{/* A hairline under the state keeps it from floating in the void. */}
			<Rect
				x={cx - 60}
				y={titleY + 24}
				width={120}
				height={1}
				fill={colors.border}
			/>
			<Rect
				x={cx - space.xs}
				y={titleY + 44 + lines.length * 26 + 16}
				width={space.xs * 2}
				height={space.xs * 2}
				fill={colors.accent}
				borderRadius={radius.sm}
			/>
		</>
	);
}
