import React, { useEffect, useRef, useState } from 'react';
import { Rect, Text, useDimensions } from 'react-tela';
import { SwkbdType } from '@nx.js/constants';
import { forceResumeGamepadLoop, useGamepadButton, useDirection, useGamepadEscape } from '../hooks/use-gamepad';
import { useCanvasTap } from '../hooks/use-canvas-tap';
import { getVirtualKeyboard, virtualKeyboardError } from '../vk';
import { InAppKeyboard } from './InAppKeyboard';
import { BUILD_ID } from '../version';
import {
	AUTH_METHODS,
	DEFAULT_AUTH_METHOD,
	KEYBOARD_MODES,
	credentialLabel,
	type AuthMethod,
	type Config,
	type KeyboardMode,
} from '../config';

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
	/** Persist a keyboard-mode change (the last row). */
	onKeyboardChange: (mode: KeyboardMode) => void;
}

type Field = 'baseUrl' | 'token' | 'username' | 'password' | 'pairingCode';

/** A settings row: an editable text field, or a named action. */
type Row =
	| { kind: 'field'; label: string; field: Field }
	| { kind: 'action'; label: string; action: 'method' | 'save' | 'demo' | 'keyboard' };

// Labels must stay short: the value column starts 280 px in, and a longer
// label ("Demo mode (mock data)" did) runs straight into the value text.
const METHOD_LABEL: Record<AuthMethod, string> = {
	token: 'API token',
	password: 'password grant',
	pairing: 'pairing code',
};

/**
 * Which rows the screen shows. The credential row (and, for the password
 * grant, a second one) follows the sign-in method — everything else is
 * constant.
 */
function buildRows(method: AuthMethod): Row[] {
	const credentialField: Field =
		method === 'password' ? 'username' : method === 'pairing' ? 'pairingCode' : 'token';
	const passwordRows: Row[] =
		method === 'password' ? [{ kind: 'field', label: 'Password', field: 'password' }] : [];
	return [
		{ kind: 'field', label: 'Base URL', field: 'baseUrl' },
		{ kind: 'action', label: 'Sign in with', action: 'method' },
		{ kind: 'field', label: credentialLabel(method), field: credentialField },
		...passwordRows,
		{ kind: 'action', label: 'Save & Connect', action: 'save' },
		{ kind: 'action', label: 'Demo mode', action: 'demo' },
		{ kind: 'action', label: 'Keyboard', action: 'keyboard' },
	];
}

// Up to seven rows (password grant) must clear the status line.
const ROW_W = 920;
const ROW_H = 52;
const ROW_GAP = 10;
const ROW_TOP = 172;

function mask(v: string): string {
	if (!v) return '(not set)';
	if (v.length <= 10) return v;
	return v.slice(0, 10) + '•'.repeat(Math.min(16, v.length - 10));
}

/**
 * Mask a secret that must not be readable at all (the password). Unlike
 * `mask`, which keeps the `rmm_` prefix of a long token visible, every
 * character becomes a dot — and the length is clamped so the row never
 * grows past its neighbours.
 */
function maskSecret(v: string): string {
	return v ? '•'.repeat(Math.min(16, Math.max(4, v.length))) : '(not set)';
}

