/**
 * The RetroAchievements settings subscreen (opened from the settings row).
 *
 * These are the *live-tracking* settings: when enabled, the app writes the
 * `cheevos_*` options into `retroarch.cfg` before every launch, and
 * RetroArch's own RAClient detects and saves achievements from there.
 * (The *display* side — the badge, the per-game progress, the achievements
 * screen — reads through RomM and needs no credentials here; the user links
 * their RA account in the RomM web UI for that.)
 *
 * The row layout, text entry and tap model are the settings screen's: the
 * same `useTextEntry` hook (system keyboard → built-in fallback) serves the
 * two credential rows, and every row persists itself on change, exactly like
 * the keyboard and auto-sync rows it sits beside.
 */
import React, { useState } from 'react';
import { Rect, Text, useDimensions } from 'react-tela';
import { useCanvasTap } from '../hooks/use-canvas-tap';
import { useGamepadButton, useDirection } from '../hooks/use-gamepad';
import { useTextEntry, type Field } from '../hooks/use-text-entry';
import { InAppKeyboard } from './InAppKeyboard';
import { Header } from './Header';
import { HintBar } from './HintBar';
import { colors } from '../theme';
import type { Config } from '../config';

interface Props {
	/** The config as last saved (pre-fills the rows). */
	initial: Config;
	/** Return to the settings screen (B). */
	onBack: () => void;
	/**
	 * Persist an RA change. The screen patches only the RA fields; the
	 * handler in App merges, saves and hands the new config to the play
	 * service (so the next launch writes the new `cheevos_*` set).
	 */
	onRaChange: (patch: Partial<Config>) => void;
}

/** One row of this screen: an editable credential, or a toggle. */
type Row =
	| { kind: 'field'; label: string; field: Extract<Field, 'raUsername' | 'raPassword'> }
	| { kind: 'action'; label: string; action: 'enable' | 'hardcore' | 'unofficial' };

const ROWS: Row[] = [
	{ kind: 'action', label: 'Enable RetroAchievements', action: 'enable' },
	{ kind: 'field', label: 'RA username', field: 'raUsername' },
	{ kind: 'field', label: 'RA password', field: 'raPassword' },
	{ kind: 'action', label: 'Hardcore mode', action: 'hardcore' },
	{ kind: 'action', label: 'Unofficial ROMs', action: 'unofficial' },
];

// The row geometry is the settings screen's, shifted down under this
// screen's header and the two-line note.
const ROW_W = 920;
const ROW_H = 48;
const ROW_GAP = 8;
const ROW_TOP = 236;

/** Mask a secret (the password): every character a dot, length clamped. */
function maskSecret(v: string): string {
	return v !== '' ? '•'.repeat(Math.min(16, Math.max(4, v.length))) : '(not set)';
}

