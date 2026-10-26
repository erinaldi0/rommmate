# RomMmate UI Redesign — Audit & Implementation Plan

> **Status (v16):** Phase 1 (design-system foundation: token layer +
> `components/ui` primitives) shipped in v15; **Phase 2 (the dashboard on
> the system)** shipped in v16 — ambient background, hero/install-card
> restyle, both cover rows through the one `CoverCard`, contextual
> hints, build stamp in the footer (see the PLAN.md v16 changelog).
> Phases 3–7 (detail, grid + chrome, utility screens, motion, hardening)
> remain as described below.

> A premium, console-launcher redesign of the RomMmate UI.
> Produced from a full audit of the codebase, the installed react-tela types,
> and the nx.js runtime type declarations. **Nothing has been implemented yet.**
>
> Governing rule: do **not** replace the rendering architecture, controller
> system, application state management, routing, or data layer. The redesign
> is a presentation + layout exercise on top of a renderer whose capabilities
> were verified line-by-line.

---

## 1. TL;DR

The app is a canvas-drawn React scene graph (no DOM). The v13/v14/v15 work
already turned it into a functional, memory-disciplined console-style launcher.
The redesign is therefore a **presentation + layout** exercise on top of a
renderer whose capabilities are now known exactly — not a rewrite.

The renderer is genuinely expressive (real gradients, shadows, blending,
rounded corners, patterns, transforms) but has three hard no-ops that must be
designed around:

- **no `ctx.filter`** (no blur / brightness / saturate) → silent no-op
- **no `letterSpacing` / `wordSpacing`** → silent no-op
- **no `bold` font weight** (runtime keeps normal weight; documented OOM)

Gradients, glows (shadow), blending, and transforms are real and are the
genuine premium tools. Everything below respects the "don't touch the floor"
rule.

---

## 2. Stack & exact versions

| Concern | What's installed | Notes |
|---|---|---|
| Runtime | `@nx.js/runtime` **1.0.0-beta.7** (pinned) | V8 + libuv + **Skia**; `types: ["@nx.js/runtime"]` in tsconfig |
| Packagers | `@nx.js/nro` / `@nx.js/nsp` **1.0.0-beta.7** | ships **NSP → application mode** (~3 GiB heap, JIT, GPU canvas) |
| Constants | `@nx.js/constants` **0.4.1** | `Button` (non-standard HID indices), `SwkbdType` |
| UI | `react` **18.3.1** + `react-tela` **1.0.1** + `@react-tela/core` **1.0.1** | react-reconciler 0.29; **pinned, "in development"** |
| Build | `esbuild` **0.28.2** → single `romfs/main.js` · `typescript` **5.8.3** | `target es2022`, DOM lib **off** (`no-default-lib`) |
| Extras | `fflate` 0.8.3 (zip) · `spark-md5` 3.0.2 (MD5) | pure-JS, esbuild-friendly |

`render(<App/>, screen)` mounts the React tree onto the global `screen` canvas
(**1280×720**). One root, one 2d context, Skia-accelerated.

---

## 3. The react-tela surface (verified against the installed types)

**Entities that exist** (`@react-tela/core`): `Rect` (+`borderRadius`),
`Text`, `Image` (async URL load, `imageSmoothing*`), `Group` (offscreen
sub-canvas), `Canvas` (imperative sub-canvas), `Pattern`, `Arc`/`Circle`,
`Ellipse`, `Line`, `Path`, `BezierCurve`/`QuadraticCurve`.

**Every entity** carries: `x/y/width/height`, `alpha`, `rotate`, `scaleX/Y`,
`shadowColor/Blur/OffsetX/Y`, `filter`, `blendMode`, `pointerEvents`, and
`onClick` / `onMouse*` / `onTouch*`.

**Shapes** add `fill` / `stroke` (string | `CanvasGradient` | `CanvasPattern`
| a ref), `clip`, `fillRule`, `lineCap/Dash/Join/Width`, `miterLimit`.

**`Text`** adds `fontFamily` (string | array), `fontSize`, `fill`/`stroke`,
`textAlign`, `textBaseline`, `letterSpacing`, `wordSpacing`, `fontStretch`,
`fontVariantCaps`, `maxWidth` (enables wrap), `lineHeight`, `overflow`
(`wrap` | `ellipsis` | `clip`).

