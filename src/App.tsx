import React, { useCallback, useEffect, useRef, useState } from 'react';
import { hasConfig, loadConfig, saveConfig, type Config } from './config';
import { configureCovers } from './covers';
import { setActivity } from './activity';
import { onFatalError } from './errors';
import { RommClient, type RommGame } from './romm';
import { MOCK_GAMES } from './mock';
import { FatalError } from './components/FatalError';
import { SettingsScreen } from './components/SettingsScreen';
import { LibraryGrid } from './components/LibraryGrid';
import { GameDetail } from './components/GameDetail';
import { ActivityBadge } from './components/ActivityBadge';

type Route = 'settings' | 'library' | 'detail';

export function App() {
	const [cfg, setCfg] = useState<Config>(loadConfig);
	const [route, setRoute] = useState<Route>('settings');
	const [games, setGames] = useState<RommGame[]>([]);
	const [status, setStatus] = useState('');
	const [busy, setBusy] = useState(false);
	const [fatal, setFatal] = useState<string | null>(null);
	/** True while the library shows mocked data instead of a real RomM server. */
	const [demo, setDemo] = useState(false);
	/** The game the detail screen is showing. */
	const [detail, setDetail] = useState<RommGame | null>(null);

	/**
	 * Monotonic counter of connection attempts, plus the aborter of the
	 * current one: both let the app ignore (and stop) a walk the user has
	 * already walked away from.
	 */
	const runGen = useRef(0);
	const aborter = useRef<AbortController | null>(null);

	// Anything that blows up while rendering is surfaced on screen instead of
	// leaving a half-drawn frame behind.
	useEffect(() => onFatalError(setFatal), []);

	// The artwork is fetched by `covers.ts`, which cannot read the token from
	// the URL — it is handed over here, and kept in sync with the saved
	// credentials (the app also auto-connects with a stored config).
	useEffect(() => {
		configureCovers(cfg.token);
	}, [cfg.token]);

	const connect = useCallback(async (config: Config) => {
		// Each connection attempt gets a generation number: a late result
		// (or a walk the user abandoned) must never write state the user
		// has already left.
		runGen.current += 1;
		const gen = runGen.current;
		const controller = new AbortController();
		aborter.current = controller;

		setBusy(true);
		setStatus('Connecting…');

		const client = new RommClient(config.baseUrl, config.token);

		const authErr = await client.authenticate(controller.signal);
		if (gen !== runGen.current) return;
		if (authErr !== null) {
			setBusy(false);
			setStatus(controller.signal.aborted ? 'Connection cancelled' : `Connection failed: ${authErr}`);
			return;
		}

		setStatus('Loading library…');
		const { games: gs, error, truncated } = await client.getGames(
			(loaded, total) => {
				if (gen !== runGen.current) return;
				setStatus(`Loading library… ${loaded}${total !== null ? ` / ${total}` : ''}`);
				setActivity(
					'library',
					total !== null ? `Library ${loaded} / ${total}` : `Library ${loaded}+`,
				);
			},
			controller.signal,
		);
		if (gen !== runGen.current) return;

		setBusy(false);
		setActivity('library', null);

		if (controller.signal.aborted) {
			setStatus('Connection cancelled');
			return;
		}
		if (error !== null) {
			setStatus(`Library failed: ${error}`);
			return;
		}

		// On failure we deliberately stay on the settings screen so the user
		// can fix the credentials; the screen is only left on success.
		setGames(gs);
		setStatus(
			gs.length > 0
				? `Loaded ${gs.length} games${truncated ? ' (capped)' : ''}`
				: 'Library is empty',
		);
		setRoute('library');
	}, []);

	/** Cancel the in-flight connection (B on the settings screen). */
	function cancelConnect() {
		runGen.current += 1;
		aborter.current?.abort();
		setBusy(false);
		setStatus('Connection cancelled');
		setActivity('library', null);
	}

	// Auto-connect at startup when credentials are already saved.
	useEffect(() => {
		if (hasConfig(cfg)) void connect(cfg);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function saveAndConnect(next: Config) {
		saveConfig(next);
		setCfg(next);
		setDemo(false);
		configureCovers(next.token);
		void connect(next);
	}

	// Skip the login entirely: fill the library with mocked games so the app
	// can be used (and the next screens developed) without a RomM server.
	// A walk still running is abandoned so it cannot stomp the mock data.
	function startDemo() {
		runGen.current += 1;
		aborter.current?.abort();
		setActivity('library', null);
		setBusy(false);
		setDemo(true);
		setGames(MOCK_GAMES);
		setStatus(`Demo mode — ${MOCK_GAMES.length} mock games`);
		setRoute('library');
	}

	function backToSettings() {
		setRoute('settings');
		setStatus('');
	}

	function openDetail(game: RommGame) {
		setDetail(game);
		setRoute('detail');
	}

	function closeDetail() {
		setDetail(null);
		setRoute('library');
	}

	if (fatal !== null) return <FatalError message={fatal} />;

	if (route === 'settings') {
		return (
			<>
				<SettingsScreen
					initial={cfg}
					status={status}
					busy={busy}
					onSave={saveAndConnect}
					onDemo={startDemo}
					onCancel={cancelConnect}
				/>
				<ActivityBadge />
			</>
		);
	}

	return (
		<>
			{/*
			 * The grid stays mounted underneath the detail screen: its
			 * scroll position and filter state survive the round trip, and
			 * the detail screen only has to paint over it.
			 */}
			<LibraryGrid
				games={games}
				status={status}
				demo={demo}
				onBack={backToSettings}
				onOpen={openDetail}
				paused={route === 'detail'}
			/>
			{route === 'detail' && detail !== null && (
				// The key makes the screen remount per game, so its state
				// (which artwork is loading) never leaks into the next one.
				<GameDetail key={detail.id} game={detail} onBack={closeDetail} />
			)}
			<ActivityBadge />
		</>
	);
}
