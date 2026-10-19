# RomM Mate (`rommate`)

A Nintendo Switch companion app for [RomM](https://github.com/romm-app/romm). Point it at a running RomM instance on your LAN and browse your library: a scrollable, focusable list of game cover art and titles, fetched live over HTTP and rendered with a modern, controller-friendly UI.

> **Status: buildable skeleton.** This implements the app lifecycle, RomM REST integration, and a focusable cover+title grid. It can be run from the SD card as a `.nro`, or packaged as an installable `rommate.nsp` (see [Building an NSP](#building-an-nsp-installable-package)). Per-game cover images currently show a placeholder; downloading RomM's real art, a detail screen, and WebSocket live updates are the natural next steps (see `PLAN.md`).

## Tech stack

| Layer       | Choice |
|-------------|--------|
| UI          | [Borealis](https://github.com/natinusala/borealis) — the `wiliwili`/v2 rewrite on `main` (XML layouts + `BRLS_BIND` + spatial focus engine, rendered via deko3d) — vendored as a git submodule at `lib/borealis` (two local Switch fixes are applied from `lib/borealis.patch` at build time) |
| Networking  | libcurl (devkitPro portlib — TLS via libnx, no separate TLS library) |
| JSON        | nlohmann/json (header-only, `include/nlohmann/json.hpp`) |
| Platform    | devkitA64 / libnx, C++20, output `.nro` |

## Setup

```sh
./setup.sh            # install whatever's missing (idempotent — skips what's already there)
./setup.sh --build    # ...and run `make -j` when done
./setup.sh --check    # only verify what's installed
```

What it does, in order:

1. Installs **devkitPro pacman** (`dkp-pacman`) — the official devkitPro package manager
   (apt repo on Debian/Ubuntu/WSL, the `.pkg` on macOS x86_64).
2. Installs the **`switch-dev`** group → devkitA64 toolchain, libnx, **deko3d** (Borealis'
   renderer — installs into `$(LIBNX)`), **uam** (the shader compiler), examples — all into
   `/opt/devkitpro`.
3. Installs portlibs: **`switch-curl`** (`switch-zlib` comes with it), `switch-glm`,
   `switch-glfw`, `switch-mesa` (the glfw/mesa pair follows the Borealis README).
4. Checks out the **Borealis** submodule (`lib/borealis` — its other dependencies are vendored inside it).
5. Prints the `export` lines for your shell (and offers to append them to your rc file).

- Needs **Linux** (x86_64 or aarch64, incl. WSL) or **macOS x86_64**, `git`, and `sudo`.
  Apple-Silicon Macs have no devkitPro host packages — use WSL.
- Manual equivalent: `sudo dkp-pacman -S switch-dev switch-curl switch-glm switch-glfw switch-mesa`
  (see [devkitPro pacman](https://devkitpro.org/wiki/devkitPro_pacman)), then `git submodule update --init`.

Borealis' other dependencies (yoga, fmt, tinyxml2, nanovg-deko3d, switch-libpulsar, …) are
**vendored inside** `lib/borealis` — nothing else to fetch.

## Build

```sh
export DEVKITPRO=/opt/devkitpro       # setup.sh prints these for you
export PATH="$DEVKITPRO/devkitA64/bin:$DEVKITPRO/tools/bin:$PATH"

make -j                              # or simply: ./setup.sh --build
```

Output: `build/rommate.nro`. At build time the `Makefile` merges Borealis' own `resources/` (fonts/themes/img/i18n) into `romfs/` and compiles its deko3d shaders to `romfs/shaders/`, so everything lands in the embedded RomFS.

## Building an NSP (installable package)

The app can also be packaged as a real installable **`rommate.nsp`** (the format Switch NSP installers consume), built with [hacBrewPack](https://github.com/dragonflylee/hacBrewPack) — the standard homebrew NCA/NSP engine:

```sh
make nsp KEYSET=/path/to/prod.keys        # or: export KEYSET=... then `make nsp`
```

What `tools/build_nsp.sh` does under the hood:

1. **Engine** — clones `dragonflylee/hacBrewPack` (pinned to `745b16e`) into `build/hacbrewpack`, applies `tools/hbp_nsp0.patch` (writes the `NSP0` container magic instead of `PFS0`, plus two determinism patches: a fixed DRBG seed so the self-signature/salt is stable, and a sorted PFS0 layout so entry order doesn't depend on `readdir()`), and compiles it with clang. This runs once; later builds reuse the cached engine.
2. **Inputs** — assembled under `build/nsp_work/` from your `make` outputs: `rommate.elf` → strip → `elf2nso` → `exefs/main`; `tools/npdm.json` → `exefs/main.npdm` (via `npdmtool`); `rommate.nacp` + `romfs/img/demo_icon.jpg` → control NCA; the project's `romfs/` directory as the program RomFS.
3. **Package** — runs `hacbrewpack` with **standard crypto**: zero rights ID, no ticket, keygen 1 (key area encrypted with `key_area_key_application_00` from your keyset), content key `04…04`, self-signed NCA sig1 — and emits `rommate.nsp` (~2.3 MB) in the project root.

Notes:

- `KEYSET` must be a prod.keys-style keyset containing at least `header_key` and `key_area_key_application_00` (a full prod.keys works). The keyset is only needed to *build* the NSP — the installed app does not need it.
- **sigpatch required**: the NCAs are self-signed with hacBrewPack's built-in homebrew key and carry a zero fixed-key signature, so the console must run [Atmosphere](https://github.com/Atmosphere-NX/Atmosphere) with [sigpatch](https://github.com/Atmosphere-NX/Atmosphere/blob/master/README.md#sigpatch) enabled for the app to install and launch.
- The app uses homebrew title ID `010012345678ABCD` — don't reuse that ID for other homebrew.
- Builds are **reproducible**: running `make nsp` twice produces a byte-identical `rommate.nsp` (the only randomness in the pipeline is the self-signature salt, which the engine patch pins).
- `make verify KEYSET=...` validates any built NSP with [hactool](https://github.com/SciresM/hactool): it decrypts every section, checks all IVFC/PFS0 hashes, and diffs the extracted RomFS/ExeFS/control files against the project sources byte-for-byte (modulo the fields hacBrewPack patches into the NPDM/NACP). The two signatures that are zero by design for homebrew — the fixed-key signature and the ACID signature — are the only FAILs it tolerates; those are exactly what sigpatch bypasses on the console.

### Installing on the Switch

1. With sigpatch enabled, copy `rommate.nsp` to the SD card and install it with an NSP installer (e.g. NSPInstaller, GoldLeaf, or Atmosphere's install feature).
2. Create the config file `switch/rommate/config.json` on the SD card (same as the `.nro` flow below) and launch **RomM** from the HOME menu.

## Run

1. Copy the built file to your SD card:
   ```sh
   cp build/rommate.nro /path/to/SD/switch/rommate/
   ```
2. Create the config file `switch/rommate/config.json` next to it:
   ```json
   {
     "baseUrl": "http://192.168.1.50:11700",
     "token": "rmm_..."
   }
   ```
   `baseUrl` is your RomM server (host + port), and `token` is a RomM **Client API Token** (create one in the web UI). If the file is missing or invalid, the app falls back to the compile-time defaults in `src/main.cpp` — edit and rebuild to change them.
3. Launch **rommate** with a homebrew loader (e.g. Atmosphere / NX-Shell / Hekate) on a modded Switch. The Switch must be on the same LAN and able to reach your RomM instance.

## Controls

- **D-pad** — move the blue focus highlight between game rows (Borealis' spatial focus engine handles this)
- **A** — open / select the focused game (stub for now)
- **X** — game details (stub)
- **START** — quit

## How it works

- `src/main.cpp` starts the libnx services (`romfs`, `acm`, `hid`), initializes libcurl, then boots the Borealis application (`init()` → `createWindow` → `setGlobalQuit` → `pushActivity` → `mainLoop`).
- It reads `switch/rommate/config.json` (baseUrl + token), builds a `RommClient`, and pushes `MainView`.
- `RommClient` (libcurl + nlohmann/json) performs authenticated GETs — `Authorization: Bearer <token>` — against `/api/library` (to validate the token) and `/api/roms` (to list your games), parsing the JSON into `RommGame` structs.
- `MainView` (Borealis) inflates `romfs/xml/main.xml` and renders the games as a focusable, scrollable list of cover + title rows. Each row currently shows the placeholder poster `romfs/posters/default_poster.png`; downloading RomM's real per-game cover art and caching it to the SD card is the next step.
