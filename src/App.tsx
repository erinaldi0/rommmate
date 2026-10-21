import React, { useCallback, useEffect, useState } from 'react';
import { hasConfig, loadConfig, saveConfig, type Config } from './config';
import { onFatalError } from './errors';
import { RommClient, type RommGame } from './romm';
import { MOCK_GAMES } from './mock';
import { FatalError } from './components/FatalError';
import { SettingsScreen } from './components/SettingsScreen';
import { LibraryGrid } from './components/LibraryGrid';

type Route = 'settings' | 'library';

export function App() {
	const [cfg, setCfg] = useState<Config>(loadConfig);
	const [route, setRoute] = useState<Route>('settings');
	const [games, setGames] = useState<RommGame[]>([]);
	const [status, setStatus] = useState('');
	const [busy, setBusy] = useState(false);
	const [fatal, setFatal] = useState<string | null>(null);
	/** True while the library shows mocked data instead of a real RomM server. */
	const [demo, setDemo] = useState(false);

	// Anything that blows up while rendering is surfaced on screen instead of
	// leaving a half-drawn frame behind.
	useEffect(() => onFatalError(setFatal), []);

	const connect = useCallback(async (config: Config) => {
		setBusy(true);
		setStatus('Connecting…');

		const client = new RommClient(config.baseUrl, config.token);

		const authErr = await client.authenticate();
		if (authErr !== null) {
			setBusy(false);
			setStatus(`Connection failed: ${authErr}`);
			return;
		}

		setStatus('Loading library…');
		const { games: gs, error } = await client.getGames();
		setBusy(false);

		if (error !== null) {
			setStatus(`Library failed: ${error}`);
			return;
		}

		// On failure we deliberately stay on the settings screen so the user
		// can fix the credentials; the screen is only left on success.
		setGames(gs);
		setStatus(gs.length > 0 ? `Loaded ${gs.length} games` : 'Library is empty');
		setRoute('library');
	}, []);

	// Auto-connect at startup when credentials are already saved.
	useEffect(() => {
		if (hasConfig(cfg)) void connect(cfg);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function saveAndConnect(next: Config) {
		saveConfig(next);
		setCfg(next);
		setDemo(false);
		void connect(next);
	}

	// Skip the login entirely: fill the library with mocked games so the app
	// can be used (and the next screens developed) without a RomM server.
	function startDemo() {
		setDemo(true);
		setGames(MOCK_GAMES);
		setStatus(`Demo mode — ${MOCK_GAMES.length} mock games`);
		setRoute('library');
	}

	function backToSettings() {
		setRoute('settings');
		setStatus('');
	}

	if (fatal !== null) return <FatalError message={fatal} />;

	return route === 'settings' ? (
		<SettingsScreen
			initial={cfg}
			status={status}
			busy={busy}
			onSave={saveAndConnect}
			onDemo={startDemo}
		/>
	) : (
		<LibraryGrid games={games} status={status} demo={demo} onBack={backToSettings} />
	);
}
