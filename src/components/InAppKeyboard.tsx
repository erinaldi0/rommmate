import React, { useMemo, useRef, useState } from 'react';
import { Rect, Text, useDimensions } from 'react-tela';
import { useCanvasTap } from '../hooks/use-canvas-tap';
import { useDirection, useGamepadButton } from '../hooks/use-gamepad';
import { colors } from '../theme';

interface Props {
	/** The text being edited (shown in the field row above). */
	value: string;
	/** One-line explanation of why the system keyboard is not used. */
	note: string;
	onChange: (value: string) => void;
	/** OK: commit the text and close. */
	onSubmit: () => void;
	/** Close without committing (B, or the X key). */
	onClose: () => void;
}

interface Key {
	label: string;
	act: 'char' | 'space' | 'shift' | 'sym' | 'back' | 'ok' | 'close';
	/** Key width in units (1 = one letter key). */
	w?: number;
}

const KEY_W = 110;
const KEY_H = 48;
const GAP = 6;
/** Vertical pitch between key rows. */
const ROW_PITCH = KEY_H + GAP;
/** The key grid starts here; the panel top is above the note line. */
const GRID_TOP = 432;
const PANEL_TOP = 384;

const char = (label: string): Key => ({ label, act: 'char' });
const BOTTOM: Key[] = [
	{ label: 'space', act: 'space', w: 5 },
	{ label: 'OK', act: 'ok', w: 3 },
	{ label: 'X', act: 'close', w: 2 },
];

/** The five rows for the given mode. */
function buildRows(sym: boolean): Key[][] {
	const row2: Key[] = [
		{ label: '^', act: 'shift' },
		{ label: 'SYM', act: 'sym' },
		...('XCVBNM'.split('').map(char)),
		{ label: '<', act: 'back' },
	];
	const digits = '0123456789'.split('').map(char);
	if (!sym) {
		return [
			'QWERTYUIOP'.split('').map(char),
			'ASDFGHJKL'.split('').map(char),
			row2,
			digits,
			BOTTOM,
		];
	}
	// The symbols real URLs and tokens actually use (plus a few extras).
	return [
		':/.-_@#$%&'.split('').map(char),
		'()<>+=[]{'
			.split('')
			.map(char),
		row2,
		digits,
		BOTTOM,
	];
}

/**
 * The built-in keyboard, shown when the system on-screen keyboard is not
 * available (creation failure) or fails to appear. A compact QWERTY laid
 * out over the bottom of the screen — the same place the real keyboard
 * would occupy — driven by gamepad (d-pad/stick + A/B) or touch.
 */
