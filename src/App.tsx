import React, { useEffect, useState } from 'react';
import { Circle, Rect, Text, useDimensions } from 'react-tela';
import { AppletType } from '@nx.js/constants';
import { useGamepadButton } from './hooks/use-gamepad';

function describeMode(): string {
	try {
		switch (Switch.appletType()) {
			case AppletType.Application:
				return 'Application (full memory, GPU canvas)';
			case AppletType.LibraryApplet:
				return 'Library applet (hbmenu — reduced memory, CPU canvas)';
			case AppletType.SystemApplet:
			case AppletType.OverlayApplet:
				return 'System applet (reduced memory)';
			default:
				return `unknown (${Switch.appletType()})`;
		}
	} catch {
		return 'unknown';
	}
}

/**
 * Stack smoke test: proves rendering (react-tela on the Switch canvas),
 * gamepad input (Web Gamepad) and touch input in one screen.
 */
export function App() {
	const dims = useDimensions();
	const [mode] = useState(describeMode);
	const [padId, setPadId] = useState('no controller');
	const [lastInput, setLastInput] = useState('—');
	const [presses, setPresses] = useState(0);
	const [touches, setTouches] = useState(0);
	const [touchPos, setTouchPos] = useState<{ x: number; y: number } | null>(null);

	// Poll for a connected controller (its id shows hardware identity).
	useEffect(() => {
		const id = setInterval(() => {
			const gp = navigator.getGamepads()[0];
			if (gp && gp.id) setPadId(gp.id);
		}, 1000);
		return () => clearInterval(id);
	}, []);

	const press = (name: string) => () => {
		setLastInput(name);
		setPresses((p) => p + 1);
	};

	useGamepadButton('A', press('A'));
	useGamepadButton('B', press('B'));
	useGamepadButton('X', press('X'));
	useGamepadButton('Y', press('Y'));
	useGamepadButton('Up', press('D-Pad Up'));
	useGamepadButton('Down', press('D-Pad Down'));
	useGamepadButton('Left', press('D-Pad Left'));
	useGamepadButton('Right', press('D-Pad Right'));

	const cx = dims.width / 2;

	return (
		<>
			{/* Full-screen background doubles as the touch surface. */}
			<Rect
				width={dims.width}
				height={dims.height}
				fill="#101018"
				onTouchMove={(e) => {
					const t = e.changedTouches[0];
					setTouches((n) => n + 1);
					setTouchPos({ x: t.clientX, y: t.clientY });
				}}
			/>

			<Text x={cx} y={64} fontSize={72} fill="#ffffff" textAlign="center">
				RomMmate
			</Text>
			<Text x={cx} y={160} fontSize={28} fill="#9a9ab0" textAlign="center">
				nx.js + react-tela — stack smoke test
			</Text>

			<Text x={cx} y={248} fontSize={26} fill="#c8c8e0" textAlign="center">
				{`Mode: ${mode}`}
			</Text>
			<Text x={cx} y={296} fontSize={26} fill="#c8c8e0" textAlign="center">
				{`Controller: ${padId}`}
			</Text>
			<Text x={cx} y={344} fontSize={26} fill="#c8c8e0" textAlign="center">
				{`Last: ${lastInput}   ·   Button presses: ${presses}   ·   Touch moves: ${touches}`}
			</Text>

			{touchPos && (
				<Circle x={touchPos.x - 18} y={touchPos.y - 18} radius={18} fill="#e6e6fa" alpha={0.85} />
			)}

			<Text x={cx} y={664} fontSize={24} fill="#6a6a85" textAlign="center">
				Touch anywhere · press gamepad buttons to see them above · Home to quit
			</Text>
		</>
	);
}
