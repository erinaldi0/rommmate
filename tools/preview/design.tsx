/**
 * Dev-only: the design-system showcase.
 *
 * Rendered by the preview harness at `?view=design`, this exercises every
 * primitive in `src/components/ui` on the real 1280×720 react-tela canvas, so
 * the whole system can be inspected (and re-checked after a token change) in
 * the browser preview instead of on the device. It is not shipped.
 *
 * It deliberately uses no artwork and no network: covers are shown in their
 * placeholder state and the "art" behind a scrim is a gradient, so the page
 * settles instantly and the screenshot is stable.
 */
import React from 'react';
import { Rect, useDimensions } from 'react-tela';
import {
	Backdrop,
	Panel,
	Scrim,
	Surface,
	Text,
	SectionHeading,
	Field,
	Button,
	HintBar,
	Chip,
	StatusChip,
	Badge,
	FocusRing,
	ProgressBar,
	CoverCard,
	EmptyState,
	LoadingState,
	ErrorState,
	colors,
	type,
	layout,
	elevation,
	type ElevationName,
} from '../../src/components/ui';

/** The full design-system page. */
export function DesignShowcase() {
	const dims = useDimensions();
	const W = dims.width;
	const H = dims.height;

	const colA = { x: 40, y: 100, w: 384, h: 552 };
	const colB = { x: 448, y: 100, w: 384, h: 552 };
	const colC = { x: 856, y: 100, w: 384, h: 552 };

	return (
		<>
			<Backdrop width={W} height={H} />
			<Header x={layout.margin} />

			<Panel x={colA.x} y={colA.y} width={colA.w} height={colA.h} />
			<ColSurfaces col={colA} />

			<Panel x={colB.x} y={colB.y} width={colB.w} height={colB.h} />
			<ColActions col={colB} />

			<Panel x={colC.x} y={colC.y} width={colC.w} height={colC.h} />
			<ColCovers col={colC} />

			<HintBar hints={['A activate', 'B back', 'Y search']} />
		</>
	);
}

/** The page title row. */
function Header({ x }: { x: number }) {
	return (
		<>
			<Text x={x} y={40} variant="display" baseline="middle" color={colors.textPrimary}>
				RomMmate
			</Text>
			<Text x={x + 168} y={56} variant="caption" baseline="middle" color={colors.textMuted}>
				Design system · react-tela + nx.js
			</Text>
			<StatusChip x={1180 - 120} y={38} text="Ready" tone="success" />
			<Chip x={1180 - 220} y={38} text="v0.1" tone="accent" />
		</>
	);
}

type Col = { x: number; y: number; w: number; h: number };

/** Surfaces (the elevation steps) + the type hierarchy. */
function ColSurfaces({ col }: { col: Col }) {
	const pad = 24;
	const left = col.x + pad;
	const innerW = col.w - pad * 2;
	const labels: Array<{ level: ElevationName; name: string }> = [
		{ level: 'flat', name: 'flat — on the background' },
		{ level: 'raised', name: 'raised — panels, rows' },
		{ level: 'overlay', name: 'overlay — popups' },
		{ level: 'floating', name: 'floating — shadow' },
	];

	let y = col.y + 64;
	return (
		<>
			<SectionHeading x={left} y={col.y + 44} width={innerW} rule>
				Surfaces
			</SectionHeading>
			{labels.map((l, i) => {
				const sw = (
					<>
						<Surface x={left} y={y} width={innerW} height={40} elevation={l.level} radius={10} />
						<Text x={left + 14} y={y + 20} variant="label" baseline="middle" color={elevation[l.level].fill === colors.bg ? colors.textMuted : colors.textPrimary}>
							{l.name}
						</Text>
					</>
				);
				y += 50;
				return <React.Fragment key={l.level}>{sw}</React.Fragment>;
			})}

			<SectionHeading x={left} y={y + 28} width={innerW} rule>
				Type
			</SectionHeading>
			{(['display', 'heading', 'body', 'label', 'caption', 'micro'] as const).map((role, i) => (
				<React.Fragment key={role}>
					<Text x={left} y={y + 54 + i * 30} variant={role} color={type[role].color} baseline="middle">
						{sampleFor(role)}
					</Text>
					<Text x={left + innerW} y={y + 54 + i * 30} variant="micro" align="right" baseline="middle" color={colors.textFaint}>
						{role}
					</Text>
				</React.Fragment>
			))}
		</>
	);
}

function sampleFor(role: string): string {
	switch (role) {
		case 'display':
			return 'Display';
		case 'heading':
			return 'Section';
		case 'body':
			return 'Body text';
		case 'label':
			return 'Label';
		case 'caption':
			return 'Caption';
		default:
			return 'Micro';
	}
}

