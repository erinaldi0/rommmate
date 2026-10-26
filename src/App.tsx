import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hasConfig, loadConfig, saveConfig, DEFAULT_AUTH_METHOD, type Config } from './config';
import { buildClient, ensureToken, type SessionContext } from './session';
import { configureCovers } from './covers';
import {
	countSnapshot,
	mergeSynced,
	planSync,
	readLibraryCache,
	readSyncState,
	writeLibraryCache,
	writeSyncState,
} from './library-cache';
import { setActivity } from './activity';
import { memSnapshot } from './mem';
import { onFatalError } from './errors';
import {
	RommClient,
	groupTitles,
	type RommGame,
	type RommCollection,
	type RommPlatform,
	type RommTitle,
	type LibrarySection,
} from './romm';
import { log } from './log';
import { networkStatus, friendlyNetworkError } from './network';
import { MOCK_GAMES, MOCK_COLLECTIONS } from './mock';
import { play } from './play';
import { TOOLING_PLATFORM } from './retroarch/emulator';
import { FatalError } from './components/FatalError';
import { SettingsScreen } from './components/SettingsScreen';
import { LibraryGrid } from './components/LibraryGrid';
import { LibrarySections } from './components/LibrarySections';
import { GameDetail } from './components/GameDetail';
import { DiscPicker } from './components/DiscPicker';
import { DownloadsScreen } from './components/DownloadsScreen';
import { SetupDoctor } from './components/SetupDoctor';
import { ActivityBadge } from './components/ActivityBadge';

type Route = 'settings' | 'library' | 'detail' | 'downloads' | 'doctor';

/**
 * The user-created tooling platform (it holds the emulator, not games) is
 * hidden from the library: its "roms" are the loader and core files the
 * setup screens fetch from it.
 */
