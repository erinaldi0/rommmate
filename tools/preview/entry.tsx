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
 *   sections    the library dashboard (continue playing / favourites /
 *               platforms / recently added / collections)
 *   picker      the multi-disc chooser
 *   downloads   the download queue (the Play feature's transfers)
 *   doctor      the Play setup doctor
 *   design      the design-system showcase (every src/components/ui atom)
 *   states      the empty / loading / error states
 *
 * Credentials (query parameters):
 *   seed=1      pre-fills the settings form with a fake instance + token
 *   base=…      overrides the instance URL (with an optional `token=…`,
 *               which defaults to the fake one) and auto-connects, so the
 *               live app can be pointed at a running RomM — typically the
 *               `proxy.mjs` CORS proxy in front of the real instance
 *   auth=password|pairing   shows the settings screen in that sign-in
 *               method, with fake credentials for it
 *   connect=0   clears all seeded credentials, so the app starts on the
 *               settings screen (a configured token otherwise sends it
 *               straight to the library)
 *
 * Input simulation (query parameter `sim`): a comma separated list of
 * button names that are pressed one after another, e.g. `sim=Up,A,B`.
 * `sim=Y` opens the virtual keyboard, which is pre-filled with `vktext`.
 * `?delay=<ms>` defers the first press (default 400).
 */
import './raf-shim';
import React, { useMemo, useState } from 'react';
import { render } from 'react-tela/render';
import { Rect, useDimensions } from 'react-tela';
import { Button } from '@nx.js/constants';
import { App } from '../../src/App';
import { LibraryGrid } from '../../src/components/LibraryGrid';
import { LibrarySections } from '../../src/components/LibrarySections';
import { GameDetail } from '../../src/components/GameDetail';
import { DiscPicker } from '../../src/components/DiscPicker';
import { Spinner } from '../../src/components/Spinner';
import { DownloadsScreen } from '../../src/components/DownloadsScreen';
import { SetupDoctor } from '../../src/components/SetupDoctor';
import { installErrorTrap } from '../../src/errors';
import { patchInsertBefore } from '../../src/react-tela-compat';
import { coverCacheSize, hasCover, resolveCover } from '../../src/covers';
import { MOCK_GAMES, MOCK_COLLECTIONS } from '../../src/mock';
import { downloadQueue } from '../../src/roms/download';
import { colors } from '../../src/theme';
import { groupTitles, type RommGame } from '../../src/romm';
import type { RommTitle } from '../../src/romm';
import { DiscPicker } from '../../src/components/DiscPicker';
import { DesignShowcase, StatesBand } from './design';

installErrorTrap();

// Dev-only diagnostics for the CDP probe (tools/preview/probe.mjs): the
// covers module's cache state, reachable from the page context.
(window as unknown as Record<string, unknown>)['__cov'] = { coverCacheSize, hasCover, resolveCover };

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
	for (const key of [
		'rommate.authMethod',
		'rommate.username',
		'rommate.password',
		'rommate.refreshToken',
		'rommate.tokenExpiresAt',
		'rommate.pairingCode',
		'rommate.pairingToken',
	]) {
		localStorage.removeItem(key);
	}
}