export function RAScreen({ initial, onBack, onRaChange }: Props) {
	const dims = useDimensions();
	const [cfg, setCfg] = useState<Config>(initial);
	const [focus, setFocus] = useState(0);

	/** The RA credentials, as the rows show them. */
	function fieldValue(field: Field): string {
		if (field === 'raUsername') return cfg.raUsername ?? '';
		if (field === 'raPassword') return cfg.raPassword ?? '';
		return '';
	}

	const entry = useTextEntry({
		keyboardMode: cfg.keyboard,
		busy: false,
		fieldValue,
		onValue: (field, value) => {
			if (field === 'raUsername') {
				onRaChange({ raUsername: value });
				setCfg((c) => ({ ...c, raUsername: value }));
			} else if (field === 'raPassword') {
				onRaChange({ raPassword: value });
				setCfg((c) => ({ ...c, raPassword: value }));
			}
		},
	});
	const { kbd, draft, sysKbd, setDraft } = entry;

	function toggle(action: 'enable' | 'hardcore' | 'unofficial') {
		if (action === 'enable') {
			const next = cfg.raEnabled !== true;
			onRaChange({ raEnabled: next });
			setCfg((c) => ({ ...c, raEnabled: next }));
		} else if (action === 'hardcore') {
			const next = cfg.raHardcore !== true;
			onRaChange({ raHardcore: next });
			setCfg((c) => ({ ...c, raHardcore: next }));
		} else {
			const next = cfg.raUnofficialRoms !== true;
			onRaChange({ raUnofficialRoms: next });
			setCfg((c) => ({ ...c, raUnofficialRoms: next }));
		}
	}

	function activateRow(i: number) {
		const row = ROWS[i];
		if (row === undefined) return;
		if (row.kind === 'field') entry.openField(row.field, true);
		else toggle(row.action);
	}

	useDirection('Up', () => setFocus((f) => Math.max(0, f - 1)), [], kbd === null);
	useDirection(
		'Down',
		() => setFocus((f) => Math.min(ROWS.length - 1, f + 1)),
		[ROWS.length],
		kbd === null,
	);
	useGamepadButton('A', () => activateRow(focus), [focus, cfg], kbd === null);
	useGamepadButton(
		'ZR',
		() => {
			const row = ROWS[focus];
			if (row?.kind === 'field') entry.openField(row.field, true);
		},
		[focus, cfg],
		kbd === null,
	);
	useGamepadButton(
		'B',
		() => {
			if (entry.kbd) entry.closeField(false);
			else onBack();
		},
		[onBack, entry.kbd],
	);

	const cx = dims.width / 2;
	const rowX = cx - ROW_W / 2;

	useCanvasTap(kbd === null, ({ x, y }) => {
		for (let i = 0; i < ROWS.length; i++) {
			const ry = ROW_TOP + i * (ROW_H + ROW_GAP);
			if (x < rowX || x > rowX + ROW_W || y < ry || y > ry + ROW_H) continue;
			setFocus(i);
			activateRow(i);
			return;
		}
	});

	function rowValue(row: Row): string {
		if (row.kind === 'field') {
			// While being typed the echo shows (masked for the password).
			if (entry.editing(row.field) && draft !== '') {
				return row.field === 'raPassword' ? maskSecret(draft) : draft;
			}
			const v = fieldValue(row.field);
			return row.field === 'raPassword' ? maskSecret(v) : v || '(not set)';
		}
		if (row.action === 'enable') return cfg.raEnabled === true ? 'on — A to turn off' : 'off — A to turn on';
		if (row.action === 'hardcore')
			return cfg.raHardcore === true
				? 'on — no saves, cheats or rewind (A to turn off)'
				: 'off — A to turn on';
		return cfg.raUnofficialRoms === true
			? 'on — also track dumps RA does not recognise (A to turn off)'
			: 'off — A to turn on';
	}

	// Rows are emitted as a flat list of root-level entities on purpose
	// (the settings screen's rule): react-tela's <Group> composites through
	// an offscreen canvas, which is fragile on the Switch runtime. Absolute
	// positioning keeps every element on the root canvas, where Rect/Text
	// are known to work.
	const rowEntities: React.ReactNode[] = [];
	ROWS.forEach((row, i) => {
		const y = ROW_TOP + i * (ROW_H + ROW_GAP);
		const isFocused = i === focus;
		rowEntities.push(
			<Rect
				key={`row-${i}-bg`}
				x={rowX}
				y={y}
				width={ROW_W}
				height={ROW_H}
				fill={isFocused ? colors.surfaceRaised : '#171722'}
				stroke={isFocused ? colors.accent : '#262636'}
				lineWidth={isFocused ? 3 : 1}
				borderRadius={10}
			/>,
			<Text
				key={`row-${i}-label`}
				x={rowX + 24}
				y={y + 14}
				fontSize={24}
				fill={isFocused ? '#ffffff' : '#9a9ab0'}
			>
				{row.label}
			</Text>,
			<Text
				key={`row-${i}-value`}
				x={rowX + 280}
				y={y + 15}
				maxWidth={ROW_W - 310}
				fontSize={22}
				fill="#c8c8e0"
				overflow="ellipsis"
			>
				{rowValue(row)}
			</Text>,
		);
	});

	return (
		<>
			<Rect width={dims.width} height={dims.height} fill={colors.bg} />
			<Header
				title="RetroAchievements"
				subtitle="live achievement tracking, written into RetroArch before every launch"
			/>

			<Text
				x={cx}
				y={158}
				fontSize={18}
				fill={colors.textMuted}
				textAlign="center"
				maxWidth={1000}
				lineHeight={1.5}
			>
				{[
					'When enabled, RetroArch detects the ROM you start, unlocks achievements while you play, and saves your progress to your RA account.',
					'Progress and the per-game achievements list are shown through RomM — link your RA account in the RomM web UI for that.',
				]}
			</Text>

			{rowEntities}

			<HintBar
				hints={[
					kbd !== null
						? 'B close keyboard'
						: `A ${ROWS[focus]?.kind === 'field' ? 'edit' : 'change'}`,
					sysKbd
						? 'B dismiss system keyboard'
						: 'B back',
				]}
			/>

			{kbd !== null && (
				<InAppKeyboard
					value={draft}
					note={kbd.note}
					mask={kbd.field === 'raPassword' || kbd.field === 'password'}
					onChange={setDraft}
					onSubmit={() => entry.closeField(true)}
					onClose={() => entry.closeField(false)}
				/>
			)}
		</>
	);
}
