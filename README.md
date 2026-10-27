# RomMmate — RomM companion for Nintendo Switch

A Nintendo Switch homebrew app for [RomM](https://romm.app), a self-hosted ROM
manager. Browse your library, download games, install RetroArch cores, launch
games, and sync saves — all from the Switch.

Built on **nx.js** (V8 + libuv + Skia), **TypeScript** (esbuild → single bundle),
and **react-tela** (React → canvas UI). No devkitPro or C toolchain needed.

## What it does

- Connect to your RomM instance (API token, password grant, or pairing code)
- Browse your library with cover art, platforms, collections, favourites
- Download games from the server to SD (`sdmc:/switch/rommmate/roms/`)
- Install RetroArch cores and BIOS from libretro's buildbot or your server
- Launch games directly into RetroArch (`Switch.Application` title takeover)
- Sync saves and save states between console and server
- RetroAchievements support (`cheevos_*` written into `retroarch.cfg`)

## Prerequisites

- A Nintendo Switch running Atmosphere CFW
- A [RomM](https://romm.app) server (v5.x recommended; 4.x works with
  reduced features) reachable from the Switch
- Wi-Fi or Ethernet on the Switch (for the first boot — it downloads the
  shared nx.js runtime)

### Application-mode crashes (NSP from HOME Menu)

If RomMmate crashes on startup when installed as an NSP (application mode)
but works from hbmenu (applet mode / NRO), the nx.js runtime's full V8 JIT
and GPU canvas in application mode may be incompatible with your console or
firmware. The app now ships `romfs/nxjs.ini` (generated at build time)
which disables JIT, caps the heap at 512 MB, and uses CPU raster — matching
the stable applet-mode settings. Reinstall the latest NSP from
[releases](https://github.com/erinaldi0/rommmate/releases) to get it.

## Build

```bash
# Install dependencies
npm install

# Typecheck
npm run typecheck

# Build (esbuild → romfs/main.js)
npm run build

# Package as NRO (dev iteration — launch from hbmenu)
npm run nro

# Package as NSP (installed title — recommended for daily use)
npm run nsp

# Fat builds (embed the whole nx.js runtime — larger but self-contained)
npm run nro:fat
npm run nsp:fat
```

Build artifacts:
- `rommate.nro` / `rommate-fat.nro` — drop into `sdmc:/switch/` and run from hbmenu
- `rommate.nsp` / `rommate-fat.nsp` — install via Tinfoil, appears on HOME Menu

The NRO build runs in *applet mode* (~380 MiB heap, CPU raster). The NSP
installs as a title and runs in *application mode* (~3 GiB heap, GPU canvas,
full V8 JIT) — use the NSP for daily play.

## Install on Switch

1. Copy `rommate.nsp` (or `rommate-fat.nsp`) to your Switch
2. Install via **Tinfoil** (or any NSP installer) → appears on HOME Menu
3. Launch RomMmate from HOME Menu
4. First launch auto-downloads the shared nx.js runtime to
   `sdmc:/nx.js/nxjs-v1.0.0-beta.7.nro` (needs Wi-Fi once)

## Configure RomMmate

Open the **Settings** screen and enter:

| Field | What to put |
|---|---|
| Base URL | Your RomM instance, e.g. `http://192.168.1.50:8200` |
| Auth method | Token / Password / Pairing |
| Token / credentials | Your RomM API token, or username+password, or pairing code |

Three sign-in methods:
- **Token** — paste a RomM Client API Token (`rmm_...`) directly
- **Password** — username + password, exchanged via OAuth2 password grant
- **Pairing** — short pairing code from RomM's web UI, exchanged for a token

Demo mode (mocked library) is available without a server.

## Set up RetroArch (required for Play)

RomMmate launches RetroArch to run your games. You need the RetroArch loader,
cores, and (for some platforms) BIOS installed on the SD card.

### Step 1: Install RetroArch as an NSP title

RomMmate launches RetroArch by **Title ID** (not by NRO path) because the
`envSetNextLoad` syscall used by NRO-path launching is not available when
RomMmate itself runs as an NRO from hbmenu. Launching by Title ID works in
both contexts.

1. Download the official RetroArch Switch NSP from
   https://buildbot.libretro.com/stable/1.22.2/nintendo/switch/libnx/
2. Install it via Tinfoil (or any NSP installer)
3. RetroArch now appears on your HOME Menu with a Title ID

### Step 2: Find RetroArch's Title ID

Use **Checkpoint**, **Tinfoil**, or **nxdumptool** to list installed titles
and read RetroArch's Title ID. It looks like `0x0100AB0123456789`.

### Step 3: Configure RomMmate

Add the Title ID to `sdmc:/switch/rommmate/config.json`:

```json
{
  "retroarchTitleId": "0x0100AB0123456789"
}
```

Or enter it in the Settings screen if a row is exposed for it. Without this,
RomMmate falls back to launching by NRO path (`sdmc:/switch/retroarch_switch.nro`),
which requires `envSetNextLoad` — that works when RomMmate runs from hbmenu
as an NRO, but not when RomMmate itself is installed as an NSP.

### Step 4: Install cores (automatic or manual)

**Automatic (via RomM server):**
When you press Play, RomMmate downloads the core for that platform from
libretro's buildbot (`https://buildbot.libretro.com/nightly/nintendo/switch/libnx/latest/`)
and installs it to `sdmc:/retroarch/cores/`. Cores the buildbot doesn't
publish fall back to uploads on your RomM "RetroArch" tooling platform.

**Manual (offline / no server):**
Download the core zip from the buildbot listing, extract it, and place the
`.nro` at `sdmc:/retroarch/cores/<core>_libretro_libnx.nro`. RomMmate scans
the SD card on Play and picks up cores already in place.

Verified buildbot cores (Switch): fceumm, quicknes, nestopia, mesen,
mesen-s, snes9x2010, snes9x, bsnes_hd_beta, gambatte, tgbdual, gearboy,
sameboy, mgba, vba_next, mupen64plus_next, desmume, melonds,
pcsx_rearmed, ppsspp, dosbox_svn, dosbox_pure, fbneo, mame2003_plus,
genesis_plus_gx, picodrive, gearsystem, prosystem, yabause, stella,
gearcoleco.

Not on buildbot: beetle_psx, vic20 (server uploads only).

### Step 5: Install BIOS (for platforms that need one)

Some cores need BIOS files in `sdmc:/retroarch/cores/system/`. PS1 needs
`scph1001.bin` (or `scph5501.bin`, `scph150.bin`).

**Via RomM server:** Upload the BIOS in RomM's firmware section. RomMmate
downloads and verifies it on Play.

**Manual:** Place `.bin` files at `sdmc:/retroarch/cores/system/`.

### Step 6: Launch

Open a game in the library detail screen and press **Play** (A). RomMmate:

1. Scans the SD card for any loader, icon, cores, and BIOS already in place
2. Downloads anything missing from the buildbot or your server
3. Writes a pending-session marker
4. Launches RetroArch by Title ID with `-L core game`
5. RetroArch boots straight into the game

When you return to RomMmate (Home button → reopen), the pending session is
ingested and saves are synced back to the server.

## SD card layout

```
sdmc:/switch/rommmate/           app data (manifest, pending session, log)
sdmc:/switch/rommmate/roms/<platform>/   downloaded games
sdmc:/switch/rommmate/saves/          RetroArch saves (synced to server)
sdmc:/switch/rommmate/states/         RetroArch save states (synced)
sdmc:/switch/rommmate/covers/         cached cover art
sdmc:/switch/retroarch_switch.nro     RetroArch loader NRO
sdmc:/retroarch.jpg                   launcher icon
sdmc:/retroarch/retroarch.cfg         generated by RomMmate
sdmc:/retroarch/cores/*.nro           libretro cores
sdmc:/retroarch/cores/system/*.bin    BIOS files
sdmc:/nx.js/nxjs-v1.0.0-beta.7.nro    shared nx.js runtime (auto-downloaded)
```

## Save sync

Save files pair on **(rom_id, slot)**. RomMmate walks your save/state
directories, hashes changed files with MD5, negotiates with the server, and
uploads/downloads/delete/conflict-resolves. Conflicts are shown in a dialog
(keep mine / take theirs). Restored saves for installed games without a
local copy are downloaded automatically.

Save states are newest-wins per (rom, emulator).

## RetroAchievements

Enable in Settings with your RA username and password. RomMmate writes
`cheevos_*` into `retroarch.cfg` before every launch, and RetroArch's own
RAClient handles detection and syncing of achievements.

## Build & packaging details

- `tools/build.mjs` — esbuild bundle, build-id stamping, wasm binary loader
  for 7z-wasm
- `nxjs.ini` in `romfs/` — V8/memory/runtime tuning; `[runtime] version`
  baked by the packager
- Slim NSP = small forwarder + shared runtime downloaded on first launch
- Fat NSP = entire runtime embedded (~3 MiB larger, no first-launch download)

## Troubleshooting

| Problem | Cause / fix |
|---|---|
| `envSetNextLoad failed` | RomMmate running as NRO can't launch RetroArch by NRO path. Install RetroArch as NSP and set `retroarchTitleId` in `config.json`. |
| `no core installed for this platform` | The core isn't on the SD. Press Play — RomMmate downloads it from buildbot/server. Or place it manually at `sdmc:/retroarch/cores/`. |
| `RetroArch loader not installed` | The loader NRO isn't at `sdmc:/switch/retroarch_switch.nro`. Install via server upload or place it manually. |
| `this platform needs a BIOS` | Upload the BIOS to your RomM server's firmware section, or place `.bin` files at `sdmc:/retroarch/cores/system/`. |
| `SSL - The connection indicated an EOF` | The Switch's TLS stack can't reach `buildbot.libretro.com` (Cloudflare edge drops the handshake). Cores fall back to your RomM server uploads. |
| Offline play | RomMmate scans the SD card and trusts whatever is installed. No server needed for games you already have. |
| Save sync conflicts | Dialog offers keep-mine / take-theirs. The server compares MD5 hashes byte-for-byte. |

## Project structure

```
src/
  App.tsx           # route state machine (Settings ↔ Library ↔ Detail ↔ Downloads)
  play.ts           # Play service: install, play, sync, launch
  launch.ts         # Switch.Application(title-takeover) with -L core + game
  config.ts         # baseUrl + credentials + retroarchTitleId
  manifest.ts       # sdmc:/switch/rommmate/manifest.json registry
  romm/             # RomM client (walks, firmware, saves, sync, devices)
  roms/             # download queue, install/uninstall
  retroarch/        # loader, cores, BIOS provisioning (layout, emulator, cores, zip7)
  saves/            # device registration, inventory, sync
  components/       # UI: LibraryGrid, GameDetail, SettingsScreen, DownloadsScreen, …
tools/
  build.mjs         # esbuild bundle + build-id stamp
  preview/          # browser preview harness (real src/, mock RomM)
```

## License

MIT

## Attribution

Platform icons rasterized from RomM's `frontend/assets/platforms` set (CC BY 4.0).
See `romfs/assets/platforms/` for the attribution file that ships with the app.