// `?auth=password|pairing` picks the sign-in method shown on the settings
// screen, with plausible fake credentials for it (the token method needs
// no help — it is the default and `seed=1` fills it in).
const auth = params.get('auth');
if (auth === 'password' || auth === 'pairing') {
	localStorage.setItem('rommate.authMethod', auth);
	if (auth === 'password') {
		localStorage.setItem('rommate.username', 'demo');
		localStorage.setItem('rommate.password', 'hunter2');
	} else {
		localStorage.setItem('rommate.pairingCode', 'M2DX-ZWQF');
	}
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

// `?connect=0` wipes whatever credentials were seeded, so the app starts
// on the settings screen — the live app goes straight to the library
// when a token is already configured, which would otherwise skip the
// settings views below.
if (params.get('connect') === '0') {
	localStorage.removeItem('rommate.baseUrl');
	localStorage.removeItem('rommate.token');
	for (const key of [
		'rommate.authMethod',
		'rommate.username',
		'rommate.password',
		'rommate.refreshToken',
		'rommate.tokenExpiresAt',
		'rommate.pairingCode',
		'rommate.pairingToken',
	]) {
		localStorage.removeItem(key);
	}
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

const ART_GAMES: RommGame[] = (() => {
	// The mock's games carry no platform ids, so the platforms strip could
	// never match a logo. The preview assigns one id per platform name and
	// builds the matching platform entries — the on-device shapes, with
	// synthetic logos.
	const ids = new Map<string, number>();
	return MOCK_GAMES.map((g) => {
		let id = ids.get(g.platform);
		if (id === undefined) {
			id = ids.size + 1;
			ids.set(g.platform, id);
		}
		return {
			...g,
			platformId: id,
			coverUrl: coverOverride ?? syntheticCover(g, 216, 288),
			screenshotUrl: syntheticCover(g, 320, 180),
		};
	});
})();

/** The preview platforms, id-matched to `ART_GAMES`, logos synthetic. */
const ART_PLATFORMS: RommPlatform[] = (() => {
	const seen = new Map<string, RommPlatform>();
	let id = 0;
	for (const g of ART_GAMES) {
		let p = seen.get(g.platform);
		if (p === undefined) {
			p = { id: ++id, name: g.platform, logoUrl: syntheticCover({ ...g, name: g.platform }, 48, 48), romCount: 0 };
			seen.set(g.platform, p);
		}
		p.romCount += 1;
	}
	return [...seen.values()];
})();

/**
 * The release position of every multi-disc game, keyed by game id — the
 * same derivation `App.tsx` performs for the detail screen's disc row, so
 * the preview's detail views exercise the real wiring.
 */
function discInfoOf(titles: RommTitle[]): Map<number, { index: number; count: number }> {
	const m = new Map<number, { index: number; count: number }>();
	for (const t of titles) {
		if (t.knownDiscs <= 1) continue;
		t.discs.forEach((g, i) => {
			const slot = t.discReleaseSlots[i] ?? i + 1;
			m.set(g.id, { index: slot - 1, count: t.knownDiscs });
		});
	}
	return m;
}

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
	const [detailDisc, setDetailDisc] = useState<{ index: number; count: number } | null>(null);
	const [picker, setPicker] = useState<RommTitle | null>(null);

	// The release position of every multi-disc game — the same derivation
	// the real App uses for the detail screen's Disc row.
	const titles = useMemo(() => groupTitles(ART_GAMES), []);
	const discInfo = useMemo(() => discInfoOf(titles), [titles]);

	function openDetail(game: RommGame, disc?: { index: number; count: number }) {
		setDetailDisc(disc ?? discInfo.get(game.id) ?? null);
		setDetail(game);
	}

	return (
		<>
			<LibraryGrid
				games={ART_GAMES}
				status={`Demo mode — ${ART_GAMES.length} mock games`}
				demo
				onBack={() => {}}
				onPickDisc={(t) => {
					log.push(`pick:${t.name}`);
					flush();
					setPicker(t);
				}}
				onOpen={openDetail}
				paused={detail !== null || picker !== null}
				initialZone={initialZone}
				initialQuery={initialQuery}
				initialPlatform={params.get('platform') ?? ''}
			/>
			{picker !== null && (
				<DiscPicker
					title={picker}
					initial={picker.mainIndex}
					onPick={(index) => {
						const disc = picker.discs[index];
						setPicker(null);
						if (disc !== undefined) {
							openDetail(disc, discInfo.get(disc.id) ?? { index, count: picker.knownDiscs });
						}
					}}
					onClose={() => setPicker(null)}
				/>
			)}
			{detail !== null && (
				<GameDetail
					key={detail.id}
					game={detail}
					disc={detailDisc ?? undefined}
					onBack={() => setDetail(null)}
				/>
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

/**
 * The library dashboard on its own, with the mocked catalogue.
 *
 * The rows that the dashboard derives (continue playing, favourites,
 * platforms, recently added, collections) are all exercised against the
 * mock's play state, favourite flags and multi-disc releases. State
 * knobs: `empty=1` drops every row (the empty state), `busy=1` keeps the
 * connection in flight (the loading state) and `fail=1` shows a failed
 * connection (the error state).
 */
function SectionsView() {
	const titles = useMemo(() => groupTitles(ART_GAMES), []);
	const favTitles = useMemo(() => groupTitles(ART_GAMES.filter((g) => g.favorite)), []);
	// The platforms strip's input: the mock platform entries, id-matched
	// to the games (built beside `ART_GAMES`).
	const platforms = ART_PLATFORMS;
	const empty = params.get('empty') === '1';
	const busy = params.get('busy') === '1';
	const failed = params.get('fail') === '1';
	return (
		<LibrarySections
			status={
				failed
					? 'Connection failed: could not reach the instance'
					: busy
						? 'Loading library… 214 / 1266'
						: `Demo mode — ${ART_GAMES.length} mock games`
			}
			busy={busy}
			demo={!empty}
			titles={empty ? [] : titles}
			favoriteTitles={empty ? [] : favTitles}
			platforms={empty ? [] : platforms}
			collections={empty ? [] : MOCK_COLLECTIONS}
			discSelections={{}}
			onOpenTitle={(t) => {
				log.push(`title:${t.name}`);
				flush();
			}}
			onOpenSection={(s) => {
				log.push(`section:${s.kind}`);
				flush();
			}}
			onOpenDetail={(g) => {
				log.push(`detail:${g.name}`);
				flush();
			}}
			onSelectDisc={(key, index) => {
				log.push(`disc:${key}:${index}`);
				flush();
			}}
			onBack={() => {}}
		/>
	);
}

/** The downloads queue on its own (empty — it shows the idle state). */
function DownloadsView() {
	// `?dq=N` seeds N fake transfers so the queue screen can be exercised
	// with a list long enough to scroll (dev-only, like the rest of the
	// harness). The first item's fetch never resolves, so the queue sits
	// still: one row 'running', the rest 'queued' — deterministic frames.
	const n = Number(params.get('dq') ?? 0);
	if (n > 0) {
		for (let i = 0; i < n; i++) {
			void downloadQueue.add({
				id: `fake:${i}`,
				kind: i === 0 ? 'emulator' : i === 1 ? 'bios' : 'rom',
				label: i === 0 ? 'RetroArch loader' : i === 1 ? 'bios.zip' : `Fake game #${i - 1}`,
				dest: `sdmc:/switch/rommate/fake-${i}`,
				size: 1024 * 1024 * (10 + i),
				hash: '',
				fetchPart: () => new Promise(() => {}) as Promise<Response>,
			});
		}
	}
	return <DownloadsScreen onBack={() => {}} />;
}

/**
 * The Play setup doctor on its own. Without a bound client it reports the
 * "not connected" line, which is enough to check the layout.
 */
function DoctorView() {
	return (
		<SetupDoctor
			onBack={() => {}}
			baseUrl="http://10.147.18.46:8200"
			platforms={[
				{ name: 'Nintendo 64', id: 7 },
				{ name: 'PlayStation', id: 11 },
			]}
		/>
	);
}

/** The disc picker on its own, pointed at the mock's multi-disc release. */
function PickerView() {
	const multi = useMemo(
		() => groupTitles(ART_GAMES).find((t) => t.discs.length > 1),
		[],
	);
	if (multi === undefined) return null;
	return (
		<DiscPicker
			title={multi}
			initial={0}
			onPick={(i) => {
				log.push(`pick:${i}`);
				flush();
			}}
			onClose={() => {}}
		/>
	);
}

// The device entry (src/main.tsx) applies this workaround to its root; the
// harness must do the same so previews reproduce on-device behaviour.
const renderApp = (app: React.ReactNode) => {
	const root = render(app, canvas);
	patchInsertBefore(root);
	// Dev-only diagnostics for the CDP probe: the render tree, so a probe
	// can enumerate the live entities without guessing pixel coordinates.
	(window as unknown as Record<string, unknown>)['__root'] = root;
	return root;
};

if (view === 'demo' || view === 'filter' || view === 'empty') {
	const empty = view === 'empty';
	const query = params.get('query') ?? (empty ? 'nothing matches this' : '');
	renderApp(<PreviewApp initialZone={view === 'filter' ? 'filter' : 'grid'} initialQuery={query} />);
} else if (view === 'detail') {
	const game = ART_GAMES[num('game', 0)] ?? ART_GAMES[0];
	const info = discInfoOf(groupTitles(ART_GAMES)).get(game.id);
	renderApp(
		<GameDetail
			game={game}
			disc={info ?? undefined}
			onBack={() => {
				log.push('back');
				flush();
			}}
			onOpenDownloads={() => {
				log.push('downloads');
				flush();
			}}
			onDiscs={() => {
				log.push('discs');
				flush();
			}}
		/>,
	);
} else if (view === 'spinner') {
	renderApp(<SpinnerView />);
} else if (view === 'sections') {
	renderApp(<SectionsView />);
} else if (view === 'picker') {
	renderApp(<PickerView />);
} else if (view === 'downloads') {
	renderApp(<DownloadsView />);
} else if (view === 'doctor') {
	renderApp(<DoctorView />);
} else if (view === 'design') {
	// The design-system showcase: every primitive in src/components/ui on the
	// real 1280×720 canvas (surfaces, type, actions, covers, focus, metadata).
	renderApp(<DesignShowcase />);
} else if (view === 'states') {
	// The empty / loading / error states, one per third of the screen.
	renderApp(<StatesBand />);
} else {
	renderApp(<App />);
}
