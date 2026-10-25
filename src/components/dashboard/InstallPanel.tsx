/**
 * The installation panel: the hero's right column.
 *
 * One card about the shown disc's install state — the phase text, its
 * progress bar, a caption (an inline action's outcome wins until the disc
 * changes), the facts grid (platform / genres / released / size) and, for
 * multi-disc releases, the disc pager. The pager's one focus visual lives
 * here; the arrows themselves are driven by the screener's Left/Right.
 */
import React from 'react';
import { Rect, Text } from 'react-tela';
import { colors, fontFamily, radius } from '../../theme';
import { formatBytes, type Hero } from './hero';
import type { PlayState } from '../../play';
import { HERO_Y, PANEL_H, PANEL_W, PANEL_X } from './layout';

interface Props {
	/** The shown disc's play state (phase + progress). */
	state: PlayState;
	/** The status line of the last inline action, '' when stale. */
	msg: string;
	hero: Hero;
	/** True when the disc pager has the focus. */
	pagerFocused: boolean;
}

export function InstallPanel({ state, msg, hero, pagerFocused }: Props) {
	const sizeText = formatBytes(hero.sizeBytes);
	const installPhase = ((): { caption: string; bar: number; heading: string } => {
		switch (state.kind) {
			case 'installing':
				return {
					caption: 'Downloading…',
					bar: Math.min(1, Math.max(0, state.progress)),
					heading: 'INSTALL',
				};
			case 'ready':
				return { caption: 'Installed', bar: 1, heading: 'INSTALLATION' };
			case 'stale':
				return { caption: 'Outdated on server', bar: 0, heading: 'INSTALLATION' };
			case 'not-installed':
				return { caption: 'Ready to begin', bar: 0, heading: 'INSTALLATION' };
			default:
				return { caption: 'Unavailable', bar: 0, heading: 'INSTALLATION' };
		}
	})();
	const pct = Math.floor(installPhase.bar * 100);
	const panelRight =
		state.kind === 'installing' || installPhase.bar >= 1 || state.kind === 'not-installed'
			? `${pct}%${sizeText !== '' ? ` · ${sizeText}` : ''}`
			: sizeText;
	const caption = msg !== '' ? msg : installPhase.caption;

	const infoCols: Array<{ label: string; value: string }> = [
		{ label: 'PLATFORM', value: hero.platform !== '' ? hero.platform : 'Unknown' },
		{ label: 'GENRES', value: hero.genre !== '' ? hero.genre : '—' },
		{ label: 'RELEASED', value: hero.year !== '' ? hero.disc.releaseDate : '—' },
		{ label: 'SIZE', value: sizeText !== '' ? sizeText : '—' },
	];

	const multi = hero.knownDiscs > 1;
	const canPrev = hero.discIndex > 0;
	const canNext = hero.discIndex < Math.max(0, hero.title.discs.length - 1);

	return (
		<>
			<Rect
				x={PANEL_X}
				y={HERO_Y}
				width={PANEL_W}
				height={PANEL_H}
				fill={colors.surface}
				stroke={colors.border}
				lineWidth={1}
				borderRadius={radius.xl}
			/>
			<Text
				x={PANEL_X + 20}
				y={HERO_Y + 28}
				fontFamily={fontFamily}
				fontSize={10}
				textBaseline="alphabetic"
				fill={colors.textFaint}
			>
				{installPhase.heading}
			</Text>
			<Text
				x={PANEL_X + PANEL_W - 20}
				y={HERO_Y + 27}
				fontFamily={fontFamily}
				fontSize={13}
				textBaseline="alphabetic"
				fill={state.kind === 'installing' ? colors.accent : colors.textSecondary}
				textAlign="right"
			>
				{panelRight}
			</Text>
			<Rect x={PANEL_X + 20} y={HERO_Y + 42} width={PANEL_W - 40} height={6} fill={colors.border} borderRadius={3} />
			{installPhase.bar > 0 && (
				<Rect
					x={PANEL_X + 20}
					y={HERO_Y + 42}
					width={Math.max(6, (PANEL_W - 40) * installPhase.bar)}
					height={6}
					fill={colors.accent}
					borderRadius={3}
				/>
			)}
			<Text
				x={PANEL_X + 20}
				y={HERO_Y + 66}
				fontFamily={fontFamily}
				fontSize={13}
				textBaseline="alphabetic"
				fill={/fail|missing|error|no /i.test(msg) ? colors.danger : colors.textSecondary}
				maxWidth={PANEL_W - 40}
				overflow="ellipsis"
			>
				{caption}
			</Text>
			<Rect x={PANEL_X + 20} y={HERO_Y + 88} width={PANEL_W - 40} height={1} fill={colors.border} />

			{/* The facts, two columns of two. */}
			{infoCols.map((col, ci) => {
				const cx = PANEL_X + 20 + (ci % 2) * 130;
				const cy = HERO_Y + 112 + Math.floor(ci / 2) * 46;
				return (
					<React.Fragment key={col.label}>
						<Text x={cx} y={cy} fontFamily={fontFamily} fontSize={10} textBaseline="alphabetic" fill={colors.textFaint}>
							{col.label}
						</Text>
						<Text
							x={cx}
							y={cy + 19}
							fontFamily={fontFamily}
							fontSize={14}
							textBaseline="alphabetic"
							fill={colors.textSecondary}
							maxWidth={118}
							overflow="ellipsis"
						>
							{col.value}
						</Text>
					</React.Fragment>
				);
			})}

			{/* The disc pager, the dashboard's way into the release's discs. */}
			{multi && (
				<>
					<Rect
						x={PANEL_X + 20}
						y={HERO_Y + 208}
						width={PANEL_W - 40}
						height={36}
						fill={pagerFocused ? colors.surfaceRaised : colors.sunken}
						stroke={pagerFocused ? colors.accent : colors.borderStrong}
						lineWidth={pagerFocused ? 2 : 1}
						borderRadius={radius.pill}
					/>
					<Text
						x={PANEL_X + 36}
						y={HERO_Y + 226}
						fontFamily={fontFamily}
						fontSize={14}
						textBaseline="middle"
						fill={pagerFocused ? colors.textPrimary : colors.textSecondary}
					>
						{`Disc ${hero.discSlot} of ${hero.knownDiscs}`}
					</Text>
					<Text
						x={PANEL_X + PANEL_W - 58}
						y={HERO_Y + 226}
						fontFamily={fontFamily}
						fontSize={16}
						textBaseline="middle"
						fill={canPrev ? (pagerFocused ? colors.textPrimary : colors.textSecondary) : colors.textFaint}
					>
						‹
					</Text>
					<Text
						x={PANEL_X + PANEL_W - 38}
						y={HERO_Y + 226}
						fontFamily={fontFamily}
						fontSize={16}
						textBaseline="middle"
						fill={canNext ? (pagerFocused ? colors.textPrimary : colors.textSecondary) : colors.textFaint}
					>
						›
					</Text>
				</>
			)}
		</>
	);
}
