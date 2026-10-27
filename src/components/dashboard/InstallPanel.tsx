/**
 * The installation panel: the hero's right column.
 *
 * One card about the shown disc's install state — the phase heading, its
 * progress bar, a caption (an inline action's outcome wins until the disc
 * changes), the facts grid (platform / genres / released / size) and, for
 * multi-disc releases, the disc pager. The pager's one focus visual lives
 * here; the arrows themselves are driven by the screener's Left/Right.
 *
 * Built from the shared system: a raised `Panel`, the one `ProgressBar`,
 * and `Field` pairs for the facts — the same atoms the detail screen will
 * reduce to.
 */
import React from 'react';
import { Rect } from 'react-tela';
import { colors, fontSize, radius } from '../../theme';
import { formatBytes, type Hero } from './hero';
import type { PlayState } from '../../play';
import { Field, Panel, ProgressBar, Text, type ProgressTone } from '../ui';
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

/** The panel's inner padding. */
const PAD = 20;
/** The facts grid: two columns of these, half the inner width apart. */
const COL_W = 132;

export function InstallPanel({ state, msg, hero, pagerFocused }: Props) {
	const sizeText = formatBytes(hero.sizeBytes);
	const installPhase = ((): { caption: string; bar: number; heading: string; tone: ProgressTone } => {
		switch (state.kind) {
			case 'installing':
				return {
					caption: 'Downloading…',
					bar: Math.min(1, Math.max(0, state.progress)),
					heading: 'INSTALL',
					tone: 'accent',
				};
			case 'verifying':
				return {
					caption: 'Verifying checksum…',
					bar: Math.min(1, Math.max(0, state.progress)),
					heading: 'INSTALL',
					tone: 'accent',
				};
			case 'ready':
				return { caption: 'Installed', bar: 1, heading: 'INSTALLATION', tone: 'success' };
			case 'stale':
				return { caption: 'Outdated on server', bar: 0, heading: 'INSTALLATION', tone: 'warning' };
			case 'not-installed':
				return { caption: 'Ready to begin', bar: 0, heading: 'INSTALLATION', tone: 'neutral' };
			default:
				return { caption: 'Unavailable', bar: 0, heading: 'INSTALLATION', tone: 'neutral' };
		}
	})();
	const pct = Math.floor(installPhase.bar * 100);
	const panelRight =
		state.kind === 'installing' || state.kind === 'verifying' || installPhase.bar >= 1 || state.kind === 'not-installed'
			? `${pct}%${sizeText !== '' ? ` · ${sizeText}` : ''}`
			: sizeText;
	const caption = msg !== '' ? msg : installPhase.caption;
	const msgIsError = /fail|missing|error|no /i.test(msg);

	const infoCols: Array<{ label: string; value: string }> = [
		{ label: 'PLATFORM', value: hero.platform !== '' ? hero.platform : 'Unknown' },
		{ label: 'GENRES', value: hero.genre !== '' ? hero.genre : '—' },
		{ label: 'RELEASED', value: hero.year !== '' ? hero.disc.releaseDate : '—' },
		{ label: 'SIZE', value: sizeText !== '' ? sizeText : '—' },
	];

	const multi = hero.knownDiscs > 1;
	const canPrev = hero.discIndex > 0;
	const canNext = hero.discIndex < Math.max(0, hero.title.discs.length - 1);

	const left = PANEL_X + PAD;
	const innerW = PANEL_W - PAD * 2;

	return (
		<>
			<Panel x={PANEL_X} y={HERO_Y} width={PANEL_W} height={PANEL_H} />

			<ProgressBar
				x={left}
				y={HERO_Y + 44}
				width={innerW}
				value={installPhase.bar}
				tone={installPhase.tone}
				label={installPhase.heading}
				right={panelRight}
				caption={caption}
				captionColor={msgIsError ? colors.danger : undefined}
			/>

			<Rect x={left} y={HERO_Y + 80} width={innerW} height={1} fill={colors.border} pointerEvents={false} />

			{/* The facts, two columns of two. */}
			{infoCols.map((col, ci) => {
				const cx = left + (ci % 2) * (COL_W + 12);
				const cy = HERO_Y + 102 + Math.floor(ci / 2) * 56;
				return (
					<Field
						key={col.label}
						x={cx}
						y={cy}
						label={col.label}
						value={col.value}
						width={COL_W}
						valueSize={fontSize.small}
					/>
				);
			})}

			{/* The disc pager, the dashboard's way into the release's discs. */}
			{multi && (
				<>
					<Rect
						x={left}
						y={HERO_Y + 208}
						width={innerW}
						height={36}
						fill={pagerFocused ? colors.surfaceRaised : colors.sunken}
						stroke={pagerFocused ? colors.accent : colors.borderStrong}
						lineWidth={pagerFocused ? 2 : 1}
						borderRadius={radius.pill}
						pointerEvents={false}
					/>
					<Text x={left + 16} y={HERO_Y + 226} variant="label" size={14} baseline="middle" color={pagerFocused ? colors.textPrimary : colors.textSecondary}>
						{`Disc ${hero.discSlot} of ${hero.knownDiscs}`}
					</Text>
					<Text
						x={PANEL_X + PANEL_W - PAD - 40}
						y={HERO_Y + 226}
						variant="label"
						baseline="middle"
						color={canPrev ? (pagerFocused ? colors.textPrimary : colors.textSecondary) : colors.textFaint}
					>
						‹
					</Text>
					<Text
						x={PANEL_X + PANEL_W - PAD - 20}
						y={HERO_Y + 226}
						variant="label"
						baseline="middle"
						color={canNext ? (pagerFocused ? colors.textPrimary : colors.textSecondary) : colors.textFaint}
					>
						›
					</Text>
				</>
			)}
		</>
	);
}