function isHiddenPlatform(name: string): boolean {
	return name.trim().toLowerCase() === TOOLING_PLATFORM.toLowerCase();
}

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
	/** The server's platforms — the artwork of the dashboard's platforms row. */
	const [platforms, setPlatforms] = useState<RommPlatform[]>([]);
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

	// Anything that blows up while rendering is surfaced on screen instead of
	// leaving a half-drawn frame behind.
	useEffect(() => onFatalError(setFatal), []);

	// The idle memory sampler: one snapshot line every 30 s for the whole
	// session. This is how an OOM "at idle" is proven — the growth curve of
	// the live set, on-device timestamps next to every other event.
	useEffect(() => {
		const t = setInterval(() => log('mem', `idle ${memSnapshot()}`), 30000);
		return () => clearInterval(t);
	}, []);

	// The artwork is fetched by `covers.ts`, which cannot read the token from
	// the URL — it is handed over here, and kept in sync with the saved
	// credentials (the app also auto-connects with a stored config).
	useEffect(() => {
		configureCovers(cfg.token, cfg.baseUrl);
	}, [cfg.token, cfg.baseUrl]);

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

		// --- Token + client --------------------------------------------
		// Token acquisition (password grant, refresh fallback, pairing
		// exchange) and the client's 401 recovery live in session.ts;
		// the result is the same authenticated client as before.
		const session: SessionContext = {
			signal: controller.signal,
			isStale: () => gen !== runGen.current,
			applyConfig: apply,
			setStatus,
		};

		const ensured = await ensureToken(cur, session);
		if (gen !== runGen.current) return;
		if (!ensured.ok) {
			setBusy(false);
			setStatus(`Connection failed: ${friendlyNetworkError(ensured.error)}`);
			return;
		}

		const client = buildClient(() => cur, session);
		clientRef.current = client;

		// Cache-first: the last completed walk is on the SD card — show it
		// before any network wait and refresh over it. (The cache is keyed
		// to this instance's base URL, so a config change ignores it.)
		// While `fromCache`, streamed batches do not append (the whole
		// library is already on screen) — only the final result replaces it.
		let fromCache = false;
		let cachedGames: RommGame[] | null = null;
		log('mem', `connect ${memSnapshot()}`);
		try {
			const cached = await readLibraryCache(client.base);
			if (gen === runGen.current && cached !== null) {
				const visible = cached.filter((g) => !isHiddenPlatform(g.platform));
				fromCache = true;
				cachedGames = cached;
				log('library', `cache: ${visible.length} games (${cached.length} total)`);
				log('mem', `cache-loaded ${memSnapshot()}`);
				setGames(visible);
				setRoute('library');
				setStatus(`Loaded ${visible.length} games — updating…`);
			}
		} catch {
			/* the cache is a nicety, never a gate */
		}

		const authErr = await client.authenticate(controller.signal);
		if (gen !== runGen.current) return;
		if (authErr !== null) {
			log('error', `probe: ${authErr}`);
			setBusy(false);
			if (fromCache) {
				// The saved library is on screen and its covers are on the
				// SD card: stay there rather than bounce to settings.
				setStatus('Cannot reach RomM — showing saved library');
				return;
			}
			setFavGames([]);
			setCollections([]);
			setPlatforms([]);
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
					const visible = batch.filter((g) => !isHiddenPlatform(g.platform));
					if (visible.length > 0) setFavGames((prev) => [...prev, ...visible]);
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
				setFavGames(fs.filter((g) => !isHiddenPlatform(g.platform)));
				log('mem', `fav-loaded ${memSnapshot()}`);
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

		// Platforms come first now: the incremental sync's plan is built
		// from the per-platform rom counts of this one small request (and
		// the same list still feeds the dashboard's platforms row, so it
		// is never wasted).
		const ps = await client.getPlatforms(controller.signal);
		if (gen !== runGen.current) return;
		if (ps.error !== null) {
			log('error', `platforms: ${ps.error}`);
			setPlatforms([]);
		} else {
			setPlatforms(ps.platforms.filter((p) => !isHiddenPlatform(p.name)));
		}

		/**
		 * The shared finish: canonical list replace, cache + sync-state
		 * persist, and the Play service bind. Every sync outcome lands
		 * here — full walk, delta merge, or "nothing changed" (`persist`
		 * false skips the cache rewrite when the data is byte-identical
		 * to what is already on the card).
		 */
		const finish = (all: RommGame[], label: string, capped: boolean, persist = true): void => {
			const visible = all.filter((g) => !isHiddenPlatform(g.platform));
			log('library', `${label} — ${visible.length} games${capped ? ' (capped)' : ''}`);
			setGames(visible);
			setStatus(
				visible.length > 0
					? `Loaded ${visible.length} games${capped ? ' (capped)' : ''}`
					: 'Library is empty',
			);
			setRoute('library');
			if (ps.error === null) {
				void writeSyncState(client.base, countSnapshot(ps.platforms), Date.now()).catch(
					(err) => log('error', `sync state write: ${String(err)}`),
				);
			}
			if (persist) {
				void writeLibraryCache(client.base, all).then(
					() => log('library', `cache saved — ${all.length} games`),
					(err) => log('error', `cache write: ${String(err)}`),
				);
			}
			void play.bind(client, { ...cur }).then(() => void play.bootSync());
		};

		// ── plan the sync ─────────────────────────────────────────────
		// Delta path: the cached list stays canonical except where the
		// server disagrees (platform counts changed, platform vanished,
		// or a rom's `updated_at` moved past the last walk). `planGames`
		// non-null means the full walk below is skipped.
		let planGames: RommGame[] | null = null;
		if (fromCache && cachedGames !== null && ps.error === null) {
			const state = await readSyncState(client.base);
			if (gen !== runGen.current) return;
			const plan = planSync(state, ps.platforms);
			log(
				'library',
				`sync: ${plan.changedPids.length} changed, ${plan.droppedPids.length} gone` +
					(plan.afterIso !== '' ? `, sweep after ${plan.afterIso}` : ', no sweep'),
			);
			let merged = cachedGames.filter(
				(g) => !plan.changedPids.includes(g.platformId) && !plan.droppedPids.includes(g.platformId),
			);
			let failed = false;
			let changed = plan.changedPids.length > 0 || plan.droppedPids.length > 0;
			if (plan.afterIso !== '') {
				const sweep = await client.getGamesStream(
					() => {},
					undefined,
					controller.signal,
					{ updatedAfter: plan.afterIso },
				);
				if (gen !== runGen.current) return;
				if (sweep.error !== null) {
					log('error', `sync sweep: ${sweep.error}`);
					failed = true;
				} else if (sweep.games.length > 0) {
					// The 60 s backstop re-returns the same roms on every
					// boot — only roms whose parsed content genuinely
					// differs (or are new) count as a change, so an
					// unchanged library skips the cache rewrite.
					const prevById = new Map<number, RommGame>();
					for (const g of cachedGames) if (g.id > 0) prevById.set(g.id, g);
					let real = 0;
					for (const up of sweep.games) {
						const prev = up.id > 0 ? prevById.get(up.id) : undefined;
						if (prev === undefined || JSON.stringify(prev) !== JSON.stringify(up)) {
							real += 1;
						}
					}
					merged = mergeSynced(merged, sweep.games);
					changed = changed || real > 0;
					log('library', `sweep: ${sweep.games.length} touched, ${real} changed`);
				}
			}
			for (const pid of plan.changedPids) {
				if (failed) break;
				const walk = await client.getGamesStream(
					() => {},
					undefined,
					controller.signal,
					{ platformId: pid },
				);
				if (gen !== runGen.current) return;
				if (walk.error !== null) {
					log('error', `platform walk ${pid}: ${walk.error}`);
					failed = true;
					break;
				}
				log('library', `platform ${pid}: ${walk.games.length} roms`);
				merged = merged.concat(walk.games);
			}

			if (controller.signal.aborted) {
				setStatus('Connection cancelled');
				setActivity('library', null);
				return;
			}
			if (!failed) {
				setBusy(false);
				setActivity('library', null);
				finish(merged, changed ? 'sync' : 'up-to-date', false, changed);
				return;
			}
			// The delta fetch failed: the saved library stays on screen
			// (`setGames` already holds it), but the sync state is left
			// stale so the next boot re-checks everything.
			setBusy(false);
			setActivity('library', null);
			setStatus('Saved library shown — update failed');
			return;
		}

		setStatus(fromCache ? 'Updating library…' : 'Loading library…');
		// Nothing renders while the walk runs: per-batch appends made the
		// rows pop in and reshuffle (the server streams name-ordered, so
		// "recently added" keeps displacing tiles), and every reshuffle
		// queued cover downloads for tiles that were about to be
		// replaced. The dashboard appears once, complete — the cache
		// covers every boot after this one.
		const { games: gs, error, truncated } = await client.getGamesStream(
			() => {},
			(loaded, total) => {
				if (gen !== runGen.current) return;
				setStatus(`Updating library… ${loaded}${total !== null ? ` / ${total}` : ''}`);
				setActivity(
					'library',
					total !== null
						? `Library ${Math.min(100, Math.round((loaded / total) * 100))}%`
						: `Library ${loaded}+`,
				);
				// One memory line per ~10% of the walk: the growth curve that
				// separates "the walk retains" from "something else leaks".
				if (total !== null) {
					const step = Math.max(1, Math.round(total / 10));
					if (loaded % step === 0) log('mem', `walk ${loaded}/${total} ${memSnapshot()}`);
				} else if (loaded % 100 === 0) {
					log('mem', `walk ${loaded}+ ${memSnapshot()}`);
				}
			},
			controller.signal,
		);
		if (gen !== runGen.current) return;

		setBusy(false);
		setActivity('library', null);

		if (controller.signal.aborted) {
			setStatus('Connection cancelled');
			// The cache never painted (or it would not be a cancel): no
			// library to stay in.
			if (!fromCache) setRoute('settings');
			return;
		}
		if (error !== null) {
			log('error', `library walk: ${error}`);
			if (fromCache) {
				setStatus(`Saved library shown — update failed: ${friendlyNetworkError(error)}`);
				return;
			}
			setStatus(`Connection failed: ${friendlyNetworkError(error)}`);
			setRoute('settings');
			return;
		}

		// The walk finished: the canonical list replaces the streamed (or
		// cached) one, and the screen is left even when the library is
		// empty.
		log('mem', `walk-done ${memSnapshot()}`);
		finish(gs, 'ok', truncated);
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
		configureCovers(next.token, next.baseUrl);
		void connect(next);
	}

	/** Persist a keyboard-mode change (the settings screen's toggle row). */
	function changeKeyboard(keyboard: Config['keyboard']) {
		const next = { ...cfg, keyboard };
		saveConfig(next);
		setCfg(next);
	}

	/** Persist an auto-sync change (the settings screen's Play row). */
	function changeAutoSync(on: boolean) {
		const next = { ...cfg, autoSync: on };
		saveConfig(next);
		setCfg(next);
		// The bound service keeps the new preference for its boot sync.
		play.setConfig(next);
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
		// The Play service without a server: its rows go to "demo mode".
		void play.bind(null, { ...cfg });
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
			// The full library's map is the authority for the disc's place
			// in the release; the picker's own numbering is the fallback
			// for a game the full walk has not delivered this session.
			openDetail(disc, discInfo.get(disc.id) ?? { index, count: picker.knownDiscs });
		}
	}

	function openDetail(game: RommGame, disc?: { index: number; count: number }) {
		setDetail(game);
		setDetailDisc(disc ?? discInfo.get(game.id) ?? null);
		setRoute('detail');
	}

	function closeDetail() {
		setDetail(null);
		setDetailDisc(null);
		setRoute('library');
	}

	/** Open the downloads queue (the Play feature's work, visible). */
	function openDownloads() {
		setRoute('downloads');
	}

	function closeDownloads() {
		setRoute('library');
	}

	/** Open the Play setup doctor (from the settings screen). */
	function openDoctor() {
		setRoute('doctor');
	}

	// ── the dashboard's data ────────────────────────────────────────────────

	const titles = useMemo(() => groupTitles(games), [games]);

	/**
	 * The release position of every multi-disc game, keyed by game id,
	 * from the full library's titles (complete groups, stable numbering).
	 * The detail screen's Disc row comes from here: a partial walk's
	 * title — a favourite or collection holding one disc of four — must
	 * still say which disc of the release it is.
	 */
	const discInfo = useMemo(() => {
		const m = new Map<number, { index: number; count: number }>();
		for (const t of titles) {
			if (t.knownDiscs <= 1) continue;
			t.discs.forEach((g, i) => {
				const slot = t.discReleaseSlots[i] ?? i + 1;
				m.set(g.id, { index: slot - 1, count: t.knownDiscs });
			});
		}
		return m;
	}, [titles]);

	const favTitles = useMemo(() => groupTitles(favGames), [favGames]);
	// Older servers do not report the flag in the list at all: fall back to
	// whatever the entries carry (and to nothing, if that is nothing).
	const localFavTitles = useMemo(() => groupTitles(games.filter((g) => g.favorite)), [games]);
	const favSource = favGames.length > 0 ? favTitles : localFavTitles;
	const favSourceRaw = favGames.length > 0 ? favGames : games.filter((g) => g.favorite);

	/**
	 * The platforms actually present in the library (name + server id,
	 * deduped) — the doctor checks the core/BIOS of these, not of every
	 * platform the server happens to know.
	 */
	const doctorPlatforms = useMemo(() => {
		const seen = new Map<string, { name: string; id: number }>();
		for (const g of games) {
			if (g.platform === '' || seen.has(g.platform)) continue;
			seen.set(g.platform, { name: g.platform, id: g.platformId });
		}
		return [...seen.values()];
	}, [games]);

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

	// The settings, doctor and downloads routes replace the whole screen
	// (full-screen utility pages, in contrast to the detail overlay).
	if (route === 'settings' || route === 'doctor' || route === 'downloads') {
		return (
			<>
				{route === 'doctor' ? (
					<SetupDoctor
						onBack={() => setRoute('settings')}
						baseUrl={cfg.baseUrl}
						platforms={doctorPlatforms}
					/>
				) : route === 'downloads' ? (
					<DownloadsScreen onBack={closeDownloads} />
				) : (
					<SettingsScreen
						initial={cfg}
						status={status}
						busy={busy}
						onSave={saveAndConnect}
						onDemo={startDemo}
						onCancel={cancelConnect}
						onKeyboardChange={changeKeyboard}
						onAutoSyncChange={changeAutoSync}
						onOpenSetup={openDoctor}
					/>
				)}
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
				focusKey={sectionKey(section)}
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
					platforms={platforms}
					collections={collections}
					discSelections={discSel}
					onOpenTitle={openTitle}
					onOpenSection={openSection}
					onOpenDetail={openDetail}
					onSelectDisc={(key, index) => setDiscSel((d) => ({ ...d, [key]: index }))}
					onBack={backToSettings}
					paused={route === 'detail' || picker !== null}
				/>
			) : (
				grid
			)}
			{route === 'detail' && detail !== null && (
				// The key makes the screen remount per game, so its state
				// (which artwork is loading) never leaks into the next one.
				// It is namespaced because the disc picker is a sibling keyed
				// by its title: a game's id and its title's key are the same
				// number, and two siblings sharing one key is a
				// reconciliation hazard (React warns about it). `paused` hands
				// the controller to the disc picker while it floats over this
				// screen.
				<GameDetail
					key={`game-${detail.id}`}
					game={detail}
					disc={detailDisc ?? undefined}
					onBack={closeDetail}
					onOpenDownloads={openDownloads}
					onDiscs={() => {
						const t = titles.find((x) => x.key === detail.gameKey);
						if (t !== undefined) setPicker(t);
					}}
					paused={picker !== null}
				/>
			)}
			{picker !== null && (
				<DiscPicker
					key={`picker-${picker.key}`}
					title={picker}
					initial={Math.min(Math.max(0, discSel[picker.key] ?? picker.mainIndex), Math.max(0, picker.discs.length - 1))}
					onPick={pickDisc}
					onClose={() => setPicker(null)}
				/>
			)}
			{/* The badge sits at the top edge over the detail page (its
				right column starts high); everywhere else it drops below
				the header, next to the count. */}
			<ActivityBadge y={route === 'detail' ? 24 : undefined} />
		</>
	);
}
