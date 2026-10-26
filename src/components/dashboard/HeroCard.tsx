/**
 * The hero card: the featured game's box art, identity, status chips,
 * summary and action buttons.
 *
 * Presentational — the install state and the primary action arrive in,
 * the screener owns which button is focused and what A does. The card is
 * built from the shared design system (`Button`, `StatusChip`, `Text`,
 * `FocusRing`, `Spinner`): the box art sits on a softly-shadowed plate
 * (the hero is one of the few places real `shadowBlur` is spent), the
 * state pill carries the status ramp, and the actions are the one shared
 * button — its focus and A-keycap arrive as props.
 */
import React, { useState } from 'react';
import { Rect, useParent } from 'react-tela';
import { CoverImage, type CoverStatus } from '../CoverImage';
import { colors, fontSize, radius } from '../../theme';
import { measure, truncate, wrapLines } from '../../text';
import type { PlayState } from '../../play';
import { type Chip, type Hero, type PrimaryAction, stateChip as stateChipFor } from './hero';
import {
	Button,
	buttonSize,
	FocusRing,
	Spinner,
	StatusChip,
	chipWidth,
	Text,
} from '../ui';
import { HERO_BUTTON_Y, HERO_COVER_H, HERO_COVER_W, HERO_COL_X, HERO_TEXT_W, HERO_Y, MARGIN_X } from './layout';

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

/** The gap between the action buttons. */
const BUTTON_GAP = 12;

/** The box art's top-left (MARGIN_X + 4 keeps it clear of the screen edge). */
const COVER_X = MARGIN_X + 4;

