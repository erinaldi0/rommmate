import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hasConfig, loadConfig, saveConfig, DEFAULT_AUTH_METHOD, type Config } from './config';
import { exchangePasswordToken, exchangePairingCode, refreshAccessToken } from './auth';
import { configureCovers } from './covers';
import { setActivity } from './activity';
import { onFatalError } from './errors';
import {
	RommClient,
	groupTitles,
	type RommGame,
	type RommCollection,
	type RommTitle,
	type LibrarySection,
} from './romm';
import { log } from './log';
import { networkStatus, friendlyNetworkError } from './network';
import { MOCK_GAMES, MOCK_COLLECTIONS } from './mock';
import { FatalError } from './components/FatalError';
import { SettingsScreen } from './components/SettingsScreen';
import { LibraryGrid } from './components/LibraryGrid';
import { LibrarySections } from './components/LibrarySections';
import { GameDetail } from './components/GameDetail';
import { DiscPicker } from './components/DiscPicker';
import { ActivityBadge } from './components/ActivityBadge';

type Route = 'settings' | 'library' | 'detail';

export function App() {
	const [cfg, setCfg] = useState<Config>(loadConfig);
	// A stored credential means the app can go straight for the library:
	// the connect flow runs in the background, and it falls back to the
	// settings screen only when it fails before the first page arrives.
	const [route, setRoute] = useState<Route>(() =>
		hasConfig(loadConfig()) ? 'library' : 'settings',
	);
	const [games, setGames] = useState<RommGame[]>([]);
	const [status, setStatus] = useState('');
	const [busy, setBusy] = useState(false);
	const [fatal, setFatal] = useState<string | null>(null);
	/** True while the library shows mocked data instead of a real RomM server. */
	const [demo, setDemo] = useState(false);
	/** The game the detail screen is showing. */
	const [detail, setDetail] = useState<RommGame | null>(null);
	/** The disc the detail screen was opened for (multi-disc titles). */
	const [detailDisc, setDetailDisc] = useState<{ index: number; count: number } | null>(null);
	/**
	 * The dashboard section the library route is showing; null is the
	 * dashboard itself.
	 */
	const [section, setSection] = useState<LibrarySection | null>(null);
	/**
	 * Favourites: a separate server-filtered walk (`favorite=true`), kept
	 * apart from the main library because the list response does not report
	 * the flag itself.
	 */
	const [favGames, setFavGames] = useState<RommGame[]>([]);
	/** The server's saved collections (a 5.x-only feature). */
	const [collections, setCollections] = useState<RommCollection[]>([]);
	/** The roms of the collection currently open, streamed page by page. */
	const [collectionGames, setCollectionGames] = useState<RommGame[]>([]);
	/** True while a collection is still loading. */
	const [collectionBusy, setCollectionBusy] = useState(false);
	/** The title whose disc the picker is choosing for (null: closed). */
	const [picker, setPicker] = useState<RommTitle | null>(null);
	/** Per-title disc choice (title key → disc index); survives navigation. */
	const [discSel, setDiscSel] = useState<Record<number, number>>({});

	/**
	 * Monotonic counter of connection attempts, plus the aborter of the
	 * current one: both let the app ignore (and stop) a walk the user has
	 * already walked away from.
	 */
	const runGen = useRef(0);
	const aborter = useRef<AbortController | null>(null);
	/**
	 * The client of the last successful connect: the collection walk (and
	 * any later per-section work) needs the same token and 401 recovery.
	 */
	const clientRef = useRef<RommClient | null>(null);
	/** The in-flight collection walk, with the same generation discipline. */
	const colGen = useRef(0);
	const colAborter = useRef<AbortController | null>(null);
	/**
	 * The refresh-token exchange in flight, if any: several requests can
	 * 401 together when the access token expires mid-walk, and only one
	 * refresh may run (RomM rotates refresh tokens — a second, parallel
	 * exchange would race the first and invalidate it).
	 */
	const refreshInFlight = useRef<Promise<string | null> | null>(null);

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
		// A new library replaces whatever the screen is looking at.
		setSection(null);
		setCollectionGames([]);
		setPicker(null);

		// The config as the token flows are allowed to update it: a fresh
		// access token, a rotated refresh token, an exchanged pairing code.
		// Every update is persisted and pushed into the app state (which
		// also hands the new token to the cover fetcher).
		let cur = config;
		const method = cur.authMethod ?? DEFAULT_AUTH_METHOD;
		// An empty Base URL would make every request URL *relative*, which
		// the runtime resolves against the app's own `romfs:` base — the
		// user would see a baffling protocol error instead of this.
		if (cur.baseUrl.trim() === '') {
			setBusy(false);
			setStatus('Connection failed: Base URL is required');
			log('connect', 'refused: empty Base URL');
			return;
		}
		// With no active connection the OS resolver rejects even a numeric
		// host outright ("Address family for hostname not supported") —
		// check nifm first so the message is actionable.
		const net = networkStatus();
		if (net.problem !== null) {
			setBusy(false);
			setStatus(`Connection failed: ${net.problem}`);
			log('connect', `refused: ${net.problem}`);
			return;
		}
		log('connect', `method=${method} base=${cur.baseUrl.trim()} ip=${net.ip ?? 'n/a'}`);
		const apply = (patch: Partial<Config>) => {
			cur = { ...cur, ...patch };
			saveConfig(cur);
			setCfg(cur);
		};

		// --- Obtain the bearer token for the chosen sign-in method -----
		if (method === 'password') {
			const username = (cur.username ?? '').trim();
			const password = cur.password ?? '';
			if (username === '' || password === '') {
				setBusy(false);
				setStatus('Connection failed: username and password are required');
				return;
			}
			const refresh = (cur.refreshToken ?? '').trim();
			const fresh = cur.token.trim() !== '' && (cur.tokenExpiresAt ?? 0) > Date.now() + 60_000;
			if (!fresh) {
				setStatus(refresh !== '' ? 'Refreshing session…' : 'Signing in…');
				let res =
					refresh !== ''
						? await refreshAccessToken(cur.baseUrl, refresh, controller.signal)
						: await exchangePasswordToken(cur.baseUrl, username, password, controller.signal);
				if (gen !== runGen.current) return;
				if (!res.ok && refresh !== '') {
					// A rotated or revoked refresh token: fall back to the
					// full password grant once.
					setStatus('Signing in…');
					log('token', 'refresh token dead — retrying with the password grant');
					res = await exchangePasswordToken(cur.baseUrl, username, password, controller.signal);
					if (gen !== runGen.current) return;
				}
				if (!res.ok) {
					setBusy(false);
					setStatus(`Connection failed: ${friendlyNetworkError(res.error)}`);
					log('error', `password grant: ${res.error}`);
					return;
				}
				log('token', 'password grant ok');
				apply({
					token: res.value.accessToken,
					refreshToken: res.value.refreshToken,
					tokenExpiresAt: Date.now() + res.value.expiresIn * 1000,
				});
			}
		} else if (method === 'pairing') {
			const code = (cur.pairingCode ?? '').trim();
			if (code === '') {
				setBusy(false);
				setStatus('Connection failed: a pairing code is required');
				return;
			}
			// A pairing token from a previous exchange is reused; the code
			// itself is single-use, so only exchange when we hold none yet.
			if (cur.token.trim() === '' || (cur.pairingToken ?? '').trim() === '') {
				setStatus('Exchanging pairing code…');
				const res = await exchangePairingCode(cur.baseUrl, code, controller.signal);
				if (gen !== runGen.current) return;
				if (!res.ok) {
					setBusy(false);
					setStatus(`Connection failed: ${friendlyNetworkError(res.error)}`);
					log('error', `pairing exchange: ${res.error}`);
					return;
				}
				if (res.value.rawToken === '') {
					setBusy(false);
					setStatus('Connection failed: server returned no token for the code');
					log('error', 'pairing exchange: server returned an empty token');
					return;
				}
				log('token', 'pairing exchange ok');
				apply({ token: res.value.rawToken, pairingToken: res.value.rawToken });
			}
		}

		// --- 401 recovery for the client -------------------------------
		// Password: refresh the access token (deduped — the walk fires
		// pages in parallel and several can 401 at once). Pairing: re-run
		// the code exchange (a stored pairing token can expire). The plain
		// API-token method has nothing to refresh.
		const onRefresh = async (): Promise<string | null> => {
			if (method === 'password') {
				const refresh = (cur.refreshToken ?? '').trim();
				if (refresh === '') return null;
				if (refreshInFlight.current !== null) return refreshInFlight.current;
				refreshInFlight.current = (async () => {
					const res = await refreshAccessToken(cur.baseUrl, refresh, controller.signal);
					if (!res.ok) {
						log('error', `refresh: ${res.error}`);
						return null;
					}
					log('token', 'refreshed access token');
					apply({
						token: res.value.accessToken,
						refreshToken: res.value.refreshToken,
						tokenExpiresAt: Date.now() + res.value.expiresIn * 1000,
					});
					return res.value.accessToken;
				})();
				try {
					return await refreshInFlight.current;
				} finally {
					refreshInFlight.current = null;
				}
			}
			if (method === 'pairing') {
				const code = (cur.pairingCode ?? '').trim();
				if (code === '') return null;
				const res = await exchangePairingCode(cur.baseUrl, code, controller.signal);
				if (!res.ok) {
					log('error', `pairing re-exchange: ${res.error}`);
					return null;
				}
				if (res.value.rawToken === '') {
					log('error', 'pairing re-exchange: server returned an empty token');
					return null;
				}
				log('token', 're-exchanged pairing code after 401');
				apply({ token: res.value.rawToken, pairingToken: res.value.rawToken });
				return res.value.rawToken;
			}
			return null;
		};

		const client = new RommClient(cur.baseUrl, cur.token, onRefresh);
		clientRef.current = client;

		const authErr = await client.authenticate(controller.signal);
		if (gen !== runGen.current) return;
		if (authErr !== null) {
			log('error', `probe: ${authErr}`);
			setBusy(false);
			setFavGames([]);
			setCollections([]);
			setStatus(controller.signal.aborted ? 'Connection cancelled' : `Connection failed: ${friendlyNetworkError(authErr)}`);
			return;
		}
		log('auth', 'probe ok');

		// Favourites and collections never gate the library: they run
		// alongside the main walk and simply fill their dashboard rows when
		// they land. Either failing just leaves its row out.
		void client
			.getGames(
				(batch) => {
					if (gen !== runGen.current) return;
					if (batch.length > 0) setFavGames((prev) => [...prev, ...batch]);
				},
				() => {},
				controller.signal,
				{ favoriteOnly: true },
			)
			.then(({ games: fs, error }) => {
				if (gen !== runGen.current) return;
				if (error !== null) {
					log('error', `favourites: ${error}`);
					setFavGames([]);
					return;
				}
				setFavGames(fs);
			});

		void client.getCollections(controller.signal).then(({ collections: cs, error }) => {
			if (gen !== runGen.current) return;
			if (error !== null) {
				log('error', `collections: ${error}`);
				setCollections([]);
				return;
			}
			setCollections(cs);
		});

		setStatus('Loading library…');
		// The first page is the moment the user starts looking: the grid
		// appears with what has arrived and the rest streams in behind it.
		let streamed = false;
		const { games: gs, error, truncated } = await client.getGames(
			(batch) => {
				if (gen !== runGen.current) return;
				if (batch.length > 0) setGames((prev) => [...prev, ...batch]);
				if (!streamed) {
					streamed = true;
					setRoute('library');
				}
			},
			(loaded, total) => {
				if (gen !== runGen.current) return;
				setStatus(`Loading library… ${loaded}${total !== null ? ` / ${total}` : ''}`);
				setActivity(
					'library',
					total !== null
						? `Library ${Math.min(100, Math.round((loaded / total) * 100))}%`
						: `Library ${loaded}+`,
				);
			},
			controller.signal,
		);
		if (gen !== runGen.current) return;

		setBusy(false);
		setActivity('library', null);

		if (controller.signal.aborted) {
			setStatus('Connection cancelled');
			// Never reached the first page: there is no library to stay in.
			if (!streamed) setRoute('settings');
			return;
		}
		if (error !== null) {
			log('error', `library walk: ${error}`);
			setStatus(
				streamed
					? `Library incomplete: ${friendlyNetworkError(error)}`
					: `Connection failed: ${friendlyNetworkError(error)}`,
			);
			if (!streamed) setRoute('settings');
			return;
		}

		// The walk finished: the canonical list replaces the streamed one,
		// and the screen is left even when the library is empty.
		log('library', `ok — ${gs.length} games${truncated ? ' (capped)' : ''}`);
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
		log('connect', 'cancelled');
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

	/** Persist a keyboard-mode change (the settings screen's toggle row). */
	function changeKeyboard(keyboard: Config['keyboard']) {
		const next = { ...cfg, keyboard };
		saveConfig(next);
		setCfg(next);
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
		setFavGames([]); // the dashboard falls back to the mock's favourite flag
		setCollections(MOCK_COLLECTIONS);
		setCollectionGames([]);
		setSection(null);
		setPicker(null);
		setDiscSel({});
		setStatus(`Demo mode — ${MOCK_GAMES.length} mock games`);
		setRoute('library');
	}

	function backToSettings() {
		closeSection();
		setPicker(null);
		setRoute('settings');
		setStatus('');
	}

	/** Open a dashboard section in the grid. */
	function openSection(spec: LibrarySection) {
		if (spec.kind === 'collection') {
			openCollection(spec.collection);
			return;
		}
		setSection(spec);
	}

	/** Leave the section (and the collection walk) for the dashboard. */
	function closeSection() {
		colGen.current += 1;
		colAborter.current?.abort();
		setCollectionBusy(false);
		setActivity('library', null);
		setSection(null);
	}

	/**
	 * Open a saved collection: a filtered, streamed walk of its roms — the
	 * grid shows up empty-and-busy and fills in as pages arrive.
	 */
	function openCollection(c: RommCollection) {
		colGen.current += 1;
		const gen = colGen.current;
		colAborter.current?.abort();
		setCollectionGames([]);
		setSection({ kind: 'collection', collection: c });

		if (demo) {
			// No server in demo mode: show a plausible slice of the mock.
			setCollectionGames(MOCK_GAMES.filter((g) => g.id % 7 === c.id % 7));
			setCollectionBusy(false);
			return;
		}

		const client = clientRef.current;
		if (client === null) {
			setCollectionBusy(false);
			return;
		}

		setCollectionBusy(true);
		const controller = new AbortController();
		colAborter.current = controller;

		void client
			.getGames(
				(batch) => {
					if (gen !== colGen.current) return;
					if (batch.length > 0) setCollectionGames((prev) => [...prev, ...batch]);
				},
				(loaded, total) => {
					if (gen !== colGen.current) return;
					setActivity(
						'library',
						total !== null
							? `${c.name !== '' ? c.name : 'Collection'} ${Math.min(100, Math.round((loaded / total) * 100))}%`
							: `${c.name !== '' ? c.name : 'Collection'} ${loaded}+`,
					);
				},
				controller.signal,
				{ collection: c },
			)
			.then(({ games: gs, error }) => {
				if (gen !== colGen.current) return;
				setCollectionBusy(false);
				setActivity('library', null);
				if (error !== null) {
					log('error', `collection walk: ${error}`);
					return;
				}
				setCollectionGames(gs);
			});
	}

	/** The disc a title currently represents (player's choice, else main). */
	function titleDisc(t: RommTitle): RommGame {
		const i = Math.min(Math.max(0, discSel[t.key] ?? t.mainIndex), t.discs.length - 1);
		return t.discs[i];
	}

	/** A cover was chosen: multi-disc titles pick a disc first. */
	function openTitle(t: RommTitle) {
		if (t.discs.length > 1) {
			setPicker(t);
			return;
		}
		openDetail(titleDisc(t));
	}

	function pickDisc(index: number) {
		if (picker === null) return;
		setDiscSel((d) => ({ ...d, [picker.key]: index }));
		const disc = picker.discs[index];
		setPicker(null);
		if (disc !== undefined) {
			openDetail(disc, { index, count: picker.discs.length });
		}
	}

	function openDetail(game: RommGame, disc?: { index: number; count: number }) {
		setDetail(game);
		setDetailDisc(disc ?? null);
		setRoute('detail');
	}

	function closeDetail() {
		setDetail(null);
		setDetailDisc(null);
		setRoute('library');
	}

	// ── the dashboard's data ────────────────────────────────────────────────

	const titles = useMemo(() => groupTitles(games), [games]);

	const favTitles = useMemo(() => groupTitles(favGames), [favGames]);
	// Older servers do not report the flag in the list at all: fall back to
	// whatever the entries carry (and to nothing, if that is nothing).
	const localFavTitles = useMemo(() => groupTitles(games.filter((g) => g.favorite)), [games]);
	const favSource = favGames.length > 0 ? favTitles : localFavTitles;
	const favSourceRaw = favGames.length > 0 ? favGames : games.filter((g) => g.favorite);

	/** The grid's slice for the open section, or null on the dashboard. */
	const gridData = useMemo(() => {
		if (section === null) return null;
		switch (section.kind) {
			case 'continue':
				return {
					games: games.filter((g) => g.lastPlayedAt !== ''),
					title: 'Continue playing',
					busy: false,
					platform: '',
				};
			case 'favourites':
				return { games: favSourceRaw, title: 'Favourites', busy: false, platform: '' };
			case 'recent':
				return {
					games: [...games].sort((a, b) =>
						a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0,
					),
					title: 'Recently added',
					busy: false,
					platform: '',
				};
			case 'platform':
				return { games, title: section.platform, busy: false, platform: section.platform };
			case 'collection':
				return {
					games: collectionGames,
					title: section.collection.name !== '' ? section.collection.name : 'Collection',
					busy: collectionBusy,
					platform: '',
				};
		}
	}, [section, games, favSourceRaw, collectionGames, collectionBusy]);

	/** A stable key so the grid remounts (fresh filters) per section. */
	function sectionKey(spec: LibrarySection | null): string {
		if (spec === null) return 'main';
		if (spec.kind === 'platform') return `platform:${spec.platform}`;
		if (spec.kind === 'collection') return `collection:${spec.collection.id}`;
		return spec.kind;
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
					onKeyboardChange={changeKeyboard}
				/>
				<ActivityBadge />
			</>
		);
	}

	// The grid stays mounted underneath the detail screen: its scroll
	// position and filter state survive the round trip, and the detail
	// screen only has to paint over it. The key remounts it per section,
	// so a section's search and chips start clean.
	const grid =
		section === null || gridData === null ? null : (
			<LibraryGrid
				key={sectionKey(section)}
				games={gridData.games}
				status={status}
				demo={demo}
				busy={busy || gridData.busy}
				title={gridData.title}
				busyTitle={section.kind === 'collection' ? `Loading ${gridData.title}…` : undefined}
				discSelections={discSel}
				onPickDisc={openTitle}
				onBack={closeSection}
				onOpen={openDetail}
				paused={route === 'detail' || picker !== null}
				initialPlatform={gridData.platform}
			/>
		);

	return (
		<>
			{section === null ? (
				<LibrarySections
					status={status}
					busy={busy}
					demo={demo}
					titles={titles}
					favoriteTitles={favSource}
					collections={collections}
					discSelections={discSel}
					onOpenTitle={openTitle}
					onOpenSection={openSection}
					onBack={backToSettings}
					paused={route === 'detail' || picker !== null}
				/>
			) : (
				grid
			)}
			{route === 'detail' && detail !== null && (
				// The key makes the screen remount per game, so its state
				// (which artwork is loading) never leaks into the next one.
				<GameDetail key={detail.id} game={detail} disc={detailDisc ?? undefined} onBack={closeDetail} />
			)}
			{picker !== null && (
				<DiscPicker
					key={picker.key}
					title={picker}
					initial={Math.min(Math.max(0, discSel[picker.key] ?? picker.mainIndex), Math.max(0, picker.discs.length - 1))}
					onPick={pickDisc}
					onClose={() => setPicker(null)}
				/>
			)}
			<ActivityBadge />
		</>
	);
}
