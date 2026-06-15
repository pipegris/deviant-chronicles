---
baseline_commit: 7f2f4fd
---

# Story 2.3: Render the Arena via the RenderPort seam (placeholder art)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a viewer,
I want the battle snapshots rendered as a Phaser arena behind a one-way `RenderPort` interface,
so that I can see the fight with placeholder sprites and the renderer stays swappable. (FR-7, R5)

## Acceptance Criteria

(Verbatim from epics.md#Story-2.3, L278-288.)

1. **Given** `BattleState` snapshots **When** the Phaser adapter renders **Then** it consumes immutable snapshots through `render/render-port.ts` and never feeds state back upstream (one-way) **And** Phaser is imported ONLY inside `render/` (R5), verified by the import-boundary lint.
2. **Given** the arena scene **When** loaded **Then** the Forgemaiden, Boss, and at least one Minion render as placeholder sprites with health bars and the Insight Gauge visible **And** assets load via the bundle's asset manifest (placeholder-first; engine never blocks on final art).

### What the gate CAN prove vs what needs OPERATOR eyes (READ THIS — be honest)

The headless pipeline (`typecheck` / `lint` / `test` / `build`) **CAN** prove the *testable surface*: the pure `RenderModel` mapping (unit tests), the `RenderPort` one-way contract (fake adapter), R5 lint, a **headless Phaser BOOT smoke** (`Phaser.HEADLESS` under jsdom — assert the arena scene creates the expected game objects without throwing), and `pnpm build`. It **CANNOT** prove VISUAL correctness — "does it look right", colors/layout/legibility, or frame pacing. **AC2's "render as placeholder sprites … health bars and the Insight Gauge visible" is OPERATOR-verified** (run `pnpm dev`, look at the screen), not gate-verified. Do NOT claim visual fidelity the tests cannot show; in the Completion Notes, state exactly what the tests cover vs what needs human eyes. [Source: story-specific guidance "VERIFICATION REALITY"; architecture.md#Starter Template Evaluation L130-131 "Renderer excluded from determinism tests (timeline-level, not pixel-level)"]

## Tasks / Subtasks

- [x] **Task 1 — `src/render/render-port.ts`: the one-way `RenderPort` INTERFACE (the swap seam)** (AC: #1)
  - [x] Export `interface RenderPort { init(): void | Promise<void>; render(snapshot: BattleState): void; destroy(): void }`. Import `BattleState` as a **type-only** import from `../schema/battle-timeline` (`import type { BattleState } from '../schema/battle-timeline'`). This is the ONLY contract the rest of the app (Story 2.5 controls, future game wiring) holds; the Phaser adapter implements it and a fake/headless adapter implements it in tests. Phaser is NOT imported in this file — the interface is renderer-agnostic (that is the point of the seam). [Source: architecture.md#Frontend Architecture L196-197 "RenderPort interface is the only seam to Phaser; the Phaser adapter consumes immutable state snapshots and never feeds back upstream"; #R5 L239-241; story-specific guidance "RECOMMENDED SHAPE"]
  - [x] Document the ONE-WAY contract in a header comment: `render(snapshot)` is a **command** (returns `void`), never a query — the adapter reads the immutable `BattleState` and draws it; it returns NOTHING to the caller and mutates NO upstream state (no event back to the reducer, no callback that feeds the cursor). Data flows playback-reducer → RenderPort, never back (R5). [Source: architecture.md#Communication Patterns L272-273 "Playback → render is snapshot-based … the RenderPort renders snapshots and never mutates upstream state"; epics.md#Story-2.3 AC1 L282 "never feeds state back upstream (one-way)"]

- [x] **Task 2 — `src/render/render-model.ts`: the PURE view-model (`BattleState` → `RenderModel`)** (AC: #1, #2)
  - [x] Export `type RenderModel = { entities: RenderEntity[]; insightGauge: number; victory: boolean }` and `type RenderEntity = { id: string; kind: EntityKind; x: number; y: number; hpFraction: number }` with `type EntityKind = 'forgemaiden' | 'boss' | 'minion'` (a string-literal union — NO numeric enum, project convention). Plain `type` declarations, NOT Zod schemas (this is transient in-memory view state, never a serialized cross-stage artifact — same rationale as `PlaybackState`; the project validates at boundaries only). [Source: architecture.md#Naming Patterns L247-249 "string-literal unions … No numeric enums"; #Format Patterns L262-264; 2-2 Dev Notes "Why no Zod schema for PlaybackState"]
  - [x] Export `toRenderModel(snapshot: BattleState, layout: RenderLayout = DEFAULT_LAYOUT): RenderModel`. It maps the immutable `BattleState` to the drawable model **purely** (a pure function of its inputs — see Dev Notes "Why RenderModel is pure"). It MUST contain the Forgemaiden, the Boss, and **at least one Minion** (AC2). [Source: epics.md#Story-2.3 AC2 L287; story-specific guidance "(3) a PURE testable RenderModel maps BattleState → drawable (Forgemaiden, Boss, >=1 Minion, hp bars, Insight Gauge)"]
  - [x] **Forgemaiden** entity: `kind:'forgemaiden'`, `hpFraction = snapshot.resolve / layout.maxResolve` (the Forgemaiden's health bar IS the Resolve bar — she is the hero; Resolve is her stamina). Clamp `hpFraction` to `[0, 1]`. [Source: src/model/battle-model.ts L39-48 (resolve is the hero's bar); architecture.md "Problem Integrity, Resolve, the Insight Gauge" / epics.md#Story-2.1 L237]
  - [x] **Boss** entity: derive from `snapshot.enemies.find(e => e.id === layout.bossId)` (the Battle Model seeds exactly one enemy, the Boss, whose `hp` IS `problemIntegrity` — see Dev Notes "Where the Minion comes from"). `kind:'boss'`, `hpFraction = boss.hp / layout.maxProblemIntegrity`, clamped. If the Boss enemy is absent (defensive — should not happen in v0.1), fall back to `hpFraction` from `snapshot.problemIntegrity / layout.maxProblemIntegrity` (fail-closed-to-default, never throw). [Source: src/schema/battle-timeline.ts L31-35 (Enemy: id/type/hp); src/model/battle-model.ts L102-104 (Boss hp === problemIntegrity); architecture.md#Process Patterns L278-279 fail-closed]
  - [x] **Minion(s)** entity/entities: synthesize `>= 1` minion from `layout.minions` (a render-side config of `{ id, x, y }`), NOT from `BattleState` (v0.1's `BattleState.enemies` carries ONLY the Boss — there is no minion in the model yet; see Dev Notes "Where the Minion comes from"). Each minion's `hpFraction` is a static `1` (full) for v0.1 — minions have no per-minion HP in the model, and animating their death is **Story 2.4** (out of scope here). The default layout MUST include at least one minion so AC2 is satisfied. [Source: epics.md#Story-2.3 AC2 L287 "at least one Minion"; epics.md#Story-2.4 L307-309 "Boss vs Minion/imp render distinctly with hit/death animations" (Story 2.4, NOT here); src/schema/battle-timeline.ts L37-45 (BattleState has no minion field)]
  - [x] `insightGauge`: pass through `snapshot.insightGauge / layout.maxGauge`, clamped to `[0, 1]` (a fraction the gauge widget fills). `victory`: pass through `snapshot.victory`. [Source: src/schema/battle-timeline.ts L37-45; src/config/model-tuning.json L4 maxGauge 100]
  - [x] `RenderLayout` + `DEFAULT_LAYOUT`: a render-side config object `{ bossId, maxProblemIntegrity, maxResolve, maxGauge, forgemaiden:{x,y}, boss:{x,y}, minions:[{id,x,y}, ...] }`. The `max*` values mirror `model-tuning.json` initial values (problemIntegrity 100, resolve 100, maxGauge 100) so a full bar maps to `1.0`. Keep coordinates simple (placeholder positions on the 1024×768 stage — see Dev Notes "Stage geometry"). This is render-side presentation config, NOT battle tuning — it lives in `render/`, NOT in `src/config/model-tuning.json` (R1: render config never feeds mechanics). [Source: src/config/model-tuning.json L3-4; architecture.md#R1 L225-228; #Structure Patterns L254-255 (config-as-data — but render layout is presentation, not Layer-0 tuning)]

- [x] **Task 3 — `src/render/phaser/placeholder-textures.ts`: generate placeholder textures (NO real art)** (AC: #2)
  - [x] Export `generatePlaceholderTextures(scene: Phaser.Scene, manifest: Record<string, string>): void` (or a small registry helper). Using Phaser's `scene.add.graphics()` / `scene.make.graphics({}, false)` + `graphics.fillStyle(color).fillRect(...)` then `graphics.generateTexture(key, w, h)`, create a distinct colored rectangle (or simple shape) texture for each placeholder entity kind — e.g. Forgemaiden (one color), Boss (a larger rect, another color), Minion (a small rect, a third color). NO PNG/sprite-sheet loading of real art. The texture KEY for each entity comes from the **asset manifest** (logical entity name → key), so swapping in final AI art later (Story 5.3) is a manifest + loader change that touches only `render/`, never the scene's draw logic. [Source: epics.md#Story-2.3 AC2 L288 "assets load via the bundle's asset manifest (placeholder-first)"; epics.md#Story-5.3 L545 "placeholder → final is a manifest swap"; story-specific guidance "(4) placeholder-first art via an asset manifest"; architecture.md#Frontend Architecture L198-199 "Phaser loader fed by the bundle's asset manifest; placeholder-first"]
  - [x] Define a **default/fallback manifest** in `render/` (`DEFAULT_ASSET_MANIFEST: Record<string, string>` mapping `'forgemaiden' | 'boss' | 'minion'` → a placeholder texture key) so the arena boots with placeholders even when no `ReplayBundle.assetManifest` is supplied. The `ReplayBundle.assetManifest` (`Record<string, string>`, already in the schema) is the eventual source; for v0.1 the arena uses the default manifest (no committed bundle exists yet — `public/bundles/` is empty). Document that the manifest indirection is the swap seam. [Source: src/schema/replay-bundle.ts L24-25 (`assetManifest: z.record(z.string(), z.string())`); ls public/bundles/ (empty — story-10-1.json is Epic 5)]

- [x] **Task 4 — `src/render/phaser/arena-scene.ts`: the Phaser arena scene (draws placeholders, driven by snapshots)** (AC: #1, #2)
  - [x] Export `class ArenaScene extends Phaser.Scene` (key `'Arena'`). In `preload()`/`create()`, call `generatePlaceholderTextures(this, manifest)` then build the scene game objects: a sprite/image per `RenderModel.entity` (Forgemaiden, Boss, ≥1 Minion) using the manifest texture key, a **health bar** game object per entity that has one (Forgemaiden + Boss; minions get a static full bar or none — minimum is Forgemaiden + Boss bars per AC2), and an **Insight Gauge** widget. Health bars + gauge are Phaser `Graphics` rectangles whose fill width = the corresponding `fraction` (placeholder UI; the polished bars/gauge animation is Story 2.4). [Source: epics.md#Story-2.3 AC2 L287 "health bars and the Insight Gauge visible"; epics.md#Story-2.4 L309 "bars and gauge animate with state changes" (animation is 2.4)]
  - [x] Expose an `applySnapshot(snapshot: BattleState): void` method (called by the adapter's `render()`): it computes `toRenderModel(snapshot)` and **updates** the existing game objects' positions/bar widths/visibility/gauge fill from the model — it does NOT recreate game objects every frame (create-once in `create()`, mutate-in-place on update). Updating Phaser display objects in place is the renderer's internal mutable state and is **allowed** — R2 purity binds Layer-0 (`ingest/translate/pace/model`) only, NOT `render/`. Reading a fractional value off the immutable snapshot and setting a bar width does NOT feed anything upstream (one-way, AC1). [Source: architecture.md#R2 L229-232 (purity is Layer-0 only); #R5 L239-241; #Communication Patterns L272-273]
  - [x] The scene reads ONLY the `RenderModel` (derived from the snapshot) — it reads NO `beatType`/annotation (that is Layer 1, arrives Epic 3) and never re-reads raw JSONL (R3). It is driven entirely by `BattleState` snapshots handed in via `applySnapshot`. [Source: architecture.md#R1 L225-228, #R3 L233-235]

- [x] **Task 5 — `src/render/phaser/phaser-render-adapter.ts`: the Phaser adapter implementing `RenderPort`** (AC: #1)
  - [x] Export `class PhaserRenderAdapter implements RenderPort`. It owns a `Phaser.Game` (constructed in `init()` with the `ArenaScene`) and implements: `init()` → boot the game / start the Arena scene; `render(snapshot)` → forward to the live `ArenaScene.applySnapshot(snapshot)` (the one-way command); `destroy()` → `game.destroy(true)`. This is the ONLY file (besides the scene/textures) that touches `Phaser.Game` config. It accepts the parent DOM id (default `'game-container'`, matching `index.html` + the template's `StartGame`) and optionally a manifest. [Source: architecture.md#Frontend Architecture L196-197; src/game/main.ts L25-29 (`StartGame(parent)`); index.html L? (`#game-container`)]
  - [x] The adapter is the swap point: a future PixiJS adapter would implement the SAME `RenderPort` and nothing else would change (R5). Do NOT leak any Phaser type out of the adapter's public surface — its public methods speak only `BattleState` + `void` (the `RenderPort` shape). [Source: architecture.md#R5 L239-241 "Swapping to PixiJS touches only render/"]

- [x] **Task 6 — Wire the boot: drive the adapter with the Story 2.2 playback reducer (a committed/derived timeline)** (AC: #1, #2)
  - [x] Add `src/render/arena-boot.ts` (or wire into `src/game/main.ts`/`src/main.ts`) that: (a) obtains a `BattleTimeline` (for v0.1, **derive it from the committed ingest fixtures** via the same `pace(translate(...ingest...))` chain the model tests use — there is no committed `ReplayBundle` yet; `public/bundles/` is empty and bundle-building is Epic 5), (b) builds `createPlaybackReducer(timeline)` + `initialPlaybackState(timeline)` from `src/model/playback.ts`, (c) constructs `PhaserRenderAdapter`, calls `init()`, and calls `adapter.render(initialPlaybackState(timeline).battleState)` so the arena shows the t=0 snapshot, and (d) proves playback CAN drive it by advancing the reducer (e.g. a few `tick`s, or a simple rAF loop that pumps `tick` and calls `adapter.render(state.battleState)` — a MINIMAL drive, NOT the full controls UI). **The on-screen play/pause/scrub/speed controls are Story 2.5 — do NOT build them here.** The wall-clock loop (rAF) legitimately lives in `render/` (it is NOT a Layer-0 module), so a `requestAnimationFrame`/timer here is fine. [Source: epics.md#Story-2.2 L255-270 (the reducer this story consumes); epics.md#Story-2.5 L312-326 (controls UI — NOT this story); architecture.md#Data Flow L400 "playback reducer → BattleState → RenderPort(Phaser)"; src/model/battle-model.test.ts L31-57 (the fixture→timeline derivation pattern to reuse); story-specific guidance "render the snapshot/arena + prove playback can drive it"]
  - [x] Replace the template's placeholder scenes wiring so the app shows the Arena. The template `src/game/main.ts` boots `[Boot, Preloader, MainMenu, Game, GameOver]` with a "Make something fun!" demo `Game` scene — repoint the boot to the `ArenaScene` (or have the Preloader/Boot hand off to Arena). Keep changes surgical: you may keep `Boot`/`Preloader` if convenient, but the visible scene must be the Arena. The Anthropic SDK must NOT enter this path (R4 — the browser entry never imports `@anthropic-ai/sdk`). [Source: src/game/main.ts L10-23; src/game/scenes/Game.ts L22-26 (the demo text to replace); architecture.md#R4 L236-238]

- [x] **Task 7 — Tests: the testable surface (pure RenderModel + one-way contract + headless boot smoke)** (AC: #1, #2)
  - [x] **`src/render/render-model.test.ts` (pure, node env) — the RenderModel mapping:** assert `toRenderModel(initialBattleState())` (full bars) yields a Forgemaiden (`hpFraction === 1`), a Boss (`hpFraction === 1`), and `>= 1` minion; `insightGauge === 0`; `victory === false`. Drive a real fixture timeline (reuse the `runIngest`/`timeline()` helpers from `battle-model.test.ts` — copy verbatim) and assert: at the END (`foldBattleState(tl)`), the Boss `hpFraction === 0` and `victory === true`; the gauge fraction tracks `snapshot.insightGauge / maxGauge`. Assert `toRenderModel` is **pure** — calling it twice on the same snapshot deep-equals, and it does NOT mutate the input snapshot (stringify-before/after). This is the bulk of the real verification. [Source: epics.md#Story-2.3 AC2; src/model/battle-model.test.ts L31-57 (fixture pipeline); src/model/battle-model.ts L122-133 (foldBattleState)]
  - [x] **`src/render/render-port.test.ts` (pure, node env) — the one-way contract via a FAKE adapter:** define a `class FakeRenderAdapter implements RenderPort` that records `init`/`render`/`destroy` calls and pushes each `render(snapshot)` arg into an array. Drive it from a real reducer walk (play to end + a seek) and assert: every recorded snapshot equals `foldBattleState(tl, cursor)` at that cursor; the adapter returns `void` from `render` (no value flows back); and the reducer/timeline are NOT mutated by the adapter (the adapter cannot reach upstream — it only receives snapshots). This proves the seam is one-way and renderer-agnostic WITHOUT Phaser. [Source: epics.md#Story-2.3 AC1 L280-283; story-specific guidance "a fake/headless adapter implements it in tests"; architecture.md#Communication Patterns L272-273]
  - [x] **`src/render/phaser/arena-scene.test.ts` (jsdom env — `// @vitest-environment jsdom` at the top of the file) — the headless Phaser BOOT smoke:** construct a `Phaser.Game` with `{ type: Phaser.HEADLESS, ... , scene: ArenaScene }` (HEADLESS skips canvas/WebGL but **requires the DOM** — hence jsdom, see Dev Notes "Headless boot needs jsdom, not node"). Wait for the scene `create` to run (listen for the scene/`READY` event or a `postBoot` callback), then assert the Arena scene created the expected game objects WITHOUT throwing — e.g. the children list / a tracked references object contains a Forgemaiden, a Boss, ≥1 Minion, the bars and the gauge. Then call `applySnapshot(foldBattleState(tl))` (victory state) and assert it does not throw and the Boss bar object's tracked fraction updated. `destroy()` the game in a cleanup. Keep it a SMOKE test (boots + creates objects + applies a snapshot without throwing) — it is NOT a visual assertion. [Source: node_modules/phaser/dist/phaser.esm.js L16508 "A Headless Renderer doesn't create either a Canvas or WebGL Renderer. However, it still absolutely relies on the DOM being present … meant for unit testing"; L16517 `HEADLESS: 3`; L17369-17372 (headless boot returns early, no renderer); vitest.config.ts L? "jsdom is opted into per-file later only where the DOM is genuinely needed"]
  - [x] If the headless boot proves flaky/heavy under jsdom (Phaser's audio/input managers can probe browser APIs jsdom lacks), set `audio: { noAudio: true }` and `banner: false` in the game config and disable input where possible, and keep the smoke minimal. Document any jsdom shim needed in the Completion Notes. Do NOT weaken the test to a no-op — if a genuine jsdom gap blocks it, record it explicitly as a verification limitation (operator-verified instead) rather than faking a pass. [Source: story-specific guidance "headless Phaser BOOT smoke (Phaser.HEADLESS or mocked canvas; assert the scene creates the expected game objects without throwing)"]

- [x] **Task 8 — Gates green (the definition of done)** (AC: #1, #2)
  - [x] `pnpm typecheck` clean (strict). `pnpm lint` clean — **R5 is the headline lint check**: phaser is imported ONLY under `src/render/**` + `src/game/**` (the eslint zone). Verify `render-port.ts` + `render-model.ts` import NO phaser (they are renderer-agnostic); only `render/phaser/**` and the boot wiring import it. Confirm a deliberate phaser import outside the allowed zone would fail (it is already proven in Story 1.1 — do NOT add such an import, just rely on the rule). `pnpm test` full suite green (existing tests still pass — only NEW files added; report new counts). `pnpm build` succeeds and `@anthropic-ai/sdk` never enters the bundle (R4 — `grep -ril anthropic dist/` finds nothing). [Source: eslint.config.ts L102-108 (R5 re-allow zone `src/render/**` + `src/game/**`); L24-27 (restrictPhaser); architecture.md#R4 L236-238; 2-2 Task 6]
  - [x] **Operator pass (NOT a gate):** note in Completion Notes that `pnpm dev` must be run by a human to confirm AC2's visual claim (Forgemaiden + Boss + ≥1 Minion render as placeholder sprites with visible health bars + Insight Gauge, and that playback visibly drives them). The automated gate cannot see pixels. [Source: AC §"What the gate CAN prove"; story-specific guidance "the visual-appearance ACs are operator-verified, not gate-verified"]

### Review Follow-ups (AI)

Fix round 1 — resolving the Senior Developer Review (AI) findings (F1–F8). All gates re-run green
(typecheck, lint R1/R4/R5, test 32 files / 339 tests, build R4-clean).

- [x] **F2 (consider) — adapter/boot had NO gate coverage.** Added `src/render/phaser/phaser-render-adapter.test.ts`,
  booting the REAL `PhaserRenderAdapter` under `Phaser.HEADLESS` (injected via a new optional
  `rendererType` ctor arg — a numeric Phaser config value, NOT a Phaser type on the RenderPort surface).
  **This surfaced a REAL defect** (not just coverage): the adapter set `ready=true` from a one-shot
  `Scenes.Events.CREATE` listener attached in `postBoot`, but Phaser runs the scene's `create()` (via
  the bootQueue on `GameEvents.READY`) BEFORE `postBoot` — so CREATE had already fired, the listener
  never ran, `ready` stuck `false`, and every `render()` buffered into `pending` forever: **playback
  never reached the arena** (only the static t=0 cast showed). Fixed at root cause — `postBoot` now
  marks ready immediately via `game.scene.isActive('Arena')` (RUNNING by then), CREATE kept as a
  fallback. Test proves the buffered snapshot flushes (Boss bar 1→0) + `init()` idempotency.
- [x] **F3 (consider) — `render()` before `init()` silently dropped the snapshot.** Guarded: when
  `this.game` is null, `render()` no-ops with a `console.warn` instead of buffering into a `pending`
  that no boot will ever flush. Proven by a node/jsdom test asserting the warn fires and nothing throws.
- [x] **F4 (consider) — `DEFAULT_LAYOUT.max*` + the scene's t=0 seed hardcoded `100`, manually mirroring
  `model-tuning.json`.** `DEFAULT_LAYOUT.bossId`/`maxProblemIntegrity`/`maxResolve`/`maxGauge` now DERIVE
  from `MODEL_TUNING` (the single tuning-truth source, NFR-4); `arena-scene.create()` seeds the cast from
  `initialBattleState()` instead of the inlined literal (removed `makeInitialSnapshot()`). render → model
  import is lint-allowed (R1 only forbids Layer-0 → interpret). Existing render-model tests (which pin the
  0.6/87-of-100 fractions) still pass, confirming the derived maxima equal the prior literals today.
- [x] **F5 (fix) — Completion Notes undercounted tests + stale per-file counts.** Corrected the gate
  evidence: dev-story actual is 31 files / 334 tests (render-model 15, render-port 5, arena-scene 4 = 24
  new), not "331 / +16 / render-model 12". Updated the Change Log line too. (Post fix-round-1: 32 / 339.)
- [x] **F1 (likely-refute) — CONFIRMED REFUTED, no code change.** Claim: adapter double-starts the Arena
  (auto-start + explicit `scene.start`), re-running `create()`. Verified against the installed Phaser
  4.0.0 source: `SceneManager.start` (`phaser.esm.js` L213349) takes the `if (!this.isBooted)` branch
  (L213352) at the synchronous `game.scene.start('Arena', …)` call — the Game boots async
  (`game.events.once(GameEvents.READY, this.bootQueue)` L212330; `isBooted` set true only inside
  `bootQueue`), so the scene is NOT RUNNING then and the shutdown+restart branch (L213382-389) is
  unreachable. `start` merely merges the holding-pattern `_data['Arena']={autoStart:true,data:{manifest}}`.
  A live diagnostic confirmed `create()` runs exactly ONCE (single RUNNING scene at postBoot). No leak.
- [x] **F6 (likely-refute) — no change.** `vitest.setup.canvas2d.ts` is correctly guarded
  (`typeof HTMLCanvasElement/HTMLImageElement !== 'undefined'`) — a NO-OP in the node env, so the pure
  render-model/render-port tests are untouched. It is a documented, necessary shim for Phaser's
  module-load 2D-context touch + texture-READY gating under jsdom. Latent caution only, no defect.
- [x] **F7 (likely-refute) — no change.** jsdom "getContext not implemented" + Phaser "Texture key already
  in use" warnings during the HEADLESS boots are cosmetic stderr by design (a real HEADLESS game per
  boot); the tests pass. Recorded here as expected, not a defect.
- [x] **F8 (likely-refute) — no change.** `model.victory` is intentionally not drawn by `ArenaScene`
  (`arena-scene.ts` "model.victory is intentionally not drawn yet — the held-victory frame is Story 2.4").
  Correct, documented scope deferral — the auditor itself states no change needed.

## Dev Notes

### What this story IS (and is NOT)
- **IS:** the FIRST renderer story — it establishes `src/render/` cleanly behind the one-way `RenderPort` (FR-7, R5): the interface (`render-port.ts`), a PURE testable view-model (`render-model.ts`), the Phaser 4 adapter + arena scene that draw PLACEHOLDER shapes (`render/phaser/`), and the boot that proves the Story 2.2 playback reducer can drive it. The snapshot/arena renders; playback can drive it. [Source: epics.md#Story-2.3 L272-288; architecture.md#Decision Impact Analysis "(6) RenderPort + Phaser adapter (placeholder art)" L211-214; story-specific guidance]
- **IS NOT:** the rich combat ANIMATIONS. Idle/forge-strike/cast/stagger/rise, the Hammer Flurry, hit/death animations, the Aether Storm visual, animated bars/gauge, and 60fps pacing are **Story 2.4** (FR-7, NFR-1). This story draws STATIC placeholders that snap to the current snapshot's values — no tweens, no animation frames. [Source: epics.md#Story-2.4 L290-310]
- **IS NOT:** the controls UI. The on-screen play/pause/restart/scrub/speed widgets live in `src/render/controls.ts` and are **Story 2.5** ("driven by the reducer cursor from Story 2.2"). This story may include a MINIMAL drive loop (a rAF pumping `tick`) to prove playback drives the arena, but builds NO interactive controls. [Source: epics.md#Story-2.5 L312-326; architecture.md#FR→Structure Mapping "render/controls.ts" L374]
- **IS NOT:** final art. v0.1 uses Phaser-`Graphics`-generated colored rectangles as placeholder textures, keyed via an asset manifest. Final AI art is **Story 5.3**, a manifest swap that touches only `render/` (no engine-code change). The engine NEVER blocks on final art. [Source: epics.md#Story-5.3 L535-545; architecture.md#Frontend Architecture L198-199; story-specific guidance "(4) placeholder-first … final art is Story 5.3, a manifest swap"]
- **IS NOT:** interpretation, mechanics, or a second parser. `render/` consumes the immutable `BattleState` snapshot ONLY; it reads NO `beatType`/annotation (Layer 1, Epic 3), changes NO HP/gauge/victory math (that is Story 2.1's `foldBattleState`, consumed read-only via the snapshot), and never re-reads raw JSONL (R3). Nothing depends on `render/` (R5). [Source: architecture.md#R1 L225-228, #R3 L233-235, #R5 L239-241]

### The one-way RenderPort — the load-bearing seam (R5)
- **`render/` depends on `schema/` + immutable `BattleState` snapshots; NOTHING depends on `render/`.** Phaser imports are confined to `render/` (the lint zone is `src/render/**` + `src/game/**`). Swapping to PixiJS touches only `render/`. This is R5 verbatim and the reason for the interface/adapter split. [Source: architecture.md#R5 L239-241; eslint.config.ts L102-108]
- **`render(snapshot)` is a COMMAND, not a query.** It returns `void`. The adapter reads the snapshot and draws; it returns nothing and pushes nothing back to the reducer/cursor. The data flow is strictly `playback reducer → BattleState → RenderPort(Phaser)` (architecture's Data Flow diagram), with **no upstream feedback edge**. The fake-adapter test pins this: the adapter only ever RECEIVES snapshots; it cannot reach the reducer. This is what "never feeds state back upstream (one-way)" means in AC1. [Source: epics.md#Story-2.3 AC1 L282; architecture.md#Data Flow L392-402; #Communication Patterns L272-273]
- **Why an interface + a fake adapter:** the `RenderPort` interface is renderer-agnostic (it imports `BattleState` as a type and nothing else), so the one-way contract is *provable without Phaser* — `FakeRenderAdapter` records snapshots in a node-env test. This keeps the bulk of the verification fast/headless and proves the seam is genuinely swappable (the architecture's "clean swap seam" claim). [Source: architecture.md#R5; story-specific guidance "a fake/headless adapter implements it in tests"; #Architecture Validation "clean swap seams (RenderPort, BeatInterpreter)" L481]

### Why RenderModel is pure (and lives outside `render/phaser/`)
- **DECISION — a PURE `toRenderModel(snapshot, layout) → RenderModel` in `src/render/render-model.ts`, with NO Phaser import.** This is where the snapshot→visual *logic* lives (which entities exist, each one's `hpFraction`, the gauge fraction, the victory flag), expressed as plain data. It is unit-testable in the node env with zero Phaser. The Phaser scene is then a THIN consumer that just paints the model onto display objects. Splitting the logic (pure, testable) from the painting (Phaser, smoke-tested) is the standard "keep the renderer thin, keep the logic testable" pattern the architecture asks for. [Source: architecture.md#Testability L62-64; story-specific guidance "(3) a PURE testable RenderModel … This is PURE + UNIT-TESTABLE without Phaser and is where the snapshot→visual logic lives. No Date.now/Math.random here"]
- **No `Date.now()`/`Math.random()` in `render-model.ts`.** Even though R2's *lint-enforced* purity binds Layer-0 only, the RenderModel mapping is deliberately kept pure so it is deterministically testable (same snapshot → same model). Any wall-clock (the rAF drive loop) lives in the adapter/boot, NOT in the model. (Animation easing/jitter, when it arrives in 2.4, also stays in the Phaser layer, not the pure model.) [Source: story-specific guidance "No Date.now/Math.random here"]
- **`render-model.ts` and `render-port.ts` import NO phaser** — only `render/phaser/**` (+ the boot wiring) does. This keeps the R5 surface minimal and means the pure tests need no jsdom. [Source: eslint.config.ts L102-108 (the zone allows phaser in all of `render/`, but we voluntarily keep it out of the model/port files so they stay renderer-agnostic and node-testable)]

### The RenderModel shape — RESOLVED on merits
- **DECISION — `RenderModel = { entities: RenderEntity[]; insightGauge: number; victory: boolean }`, `RenderEntity = { id; kind; x; y; hpFraction }`, `EntityKind = 'forgemaiden' | 'boss' | 'minion'`.** Rationale:
  - **`entities` as a flat list** (not named slots like `{ forgemaiden, boss, minions }`) — a list keyed by `id`/`kind` is what the scene iterates to create/update display objects, generalizes to N minions for free, and matches the "entities with id/kind/x/y, hp fraction" shape the guidance names. The scene can still find the Forgemaiden/Boss by `kind` when it needs a specific bar. [Source: story-specific guidance "entities with id/kind/x/y, hp fraction, gauge fraction, victory flag"]
  - **`hpFraction` (a `[0,1]` number), not raw HP** — the view-model normalizes so the scene draws a bar of `fraction * barWidth` without knowing the max. This decouples the bar widget from `model-tuning.json` magnitudes and is the natural unit for a placeholder bar. Clamp to `[0,1]` (defensive — `foldBattleState` already clamps the bars to `[0, max]`, but a render-side clamp guarantees a sane bar even if a layout `max` is mis-set). [Source: src/model/battle-model.ts L87 (bars clamped to `[0, init]`); architecture.md#Process Patterns fail-closed L278-279]
  - **`insightGauge` + `victory` at the top level** (not per-entity) — the gauge and the victory state are scene-global, not tied to one entity. `victory` lets the scene show a held victory frame (placeholder; the polished victory is later). [Source: src/schema/battle-timeline.ts L37-45 (BattleState carries `insightGauge`, `victory` at top level)]
  - **`EntityKind` a string-literal union** — project convention (no numeric enums). Three kinds for v0.1 (Forgemaiden, Boss, Minion); more (imp, Shaman, THUNDORR) arrive with Epic 3/Story 2.4/5.3 — additive, no shape change. [Source: architecture.md#Naming Patterns L247-249; epics.md#Story-3.x THUNDORR/Shaman]
- **Plain `type`, NOT Zod** — `RenderModel` is transient in-memory view state, never serialized into the ReplayBundle and never read from an untrusted source, so it gets a `type` (PascalCase) and no runtime schema. Same call as `PlaybackState`. The `BattleState` it reads is already Zod-validated upstream (by `foldBattleState`'s closing `parse`), so the fail-closed boundary is inherited. [Source: 2-2 Dev Notes "Why no Zod schema for PlaybackState"; architecture.md#Format Patterns L262-264]

### Where the Minion comes from — the genuine modeling gap (READ THIS)
- **The v0.1 `BattleState` carries ONLY the Boss enemy.** `initialBattleState` seeds `enemies: [{ id: 'boss', type: 'feature', hp: 100 }]` and `applyBeat` only ever touches that Boss; there is NO minion in the Battle Model. The schema comment is explicit: "Enemy shape is intentionally thin here — full enemy modeling is Epic 2." But AC2 requires "at least one Minion render as a placeholder sprite". [Source: src/model/battle-model.ts L39-48, L102-104; src/schema/battle-timeline.ts L29-35 (the "intentionally thin" comment)]
- **DECISION — synthesize the Minion(s) in the renderer from a render-side `layout.minions` config, NOT from `BattleState`.** The Minion is a *visual presence* in the arena (the FF battle has minions flanking the boss) that v0.1's deterministic model does not yet track per-instance. Drawing a placeholder minion (static, full HP bar or none) satisfies AC2 ("at least one Minion render as placeholder sprites") without inventing model state. This is honest: the minion has no mechanical effect (R1 — the renderer adds no mechanics), it is presentation only. **DO NOT** add a minion to `BattleState`/`battle-model.ts` to satisfy this AC — that would be Layer-0 model work this story has no mandate for, and Story 2.4 ("Boss vs Minion/imp render distinctly with hit/death animations") is where minion behavior/animation is actually specified. If/when the model grows live minions, `toRenderModel` switches to reading them from `snapshot.enemies` — a localized change. [Source: epics.md#Story-2.3 AC2 L287; epics.md#Story-2.4 L307-309; architecture.md#R1 L225-228 "render adds no mechanics"; CLAUDE.md "Surgical changes … touch only what the request requires"]
- **OPEN QUESTION (recorded, non-blocking):** whether the synthesized minion should later be promoted into the model (live minion HP from sub-agent/imp events) is a Story 2.4 / Epic-3 decision, not this story's. For 2.3 the render-side synthesis is correct and minimal.

### Placeholder textures via Phaser Graphics + asset manifest — RESOLVED on merits
- **DECISION — generate placeholder textures at runtime with `Phaser.GameObjects.Graphics.generateTexture()` (colored rects/simple shapes), keyed by an asset manifest; do NOT load any real art file.** Rationale:
  - **No real art exists** (`public/assets/` has only the template `bg.png`/`logo.png`; the ~7 entity sprites are Story 5.3). Generating a colored rect texture in-code means the arena boots and is legible with ZERO art assets, keeping art off the critical path exactly as the architecture demands ("placeholder-first so the engine/pipeline never blocks on final AI art"). [Source: ls public/assets/ (bg.png, logo.png only); architecture.md#Frontend Architecture L198-199; #Gap Analysis "AI-art production … placeholder-first keeps it off the critical path" L443]
  - **Keyed by the asset MANIFEST (logical entity name → texture key)** so the swap to final art (Story 5.3) is a manifest + loader change confined to `render/` — the scene's draw logic references `manifest['boss']`, never a hard-coded `'boss.png'`. The `ReplayBundle.assetManifest` field (`Record<string,string>`) already exists in the schema for this. For v0.1 (no committed bundle) the arena uses a `DEFAULT_ASSET_MANIFEST` defined in `render/`. [Source: src/schema/replay-bundle.ts L22-25; epics.md#Story-2.3 AC2 L288 "assets load via the bundle's asset manifest"; epics.md#Story-5.3 L545 "no engine-code change (placeholder → final is a manifest swap)"]
  - **Why generate vs ship placeholder PNGs:** generated textures need no binary assets in the repo, are trivially distinct (pick three colors), and make the "art is swappable" seam obvious (the manifest decides the key; the texture source is the only thing that changes). Shipping placeholder PNGs would add committed binaries for no benefit. [Source: CLAUDE.md "Simplicity first … Minimum code"; story-specific guidance "Phaser Graphics-generated colored rects / simple shapes — NO real art"]

### Headless boot needs jsdom, not node — RESOLVED on merits (Phaser 4.0.0, verified from source)
- **DECISION — the Phaser boot smoke test runs under the `jsdom` Vitest environment (per-file `// @vitest-environment jsdom`), using `type: Phaser.HEADLESS`.** This is verified directly from the installed Phaser 4.0.0 source, NOT guessed:
  - `Phaser.HEADLESS === 3` (`phaser.esm.js` L16517). At boot, the renderer-selection branch returns early for HEADLESS — **no Canvas or WebGL renderer is created** (`phaser.esm.js` L17369-17372 "if renderType === HEADLESS … Nothing more to do here; return"). So no real GPU/canvas is needed.
  - BUT the HEADLESS renderer's own docstring is explicit: **"A Headless Renderer doesn't create either a Canvas or WebGL Renderer. However, it still absolutely relies on the DOM being present and available. This mode is meant for unit testing"** (`phaser.esm.js` L16508-16510). The default Vitest env is `node` (`vitest.config.ts`), which has NO `document`/`window` — Phaser's boot would throw. jsdom supplies the DOM Phaser's boot/device-detection touches. `vitest.config.ts` already anticipates this: "jsdom is opted into per-file later only where the DOM is genuinely needed." [Source: phaser.esm.js L16508-16517, L17369-17372; vitest.config.ts L4-6]
  - **`Phaser.HEADLESS` still runs scene lifecycle** (`headlessStep` → `this.scene.update(...)`, `phaser.esm.js` L18065+), so the Arena scene's `create()` runs and game objects ARE created — which is exactly what the smoke asserts. [Source: phaser.esm.js L17964 `this.loop.start(this.headlessStep...)`, L18057-18089]
  - **The smoke proves: boots without throwing + the Arena creates the expected game objects (Forgemaiden, Boss, ≥1 Minion, bars, gauge) + `applySnapshot(victory)` does not throw.** It does NOT assert pixels/colors/layout (HEADLESS draws nothing). Visual correctness is the operator pass. [Source: AC §"What the gate CAN prove"; story-specific guidance "assert the scene creates the expected game objects without throwing"]
- **Fallback if jsdom + Phaser fights (audio/input managers probing missing browser APIs):** set `audio: { noAudio: true }`, `banner: false`, minimize input, and keep the smoke minimal. If a genuine jsdom gap blocks the boot, record it as a verification limitation (operator-verified) — do NOT fake the test. [Source: story-specific guidance "Phaser.HEADLESS or mocked canvas"]

### Stage geometry + the placeholder layout
- The template game config is `1024×768`, `parent: 'game-container'`, scenes `[Boot, Preloader, MainMenu, Game, GameOver]`. Repoint the visible scene to the Arena. Place placeholders simply on the 1024×768 stage: Forgemaiden on the left (the hero), the Boss on the right (the antagonist), minion(s) flanking the boss; health bars above/under each; the Insight Gauge as a labelled bar (e.g. bottom-center or under the Forgemaiden). Exact pixels are operator-tunable later — keep them as `DEFAULT_LAYOUT` constants in `render-model.ts` so they are one place to adjust. [Source: src/game/main.ts L10-23; src/game/scenes/Game.ts L19-26 (the demo coordinates to replace)]
- The template's `Boot`/`Preloader` load `bg.png`/`logo.png` from `public/assets`; you may keep `Boot`/`Preloader` (they are harmless) but the playable scene must become the Arena. Keep template edits surgical — the goal is "the Arena is what renders", not a rewrite of the bootstrap. [Source: src/game/scenes/Boot.ts, Preloader.ts; CLAUDE.md "Surgical changes"]

### Why the boot derives the timeline from fixtures (not a bundle) for v0.1
- **There is no committed `ReplayBundle` yet** — `public/bundles/` is empty and `bundle:story-10-1` is a stub ("not yet implemented (Epic 5, Story 5.2)"). The architecture's data flow is `load bundle → playback reducer → BattleState → RenderPort`, but the bundle-building stories are Epic 5. So for 2.3 the boot derives a real `BattleTimeline` the SAME way the model tests do — `pace(translate(...ingest the committed fixtures...))` — and feeds that to `createPlaybackReducer`. This is honest (a real timeline from the committed Story 10.1 fixtures), keeps the renderer unblocked, and the bundle-load path drops in cleanly later (the reducer's input is a `BattleTimeline` either way). [Source: package.json L14 (bundle stub); ls public/bundles/ (empty); src/model/battle-model.test.ts L31-57 (the fixture→timeline chain); architecture.md#Data Flow L400; #Development Workflow L405 "renders from a committed public/bundles/*.json" — which 5.x will provide]
- **Note:** importing `ingest/translate/pace` from `render/`/boot wiring is allowed (no lint zone forbids it — R1 only forbids Layer-0 importing `interpret/`; R5 only forbids phaser *outside* render/game; there is no rule against render importing Layer-0). Keep this derivation in the boot/wiring file, not in `render-model.ts` (the model stays a pure `BattleState → RenderModel` mapper). [Source: eslint.config.ts L57-91 (the R1 zones target ingest/translate/pace/model → interpret; nothing forbids render→model)]

### Consuming Story 2.2's playback reducer (the contract you build on)
- `src/model/playback.ts` exports: `initialPlaybackState(timeline, tuning?) → PlaybackState`, `createPlaybackReducer(timeline, tuning?) → (state, action) => state`, and the `PlaybackState` / `PlaybackAction` types. `PlaybackState = { status: 'playing'|'paused'; cursor; speed; battleState: BattleState }`. The reducer is a pure `(state, action) => state`; actions are `play | pause | restart | seek{cursor} | tick | setSpeed{speed}`. **`battleState` is ALWAYS `foldBattleState(timeline, cursor)`** — so to render the current frame, the adapter is handed `state.battleState`. [Source: src/model/playback.ts L37-54, L75-157]
- **`speed` is a LOGICAL step multiplier (beats per `tick`), NOT wall-clock; `tick` is status-agnostic.** The wall-clock loop (rAF/timer that decides HOW OFTEN to dispatch `tick`) is render-side and is precisely what this story's MINIMAL drive loop (or Story 2.5's full loop) provides. The reducer pumps no clock itself. So a `requestAnimationFrame` in `arena-boot.ts` calling `dispatch({type:'tick'})` then `adapter.render(state.battleState)` is the correct place for the clock. [Source: src/model/playback.ts L60-69, L142-149; 2-2 Dev Notes "Speed is a logical multiplier, NOT wall-clock"]
- **SCRUB==PLAY / determinism are inherited** — since `state.battleState` is a pure fold of the cursor, the renderer just draws whatever snapshot it is handed; it adds no path dependence. The fake-adapter test asserts the rendered snapshots equal `foldBattleState(tl, cursor)`. [Source: src/model/battle-model.ts L116-133; 2-2 Dev Notes "The load-bearing inheritance from Story 2.1"]

### Files to CREATE (all NEW — `render/` is currently empty except `.gitkeep`-style empty dirs)
- `src/render/render-port.ts` — the `RenderPort` interface (no phaser). [NEW]
- `src/render/render-model.ts` — pure `toRenderModel` + `RenderModel`/`RenderEntity`/`EntityKind` types + `RenderLayout`/`DEFAULT_LAYOUT` (no phaser). [NEW]
- `src/render/phaser/placeholder-textures.ts` — `generatePlaceholderTextures` + `DEFAULT_ASSET_MANIFEST` (phaser). [NEW]
- `src/render/phaser/arena-scene.ts` — `ArenaScene extends Phaser.Scene`, `applySnapshot` (phaser). [NEW]
- `src/render/phaser/phaser-render-adapter.ts` — `PhaserRenderAdapter implements RenderPort` (phaser). [NEW]
- `src/render/arena-boot.ts` — wire reducer → adapter (phaser + imports model/ingest/translate/pace). [NEW]
- `src/render/render-model.test.ts` (node), `src/render/render-port.test.ts` (node), `src/render/phaser/arena-scene.test.ts` (jsdom). [NEW]
- **UPDATE:** `src/game/main.ts` and/or `src/main.ts` — repoint the visible scene to the Arena (surgical; see "Stage geometry"). [UPDATE — read current state first: it boots the template demo `Game` scene.]

### Project Structure Notes
- All new files land under `src/render/` and `src/render/phaser/` — the EXACT homes the architecture's directory tree assigns (`render/render-port.ts`, `render/phaser/` for the adapter + scenes). `render/controls.ts` is deliberately NOT created (Story 2.5). [Source: architecture.md#Complete Project Directory Structure L359-362]
- Naming: kebab-case files (`render-port.ts`, `arena-scene.ts`); PascalCase types (`RenderModel`, `RenderEntity`, `ArenaScene`, `PhaserRenderAdapter`); string-literal union for `EntityKind` (no numeric enum); tests co-located `*.test.ts`. [Source: architecture.md#Naming Patterns L244-249]
- R5 lint zone already covers `src/render/**` + `src/game/**` for phaser — no eslint change needed (and per project rules, NEVER relax R1/R4/R5 to make code pass). The pure `render-port.ts`/`render-model.ts` voluntarily import no phaser so they stay node-testable. [Source: eslint.config.ts L102-108; PROJECT GATES "NEVER relax/disable these rules"]

### Testing Standards
- Vitest, `*.test.ts` co-located. Default env is `node`; the pure RenderModel + one-way contract tests run in `node` (no DOM). The Phaser boot smoke opts into `jsdom` via a per-file `// @vitest-environment jsdom` pragma (see "Headless boot needs jsdom"). [Source: vitest.config.ts L1-9]
- Reuse the committed-fixture pipeline (`readFixture`/`runIngest`/`timeline()` copied verbatim from `src/model/battle-model.test.ts` L31-57) to drive real `BattleTimeline`/`BattleState` values — do NOT hand-build fake snapshots where a real one is cheap; the model tests already prove this chain. [Source: src/model/battle-model.test.ts L31-57]
- The renderer is excluded from the determinism (golden-snapshot) discipline — it is timeline-level/pixel-level out of scope for the byte-for-byte guarantee. The RenderModel's purity is proven by a same-input deep-equal test, not a committed snapshot. [Source: architecture.md#Starter Template Evaluation L130-131]

### References
- Story ACs (verbatim): [Source: _bmad-output/planning-artifacts/epics.md#Story-2.3 L272-288]
- RenderPort / one-way / placeholder-first / asset manifest: [Source: architecture.md#Frontend Architecture L192-201]
- R1–R5 (esp. R5 RenderPort one-way; R2 purity Layer-0 only; R4 SDK isolation): [Source: architecture.md#Implementation Patterns L224-241; #Enforcement L285-292]
- Directory homes for render/: [Source: architecture.md#Complete Project Directory Structure L359-362]
- `BattleState` shape (the snapshot rendered): [Source: src/schema/battle-timeline.ts L29-45]
- Playback reducer (consumed): [Source: src/model/playback.ts L37-157; 2-2 story L26-130]
- `foldBattleState` / `initialBattleState` (the fold the snapshot comes from): [Source: src/model/battle-model.ts L39-133]
- Asset manifest field in the bundle: [Source: src/schema/replay-bundle.ts L22-25]
- Phaser 4.0.0 HEADLESS behavior (verified from installed source): [Source: node_modules/phaser/dist/phaser.esm.js L16508-16517, L17369-17372, L18057-18089]
- ESLint R5 zone (phaser allowed in render/ + game/): [Source: eslint.config.ts L24-27, L102-108]
- Template scenes/bootstrap to repoint: [Source: src/game/main.ts L10-29; src/game/scenes/Game.ts; src/main.ts; index.html (#game-container)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMAD dev-story workflow, autonomous single-pass).

### Debug Log References

The headless Phaser boot smoke required three jsdom gaps to be bridged (all verified from
node_modules/phaser/dist/phaser.esm.js, not guessed) — none weaken the test:

1. `pnpm`/store version mismatch: the project's `node_modules` was linked with pnpm 11.6.0 but the
   PATH pnpm is 10.10.0 (mise). Installing `jsdom` (the dependency Task 7 anticipates) required
   `corepack pnpm@11.6.0 add -D jsdom` to match the store.
2. Phaser 4.0.0's ESM build has **NO default export** (only named exports — verified at
   `phaser.esm.js` L264443 `export { ... Scene, HEADLESS, Core, Game ... }`). The ATDD scaffold and a
   first draft of the source used `import Phaser from 'phaser'`, which resolves to `undefined` and
   throws "Cannot read properties of undefined (reading 'Scene')". Fixed source + the ATDD test to
   `import * as Phaser from 'phaser'` (documented justification in the test header).
3. Phaser's boot stalls under jsdom because (a) `CanvasFeatures.checkInverseAlpha` (L24538) calls
   `getContext('2d')` which jsdom returns `null` for, and (b) the Texture Manager only fires `READY`
   (which gates `postBoot`) once its 3 default textures load via `new Image(); img.src=<dataURI>`
   firing `onload` — jsdom never fires it, so `_pending` sticks at 3 and the boot never completes
   (observed as a 20s test timeout). Bridged with a guarded `vitest.setup.canvas2d.ts` that (a)
   installs an inert 2D-context stub and (b) makes `HTMLImageElement.src=` fire `onload` on a
   microtask with a sane 1×1 intrinsic size. Firing `onerror` instead was tried and rejected (it
   left `__WHITE` missing, which then threw in `texturesReady` building its internal stamp/tileSprite).
   The stub is a NO-OP in the node env, so the pure render-model/render-port tests are untouched.

### Completion Notes List

**What was implemented (Story 2.3 — the first renderer story, FR-7/R5):**
- `src/render/render-port.ts` — the one-way `RenderPort` interface (no phaser; `BattleState` type-only).
- `src/render/render-model.ts` — the PURE `toRenderModel(snapshot, layout)` mapping + `RenderModel`/
  `RenderEntity`/`EntityKind` types + `RenderLayout`/`DEFAULT_LAYOUT` (no phaser). This is the bulk of
  the gate-provable surface.
- `src/render/phaser/placeholder-textures.ts` — `generatePlaceholderTextures` (colored rects via
  `Graphics.generateTexture`, guarded for headless) + `DEFAULT_ASSET_MANIFEST` (the swap seam).
- `src/render/phaser/arena-scene.ts` — `ArenaScene` (key `'Arena'`): creates the Forgemaiden + Boss +
  1 Minion + Forgemaiden/Boss health bars + the Insight Gauge ONCE in `create()`; `applySnapshot`
  mutates them in place. Degrades to colored `Rectangle`s when a texture is absent (headless fallback).
- `src/render/phaser/phaser-render-adapter.ts` — `PhaserRenderAdapter implements RenderPort`; owns the
  `Phaser.Game`, forwards `render(snapshot)` to the live scene's `applySnapshot`, buffers a snapshot
  arriving during async boot. No Phaser type on its public surface.
- `src/render/arena-boot.ts` — derives a real `BattleTimeline` from the committed fixtures (Vite
  `?raw` imports, browser-safe), builds `createPlaybackReducer`/`initialPlaybackState`, renders t=0,
  and pumps `tick` on a minimal rAF loop (NOT the Story 2.5 controls UI).
- `src/main.ts` — repointed the browser entry to `startArena('game-container')` (the template demo
  `Game` scene is detached but left in place; R4-clean — no `@anthropic-ai/sdk` on this path).

**What the GATE proved (automated, headless):**
- TYPECHECK clean; LINT clean (R1/R4/R5 hold — phaser confined to `src/render/**`+`src/game/**`,
  `render-port.ts`/`render-model.ts` import no phaser).
- TEST: full suite green. At dev-story (pre-review): 31 files / 334 tests (was 28 / 310; +3 files,
  +24 render tests, no regressions). After fix round 1 (F2 added a HEADLESS adapter test): **32 files
  / 339 tests** (+1 file, +5 tests). (F5 correction: the ORIGINAL Notes claimed "31 files / 331 tests
  (+16)" and "render-model.test.ts (12)" — both wrong; the real dev-story totals are 334 / render-model
  15. The dev-story render/ tests were 3 files / 24 tests: render-model 15 + render-port 5 +
  arena-scene 4. Fix round 1 makes render/ 4 files / 29 tests with the new adapter test.)
  - `render-model.test.ts` (15) — the pure mapping: Forgemaiden/Boss `hpFraction===1` at t=0, ≥1
    minion, gauge 0 + victory false at t=0; at the real fixture END Boss `hpFraction===0` + victory
    true + Forgemaiden 87/100; gauge tracks `insightGauge/maxGauge`; pure (deep-equal, no mutation);
    clamp `[0,1]`; the non-positive/NaN-max fail-closed branch; the Boss-enemy-absent fallback.
  - `render-port.test.ts` (5) — the one-way contract via `FakeRenderAdapter`: every rendered snapshot
    equals `foldBattleState(tl, cursor)` (play-to-end + a seek), `render` returns void, the adapter
    cannot mutate reducer/snapshot/timeline.
  - `arena-scene.test.ts` (4) — the headless `Phaser.HEADLESS` boot smoke: boots without throwing,
    the scene creates Forgemaiden+Boss+≥1 Minion, Forgemaiden/Boss health bars + the Insight Gauge
    widget exist, and `applySnapshot(victory)` updates the Boss-bar fraction 1→0.
- BUILD: `pnpm build` succeeds; the arena is in the browser bundle (`dist/assets/index-*.js`); R4 holds
  — `grep -ril anthropic dist/` finds nothing.

**What needs OPERATOR eyes (NOT gate-verified — be honest):** AC2's VISUAL claim. The headless gate
proves the game objects are created and the model math is correct, but it CANNOT prove the arena
*looks right*: that the Forgemaiden/Boss/Minion placeholder rects are legible and correctly placed on
the 1024×768 stage, that the health bars + Insight Gauge are visibly drawn. Run `pnpm dev` and look at
the screen to confirm AC2's appearance. Under `Phaser.HEADLESS` nothing rasterizes to pixels, so
colors/layout/legibility are out of automated scope (architecture.md "Renderer excluded from
determinism tests — timeline-level, not pixel-level").

> **Fix round 1 (F2) — adapter/boot now gate-covered, AND a real readiness defect fixed.** The
> dev-story Notes claimed the adapter's buffer-during-boot behavior as implemented but no test
> exercised `PhaserRenderAdapter`/`startArena` (only the SCENE smoke ran). Adding a HEADLESS adapter
> test (`phaser-render-adapter.test.ts`, renderer type injected via a new ctor arg) surfaced a genuine
> bug: the adapter set `ready=true` from a one-shot `Scenes.Events.CREATE` listener attached in
> `postBoot`, but Phaser runs the scene's `create()` (via the bootQueue on `GameEvents.READY`) BEFORE
> `postBoot`, so CREATE had already fired and the listener never ran — `ready` stuck `false`, every
> `render()` buffered into `pending` forever, and **playback never reached the arena** (only the static
> t=0 cast drawn in `create()` showed). Fixed at root cause: `postBoot` now marks ready immediately via
> `game.scene.isActive('Arena')` (already RUNNING by then) with the CREATE listener kept as a fallback.
> The new test proves the pending snapshot is flushed (Boss bar 1→0) and that `init()` is idempotent.
> The adapter buffer/flush/idempotency + the render()-before-init() guard (F3) are now gate-covered;
> only AC2's pixel *appearance* remains operator-only.

**Dependencies added (both anticipated by Task 7's headless-smoke requirement):** `jsdom@^29.1.1`
(the per-file `// @vitest-environment jsdom` framework dep the smoke needs). `canvas` (node-canvas) was
trialed as the "proper" jsdom companion but its native binary cannot be built in this environment
(build scripts blocked / no prebuilt for this Node), so it was removed in favor of the lightweight
guarded DOM stub in `vitest.setup.canvas2d.ts`. No runtime/browser dependency was added.

### File List

**New (source):**
- `src/render/render-port.ts`
- `src/render/render-model.ts`
- `src/render/phaser/placeholder-textures.ts`
- `src/render/phaser/arena-scene.ts`
- `src/render/phaser/phaser-render-adapter.ts`
- `src/render/arena-boot.ts`

**New (tests — authored by the ATDD phase, made green here; unchanged except the documented import fix to arena-scene.test.ts):**
- `src/render/render-model.test.ts`
- `src/render/render-port.test.ts`
- `src/render/phaser/arena-scene.test.ts`

**New (tests — fix round 1):**
- `src/render/phaser/phaser-render-adapter.test.ts` — HEADLESS adapter test (F2): pending-buffer flush,
  render-direct-when-ready, `init()` idempotency, render()-before-init() guard (F3), destroy→re-init.

**New (test infra):**
- `vitest.setup.canvas2d.ts` — guarded jsdom DOM-API stubs for the headless Phaser boot smoke.

**Modified (dev-story):**
- `src/main.ts` — browser entry repointed to the Arena boot.
- `vitest.config.ts` — registered `setupFiles: ['./vitest.setup.canvas2d.ts']`.
- `package.json` / `pnpm-lock.yaml` — added `jsdom` devDependency.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `2-3` ready-for-dev → in-progress → review.

**Modified (fix round 1):**
- `src/render/phaser/phaser-render-adapter.ts` — F2/F3: injectable `rendererType` ctor arg; FIXED the
  `ready` readiness wiring (mark ready via `scene.isActive` at postBoot, CREATE as fallback) so the
  pending flush runs and playback drives the arena; render()-before-init() no-op-with-warn; `isReady()`
  + `sceneForTest()` test introspection.
- `src/render/render-model.ts` — F4: `DEFAULT_LAYOUT.bossId`/`max*` derived from `MODEL_TUNING` instead
  of hardcoded `'boss'`/`100`.
- `src/render/phaser/arena-scene.ts` — F4: `create()` seeds the cast from `initialBattleState()` instead
  of an inlined t=0 literal; removed the unused `makeInitialSnapshot()`.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `2-3` review → done (senior-review fix round 1).

## Change Log

- 2026-06-14 — Story 2.3 implemented (dev-story). Added the one-way `RenderPort` seam (`render-port.ts`),
  the pure `toRenderModel` view-model (`render-model.ts`), the Phaser placeholder textures/arena
  scene/adapter (`render/phaser/`), and the fixture-driven boot (`arena-boot.ts`) wired into `src/main.ts`.
  Added `jsdom` + a guarded canvas/Image DOM stub for the headless Phaser boot smoke. All gates green:
  typecheck, lint (R1/R4/R5), test (31 files / 334 tests), build (arena bundled, R4 clean). AC1 + the
  testable half of AC2 are gate-verified; AC2's visual appearance is operator-verified (`pnpm dev`).
  Status: ready-for-dev → in-progress → review.
- 2026-06-14 — Senior-review fix round 1 (F1–F8). Fixed a REAL adapter readiness defect found while
  adding the F2 coverage: the postBoot one-shot CREATE listener attached after Phaser had already run
  `create()`, so `ready` stuck false, `render()` buffered forever and playback never drove the arena —
  now marks ready via `scene.isActive` at postBoot (CREATE fallback). F3: render()-before-init() no-ops
  with a warn. F4: `DEFAULT_LAYOUT.max*`/`bossId` + the scene's t=0 seed now derive from `MODEL_TUNING`/
  `initialBattleState()` instead of hardcoded literals. F5: corrected the test-count evidence
  (dev-story 334, not 331). Added `phaser-render-adapter.test.ts` (HEADLESS adapter test). F1/F6/F7/F8
  refuted (F1 disproven against Phaser 4.0.0 source + a live single-create diagnostic). All gates green:
  typecheck, lint (R1/R4/R5 unchanged — NOT relaxed), test (32 files / 339 tests), build (R4 clean).
  Status: review → done.

## Senior Developer Review (AI)

**Reviewer:** Andres Felipe Grisales (AI-assisted adversarial review — 3 hunter layers + acceptance auditor, synthesized & verified against code/Phaser source)
**Date:** 2026-06-14
**Outcome:** Approve with minor follow-ups (no blockers)

**Overall verdict:** AC1 (one-way RenderPort, Phaser confined to render/) and the testable half of AC2 are gate-verified (lint R1/R4/R5 intact, typecheck clean, 334 tests pass); remaining findings are low-severity polish/honesty items — the headlined "double-start" defect is a false positive.

### AC summary
- **AC1 — PASS.** `render-port.ts` is phaser-free, type-only `BattleState`, `render()→void` (documented one-way). `render-port.test.ts` (FakeRenderAdapter) proves every received snapshot == `foldBattleState`, `render` returns void, reducer/snapshot/timeline byte-unmutated. Non-render phaser-import grep over `src/` is empty; eslint R5 zone (`eslint.config.ts`) unchanged/NOT relaxed; lint+typecheck exit 0.
- **AC2 — PASS (testable half); VISUAL operator-verified.** `render-model.ts` emits forgemaiden+boss+≥1 minion, clamped fractions, gauge fraction; `arena-scene.test.ts` boots real `Phaser.HEADLESS` and asserts cast + forgemaiden/boss bars + gauge created and boss bar 1→0. `DEFAULT_ASSET_MANIFEST` is the placeholder-first swap seam (Graphics rects only, no real art loaded). Visual appearance correctly flagged operator-only (story L229-235) — not claimed by the gate.

### Findings

| id | sev | recommendation | location | why |
|----|-----|----------------|----------|-----|
| F1 | low | **likely-refute** | `src/render/phaser/phaser-render-adapter.ts:35-59` | "Adapter double-starts the Arena scene (auto-start + explicit `scene.start`), re-running create()." **REFUTED against Phaser 4.0.0 source.** `SceneManager.start` (phaser.esm.js L213349) takes the `if (!this.isBooted)` branch (L213352) at the synchronous `this.game.scene.start('Arena', {manifest})` call, because the Game boots asynchronously (`DOMContentLoaded(this.boot)` L17879; SceneManager `bootQueue` waits on `GameEvents.READY` L212330, gated on Texture READY L17917). At that instant the scene is NOT RUNNING, so the shutdown+restart branch (L213382-389) the hunters cited is unreachable — `start` merely sets the holding-pattern `_data['Arena']={autoStart:true,data:{manifest}}`. create() runs EXACTLY ONCE and the manifest reaches `init()`. No leak, no double create. Raised by Blind Hunter (low) + Edge/Boundary (med). |
| F2 | low | consider | `src/render/phaser/phaser-render-adapter.ts:33-59` + `src/render/arena-boot.ts` | Adapter (`type:Phaser.AUTO`) + boot (`startArena` rAF loop) are imported by NO test — confirmed: the only Phaser test boots the SCENE via `Phaser.HEADLESS`. So the adapter's pending-buffer / postBoot→CREATE flush / idempotency and the boot's `deriveTimeline`/loop are operator-verified only. Completion Notes assert the buffer-during-boot behavior as implemented without gate proof. Add an injectable-`type` HEADLESS adapter test, or explicitly label adapter+boot operator-verified in the Notes. Raised by Edge/Boundary (med); downgraded to low — behavior is sound, this is coverage/honesty, not a defect. |
| F3 | low | consider | `src/render/phaser/phaser-render-adapter.ts:64-71` | `render()` before `init()` buffers to `pending` but the game never boots, so the flush never runs and the snapshot is silently dropped. Unreachable today (`startArena` always calls `init()` first), but the RenderPort contract permits render-any-time, making this a latent fail-silent path. Cheap guard: no-op-with-warn (or buffer-and-flush-on-next-init) when `this.game` is null. Raised by Edge/Boundary (low). |
| F4 | low | consider | `src/render/render-model.ts:53-61` + `src/render/phaser/arena-scene.ts:121-130` | `DEFAULT_LAYOUT.max*` and `makeInitialSnapshot()` hardcode `100`, manually mirroring `src/config/model-tuning.json`. Verified the values CURRENTLY match tuning (`initial.problemIntegrity/resolve=100`, `insight.maxGauge=100`) — no live defect — but the mirror is by hand: if tuning changes (NFR-4 operator-adjustable), the t=0 cast and bar maxima mis-scale silently. Derive from `MODEL_TUNING` (render→model import is allowed) or seed from `initialBattleState()`. Raised by Blind Hunter + Edge/Boundary (low). |
| F5 | low | **fix** | `_bmad-output/implementation-artifacts/2-3-render-arena-renderport.md:215-225` (+ L273 Change Log) | Completion Notes claim "31 files / 331 tests (+16)" and "render-model.test.ts (12)". Verified actual `pnpm test` = **31 files / 334 tests**; per-file is render-model 15, render-port 5, arena-scene 4. Over-delivery, not a regression, but the gate-evidence numbers must be truthful. Update counts to 334 and reconcile the per-file/+delta. Raised by all three layers. |
| F6 | low | likely-refute | `vitest.setup.canvas2d.ts:60-108` | Global `HTMLImageElement.prototype.src` / `getContext` monkeypatch is broad. Verified it is correctly guarded (`typeof HTMLCanvasElement/HTMLImageElement !== 'undefined'`) — a NO-OP in the node env, so the pure render-model/render-port tests are untouched, and only one jsdom test exists today. No current or imminent defect; it is a documented, necessary shim for Phaser's module-load 2D-context touch and texture-READY gating. Latent caution (a future jsdom test relying on real image-load semantics would be masked) but nothing to fix now. Raised by Blind Hunter (low). |
| F7 | low | likely-refute | `src/render/phaser/arena-scene.test.ts:75-96` | jsdom "getContext not implemented" + Phaser "Texture key already in use" warnings print during the 4 HEADLESS boots. Tests pass; cosmetic stderr by design (real HEADLESS game per boot). No defect — optional polish only (suppress/note in Debug Log). Raised by Acceptance Auditor (low). |
| F8 | low | likely-refute | `src/render/phaser/arena-scene.ts:92` | `model.victory` is computed but intentionally not drawn ("held-victory frame is Story 2.4"). Correct, documented scope deferral — the auditor itself states no change needed. Not a bug. Raised by Acceptance Auditor (low). |

**Triage note (autonomous run):** F2/F3/F4 → "consider" (auto-fixable, low-risk improvements); F5 → "fix" (doc-only truth correction). F1/F6/F7/F8 → "likely-refute" (F1 disproven against Phaser source; F6/F7/F8 are correct-by-design with no defect). Status and commit left unchanged per review instructions.

**Resolution (fix round 1 — see "### Review Follow-ups (AI)" above for detail):**
- **F2 — RESOLVED (fixed + tested).** Added `phaser-render-adapter.test.ts` (HEADLESS). It exposed a
  REAL readiness bug (the postBoot one-shot CREATE listener attached after `create()` had already run,
  so `ready` stuck false and playback never reached the arena) — fixed at root cause via
  `scene.isActive` at postBoot. Not merely a coverage/honesty item after all.
- **F3 — RESOLVED (fixed + tested).** `render()` before `init()` now no-ops with a `console.warn`.
- **F4 — RESOLVED (fixed).** `DEFAULT_LAYOUT.max*`/`bossId` derive from `MODEL_TUNING`; the scene seeds
  from `initialBattleState()`; `makeInitialSnapshot()` removed.
- **F5 — RESOLVED (fixed).** Completion Notes + Change Log test counts corrected (dev-story 334, not 331).
- **F1 — REFUTED (confirmed).** No code change. Disproven against Phaser 4.0.0 source AND a live
  single-create diagnostic (one RUNNING Arena scene at postBoot; `create()` runs once).
- **F6, F7, F8 — REFUTED (confirmed).** No code change. F6: the canvas2d shim is correctly node-guarded
  (NO-OP outside jsdom). F7: HEADLESS-boot stderr warnings are cosmetic-by-design. F8: `model.victory`
  not-drawn is the documented Story 2.4 deferral.
