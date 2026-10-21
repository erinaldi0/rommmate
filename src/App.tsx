import React, { useCallback, useEffect, useState } from 'react';
import { hasConfig, loadConfig, saveConfig, type Config } from './config';
import { RommClient, type RommGame } from './romm';
import { SettingsScreen } from './components/SettingsScreen';
import { LibraryGrid } from './components/LibraryGrid';

type Route = 'settings' | 'library';

export function App() {
	const [cfg, setCfg] = useState<Config>(loadConfig);
	const [route, setRoute] = useState<Route>('settings');
	const [games, setGames] = useState<RommGame[]>([]);
	const [status, setStatus] = useState('');
	const [busy, setBusy] = useState(false);

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
		void connect(next);
	}

	function backToSettings() {
		setRoute('settings');
		setStatus('');
	}

	return route === 'settings' ? (
		<SettingsScreen initial={cfg} status={status} busy={busy} onSave={saveAndConnect} />
	) : (
		<LibraryGrid games={games} status={status} onBack={backToSettings} />
	);
}
