import React, { useEffect, useRef, useState } from 'react';
import { Rect, Text, useDimensions } from 'react-tela';
import { SwkbdType } from '@nx.js/constants';
import { useGamepadButton, useDirection } from '../hooks/use-gamepad';
import { useCanvasTap } from '../hooks/use-canvas-tap';
import { getVirtualKeyboard, virtualKeyboardError } from '../vk';
import { InAppKeyboard } from './InAppKeyboard';
import { BUILD_ID } from '../version';
import type { Config } from '../config';

interface Props {
	/** The config as last saved (pre-filled into the rows). */
	initial: Config;
	/** Status line (connection result), shown above the footer. */
	status: string;
	/** True while a connection attempt is in flight. */
	busy: boolean;
	onSave: (cfg: Config) => void;
	/** Skip the login and open the library with mocked data. */
	onDemo: () => void;
	/** Cancel the in-flight connection (B, while busy). */
	onCancel?: () => void;
}

type Field = 'baseUrl' | 'token';

const ROWS = ['Base URL', 'API Token', 'Save & Connect', 'Demo mode (mock data)'] as const;
const ROW_W = 920;
const ROW_H = 68;
const ROW_GAP = 14;
const ROW_TOP = 200;

function mask(v: string): string {
	if (!v) return '(not set)';
	if (v.length <= 10) return v;
	return v.slice(0, 10) + '•'.repeat(Math.min(16, v.length - 10));
}

