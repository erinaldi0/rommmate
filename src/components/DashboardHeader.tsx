/**
 * The dashboard's header — the app's face on the home screen.
 *
 * Louder than the shared `Header` by design: the dashboard is the one
 * screen where the app brands itself. A glyph tile and the product name
 * sit on the left under a tagline; the library count and the build stamp
 * sit on the right, next to the settings gear (a tap opens settings; on
 * the gamepad, B does the same).
 *
 * All drawn shapes: the device font has no emoji, so the glyphs are simple
 * abstractions — a controller-ish pill for the tile, a ring with teeth for
 * the gear.
 */
import React from 'react';
import { Rect, Text, useDimensions, useParent } from 'react-tela';
import { colors, fontFamily, fontSize, radius, space } from '../theme';
import { useCanvasTap } from '../hooks/use-canvas-tap';

interface Props {
	/** Right-aligned count, e.g. "1214 games". */
	meta?: string;
	/** Build identifier under the count. */
	build?: string;
	/** Line under the title: the tagline, or a status/error message. */
	subtitle?: string;
	/** True on a monospace-ish danger line (connection failures). */
	error?: boolean;
	/** The settings gear was tapped. */
	onSettings?: () => void;
}

/** The glyph tile in the top-left corner. */
const TILE = { x: space.xl, y: 14, size: 54 };

/** The gear's bounding box, from the screen edge (mirror of the tile). */
const GEAR = { margin: space.xl, size: 44, y: 19 };

export function DashboardHeader({ meta = '', build = '', subtitle = '', error = false, onSettings }: Props) {
	const dims = useDimensions();

	const gearX = dims.width - GEAR.margin - GEAR.size;

	useCanvasTap(true, (p) => {
		if (onSettings === undefined) return;
		if (
			p.x >= gearX - 8 &&
			p.x <= gearX + GEAR.size + 8 &&
			p.y >= GEAR.y - 8 &&
			p.y <= GEAR.y + GEAR.size + 8
		) {
			onSettings();
		}
	});

	return (
		<>
			{/* ── the glyph tile ─────────────────────────────────────── */}
			<Rect
				x={TILE.x}
				y={TILE.y}
				width={TILE.size}
				height={TILE.size}
				fill={colors.surfaceRaised}
				stroke={colors.borderStrong}
				lineWidth={1}
				borderRadius={radius.lg}
			/>
			{/* A controller: one pill body, a stick and two face dots. */}
			<Rect
				x={TILE.x + 11}
				y={TILE.y + 21}
				width={32}
				height={16}
				fill={colors.textMuted}
				borderRadius={radius.pill}
			/>
			<Rect
				x={TILE.x + 15}
				y={TILE.y + 24}
				width={7}
				height={7}
				fill={colors.surfaceRaised}
				borderRadius={radius.pill}
			/>
			<Rect
				x={TILE.x + 34}
				y={TILE.y + 26}
				width={5}
				height={5}
				fill={colors.surfaceRaised}
				borderRadius={radius.pill}
			/>

			{/* ── name + tagline ─────────────────────────────────────── */}
			<Text
				x={TILE.x + TILE.size + 16}
				// Alphabetic baseline: the display size's ascent is tall, so the
				// baseline sits mid-tile — a higher y pushes the caps off-screen.
				y={TILE.y + 30}
				fontFamily={fontFamily}
				fontSize={fontSize.display}
				textBaseline="alphabetic"
				fill={colors.textPrimary}
			>
				RomMmate
			</Text>
			<Text
				x={TILE.x + TILE.size + 18}
				y={TILE.y + TILE.size + 6}
				fontFamily={fontFamily}
				fontSize={fontSize.tiny}
				textBaseline="alphabetic"
				fill={error ? colors.danger : colors.textFaint}
			>
				{subtitle !== '' ? subtitle : 'YOUR RETRO COLLECTION'}
			</Text>

			{/* ── right: count, build, gear ───────────────────────── */}
			{meta !== '' && (
				<Text
					x={gearX - GEAR.size}
					y={TILE.y + 6}
					fontFamily={fontFamily}
					fontSize={fontSize.heading}
					textBaseline="alphabetic"
					fill={colors.textSecondary}
					textAlign="right"
				>
					{meta}
				</Text>
			)}
			{build !== '' && (
				<Text
					x={gearX - GEAR.size}
					y={TILE.y + TILE.size + 6}
					fontFamily={fontFamily}
					fontSize={fontSize.tiny}
					textBaseline="alphabetic"
					fill={colors.textFaint}
					textAlign="right"
				>
					{`build ${build}`}
				</Text>
			)}

			{/* ── the settings gear ──────────────────────────────────── */}
			{(() => {
				const cx = gearX + GEAR.size / 2;
				const cy = GEAR.y + GEAR.size / 2;
				const r = 11;
				const teeth: React.ReactNode[] = [];
				for (const [dx, dy] of [
					[r, 0],
					[-r, 0],
					[0, r],
					[0, -r],
				] as const) {
					teeth.push(
						<Rect
							key={`tooth-${dx}-${dy}`}
							x={cx + dx - 3}
							y={cy + dy - 3}
							width={6}
							height={6}
							fill={colors.textFaint}
							borderRadius={2}
						/>,
					);
				}
				return (
					<>
						{teeth}
						<Rect
							x={cx - r}
							y={cy - r}
							width={r * 2}
							height={r * 2}
							stroke={colors.textFaint}
							lineWidth={4}
							borderRadius={radius.pill}
							fill={colors.bg}
						/>
						<Rect
							x={cx - 4}
							y={cy - 4}
							width={8}
							height={8}
							fill={colors.bg}
						/>
						{/* The hit box, for the tap above to have something to check. */}
						<Rect x={gearX} y={GEAR.y} width={GEAR.size} height={GEAR.size} fill={colors.bg} alpha={0} />
					</>
				);
			})()}

			{/* The count's small icon: a tiny cartridge above the meta. */}
		</>
	);
}