**React hooks** (from `react-tela`): `useParent` (→`ctx`), `useDimensions`,
`useTextMetrics`, `useLayout` / `LayoutContext`, `usePattern`, and
`useLinearGradient` / `useRadialGradient` / `useConicGradient`.

### What the nx.js Skia 2D context actually honors

Checked the runtime's `dist/index.d.ts` directly (not the react-tela props):

| Feature | react-tela prop | nx.js 2D ctx | Usable? |
|---|---|---|---|
| Linear / radial / conic gradient | `fill`/`stroke`/hooks | ✅ all three | **Yes — primary lever** |
| Pattern | `fill` / `usePattern` | ✅ `createPattern` | Yes |
| Drop shadow / glow | `shadow*` | ✅ `shadowBlur`/`Color`/`Offset` | **Yes — but perf-costly, must test** |
| Blending | `blendMode` | ✅ `globalCompositeOperation` | Yes (glows, additive) |
| Rounded corners | `borderRadius` | ✅ `roundRect` | Yes |
| Alpha / scale / rotate | `alpha` / `scaleX/Y` / `rotate` | ✅ | Yes |
| **CSS filter (blur / brightness / saturate)** | `filter` | ❌ **no `filter` property exists** | **No — silent no-op** |
| **Letter / word spacing** | `letterSpacing` / `wordSpacing` | ❌ **not declared** | **No — silent no-op** |
| **Bold weight** | `fontWeight` | ❌ runtime keeps normal weight | **No** (documented OOM in `text.ts`) |
| `fontVariantCaps` / `fontStretch` | props | ❌ not declared | No |
| `imageSmoothing*` | props | ✅ | Yes |

**Consequence for "premium":** real blur (backdrop dim, frosted glass),
wide-tracked small-caps labels, and bold are all unavailable and must be
**faked** (translucent gradient scrims, per-character drawing, size + color
hierarchy). Gradients, glows (shadow), blending, and transforms are real and
are the genuine premium tools.

---

## 4. Hard constraints that govern the redesign

1. **No DOM / CSS / flexbox / grid / HTML buttons.** All layout is manual
   coordinate math. There is no `display`, no `z-index` — paint order = tree
   order.
2. **`<Group>` is deliberately avoided** (documented in `CoverTile`,
   `LibraryGrid`, `LibrarySections`). It composites through an offscreen
   canvas and **a failure there aborts the whole frame**. Overflow is masked
   with two opaque `<Rect>` "bands" instead. *Any* offscreen React entity
   (`Group` / `Canvas`) carries this frame-abort risk — avoid it in the tree.
3. **`insertBefore` reordering quirk** (`react-tela-compat.ts`): when React
   reorders children, the plate can land *above* the image. The fix is a "plate
   turns transparent once art lands" invariant baked into `CoverTile` /
   `CoverSlot` / `GameDetail`. **Preserve this invariant in any tile rework.**
4. **32-bit V8 heap (~3 GiB app mode).** Every drawn `<Image>` keeps a
   full-RGBA copy at natural size. The cover pipeline (`covers/`) enforces:
   SD-first, ≤640 master, one derived file per (size, fit), **≤2 concurrent
   fetches**, and `CoverImage` `enabled` gates to *visible-only*. **The
   redesign must not increase concurrent image work or decoded size.**
5. **Text baseline is `top` by default** (line-box anchored). Cross-environment
   stability (device font vs browser) is achieved with
   `textBaseline="alphabetic"`. Keep alphabetic anchoring.
6. **DOM lib is off** — no `MouseEvent` / `FontFaceSet` types; the code uses
   structural types and the runtime's own `fonts` / `console` / `localStorage`.
   Don't reintroduce DOM types.
7. **react-tela is pinned & in-development** — expect breaking changes; the
   compat patch (`patchInsertBefore`) must stay.
8. **One screen canvas; no second `webgl2` context** once `2d` exists — no
   WebGL path.

---

## 5. Existing mechanisms to **preserve untouched**