export function SettingsScreen({ initial, status, busy, onSave, onDemo, onCancel, onKeyboardChange }: Props) {
	const dims = useDimensions();
	const [cfg, setCfg] = useState<Config>(initial);
	const method = cfg.authMethod ?? DEFAULT_AUTH_METHOD;
	const rows = buildRows(method);
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
	/** State mirror of `sysKbdUp`, for the on-screen indicator only. */
	const [sysKbd, setSysKbd] = useState(false);

	/** Current value of an editable field (pre-fill for the keyboards). */
	function fieldValue(field: Field): string {
		switch (field) {
			case 'baseUrl':
				return cfg.baseUrl;
			case 'token':
				return cfg.token;
			case 'username':
				return cfg.username ?? '';
			case 'password':
				return cfg.password ?? '';
			case 'pairingCode':
				return cfg.pairingCode ?? '';
		}
	}

	/** The Config patch that stores an edited field. */
	function patchFor(field: Field, value: string): Partial<Config> {
		switch (field) {
			case 'baseUrl':
				return { baseUrl: value };
			case 'token':
				return { token: value };
			case 'username':
				return { username: value };
			case 'password':
				return { password: value };
			case 'pairingCode':
				return { pairingCode: value };
		}
	}

	function startFallback(field: Field, note: string) {
		kbdGen.current += 1;
		pending.current = null;
		kbdRef.current = { field, note };
		setKbd({ field, note });
		setDraft(fieldValue(field));
	}

	function closeFallback(commit: boolean) {
		kbdGen.current += 1;
		const field = kbdRef.current?.field;
		kbdRef.current = null;
		setKbd(null);
		setDraft('');
		if (commit && field) {
			setCfg((c) => ({ ...c, ...patchFor(field, draft) }));
		}
	}

	/**
	 * Dismiss the system keyboard and take the input back. Only reachable
	 * while it is up (the loop runs B through the escape path then): on
	 * emulators the inline keyboard is headless, so without this the player
	 * could open it and have no way to close it.
	 */
	function dismissSystemKbd() {
		pending.current = null;
		setDraft('');
		sysKbdUp.current = false;
		setSysKbd(false);
		try {
			vk?.hide();
		} catch {
			/* a hide that fails is still a dismissal for our purposes */
		}
		// Some emulators keep a non-zero rect after hide. If the rect never
		// drops to zero, force the input loop back to normal handling.
		setTimeout(() => {
			if ((vk?.boundingRect.height ?? 0) > 0) forceResumeGamepadLoop();
		}, 400);
	}

	/** Cycle the Keyboard row: auto → system → built-in. */
	function cycleKeyboard() {
		const order = KEYBOARD_MODES;
		const i = order.indexOf(cfg.keyboard ?? 'builtin');
		const next = order[(i + 1) % order.length];
		setCfg((c) => ({ ...c, keyboard: next }));
		onKeyboardChange(next);
	}

	/** Cycle the "Sign in with" row: API token → password grant → pairing code. */
	function cycleMethod() {
		const order = AUTH_METHODS;
		const i = order.indexOf(method);
		const next = order[(i + 1) % order.length];
		setCfg((c) => ({ ...c, authMethod: next }));
		// The credential rows below change with the method (the password
		// grant adds one): keep the focus on a row that still exists.
		setFocus((f) => Math.min(f, buildRows(next).length - 1));
	}

	/** Do what A on row `i` does — shared by the A button and a tap. */
	function activateRow(i: number) {
		const row = rows[i];
		if (!row) return;
		if (row.kind === 'field') openField(row.field, true);
		else if (row.action === 'method') cycleMethod();
		else if (row.action === 'save') {
			if (!busy) onSave(cfg);
		} else if (row.action === 'demo') onDemo();
		else cycleKeyboard();
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

		// `builtin` skips the system keyboard entirely: on emulators the
		// inline swkbd is headless (it reports itself up, captures every
		// key, and never renders), so the built-in keyboard is the only
		// one the player can actually see and drive.
		if ((cfg.keyboard ?? 'builtin') === 'builtin') {
			startFallback(field, 'Built-in keyboard (Keyboard setting)');
			return;
		}

		if (vk === null) {
			const err = virtualKeyboardError();
			startFallback(field, `System keyboard unavailable — using built-in${err ? ` (${err.slice(0, 30)})` : ''}`);
			return;
		}

		pending.current = field;
		// SwkbdType has no password variant, so the system keyboard cannot
		// mask — for secrets prefer the built-in Keyboard setting.
		vk.type = SwkbdType.Normal;
		vk.okButtonText = 'Done';
		vk.value = fieldValue(field);
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
			setCfg((c) => ({ ...c, ...patchFor(field, value) }));
		};
		const onGeom = () => {
			setSysKbd((vk.boundingRect.height ?? 0) > 0);
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
		const onInput = () => {
			// Only while we are actually editing through the system
			// keyboard: after a B-dismiss the field is ours again, and a
			// zombie keyboard must not overwrite the draft (a headless
			// emulator keyboard keeps pushing its buffer forever).
			if (pending.current !== null) setDraft(vk.value);
		};
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
	useDirection(
		'Down',
		() => setFocus((f) => Math.min(rows.length - 1, f + 1)),
		[rows.length],
		kbd === null,
	);

	useGamepadButton(
		'A',
		() => activateRow(focus),
		[focus, cfg, busy, onDemo, onSave, onKeyboardChange],
		kbd === null,
	);
	useGamepadButton(
		'ZR',
		() => {
			const row = rows[focus];
			if (row?.kind === 'field') openField(row.field, true);
		},
		[focus, cfg],
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

	// While the SYSTEM keyboard is up the loop ignores the normal buttons
	// (the keyboard owns the controller); B stays live through the escape
	// path so a keyboard that never becomes visible can still be dismissed.
	useGamepadEscape('B', () => {
		if (pending.current !== null) dismissSystemKbd();
	}, [vk, pending]);

	// A finger is the primary pointer on the Switch: tapping a row does
	// exactly what A on that row does (openField / onSave / onDemo each
	// guard `busy` themselves, so no extra gate is needed here). While the
	// built-in keyboard is open it owns the taps (and the screen bottom).
	const cx = dims.width / 2;
	const rowX = cx - ROW_W / 2;

	useCanvasTap(kbd === null, ({ x, y }) => {
		for (let i = 0; i < rows.length; i++) {
			const ry = ROW_TOP + i * (ROW_H + ROW_GAP);
			if (x < rowX || x > rowX + ROW_W || y < ry || y > ry + ROW_H) continue;
			setFocus(i);
			activateRow(i);
			return;
		}
	});

	const editing = (f: Field) => pending.current === f || kbd?.field === f;
	const rowValue = (row: Row): string => {
		if (row.kind === 'field') {
			// Secrets (the API token, the password) are masked at rest and
			// shown while being typed — the echo is the only feedback the
			// built-in keyboard gives.
			if (editing(row.field) && draft !== '') {
				return row.field === 'password' ? maskSecret(draft) : draft;
			}
			const v = fieldValue(row.field);
			if (row.field === 'password') return maskSecret(v);
			if (row.field === 'token') return mask(v);
			return v || '(not set)';
		}
		if (row.action === 'method') return `${METHOD_LABEL[method]} — A to change`;
		if (row.action === 'save') return busy ? 'connecting… · B to cancel' : 'A to save & open library';
		if (row.action === 'demo') return 'A to skip the login and browse mock games';
		return `${cfg.keyboard ?? 'builtin'} — A to change`;
	};

	const statusError = /fail|cannot|invalid/i.test(status);

	// Rows are emitted as a flat list of root-level entities on purpose.
	// react-tela's <Group> renders into an offscreen canvas and composites it
	// back with drawImage(); that path is fragile on the Switch runtime, and a
	// failure there aborts the whole frame. Absolute positioning keeps every
	// element on the root canvas, where Rect/Text are known to work.
	const rowEntities: React.ReactNode[] = [];
	rows.forEach((row, i) => {
		const y = ROW_TOP + i * (ROW_H + ROW_GAP);
		const isFocused = i === focus;
		rowEntities.push(
			<Rect
				key={`row-${i}-bg`}
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

	// Below the last row, but always above the footer hint.
	const statusY = Math.min(ROW_TOP + rows.length * (ROW_H + ROW_GAP) + 24, dims.height - 130);

	return (
		<>
			<Rect width={dims.width} height={dims.height} fill="#101018" />

			<Text x={cx} y={52} fontSize={64} fill="#ffffff" textAlign="center">
				RomMmate
			</Text>
			<Text x={cx} y={130} fontSize={28} fill="#9a9ab0" textAlign="center">
				RomM settings
			</Text>
			<Text x={dims.width - 24} y={34} fontSize={18} fill="#5a5a75" textAlign="right">
				{`build ${BUILD_ID}`}
			</Text>

			{rowEntities}

			{status !== '' && !sysKbd && (
				<Text x={cx} y={statusY} fontSize={26} fill={statusError ? '#e06060' : '#9a9ab0'} textAlign="center">
					{status}
				</Text>
			)}

			<Text
				x={cx}
				y={dims.height - 52}
				fontSize={22}
				fill={sysKbd ? '#e0a060' : '#6a6a85'}
				textAlign="center"
			>
				{sysKbd
					? 'System keyboard is up (invisible on emulators) — press B to dismiss it'
					: kbd !== null
					  ? 'B to close the keyboard'
					  : 'tap a row (or A / ZR) to edit · A on a switcher row to change it · A on “Save & Connect” to sign in'}
			</Text>

			{kbd !== null && (
				<InAppKeyboard
					value={draft}
					note={kbd.note}
					mask={kbd.field === 'password'}
					onChange={setDraft}
					onSubmit={() => closeFallback(true)}
					onClose={() => closeFallback(false)}
				/>
			)}
		</>
	);
}
