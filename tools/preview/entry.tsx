/**
 * Browser preview harness (dev-only, not shipped).
 *
 * Renders the real react-tela app into a 1280x720 canvas so the layout can
 * be inspected with headless Chrome instead of guessing on-device.
 *
 * The nx.js-only bits are stubbed: `screen` becomes the <canvas> element,
 * `navigator.virtualKeyboard` a fake keyboard and `navigator.getGamepads()`
 * a fake controller.
 *
 * Views (query parameter `view`):
 *   (none)      the live app (settings screen)
 *   demo        the library grid with the mocked catalogue
 *   filter      the library grid with the filter bar focused
 *   empty       the library grid with a filter that matches nothing
 *   detail      the detail screen of a single game
 *   spinner     the loading indicator on its own
 *
 * Credentials (query parameters):
 *   seed=1      pre-fills the settings form with a fake instance + token
 *   base=…      overrides the instance URL (with an optional `token=…`,
 *               which defaults to the fake one) and auto-connects, so the
 *               live app can be pointed at a running RomM — typically the
 *               `proxy.mjs` CORS proxy in front of the real instance
 *
 * Input simulation (query parameter `sim`): a comma separated list of
 * button names that are pressed one after another, e.g. `sim=Up,A,B`.
 * `sim=Y` opens the virtual keyboard, which is pre-filled with `vktext`.
 * `?delay=<ms>` defers the first press (default 400).
 */
import './raf-shim';
import React, { useState } from 'react';
import { render } from 'react-tela/render';
import { Rect, useDimensions } from 'react-tela';
import { Button } from '@nx.js/constants';
import { App } from '../../src/App';
import { LibraryGrid } from '../../src/components/LibraryGrid';
import { GameDetail } from '../../src/components/GameDetail';
import { Spinner } from '../../src/components/Spinner';
import { installErrorTrap } from '../../src/errors';
import { MOCK_GAMES } from '../../src/mock';
import { colors } from '../../src/theme';
import type { RommGame } from '../../src/romm';

installErrorTrap();

// Uncaught errors are swallowed by the error trap, so they are traced here.
globalThis.addEventListener('error', (event) => {
	log.push(`ERR:${(event as ErrorEvent).message}`);
	flush();
});
globalThis.addEventListener('unhandledrejection', (event) => {
	log.push(`REJ:${String((event as PromiseRejectionEvent).reason)}`);
	flush();
});

const params = new URLSearchParams(location.search);

if (params.get('seed') === '1') {
	localStorage.setItem('rommate.baseUrl', 'http://192.168.1.50:11700');
	localStorage.setItem('rommate.token', 'rmm_0123456789abcdef0123456789abcdef');
} else {
	localStorage.removeItem('rommate.baseUrl');
	localStorage.removeItem('rommate.token');
}

// A `base` (and `token`) parameter overrides the seed, so the live app can
// be pointed at a running RomM instance — typically `proxy.mjs` in front of
// the real one (the instance itself does not answer browser CORS requests).
const base = params.get('base');
if (base !== null) {
	localStorage.setItem('rommate.baseUrl', base);
	localStorage.setItem(
		'rommate.token',
		params.get('token') ?? 'rmm_0123456789abcdef0123456789abcdef',
	);
}

// Fake virtual keyboard (nx.js provides the real one on-device).
//
// Chrome has a `navigator.virtualKeyboard` of its own (the VirtualKeyboard
// API), so the stub is installed unconditionally — with `defineProperty`,
// because the prototype accessor is read-only.
//
// `?fkbd=1` simulates a system keyboard that never appears (its rect stays
// zero) and `?fkbd=2` one that does not exist at all, so the in-app
// fallback (`InAppKeyboard`) can be exercised in preview.
{
	const fkbd = params.get('fkbd');
	const listeners: Record<string, Array<() => void>> = {};
	const vk = {
		boundingRect: { height: 0 },
		value: '',
		type: 0,
		okButtonText: '',
		show() {
			if (fkbd !== '1') this.boundingRect.height = 320;
			(listeners['geometrychange'] ?? []).forEach((l) => l());
			// The typed text can be pre-filled, so a search can be simulated.
			const text = params.get('vktext');
			log.push(`vk:show:${this.value}`);
			flush();
			if (text !== null) {
				this.value = text;
				setTimeout(() => this.hide(), 120);
			}
		},
		hide() {
			this.boundingRect.height = 0;
			(listeners['geometrychange'] ?? []).forEach((l) => l());
			log.push(`vk:hide:${this.value}`);
			flush();
		},
		addEventListener(type: string, l: () => void) {
			(listeners[type] ??= []).push(l);
		},
		removeEventListener(type: string, l: () => void) {
			listeners[type] = (listeners[type] ?? []).filter((x) => x !== l);
		},
	};
	Object.defineProperty(navigator, 'virtualKeyboard', {
		value: fkbd === '2' ? undefined : vk,
		configurable: true,
		writable: true,
	});
}

/** A trace of the simulated input, mirrored into the document title. */
const log: string[] = [];
const flush = () => {
	// Keep the title short: the poll counter is useful, but not 300 entries.
	if (log.length > 24) log.splice(0, log.length - 24);
	document.title = log.join(' | ');
};

/**
 * Fake controller.
 *
 * The library screen is driven by the Web Gamepad API, which the browser
 * does not have. The buttons listed in `sim` are pressed one after another,
 * so a screenshot can show the result of a sequence of presses.
 *
 * A press is reported for exactly one poll: the app sees the edge and the
 * release on the next poll. Holding the button down would trigger the
 * app's auto-repeat, and a re-render of the canvas takes long enough (in
 * real time) for the repeat delay to expire, so a held button would move
 * the focus all the way across the grid.
 */