| Area | File(s) | Why keep |
|---|---|---|
| Gamepad loop | `src/gamepad/loop.ts` | Process-wide rAF singleton; edge-trigger + per-button repeat timing; left-stick w/ deadzone 0.2 / threshold 0.7; keyboard-owns-input handling. Battle-tested. |
| Input hooks | `src/hooks/use-gamepad.ts` | `useGamepadButton` / `useJoystick` / `useDirection` / `useGamepadEscape` + the `focused` / `paused` gate that makes only the active screen own input. |
| Touch | `src/hooks/use-drag-scroll.ts`, `use-canvas-tap.ts` | Structural event types; one path covers device touch + preview mouse. |
| Routing / app state | `src/App.tsx` | Route machine (`settings` \| `library` \| `detail` \| `downloads` \| `doctor`), cache-first boot, streamed walk, disc / discInfo logic, generation / abort discipline. |
| Play service | `src/play.ts` | `PlayService` singleton + `usePlayState` (`useSyncExternalStore`) + doctor / fix / install / play / sync / uninstall. |
| Data | `src/romm/*` (`types`, `client`, `dialect`, `parse`, `group`, `stream`), `library-cache.ts` | Defensive parsers, 5.x / ≤4.x dialect sniffing, NDJSON cache, streaming walk. |
| Covers | `src/covers/index.ts` + `pipeline.ts` | SD-first cache, capability-probed `OffscreenCanvas` → PNG, ≤2 fetches, `resolveCover` / `prefetchCovers` / `hasCover`. |
| Infra | `activity.ts`, `config.ts`, `session.ts`, `auth.ts`, `network.ts`, `fs.ts`, `log.ts`, `errors.ts`, `mem.ts`, `launch.ts`, `hash.ts`, `version.ts`, `manifest.ts` | pub/sub badge, SD + localStorage config, token / 401 recovery, nifm preflight, error trap, Play provisioning. |
| Text helpers | `src/text.ts` | `measure` / `wrapLines` / `truncate` (normal-weight-only, documented). |
| Text entry | `src/hooks/use-text-entry.ts` + `src/vk.ts` + `InAppKeyboard.tsx` | System swkbd + the two silent-failure fallbacks. |

These are the load-bearing floor. The redesign sits **on top**.

---

## 6. Components to **restyle** (keep logic, change look)

Pure presentation over stable models — the direct targets of the redesign:

- **Dashboard** `components/LibrarySections.tsx` (611) + `dashboard/*`:
  `layout.ts` (geometry table), `hero.ts` (model + `primaryRow` / `stateChip`
  / `formatBytes`), `HeroCard`, `InstallPanel`, `TileRow`,
  `PlatformChipStrip`, `SectionMenu`, `cover-slot`. The **focus / scroll /
  cull logic in `LibrarySections` stays**; the visuals (hero treatment, card
  styling, chip styling, focus ring, X-menu chrome, hint bar) are what change.
  `hero.ts` is shared with the detail screen — its chip / tone vocabulary is a
  design-system seed.
- **Grid** `components/LibraryGrid.tsx` (504) + `FilterBar` +
  `CoverTile` / `CoverFocusRing` + `CoverImage`.
- **Detail** `components/GameDetail.tsx` (558) — already the app's most
  "designed" screen; align it to the new system.
- **Utility screens** `SettingsScreen` (360), `DownloadsScreen` (176),
  `SetupDoctor` (237) — restyle to the system; keep the keyboard / field
  logic.
- **Chrome** `Header`, `DashboardHeader`, `HintBar`, `EmptyState`, `Spinner`,
  `ActivityBadge`, `DiscPicker`, `FatalError`.
- **Tokens** `theme.ts` (83) — the single source of color / space / radius /
  type; this is where the system is defined.

`CoverImage` is the one "component" to touch carefully: keep the load-restart
`add`-event logic and the `enabled` gate; only change how its placeholder
renders.

---

## 7. Proposed design-system architecture

A small, canvas-native design system introduced **incrementally** alongside
`theme.ts`, not replacing the renderer.

### 7.1 Token layer (`theme.ts` → richer, still the single source)
- Expand `colors` into a proper ramp: `bg` (with a base + a **radial ambient**
  pair for depth), 3 surface steps (`surface` / `surfaceRaised` /
  `surfaceOverlay`), a 2–3 shade **elevation** set, one accent + its
  muted / dark variants, a status ramp (success / warning / danger / info),
  and the cover / placeholder ramp.