export function HeroCard({ hero, state, primary, focused, sel, multiDisc }: Props) {
	const { ctx } = useParent();
	const [status, setStatus] = useState<CoverStatus>(hero.coverUrl === '' ? 'ready' : 'loading');

	// Identity line: platform · genre(s) · year.
	const identity = [hero.platform, hero.genre, hero.year].filter((s) => s !== '').join(' · ');
	const titleText = truncate(ctx, hero.title.name, HERO_TEXT_W, fontSize.headline);
	const summaryLines = wrapLines(ctx, hero.summary, HERO_TEXT_W, 3, fontSize.small);

	// The status chips: the release's disc count (neutral) and the shared
	// install-state pill, drawn from the status ramp so the vocabulary is
	// the same on the home screen and the detail screen.
	const chips: Chip[] = [];
	if (multiDisc) {
		chips.push({ text: `${hero.knownDiscs} discs`, fill: colors.surfaceRaised, textFill: colors.textSecondary, tone: 'neutral' });
	}
	chips.push(stateChipFor(state));

	// The action row: the primary verb, then the secondaries. Widths come
	// from the button primitive (with the A-keycap's space always reserved,
	// so the row does not re-flow when focus moves onto a button).
	const actions: Array<{ label: string; variant: 'primary' | 'secondary'; disabled: boolean; detail: string }> = [];
	if (primary !== null) {
		actions.push({ label: primary.label, variant: 'primary', disabled: !primary.enabled, detail: primary.detail });
	}
	actions.push(
		{ label: 'Sync saves', variant: 'secondary', disabled: false, detail: '' },
		{ label: 'More', variant: 'secondary', disabled: false, detail: '' },
	);
	const widths = actions.map((a) => buttonSize(ctx, a.label, 'lg', { keycap: 'A', detail: a.detail }));

	const placeholderVisible = hero.coverUrl === '' || status !== 'ready';

	return (
		<>
			{/* ── the featured box art ─────────────────────────────── */}
			{/* The plate: a softly-lifted backing the art sits on. It is the
				hero's one real shadow — the depth cue that says "featured". */}
			<Rect
				x={COVER_X - 2}
				y={HERO_Y - 2}
				width={HERO_COVER_W + 4}
				height={HERO_COVER_H + 4}
				fill={colors.sunken}
				borderRadius={radius.md + 2}
				shadowColor="rgba(0,0,0,0.45)"
				shadowBlur={12}
				shadowOffsetY={4}
				pointerEvents={false}
			/>
			<CoverImage
				url={hero.coverUrl}
				x={COVER_X}
				y={HERO_Y}
				width={HERO_COVER_W}
				height={HERO_COVER_H}
				enabled
				onStatus={setStatus}
			/>
			{/* The frame doubles as the placeholder plate: it fills while the
				art is absent and turns transparent the moment it lands (the
				renderer's `insertBefore` quirk — see CoverCard). */}
			<Rect
				x={COVER_X}
				y={HERO_Y}
				width={HERO_COVER_W}
				height={HERO_COVER_H}
				fill={placeholderVisible ? colors.coverBg : undefined}
				stroke={colors.border}
				lineWidth={1}
				borderRadius={radius.md}
				pointerEvents={false}
			/>
			{placeholderVisible && (
				<Text
					x={COVER_X + HERO_COVER_W / 2}
					y={HERO_Y + HERO_COVER_H / 2 - 48}
					variant="display"
					size={96}
					align="center"
					color={colors.coverGlyph}
				>
					{hero.title.name.trim().charAt(0).toUpperCase() || '?'}
				</Text>
			)}
			{status === 'loading' && hero.coverUrl !== '' && (
				<Spinner x={COVER_X + HERO_COVER_W / 2} y={HERO_Y + HERO_COVER_H / 2 + 42} />
			)}
			<FocusRing
				x={COVER_X}
				y={HERO_Y}
				width={HERO_COVER_W}
				height={HERO_COVER_H}
				radius={radius.md}
				pad={5}
				glow
				active={focused && sel === 0}
			/>

			{/* ── identity ───────────────────────────────────────── */}
			<Text x={HERO_COL_X} y={HERO_Y + 36} variant="headline" color={colors.textPrimary}>
				{titleText}
			</Text>
			{identity !== '' && (
				<Text
					x={HERO_COL_X}
					y={HERO_Y + 64}
					variant="label"
					size={16}
					color={colors.textSecondary}
					maxWidth={HERO_TEXT_W}
					overflow="ellipsis"
				>
					{identity}
				</Text>
			)}

			{/* ── status chips ────────────────────────────────────── */}
			{(() => {
				let chipX = HERO_COL_X;
				return chips.map((chip, ci) => {
					const w = chipWidth(ctx, chip.text, 'md');
					const x = chipX;
					chipX += w + 10;
					return (
						<StatusChip
							key={`chip-${ci}`}
							x={x}
							y={HERO_Y + 82}
							text={chip.text}
							tone={chip.tone ?? 'neutral'}
						/>
					);
				});
			})()}

			{/* ── summary ─────────────────────────────────────────── */}
			{hero.summary === '' ? (
				<Text x={HERO_COL_X} y={HERO_Y + 140} variant="caption" color={colors.textFaint}>
					No description for this game.
				</Text>
			) : (
				summaryLines.map((line, i) => (
					<Text
						key={`summary-${i}`}
						x={HERO_COL_X}
						y={HERO_Y + 140 + i * 22}
						variant="caption"
						color={colors.textSecondary}
					>
						{line}
					</Text>
				))
			)}

			{/* ── the actions ─────────────────────────────────────── */}
			{(() => {
				let x = HERO_COL_X;
				return actions.map((action, ai) => {
					const actionX = x;
					x += widths[ai] + BUTTON_GAP;
					return (
						<Button
							key={`action-${action.label}`}
							x={actionX}
							y={HERO_BUTTON_Y}
							width={widths[ai]}
							label={action.label}
							variant={action.variant}
							size="lg"
							focused={focused && sel === 1 + ai}
							disabled={action.disabled}
							keycap="A"
							detail={action.detail !== '' ? action.detail : undefined}
						/>
					);
				});
			})()}
		</>
	);
}