export function SettingsScreen({ initial, status, busy, onSave, onDemo, onCancel }: Props) {
	const dims = useDimensions();
	const [cfg, setCfg] = useState<Config>(initial);
	const [focus, setFocus] = useState(0);
	const [draft, setDraft] = useState('');
	const pending = useRef<Field | null>(null);
	const vk = getVirtualKeyboard();
	/** The field the built-in keyboard is editing, or null when it is closed. */
	const [kbd, setKbd] = useState<{ field: Field; note: string } | null>(null);
	/** Mirror of `kbd` for listeners that cannot see the state (geometrychange). */
	const kbdRef = useRef<{ field: Field; note: string } | null>(null);
	/** Monotonic counter for the delayed appear-failure check. */
	const kbdGen = useRef(0);

	/** True once the system keyboard has a non-zero rect (i.e. it is up). */
	const sysKbdUp = useRef(false);

	function startFallback(field: Field, note: string) {
		kbdGen.current += 1;
		pending.current = null;
		kbdRef.current = { field, note };
		setKbd({ field, note });
		setDraft(field === 'baseUrl' ? cfg.baseUrl : cfg.token);
	}

	function closeFallback(commit: boolean) {
		kbdGen.current += 1;
		const field = kbdRef.current?.field;
		kbdRef.current = null;
		setKbd(null);
		setDraft('');
		if (commit && field) {
			setCfg((c) => (field === 'baseUrl' ? { ...c, baseUrl: draft } : { ...c, token: draft }));
		}
	}

	/**
	 * Open the on-screen keyboard for a field.
	 *
	 * `force` is for the user explicitly asking to change a field while a
	 * connection is in flight (a tap on the row, or A/ZR on it): the walk
	 * is running on the values being edited anyway, so cancel it and let
	 * the edit happen — otherwise a launch with saved credentials would
	 * leave the rows untouchable for the whole load.
	 *
	 * The system keyboard fails in two silent ways, and both are covered:
	 * when the object could not be created at all, and when its *appear*
	 * call fails (the object exists, the rect stays zero). Either way the
	 * built-in `InAppKeyboard` takes over, so the field stays editable.
	 */
	function openField(field: Field, force = false) {
		if (busy && !force) return;
		if (busy) onCancel?.();

		// A field re-open closes whatever keyboard was open before.
		kbdGen.current += 1;
		kbdRef.current = null;
		setKbd(null);

		if (vk === null) {
			const err = virtualKeyboardError();
			startFallback(field, `System keyboard unavailable — using built-in${err ? ` (${err.slice(0, 30)})` : ''}`);
			return;
		}

		pending.current = field;
		vk.type = SwkbdType.Normal;
		vk.okButtonText = 'Done';
		vk.value = field === 'baseUrl' ? cfg.baseUrl : cfg.token;
		setDraft(vk.value);
		vk.show();

		// A failed appear leaves the rect at zero (the runtime ignores the
		// failure). Give the keyboard a moment to come up; if it never
		// does, fall back to the built-in one so the field is editable.
		kbdGen.current += 1;
		const gen = kbdGen.current;
		sysKbdUp.current = (vk.boundingRect.height ?? 0) > 0;
		if (!sysKbdUp.current) {
			setTimeout(() => {
				if (gen !== kbdGen.current) return;
				sysKbdUp.current = (vk.boundingRect.height ?? 0) > 0;
				if (!sysKbdUp.current) {
					startFallback(field, 'System keyboard did not appear — using built-in keyboard');
				}
			}, 1200);
		}
	}

	// Commit the keyboard contents when it closes (OK, Back, or any other
	// path that hides it). `pending` guards against stray commits.
	useEffect(() => {
		if (!vk) return;
		const commit = () => {
			const field = pending.current;
			if (!field) return;
			pending.current = null;
			const value = vk.value;
			setDraft('');
			setCfg((c) => (field === 'baseUrl' ? { ...c, baseUrl: value } : { ...c, token: value }));
		};
		const onGeom = () => {
			if (vk.boundingRect.height === 0) {
				commit();
			} else if (kbdRef.current !== null) {
				// The system keyboard came up (perhaps late, after a
				// failed first appear) while the built-in one was open:
				// it owns the bottom of the screen, so hide it and close
				// the built-in one.
				sysKbdUp.current = true;
				kbdGen.current += 1;
				vk.hide();
				kbdRef.current = null;
				setKbd(null);
				setDraft('');
			} else {
				sysKbdUp.current = true;
			}
		};
		const onInput = () => setDraft(vk.value);
		vk.addEventListener('submit', commit);
		vk.addEventListener('cancel', commit);
		vk.addEventListener('geometrychange', onGeom);
		vk.addEventListener('change', onInput);
		vk.addEventListener('cursormove', onInput);
		return () => {
			vk.removeEventListener('submit', commit);
			vk.removeEventListener('cancel', commit);
			vk.removeEventListener('geometrychange', onGeom);
			vk.removeEventListener('change', onInput);
			vk.removeEventListener('cursormove', onInput);
		};
	}, [vk]);

	useDirection('Up', () => setFocus((f) => Math.max(0, f - 1)), [], kbd === null);
	useDirection('Down', () => setFocus((f) => Math.min(ROWS.length - 1, f + 1)), [], kbd === null);

	useGamepadButton(
		'A',
		() => {
			if (focus === 0) openField('baseUrl', true);
			else if (focus === 1) openField('token', true);
			else if (focus === 2) {
				if (!busy) onSave(cfg);
			} else onDemo();
		},
		[focus, cfg, busy, onDemo],
		kbd === null,
	);
	useGamepadButton(
		'ZR',
		() => {
			if (focus === 0) openField('baseUrl', true);
			else if (focus === 1) openField('token', true);
		},
		[focus],
		kbd === null,
	);

	// B closes the built-in keyboard first (discarding the edit); only with
	// no keyboard open does it cancel a connection in flight.
	useGamepadButton(
		'B',
		() => {
			if (kbd) closeFallback(false);
			else if (busy && onCancel) onCancel();
		},
		[busy, onCancel, kbd],
	);

	// A finger is the primary pointer on the Switch: tapping a row does
	// exactly what A on that row does (openField / onSave / onDemo each
	// guard `busy` themselves, so no extra gate is needed here). While the
	// built-in keyboard is open it owns the taps (and the screen bottom).
	const cx = dims.width / 2;
	const rowX = cx - ROW_W / 2;

	useCanvasTap(kbd === null, ({ x, y }) => {
		for (let i = 0; i < ROWS.length; i++) {
			const ry = ROW_TOP + i * (ROW_H + ROW_GAP);
			if (x < rowX || x > rowX + ROW_W || y < ry || y > ry + ROW_H) continue;
			setFocus(i);
			if (i === 0) openField('baseUrl', true);
			else if (i === 1) openField('token', true);
			else if (i === 2) {
				if (!busy) onSave(cfg);
			} else onDemo();
			return;
		}
	});

	const editing = (f: Field) => pending.current === f || kbd?.field === f;
	const rowValue = (i: number): string => {
		if (i === 0) return editing('baseUrl') && draft !== '' ? draft : cfg.baseUrl || '(not set)';
		if (i === 1) return editing('token') && draft !== '' ? draft : mask(cfg.token);
		if (i === 2) return busy ? 'connecting… · B to cancel' : 'A to save & open library';
		return 'A to skip the login and browse mock games';
	};

	const statusError = /fail|cannot|invalid/i.test(status);

	// Rows are emitted as a flat list of root-level entities on purpose.
	// react-tela's <Group> renders into an offscreen canvas and composites it
	// back with drawImage(); that path is fragile on the Switch runtime, and a
	// failure there aborts the whole frame. Absolute positioning keeps every
	// element on the root canvas, where Rect/Text are known to work.
	const rowEntities: React.ReactNode[] = [];
	ROWS.forEach((label, i) => {
		const y = ROW_TOP + i * (ROW_H + ROW_GAP);
		const isFocused = i === focus;
		rowEntities.push(
			<Rect
				key={`${label}-bg`}
				x={rowX}
				y={y}
				width={ROW_W}
				height={ROW_H}
				fill={isFocused ? '#232338' : '#171722'}
				stroke={isFocused ? '#5b8cff' : '#262636'}
				lineWidth={isFocused ? 3 : 1}
				borderRadius={10}
			/>,
			<Text
				key={`${label}-label`}
				x={rowX + 24}
				y={y + 22}
				fontSize={26}
				fill={isFocused ? '#ffffff' : '#9a9ab0'}
			>
				{label}
			</Text>,
			<Text
				key={`${label}-value`}
				x={rowX + 280}
				y={y + 22}
				maxWidth={ROW_W - 310}
				fontSize={24}
				fill="#c8c8e0"
				overflow="ellipsis"
			>
				{rowValue(i)}
			</Text>,
		);
	});

	return (
		<>
			<Rect width={dims.width} height={dims.height} fill="#101018" />

			<Text x={cx} y={64} fontSize={64} fill="#ffffff" textAlign="center">
				RomMmate
			</Text>
			<Text x={cx} y={150} fontSize={28} fill="#9a9ab0" textAlign="center">
				RomM settings
			</Text>
			<Text x={dims.width - 24} y={34} fontSize={18} fill="#5a5a75" textAlign="right">
				{`build ${BUILD_ID}`}
			</Text>

			{rowEntities}

			{status !== '' && (
				<Text x={cx} y={560} fontSize={26} fill={statusError ? '#e06060' : '#9a9ab0'} textAlign="center">
					{status}
				</Text>
			)}

			<Text x={cx} y={dims.height - 52} fontSize={22} fill="#6a6a85" textAlign="center">
				tap a field (or A / ZR) to edit · A on “Save & Connect” to sign in · A on “Demo mode” to skip
			</Text>

			{kbd !== null && (
				<InAppKeyboard
					value={draft}
					note={kbd.note}
					onChange={setDraft}
					onSubmit={() => closeFallback(true)}
					onClose={() => closeFallback(false)}
				/>
			)}
		</>
	);
}