- Keep `space` / `radius` / `fontSize` but add a **type hierarchy map**
  (display / title / label / caption / micro) and an **elevation map**
  (flat / raised / floating → {fill, stroke, shadow}).
- Introduce **named motion / duration tokens** for the tick-driven animations.

### 7.2 Primitive components (new, in `src/components/ui/`)
Thin, reusable presentational atoms built only from verified primitives:
- `Surface` (rounded `Rect` + optional elevation fill / stroke / shadow)
- `Panel` (elevation + `borderRadius` + hairline)
- `Pill` / `Chip` (pill radius, focus stroke, gradient option)
- `Button` (primary / secondary / danger; focus ring; A-keycap; gradient or
  elevation) — consolidates the button math currently duplicated in `HeroCard`
  and `GameDetail`
- `ProgressBar` (track + fill; already the pattern in `InstallPanel` /
  `GameDetail`)
- `StatusChip` (re-exports the `hero.ts` `stateChip` visuals)
- `Badge` / `CountBadge`
- `Divider`, `Keycap` (the "A" / "B" glyph chips from `HintBar`)
- `FocusRing` (one place for the ring treatment; drawn above bands)
- `Dim` / `Scrim` (translucent gradient overlay — the **blur substitute**)
- `Glow` (shadow + `blendMode` additive, **perf-gated**)

### 7.3 Focus & selection system
- One canonical focus-ring + press (`scaleY`) / `alpha` treatment, driven off
  the existing `focused` flags. Console launchers sell the feel of focus
  motion; a subtle tick-driven scale / glow on the focused target (driven by
  `use-tick`-style coarse ticks) is achievable and on-brand.

### 7.4 Depth & atmosphere (the "premium" layer, safely)
- **Ambient background**: one **radial + linear gradient** full-screen `Rect`
  behind everything (cheap, one entity) + a faint top vignette. This is the
  single biggest "premium" win and costs ~2 draws.
- **Hero scrim**: a left → right **linear gradient** over the hero artwork to
  make identity text legible (replaces the flat plate; this is the
  console-dashboard signature look).
- **Elevation via shadow**, used *sparingly* (hero + primary button + focused
  target only) — shadows are real but per-entity-costly on the 32-bit heap;
  cap their use and validate fps in Phase 0.
- **Optional pre-rendered textures**: for effects that can't be drawn live
  (e.g. a *blurred* hero backdrop — `filter` is a no-op), generate **once**
  into a module-scoped `OffscreenCanvas` → PNG → object-URL, then draw cheaply
  with `<Image>` (the exact proven pattern in `covers/pipeline.ts`,
  capability-probed). This sidesteps both the no-`filter` limit and per-frame
  cost. **This is the one risky premium technique → validate in Phase 0.**

