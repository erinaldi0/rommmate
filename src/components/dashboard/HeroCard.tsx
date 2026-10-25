/**
 * The hero card: the featured game's box art, identity, status chips,
 * summary and action buttons.
 *
 * Presentational — the install state and the primary action arrive in,
 * the screener owns which button is focused and what A does. The card
 * paints its own focus ring around the box art (the hero lives above the
 * masking bands, so nothing here needs to dodge them).
 */
import React from 'react';
import { CoverImage, type CoverStatus } from '../CoverImage';
import { Rect, Text, useParent } from 'react-tela';
import { useState } from 'react';
import { colors, fontFamily, radius } from '../../theme';
import { measure, truncate, wrapLines } from '../../text';
import type { PlayState } from '../../play';
import { type Chip, type Hero, type PrimaryAction, stateChip as stateChipFor } from './hero';
import { HERO_COVER_H, HERO_COVER_W, HERO_COL_X, HERO_Y, MARGIN_X, PANEL_X } from './layout';

export interface Props {
	hero: Hero;
	/** The play state of the shown disc. */
	state: PlayState;
	/** The hero's primary action (install / play), from the state. */
	primary: PrimaryAction | null;
	/** True when the hero area owns the focus. */
	focused: boolean;
	/** Which hero target is focused (0 cover, 1 primary, 2 sync, 3 more). */
	sel: number;
	/** True when the release has several discs (the disc count chip). */
	multiDisc: boolean;
}

const TEXT_W = PANEL_X - 20 - HERO_COL_X;

