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
 * plus the two things the user can do about it from the console.
 */
export function SetupDoctor({ onBack, baseUrl, platforms }: Props) {
	const dims = useDimensions();
	const [report, setReport] = useState<DoctorReport | null>(null);
	const [busy, setBusy] = useState(true);
	const [status, setStatus] = useState('');
	const [focus, setFocus] = useState(0);

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
	const total = checklist.length + actions.length;
	const focusClamped = Math.min(focus, total - 1);

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

	function activate(i: number) {
		if (i < checklist.length) return; // checklist rows are informational
		const which = i - checklist.length;
		if (which === 0) fix();
		else if (which === 1) openWeb();
		else recheck();
	}

	useDirection('Up', () => setFocus((f) => Math.max(0, f - 1)), []);
	useDirection('Down', () => setFocus((f) => Math.min(total - 1, f + 1)), [total]);
	useGamepadButton('A', () => activate(focusClamped), [focusClamped, checklist.length, baseUrl]);
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
						const focused = i === focusClamped;
						return (
							<React.Fragment key={row.label}>
								<Rect
									x={LIST_X - 12}
									y={y - 6}
									width={dims.width - LIST_X * 2 + 24}
									height={ROW_H}
									fill={focused ? colors.surfaceRaised : colors.surface}
									stroke={focused ? colors.accent : colors.border}
									lineWidth={focused ? 2 : 1}
									borderRadius={radius.sm}
								/>
								<Text
									x={LIST_X}
									y={y + 2}
									fontFamily={fontFamily}
									fontSize={fontSize.small}
									fontWeight="bold"
									fill={row.ok ? colors.success : colors.warning}
								>
									{row.ok ? '✓' : '!'}
								</Text>
								<Text
									x={LIST_X + 28}
									y={y + 2}
									fontFamily={fontFamily}
									fontSize={fontSize.small}
									fill={focused ? colors.textPrimary : colors.textSecondary}
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
				const which = checklist.length + i;
				const focused = which === focusClamped;
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
							fontWeight="bold"
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

			<HintBar hints={['A ' + (focusClamped < (report?.rows.length ?? 0) ? 'check' : actions[Math.min(2, focusClamped - (report?.rows.length ?? 0))] ?? 'do'), 'B back']} />
		</>
	);
}
