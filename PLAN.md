# RomM for Switch — Project Plan

A Nintendo Switch companion app (`.nro`) for [RomM](https://romm.app), a self-hosted ROM manager.
Built with **libnx**, **Borealis** (the `wiliwili`/v2 rewrite — XML layouts + `BRLS_BIND` + the
spatial focus engine), **libcurl** (devkitPro portlib; TLS via libnx), and **nlohmann/json**.

## Stack

| Concern      | Choice |
|--------------|--------|
| SDK          | libnx (devkitA64 toolchain) |
| UI           | Borealis — `natinusala/borealis` `main` branch (XML + `BRLS_BIND`) |
| HTTP / TLS   | libcurl (devkitPro portlib; TLS via libnx) |
| JSON         | nlohmann/json (single header, vendored in `include/`) |
| RomM auth    | Client API Token → `Authorization: Bearer rmm_...` |

## RomM endpoints used

- `GET /api/library` — token validation (lightweight auth probe)
- `GET /api/roms?_limit=48` — the game list (name, platform, cover art)

Full spec lives at `{baseUrl}/openapi.json`, Swagger at `/api/docs`, ReDoc at `/api/redoc`.
The parser is defensive about the `assets` field shape; confirm it against your instance's
`openapi.json` (RomM versions drift a little here).

## Directory structure

```
rommmate/
├─ Makefile
├─ README.md
├─ PLAN.md
├─ .gitignore
├─ .gitmodules                 # borealis submodule
├─ setup.sh                    # one-shot: toolchain + portlibs + submodule installer
├─ lib/
│  └─ borealis/                # git submodule → natinusala/borealis @ main
├─ include/
│  ├─ RommClient.hpp
│  ├─ MainView.hpp
│  └─ nlohmann/json.hpp        # vendored single-header
├─ src/
│  ├─ main.cpp
│  ├─ RommClient.cpp
│  └─ MainView.cpp
├─ romfs/
│  ├─ xml/main.xml
│  ├─ posters/default_poster.png
│  └─ (fonts/, themes/, img/ … auto-merged from lib/borealis/resources at build)
└─ build/                      # output: build/rommate.nro
```

## File responsibilities

| File | Role |
|------|------|
| `Makefile` | devkitA64 build (mirrors Borealis' demo Makefile); links `-lcurl -lz -lnx` + deko3d via `borealis.mk`; merges Borealis resources + compiles its shaders into romfs |
| `setup.sh` | one-shot installer: devkitPro pacman client, `switch-dev` group, portlibs, Borealis submodule |
| `src/main.cpp` | libnx init, `curl_global_init`, Borealis lifecycle, config load, push `MainView` |
| `include/RommClient.hpp` | API contract: `RommGame` + `RommClient` |
| `src/RommClient.cpp` | libcurl GET (bearer) + nlohmann/json parsing of `/api/library` & `/api/roms` |
| `include/MainView.hpp` | UI contract: `MainView : brls::Box` with `BRLS_BIND`s |
| `src/MainView.cpp` | inflate `xml/main.xml`, fetch library, build focusable cover+title rows |
| `romfs/xml/main.xml` | `<brls:Box>` layout: header + status label + scrolling grid |
| `romfs/posters/default_poster.png` | placeholder cover art |

## Key Borealis API notes (verified against `natinusala/borealis` `main`)

- Lifecycle: `Application::init()` (no-arg) → `createWindow(title)` →
  `pushActivity(view)` → `while (Application::mainLoop()) {}`. `setGlobalQuit(true)` maps START→quit.
  `init()` sets up the deko3d/GL/input backend internally — no manual graphics init needed.
- `Box::inflateFromXMLRes(res)` — the XML root node **must** be `<brls:Box>`.
- `BRLS_BIND(Type, member, "id")` — lazy pointer to a child resolved by id; **access after `inflate`**.
- `Image::setImageFromRes(name)` / `setImageFromFile(path)` / `setScalingType(...)`.
- `Label::setText(...)` / `setFontSize(...)` / `setSingleLine(...)`.
- Focus: `View::setFocusable(true)` + `registerClickAction(fn)` (A) or
  `registerAction(hint, ControllerButton::X, fn, ...)`. The engine auto-moves the highlight.
- `Header::setTitle(...)` / `setSubtitle(...)` (self-inflating; don't nest children in XML).
- `ScrollingFrame::setContentView(view)` — vertical, single child.
- `core/task.hpp` is `RepeatingTask` only (main-thread periodic) → **no general background Task**.
  We therefore fetch synchronously in the constructor for this skeleton.
- Borealis uses `throw`/`typeid` → compile **with** exceptions + RTTI. Do **not** add `-fno-exceptions -fno-rtti`.

## Build system (Makefile)

- `include $(DEVKITPRO)/libnx/switch_rules` (defines `$(LIBNX)`, `$(PORTLIBS)`).
- `LIBS := -lcurl -lz -lnx` — the `switch-curl` portlib is built with libnx as its TLS backend, so no mbedtls; `borealis.mk` prepends `-ldeko3d -lm`
- `LIBDIRS := $(PORTLIBS) $(LIBNX)`
- `include $(TOPDIR)/$(BOREALIS_PATH)/library/borealis.mk` — adds Borealis sources, **deko3d**,
  **switch-libpulsar**, and `-DBRLS_RESOURCES="romfs:/"`. Must come after `BOREALIS_PATH` + `LIBDIRS`.
- `ROMFS := romfs` + a rule that merges `lib/borealis/resources/*` into romfs (Borealis loads its
  fonts/themes from the romfs root).
- Flags: `-D__SWITCH__ -std=gnu++20`; **no** `-fno-exceptions -fno-rtti`.

## Build & run

1. `./setup.sh` — installs the devkitPro toolchain (`switch-dev` group: devkitA64, libnx,
   deko3d, uam), the portlibs (`switch-curl`, `switch-glm`, `switch-glfw`, `switch-mesa`),
   and the Borealis submodule. (`--build` also builds; `--check` only verifies.)
2. `make -j` → `build/rommate.nro`.
3. Copy the `.nro` to `sdmc:/switch/rommate/`; write `sdmc:/switch/rommate/config.json`
   (`{"baseUrl":"http://192.168.1.50:11700","token":"rmm_..."}`).
4. Launch via a homebrew loader (NX-Shell / Hekate / Atmosphere homebrew menu) on a modded Switch
   that can reach the RomM instance on the LAN.

## Risks / open items

- **Borealis is WIP** — pin the submodule commit; expect occasional API churn.
- **deko3d** is a hard dependency of the new Borealis (rendering backend) — it ships as a core package of the devkitPro pacman `switch-dev` group, so `setup.sh` picks it up automatically.
- Cover-art download is **stubbed** (placeholder poster); real per-game covers → next step.
- Confirm the `/api/roms` `assets` field shape against your instance's `openapi.json`.

## Next iteration (out of scope here)

- In-app token / base-URL entry screen (persisted to the SD JSON).
- Real cover-art download → SD cache → `setImageFromFile`.
- Game detail screen, WebSocket (socket.io) live updates, device-pairing flow.