export function HeroCard({ hero, state, primary, focused, sel, multiDisc }: Props) {
	const { ctx } = useParent();
	const [status, setStatus] = useState<CoverStatus>(hero.coverUrl === '' ? 'ready' : 'loading');

	// Identity line: platform · genre(s) · year.
	const identity = [hero.platform, hero.genre, hero.year].filter((s) => s !== '').join('  |  ');
	const titleText = truncate(ctx, hero.title.name, TEXT_W, 34);
	const summaryLines = wrapLines(ctx, hero.summary, TEXT_W, 3, 14);

	// The state chip (and the disc count chip beside it).
	const chips: Chip[] = [];
	if (multiDisc) {
		chips.push({ text: `${hero.knownDiscs} discs`, fill: colors.surfaceRaised, textFill: colors.textSecondary });
	}
	chips.push(stateChipFor(state));

	// The buttons' row: primary, Sync saves, More. Their widths are
	// measured so the row hugs its labels; each button focus-strokes and,
	// for the focused enabled primary, carries the A keycap at its right.
	const buttons: Array<{ label: string; width: number; focused: boolean; keycap: boolean; enabled: boolean; kind: 'primary' | 'secondary' }> = [];
	if (primary !== null) {
		buttons.push({
			label: primary.label,
			width: 18 + measure(ctx, primary.label, 15) + (primary.enabled && focused && sel === 1 ? 46 : 12) + 18,
			focused: focused && sel === 1,
			keycap: primary.enabled && focused && sel === 1,
			enabled: primary.enabled,
			kind: 'primary',
		});
	}
	buttons.push(
		{
			label: 'Sync saves',
			width: 18 + measure(ctx, 'Sync saves', 15) + 18,
			focused: focused && sel === 2,
			keycap: false,
			enabled: true,
			kind: 'secondary',
		},
		{
			label: 'More',
			width: 18 + measure(ctx, 'More', 15) + 18,
			focused: focused && sel === 3,
			keycap: false,
			enabled: true,
			kind: 'secondary',
		},
	);

	const placeholderVisible = hero.coverUrl === '' || status !== 'ready';
	const BUTTON_Y = 288;
	const BUTTON_H = 50;

	return (
		<>
			{/* ── the featured box art (or its placeholder) ───────────── */}
			<CoverImage
				url={hero.coverUrl}
				x={MARGIN_X + 4}
				y={HERO_Y}
				width={HERO_COVER_W}
				height={HERO_COVER_H}
				enabled
				onStatus={setStatus}
			/>
			<Rect
				x={MARGIN_X + 4}
				y={HERO_Y}
				width={HERO_COVER_W}
				height={HERO_COVER_H}
				fill={placeholderVisible ? colors.coverBg : undefined}
				stroke={colors.border}
				lineWidth={1}
				borderRadius={radius.lg}
			/>
			{placeholderVisible && (
				<Text
					x={MARGIN_X + 4 + HERO_COVER_W / 2}
					y={HERO_Y + HERO_COVER_H / 2 - 60}
					fontFamily={fontFamily}
					fontSize={90}
					fill={colors.coverGlyph}
					textAlign="center"
				>
					{hero.title.name.trim().charAt(0).toUpperCase() || '?'}
				</Text>
			)}
			{focused && sel === 0 && (
				<Rect
					x={MARGIN_X}
					y={HERO_Y - 4}
					width={HERO_COVER_W + 12}
					height={HERO_COVER_H + 8}
					stroke={colors.accent}
					lineWidth={4}
					borderRadius={radius.xl}
				/>
			)}

			{/* ── identity ───────────────────────────────────────────── */}
			<Text
				x={HERO_COL_X}
				y={HERO_Y + 36}
				fontFamily={fontFamily}
				fontSize={34}
				textBaseline="alphabetic"
				fill={colors.textPrimary}
			>
				{titleText}
			</Text>
			{identity !== '' && (
				<Text
					x={HERO_COL_X}
					y={HERO_Y + 64}
					fontFamily={fontFamily}
					fontSize={15}
					textBaseline="alphabetic"
					fill={colors.textSecondary}
					maxWidth={TEXT_W}
					overflow="ellipsis"
				>
					{identity}
				</Text>
			)}

			{/* ── status chips ───────────────────────────────────────── */}
			{(() => {
				let chipX = HERO_COL_X;
				return chips.map((chip, ci) => {
					const w = measure(ctx, chip.text, 14) + 30;
					const x = chipX;
					chipX += w + 10;
					return (
						<React.Fragment key={`chip-${ci}`}>
							<Rect x={x} y={HERO_Y + 80} width={w} height={30} fill={chip.fill} borderRadius={radius.pill} />
							<Text
								x={x + w / 2}
								y={HERO_Y + 95}
								fontFamily={fontFamily}
								fontSize={14}
								fill={chip.textFill}
								textAlign="center"
								textBaseline="middle"
							>
								{chip.text}
							</Text>
						</React.Fragment>
					);
				});
			})()}

			{/* ── summary ────────────────────────────────────────────── */}
			{hero.summary === '' ? (
				<Text
					x={HERO_COL_X}
					y={HERO_Y + 134}
					fontFamily={fontFamily}
					fontSize={14}
					fill={colors.textFaint}
				>
					No description for this game.
				</Text>
			) : (
				summaryLines.map((line, i) => (
					<Text
						key={`summary-${i}`}
						x={HERO_COL_X}
						y={HERO_Y + 134 + i * 21}
						fontFamily={fontFamily}
						fontSize={14}
						textBaseline="alphabetic"
						fill={colors.textSecondary}
					>
						{line}
					</Text>
				))
			)}

			{/* ── the actions ────────────────────────────────────────── */}
			{buttons.map((button, bi) => {
				const x = HERO_COL_X + buttons.slice(0, bi).reduce((s, b) => s + b.width + 12, 0);
				return (
					<React.Fragment key={`btn-${bi}`}>
						<Rect
							x={x}
							y={BUTTON_Y}
							width={button.width}
							height={BUTTON_H}
							fill={
								button.kind === 'primary' && button.enabled
									? colors.accent
									: button.focused
										? colors.surfaceRaised
										: colors.surface
							}
							stroke={
								button.kind === 'primary' && button.enabled
									? button.focused
										? colors.textPrimary
										: colors.accent
									: button.focused
										? colors.accent
										: colors.border
							}
							lineWidth={button.focused ? 2 : 1}
							borderRadius={radius.md}
						/>
						<Text
							x={x + 18}
							y={BUTTON_Y + BUTTON_H / 2}
							fontFamily={fontFamily}
							fontSize={15}
							textBaseline="middle"
							fill={button.enabled ? colors.textPrimary : colors.textFaint}
						>
							{button.label}
						</Text>
						{button.keycap && (
							<>
								<Rect
									x={x + button.width - 44}
									y={BUTTON_Y + (BUTTON_H - 24) / 2}
									width={24}
									height={24}
									fill={colors.textPrimary}
									borderRadius={radius.sm}
								/>
								<Text
									x={x + button.width - 32}
									y={BUTTON_Y + BUTTON_H / 2}
									fontFamily={fontFamily}
									fontSize={12}
									fill={colors.accent}
									textAlign="center"
									textBaseline="middle"
								>
									A
								</Text>
							</>
						)}
					</React.Fragment>
				);
			})}
		</>
	);
}
