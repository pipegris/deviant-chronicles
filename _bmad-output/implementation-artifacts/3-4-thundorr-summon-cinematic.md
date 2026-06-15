---
baseline_commit: ce5292e
---

# Story 3.4: THUNDORR summon cinematic

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a viewer,
I want the THUNDORR summon to play as a distinct full-scene cinematic,
so that the breakthrough lands as the emotional peak of the demo. (FR-8)

## Acceptance Criteria

(Verbatim from `_bmad-output/planning-artifacts/epics.md#Story-3.4`, under "### Story 3.4: THUNDORR summon cinematic".)

1. **Given** a triggered Eidolon Summon **When** the cinematic plays **Then** it is a distinct full-scene set-piece (time-freeze cutaway → colossal blow → departure) that returns cleanly to the arena state.
2. **Given** a first-time viewer **When** they watch the summon **Then** the beat is legible without prior explanation, and frame pacing holds through the cinematic (no perceptible jank, NFR-1).

### What the gate CAN prove vs what is OPERATOR-verified (READ THIS — the split is load-bearing, like 2.3-2.5 / 3.1 / 3.3)

This story is split exactly like Stories 2.4 and 3.3: a **PURE state machine** (fully gate-provable) + a **THIN Phaser cinematic consumer** (the spectacle is operator-verified). Do NOT claim the pixels / the "emotional peak" / 60fps are proven by the headless gate.

