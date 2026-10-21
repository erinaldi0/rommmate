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

Still open:

- `WebSocket` live updates (library changes) — the runtime has it.
- `--fat` build for distribution without the shared runtime.
