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

## RomM endpoints used (unchanged from v1)

- `GET /api/library` — token validation (lightweight auth probe)
- `GET /api/roms?_limit=48` — the game list (name, platform, cover art)

Full spec at `{baseUrl}/openapi.json`. The parser stays defensive about the
`assets` field shape (RomM versions drift here). **Re-validate against your
instance's `openapi.json`** — the v1 C++ parser in the initial commit is the
starting point.

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
│  ├─ main.tsx              # entry: render(<App/>, screen); global error overlay; gamepad boot
│  ├─ App.tsx               # screen state machine: Settings ↔ Library
│  ├─ romm.ts               # RommClient: typed fetch + JSON parsing (/api/library, /api/roms)
│  ├─ config.ts             # baseUrl + token via localStorage (Save Data)
│  ├─ covers.ts             # cover URL → fetch → cache to sdmc:/… → <Image src>
│  ├─ gamepad.ts            # Web Gamepad polling → focus/selection state; touch-scroll
│  └─ components/
│     ├─ Header.tsx         # title + library name + status line
│     ├─ CoverGrid.tsx      # tile grid inside a <Group> viewport (contentHeight + scrollTop)
│     ├─ CoverTile.tsx      # <Image> cover + <Text> title, focus ring
│     └─ SettingsScreen.tsx # baseUrl / token entry
└─ (output) rommate.nro / rommate.nsp
```

## UI architecture (react-tela)

- `render(<App/>, screen)` from `react-tela/render` — React tree drawn onto the
  runtime's screen canvas; no DOM assumed.
- **Grid**: compute a rows×cols tile layout in JS; render inside
  `<Group width={…} height={…} contentHeight={…} scrollTop={…}>` — react-tela's
  viewport scrolling only moves the `drawImage` source rect, so scrolling is
  essentially free (same mechanism the NSP forwarder uses).
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
   `config.json`.
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

## Next iteration

- Game detail screen (screenshots, metadata) on A-press.
- `WebSocket` live updates (library changes) — the runtime has it.
- Search / platform filter row.
- Real per-game covers at full res + lazy load while scrolling.
- `--fat` build for distribution without the shared runtime.