### 7.5 Layout system (still manual, but factored)
- Generalize the dashboard's `layout.ts` into a tiny **layout-constants
  module** + a **position helper** (`place(x, y, w, h, {align, anchor})`) and a
  **row / grid culling helper** so the "compute rows in JS, render viewport
  rows, mask overflow" discipline is shared rather than re-derived per screen.
  No Yoga / flex (that needs WASM / JIT and isn't installed); keep the proven
  manual approach.

---

## 8. Risks & compatibility concerns

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **No `ctx.filter`** — blur / glass is a silent no-op | High (expectation) | Design around it: gradient scrims + gradients; only attempt real blur via the OffscreenCanvas texture path (Phase 0). |
| 2 | **`letterSpacing` / `wordSpacing` no-op** — tracked labels won't track | Med | Per-character drawing helper, or design without tracking. |
| 3 | **No bold** — weight hierarchy unavailable | Med | Size + color + (real) gradient / shape for emphasis. |
| 4 | **Shadow / fps cost** on the 32-bit heap | Med–High | Cap shadows to a few entities; **measure fps in Phase 0** before committing; fall back to gradient elevation if it regresses. |
| 5 | **`insertBefore` paint-order quirk** reappears on new tiles | Med | Preserve the transparent-plate invariant; keep `patchInsertBefore`. |
| 6 | **Memory regression** from new textures / larger images | High | Visible-only `enabled` gate; ≤2 concurrent; reuse covers pipeline; never bump decoded size. |
| 7 | **`<Group>` / `<Canvas>` frame-abort** if used for compositing | High | Do **not** put offscreen entities in the React tree; use manual positioning + opaque bands + standalone OffscreenCanvas textures. |
| 8 | **react-tela 1.0.1 breaking changes** if we lean on new primitives | Med | Pin stays; prefer `Rect` / `Text` / `Image` + gradients (stable core) over rarely-used entities; keep compat patch. |
| 9 | **Preview vs device font / baseline drift** | Med | Keep `alphabetic` anchoring; verify every screen in the `tools/preview` browser harness (`?view=`, `?sim=`). |
| 10 | **Applet-mode dev builds** (CPU raster, ~380 MiB) render heavier than NSP | Low–Med | Perf-critical screens validated via the NSP / fat build, not the dev NRO. |
| 11 | Reusing `hero.ts` across hero + detail could desync | Low | Treat its chip / tone vocabulary as the design-system source; single definition. |

---

## 9. Phased implementation order

**Guiding rule:** every phase ships visually improved but fully functional;
the floor (input / routing / state / covers) is never touched. Validate in
`tools/preview` (device font drift + the `?sim=` button sim) and on the NSP
build (perf).

### Phase 0 — Spikes & guardrails (no visible change)
- Measure current fps / heap in the preview + a fat NRO baseline.
- Spike: (a) does `shadowBlur` cost acceptable fps at N+ entities?
  (b) does an `OffscreenCanvas` → PNG texture (gradient + faked blur) render
  correctly **in both** device and browser preview? (c) confirm
  `letterSpacing` / `filter` are truly no-ops on the *device* font.
- Output: the performance budget for shadows / glows / textures, and the
  go / no-go for pre-rendered textures.

### Phase 1 — Design-system foundation
- Grow `theme.ts` (color ramps, elevation, type hierarchy, motion tokens).
- Add `components/ui/*` atoms: `Surface`, `Panel`, `Pill`, `Button`
  (consolidate the two button implementations), `ProgressBar`, `StatusChip`,
  `Badge`, `FocusRing`, `Keycap`, `Scrim`, `Glow`.
- Add the layout helper + shared row / grid culling helper.
- Add the (Phase-0-approved) ambient background.
- *No screen yet uses all of it* — this is the toolkit.

### Phase 2 — Dashboard (the face of the product)
- Restyle `HeroCard` / `InstallPanel` / `TileRow` / `PlatformChipStrip` /
  `SectionMenu` / `cover-slot` to the system; add hero gradient scrim +
  elevation + focus motion.
- Keep `LibrarySections` focus / scroll / cull / preview logic intact.
- Restyle `DashboardHeader` + `HintBar` + `ActivityBadge` + `EmptyState`.

### Phase 3 — Detail + Grid + chrome
- `GameDetail` to the system (it's the template for "premium" already).
- `LibraryGrid` + `FilterBar` + `CoverTile` / `CoverFocusRing`; keep the
  transparent-plate invariant.
- Align `Header`, `Spinner`, `DiscPicker`.

### Phase 4 — Utility screens
- `SettingsScreen`, `DownloadsScreen`, `SetupDoctor` to the system (keep
  keyboard / field / doctor logic).

### Phase 5 — Motion & polish
- Tick-driven focus / press motion, scrim / glow tuning, empty / loading
  states, error surfaces — all within the Phase-0 budget.

### Phase 6 — Perf & memory validation
- Re-run the v14 OOM regressions: boot cover storm, streamed-walk heap, idle
  30 s sampler; confirm the redesign didn't regress the 32-bit heap or fps.
  Fix anything that did.

### Phase 7 — Hardening
- Full pass through the `tools/preview` view matrix + device NSP; update
  `PLAN.md` changelog with the redesign (v16).

---

## Open decisions (to confirm before building)

1. **Ambition level for the premium layer** — attempt the **pre-rendered
   texture / faked-blur** path (richest look, riskiest, Phase 0 gates it), or
   keep it **gradients + shadows only** (safer, still clearly "premium
   console")?
2. **Scope of this pass** — the full 7 phases, or start with **Phase 1
   (design-system foundation) + Phase 2 (dashboard)** and review the
   direction before touching the rest?