/** Buttons, chips, badges and progress. */
function ColActions({ col }: { col: Col }) {
	const pad = 24;
	const left = col.x + pad;
	const innerW = col.w - pad * 2;
	const half = innerW / 2;

	const rows: Array<Array<{ label: string; variant: 'primary' | 'secondary' | 'ghost' | 'danger'; focused?: boolean; disabled?: boolean; keycap?: string }>> = [
		[{ label: 'Play game', variant: 'primary', focused: true, keycap: 'A' }, { label: 'Play game', variant: 'primary' }],
		[{ label: 'Installing…', variant: 'primary', disabled: true }, { label: 'Uninstall', variant: 'danger', focused: true, keycap: 'A' }],
		[{ label: 'Sync saves', variant: 'secondary', focused: true }, { label: 'Discs', variant: 'secondary' }],
		[{ label: 'More', variant: 'ghost', focused: true }, { label: 'Uninstall', variant: 'danger' }],
	];
	const rowY = (r: number) => col.y + 66 + r * 50;

	return (
		<>
			<SectionHeading x={left} y={col.y + 44} width={innerW} rule>
				Actions
			</SectionHeading>
			{rows.map((row, r) =>
				row.map((b, i) => (
					<Button
					key={`${r}-${i}-${b.variant}-${b.label}`}
						x={left + i * half}
						y={rowY(r)}
						label={b.label}
						variant={b.variant}
						size="md"
						focused={b.focused}
						disabled={b.disabled}
						keycap={b.keycap}
					/>
				)),
			)}

			<SectionHeading x={left} y={col.y + 280} width={innerW} rule>
				Chips & Status
			</SectionHeading>
			<Chip x={left} y={col.y + 304} text="Neutral" tone="neutral" />
			<Chip x={left + 116} y={col.y + 304} text="Accent" tone="accent" />
			<StatusChip x={left + 210} y={col.y + 304} text="Installed" tone="success" />
			<StatusChip x={left + 306} y={col.y + 304} text="Outdated" tone="warning" />
			<Badge x={left} y={col.y + 338} text="2/4" />
			<Badge x={left + 52} y={col.y + 338} text="New" tone="neutral" />
			<Badge x={left + 104} y={col.y + 338} text="!" tone="danger" size={22} />
			<Chip x={left + 160} y={col.y + 335} text="Focused" tone="surface" focused />

			<SectionHeading x={left} y={col.y + 380} width={innerW} rule>
				Progress
			</SectionHeading>
			<ProgressBar x={left} y={col.y + 420} width={innerW} value={0.45} label="INSTALL" right="45% · 1.2 GB" caption="Downloading… (64 MB/s)" />
			<ProgressBar x={left} y={col.y + 460} width={innerW} value={1} tone="success" label="COMPLETE" right="100%" caption="Installed" />
			<ProgressBar x={left} y={col.y + 500} width={innerW} value={0.2} tone="danger" label="ERROR" right="20%" caption="Failed: no network" captionColor={colors.danger} />
		</>
	);
}

/** Covers, focus, metadata and the scrim. */
function ColCovers({ col }: { col: Col }) {
	const pad = 24;
	const left = col.x + pad;
	const innerW = col.w - pad * 2;

	const cardW = (innerW - 16) / 2;
	const cardH = Math.round(cardW * (4 / 3));

	return (
		<>
			<SectionHeading x={left} y={col.y + 44} width={innerW} rule>
				Covers & Focus
			</SectionHeading>

			<CoverCard
				x={left}
				y={col.y + 66}
				width={cardW}
				height={cardH}
				coverUrl=""
				name="Super Mario 64"
				platform="Nintendo 64"
				focused
				badge="2/4"
			/>
			<CoverCard
				x={left + cardW + 16}
				y={col.y + 66}
				width={cardW}
				height={cardH}
				coverUrl=""
				name="F-Zero X"
				platform="Nintendo 64"
			/>

			{/* The scrim: a gradient over a stand-in "artwork" (the blur substitute). */}
			<Rect x={left} y={col.y + 66 + cardH + 28} width={innerW} height={110} fill={colors.accentDark} borderRadius={10} pointerEvents={false} />
			<Scrim x={left} y={col.y + 66 + cardH + 28} width={innerW} height={110} direction="left" />
			<Text x={left + 16} y={col.y + 66 + cardH + 28 + 30} variant="title" color={colors.textPrimary}>
				Hero scrim
			</Text>
			<Text x={left + 16} y={col.y + 66 + cardH + 28 + 62} variant="caption" color={colors.textSecondary}>
				gradient over the art
			</Text>

			<SectionHeading x={left} y={col.y + 66 + cardH + 152} width={innerW} rule>
				Metadata
			</SectionHeading>
			<Field x={left} y={col.y + 66 + cardH + 178} label="PLATFORM" value="Nintendo 64" width={(innerW - 16) / 2} />
			<Field x={left + (innerW - 16) / 2 + 16} y={col.y + 66 + cardH + 178} label="SIZE" value="1.2 GB" width={(innerW - 16) / 2} />
		</>
	);
}

/** The three feedback states, one per third of the screen. */
export function StatesBand() {
	const dims = useDimensions();
	const W = dims.width;
	const H = dims.height;
	const cy = H / 2;
	const third = W / 3;
	return (
		<>
			<Backdrop width={W} height={H} />
			<EmptyState title="No games match" detail="Try another platform, or clear the search." glyph="∅" centerY={cy} centerX={third * 0.5} />
			<LoadingState label="Loading library" detail="12 of 56 games" centerY={cy} centerX={third * 1.5} />
			<ErrorState title="Connection failed" detail="Could not reach the instance." action={{ label: 'Retry' }} centerY={cy} centerX={third * 2.5} />
		</>
	);
}