export function InAppKeyboard({ value, note, onChange, onSubmit, onClose }: Props) {
	const dims = useDimensions();
	const [focus, setFocus] = useState({ r: 0, c: 0 });
	const [shift, setShift] = useState(false);
	const [sym, setSym] = useState(false);

	const rows = useMemo(() => buildRows(sym), [sym]);

	const rowWidth = (row: Key[]) => row.reduce((s, k) => s + (k.w ?? 1) * KEY_W, 0) + (row.length - 1) * GAP;
	const rowX = (row: Key[]) => (dims.width - rowWidth(row)) / 2;
	const keyWidth = (k: Key) => (k.w ?? 1) * KEY_W + ((k.w ?? 1) - 1) * GAP;
	const keyRects = (r: number) => {
		const row = rows[r];
		let x = rowX(row);
		return row.map((k) => {
			const w = keyWidth(k);
			const rect = { x, y: GRID_TOP + r * ROW_PITCH, w, h: KEY_H };
			x += w + GAP;
			return rect;
		});
	};

	function press(r: number, c: number) {
		const k = rows[r]?.[c];
		if (!k) return;
		switch (k.act) {
			case 'char':
				onChange(value + (shift ? k.label.toUpperCase() : k.label));
				if (shift) setShift(false);
				break;
			case 'space':
				onChange(value + ' ');
				break;
			case 'shift':
				setShift((s) => !s);
				break;
			case 'sym':
				setSym((s) => !s);
				break;
			case 'back':
				onChange(value.slice(0, -1));
				break;
			case 'ok':
				onSubmit();
				return;
			case 'close':
				onClose();
				return;
		}
		setFocus({ r, c });
	}

	function move(dr: number, dc: number) {
		setFocus((f) => {
			const r = Math.min(rows.length - 1, Math.max(0, f.r + dr));
			const c = Math.min(rows[r].length - 1, Math.max(0, f.c + dc));
			return { r, c };
		});
	}

	/*
	 * The callbacks must not be re-created on every keystroke: `value`,
	 * `focus`, `shift`, and the inline `onSubmit`/`onClose` props all change
	 * on every character, and a fresh callback identity used to reset the
	 * repeat timer, so a deliberate A press burst into repeated characters
	 * ("captured 3 times"). The refs keep the loop's registration stable.
	 */
	const pressRef = useRef(press);
	pressRef.current = press;
	const moveRef = useRef(move);
	moveRef.current = move;
	const focusRef = useRef(focus);
	focusRef.current = focus;
	const closeRef = useRef(onClose);
	closeRef.current = onClose;

	// Only the keys people hold down repeat (back, space). Character keys
	// never repeat: one deliberate press is exactly one character.
	const focusKey = rows[focus.r]?.[focus.c];
	const repeat = focusKey?.act === 'back' || focusKey?.act === 'space';

	useDirection('Left', () => moveRef.current(0, -1), [rows], true, true, 250, 70);
	useDirection('Right', () => moveRef.current(0, 1), [rows], true, true, 250, 70);
	useDirection('Up', () => moveRef.current(-1, 0), [rows], true, true, 250, 70);
	useDirection('Down', () => moveRef.current(1, 0), [rows], true, true, 250, 70);
	useGamepadButton(
		'A',
		() => {
			const f = focusRef.current;
			pressRef.current(f.r, f.c);
		},
		[repeat],
		true,
		repeat,
		250,
		70,
	);
	useGamepadButton('B', () => closeRef.current(), []);

	useCanvasTap(true, (p) => {
		if (p.y < PANEL_TOP) return;
		for (let r = 0; r < rows.length; r++) {
			const rects = keyRects(r);
			for (let c = 0; c < rects.length; c++) {
				const k = rects[c];
				if (p.x >= k.x && p.x <= k.x + k.w && p.y >= k.y && p.y <= k.y + k.h) {
					press(r, c);
					return;
				}
			}
		}
	});

	const entities: React.ReactNode[] = [];
	rows.forEach((row, r) => {
		keyRects(r).forEach((k, c) => {
			const key = row[c];
			const isFocused = focus.r === r && focus.c === c;
			const isToggled = (key.act === 'shift' && shift) || (key.act === 'sym' && sym);
			const isAction = key.act === 'ok' || key.act === 'close';
			entities.push(
				<Rect
					key={`k${r}-${c}`}
					x={k.x}
					y={k.y}
					width={k.w}
					height={k.h}
					fill={isFocused ? colors.surfaceRaised : isToggled || isAction ? colors.accentMuted : colors.surface}
					stroke={isFocused ? colors.accent : colors.border}
					lineWidth={isFocused ? 3 : 1}
					borderRadius={8}
				/>,
				<Text
					key={`kt${r}-${c}`}
					x={k.x + k.w / 2}
					y={k.y + 13}
					fontSize={20}
					textAlign="center"
					fill={isToggled ? colors.textPrimary : key.act === 'space' ? colors.textMuted : colors.textSecondary}
				>
					{key.label}
				</Text>,
			);
		});
	});

	return (
		<>
			<Rect x={0} y={PANEL_TOP} width={dims.width} height={dims.height - PANEL_TOP} fill={colors.sunken} />
			<Rect x={0} y={PANEL_TOP} width={dims.width} height={2} fill={colors.borderStrong} />
			<Text x={32} y={PANEL_TOP + 12} fontSize={16} fill={colors.textMuted}>
				{note}
			</Text>
			<Text x={dims.width - 32} y={PANEL_TOP + 12} fontSize={16} fill={colors.textFaint} textAlign="right">
				{`B to close · ${value.slice(-24)}`}
			</Text>
			{entities}
		</>
	);
}