**Gate-PROVABLE (typecheck / lint / test / build) — the bulk of the surface:**
- **The cinematic STATE MACHINE transitions** in order: `idle → cutaway → blow → depart → done`. A PURE `summon-cinematic.ts` (ZERO Phaser, node env, mirrors `animation-plan.ts` / `beat-behavior.ts`) advances on a `tick(elapsedMs)` (or a phase-advance call) and never skips/reorders a phase; the total duration is the sum of the four phase durations; an out-of-range elapsed clamps to `done`. Determinism: same `(state, elapsed)` → deep-equal next state.
- **The TRIGGER fires on the summon intent.** The cinematic is started when `ArenaScene.playBeatBehaviors` receives an `{ target: 'eidolon', behavior: 'summon' }` `BeatBehaviorIntent` (the intent Story 3.3's `planBeatBehaviors` ALREADY emits on a `summon`-tagged charged-gauge breakthrough — AC3). Proven by a unit test: feeding that intent list arms/plays the cinematic; a behavior list WITHOUT a `summon` intent does NOT.
- **CLEAN RETURN (R1: restore, don't recompute).** Post-cinematic the arena shows the **correct `BattleState` for the cursor** and playback resumes uninterrupted. The cinematic captures the `next` `BattleState` snapshot handed to it and, on `done`, re-applies it via the existing SNAP path (`applySnapshot`) — it NEVER recomputes mechanics. Proven structurally (the cinematic returns/holds no recomputed `BattleState`; it re-uses the snapshot it was given, which is `foldBattleState(timeline, cursor)` truth) + a boot test that, after the breakthrough transition, the arena's displayed snapshot deep-equals the reducer's `state.battleState`.
- **A headless boot SMOKE that the cinematic scene/runner instantiates and plays without throwing** under `Phaser.HEADLESS` (the sibling of `arena-behavior.test.ts`): driving the summon intent through the real `ArenaScene` runs the cinematic to `done` and the cast survives (fail-closed; never throws).
- **The DEV-PREVIEW hook is dev-only and never touches the committed fixture path.** The `?cinematic=summon` URL flag (read in `main.ts`, guarded by `import.meta.env.DEV`) calls an exported dev hook on the `ArenaHandle` that plays the cinematic on demand. Proven by: a unit test that the dev hook plays the cinematic with NO summon annotation injected into the `FixtureInterpreter`/overlay (the production overlay is unchanged); and `grep` that the production fixture/overlay path emits no `summon` (the committed `FixtureInterpreter` still has only `dispel` + `shaman`).
- **R1/R5 hold**: the cinematic reads `BattleState`/intents and writes NEITHER a `BattleState` NOR a mechanics field; Phaser stays confined to `render/phaser/` (the pure `summon-cinematic.ts` state machine is Phaser-free). **`grep -ril anthropic dist/` = NOTHING** (R4 — the cinematic + dev hook are SDK-free). **Both golden snapshots byte-UNCHANGED** (this story adds NO Layer-0 code).

**OPERATOR-verified (NOT a gate — watch `pnpm dev?cinematic=summon`):** that the cinematic READS as a distinct full-scene set-piece (time-freeze cutaway → colossal blow → departure); that a first-time viewer finds the beat legible without explanation (AC2 legibility); that frame pacing holds with no perceptible jank at ~60fps (NFR-1). The headless gate proves the SEQUENCE, the TRIGGER, the CLEAN RETURN, and the no-throw RUN — it does NOT prove the spectacle, legibility, or framerate (jsdom draws nothing and does not advance Phaser tweens/timers — the SAME documented limitation as `arena-animation.test.ts` L23-28 / `arena-behavior.test.ts` L29-31).

**Honest reachability gap (inherited from Story 3.3 — the fixture is a thin redacted dev slice):**
- The committed `FixtureInterpreter` **omits `summon` by design** (Story 3.1 — there is no groundable sub-agent-spawn event in the thin slice). So in the committed dev fixture the PRODUCTION summon intent **never fires**, and the cinematic would be invisible until the full bundle (Epic 5). That is EXACTLY why this story adds the **DEV-ONLY preview trigger** (`?cinematic=summon`) so the operator can watch + verify the cinematic NOW, without faking a summon into the production/committed fixture path. The summon-intent → cinematic wiring's POSITIVE branch is therefore unit-proven on a hand-built `summon` `BeatBehaviorIntent` (the SAME posture Story 3.3 used for the summon behavior's positive branch, and 2.4 used for the Hammer-Flurry positive branch).

[Source: epics.md#Story-3.4 (the verbatim ACs, FR-8 + NFR-1); architecture.md#R1 L225-228, #R5 L239-241, #Anti-Patterns L294-299; 3-3 story §"What the gate CAN prove" (the honest-split + the unreachable-positive-branch precedent); 2-4 story §"What the gate CAN prove"; src/render/beat-behavior.ts L193-206 (the `eidolon`/`summon` intent this story consumes as the production trigger); src/render/phaser/arena-behavior.test.ts (the headless-smoke pattern to sibling); src/model/playback.ts L96-113 (the path-independent `foldBattleState` re-derive that IS the clean-return guarantee)]

## Tasks / Subtasks

- [x] **Task 1 — `src/render/summon-cinematic.ts`: the PURE, testable cinematic STATE MACHINE (Phaser-free)** (AC: #1)
  - [x] Export a string-literal-union phase type + a pure machine, mirroring the established pure-layer posture of `animation-plan.ts` / `beat-behavior.ts` (ZERO Phaser, node-testable, deterministic, no `Date.now`/`Math.random`/`performance.now`/IO/module-mutable state). Concretely:
    - `export type SummonCinematicPhase = 'idle' | 'cutaway' | 'blow' | 'depart' | 'done';` (string-literal union — NO numeric/native enum, project convention). The four active phases dramatize AC1's sequence: **cutaway** = the time-freeze cutaway, **blow** = the colossal blow, **depart** = THUNDORR's departure, **done** = returned (the terminal). `idle` is the pre-start resting phase.
    - A plain `type SummonCinematicState = { phase: SummonCinematicPhase; elapsedMs: number }` (transient view state — plain `type`, NOT Zod, the `AnimationIntent`/`PlaybackState` precedent).
    - Per-phase durations as named `const X_MS` (render-side presentation timings — the `animation-plan.ts` const-durations precedent; placeholder values, retimed by the operator). e.g. `CUTAWAY_MS`, `BLOW_MS`, `DEPART_MS`. Export a `SUMMON_CINEMATIC_TOTAL_MS` = their sum so the runner + tests share ONE source of truth.
    - A pure `initialSummonState(): SummonCinematicState` = `{ phase: 'idle', elapsedMs: 0 }` (fresh per call — no shared mutable state).
    - A pure `startSummon(): SummonCinematicState` = `{ phase: 'cutaway', elapsedMs: 0 }` (enter the first active phase).
    - A pure `advanceSummon(state, deltaMs): SummonCinematicState` that accumulates elapsed and maps cumulative elapsed → the phase by the documented thresholds (`elapsed < CUTAWAY_MS → cutaway`; `< CUTAWAY_MS+BLOW_MS → blow`; `< total → depart`; `>= total → done`). `idle` and `done` are absorbing for `advance` from `idle` (advancing from `idle` stays `idle` — you must `startSummon` first); once `done`, further advances stay `done` (clamp). Deterministic + mutates neither input.
  - [x] **Why a pure state machine SEPARABLE from the Phaser tweens (the load-bearing decision — see Dev Notes §"Why the cinematic is a pure state machine").** The story REQUIRES "a TESTABLE cinematic state machine separable from the Phaser visuals". A Phaser `Timeline`/tween chain is NOT unit-testable in jsdom (jsdom does not advance Phaser timers/tweens — the documented `arena-animation.test.ts` L23-28 limitation), so the SEQUENCE (AC1's cutaway→blow→depart→done) and the CLEAN RETURN would be operator-only. Extracting the phase ordering + thresholds into a pure function makes the sequence + the terminal (which drives the clean return) GATE-PROVABLE, exactly as `beat-behavior.ts`/`animation-plan.ts` made their decisions gate-provable while the tweens stayed operator-verified. The Phaser consumer (Task 3) DRIVES its tweens FROM this machine's phase. [Source: story-specific guidance "a TESTABLE cinematic state machine separable from the Phaser visuals"; src/render/animation-plan.ts L13-19; src/render/beat-behavior.ts L8-24 (the pure-layer posture); src/render/phaser/arena-animation.test.ts L23-28 (jsdom does not advance tweens)]
  - [x] **R1-clean (structural).** `summon-cinematic.ts` imports NO Layer-0 module it could mutate, reads NO `BattleState`, and returns ONLY `SummonCinematicState` — it is a presentation timeline, not mechanics. It does NOT compute the breakthrough's Problem-Integrity damage (that already landed in Layer-0, `battle-model.ts` L85-90); it only sequences the DRAMATIZATION. Keep it import-light (it needs no `schema/`, no `model/`, no `interpret/` — it is a self-contained timeline). [Source: architecture.md#R1 L225-228; src/render/beat-behavior.ts L16-24 (the "writes ONLY intents, never a BattleState" structural R1 proof to mirror)]

- [x] **Task 2 — Decide + record the CLEAN-RETURN mechanism (R1: restore, do NOT recompute)** (AC: #1)
  - [x] **This is a DESIGN task, realized in Task 3's wiring — record the decision in Dev Notes §"Clean return: restore the reducer's snapshot, never recompute".** AC1's "returns cleanly to the arena state" + the story-specific R1 ("'returns cleanly' means it RESTORES/RESUMES the existing `BattleState`, does not recompute mechanics") resolve to ONE mechanism the codebase already guarantees:
    - The playback reducer is the SINGLE source of truth for `BattleState`: `withCursor` ALWAYS re-derives `battleState = foldBattleState(timeline, cursor)` path-independently (`playback.ts` L103-113) — this is the proven SCRUB==PLAY guarantee (Story 2.2). The cinematic NEVER constructs or mutates a `BattleState`.
    - On the breakthrough forward tick, the boot already computes `next = state.battleState` (the reducer's truth for the new cursor) and hands it to the behavior path. The cinematic CAPTURES that `next` snapshot. When the cinematic reaches `done`, the Phaser consumer re-applies that SAME captured snapshot via the existing SNAP path (`scene.applySnapshot(next)` / `adapter.render(next)`) — guaranteeing the post-cinematic arena shows the correct `BattleState` for the cursor. No recompute, no second fold, no drift.
  - [x] **Decide how playback ADVANCE interacts with the cinematic (record it).** The cinematic plays over a span of wall-clock while the rest of the battle should not keep ticking "behind" it (it is a full-scene cutaway). Two documented-merit options — pick ONE and record the rationale:
    - **(A) Suspend-advance-during-cinematic (RECOMMENDED, surgical):** while the cinematic is active (`phase !== 'idle' && phase !== 'done'`), `advanceIfPlaying` skips the reducer `tick` (the boot already early-returns when `status !== 'playing'`; add an analogous "cinematic active" guard so no new transition starts mid-cutaway). The `status`/`cursor`/reducer state are UNTOUCHED (paused-in-place semantics), so on `done` playback resumes from the exact cursor the breakthrough landed on — the reducer state never moved, so "resume" is trivially clean. This keeps the reducer PURE/untouched (no new action) and reuses the Story 2.5 status-gated loop. The cinematic owns only render-side wall-clock (the `summon-cinematic` advance), exactly like the rAF loop owns the playback wall-clock.
    - **(B) Auto-pause via a dispatched `pause` then `play` on `done`:** dispatch `pause` when the cinematic starts and `play` on `done`. REJECTED for v0.1 unless A proves awkward: it churns the reducer state + the controls UI (the play/pause button would flicker), and "resume" then depends on re-dispatching `play` correctly — more moving parts than A for no benefit. (Note: the held-victory-frame / closing-Saga auto-pause is explicitly deferred to Story 4.2 per the 2-5 story; do NOT build a general auto-pause here.)
  - [x] **Record where the cinematic-active flag lives.** It is render-side transient state (like the rAF `rafId`): the boot closure (or the adapter/scene). It is NOT playback state (it never serializes, never affects the reducer). One-way: the cinematic pushes NOTHING back to the reducer/timeline (R5/AC1) — it only reads the snapshot it was given and, on `done`, snaps it. [Source: src/model/playback.ts L96-113 (the path-independent fold = the clean-return guarantee); src/render/arena-boot.ts L118-137 (the status-gated advanceIfPlaying to extend with a cinematic-active guard); story-specific guidance "R1: restore, don't recompute"; 2-5 story (auto-pause deferred to 4.2)]

- [x] **Task 3 — Wire the cinematic into the THIN Phaser consumer + the boot (additive to the Story 3.3 seam)** (AC: #1, #2)
  - [x] **Trigger the cinematic from the existing `summon` intent (NO new Layer-0 path, NO new RenderPort method needed).** Story 3.3's `planBeatBehaviors` ALREADY emits `{ target: 'eidolon', behavior: 'summon', durationMs }` + `{ target: 'eidolon', behavior: 'decisive-blow', durationMs }` on a `summon`-tagged charged-gauge breakthrough (`beat-behavior.ts` L193-206). The cinematic is the ELEVATION of the placeholder `summon`/`decisive-blow` tweens (`arena-scene.ts` L344-351) into a full-scene set-piece. In `ArenaScene.playBeatBehaviors` (or `runBehavior`), when a `summon` behavior intent is seen, START the cinematic (instead of / in addition to the current placeholder `flash`). The `decisive-blow` intent maps to the cinematic's `blow` phase visual. **Do NOT add a new RenderPort method** — the production trigger rides the existing `renderBeatBehaviors` seam (the summon intent is already on it). Record this in Dev Notes §"Trigger: the existing summon intent".
  - [x] **Build the THIN Phaser cinematic consumer.** The simplest shape that satisfies "distinct full-scene set-piece" on PLACEHOLDER art (real THUNDORR art is Story 5.3's manifest swap — a Graphics/Rectangle/tween set-piece here, NOT a sprite sheet). Decide + record the shape (Dev Notes §"The Phaser cinematic: a driven set-piece, not a Phaser Timeline"):
    - **RECOMMENDED:** a small `src/render/phaser/summon-cinematic-scene.ts` (or a method-cluster on `ArenaScene` if a separate scene proves heavy — pick on documented merits and record) that, given the captured `next` snapshot, plays the four phases driven BY the pure `summon-cinematic` machine: **cutaway** = a full-screen freeze overlay (a darkening rect over the arena — the `environmentOverlay` L449-459 precedent) signalling time-freeze; **blow** = a large Graphics flash/impact on the boss stand-in (reuse `flash`/`lunge`); **depart** = the overlay fades out and the colossus leaves (a fade/scale-out); **done** = re-apply the captured snapshot (the clean return) + clear the cinematic-active flag.
    - It MUST be FAIL-CLOSED: unavailable tween manager / missing display = a safe no-op (never throws), exactly `runIntent`/`runBehavior`'s posture (`arena-scene.ts` L261-304 / L314-355). Under `Phaser.HEADLESS` (jsdom) the phases must RUN without throwing even though no pixels draw and tweens do not advance — so the machine's phase ADVANCE must NOT depend on a tween `onComplete` (jsdom never fires it); drive the phase from the render-side rAF/`time` cadence (or expose a synchronous "advance to done" the smoke can call) so the SEQUENCE is gate-provable. Record the exact advance mechanism in Dev Notes.
  - [x] **The boot wires the cinematic-active guard + the clean-return snap.** Extend `arena-boot.ts`'s `advanceIfPlaying` (the SAME forward-tick path Story 3.3 extended): (1) before the reducer `tick`, if the cinematic is active, return early (Task 2 option A) so no new transition starts mid-cutaway; (2) the existing `renderBeatBehaviors` call already carries the summon intent to the scene, which starts the cinematic; (3) on the cinematic's `done`, the scene/consumer re-applies the captured snapshot (clean return). Keep the boot's rAF-cancel-on-destroy intact (do NOT regress Story 2.5's F1 fix — `destroy()` must still `cancelAnimationFrame`). Keep it ONE-WAY (nothing flows back upstream, R5/AC1). [Source: src/render/beat-behavior.ts L193-206 (the summon intent — the production trigger); src/render/phaser/arena-scene.ts L344-351 (the placeholder summon/decisive-blow to elevate), L449-459 (`environmentOverlay` — the full-screen overlay precedent), L261-304/L314-355 (the fail-closed runners); src/render/arena-boot.ts L118-137 (advanceIfPlaying to extend); src/render/phaser/phaser-render-adapter.ts L125-136 (renderBeatBehaviors forwarding); 2-5 story F1 (rAF-cancel-on-destroy must not regress)]
  - [x] **The DEV-ONLY preview trigger (`?cinematic=summon`) — so the cinematic is not invisible until the real bundle.** The committed `FixtureInterpreter` omits `summon` by design, so the PRODUCTION trigger never fires in the dev fixture. Add a dev-only on-demand play:
    - Export a dev hook on the `ArenaHandle` (e.g. `previewSummonCinematic(): void`) from `startArena` that plays the cinematic on demand over the CURRENT `state.battleState` snapshot (the clean return restores that same snapshot) — WITHOUT injecting any `summon` annotation into the `FixtureInterpreter`/overlay (the production overlay stays `dispel` + `shaman` only).
    - In `main.ts`, read the URL flag and call the hook, GUARDED by `import.meta.env.DEV` so it is dead-code-eliminated from the production build (Vite statically replaces `import.meta.env.DEV` with `false` in `build`, so the branch + the hook call tree-shake out). Use the existing browser URL API (`new URLSearchParams(window.location.search).get('cinematic') === 'summon'`). Record the choice (URL flag vs an exported hook — implement BOTH: the hook is the testable surface, the URL flag is the operator ergonomics) in Dev Notes §"Dev-only preview trigger".
    - **CRITICAL — do NOT fake a summon into the committed fixture path.** The dev preview plays the cinematic DIRECTLY (calling the consumer with the current snapshot); it does NOT add a `summon` `BeatAnnotation`, does NOT modify `fixture-interpreter.ts`, and does NOT alter the overlay the production path builds. The production trigger stays the real summon behavior intent. [Source: story-specific guidance "a DEV-ONLY preview trigger … WITHOUT injecting a fake summon into the production/committed fixture path"; src/interpret/fixture-interpreter.ts (dispel + shaman only — must stay unchanged); src/main.ts L1-9 (the browser entry to extend); src/render/arena-boot.ts L65-72 (the ArenaHandle to extend with the dev hook); Vite `import.meta.env.DEV` (build-time constant → dead-code elimination)]

- [x] **Task 4 — Tests: the gate-provable surface (pure machine + trigger + clean return + dev hook + headless smoke)** (AC: #1, #2)
  - [x] **`src/render/summon-cinematic.test.ts` — the PURE state machine (the bulk of AC1).** Node env (no jsdom needed — it is Phaser-free). Cover:
    - **Sequence:** from `startSummon()`, advancing by sub-phase deltas walks `cutaway → blow → depart → done` IN ORDER and NEVER skips/reorders a phase (assert the phase at elapsed just-below and just-above each threshold). The total to reach `done` equals `SUMMON_CINEMATIC_TOTAL_MS`.
    - **Clamp/absorbing:** `advanceSummon` from `idle` stays `idle` (must `startSummon` first); advancing past `done` stays `done`; a single huge delta clamps straight to `done`.
    - **Determinism + no-mutation:** `advanceSummon(s, d)` twice on the same inputs `toEqual`; the input `s` is unchanged after the call (snapshot `JSON.stringify(s)`).
    - **R1 at the data level:** the state object has ONLY `{ phase, elapsedMs }` — no `BattleState`, no `problemIntegrity`/`resolve`/`insightGauge`/`hp` key (structural proof the cinematic carries no mechanics).
  - [x] **`src/render/summon-trigger.test.ts` (or fold into the smoke) — the TRIGGER fires on the summon intent (AC1).** Prove the wiring contract WITHOUT Phaser where possible: feeding a `BeatBehaviorIntent[]` containing `{ target:'eidolon', behavior:'summon' }` arms/starts the cinematic; an intent list WITHOUT a summon intent does NOT. (If this can only be observed through the scene, assert it in the headless smoke below via a scene introspection method — e.g. `cinematicPhase()` — mirroring `lastPlayedIntents()`.) Document that the PRODUCTION positive branch (a real `summon`-tagged breakthrough) is unit-only because the committed fixture omits `summon` (the Story 3.3 / 2.4 honest-gap precedent).
  - [x] **`src/render/arena-boot-cinematic.test.ts` (jsdom) — CLEAN RETURN + the cinematic-active guard + dev hook + clean teardown (AC: #1, #2).** A NEW file (do NOT edit the green Story 2.5 / 3.3 boot tests). Reuse the verbatim `runIngest`/`timeline` jsdom harness + a recording fake (copy from `arena-boot-behavior.test.ts` L43-131). Cover:
    - **Clean return (the headline AC1 proof):** drive a hand-built summon scenario (the dev hook, OR a fake adapter whose `renderBeatBehaviors` records that a summon intent arrived) and assert that AFTER the cinematic the arena's last-applied snapshot deep-equals the reducer's `state.battleState` for the cursor (`foldBattleState(timeline, cursor)` truth) — proving restore, not recompute. Assert the reducer `state` (cursor/status) is UNCHANGED across the cinematic (option A: paused-in-place).
    - **Cinematic-active guard:** while the cinematic is active, `advanceIfPlaying` starts NO new reducer transition (the cursor does not advance mid-cutaway); after `done`, advance resumes.
    - **Dev hook:** `handle.previewSummonCinematic()` plays the cinematic and the production overlay was NOT mutated (assert the boot's overlay still has only `dispel` + `shaman`, no `summon`); the hook restores the current snapshot on done.
    - **No teardown regression (2.5 F1):** `destroy()` still cancels the rAF loop + tears down adapter/controls (reuse the `afterEach` destroy contract; do NOT regress).
  - [x] **`src/render/phaser/arena-cinematic.test.ts` — the headless Phaser SMOKE (gate-provable RUN, not pixels).** The sibling of `arena-behavior.test.ts` (copy the `bootArena` HEADLESS harness verbatim, L54-81). Prove: starting the cinematic via the summon intent (`scene.playBeatBehaviors([{target:'eidolon',behavior:'summon',...}])`) RUNS to `done` without throwing under `Phaser.HEADLESS`; the cast survives (`entityKinds()` still has forgemaiden/boss/minion — additive, not a silent skip); a synchronous "advance to done" (or the exposed phase introspection) reaches `phase==='done'` and the clean-return snap fires (the captured snapshot is re-applied). Record the VERIFICATION LIMITATION verbatim (jsdom draws nothing / does not advance tweens — the spectacle + 60fps + legibility are OPERATOR-verified). [Source: src/render/phaser/arena-behavior.test.ts L1-127 (the headless-smoke pattern + the documented jsdom limitation to mirror); src/render/arena-boot-behavior.test.ts L43-131 (the jsdom boot harness + recording-fake + the `runIngest`/`timeline` helpers to reuse); src/render/beat-behavior.test.ts L243-310 (the hand-built-summon UNIT-branch pattern for the fixture-omits-summon gap); src/model/playback.ts L96-113 (the `foldBattleState` truth the clean-return assertion compares against)]
  - [x] **Determinism / R1 greps (in the suite or the dev log).** A source-grep that `summon-cinematic.ts` contains no `@anthropic-ai/sdk`, no `phaser` import, no `Date.now`/`Math.random`/`performance.now`, and never assigns a `BattleState`/`problemIntegrity`/`resolve`/`insightGauge`/`hp` field (the R1/R4/R5/R2-posture proof for the new pure module). [Source: src/render/beat-behavior.test.ts (the R1 data-level assertions to mirror); architecture.md#R1/#R2/#R4/#R5]

- [x] **Task 5 — Gates green (the definition of done)** (AC: #1, #2)
  - [x] `pnpm typecheck` clean (strict — `noUnusedLocals`/`noUnusedParameters`/`noImplicitReturns`). `pnpm lint` clean — **R1/R4/R5 hold and MUST NOT be relaxed:** the new `render/summon-cinematic.ts` is a self-contained pure timeline (NO `@anthropic-ai/sdk`, NO `phaser`); the new Phaser cinematic consumer stays in `render/phaser/` (R5); the dev hook + `main.ts` flag import NO SDK. **Do NOT edit `eslint.config.ts` — fix the code if lint complains.** Use the `void _unused;` convention if a param is intentionally unused (the established codebase pattern). [Source: eslint.config.ts L48-108 (the committed R1/R4/R5 config — do NOT touch); architecture.md#R1/R4/R5 L225-241; PROJECT GATES "NEVER relax/disable these rules — fix the code instead"]
  - [x] `pnpm test` full suite green — every PRE-EXISTING test still passes (this story is ADDITIVE: new `summon-cinematic.ts` + the Phaser cinematic consumer + tests, plus a SURGICAL extension of `arena-scene.ts` / `arena-boot.ts` / `main.ts` for the trigger + dev hook + clean-return wiring). **Both Layer-0 golden snapshots MUST NOT change** — verify `git diff src/pace/__snapshots__/ src/ingest/__snapshots__/` is EMPTY (this story adds NO Layer-0 code and never regenerates the fixture). Report the new file/test counts (baseline at HEAD `ce5292e`: 55 files / 539 tests). [Source: src/pace/__snapshots__/*.snap + src/ingest/__snapshots__/ingest.test.ts.snap (the committed determinism anchors — byte-stable); 3-3 story Completion Notes (baseline 55/539); architecture.md#R2 L229-232]
  - [x] `pnpm build` succeeds (`vite build` → `dist/`). **`@anthropic-ai/sdk` must NEVER enter the browser bundle (R4):** `grep -ril anthropic dist/` finds NOTHING — the cinematic + the dev hook are SDK-free, and the `?cinematic=summon` dev branch tree-shakes out under `import.meta.env.DEV === false` in the production build. Confirm `interpret/` is still reached ONLY via the SDK-free `FixtureInterpreter` (Story 3.3's edge) — this story adds NO new `interpret/` import. [Source: architecture.md#R4 L236-238; src/interpret/fixture-interpreter.ts (SDK-free); 3-3 story Task 5 (the `grep -ril anthropic dist/` = NOTHING check); Vite `import.meta.env.DEV` dead-code elimination]

### Review Follow-ups (AI)

Fix round 1 (2026-06-15) — addressing the Senior Developer Review findings. Gates re-run green after fixes: typecheck 0, lint 0, `pnpm test` 59 files / 583 tests, `pnpm build` clean, `grep -ril anthropic dist/` = NOTHING, both golden snapshots byte-unchanged.

- [x] **[F1 — High] Boot `cinematicActive` never reset → dev-preview playback never resumes.** Root cause: the boot-owned flag was a SECOND source of truth, set-once-true and never cleared. Fix: the SCENE's cinematic machine is now the single source of truth — `advanceIfPlaying` polls `adapter.isCinematicActive()` each held-frame tick and clears the boot flag (then falls through to the normal forward tick) once the scene returns to rest. Added the optional read-only `RenderPort.isCinematicActive?()` query + its `PhaserRenderAdapter` impl (delegates to `ArenaScene.isCinematicActive()`). Regression guard: `arena-boot-cinematic.test.ts` "after the cinematic reaches done, advanceIfPlaying RESUMES the forward tick". [src/render/arena-boot.ts, render-port.ts, phaser/phaser-render-adapter.ts]
- [x] **[F2 — Med] Boot `cinematicActive` never SET on the production summon path.** Same root cause/fix: after `advanceIfPlaying` forwards the summon intent (which arms the SCENE cinematic), it reflects `sceneCinematicActive()` into the boot flag, so the next tick suspends the forward advance for a real summon too (Task 2 option A). The unified poll-the-scene fix covers both the dev hook and the production trigger. (Latent until Epic 5 — the committed fixture omits `summon` — so no shipped behavior changed; the suspend now engages when a real summon fires.) [src/render/arena-boot.ts]
- [x] **[F3 — Med] Clean return never restored boss alpha after `depart` faded it to 0.** Fix: the `done` clean return now calls `resetCinematicAlpha('boss')` BEFORE re-applying the snapshot — it kills the still-running no-yoyo fade tween and sets alpha back to 1 (fail-closed: no-op on a missing display / headless `killTweensOf`). `applySnapshot` restores position/bars but never alpha, so this is the missing reset. Regression guard: `arena-cinematic.test.ts` "the clean return RESTORES the boss stand-in alpha after the depart fade" (forces alpha 0 to simulate the jsdom-unrunnable fade, asserts `done` restores 1; confirmed it fails without the fix). Added the no-pixels `bossAlpha()` introspection. [src/render/phaser/arena-scene.ts]
- [x] **[F4 — Low] Resume half unproven (Task 4 "advance resumes after done" missing).** Fix: extended `arena-boot-cinematic.test.ts` with the resume assertion (the F1 regression guard above). The `RecordingCinematicAdapter` now models the scene's cinematic lifecycle (`previewSummonCinematic`/`isCinematicActive`/`finishCinematic`) so the suspend→done→resume cycle is exercisable headlessly. [src/render/arena-boot-cinematic.test.ts]
- [x] **[F5 — Consider] Near-tautological dev-hook clean-return assertion.** Fix (the "forward the dev-hook to a recordable scene-snap in the fake" option): `RecordingCinematicAdapter.finishCinematic()` re-applies the captured snapshot via `render()` (the scene-level clean return), so the clean-return test now drives the cinematic to done and `lastSnap()` reflects a GENUINE restore — it fails on a dropped clean-return snap rather than only asserting the boot's own baseline render. [src/render/arena-boot-cinematic.test.ts]
- [x] **[F6 — Low] Stale test counts.** Updated the Debug Log (579/+40 → the pre-fix 581/+42, now 583/+44 after the F3/F4 guards) and the Completion Note (unit file 8 → 9 tests). [this file]

## Dev Notes

### What this story IS (and is NOT)

- **IS:** the **THUNDORR summon CINEMATIC** (FR-8, NFR-1) — the demo's emotional peak. A distinct FULL-SCENE set-piece (time-freeze cutaway → colossal blow → departure → clean return) triggered by the Story 3.3 Eidolon-Summon behavior intent. Three deliverables: (1) `src/render/summon-cinematic.ts` = a PURE, testable cinematic STATE MACHINE (`idle → cutaway → blow → depart → done`), SEPARABLE from the Phaser visuals; (2) a THIN Phaser cinematic consumer (a driven set-piece on PLACEHOLDER art) that elevates Story 3.3's placeholder `summon`/`decisive-blow` tweens; (3) a DEV-ONLY preview trigger (`?cinematic=summon` + an exported dev hook) so the operator can watch it now (the committed fixture has no summon tag). Plus the surgical wiring (the trigger off the existing summon intent, the cinematic-active guard, the clean-return snap). [Source: epics.md#Story-3.4; story-specific guidance]
- **IS NOT:** a Layer-0 change, a new beat TAG, or a new interpreter. The breakthrough's Problem-Integrity damage, the gauge charge/discharge, and the victory latch ALREADY come from Layer-0 (`battle-model.ts`, Story 2.1) — this story does NOT recompute, mutate, or feed them. "Returns cleanly to the arena state" means it RESTORES/RESUMES the reducer's existing `BattleState` (`foldBattleState` truth), NOT recomputes it (R1). The `summon` tag + the summon intent are Story 3.1/3.3's; this story CONSUMES the intent. [Source: architecture.md#R1 L225-228, #Anti-Patterns L296; src/render/beat-behavior.ts L193-206; src/model/playback.ts L96-113]
- **IS NOT:** the Shaman swarm-clear cinematic OR the Dispel shatter cinematic — those are **Story 3.5** ("Fallen Shaman swarm-clear & Dispel shatter cinematics"). Build ONLY the THUNDORR summon cinematic here. The Shaman/Dispel placeholder behaviors (Story 3.3) stay as-is. [Source: epics.md#Story-3.5; story-specific guidance "Do NOT build the Shaman/Dispel cinematics (Story 3.5) here"]
- **IS NOT:** final art. PLACEHOLDER art only (Graphics-generated shapes/fx, reusing the existing cast + overlay precedents). Real THUNDORR art is **Story 5.3**, a manifest swap — the cinematic must work on placeholders and accept real art later with no structural change (the `assetManifest` seam, `placeholder-textures.ts`). [Source: story-specific guidance "Placeholder art only (real THUNDORR art is Story 5.3, a manifest swap)"; src/render/phaser/placeholder-textures.ts; src/render/phaser/arena-scene.ts L55-57 (the manifest seam)]

### Why the cinematic is a PURE state machine separable from the Phaser tweens (the testability decision)

The story explicitly requires "a TESTABLE cinematic state machine separable from the Phaser visuals". A naive implementation would chain Phaser tweens (`scene.tweens.chain(...)` / a Phaser `Timeline`) with `onComplete` callbacks advancing the spectacle. That would make the SEQUENCE (AC1's cutaway→blow→depart→done) and the CLEAN RETURN (which fires on the terminal `done`) **operator-only**, because jsdom does not advance Phaser timers/tweens (the documented `arena-animation.test.ts` L23-28 / `arena-behavior.test.ts` L29-31 limitation) — the gate could prove only "it did not throw", not "the phases ran in order and it returned cleanly".

Resolution (the established pattern in this codebase): extract the phase ORDERING + the phase thresholds into a PURE `summon-cinematic.ts` (`idle → cutaway → blow → depart → done`), the EXACT posture `animation-plan.ts` (the pure `planAnimations`) and `beat-behavior.ts` (the pure `planBeatBehaviors`) already hold — a pure decision/sequence layer that is node-testable, deterministic, and Phaser-free, with a THIN Phaser consumer that DRIVES its tweens from the machine's current phase. The gate then proves the SEQUENCE + the TRIGGER + the CLEAN RETURN (the terminal); the spectacle/legibility/60fps stay operator-verified. This is the literal "split gate-verifiable (sequence + clean return + trigger) from operator-verified (spectacle/60fps)" the story-specific guidance mandates. [Source: story-specific guidance "TESTABLE cinematic state machine separable from the Phaser visuals" + "Split gate-verifiable … from operator-verified"; src/render/animation-plan.ts L13-19; src/render/beat-behavior.ts L8-24; src/render/phaser/arena-animation.test.ts L23-28]

### The state machine shape: `idle → cutaway → blow → depart → done` (resolved on documented merits)

AC1 names the sequence verbatim: "time-freeze cutaway → colossal blow → departure". Map each to a phase + add the bookend resting/terminal phases:

- `idle` — pre-start (the cinematic is armed but not playing). `advanceSummon` from `idle` stays `idle` (you must `startSummon`).
- `cutaway` — the **time-freeze cutaway** (the arena freezes; a full-screen overlay signals the time-stop).
- `blow` — the **colossal blow** (THUNDORR's decisive impact — dramatizes the breakthrough's Problem-Integrity damage that ALREADY landed in Layer-0).
- `depart` — the **departure** (the colossus leaves; the overlay fades).
- `done` — the **terminal**: the clean return fires (re-apply the captured snapshot, clear the cinematic-active flag, resume playback). Absorbing — further advances stay `done`.

Why a state-`elapsedMs`-threshold machine (not an integer step index): driving the phase off cumulative `elapsedMs` against per-phase `const X_MS` durations means the SAME machine serves both the real-time rAF cadence (the Phaser consumer calls `advanceSummon(state, deltaMs)` each frame) AND a synchronous test (`advanceSummon(state, SUMMON_CINEMATIC_TOTAL_MS)` jumps to `done`) — one source of truth, deterministic, no Phaser dependency. It mirrors how `playback.ts` keeps `speed` a logical multiplier and lets the render loop own the wall-clock. The thresholds + `SUMMON_CINEMATIC_TOTAL_MS` are exported so the consumer and the tests never diverge. [Source: epics.md#Story-3.4 AC1 (the verbatim sequence); src/render/animation-plan.ts L70-80 (the `const X_MS` durations precedent); src/model/playback.ts L17-25 (logical-step vs render-side-wall-clock separation); CLAUDE.md "Simplicity first"]

Alternative considered + rejected: an event/callback-driven machine (each phase ends by firing the next via a Phaser `onComplete`). Rejected — that re-introduces the Phaser-timer dependency the pure machine exists to avoid (un-testable in jsdom) and couples the sequence to the tween engine.

### Clean return: restore the reducer's snapshot, never recompute (the R1 heart of AC1)

AC1's "returns cleanly to the arena state" + the story-specific R1 ("RESTORES/RESUMES the existing `BattleState`; does not recompute mechanics") resolve to a mechanism the codebase ALREADY guarantees — there is nothing new to compute:

- **The reducer is the single source of truth.** `playback.ts`'s `withCursor` ALWAYS sets `battleState = foldBattleState(timeline, cursor)` — path-independently (the proven SCRUB==PLAY property, Story 2.2 / `playback.ts` L96-113). The `BattleState` for any cursor is a pure fold; it does not depend on what happened during the cinematic.
- **The cinematic captures, then re-applies, the reducer's snapshot.** On the breakthrough forward tick, the boot computes `next = state.battleState` (the reducer's truth for the new cursor) and hands it to the behavior/cinematic path. The cinematic holds that `next` reference and, on `done`, re-applies it via the existing SNAP path (`scene.applySnapshot(next)`). The arena therefore shows the correct `BattleState` for the cursor with ZERO recompute.
- **Playback resumes from the untouched cursor.** Per Task 2's chosen mechanism (suspend-advance-during-cinematic, option A), the reducer `state` (cursor/status/speed) is NEVER moved during the cinematic — `advanceIfPlaying` simply skips the `tick` while the cinematic is active. So "resume" is trivially clean: the cursor is exactly where the breakthrough landed, and the next post-`done` tick continues normally.
- **Structural R1 proof:** the cinematic NEVER constructs or mutates a `BattleState`; it reads the one it was given (already `foldBattleState` truth) and re-snaps it. `summon-cinematic.ts` returns only `SummonCinematicState` (`{ phase, elapsedMs }`) — no `BattleState`, no mechanics field — exactly the structural posture `beat-behavior.ts` holds. There is no code path from the cinematic into mechanics.

The gate proves this with: (a) the structural grep (no `BattleState` write in `summon-cinematic.ts`); (b) a boot test asserting the post-cinematic applied snapshot deep-equals `foldBattleState(timeline, cursor)` and the reducer `state` is unchanged across the cinematic. The "uninterrupted / no perceptible jank" reading is OPERATOR-verified (NFR-1). [Source: src/model/playback.ts L96-113 (path-independent fold = SCRUB==PLAY); src/render/arena-boot.ts L118-137 (advanceIfPlaying — next = state.battleState); src/render/phaser/arena-scene.ts L104-116 (applySnapshot — the SNAP path to re-apply); architecture.md#R1 L225-228; story-specific guidance "R1: restore, don't recompute"]

### Trigger: the existing summon intent (production) — NO new Layer-0 path, NO new RenderPort method

The PRODUCTION trigger is the real Eidolon-Summon behavior intent Story 3.3 ALREADY produces: `planBeatBehaviors` emits `{ target: 'eidolon', behavior: 'summon' }` (+ `decisive-blow`) on a `summon`-tagged charged-gauge breakthrough (`beat-behavior.ts` L193-206). The cinematic ELEVATES Story 3.3's placeholder `summon`/`decisive-blow` tweens (`arena-scene.ts` L344-351) into the full-scene set-piece. So the trigger needs NO new Layer-0 code, NO new beat tag, and NO new `RenderPort` method — it rides the existing `renderBeatBehaviors` seam (the summon intent is already delivered there). In `ArenaScene.playBeatBehaviors`/`runBehavior`, seeing a `summon` behavior intent STARTS the cinematic. This is the minimal, surgical wiring (CLAUDE.md "touch only what the request requires").

Why not a new `RenderPort.playCinematic(...)` method: the summon intent is already a one-way command on the existing seam; adding a parallel method would duplicate the seam for no benefit and is a larger change. The cinematic is a render-internal elevation of an intent the scene already receives. [Source: src/render/beat-behavior.ts L193-206 (the `eidolon`/`summon` intent); src/render/phaser/arena-scene.ts L140-144 (playBeatBehaviors), L344-351 (the placeholder summon/decisive-blow to elevate); src/render/phaser/phaser-render-adapter.ts L125-136 (renderBeatBehaviors forwarding); epics.md#Story-3.3 AC3; CLAUDE.md "Surgical changes"]

### The Phaser cinematic: a DRIVEN set-piece, not a Phaser Timeline (placeholder art)

The Phaser consumer is THIN and FAIL-CLOSED (the `runIntent`/`runBehavior` posture — `arena-scene.ts` L261-304 / L314-355): given the captured `next` snapshot, it plays the four phases DRIVEN BY the pure `summon-cinematic` machine's current phase. On PLACEHOLDER art (real THUNDORR art is Story 5.3), reuse the existing primitives + the `environmentOverlay` (L449-459) full-screen overlay precedent:

- **cutaway** — a full-screen darkening/freeze overlay (the `environmentOverlay` rect precedent) signalling the time-stop; the arena cast holds.
- **blow** — a large flash/impact on the boss stand-in (reuse `flash`/`lunge`) — the decisive blow.
- **depart** — the overlay fades out + a fade/scale-out for the colossus stand-in.
- **done** — re-apply the captured snapshot (clean return) + clear the cinematic-active flag.

**The phase-advance mechanism (record in the dev pass): do NOT depend on a Phaser tween `onComplete` to advance phases** (jsdom never fires it → the smoke could not reach `done`). Drive the phase from the render-side cadence: either the boot's existing rAF loop calls `cinematic.advance(deltaMs)` each frame (the wall-clock precedent — `arena-boot.ts` L151-169), OR expose a synchronous `advanceCinematicToDone()` the smoke can call. EITHER keeps the SEQUENCE + the clean-return snap gate-provable under HEADLESS. Pick one and record it. The motion QUALITY (the spectacle) is operator-verified — the gate proves the RUN (no throw) + the cast survival + reaching `done` + the clean-return snap. [Source: src/render/phaser/arena-scene.ts L449-459 (environmentOverlay — the full-screen overlay), L408-417 (flash), L391-405 (lunge), L440-444 (fadeOut), L261-304/L314-355 (the fail-closed runner posture); src/render/arena-boot.ts L151-169 (the rAF wall-clock loop precedent); story-specific guidance "Graphics-generated shapes/fx" + "PLACEHOLDER art"]

### Dev-only preview trigger: `?cinematic=summon` + an exported dev hook (the operator's window into the cinematic)

The committed `FixtureInterpreter` omits `summon` by design (Story 3.1 — the thin redacted slice has no groundable sub-agent-spawn event), so the PRODUCTION summon trigger NEVER fires in the dev fixture and the cinematic would be invisible until the full bundle (Epic 5/Story 5.3). The story REQUIRES a dev-only preview so the operator can watch + verify it now. Resolution — implement BOTH surfaces (the hook is the testable seam; the URL flag is the operator ergonomics):

- **The exported dev hook** (`ArenaHandle.previewSummonCinematic(): void` from `startArena`): plays the cinematic on demand over the CURRENT `state.battleState` snapshot, and the clean-return restores that same snapshot. This is the GATE-PROVABLE surface (a unit test calls it and asserts the cinematic plays + the production overlay is unmutated + the snapshot is restored).
- **The URL flag** (`?cinematic=summon`, read in `main.ts`): `new URLSearchParams(window.location.search).get('cinematic') === 'summon'` → call the hook. GUARDED by `import.meta.env.DEV` so the entire branch + the hook call tree-shake out of the production build (Vite statically replaces `import.meta.env.DEV` with `false` in `build`, so dead-code elimination drops it — `grep -ril anthropic dist/` is irrelevant here since the hook is SDK-free, but the DEV guard keeps the dev-only ergonomics out of the shipped bundle).

**CRITICAL constraint (the story-specific load-bearing line):** the dev preview does NOT inject a fake summon into the production/committed fixture path. It plays the cinematic DIRECTLY (calling the consumer with the current snapshot); it does NOT add a `summon` `BeatAnnotation`, does NOT edit `fixture-interpreter.ts`, and does NOT alter the overlay the production `applyOverlay` builds. The PRODUCTION trigger stays the real summon behavior intent. The unit test pins this: after `previewSummonCinematic()`, the boot's overlay still has annotations `dispel` + `shaman` only (no `summon`). [Source: story-specific guidance "Add a DEV-ONLY preview trigger (e.g. a `?cinematic=summon` URL flag or an exported dev hook) … WITHOUT injecting a fake summon into the production/committed fixture path"; src/interpret/fixture-interpreter.ts (dispel + shaman only); src/main.ts L1-9 (the entry to extend); src/render/arena-boot.ts L65-72 (the ArenaHandle to extend); Vite docs `import.meta.env.DEV` (build-time boolean → dead-code elimination)]

### The honest reachability gap (inherited from Story 3.3 / 2.4)

The committed fixture has NO `summon` tag, so the PRODUCTION trigger (a real `summon`-tagged breakthrough → the summon intent → the cinematic) does not fire in the dev fixture. Therefore the summon-intent → cinematic POSITIVE branch is **unit-proven** on a hand-built `summon` `BeatBehaviorIntent` (feeding `playBeatBehaviors([{target:'eidolon',behavior:'summon',...}])`), the SAME posture Story 3.3 used for the summon behavior's positive branch (`beat-behavior.test.ts` L243-310) and Story 2.4 used for the Hammer-Flurry positive branch. The dev-preview hook is the operator's path to see it on the real arena. Document this gap in the Completion Notes — it is honest, not a defect. When the full bundle (Epic 5) carries a real `summon` annotation, the production trigger fires end-to-end with no code change. [Source: src/render/beat-behavior.test.ts L243-310 (the hand-built-summon UNIT-branch); 3-3 story §"Honest reachability gaps"; 2-4 story (Hammer-Flurry positive branch unit-only)]

### Conventions to follow (matching the established codebase)

- **Files:** kebab-case (`summon-cinematic.ts`, `summon-cinematic-scene.ts` if a separate scene). Tests co-located (`*.test.ts`). Follow the two-file split where it helps: the pure-machine test (`summon-cinematic.test.ts`, node) + the wiring/clean-return test (`arena-boot-cinematic.test.ts`, jsdom) + the headless Phaser smoke (`arena-cinematic.test.ts`) — the `animation-plan` / `animation-transition` / `arena-animation` triad precedent. [Source: architecture.md#Naming Patterns L244-245; src/render/animation-plan.test.ts + animation-transition.test.ts + phaser/arena-animation.test.ts]
- **Types:** PascalCase (`SummonCinematicPhase`, `SummonCinematicState`). String-literal unions only — NO numeric/native enums. Plain `type` for transient view state (NOT Zod — the cinematic state is never serialized). [Source: architecture.md#Naming Patterns L246-249; src/render/animation-plan.ts L37-65; src/model/playback.ts L37-42]
- **Imports:** `summon-cinematic.ts` is self-contained (no `schema/`/`model/`/`interpret/` import needed — it is a pure timeline); the Phaser consumer imports `* as Phaser` (render/phaser/ only, R5) + the pure machine + `BattleState` (type-only). Extensionless relative paths (codebase style). [Source: src/render/phaser/arena-scene.ts L1-15; src/render/beat-behavior.ts L1-6]
- **Purity:** `summon-cinematic.ts` is PURE by deliberate posture (node-testable), the SAME as `animation-plan.ts`/`beat-behavior.ts` — even though R2's LINT binds Layer-0 only. The Phaser consumer holds mutable display state + the cinematic-active flag (allowed — R2 binds Layer-0, not render/). [Source: src/render/animation-plan.ts L13-19; src/render/beat-behavior.ts L16-24]
- **Fail-closed:** the Phaser cinematic consumer no-ops on a missing display / unavailable tween manager (never throws), mirroring `runIntent`/`runBehavior`. [Source: src/render/phaser/arena-scene.ts L261-304, L314-355; architecture.md#Process Patterns L278-279]
- **Tests may use fs/Node** (not Layer-0 modules) — reuse the verbatim `runIngest`/`timeline` helpers from `arena-boot-behavior.test.ts` L50-64 for the jsdom boot test; reuse the `bootArena` HEADLESS harness from `arena-behavior.test.ts` L54-81 for the smoke. [Source: src/render/arena-boot-behavior.test.ts L43-131; src/render/phaser/arena-behavior.test.ts L54-81]

### Previous-story intelligence (the chain this builds on)

- **Story 3.3** (done) is the DIRECT predecessor — it produces the TRIGGER. `src/render/beat-behavior.ts`'s `planBeatBehaviors` emits the `{ target:'eidolon', behavior:'summon' }` + `decisive-blow` intents on a `summon`-tagged charged-gauge breakthrough (L193-206); `ArenaScene.playBeatBehaviors` (L140-144) + `runBehavior` (L314-355) currently run PLACEHOLDER tweens for them (`summon` = a `flash`, `decisive-blow` = a `lunge`). Story 3.4 ELEVATES those placeholder tweens into the full-scene cinematic. The summon behavior's positive branch was unit-proven (the fixture omits `summon`) — this story inherits that gap + adds the dev-preview hook to make the cinematic visible. The boot's overlay (`arena-boot.ts` L91: `applyOverlay(events, fixtureAnnotations())`) and the one-way `renderBeatBehaviors?` seam are in place — reuse them; do NOT add a parallel cinematic seam. [Source: src/render/beat-behavior.ts L193-206; src/render/phaser/arena-scene.ts L140-144, L314-355; src/render/arena-boot.ts L91, L118-137; 3-3 story]
- **Story 2.5** (done) made the boot's rAF loop status-driven + added `destroy()` rAF-cancel (fix round F1). When extending `arena-boot.ts` with the cinematic-active guard, do NOT regress that — the boot test's `afterEach` destroy + clean-teardown assertion must stay green (`destroy()` must still `cancelAnimationFrame` BEFORE tearing down the adapter). The cinematic-active flag is the natural extension of the status gate. [Source: src/render/arena-boot.ts L157-181; 2-5 story senior-review F1]
- **Story 2.4** (done) is the pure-layer + thin-consumer + headless-smoke pattern to mirror: `animation-plan.ts` (the pure `planAnimations`) + `ArenaScene.playAnimations` + `arena-animation.test.ts` (the HEADLESS smoke with the documented jsdom-does-not-advance-tweens limitation). `summon-cinematic.ts` + the cinematic consumer + `arena-cinematic.test.ts` are the siblings. It also established the held-victory-frame + `environmentOverlay` full-screen overlay (the cutaway precedent). [Source: src/render/animation-plan.ts; src/render/phaser/arena-scene.ts L449-459 (environmentOverlay); src/render/phaser/arena-animation.test.ts L23-28; 2-4 story]
- **Story 2.2** (done) `playback.ts` is the clean-return GUARANTEE: `withCursor` re-derives `battleState = foldBattleState(timeline, cursor)` path-independently (SCRUB==PLAY). The cinematic restores the reducer's snapshot; it never recomputes. The reducer stays PURE/untouched (no new action for the cinematic). [Source: src/model/playback.ts L96-113; 2-2 story]
- **Story 2.1** (done) `battle-model.ts` is the Layer-0 mechanics this story READS but never mutates: the breakthrough's integrity damage + victory latch already landed (L85-90). The cinematic dramatizes the blow; it does not compute it. [Source: src/model/battle-model.ts L76-114]
- **Pattern from Epics 2-3:** cite ACs verbatim; split gate-provable from operator-verified; verify the golden snapshots are byte-unchanged; reuse the `runIngest`/`bootArena` harnesses; `void _unused;` for an intentionally-unused param; DO NOT git commit (the operator commits between stories). [Source: 3-1/3-2/3-3/2-4/2-5 stories; story-specific guidance "DO NOT git commit"]

### Recent git context

HEAD is `ce5292e` ("Story 3.3: signature-beat battle behaviors + Scribe-correction signal (FR-4)"). Epics 1+2 + Stories 3.1/3.2/3.3 are committed + done; epic-3 is in-progress. `src/render/summon-cinematic.ts` and the Phaser cinematic consumer do NOT exist yet (greenfield for this story). Baseline gate state: 55 test files / 539 tests, both golden snapshots committed + byte-stable, no `anthropic` in `dist/`. The operator commits between stories — DO NOT `git commit`. [Source: `git log` (HEAD=ce5292e); `ls src/render` (no summon-cinematic); 3-3 story Completion Notes (55/539); story-specific guidance "DO NOT git commit"]

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-3.4 — the verbatim ACs (FR-8 + NFR-1)]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns L218-299 — R1 (L225-228), R2 (L229-232), R4 (L236-238), R5 (L239-241), Anti-Patterns L294-299; #Frontend Architecture L192-201 (RenderPort one-way + placeholder-first assets); #FR→Structure Mapping L376 (FR-7/8 → render/phaser/, public/assets/)]
- [Source: src/render/beat-behavior.ts L193-206 (the `eidolon`/`summon` + `decisive-blow` intents — the PRODUCTION trigger this story consumes) + beat-behavior.test.ts L243-310 (the hand-built-summon UNIT-branch for the fixture-omits-summon gap)]
- [Source: src/render/phaser/arena-scene.ts L140-144 (playBeatBehaviors), L314-355 (runBehavior — the placeholder summon/decisive-blow to elevate), L449-459 (environmentOverlay — the full-screen cutaway-overlay precedent), L261-304 (runIntent — the fail-closed runner posture), L408-417/L391-405/L440-444 (flash/lunge/fadeOut primitives)]
- [Source: src/render/arena-boot.ts L65-72 (the ArenaHandle to extend with the dev hook), L91 (the boot's overlay — applyOverlay(events, fixtureAnnotations())), L118-137 (advanceIfPlaying — extend with the cinematic-active guard; next = state.battleState is the clean-return snapshot), L157-181 (the rAF loop + destroy() rAF-cancel — do NOT regress 2.5 F1)]
- [Source: src/render/phaser/phaser-render-adapter.ts L125-136 (renderBeatBehaviors forwarding — the seam the summon intent already rides; no new method needed)]
- [Source: src/model/playback.ts L75-113 (initialPlaybackState + withCursor — the path-independent foldBattleState re-derive that IS the clean-return guarantee; the reducer is the single BattleState source of truth)]
- [Source: src/render/phaser/arena-behavior.test.ts L1-127 (the headless-smoke pattern + the documented jsdom-does-not-advance-tweens limitation to mirror) ; src/render/arena-boot-behavior.test.ts L43-131 (the jsdom boot harness + recording-fake + runIngest/timeline helpers to reuse)]
- [Source: src/main.ts L1-9 (the browser entry to extend with the ?cinematic=summon dev flag) ; src/interpret/fixture-interpreter.ts (dispel + shaman only — must stay UNCHANGED: the dev preview must NOT inject a summon)]
- [Source: src/schema/battle-timeline.ts L37-45 (BattleState fields: problemIntegrity/resolve/insightGauge/cursor/victory — the cinematic carries NONE of these) ; src/config/model-tuning.json (dischargeThreshold:50 — read by Story 3.3's trigger, not by this story)]
- [Source: eslint.config.ts L48-108 (the committed R1/R4/R5 config — DO NOT EDIT) ; tsconfig.json (strict family) ; Vite import.meta.env.DEV (build-time constant → dead-code elimination for the dev-only flag)]
- [Source: epics.md#Story-3.5 (the Shaman/Dispel cinematics — DEFERRED, NOT this story) ; #Story-5.3 (real THUNDORR art — a manifest swap, DEFERRED)]
- [Source: CLAUDE.md — Simplicity first, Surgical changes, Goal-driven execution, "Minimum code that solves the stated problem"]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMad dev-story workflow, red-green-refactor on the pre-written ATDD red tests).

### Debug Log References

Gate run (HEAD `ce5292e`, single pass):
- `pnpm typecheck` — clean (exit 0; strict, `noImplicitOverride`/`noUnusedParameters`).
- `pnpm lint` — clean (exit 0; R1/R4/R5 hold, `eslint.config.ts` UNTOUCHED).
- `pnpm test` — 59 files / 583 tests, all green (baseline 55/539 → +4 files, +44 tests). [Review fix
  round 1: the pre-fix count was 581/+42 (the Debug Log previously misstated 579/+40 — review F6); the
  F1/F2 resume + F3 boss-alpha regression guards add +2 → 583/+44.]
- `pnpm build` — succeeds; `grep -ril anthropic dist/` = NOTHING (R4); both golden snapshots
  (`src/pace/__snapshots__/` + `src/ingest/__snapshots__/`) byte-UNCHANGED (`git diff` empty).
- DEV-flag dead-code-elimination verified: the prod `DOMContentLoaded` handler is
  `startArena('game-container')` ONLY — the `import.meta.env.DEV`-guarded `?cinematic=summon` URL read
  + the `previewSummonCinematic()` call tree-shook out (`URLSearchParams` count = 0 in `dist/`). The
  `previewSummonCinematic` symbol survives ONLY as SDK-free method definitions (never called at prod boot).

### Completion Notes List

Implemented the THUNDORR summon cinematic (FR-8, NFR-1) as three deliverables + surgical wiring, exactly
to the ACs (no scope beyond them; NOT the Shaman/Dispel cinematics — those are Story 3.5; placeholder art
only — real art is Story 5.3's manifest swap):

1. **`src/render/summon-cinematic.ts`** — the PURE, Phaser-free, node-testable cinematic STATE MACHINE
   (`idle → cutaway → blow → depart → done`), the sibling of `animation-plan.ts`/`beat-behavior.ts`.
   `elapsedMs`-threshold driven so ONE machine serves both the rAF cadence (per-frame deltas) AND a
   synchronous test (one big delta clamps to `done`). `idle`/`done` are absorbing. Carries ONLY
   `{ phase, elapsedMs }` — no `BattleState`/mechanics field (R1 data-level). `CUTAWAY_MS=900`,
   `BLOW_MS=700`, `DEPART_MS=800`, `SUMMON_CINEMATIC_TOTAL_MS=2400` (placeholder timings — operator retunes).
2. **The THIN Phaser cinematic consumer** (method-cluster on `ArenaScene`, NOT a separate scene — the
   placeholder set-piece reuses the scene's `environmentOverlay`/`flash`/`lunge`/`fadeOut` primitives, so
   a cluster is the surgical shape): `cutaway` = full-screen freeze overlay, `blow` = flash+lunge on the
   boss stand-in, `depart` = fade-out, `done` = the CLEAN RETURN (re-apply the captured snapshot via
   `applySnapshot`). The phase advances off the render-side cadence (`Scene.update(time, delta)` ticks the
   pure machine each frame) NOT a tween `onComplete`, and a synchronous `advanceCinematicToDone()` lets the
   HEADLESS smoke reach `done` (jsdom advances no tweens). FAIL-CLOSED throughout (the helpers no-op on a
   missing display). Introspection: `cinematicPhase()` / `isCinematicActive()`.
3. **The DEV-ONLY preview trigger** — `ArenaHandle.previewSummonCinematic()` (the testable seam) plays the
   cinematic over the CURRENT `state.battleState` and clean-returns to it via the SNAP path; `main.ts` reads
   `?cinematic=summon` behind `import.meta.env.DEV` (tree-shaken from prod). It plays the cinematic DIRECTLY
   (a synthesized summon `BeatBehaviorIntent` handed to the scene) and injects NO `summon` into the
   production overlay — `fixture-interpreter.ts` is UNTOUCHED, the prod overlay stays dispel+shaman.

**Wiring (surgical, one-way):** the PRODUCTION trigger rides the EXISTING `renderBeatBehaviors` seam —
`ArenaScene.playBeatBehaviors` starts the cinematic when it sees a `{ target:'eidolon', behavior:'summon' }`
intent (Story 3.3 already emits it on a summon-tagged charged-gauge breakthrough); the summon/decisive-blow
intents are subsumed by the set-piece. NO new Layer-0 path, NO new beat tag. The clean-return (R1: restore,
don't recompute) re-applies the reducer's captured snapshot (already `foldBattleState(timeline, cursor)`
truth); the cinematic constructs/mutates NO `BattleState`. Advance-during-cinematic is SUSPENDED via a
boot-owned `cinematicActive` flag in `advanceIfPlaying` (Task 2 option A — the reducer state is untouched,
so resume is trivially clean; the held frame's read-only overlay keeps flowing). No reducer change, no
auto-pause (deferred to 4.2). Story 2.5's `destroy()` rAF-cancel is NOT regressed.

**Gate-PROVEN vs OPERATOR-verified (the load-bearing split):**
- Gate-PROVEN (typecheck/lint/test/build): the state-machine SEQUENCE (`idle→cutaway→blow→depart→done`,
  in order, never skipped) + clamp/absorbing + determinism + no-input-mutation + the R1 data shape
  (`summon-cinematic.test.ts`, 18 tests); the TRIGGER fires on the summon intent and NOT otherwise
  (`arena-cinematic.test.ts` headless smoke); the CLEAN RETURN — post-cinematic the applied snapshot
  deep-equals `foldBattleState(timeline, cursor)` AND the reducer state (cursor/status) is unchanged
  (`arena-boot-cinematic.test.ts`); the dev hook plays without mutating the prod overlay (still
  dispel+shaman); a headless boot smoke that the cinematic runs to `done` + the cast survives + no throw;
  R1/R4/R5/R2-posture source greps (`summon-cinematic.unit.test.ts`).
- OPERATOR-verified (NOT gate-proven — watch `pnpm dev` then open with `?cinematic=summon`): the full-scene
  SPECTACLE (the time-freeze cutaway reading as a distinct set-piece → colossal blow → departure); AC2
  first-time-viewer legibility; ~60fps no perceptible jank (NFR-1). jsdom draws nothing and does not advance
  Phaser tweens/timers — the SAME documented limitation as `arena-animation.test.ts` / `arena-behavior.test.ts`.

**DEV-PREVIEW TRIGGER (so the operator can watch the cinematic):** run `pnpm dev`, then open the app with
the query flag `?cinematic=summon` (e.g. `http://localhost:8080/?cinematic=summon`). The cinematic plays
once on load over the t=0 arena snapshot and cleanly returns. (The production summon-intent trigger is
unreachable in the committed dev fixture — the `FixtureInterpreter` omits `summon` by design, the thin
redacted slice; it will fire end-to-end with no code change once the full bundle carries a real `summon`
annotation, Epic 5/Story 5.3.)

**Honest reachability gap (inherited from Story 3.3 / 2.4):** the committed fixture has no `summon` tag, so
the PRODUCTION summon-intent → cinematic POSITIVE branch is unit-proven on a hand-built `summon`
`BeatBehaviorIntent` (the same posture 3.3 used for the summon behavior and 2.4 used for Hammer-Flurry). The
dev-preview hook is the operator's path to see it on the real arena now.

**One documented test addition (not a weakening of the ATDD red tests):** none of the three ATDD files were
deleted, skipped, or weakened — all made green honestly by implementing the feature. Added one unit file
(`summon-cinematic.unit.test.ts`, 9 tests) with the R1/R4/R5/R2 source-grep posture + threshold-edge cases.

**Convention deviations (documented):** `Scene.update` is overridden with the `override` keyword
(`noImplicitOverride`) and the unused `time` param uses the codebase `void _time;` convention
(`noUnusedParameters`); the adapter's `previewSummonCinematic(_snapshot)` uses `void _snapshot;` (the scene
restores its own captured snapshot; the boot snaps the baseline). NO git commit (operator commits between
stories).

### File List

New:
- `src/render/summon-cinematic.ts` — the PURE cinematic state machine (Phaser-free, node-testable).
- `src/render/summon-cinematic.test.ts` — ATDD: the pure-machine acceptance suite (sequence/clamp/determinism/R1-data).
- `src/render/summon-cinematic.unit.test.ts` — unit: R1/R4/R5/R2-posture source greps + threshold-edge cases.
- `src/render/arena-boot-cinematic.test.ts` — ATDD: clean-return + cinematic-active guard + dev hook + no-teardown-regression (jsdom).
- `src/render/phaser/arena-cinematic.test.ts` — ATDD: the headless Phaser cinematic smoke (run-to-done, no throw, cast survives).

Modified:
- `src/render/phaser/arena-scene.ts` — the cinematic consumer (summon-intent trigger in `playBeatBehaviors`;
  `startCinematic`/`update`/`advanceCinematicToDone`/`cinematicPhase`/`isCinematicActive`/`playPhaseVisual`;
  snapshot capture in `applySnapshot` for the clean return). **Fix round 1:** `resetCinematicAlpha` +
  the `done`-phase alpha restore (F3) + the `bossAlpha()` introspection.
- `src/render/arena-boot.ts` — `ArenaHandle.previewSummonCinematic()` + `isCinematicActive()`; the
  cinematic-active guard in `advanceIfPlaying` (suspend-advance, held-frame overlay re-render). **Fix
  round 1:** poll the scene/adapter `isCinematicActive()` as the single source of truth — clear the boot
  flag on resume (F1) + set it on the production summon path (F2).
- `src/render/render-port.ts` — the optional one-way `previewSummonCinematic?(snapshot)` command (backward-compatible).
  **Fix round 1:** the optional read-only `isCinematicActive?()` query the boot polls (F1/F2).
- `src/render/phaser/phaser-render-adapter.ts` — implements `previewSummonCinematic` (drives the scene's
  cinematic for the operator). **Fix round 1:** implements `isCinematicActive()` (delegates to the scene) (F1/F2).
- `src/render/arena-boot-cinematic.test.ts` — **Fix round 1:** the `RecordingCinematicAdapter` models the
  scene cinematic lifecycle; the resume regression guard (F4) + the genuine-restore clean-return assertion (F5).
- `src/render/phaser/arena-cinematic.test.ts` — **Fix round 1:** the boss-alpha clean-return regression guard (F3).
- `src/main.ts` — the DEV-only `?cinematic=summon` URL flag, guarded by `import.meta.env.DEV` (tree-shaken from prod).

## Senior Developer Review (AI)

**Reviewer:** Andres Felipe Grisales (andfeg@gmail.com)
**Date:** 2026-06-15
**Outcome:** Changes Requested (do NOT mark Done until F1/F2/F3/F4/F6 are addressed)

**Verdict:** AC2 passes (honestly operator-verified split). AC1 is PARTIAL: the scene-level clean return is proven, but the boot's `cinematicActive` flag is set-once-true and never cleared, so the only operator-reachable path (the `?cinematic=summon` dev preview) permanently suspends playback after the cinematic — directly violating AC1's "returns cleanly / playback resumes uninterrupted." All quality gates are green (typecheck/lint 0, build clean, no `anthropic` in `dist/`, golden snapshots unchanged), and 581 tests pass — but the green is misleading: the story-required "after done, advance resumes" test (Task 4) is missing, which is exactly why the resume defect ships undetected.

This review synthesizes 3 adversarial layers (Blind Hunter, Edge/Boundary Hunter) + the Acceptance Auditor; overlapping findings are merged and each was re-verified against `git diff HEAD` and the source. No finding was a false positive.

### Findings

| ID | Severity | Recommendation | Location | Title |
|----|----------|---------------|----------|-------|
| F1 | High | fix | `src/render/arena-boot.ts:118,144,160` | Boot `cinematicActive` never reset to false — dev-preview playback never resumes |
| F2 | Med | fix | `src/render/arena-boot.ts:144,177` | Boot `cinematicActive` never SET on the production summon path — Task 2 suspend-guard never engages for a real summon (latent until Epic 5) |
| F3 | Med | fix | `src/render/phaser/arena-scene.ts:246,250,551` | Clean return never restores `boss` alpha after `depart` fades it to 0 — stand-in left invisible |
| F4 | Low | fix | `src/render/arena-boot-cinematic.test.ts:190-206` | Cinematic-active guard test proves suspend only, never resume (the story-required Task 4 "advance resumes after done" assertion is missing) |
| F5 | Low | consider | `src/render/arena-boot-cinematic.test.ts:141-154` | Dev-hook clean-return test is near-tautological (asserts the boot's own render baseline; genuine restore IS proven separately in `arena-cinematic.test.ts`) |
| F6 | Low | fix | `_bmad-output/implementation-artifacts/3-4-thundorr-summon-cinematic.md:215,287` | Stale test counts: doc says 579/+40/unit=8; actual is 581/+42/unit=9 |

### Finding detail

**F1 — High — `src/render/arena-boot.ts:118,144,160` — Boot `cinematicActive` never reset (raised by: Blind Hunter, Edge/Boundary Hunter, Acceptance Auditor).**
`cinematicActive` is initialized `false` (L118) and set `true` (L144) in `previewSummonCinematic`; grep confirms there is NO assignment back to `false` anywhere. `advanceIfPlaying` early-returns while it is true (L160-163). The boot's `isCinematicActive()` reads the boot-owned boolean (L119), NOT the scene's `isCinematicActive()` (arena-scene.ts:227-229) which DOES correctly fall back to false at `done`. So after the dev preview (the only path that reaches the cinematic in the committed fixture), the forward tick is suspended forever and pressing Play never advances the cursor. Contradicts AC1 and the Dev Notes claim "the next post-`done` tick continues normally" (story L131). **Suggested fix:** clear the boot flag when the scene cinematic finishes — e.g. have `advanceIfPlaying` poll `adapter`/scene `isCinematicActive()` each held-frame tick and flip the boot flag false when the scene returns to rest (the scene already exposes the introspection). Then add the resume regression test (F4).

**F2 — Med — `src/render/arena-boot.ts:144,177` — flag never set on the production path (raised by: Blind Hunter [high], Edge/Boundary Hunter [high], Acceptance Auditor [med]).**
`cinematicActive=true` is set ONLY in the dev hook (L144). On a real summon, `advanceIfPlaying` forwards the intent at L177 → scene `playBeatBehaviors` → `startCinematic()`, arming the SCENE cinematic but never the boot flag — so the reducer keeps ticking forward "behind" the full-scene cutaway, unmeeting Task 2 option A. Downgraded from high to med (per the Auditor) because it is genuinely LATENT: `grep summon src/interpret/fixture-interpreter.ts` returns nothing, so no real summon fires in the shipped fixture; it would manifest in Epic 5. The same poll-the-scene fix as F1 addresses both (the boot reflecting the scene's armed state covers the production trigger too). **Suggested fix:** unify the source of truth — have `advanceIfPlaying` reflect the scene/adapter-reported `isCinematicActive()`, plus a test that arms via a recorded production summon intent and asserts suspend-then-resume.

**F3 — Med — `src/render/phaser/arena-scene.ts:246,250,551` — clean return leaves boss invisible (raised by: Edge/Boundary Hunter).**
`playPhaseVisual('depart')` calls `fadeOut('boss')` which tweens alpha→0 with NO yoyo (L551-555, comment "it stays faded"). On `done`, the clean return `applySnapshot(captured)` only calls `positionDisplay` (x/y) + `updateBar` (L131-138) — it never resets display alpha. So after a real cinematic the boss stand-in is left at alpha 0 (invisible), visually contradicting AC1's "returns cleanly to the arena state." Masked in jsdom (tweens never advance, so alpha stays 1 in tests); only the operator sees it. **Suggested fix:** on the `done` clean return, restore alpha (e.g. `setAlpha(1)` / kill the uncancelled depart tween) in `applySnapshot` or a done-phase reset.

**F4 — Low — `src/render/arena-boot-cinematic.test.ts:190-206` — resume half unproven (raised by: Edge/Boundary Hunter, Acceptance Auditor).**
The cinematic-active-guard test pumps `advanceIfPlaying` exactly once while active and asserts the cursor did not move; it never drives the cinematic to `done` and re-pumps to assert the forward tick RESUMES. Story Task 4 (L85) explicitly required "after `done`, advance resumes." This omission is the proximate reason F1 ships green. **Suggested fix:** extend the test to complete the cinematic (drive scene to done + clear the boot flag) then assert `advanceIfPlaying` advances the cursor again — the regression guard for F1.

**F5 — Low — `src/render/arena-boot-cinematic.test.ts:141-154` — near-tautological dev-hook assertion (raised by: Acceptance Auditor).**
`RecordingCinematicAdapter` does not implement `previewSummonCinematic`, so `adapter.lastSnap()` reflects only the boot's own `adapter.render(state.battleState)` baseline (arena-boot.ts:145). The test asserts `lastSnap` deep-equals the current snapshot right after the boot rendered it — it cannot fail on a clean-return regression. NOT a coverage hole: the genuine scene-level clean-return IS proven separately via spy (arena-cinematic.test.ts:119-147). Marked "consider" (a strength/redundancy improvement, not a defect) — either forward the dev-hook to a recordable scene-snap in the fake, or downgrade this assertion's claimed intent in its comment. Lean toward the latter (cheap, honest) given real coverage exists elsewhere.

**F6 — Low — story file L215,287 — stale test counts (raised by: Acceptance Auditor).**
Debug Log L215 says "59 files / 579 tests (+40)"; the actual run is 59 files / **581 tests** (+42 over the 539 baseline) — verified via `npx vitest run`. Completion L287 says the unit file added "8 tests"; `summon-cinematic.unit.test.ts` has **9** (`grep -c "it("`). **Suggested fix:** update the Debug Log + Completion counts to 581 / +42 / unit=9.

### AC Summary

| AC | Verdict | Note |
|----|---------|------|
| AC1 — distinct full-scene set-piece (cutaway→blow→depart) that returns cleanly to the arena state | Partial | Pure machine sequence/determinism/no-mutation proven; scene-level clean RETURN proven by spy; summon-specific trigger proven incl. negative branches. BUT clean return + RESUME is broken at the boot: `cinematicActive` never cleared (F1) → permanent tick-suspend after the dev preview (the only reachable path); never set on the production path (F2, latent). Story-required resume test missing (F4). |
| AC2 — beat legible without explanation; frame pacing holds (NFR-1) | Pass | Honestly operator-verified (legibility/spectacle/~60fps cannot be gate-proven — jsdom draws nothing, advances no Phaser tweens). Gate-provable portion (headless run-to-`done` smoke, cast survives, clean-return snap fires) passes (arena-cinematic.test.ts). Split documented matching 2.4/3.3 precedent. |

*Note: Status and commit intentionally left unchanged per review scope.*
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `3-4` in-progress → review.

### Review Resolution (AI) — Fix round 1 (2026-06-15)

All review findings resolved (see "### Review Follow-ups (AI)" under Tasks/Subtasks for per-finding detail). The Findings table above is the action-item list; every row is now closed:

| ID | Severity | Status | Resolution |
|----|----------|--------|------------|
| F1 | High | Fixed | The scene's cinematic machine is the single source of truth; `advanceIfPlaying` polls `adapter.isCinematicActive()` and clears the boot flag on resume. Resume regression guard added (was the missing F4 test). |
| F2 | Med | Fixed | Same poll-the-scene unification sets the boot flag on the production summon path (latent — fixture omits `summon`). |
| F3 | Med | Fixed | `done` clean return now kills the depart fade + resets boss alpha to 1 before re-applying the snapshot; regression guard added (confirmed failing without the fix). |
| F4 | Low | Fixed | `arena-boot-cinematic.test.ts` now drives suspend→done→resume and asserts the cursor advances again. |
| F5 | Low | Fixed | The recording fake forwards the dev hook to a recordable scene-snap (`finishCinematic`), so the clean-return assertion proves a genuine restore. |
| F6 | Low | Fixed | Debug Log + Completion test counts corrected (581/+42 pre-fix → 583/+44 post-fix; unit file 9). |

**AC1 — now PASS (post-fix):** the boot resume defect (F1) and the latent production-path suspend (F2) are fixed by a single source of truth (the scene's cinematic state, polled by the boot); the boss-invisible-after-cinematic defect (F3) is fixed by the `done`-phase alpha restore. The story-required "advance resumes after done" test (F4) now guards the resume. AC2 was already Pass.

**Gate re-run (post-fix, this round):** `pnpm typecheck` 0 · `pnpm lint` 0 (R1/R4/R5 untouched) · `pnpm test` 59 files / 583 tests green · `pnpm build` clean, `grep -ril anthropic dist/` = NOTHING (R4) · both golden snapshots byte-unchanged (R2) · no Layer-0 file touched (changes confined to `render/` + the story doc + `sprint-status.yaml`).

### Change Log

| Date | Change |
|------|--------|
| 2026-06-15 | Story 3.4 implemented (THUNDORR summon cinematic). Gates green. Status → review. |
| 2026-06-15 | Senior Developer Review (AI): Changes Requested (F1 high, F2/F3 med, F4/F5/F6 low). |
| 2026-06-15 | Review fix round 1: F1–F6 resolved (boot polls the scene's cinematic state as the single source of truth for suspend/resume; `done` restores boss alpha; resume + alpha regression guards added; doc counts corrected). Gates re-run green. Status → done. |
