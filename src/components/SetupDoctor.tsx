import React, { useEffect, useState } from 'react';
import { Rect, Text, useDimensions } from 'react-tela';
import { colors, fontFamily, fontSize, radius, space } from '../theme';
import { useGamepadButton, useDirection } from '../hooks/use-gamepad';
import { Header } from './Header';
import { HintBar } from './HintBar';
import { BUILD_ID } from '../version';
import { play, type DoctorReport } from '../play';
import { openWebApplet } from '../launch';
import { Spinner } from './Spinner';

interface Props {
	/** Return (to the library or settings, per the caller). */
	onBack: () => void;
	/** The RomM base URL (for the "open the web UI" action). */
	baseUrl: string;
	/** The platforms the doctor should check (name + server id). */
	platforms: Array<{ name: string; id: number }>;
}

const LIST_TOP = 128;
const ROW_H = 34;
const LIST_X = 72;

/**
 * The Play setup doctor: one row per prerequisite (sync routes, the
 * RetroArch platform, the loader, one core per emulable platform, the
 * BIOS, the SD card), each with a note on what to do when it is not met —
 * plus the three things the user can do about it from the console.
 *
 * The checklist is a report, not controls: the focus walk covers the
 * actions only (any direction moves between them), so the focus never
 * lands on a row that cannot act — or on one of the rows the screen
 * culls once the checklist outgrows the space above the actions.
 */
export function SetupDoctor({ onBack, baseUrl, platforms }: Props) {
	const dims = useDimensions();
	const [report, setReport] = useState<DoctorReport | null>(null);
	const [busy, setBusy] = useState(true);
	const [status, setStatus] = useState('');

	// The checklist runs once on arrival; a re-press of A re-runs it.
	useEffect(() => {
		setBusy(true);
		setStatus('');
		void play
			.doctor(platforms)
			.then((r) => {
				setReport(r);
				setBusy(false);
			})
			.catch(() => {
				setBusy(false);
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [JSON.stringify(platforms)]);

	const actions = ['Download all missing', 'Open RomM web UI', 'Re-check'];
	const checklist = report?.rows ?? [];

	// See the module comment: the walk covers the actions only, and every
	// axis moves between them (on a single row of pills, a dead direction
	// would be a trap).
	const [focus, setFocus] = useState(0);
	const focusClamped = Math.min(Math.max(0, focus), actions.length - 1);
	const moveFocus = (delta: number) => setFocus((f) => Math.min(Math.max(0, f + delta), actions.length - 1));

	const fix = () => {
		setStatus('Working…');
		void play
			.fix()
			.then((s) => {
				setStatus(s);
				// The queue badge now shows the work; re-check what the
				// server side still lacks.
				void play.doctor(platforms).then(setReport);
			})
			.catch((err) => setStatus(err instanceof Error ? err.message : String(err)));
	};

	const openWeb = () => {
		if (baseUrl.trim() === '') {
			setStatus('No base URL saved — set it in the connection settings');
			return;
		}
		void openWebApplet(baseUrl.startsWith('http') ? baseUrl : `http://${baseUrl}`).then((r) =>
			setStatus(r.ok ? 'Opened the RomM web UI' : r.error ?? 'could not open the browser'),
		);
	};

	const recheck = () => {
		setBusy(true);
		void play
			.doctor(platforms)
			.then((r) => {
				setReport(r);
				setStatus(r.needsWork ? 'still missing pieces' : 'all clear');
			})
			.finally(() => setBusy(false));
	};

	/** Run the focused action (the checklist rows are informational). */
	function activate(i: number) {
		if (i === 0) fix();
		else if (i === 1) openWeb();
		else recheck();
	}

	useDirection('Up', () => moveFocus(-1), [actions.length]);
	useDirection('Down', () => moveFocus(1), [actions.length]);
	useDirection('Left', () => moveFocus(-1), [actions.length]);
	useDirection('Right', () => moveFocus(1), [actions.length]);
	useGamepadButton('A', () => activate(focusClamped), [focusClamped, baseUrl]);
	useGamepadButton('B', onBack, [onBack]);

	const actionY = dims.height - 128;
	const pillW =
		(dims.width - LIST_X * 2 - (actions.length - 1) * space.md) / actions.length;
	// The checklist may not run into the action pills.
	const maxRows = Math.max(0, Math.floor((actionY - 8 - LIST_TOP) / ROW_H));

	return (
		<>
			<Rect width={dims.width} height={dims.height} fill={colors.bg} />
			<Header title="Play setup" subtitle="what the console needs to play from your library" build={BUILD_ID} />

			{busy ? (
				<>
					<Spinner x={LIST_X + 12} y={LIST_TOP + 20} />
					<Text x={LIST_X + 40} y={LIST_TOP + 8} fontFamily={fontFamily} fontSize={fontSize.body} fill={colors.textSecondary}>
						checking the server…
					</Text>
				</>
			) : (
				<>
					{checklist.slice(0, maxRows).map((row, i) => {
						const y = LIST_TOP + i * ROW_H;
						return (
							<React.Fragment key={row.label}>
								<Text
									x={LIST_X}
									y={y + 2}
									fontFamily={fontFamily}
									fontSize={fontSize.small}
									fill={row.ok ? colors.success : colors.warning}
								>
									{row.ok ? '✓' : '!'}
								</Text>
								<Text
									x={LIST_X + 28}
									y={y + 2}
									fontFamily={fontFamily}
									fontSize={fontSize.small}
									fill={colors.textSecondary}
									maxWidth={300}
									overflow="ellipsis"
								>
									{row.label}
								</Text>
								<Text
									x={LIST_X + 340}
									y={y + 2}
									fontFamily={fontFamily}
									fontSize={fontSize.tiny}
									fill={row.ok ? colors.textFaint : colors.textMuted}
									maxWidth={dims.width - LIST_X - 380}
									overflow="ellipsis"
								>
									{row.note}
								</Text>
							</React.Fragment>
						);
					})}
					{checklist.length > maxRows && (
						<Text
							x={LIST_X}
							y={LIST_TOP + maxRows * ROW_H + 2}
							fontFamily={fontFamily}
							fontSize={fontSize.tiny}
							fill={colors.textFaint}
						>
							+{checklist.length - maxRows} more (open the web UI for the full list)
						</Text>
					)}
				</>
			)}

			{actions.map((label, i) => {
				const focused = i === focusClamped;
				const x = LIST_X + i * (pillW + space.md);
				return (
					<React.Fragment key={label}>
						<Rect
							x={x}
							y={actionY}
							width={pillW}
							height={44}
							fill={focused ? colors.accentMuted : colors.surface}
							stroke={focused ? colors.accent : colors.borderStrong}
							lineWidth={focused ? 3 : 1}
							borderRadius={radius.lg}
						/>
						<Text
							x={x + pillW / 2}
							y={actionY + 14}
							fontFamily={fontFamily}
							fontSize={fontSize.body}
							fill={focused ? colors.textPrimary : colors.textSecondary}
							textAlign="center"
						>
							{label}
						</Text>
					</React.Fragment>
				);
			})}

			{status !== '' && (
				<Text
					x={dims.width / 2}
					y={actionY - 18}
					fontFamily={fontFamily}
					fontSize={fontSize.small}
					fill={/fail|missing|no |cannot|error/i.test(status) ? colors.danger : colors.textMuted}
					textAlign="center"
					maxWidth={dims.width - 120}
					overflow="ellipsis"
				>
					{status}
				</Text>
			)}

			<HintBar hints={[`A ${actions[focusClamped].toLowerCase()}`, 'B back']} />
		</>
	);
}
