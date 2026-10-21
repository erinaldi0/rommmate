/**
 * Browser preview harness (dev-only, not shipped).
 *
 * Renders the real react-tela app into a 1280x720 canvas so the layout can
 * be inspected with headless Chrome instead of guessing on-device.
 *
 * The nx.js-only bits are stubbed: `screen` becomes the <canvas> element and
 * `navigator.virtualKeyboard` a fake keyboard.
 */
import React from 'react';
import { render } from 'react-tela/render';
import { App } from '../../src/App';
import { LibraryGrid } from '../../src/components/LibraryGrid';
import { installErrorTrap } from '../../src/errors';
import { MOCK_GAMES } from '../../src/mock';
import type { RommGame } from '../../src/romm';

installErrorTrap();

const params = new URLSearchParams(location.search);

if (params.get('seed') === '1') {
	localStorage.setItem('rommate.baseUrl', 'http://192.168.1.50:11700');
	localStorage.setItem('rommate.token', 'rmm_0123456789abcdef0123456789abcdef');
} else {
	localStorage.removeItem('rommate.baseUrl');
	localStorage.removeItem('rommate.token');
}

// Fake virtual keyboard (nx.js provides the real one on-device).
if (!('virtualKeyboard' in navigator)) {
	const listeners: Record<string, Array<() => void>> = {};
	(navigator as unknown as { virtualKeyboard: unknown }).virtualKeyboard = {
		boundingRect: { height: 0 },
		value: '',
		type: 0,
		okButtonText: '',
		show() {
			this.boundingRect.height = 320;
			(listeners['geometrychange'] ?? []).forEach((l) => l());
		},
		hide() {
			this.boundingRect.height = 0;
			(listeners['geometrychange'] ?? []).forEach((l) => l());
		},
		addEventListener(type: string, l: () => void) {
			(listeners[type] ??= []).push(l);
		},
		removeEventListener(type: string, l: () => void) {
			listeners[type] = (listeners[type] ?? []).filter((x) => x !== l);
		},
	};
}

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (ctx) {
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
}

// `?view=grid` renders the library grid with mock data (the live screen needs
// a reachable RomM server, which the harness does not have).
const view = params.get('view');

if (view === 'demo') {
	render(
		<LibraryGrid
			games={MOCK_GAMES}
			status={`Demo mode — ${MOCK_GAMES.length} mock games`}
			demo
			onBack={() => {}}
			initialScroll={Number(params.get('scroll') ?? 0)}
			initialFocus={Number(params.get('focus') ?? 0)}
		/>,
		canvas,
	);
} else if (view === 'grid') {
	const names = [
		'Super Mario 64',
		'The Legend of Zelda: Ocarina of Time',
		'Metroid Prime',
		'Perfect Dark',
		'Banjo-Kazooie',
		'GoldenEye 007',
		'Donkey Kong Country',
		'Star Fox 64',
		'Paper Mario',
		'Mario Kart 64',
		'F-Zero X',
		'Wave Race 64',
		'Sin & Punishment',
		'Jet Set Radio',
		'Conker: Live & Reloaded',
		'Kameo',
	];
	const games: RommGame[] = names.map((name, i) => ({
		id: i + 1,
		name,
		platform: 'Nintendo 64',
		coverUrl: '',
	}));
	render(
		<LibraryGrid
			games={games}
			status="Loaded 16 games"
			onBack={() => {}}
			initialScroll={Number(params.get('scroll') ?? 0)}
			initialFocus={Number(params.get('focus') ?? 0)}
		/>,
		canvas,
	);
} else {
	render(<App />, canvas);
}
