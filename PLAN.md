# RomM for Switch — Project Plan (v2)

A Nintendo Switch companion app for [RomM](https://romm.app), a self-hosted ROM
manager — built on **nx.js**, the JavaScript/TypeScript runtime for Switch homebrew,
with a **react-tela** (React → canvas) UI.

> **v2 pivot (2026-10):** v1 of this plan used C++ + libnx + Borealis + libcurl.
> We are rewriting on **nx.js** (V8 + libuv + Skia, Web-platform APIs). The v1
> implementation was removed from the working tree — it is preserved in the
> initial commit (`6cc4721`) and remains useful as a reference for the RomM JSON
> shapes and the cover-grid layout.

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

## Stack

| Concern       | Choice |
|---------------|--------|
| Runtime       | **nx.js** v1 — V8 + libuv + Skia; pinned release (`1.0.0-beta.6` at time of writing); docs: [nxjs.n8.io](https://nxjs.n8.io/runtime) |
| Language      | **TypeScript**, bundled by **esbuild** → single `romfs/main.js` |
| UI            | **React + [react-tela](https://github.com/TooTallNate/react-tela)** — `<Rect>`/`<Text>`/`<Image>`/`<Group>` canvas scene graph; `render(<App/>, screen)`; **version-pinned** (marked "in development — expect breaking changes") |
| Layout        | Manual `<Group>` positioning for the tile grid; `@react-tela/flex` (Yoga/WASM) available later if needed |
| Networking    | global `fetch()` + `WebSocket` (RomM API, bearer token) |
| Persistence   | `localStorage` (Save Data) for config; `Switch.*` native fs APIs for the cover-art cache on `sdmc:` |
| Graphics      | Skia-accelerated canvas (`screen.getContext('2d')`) in **application mode** |
| Packaging     | **NSP installed title** (slim: tiny forwarder + shared runtime), via `@nx.js/nsp`; NRO builds for dev iteration |

## nx.js facts we rely on (verify per release — it is 1.0.0-beta)

- `screen` — 1280×720 display; `getContext('2d')` (Skia, GPU in application mode,
  CPU raster fallback in applet mode). One context kind per canvas.
- **Memory regimes**: *application mode* (installed NSP, or hbmenu via title
  override) → ~3 GiB, full V8 JIT, GPU canvas. *Applet mode* (launched from the
  Album) → ~380 MiB, jitless by default, CPU raster, no WebGL2. **We ship an NSP
  → application mode.** Tunable via `nxjs.ini` in romfs (`[v8] jit`,
  `[memory] heap_limit`, `[renderer] mode`, `[threadpool]`, …); fallbacks are
  logged to `sdmc:/switch/nxjs-debug.log`.
- **Packaging**: slim (default) apps are a few-hundred-KB launcher that
  chainloads a shared runtime from `sdmc:/nx.js/nxjs-v<version>.nro`, chosen by
  the semver `[runtime] version` baked into `nxjs.ini`. On first launch the
  bootstrap **auto-downloads** a compatible runtime from the nx.js GitHub
  releases (needs Wi-Fi once); manual placement works too. Fat builds embed the
  whole runtime (~40 MB NRO / ~21 MB NSP) — available via `--fat` if ever needed.
- **Input**: Web Gamepad (`Gamepad`, `GamepadButton`, `GamepadEvent`, haptics;
  `Gamepad.id` = device name + serial on fw 5.0+) + `TouchEvent`/`Touch` for the
  touchscreen.
- **Files**: `Switch` namespace — `readFileSync`/`writeFile`/`mkdir`/`readDir`
  etc. for `sdmc:` paths; `romfs:`/`sdmc:`/`nxjs:` URL protocols for
  `Image`, `fetch`, streams.
- **Misc**: `fonts` (canvas font set), `console` (themed on-screen terminal —
  handy for debugging), `localStorage` (Storage → Save Data), `Performance`,
  timers, `TextEncoder/Decoder` (utf-8).

## RomM endpoints used

- `GET /api/roms?limit=…&offset=…` — the game list, walked page by page
  (100 per page) until the library is exhausted. The route exists in every
  RomM generation and doubles as the auth probe (`limit=1`).

RomM versions drift in the details, and the client parses defensively:

- **5.x** answers `limit`/`offset` with `{ items, total, … }`; genres and
  release date live in a `metadatum` blob; covers are local
  `/assets/romm/resources/…` paths (the `?ts=` cache buster contains a space
  — normalised to `%20`); screenshots ride in `merged_screenshots`.
- **≤4.x** ignores those parameters and answers with a bare array (or a
  `data`/`results` wrapper) of its own default page size; the client then
  falls back to FastAPI's `_limit`/`_page`. Fields come from the older
  `assets` object and top-level `platform`/`genres`/`release_date`.

The dialect is sniffed from the shape of the first page (a legacy-shaped
sniff is discarded and the walk restarts in the legacy dialect). The walk
stops on a short page, the reported total, a page that adds nothing new
(a server that will not advance → `truncated`), or a 50-page safety cap.

Pages are fetched **four at a time** (`Promise.allSettled` batches): the
network is the slow part and nx.js's `fetch` runs off the V8 thread, so the
UI keeps its input loop and repaints while the walk is in flight, and a
13-page library lands in three waves instead of a thirteen-step waterfall.
Offset reservations advance by the server's *echoed* `limit` (the smallest
seen), so a server that caps page sizes can only cause harmless overlap,
never gaps. An `AbortSignal` cancels the walk (in-flight pages reject on
their own) and it comes back as `{ error: 'cancelled' }`.
**Re-validate against your instance's `openapi.json`** — the v1 C++ parser
in the initial commit is the historical reference.

## Directory structure

```
rommmate/
├─ package.json             # deps: react, react-tela, @nx.js/runtime (types)
│                           # devDeps: esbuild, @nx.js/nro, @nx.js/nsp, typescript
├─ tsconfig.json
├─ romfs/
│  ├─ main.js               # esbuild bundle (generated — gitignored)
│  ├─ nxjs.ini              # [v8]/[renderer]/[runtime] tuning; [runtime] version baked by packager
│  └─ assets/               # default poster, icon
├─ src/
│  ├─ main.tsx              # entry: render(<App/>, screen); global error overlay
│  ├─ App.tsx               # route state machine: Settings ↔ Library ↔ Detail
│  ├─ romm.ts               # RommClient: /api/roms client — version-dialect
│  │                        # sniffing, pagination walk, defensive field parsing
│  ├─ config.ts             # baseUrl + token via localStorage (Save Data)
│  ├─ mock.ts               # mocked library used by the "Demo mode" entry
│  ├─ covers.ts             # cover URL → fetch → cache to sdmc:/… → <Image src>
│  ├─ activity.ts           # tiny pub/sub for background work (library walk,
│  │                        # artwork prefetch) — rendered by the top-right badge
│  ├─ theme.ts              # colours, spacing, radii, type scale (canvas has no CSS)
│  ├─ text.ts               # measure / wrap / truncate (react-tela <Text> cannot do it)
│  ├─ vk.ts                 # structural type for the runtime's on-screen keyboard
│  ├─ version.ts            # build id (stamped by tools/build.mjs)
│  ├─ errors.ts             # global error trap → on-screen FatalError
│  ├─ hooks/
│  │  ├─ use-gamepad.ts     # rAF input loop: edge-triggered buttons, auto-repeat, stick
│  │  ├─ use-drag-scroll.ts # touch drag → scroll offset
│  │  ├─ use-canvas-tap.ts  # tap (touch or mouse) → logical canvas coordinates
│  │  └─ use-tick.ts        # coarse interval re-render (loading feedback)
│  └─ components/
│     ├─ Header.tsx         # title + status line + build stamp (shared by every screen)
│     ├─ HintBar.tsx        # context sensitive button hints (shared)
│     ├─ LibraryGrid.tsx    # the library screen: filter bar + cover grid
│     ├─ CoverTile.tsx      # <Image> cover + <Text> title, focus ring
│     ├─ CoverImage.tsx     # <Image> with a safe failure mode (placeholder instead of a crash)
│     ├─ FilterBar.tsx      # platform chips + search chip, horizontally scrollable
│     ├─ GameDetail.tsx     # artwork, screenshot, metadata, summary
│     ├─ InAppKeyboard.tsx  # built-in QWERTY, used when the system keyboard is unavailable
│     ├─ Spinner.tsx        # tick-driven dots: "something is loading"
│     ├─ EmptyState.tsx     # "nothing here" placeholder
│     ├─ SettingsScreen.tsx # baseUrl / token entry + "Demo mode" row (B cancels)
│     ├─ ActivityBadge.tsx  # top-right toast: what background work is in flight
│     └─ FatalError.tsx     # last-resort error screen
├─ tools/
│  ├─ build.mjs             # esbuild → romfs/main.js + build id stamping
│  └─ preview/              # browser preview harness (dev-only, not shipped)
│     ├─ entry.tsx          # renders the real app into a <canvas>, fakes gamepad + keyboard
│     ├─ build.mjs          # esbuild bundle for the harness
│     ├─ raf-shim.ts        # headless Chrome only paints one frame — keep rAF alive
│     ├─ shot.mjs           # CDP screenshot at a real-time offset (mid-download states)
│     ├─ click.mjs          # CDP mouse click at a point, reads the title trace (drives the touch path)
│     ├─ proxy.mjs          # CORS proxy in front of a real RomM instance (the preview can't hit it directly)
│     └─ bands.mjs / probe.mjs / ascii.mjs   # layout inspection from the terminal
└─ (output) rommate.nro / rommate.nsp
```

## UI architecture (react-tela)

- `render(<App/>, screen)` from `react-tela/render` — React tree drawn onto the
  runtime's screen canvas; no DOM assumed.
- **Grid**: compute a rows×cols tile layout in JS; emit only the rows that
  intersect the viewport (row culling) and mask the overflow with two opaque
  bands. `<Group>` is deliberately unused — it renders into an offscreen canvas
  and composites back with `drawImage()`, and a failure there aborts the frame
  (it is what made the settings rows invisible in v0.2).
- **Navigation**: poll the Web Gamepad in a `requestAnimationFrame` loop →
  grid focus (d-pad/stick), A = select, B = back, plus `onTouchMove` drag
  scrolling. Model the interaction code on `switch-nsp-forwarder`'s
  `src/hooks` + `src/components`.
- **Focus ring**: rounded `<Rect>` stroke around the focused tile (react-tela
  has no built-in focus engine — that's our `gamepad.ts` job).
- **Cover art**: `covers.ts` resolves RomM asset URLs, `fetch()`es the bytes,
  writes them to an `sdmc:` cache dir via `Switch.writeFile`, then the tile
  renders `<Image src="sdmc:/…">` (async load, placeholder until ready).
- **Exit**: NSP-installed → the Home button suspends the app natively. No
  custom quit needed.

## Build & run

1. **Scaffold**: `npx create-nxjs-app` (pick the canvas/hello-world template,
   NSP option) → rename to `rommate`; `npm i react react-tela`.
2. **Build**: `npm run build` (esbuild → `romfs/main.js`) → `npm run nsp`
   (slim NSP) or `npm run nro` for drop-in dev builds.
3. **Install**: copy `rommate.nsp` to the Switch, install via Atmosphere
   (`nsps/`), launch from the homescreen → application mode.
   - First launch: the slim bootstrap auto-downloads the shared nx.js runtime
     to `sdmc:/nx.js/` (needs Wi-Fi once) — or pre-place the release NRO there.
4. **Configure**: in-app Settings screen writes `baseUrl` + `token`
   (`rmm_…`) to `localStorage` (Save Data) — no more hand-editing an SD
   `config.json`. The last row is **Demo mode**: it skips the login entirely
   and opens the library with a mocked catalogue (`src/mock.ts`), so the app
   can be driven without a reachable RomM server.
5. Dev loop: `npm run nro` → drop in `sdmc:/switch/` → homebrew menu (applet
   mode: works, CPU raster — fine for UI iteration; use the NSP for perf).

## Risks / open items

- **react-tela is explicitly in development** ("expect breaking changes") →
  pin an exact version in `package.json`; upstream is same-author, actively
  maintained, and proven by the NSP forwarder.
- **nx.js is 1.0.0-beta** → pin `[runtime] version`; multiple runtime versions
  coexist on the SD, each app picks the highest compatible.
- **Gamepad button indices** — confirm the Web Gamepad index ↔ Switch button
  mapping (it lives in the runtime's `gamepad.cc`; cross-check the forwarder's
  hook).
- **WASM** (only if we adopt `@react-tela/flex`/Yoga later): needs JIT — fine
  in application mode; would need `[v8] wasm = on` + memory in applet mode.
  v1 avoids it via manual grid layout.
- **Cover-art URL shape** drifts across RomM versions → defensive parse, check
  your instance's `openapi.json` (v1's open risk, carried over).
- **Bundle/heap**: React + react-tela is small, but keep an eye on the V8 heap
  in applet mode if we ever ship NRO-only (`[memory] heap_limit` clamps there).

## Browser preview harness (dev-only)

The app is a canvas app, so "does this look right?" is a question a
screenshot answers better than a mental model. `tools/preview/` renders the
**real** `src/` components into a `<canvas>` in a normal browser:

- `?view=demo|filter|empty|detail|spinner` — a starting state per screen.
- `?sim=Up,A,B` — simulated button presses (the harness installs a fake
  Web Gamepad and a fake on-screen keyboard; `?vktext=mario` pre-fills the
  search field).
- `?cover=<url>` overrides every tile's artwork URL, so the fetch/cache
  path can be exercised against an endpoint of our choosing.
- `?base=<url>` (plus `?token=<…>`) seeds the saved credentials with a
  running RomM and auto-connects, so the *live* app can be driven in the
  browser. Point it at `proxy.mjs` rather than at the instance itself: a
  real RomM answers without `access-control-allow-origin`, so Chrome blocks
  the direct fetch (the Switch app is unaffected — nx.js's fetch has no
  CORS). `node tools/preview/proxy.mjs` reads the `url` from `.env` and
  forwards everything, adding the CORS headers; the request log makes the
  pagination walk visible.
- The trace of what the app did is mirrored into the document title, and
  `bands.mjs` / `probe.mjs` / `ascii.mjs` read the screenshot back, so the
  layout can be checked from the terminal. `shot.mjs` takes a screenshot at
  a chosen *real-time* offset over the DevTools protocol — the only way to
  capture a state that depends on a fetch still in flight.

Two headless-Chrome quirks are worth knowing: it only paints **one**
animation frame per load (so the harness shims `requestAnimationFrame` with a
timer), and Chrome has its **own** `navigator.virtualKeyboard` (so the
harness replaces it rather than checking for its presence). A third: virtual
time **pauses while a network fetch is in flight**, so `--virtual-time-budget`
screenshots only ever land *after* every request has settled.

## Next iteration

Done in v0.5:

- Library screen with a filter bar (platform chips) and a search field that
  opens the runtime's on-screen keyboard.
- Game detail screen (cover, screenshot, metadata, summary) on A-press,
  with a loading indicator while its cover is still on its way.
- Cover art is fetched with the API token, cached on the SD card, and drawn
  from the local copy.
- Shared `Header` / `HintBar` / `EmptyState` / `Spinner` / theme tokens.

Done in v0.6:

- Lazy artwork prefetch: the grid warms the cover cache for the rows around
  the viewport (and the focused tile's screenshot), so artwork is usually
  ready by the time its row scrolls into view.
- `shot.mjs`: real-time-offset screenshots via the DevTools protocol, for
  states that depend on an in-flight fetch.

Done in v0.7:

- RomM 5.x support: the API moved — `/api/library` (the old auth probe) is
  gone, the list comes back as `{ items, … }`, and genres / release date /
  cover / size moved to new field names. The client sniffs the dialect from
  the first page and parses both generations.
- Whole-library pagination: the client walks `/api/roms` 100 roms per page
  (a `_limit`/`_page` fallback for ≤4.x, duplicate-page detection, a safety
  cap) and reports progress per page — verified against a real 5.4.0
  instance with 1266 roms.
- `proxy.mjs` + `?base=`/`?token`: the preview can now browse a real library
  through a local CORS proxy.

Done in v0.8:

- Non-blocking startup: the library walk runs in **parallel batches of four**
  pages (the 13-page 1266-rom library now lands in ~14s instead of ~27s), and
  nx.js's `fetch` runs off the V8 thread, so the event loop, status line, and
  gamepad polling stay live the whole time.
- **Cancel**: the walk takes an `AbortSignal`; B on the settings screen
  aborts it (the row reads `connecting… · B to cancel`), and a generation
  counter makes a late walk unable to stomp state the user has left — the
  "press Demo mid-load and get stomped when it completes" bug is fixed.
- **Background-activity badge** (top-right, every screen): a tiny React-free
  pub/sub (`activity.ts`) that the library walk and the artwork prefetch report
  into, rendered by `ActivityBadge` via `useSyncExternalStore`. It shows e.g.
  `Library 900 / 1266` while the walk runs and `Artwork N downloading` while
  covers stream in, and is unmounted entirely when idle. No timers — it only
  repaints when a label actually changes.

  (nx.js has no `Worker` — it is a single V8 thread — so "background" here
  means off the input/repaint path, which the network work already is.)

Done in v0.8.1:

- Touch on the settings screen: tapping a row does what A on that row does
  — the Switch is a touchscreen and a finger is the primary pointer. Tapping
  a field while a connection is in flight cancels the walk and opens the
  keyboard pre-filled: with saved credentials the app auto-connects on
  launch, so that is the only way to fix a fat-fingered URL without waiting
  the walk out.
- `use-canvas-tap` hook (canvas `touchstart`/`mousedown`, structural event
  types, ref-stable callback — same pattern as `use-drag-scroll`) and
  `click.mjs` (CDP mouse click + title-trace readout, for driving the touch
  path from the terminal).

Done in v0.8.2:

- **Built-in keyboard fallback**: the runtime's system keyboard fails in two
  silent ways on some setups — the object creation throws, or the appear
  call fails and the bounding rect stays zero. Both are now detected
  (creation error surfaced, rect re-checked 1.2s after `show()`), and the
  in-app `InAppKeyboard` (compact QWERTY + digits + symbols, gamepad and
  touch driven) takes over the bottom of the screen so the Base URL / API
  Token fields stay editable no matter what. If the system keyboard does
  appear, it is used as before and the fallback never shows.
- `?fkbd=1|2` preview harness knobs simulate both failure modes.

Done in v0.10:

- **Three sign-in methods**, cycled by a new "Sign in with" row on the
  settings screen (`config.ts` grew `authMethod` + per-method fields; the
  credential rows below follow the method):

  - *API token* — the original flow, a RomM Client API Token typed in
    directly.
  - *Password grant* — username + password exchanged via the OAuth2
    password grant (`POST /api/token`, `auth.ts`). The access token is
    short-lived, so it is renewed through its refresh token (RomM rotates
    them) — proactively ~60 s before `tokenExpiresAt`, and transparently
    when a request 401s mid-walk: `RommClient` retries such a request
    once via its `onRefresh` callback, and concurrent 401s (the walk fires
    pages in parallel) share a single, deduplicated refresh. A dead
    refresh token falls back to the full password grant once.
  - *Pairing code* — a short code from the web UI's Client API Tokens
    page, exchanged via `POST /api/client-tokens/exchange` for a client
    API token. The resolved token is persisted (the code is single-use)
    and re-exchanged if the server later 401s it.
- The password masks with dots at rest and in the built-in keyboard's echo
  (a new `mask` prop on `InAppKeyboard`); the API token keeps its partial
  mask. `SwkbdType` has no password layout, so the *system* keyboard
  cannot mask — the built-in Keyboard setting is the private option.
- Verified end-to-end in the preview against a mock RomM: the password
  grant → probe → walk sequence, and the 401 → refresh grant → retried
  request sequence (request logs checked byte for byte). `?auth=
  password|pairing` seeds the settings screen in either method.
- **On-device log** (`src/log.ts` → `sdmc:/switch/rommate.log`): the
  connection flow appends one line per event — method and base URL, each
  token exchange, the probe, the walk, every failure — never a secret.
  (The runtime's own diagnostics live in `sdmc:/nxjs-debug.log`; the
  app's `console` is the on-screen terminal and does not survive a
  reboot.)
- **Network pre-flight** (`src/network.ts`): with no active connection
  the Switch's resolver rejects *every* lookup — even a plain
  `10.x.x.x` literal — with `Address family for hostname not
  supported`, before a single packet is sent. The app now reads the
  IP config from nifm first and refuses up front with "not connected
  to a network — check Wi-Fi in System Settings". The console's own IP
  is recorded in the connect log line, and transport errors are mapped
  to actionable status text (raw-IP rejected → "use a DNS name in Base
  URL", DNS failed, refused, timed out); the raw error always stays in
  the log.
- **Artwork memory fixes** (`src/covers.ts`), after the on-device
  `RangeError: Out of memory (failed to allocate …)` — a native
  `malloc` failure (`nx_alloc`) hit while navigating: the SD cache was
  checked *after* downloading, so every cover was re-pulled in full on
  every launch; downloads were unbounded (a fast scroll stacked dozens
  of in-flight file buffers); and the cache kept full-resolution art,
  whose decoded RGBA copy nx.js's `drawImage` holds per mounted tile
  (a large scan ≈ tens of MiB each, against a 216×288 draw size).
  Now: SD hit checked before the network (each artwork is pulled from
  RomM once, ever — legacy extension-labelled files still honored),
  a 4-download concurrency cap, and first-fetch downscale to ≤640 px
  (decode via a `blob:` URL → `OffscreenCanvas` → `convertToBlob`
  PNG; any failure falls back to caching the original bytes — the
  decoder sniffs content, so the extension is only a label).
- **Streaming library load**: the walk is no longer all-or-nothing.
  `RommClient.getGames` takes an `onPage(batch)` callback that fires per
  page (first page first, including an empty one) — App switches to the
  library as soon as the first chunk arrives and appends each later
  batch, while the header counts up (`Loading library… 400 / 1266`). A
  mid-walk failure keeps whatever already arrived (the grid stays
  browsable; the status says "Library incomplete") instead of discarding
  it. With a stored credential the app now starts *on the library* from
  the first frame (a spinner + "Connecting to RomM…" where the empty
  state would mislead), falling back to the settings screen only when
  the connection dies before the first page. The top-right activity
  badge shows the walk's completion (`Library 37%` with a small dot
  spinner, cleared at 100%). `?connect=0` previews the settings screen
  despite seeded credentials.
- **Standalone debug NRO** (`tools/nettest/` → `npm run nro:nettest` →
  `romm-nettest.nro`): plain-JS nx.js app (no build step — edit
  `romfs/main.js`, repackage) that meters the network stack in 10
  stages (11 with the opt-in UDP probe): nifm IP config,
  target-vs-console subnet note, `resolveDns` of the raw-IP target
  (the bug path — reproduced verbatim under Ryujinx too), `resolveDns`
  of the server's DNS name (`harinaldibologna.duckdns.org`, the
  workaround path — names resolve while numeric literals get
  `Address family…`), `resolveDns(example.com)`, TCP connect by DNS
  name (the "ping"), TCP connect by raw IP (the contrast), HTTP GET
  and RomMmate's exact `POST /api/client-tokens/exchange` via the DNS
  name, plus a WAN check — with `stages ok: N/10` plus hints naming
  the failing layer (including EAGAIN socket-exhaustion). An 11th
  stage (raw UDP-socket DNS round-trip to the console's DNS server,
  separating "TCP refused" from "the whole socket layer is down") is
  opt-in via `udp=1`: enabled, it hard-crashed the process under
  Ryujinx's incomplete bsd socket emulation (log stops mid-stage, no
  JS error — native crash in the uv_poll layer; nx.js's udp.cc
  registers a second uv_poll_t on the same fd for sendto), so it is
  off by default and intended for real hardware only. Config via
  `sdmc:/switch/romm-test.txt` (`host=`/`port=`/`name=`/`url=`/`udp=`);
  every line also appends to `sdmc:/switch/romm-test.log`. Screen output
  via the runtime terminal; any button re-runs, + exits. Smoke-tested
  offline under Node with stubbed `Switch` globals (healthy/offline/
  numeric/config scenarios all behave; `numeric` reproduces the
  device's current state — names fine, raw IPs rejected).
- Fix (found on device): the auth exchanges joined the Base URL without
  the schemeless-URL normalisation `RommClient` has, so a typed
  `host:port` made `POST /api/token` resolve *relatively* — against
  `romfs:` — and nx.js answered `GET method must be used when fetching
  "romfs:" protocol (got POST)`. The normalisation now lives in one
  exported `normalizeBaseUrl()` shared by both, and an empty Base URL is
  refused up front ("Base URL is required") instead of being fetched
  relative.

Done in v0.11:

- **Library dashboard** (`src/components/LibrarySections.tsx`): the
  library opens on five horizontal rows in a fixed order — continue
  playing (by last played), favourites, platforms (one representative
  cover per platform, with its game count), recently added, collections
  (the server's saved collections). Empty rows collapse; a row label
  opens the row's full grid, a cover opens its content. It is the face
  of the streamed library load from v0.10: rows fill in progressively
  as pages arrive, and a row that re-sorts mid-stream moves its tiles.
- **Multi-disc titles**: the client groups the roms of one title
  (`groupTitles`); a tile shows the release name and a top-left `2/3`
  disc badge, and A opens a new disc picker (`DiscPicker`, one row per
  disc, the default disc marked, B closes) before opening content.
- **react-tela compat layer** (`src/react-tela-compat.ts`): the
  library's `Root.insertBefore` splices without dispatching an `add`
  event, so when React re-inserts a tile it moved, an artwork load
  aborted mid-decode has nothing to restart it — the tile would sit on
  its placeholder forever. The patch dispatches `add` after the
  splice, and `CoverImage` re-kicks the load on a post-mount `add`
  (by then the bytes are local, so it is a cheap re-decode).
- **Dashboard cover z-order fix** — the last real-data bug: 3 of the
  29 dashboard covers rendered dark on the real box. Root cause pinned
  at the op level with the preview probe: on each dark tile, one render
  pass drew the hairline stroke, then the cover image (the tile lit),
  then an opaque plate fill — the plate *painting over the loaded
  artwork*. Mechanism: React moves a re-sorted tile by re-inserting
  each child with `insertBefore(child, newPredecessor)`, and
  react-tela's plain splice places every child before that predecessor,
  so a moved block of siblings lands **fully reversed** in
  `Root.entities` (array order *is* paint order). The three dark
  tiles were exactly the three whose entities moved mid-stream; the
  twenty-six that never moved kept JSX order and stayed lit. The fix
  is in app code (react-tela stays as-is, no offscreen `<Group>`):
  the plate is merged into the border rect — one rect drawn *after*
  the image whose fill is the dark plate only while the artwork is
  absent (`CoverImage`'s `onStatus`, or no cover at all) and
  transparent once it lands, with the placeholder glyph unmounting at
  the same moment. A transparent frame cannot hide the artwork in
  *either* z-order, so the tile renders correctly whether the block
  landed in JSX order or reversed. Applied to every rendering with the
  pattern: the dashboard rows (a small `CoverSlot` per cover), the
  grid's `CoverTile`, and the detail screen's cover block.
- **Real-box verification**: preview against the user's live RomM
  (CORS proxy, stored token) with the 1266-rom library — all 29
  dashboard covers lit after the fix (pixel-scan probe: 29/29 above
  the lit threshold; the three reversed tiles included, still lit
  with the merged rect landing *before* their image in the array),
  plus the disc badge / picker / detail screen. Fat NRO rebuilt and
  re-staged.

Still open:

- `WebSocket` live updates (library changes) — the runtime has it.
- The *API token* sign-in is now validated end-to-end against a real
  instance (v0.11 real-box run). The password grant and pairing
  exchange remain written against RomM 5.x's API surface, not yet run
  against a live server — re-validate them against your instance's
  `openapi.json` when convenient.