function installFakeGamepad(sequence: string[]): void {
	const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
	let polls = 0;

	/** The button waiting to be reported as pressed. */
	let queued: string | null = null;
	/** The button that was reported as pressed on the previous poll. */
	let held: string | null = null;

	const indexOf = (name: string): number =>
		Button[name as keyof typeof Button];

	(navigator as unknown as { getGamepads: () => unknown[] }).getGamepads = () => {
		polls += 1;

		if (held !== null) {
			const index = indexOf(held);
			if (typeof index === 'number') buttons[index] = { pressed: false, value: 0 };
			log.push(`gp:${held}:false`);
			held = null;
			flush();
		}
		if (queued !== null) {
			const index = indexOf(queued);
			if (typeof index === 'number') buttons[index] = { pressed: true, value: 1 };
			log.push(`gp:${queued}:true`);
			held = queued;
			queued = null;
			flush();
		}

		if (polls <= 3 || polls % 50 === 0) {
			log.push(`polls:${polls}`);
			flush();
		}

		return [
			{
				id: 'fake',
				index: 0,
				connected: true,
				mapping: 'standard',
				timestamp: 0,
				axes: [0, 0],
				buttons,
			},
		];
	};

	let step = 0;
	const tick = () => {
		if (step >= sequence.length) return;
		queued = sequence[step];
		step += 1;
		setTimeout(tick, 160);
	};
	// `?delay=` defers the first press, so a sequence can be aimed at a
	// state that appears later (e.g. the library once the load has settled).
	setTimeout(tick, Number(params.get('delay') ?? 400));
}

const sim = (params.get('sim') ?? '')
	.split(',')
	.map((s) => s.trim())
	.filter((s) => s !== '');
if (sim.length > 0) installFakeGamepad(sim);

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (ctx) {
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
}

const view = params.get('view');
const num = (key: string, fallback: number): number =>
	Number(params.get(key) ?? fallback);

/**
 * Synthetic artwork.
 *
 * The mock catalogue has no cover art, and the whole point of the preview
 * is to check the *artwork* path (fetch → cache → `<Image>`), so a coloured
 * placeholder is generated on the fly and handed to the app as a data URL.
 */
function syntheticCover(game: RommGame, w: number, h: number): string {
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const c = canvas.getContext('2d');
	if (!c) return '';

	const hue = (game.id * 47) % 360;
	const grad = c.createLinearGradient(0, 0, 0, h);
	grad.addColorStop(0, `hsl(${hue}, 48%, 34%)`);
	grad.addColorStop(1, `hsl(${(hue + 45) % 360}, 55%, 13%)`);
	c.fillStyle = grad;
	c.fillRect(0, 0, w, h);

	c.fillStyle = 'rgba(255,255,255,0.92)';
	c.font = `bold ${Math.round(h * 0.34)}px system-ui`;
	c.textAlign = 'center';
	c.fillText(game.name.trim().charAt(0).toUpperCase() || '?', w / 2, h * 0.58);

	return canvas.toDataURL('image/png');
}

/**
 * The mock catalogue, with artwork.
 *
 * `cover` overrides the artwork URL, so the loading path (a cover that is
 * slow or never arrives) can be exercised against a URL of our choosing.
 */
const coverOverride = params.get('cover');

const ART_GAMES: RommGame[] = MOCK_GAMES.map((g) => ({
	...g,
	coverUrl: coverOverride ?? syntheticCover(g, 216, 288),
	screenshotUrl: syntheticCover(g, 320, 180),
}));

/**
 * The library and the detail screen, wired the way `App.tsx` wires them —
 * the grid stays mounted underneath and the detail screen paints over it.
 */
function PreviewApp({
	initialZone = 'grid',
	initialQuery = '',
}: {
	initialZone?: 'grid' | 'filter';
	initialQuery?: string;
}) {
	const [detail, setDetail] = useState<RommGame | null>(null);

	return (
		<>
			<LibraryGrid
				games={ART_GAMES}
				status={`Demo mode — ${ART_GAMES.length} mock games`}
				demo
				onBack={() => {}}
				onOpen={(g) => {
					log.push(`open:${g.name}`);
					flush();
					setDetail(g);
				}}
				paused={detail !== null}
				initialZone={initialZone}
				initialQuery={initialQuery}
				initialPlatform={params.get('platform') ?? ''}
			/>
			{detail !== null && (
				<GameDetail key={detail.id} game={detail} onBack={() => setDetail(null)} />
			)}
		</>
	);
}

/**
 * The loading indicator on its own.
 *
 * The detail screen can only show it while a cover is being downloaded, and
 * a pending download freezes the virtual clock of headless Chrome — so the
 * animation is checked here, where nothing is fetched.
 */
function SpinnerView() {
	const dims = useDimensions();
	return (
		<>
			<Rect width={dims.width} height={dims.height} fill={colors.bg} />
			<Spinner x={dims.width / 2} y={dims.height / 2} />
		</>
	);
}

if (view === 'demo' || view === 'filter' || view === 'empty') {
	const empty = view === 'empty';
	const query = params.get('query') ?? (empty ? 'nothing matches this' : '');
	render(<PreviewApp initialZone={view === 'filter' ? 'filter' : 'grid'} initialQuery={query} />, canvas);
} else if (view === 'detail') {
	const game = ART_GAMES[num('game', 0)] ?? ART_GAMES[0];
	render(<GameDetail game={game} onBack={() => {}} />, canvas);
} else if (view === 'spinner') {
	render(<SpinnerView />, canvas);
} else {
	render(<App />, canvas);
}
