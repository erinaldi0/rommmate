# RomM for Switch — Project Plan (v3)

A Nintendo Switch companion app for [RomM](https://romm.app), a self-hosted ROM
manager — built on **nx.js**, the JavaScript/TypeScript runtime for Switch homebrew,
with a **react-tela** (React → canvas) UI.

> **v13 pivot (2026-10): the *Play* feature.** v1–v12 built the *browse* half
> (connect, library, dashboard, artwork). v13 makes it a real player: download
> roms, BIOS and the emulator (RetroArch) **from the RomM server**, launch
> RetroArch in-game, and **sync saves + save states** back. See
> [v13 — Play](#v13--play-downloadslaunchsync).
>
> The long-form iteration notes from v0.5–v0.12 have been compressed into the
> [changelog](#changelog); the detail lives in the git history.
>
> **v2 pivot (2026-10, historical):** v1 used C++ + libnx + Borealis + libcurl;
> it was rewritten on nx.js and the v1 tree was removed (preserved in the
> initial commit `6cc4721`; still a useful reference for the older RomM JSON
> shapes).

## Why nx.js

- **Web APIs instead of C**: `fetch()` (mbedtls TLS), `WebSocket`, `Image`/
  `createImageBitmap`, `OffscreenCanvas`, Web Audio, `localStorage` (persisted to
  the Switch Save Data filesystem), `requestAnimationFrame`, Web Gamepad +
  touch events — all provided by the runtime.
- **No toolchain on the dev machine**: app development is pure Node.js/npm
  (esbuild → single `romfs/main.js`). No devkitPro, no Borealis submodule, no
  portlibs. (devkitPro is only needed to build the *runtime* itself, which we
  don't — we consume the published one.)
- **A proven reference app**: the runtime author's own
  [`switch-nsp-forwarder`](https://github.com/TooTallNate/switch-nsp-forwarder)
  is a shipped, polished canvas UI app (tile grid, joystick navigation,
  touch-scrolling) built with exactly this stack. We model ours on it.
- **It can launch other homebrew**: `Switch.Application` takes an NRO path (or
  buffer) and `launch(...args)` starts it — the mechanism the *Play* button uses
  to start RetroArch with a core and game.

## Stack

| Concern       | Choice |
|---------------|--------|
| Runtime       | **nx.js** v1 — V8 + libuv + Skia; pinned release (`1.0.0-beta.7`); docs: [nxjs.n8.io](https://nxjs.n8.io/runtime) |
| Language      | **TypeScript**, bundled by **esbuild** → single `romfs/main.js` |
| UI            | **React + [react-tela](https://github.com/TooTallNate/react-tela)** — `<Rect>`/`<Text>`/`<Image>`/`<Group>` canvas scene graph; `render(<App/>, screen)`; **version-pinned** (marked "in development — expect breaking changes") |
| Layout        | Manual positioning for the tile grid; `@react-tela/flex` (Yoga/WASM) available later if needed |
| Networking    | global `fetch()` + `WebSocket` (RomM API, bearer token) |
| Persistence   | `localStorage` (Save Data) for config; `Switch.*` native fs APIs for SD data (covers, roms, saves) |
| Graphics      | Skia-accelerated canvas (`screen.getContext('2d')`) in **application mode** |
| Packaging     | **NSP installed title** (slim: tiny forwarder + shared runtime), via `@nx.js/nsp`; NRO builds for dev iteration |
| v13 extras    | **`fflate`** (zip — the runtime has none; `DecompressionStream` covers gzip/zstd only) and **`spark-md5`** (streaming MD5 — RomM hashes saves with MD5, WebCrypto has no MD5). Both are small, pure-JS, esbuild-friendly. |

## nx.js facts we rely on (verify per release — it is 1.0.0-beta)

- `screen` — 1280×720 display; `getContext('2d')` (Skia, GPU in application
  mode, CPU raster fallback in applet mode). One context kind per canvas.
- **Memory regimes**: *application mode* (installed NSP, or hbmenu via title
  override) → ~3 GiB, full V8 JIT, GPU canvas. *Applet mode* (launched from the
  Album) → ~380 MiB, jitless by default, CPU raster, no WebGL2. **We ship an NSP
  → application mode.** Tunable via `nxjs.ini` in romfs (`[v8] jit`,
  `[memory] heap_limit`, …); fallbacks are logged to `sdmc:/switch/nxjs-debug.log`.
- **Packaging**: slim apps are a few-hundred-KB launcher that chainloads a
  shared runtime from `sdmc:/nx.js/nxjs-v<version>.nro` (chosen by the `[runtime]
  version` in `nxjs.ini`); the bootstrap auto-downloads it on first launch. Fat
  builds embed the whole runtime via `--fat`.
- **Input**: Web Gamepad (`Gamepad`, `GamepadButton`, `GamepadEvent`, haptics)
  + `TouchEvent`/`Touch` for the touchscreen.
- **Files**: `Switch` namespace — `readFile`/`writeFile`/`mkdir`/`readDir`/
  `stat`/`rename`/`remove` for `sdmc:` paths; `FsFile` (a `File` subclass)
  streams through `ReadableStream`/`WritableStream` — **the only sane way to
  move big files without holding them in the (32-bit) V8 heap**; `romfs:`/
  `sdmc:`/`nxjs:` URL protocols for `Image`, `fetch`, streams.
- **Switch surface added to the notes in v13**: `Switch.Application(pathOrNro)`
  + `launch(...args): never` (title takeover of a homebrew NRO, args passed —
  the *Play* mechanism; needs an on-box spike), `Switch.FileSystem.openSdmc()`
  → `freeSpace()`/`totalSpace()` (download guards), `Switch.WebApplet(url)`
  (open the RomM web UI for one-time uploads), `crypto.subtle` (SHA only —
  **no MD5**), `DecompressionStream` (deflate/gzip/zstd — **no zip**).
- **Misc**: `fonts`, `console` (themed on-screen terminal), `localStorage`
  (Storage → Save Data), `Performance`, timers, `TextEncoder/Decoder` (utf-8).

## RomM endpoints used

Browsing (v1–v12, still current):

- `GET /api/roms?limit=…&offset=…` — the game list, walked page by page (100
  per page) until the library is exhausted; doubles as the auth probe
  (`limit=1`).
- `GET /api/platforms?limit=100` — platform list (names + logos).
- `GET /api/collections` — saved collections (5.x; absent on older servers →
  section simply hidden).

RomM versions drift in the details, and the client parses defensively:

- **5.x** answers `limit`/`offset` with `{ items, total, … }`; genres and
  release date live in a `metadatum` blob; covers are local
  `/assets/romm/resources/…` paths (the `?ts=` cache buster contains a space —
  normalised to `%20`).
- **≤4.x** ignores those parameters and answers with a bare array; the client
  falls back to FastAPI's `_limit`/`_page`.

The dialect is sniffed from the shape of the first page. Pages are fetched
**four at a time** (`Promise.allSettled` batches), offsets advance by the
server's *echoed* `limit`, and the walk streams via `onPage` with an
`AbortSignal` for cancel. **Re-validate against your instance's
`openapi.json`** — the v1 C++ parser in the initial commit is the historical
reference.

Play (v13 — all verified live against the user's 5.4.0 instance; every route
is 404-guarded so pre-5.x servers hide the feature):

| Purpose | Endpoint |
|---|---|
| Rom file metadata | `GET /api/roms/{id}/files` — name, size, **`md5_hash`** (verify), `archive_members` for multi-file roms |
| **Rom download** | `GET /api/roms/{id}/content/{file_name}` — streams the raw file; `ETag` + `Accept-Ranges` (resume); `?purpose=play` records a player load; `?file_ids=…` selects members of multi-file roms |
| Batch zip | `GET /api/roms/download?rom_ids=…&filename=…` — server-built zip (paths mirror the server's fs layout) |
| **BIOS** | `GET /api/firmware?platform_id=…` (`FirmwareSchema` with crc/md5/sha1 + `missing_from_fs`) · `GET /api/firmware/{id}/content/{file_name}` |
| **Device** | `POST /api/devices` `{name, platform, client, client_version, sync_mode:"api"}` → `device_id` (uuid, persisted) |
| **Save sync** | `POST /api/sync/negotiate` `{device_id, saves:[{rom_id, file_name, slot, emulator, content_hash, updated_at, file_size_bytes}], rom_ids:[…], emulators:[…], restore_unlisted?}` → `{session_id, operations:[{action: upload|download|conflict|no_op|delete, …}]}` |
| Save up | `POST /api/saves?rom_id=&emulator=&slot=&device_id=&content_hash=&overwrite=` (multipart `saveFile`) |
| Save list | `GET /api/saves?rom_id=…&device_id=…` (the `download_path` per save) |
| Save down | `GET /api/saves/{id}/content` (octet-stream, ETag = content hash) · `POST /api/saves/{id}/downloaded` `{device_id, content_hash}` (confirms) |
| **Save states** | `POST /api/states?rom_id=&emulator=` (multipart) · `GET /api/states?rom_id=…` · `GET /api/states/{id}/content` |
| Play tracking | `POST /api/play-sessions` `{device_id, sessions:[{rom_id, save_slot, start_time, end_time, duration_ms}]}` · `POST /api/activity/heartbeat` `{rom_id, device_id}` — feeds the *Continue playing* row |
| Sync bookkeeping | `POST /api/sync/sessions/{id}/complete` · `GET /api/sync/sessions?device_id=` |

Save pairing is by **(rom_id, slot)**; the server compares `content_hash`
(**MD5** — a downloaded save's md5 matched the stored `content_hash`
byte-for-byte) and mtime to decide the action. A `null` slot is an archival
save that never pairs.

## Directory structure

```
rommmate/
├─ package.json             # deps: react, react-tela, fflate, spark-md5, @nx.js/* (types/packagers)
├─ tsconfig.json
├─ romfs/
│  ├─ main.js               # esbuild bundle (generated — gitignored)
│  ├─ nxjs.ini              # [v8]/[renderer]/[runtime] tuning; [runtime] version baked by packager
│  └─ assets/               # default poster, icon
├─ src/
│  ├─ main.tsx              # entry: render(<App/>, screen); global error overlay
│  ├─ App.tsx               # route state machine: Settings ↔ Library ↔ Detail
│  ├─ romm/                 # the RomM client (module split in v0.12)
│  │  ├─ client.ts          #   RommClient: authenticated fetch (one-shot 401 refresh),
│  │  │                     #   roms walk, collections, platforms — + v13: firmware, saves,
│  │  │                     #   states, sync, devices, play-sessions, content streams
│  │  ├─ dialect.ts         #   5.x vs ≤4.x page shapes, query builders, paging constants
│  │  ├─ parse.ts           #   defensive field parsers (covers, genres, dates, sizes, …)
│  │  ├─ group.ts           #   disc grouping (groupTitles, knownDiscs, discReleaseSlots)
│  │  ├─ types.ts           #   the normalised shapes the rest of the app sees
│  │  └─ index.ts           #   public barrel
│  ├─ session.ts            # token acquisition per sign-in method + deduped 401 recovery
│  ├─ auth.ts               # password grant / pairing exchange / refresh (raw fetch layer)
│  ├─ config.ts             # baseUrl + credentials via localStorage (Save Data)
│  ├─ covers/               # cover pipeline (v0.12 split)
│  │  ├─ index.ts           #   SD cache, fetch queue (≤4 in flight), resolveCover/prefetchCovers
│  │  └─ pipeline.ts        #   decode → downscale ≤640 → per-(size,fit) derive → PNG
│  ├─ roms/                 # v13 — install side
│  │  ├─ manifest.ts        #   sdmc:/switch/rommmate/manifest.json: installed roms, emulator,
│  │  │                     #   cores, bios (paths, sizes, hashes, rom ids)
│  │  ├─ download.ts        #   queue manager: stream → .part → md5 verify → rename;
│  │  │                     #   Range-resume; progress into activity.ts
│  │  └─ install.ts         #   per-game install/uninstall (extract small zips via fflate,
│  │                        #   pass big archives through — RetroArch reads zips natively)
│  ├─ retroarch/            # v13 — the emulator itself
│  │  ├─ layout.ts          #   the SD paths (one constant table — everything else derives)
│  │  ├─ emulator.ts        #   loader NRO + retroarch.jpg + retroarch.cfg (generated:
│  │  │                     #   save/state/system dirs); version staleness vs server hashes
│  │  ├─ cores.ts           #   platform→core map (user-overridable), on-demand core fetch
│  │  └─ bios.ts            #   firmware download → retroarch/cores/system/ (hash-verified)
│  ├─ launch.ts             # v13 — Switch.Application(title-takeover) + '-L' core + game;
│  │                        #   writes the pending-session marker before the process leaves
│  ├─ saves/                # v13 — save sync
│  │  ├─ device.ts          #   one-time device registration, persisted uuid
│  │  ├─ inventory.ts       #   walk the save/state dirs, match rom basenames, snapshot
│  │  │                     #   (mtime/size), md5 the changed ones (spark-md5 streaming)
│  │  └─ sync.ts            #   negotiate → execute ops → complete; conflict policy;
│  │                        #   play-session ingest from the pending-session marker
│  ├─ activity.ts           # tiny pub/sub for background work — the top-right badge
│  ├─ network.ts            # nifm pre-flight + transport-error → actionable text mapping
│  ├─ log.ts                # on-device log → sdmc:/switch/rommate.log (never secrets)
│  ├─ errors.ts             # global error trap → on-screen FatalError
│  ├─ text.ts / theme.ts / time.ts / version.ts / vk.ts / mock.ts / react-tela-compat.ts
│  ├─ hooks/
│  │  ├─ use-gamepad.ts     # rAF input loop: edge-triggered buttons, auto-repeat, stick
│  │  ├─ use-drag-scroll.ts # touch drag → scroll offset
│  │  ├─ use-canvas-tap.ts  # tap (touch or mouse) → logical canvas coordinates
│  │  ├─ use-text-entry.ts  # field editing: system keyboard, silent-failure detection,
│  │  │                     #   built-in-keyboard fallback (v0.8.2)
│  │  └─ use-tick.ts        # coarse interval re-render (loading feedback)
│  ├─ lib/
│  │  └─ library-filters.ts # search/platform chip rules (pure, preview-tested)
│  └─ components/
│     ├─ Header.tsx / HintBar.tsx / Spinner.tsx / EmptyState.tsx
│     ├─ ActivityBadge.tsx  # top-right toast (walk, artwork, downloads, sync)
│     ├─ LibrarySections.tsx / dashboard/section-rows.ts   # the five-row dashboard
│     ├─ LibraryGrid.tsx / CoverTile.tsx / CoverImage.tsx / FilterBar.tsx
│     ├─ GameDetail.tsx     # + v13 rows: Play / Install / Sync saves / Uninstall
│     ├─ Downloads.tsx      # v13 — the queue screen (progress, pause, cancel, resume)
│     ├─ SyncReport.tsx     # v13 — n uploaded, m downloaded, conflicts
│     ├─ SetupDoctor.tsx    # v13 — emulator/cores/BIOS/server-features checklist,
│     │                     #   WebApplet deep-links to the RomM web UI for uploads
│     ├─ SettingsScreen.tsx # credentials + sign-in method + keyboard + v13: core picks,
│     │                     #   auto-sync toggle, hidden (tooling) platforms
│     ├─ InAppKeyboard.tsx  # built-in QWERTY fallback
│     └─ FatalError.tsx
├─ tools/
│  ├─ build.mjs             # esbuild → romfs/main.js + build id stamping
│  ├─ nettest/              # standalone network diagnostic NRO (v0.10)
│  └─ preview/              # browser preview harness (see below) + mock RomM
└─ (output) rommate.nro / rommate.nsp
```

## UI architecture (react-tela)

- `render(<App/>, screen)` from `react-tela/render` — React tree drawn onto the
  runtime's screen canvas; no DOM assumed.
- **Grid**: rows×cols computed in JS; only viewport rows rendered (row culling),
  overflow masked with two opaque bands. `<Group>` is deliberately unused — it
  renders into an offscreen canvas and a failure there aborts the frame.
- **Navigation**: Web Gamepad polled in a `requestAnimationFrame` loop (d-pad/
  stick grid focus, A select, B back) + touch drag scrolling; the v0.12
  `src/gamepad/loop.ts` owns the loop, `hooks/use-gamepad.ts` the hook.
- **Focus ring**: rounded `<Rect>` stroke around the focused tile.
- **Cover art**: `covers/` fetches with the API token, caches on the SD (a
  ≤640 px master, then one derived file per drawn size/fit), and renders
  `<Image src="sdmc:/…">` with a placeholder until ready.
- **Exit**: NSP-installed → the Home button suspends the app natively.

## v13 — Play: downloads/launch/sync

**Goal**: from the Switch, with the RomM server as the single source of truth
for games, BIOS and the emulator itself — play, and never lose progress.

### The loop

```
Detail screen
 ├─ "Play" ─► ensure core + BIOS present ─► write pending-session marker
 │           ─► Switch.Application('sdmc:/switch/retroarch_switch.nro')
 │                   .launch('-L', corePath, gamePath)      [process replaced]
 ├─ (user plays in RetroArch, Home, re-opens RomMmate)
 └─ app boot: marker? ─► ingest play session (durations → Continue row)
                       ─► save sync: snapshot-diff → md5 changed files
                       ─► /api/sync/negotiate ─► upload / download /
                           delete / conflict (dialog: keep mine · take theirs)
                       ─► save states: newest-wins per (rom, emulator)
                       ─► complete sync session
```

**Verified against the live 5.4.0 instance (2026-10-25, `tools/synctest.ts`):**
- The negotiate payload is snake_case end to end (`rom_id`, `file_name`,
  `content_hash`, `updated_at`, `file_size_bytes`) — Pydantic silently drops
  camelCase keys; the saves list *and* the heartbeat must be mapped by hand.
- Saves pair on **(rom_id, slot)**. RetroArch/mGBA writes `Foo.srm`/`.gbs`;
  the server's mGBA clients call that slot `autosave`, so the inventory maps
  those two extensions to `autosave` (everything else keeps its extension).
  Without the mapping a real save never pairs and is re-offered every sync.
- `emulators: null` (RetroArch loads any core's saves — a list would make the
  server "leave alone" saves another emulator wrote in the same slot). The
  *declared* emulator is the placed core's identity (`mgba_libretro*.nro` →
  `mgba`, fork names normalised) so an upload replaces, not duplicates.
- `restore_unlisted: true` + `rom_ids` = **all installed roms** (not just the
  ones holding a local save): the console never deletes saves, so a server
  save for an installed rom without a local copy is a download — that is how
  progress made elsewhere reaches the console.
- A restored save with no local pair is written under the rom's base name
  (RetroArch's own save name), snapshotted with the server hash — it joins
  the next inventory and converges to `no_op` (the E2E asserts a quiet 2nd
  sync: `=2` no-ops, zero traffic).
- Pitfall: `baseName()` is file-name-only; the manifest holds *paths*, so the
  join uses `baseNameOf()`. (This bug made every sync silently no-op — the
  E2E upload check is what caught it.)

### SD layout (all constants in `src/retroarch/layout.ts`)

```
sdmc:/switch/rommmate/              # app data: manifest.json, pending-session.json, rommate.log
sdmc:/switch/retroarch_switch.nro   # RetroArch loader (from RomM), + sdmc:/retroarch.jpg
sdmc:/retroarch/retroarch.cfg       # generated by us: save_directory=sdmc:/rommmate/saves,
                                    #   state_directory=sdmc:/rommmate/states,
                                    #   system_directory=sdmc:/retroarch/cores/system
sdmc:/retroarch/cores/*.nro         # cores (from RomM, per platform, on demand)
sdmc:/retroarch/cores/system/*.bin  # BIOS (from RomM firmware, e.g. PS1 scph1001.bin)
sdmc:/rommmate/roms/<platform>/<fs_name>   # downloaded roms (small zips auto-extracted,
                                            #   big archives passed through as-is)
sdmc:/rommmate/saves/  +  sdmc:/rommmate/states/   # RetroArch writes here; we sync from here
```

Save files are discovered by **basename match** with the installed rom
(`<rom-base>.srm/.mcr/.mbc/.nvram/.bflash/…` in the cfg's save/state dirs) —
deterministic because *we* generate the cfg. RetroArch version/asset staleness
is tracked by the server file's hash/size/last-modified, never by name.

### One-time server setup (RomM web UI — the Setup/doctor screen guides this)

1. Platform **"RetroArch"** (e.g. `roms/retroarch`) containing:
   - `retroarch-loader.zip` — the official bundle's `switch/` folder + `retroarch.jpg`
   - the **curated core NROs** for the library's platforms: FCEUmm (NES) ·
     Snes9x 2010 (SNES) · Gambatte (GB/GBC) · mGBA (GBA) · Mupen64Plus Next
     (N64) · DeSmuME (NDS) · Beetle PSX (PS1) · PPSSPP (PSP) · DOSBox SVN (DOS)
2. **Firmware**: PS1 `scph1001.bin` (the only BIOS the library's emulable
   platforms need).
3. The "RetroArch" platform is hidden from the dashboard via a settings toggle
   (it is tooling, not games).

**Decided (2026-10):** curated cores over the full bundle (small Switch
footprint, downloaded per platform on first need) · sync covers saves **and**
save states · all four capabilities ship in one phased iteration.

**Not emulable on Switch** (no official cores): PS2/3/4, PS Vita, Wii,
Switch titles — those platforms stay browse/download-only and wear a
"no compatible core" badge.

### Phases

0. **Spike** — a tiny dev NRO that `Application.launch`es a test NRO with args
   (title takeover + arg passing is the one unverified runtime behaviour);
   plus an fflate/spark-md5 smoke test under the app regime.
1. **Emulator provisioning** — `src/retroarch/`: loader+cfg+assets install,
   core map + on-demand core fetch, BIOS download (hash-verified), SD
   free-space guard (`Switch.FileSystem.openSdmc().freeSpace()`).
2. **Rom downloads + Play** — `src/roms/download.ts` queue (stream → `.part` →
   MD5-verify → rename; Range-resume; cancel/pause; progress badge) + detail
   rows *Install*/*Play*/*Uninstall*; `src/launch.ts` (marker → launch; on
   preview the row is inert).
3. **Save sync** — `src/saves/`: device registration, inventory + snapshot
   diff, negotiate/execute/complete, states newest-wins, conflict dialog,
   auto-sync on boot after a play session, manual *Sync saves* per game +
   *Sync all*.
4. **Polish** — Setup/doctor screen (WebApplet deep-links), core picker,
   unsupported-platform badges, mock RomM gains every v13 endpoint in the
   preview harness, PLAN.md stamp.

### Risks

- **`Application.launch` arg passing** unverified on real hardware → the
  spike; if args don't reach the NRO, fall back to baking a per-game
  `retroarch.cfg` (`libretro_path` + content) and launching with no args.
- **32-bit heap**: nothing ≥ a few MB may live in V8 — every big transfer
  streams through `res.body` → `FsFile.writable` in chunks; zips over ~8 MB
  are passed through (RetroArch opens archives natively) rather than
  in-memory extracted.
- **RomM drift**: all v13 routes are 5.x — the client 404-probes them once at
  connect and the UI hides what the server lacks (same discipline as
  collections/platforms).
- **SD space**: a Wii/PS2 ISO is multi-GB; every queue and every provisioning
  step checks `freeSpace()` up front and mid-download.
- **RetroArch version lockstep**: loader and cores must match (a 1.14-era
  `libretro_path` bug); we install the *set* the user uploaded together and
  re-fetch when any file's server hash changes.

## Build & run

1. **Scaffold** (done): `npx create-nxjs-app` → `rommate`; `npm i react react-tela`.
2. **Build**: `npm run build` (esbuild → `romfs/main.js`) → `npm run nsp`
   (slim NSP) or `npm run nro` for drop-in dev builds.
3. **Install**: copy `rommate.nsp` to the Switch, install via Atmosphere
   (`nsps/`), launch from the homescreen → application mode. First launch
   auto-downloads the shared nx.js runtime to `sdmc:/nx.js/` (needs Wi-Fi once).
4. **Configure**: Settings screen (baseUrl + one of three sign-in methods:
   API token / password grant / pairing code). **Demo mode** opens a mocked
   library without a server.
5. Dev loop: `npm run nro` → `sdmc:/switch/` → homebrew menu (applet mode,
   CPU raster — fine for UI iteration; use the NSP for perf).
6. v13 on the box: the Setup/doctor screen drives the one-time RetroArch +
   BIOS uploads; everything after is in-app.

## Browser preview harness (dev-only)

`tools/preview/` renders the **real** `src/` components into a `<canvas>` in a
browser:

- `?view=demo|filter|empty|detail|spinner` — a starting state per screen.
- `?sim=Up,A,B` — simulated buttons (fake Web Gamepad + keyboard).
- `?cover=<url>` overrides tile artwork; `?base=<url>&token=…` seeds
  credentials against a real RomM via `proxy.mjs` (CORS; the Switch app is
  unaffected — nx.js's `fetch` has no CORS).
- The trace is mirrored into the document title; `bands.mjs`/`probe.mjs`/
  `ascii.mjs` read screenshots from the terminal; `shot.mjs` takes real-time
  offsets over CDP; `click.mjs` drives the touch path; `?fkbd=1|2` simulates
  the two silent system-keyboard failures.

v13 extends the mock (`src/mock.ts` + the preview's fetch stub) with every new
endpoint: content streams (incl. `Accept-Ranges`), the batch zip, firmware,
saves/states, sync negotiate (hash-matching semantics), devices, and
play-sessions — so the whole Play loop, including a faked RetroArch
save-file drop, runs in the browser before it touches the box.

Headless-Chrome quirks worth knowing: it paints **one** animation frame per
load (the harness shims `requestAnimationFrame` with a timer); Chrome's own
`navigator.virtualKeyboard` is replaced, not detected; and virtual time
**pauses while a fetch is in flight** (so `--virtual-time-budget` screenshots
only land after every request settles).

## Risks / open items (standing)

- **react-tela is explicitly in development** → pinned; upstream is
  same-author and proven by the NSP forwarder.
- **nx.js is 1.0.0-beta** → pinned `[runtime] version`; multiple runtime
  versions coexist on the SD.
- **WASM** (only if we adopt `@react-tela/flex`/Yoga later): needs JIT —
  fine in application mode. v1 avoids it via manual layout.
- **Cover-art URL shape** drifts across RomM versions → defensive parse
  (`#absUrl` normalises the space-bearing `?ts=` buster).
- **`WebSocket` live updates** (library changes) — the runtime has it; not
  used yet.
- **Password grant / pairing exchange** are written against the 5.x surface
  (the API-token method is validated on the real box); re-check against
  `openapi.json` when convenient.

## Changelog

The long-form notes lived here through v0.12; the git history keeps the detail.

| Version | What landed |
|---|---|
| v0.5 | Library screen (platform chips, search via on-screen keyboard), game detail, cover fetch→SD cache→`<Image>`, shared Header/HintBar/EmptyState/Spinner/theme |
| v0.6 | Lazy artwork prefetch for rows around the viewport; `shot.mjs` real-time-offset screenshots |
| v0.7 | RomM 5.x dialect (shape sniffing; `/api/library` is gone), whole-library pagination (1266 roms on 5.4.0), `proxy.mjs` + `?base`/`?token` live preview |
| v0.8 | Parallel page batches of 4 (~14 s instead of ~27 s), walk cancel via `AbortSignal`, background-activity badge (pub/sub + `useSyncExternalStore`) |
| v0.8.1 | Touch on the settings screen (tap = A), `use-canvas-tap`, `click.mjs` |
| v0.8.2 | Built-in keyboard fallback for the two silent system-keyboard failures, `?fkbd` harness knobs |
| v0.10 | Three sign-in methods (token / password grant + rotated refresh / pairing code) with deduped 401 recovery; on-device log; nifm network pre-flight + actionable error mapping; artwork memory fixes (SD-first, 4-way fetch cap, ≤640 px downscale); streaming library load; `tools/nettest` diagnostic NRO; shared `normalizeBaseUrl` |
| v0.11 | Five-row library dashboard (continue/favourites/platforms/recent/collections), multi-disc titles + disc picker, react-tela `insertBefore` compat patch, dashboard z-order fix (plate merged into the border rect) |
| v0.12 | Container-resolution artwork (per-size derived cache, `contain` fit), platform-logo row, favourites disc badge (`knownDiscs`/`discReleaseSlots`), build-id stamping, module refactor (`session.ts`, `romm/`, `covers/`, `gamepad/`, `lib/`, `dashboard/`) |
| v13 | Play: rom downloads, RetroArch + BIOS + cores from RomM, in-game launch, save + state sync |
| **v14** | **The dashboard must not crash and the settings must not vanish: one streamed `/api/roms` request, an NDJSON library cache, background covers, visible-covers-only fetching, an SD-card config store, and stable disc numbering — and no whole-library view anywhere** (below) |
| v15 | Dashboard redesigned to the new mockup: hero with inline install/play + sync saves + install panel + disc pager, platforms as a chip strip, X section menu, and the screen split into `dashboard/` subcomponents (below) |

## v15 — The dashboard, redesigned and split

The home screen was rebuilt against a fresh mockup and, at 1 300 lines,
cut apart while it was done. What changed visually: the header is louder
(glyph tile, product name, tagline, library count, build, a tappable
gear); the featured game — the hero, most recently played else most
recently added — draws large with its install state, a summary, and
**inline actions**: "Install game" (with the A keycap), "Sync saves",
and "More" (the detail screen) all run on the dashboard through the play
service, no navigation needed. The hero is also the *preview*: a row
cover's focus moves the featured content to that game (box art, facts,
actions — so "Install game" always installs what is on display), and
the featured game returns when the focus comes home. A right-hand
installation card shows the
progress, the phase, the facts grid (platform / genres / released /
size) and, for multi-disc releases, a disc pager that Left/Right drives.
Below, rows keep the v11 model; Platforms became a strip of logo chips
that scrolls itself to keep the focused chip in view; X opens a section
menu (the hero first, then every row) so the whole screen is reachable
in two presses; `+` toggles between the hero and the rows.

The discipline survived the rewrite: covers download only when their
slot is inside the viewport (rows cull columns past the right edge, the
strip culls chips, `CoverImage`'s `enabled` prop does the rejecting),
the rows fill in as the streamed walk appends, and the masking bands —
rows scroll under them, chrome paints above — came along unchanged.

What is where now:

- **`components/dashboard/layout.ts`** — the one geometry table (Mar-
  gins, row grid, hero zone, panel column) every subcomponent agrees on.
- **`dashboard/hero.ts`** — the hero model (+ shared play-state bits the
  detail screen reuses: `primaryRow`, the state chip, byte formatting).
- **`dashboard/HeroCard.tsx`** / **`InstallPanel.tsx`** — the hero's two
  columns, purely presentational.
- **`dashboard/TileRow.tsx`**, **`PlatformChipStrip.tsx`**,
  **`SectionMenu.tsx`**, **`cover-slot.tsx`** — one row of covers, the
  chip strip, the X overlay, the shared cover frame.
- **`LibrarySections.tsx`** — what must be in one mind: focus state,
  row scroll, gamepad input, paint order, composition.

## v14 — Library load, cached and streamed

**The crash**: on device, the dashboard died with an out-of-memory while
"loading roms". The v13 walk fetches `/api/roms` in 13 pages of 100 and
calls `setGames` per page; every append re-sorts the rows, remounting the
cover slots of every visible row — up to 9 per row, ~27 tiles at boot —
each queueing a cover job (4 concurrent) whose native decode + PNG
re-encode costs ~3–4 MB transient. Stacked on 13 × 2 MB `JSON.parse`
spikes, the 32-bit V8 heap loses. The live server made it worse: the
whole-library payload is **27.5 MB**, 21 MB of it `merged_ra_metadata` +
`ss_metadata` we never read.

**The directive**: `/api/roms` is not that heavy — load and save the
*entire* result locally in one request; covers download in background;
render only the covers actually displayed on the home screen. And the
library is **never** shown whole: the user navigates via platforms,
collections, favourites and last played.

### What landed

- **`src/romm/stream.ts`** — `ItemStream`, an incremental JSON scanner
  that walks the wrapper, skips every non-`items` value without
  materialising it, and emits each array element as a raw string the
  caller parses one at a time. A chunk may end between any two tokens
  (between a key and its colon, between the colon and `[`, mid-string,
  mid-UTF-8-sequence): the seek is a resumable stage machine
  (`start → key → colon → open → value → afterValue`), scalars
  (`total`/`limit`) are captured wherever they sit in the wrapper, and
  the decode loop holds back incomplete UTF-8 tails instead of dropping
  them. Bare-array bodies are handled. Tested (`tools/streamtest.ts`)
  against the saved 26.3 MB payload at 64 KB and 7919-byte chunks (1266
  items, ~180 ms) and a 512 KB head at 1/2/3/7/13/4096-byte chunks.
- **`src/romm/client.ts` — `getGamesStream`** — preflights
  `modernQuery(1,0,…)` for the dialect + total, then one streamed
  `limit=2000` request (verified honoured: echoed `limit: 2000`). Items
  append through a deduping `addRaw`; the callback may render batches
  incrementally, but the App does not — nothing is drawn mid-walk
  (below). Legacy servers (pre-5.x) and unstreamable bodies fall back to
  the paged walk.
- **`src/library-cache.ts`** — the entire result saved as NDJSON at
  `sdmc:/switch/rommmate/library.ndjson` (header line carries version +
  base + ts; version-gated, per-instance). Writes batch at 32 KB to a
  temp file and `move` atomically; reads window 256 KB and split at the
  last newline — the 32-bit heap never sees the file whole.
- **`src/App.tsx`** — boot is **cache-first**: the saved library paints
  instantly (badge "saved library"), then the streamed walk refreshes in
  background; on failure the cache stays up with a plain-language
  notice. A successful walk rewrites the cache behind the UI. The walk
  itself renders **nothing** until it completes: per-batch appends made
  the rows pop in and reshuffle (the server streams name-ordered, so
  "recently added" kept displacing tiles), and every reshuffle queued
  cover downloads for tiles that were about to be replaced. First run
  (no cache) stays on the connect screen with a live counter, then the
  dashboard appears once, complete.
- **Covers, visibly only** — `CoverImage` grows an `enabled` prop
  (disabled = plate, zero work); `LibrarySections` computes the widest
  visible column from the screen width and only enables tiles inside it
  (plus the focused one); `covers` concurrency drops 4 → 2. Rows mount
  ~27 tiles at boot either way (1280 px shows all 9 columns), but the
  queued-decode storm is gone.
- **No whole-library view** — the `recent` grid section is gone
  (`LibrarySection` has no `recent` kind); the Platforms/Recent/
  Collections row headers open nothing (their covers navigate); the
  grid's filter bar loses its "All" chip, so a grid is always inside a
  platform/collection/favourites/continue scope. The Recently added row
  survives as a browsing aid: its nine covers open titles directly.
- **`tools/libtest.ts`** — live E2E: the streamed walk (1266 games in
  one request, ~12 s server-bound, no duplicates, count agrees with the
  paged walk), the cache round-trip (byte-identical first/last game,
  foreign base rejected), and the auth probe.
- **Settings persist on the SD card** — `localStorage` is Save-Data
  backed, which needs a selected user profile and a save-data mount;
  launched from the homebrew menu it can silently no-op, so every
  launch started from empty credentials. The config's primary store is
  now `sdmc:/switch/rommmate/config.json` (read/written synchronously —
  `fs.ts` grows `readTextSync`/`writeTextSync`), with `localStorage`
  kept as a second copy: the preview's only store, and the migration
  source for a device that did manage to save (promoted to the SD on
  first load). Either store alone boots. Failures log to
  `rommate.log` instead of vanishing. (`tools/configtest.ts`.)
- **The disc number survives partial walks** — a favourite or
  collection holds *some* discs of a release, and the disc picker only
  opened when ≥ 2 had arrived: the tile badge said "1/4" while the
  detail screen showed no disc at all. The detail's Disc row now comes
  from a game-id → release-position map built from the full library's
  titles (`discInfo` in `App.tsx`), so it shows "Disc N of M" on every
  path; `group.ts` tie-breaks equal `sort_comparator`s by id (insertion
  order differs per walk and renumbered discs) and adopts a release-wide
  comparator for an arrived disc whose own is only known to the other
  discs' sibling lists; the picker labels rows by release slot
  (`Disc 2`, not row 2) and counts the whole release.
  (`tools/grouptest.ts`.)

### Measured (live 5.4.0 server, 1266 roms)

| | v13 walk | v14 stream |
|---|---|---|
| requests | 13 pages + auth + meta | 1 (+1 preflight) |
| payload | 27.5 MB across pages | 27.5 MB, parsed incrementally |
| `JSON.parse` spikes | 13 × ~2 MB | none (per-item) |
| appends / row re-sorts mid-walk | 13 | 0 (one commit at the end) |
| covers fetched mid-walk for soon-replaced tiles | every reshuffle | none |
| boot UI | blank until page 1, then popping | instant (cache), covers in background |
| cover jobs at boot | all visible rows × 9 | visible column × rows, ≤ 2 in flight |

