---
baseline_commit: 97ffc3fd4dca2ad268974df38669636b4e0ae7b3
---

# Story 4.3: Always-on signature-beat teaching

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a learner,
I want a concise plain-dev one-liner to auto-surface at each of the three signature beats,
so that I understand what just happened without toggling anything (SM-1). (FR-11)

## Acceptance Criteria

**AC1 — auto-surface the right line per beat, then auto-dismiss** (epics.md L472-474)
**Given** a signature beat (Shaman / Dispel / Summon)
**When** it fires
**Then** a brief plain-dev one-liner auto-appears with **no viewer action** (e.g., Shaman death: "The whole bug class died at once — that's fixing the *root cause*, not the symptoms.") **and disappears on its own.**

**AC2 — brevity + accuracy** (epics.md L476-478)
**Given** the auto-surfaced teaching
**When** displayed
**Then** it is **brief enough not to bury the spectacle** (SM-C2) **and every line is accurate to the real Event it represents.**

### What "done" means, split by verifiability

GATE-VERIFIABLE (must be proven by `pnpm test` / `pnpm lint` / `pnpm build` — no human eyes):
- The **right** plain-dev one-liner is selected for each beat type: `shaman` → the root-cause line, `dispel` → the assumption-then-verify/honesty line, `summon` → the breakthrough-after-struggle line.
- **Auto-surface fires on the beat with no viewer action**: the pure planner emits a teaching op on the SAME transition the signature beat fires (driven by the Story 3.1 overlay annotations via the Story 3.3 L1→L0 bridge), and the boot hands it to the display on the forward tick — there is no toggle, no click, no `open()`.
- **Auto-dismiss** is encoded: each op carries a finite `dwellMs`; the display arms a timer that hides the banner after `dwellMs` with no viewer action.
- **Brevity (SM-C2)**: a gate-checkable max-length bound on each authored one-liner (a `z.string().max(N)` schema floor + a unit assertion), and at most one teaching op per signature beat per transition (no stacking).
- **Accuracy-to-event (grounded)**: each emitted op carries the firing annotation's `groundingPointer.eventRefs` (resolving back to the real Layer-0 event(s) the beat dramatizes), and every `eventRef` resolves to a real event in the overlay (no dangling ref) — the structural proof the line is keyed to a grounded beat, not a fabricated claim.
- **R1 / layer discipline**: `portal/teaching.ts` reads only the frozen read-only `AnnotatedView` (Layer 1) + Layer-0 `BattleState`/`Beat` deltas, returns ONLY `TeachingOp[]`, writes no mechanics field, constructs/returns no `BattleState`. Phaser confined to `render/`; teaching module + config stay SDK-free + phaser-free.
- Gates: `pnpm typecheck` clean; `pnpm lint` clean (R1/R4/R5 hold, `eslint.config.ts` UNCHANGED); full suite green; BOTH golden snapshots (`pace/` + `ingest/`) byte-stable (no Layer-0 code added); `pnpm build` OK + `grep -ril anthropic dist/` = NOTHING.

OPERATOR-VERIFIED (NOT a gate — `pnpm dev`; jsdom advances no Phaser tweens, so these cannot be asserted headlessly):
- On-screen **placement** of the teaching banner (non-intrusive — does not cover the spectacle / collide with the Tolkien caption band).
- **Legibility** of the plain-dev one-liner.
- **Timing feel**: the dwell reads long enough to absorb, short enough not to linger; the auto-dismiss feels natural.

## Tasks / Subtasks

- [x] **Task 1 — Author the plain-dev teaching content as config-as-data** (AC1, AC2)
  - [x] Create `src/config/teaching.json`: a `$schemaVersion: 1` object keyed EXHAUSTIVELY by the three `BeatType` members (`shaman` | `dispel` | `summon`), each value a single plain-dev one-liner STRING (NOT an array — there is no rotation here; teaching is a fixed lesson per beat, unlike the rotating Tolkien captions). PLAIN English, agentic-dev concept, NOT Tolkien register. Suggested lines (tune for accuracy + brevity, keep `*emphasis*` markdown light):
    - `shaman`: `"The whole bug class died at once — that's fixing the *root cause*, not the symptoms."`
    - `dispel`: `"The agent assumed, then *read the code to check* — and dropped the wrong assumption. Verifying beats guessing."`
    - `summon`: `"After a long struggle, the breakthrough landed — the decisive fix that finally cracked the problem."`
  - [x] Create `src/portal/teaching-config.ts`: the Zod `.strict()` exhaustive loader (MIRROR `src/scribe/captions-config.ts` and `src/model/model-tuning.ts` VERBATIM in structure). `TeachingTableSchema = z.object({ $schemaVersion: z.literal(1), shaman: OneLinerSchema, dispel: OneLinerSchema, summon: OneLinerSchema }).strict()` where `OneLinerSchema = z.string().min(1).max(TEACHING_MAX_LEN)`. Export `export const TEACHING = TeachingTableSchema.parse(rawTeaching)` (validate at module load — fail closed). Export `TEACHING_MAX_LEN` (the SM-C2 brevity bound, e.g. `140`) so both the schema and the unit test reference ONE constant.
- [x] **Task 2 — The PURE teaching planner `src/portal/teaching.ts`** (AC1, AC2)
  - [x] `export type TeachingOp = { kind: 'teach'; beatType: BeatType; text: string; cursor: number; dwellMs: number; groundingRefs: readonly string[] }` — plain `type`, NOT Zod (TRANSIENT in-memory view state, same call `CaptionOp` / `BeatBehaviorIntent` make); carries NO mechanics field (the R1 data-level proof). `groundingRefs` is Layer-0 provenance (the accuracy proof), NOT a mechanics field.
  - [x] `export function planTeaching(prev: BattleState, next: BattleState, beatsAdvanced: Beat[], view: AnnotatedView): TeachingOp[]` — the PURE entry point, MIRRORING `planCaptions` / `planBeatBehaviors` signature exactly (so the boot threads it uniformly). Maps a playback TRANSITION + the read-only overlay to teaching ops.
  - [x] Reuse the **L1→L0 bridge** from `beat-behavior.ts` (do NOT reinvent the fold): a tagged `BeatAnnotation`'s `eventRef` lands in some advanced beat's `sourceEventIds` (the pace CONSERVATION invariant) — look up via `view.byEventRef`. Emit ONE teaching op per DISTINCT signature beatType firing in this transition (dedupe by beatType so a beat tagged twice does not stack — SM-C2), carrying `TEACHING[beatType]` as `text` and the annotation's `groundingPointer.eventRefs` as `groundingRefs`.
  - [x] **Trigger parity with the cinematics/behaviors** (so teaching coincides with the beat the viewer sees — decide per the rules below, mirroring `planBeatBehaviors`):
    - `dispel` → fires when a `dispel`-tagged beat fires in this transition (same condition as the Story 3.3 mirage-shatter / Story 3.5 dispel-cinematic / Story 4.1 dispel caption — they all key on the dispel-tagged beat firing). On the committed fixture this is `dispel@u-0002#1`, fused into Beat[0].
    - `shaman` → fires on the **breakthrough discharge** transition (the swarm-clear / defeat moment — "the whole bug class died at once", AC1's worked example is the Shaman *death*), NOT on the resurrect loop. Reuse `isBreakthroughDischarge(prev, next)` (gauge was `>= dischargeThreshold` going in, `=== 0` out — read `dischargeThreshold` from `MODEL_TUNING`, NO hardcode) AND a `shaman`-tagged annotation present (`hasShaman`). On the committed fixture this is `shaman@u-0010#0`.
    - `summon` → fires on a **summon-tagged breakthrough** (same gate as the Story 3.3 eidolon-summon intent / Story 3.4 cinematic): `isBreakthroughDischarge` AND a `summon`-tagged annotation firing in this transition. The committed FixtureInterpreter OMITS `summon` by design (Story 3.1/3.3 thin slice), so this branch is UNIT-proven on hand-built data (the established 3.3/3.4 honest-gap precedent), not on the dev fixture.
  - [x] `dwellMs`: a finite render-side display duration (the `durationMs` precedent in `beat-behavior.ts`). Pick from a small per-beatType const map in `teaching.ts` (presentation timing lives render/portal-side, NOT battle tuning — the animation-plan.ts/beat-behavior.ts const-durations posture), e.g. `~4000ms` (long enough to read a one-liner, short enough not to linger). One value or a per-beat map — keep it simple.
  - [x] PURE + deterministic: no `Date.now` / `Math.random` / `performance.now` / IO / module-mutable state; same inputs → deep-equal output; mutates NEITHER input. `prev` may be unused by selection (kept to mirror the transition signature — the `planCaptions` `void prev;` precedent).
  - [x] Empty `beatsAdvanced` (held frame, `prev.cursor === next.cursor`) or a transition with no signature beat → `[]`.
- [x] **Task 3 — Wire the one-way display seam** (AC1)
  - [x] Extend `RenderPort` (UPDATE `src/render/render-port.ts`) with `renderTeaching?(ops: TeachingOp[]): void` — an OPTIONAL (`?`) one-way COMMAND (returns void, pushes NOTHING upstream), `TeachingOp` a TYPE-only import from `../portal/teaching`. MIRROR the `renderCaptions?` / `renderSaga?` JSDoc + shape EXACTLY. Optional keeps it BACKWARD-COMPATIBLE (the Story 2.5 fake adapter still satisfies `RenderPort`; the boot guards the call). `render -> portal` is allowed (no lint zone forbids it; the global anthropic+phaser bans still apply — `TeachingOp` is a plain type so nothing leaks).
  - [x] Implement on `PhaserRenderAdapter` (UPDATE `src/render/phaser/phaser-render-adapter.ts`): `renderTeaching(ops)` forwards to `scene.renderTeaching(ops)` (the `renderCaptions` forwarding precedent — guard on `this.ready` + scene).
  - [x] Add `ArenaScene.renderTeaching(ops: TeachingOp[])` (UPDATE `src/render/phaser/arena-scene.ts`): a create-once teaching banner Text (a SECOND band, visually distinct from + NON-overlapping the Story 4.1 caption band — different y / style so the plain-dev line does not collide with the Tolkien caption; see Project Structure Notes for placement). On a `teach` op: set the text + show it, then **arm an auto-dismiss timer** for `op.dwellMs` (`this.time.delayedCall(op.dwellMs, () => this.teachingText?.setVisible(false))` — the Phaser Scene clock; a NEW teach op cancels/replaces any pending dismiss so the latest beat's line shows for its full dwell). Never throws on a well-formed op (fail-closed: a missing band is a safe no-op). The on-screen placement/legibility/dwell FEEL is operator-verified (jsdom advances no timers/tweens).
- [x] **Task 4 — Thread teaching into the boot forward tick** (AC1)
  - [x] UPDATE `src/render/arena-boot.ts`: import `planTeaching` + `type TeachingOp` from `../portal/teaching`. In `advanceIfPlaying`, on the forward tick (the SAME place `planCaptions` / `planBeatBehaviors` already run), call `const teachingOps = planTeaching(prev, state.battleState, beatsAdvanced, view); if (teachingOps.length > 0) adapter.renderTeaching?.(teachingOps);`. Only the forward tick drives this — seek/restart SNAP and must NOT surface teaching (you cannot auto-surface a lesson across a jump; the caption/behavior posture). No new boot-owned state is needed (teaching is per-transition + stateless, UNLIKE captions which need a history for correction targeting).
  - [x] No DEV preview hook is required (UNLIKE the cinematics): `dispel` + `shaman` already fire on the committed fixture during normal playback (the Story 3.5 reachability win), so the operator sees auto-surface for two of three beats live; `summon` is dormant-in-fixture (the documented 3.4 reality). Do NOT inject a fake `summon` annotation into the production overlay.
- [x] **Task 5 — Tests (gate-verifiable half) + the discipline guard**
  - [x] `src/portal/teaching.test.ts` (AC-level, real fixture): drive the committed fixture (reuse `runIngest` / `deriveTimeline` + `fixtureAnnotations` + `applyOverlay` the way the existing beat-behavior / caption suites do) to the dispel and shaman transitions; assert `planTeaching` emits the RIGHT one-liner for each (`text === TEACHING.dispel` / `TEACHING.shaman`), with `groundingRefs` resolving to real overlay events (no dangling ref), a finite `dwellMs`, and at most one op per beatType per transition. UNIT-prove the `summon` branch on hand-built data (fixture omits summon — the 3.3/3.4 precedent). Determinism (call-twice `toEqual`). R1 data-level: emitted ops carry no mechanics key; `planTeaching` returns no `BattleState`. _(ATDD-authored; made GREEN by the implementation — unchanged.)_
  - [x] `src/portal/teaching.unit.test.ts`: brevity (every `TEACHING[beatType].length <= TEACHING_MAX_LEN`); negative branches (held frame → `[]`; a non-signature beat → `[]`; a charged-but-not-discharged transition → no shaman op); the dwell is finite/positive. _(ATDD-authored; made GREEN — unchanged.)_
  - [x] `src/portal/r1-discipline.test.ts` (or extend an existing discipline guard): source-grep that `teaching.ts` + `teaching-config.ts` contain ZERO `@anthropic-ai/sdk` and ZERO `phaser` references (MIRROR `src/scribe/r1-discipline.test.ts`'s `SCRIBE_MODULES` greps — the real R4/R5 guard for a browser-reachable module, since portal/ has NO lint zone). Optionally a data-level R1 grep that `teaching.ts` constructs no `BattleState` / writes no `problemIntegrity|resolve|insightGauge|hp|weight|dwellMs`-on-state. _(ATDD-authored; made GREEN — unchanged.)_
  - [x] Boot wiring: extend `src/render/arena-boot-*.test.ts` (a new `arena-boot-teaching.test.ts` or fold into an existing boot test) — assert the forward tick calls `adapter.renderTeaching?` with the right ops at the dispel/shaman transition (FakeRenderAdapter capture, jsdom), and that seek/restart SNAP do NOT call it. _(ATDD-authored `arena-boot-teaching.test.ts`; made GREEN — unchanged.)_
  - [x] Adapter/scene smoke: a headless Phaser boot test (the `arena-scene.test.ts` / `phaser-render-adapter.test.ts` precedent) that `renderTeaching` runs to completion without throwing. _(ATDD-authored `arena-teaching.test.ts`; made GREEN — unchanged.)_
  - [x] _Added on top (dev-story unit test):_ `src/portal/teaching-config.unit.test.ts` — pins the `.strict()` exhaustive loader's FAIL-CLOSED behavior (a valid table parses; a missing BeatType key, a typo'd key, an over-`TEACHING_MAX_LEN` line, an empty line, and a bumped `$schemaVersion` each throw at parse). Mirrors `model-tuning.unit.test.ts`; guards the SM-C2 brevity bound + the exhaustiveness decision as build-time invariants.
- [x] **Task 6 — Verify gates** (all must pass before marking done)
  - [x] `pnpm typecheck` (tsc --noEmit, strict) clean.
  - [x] `pnpm lint` clean — R1/R4/R5 hold, `eslint.config.ts` UNCHANGED (do NOT add/relax a zone).
  - [x] `pnpm test` green; BOTH golden snapshots (`src/pace/__snapshots__/` + ingest) byte-stable (no Layer-0 code touched). Report new file/test counts vs the 73 files / 744 tests baseline at HEAD `97ffc3f`. **→ 79 files / 788 tests, all green (+6 files / +44 tests: 5 ATDD files already in tree + 1 added `teaching-config.unit.test.ts`). Both snapshots byte-stable (pace md5 `7883770f…` unchanged; `git diff` on `__snapshots__/` empty).**
  - [x] `pnpm build` OK; `grep -ril anthropic dist/` returns NOTHING (teaching module + config are SDK-free; tree-shaken/never browser-drags the SDK). **→ build OK; `grep -ril anthropic dist/` = NOTHING.**
  - [x] Do NOT `git commit` (the operator commits between stories). **→ no commit made.**

### Review Follow-ups (AI)

Senior Developer Review fix round 1 (2026-06-15). 0 high / 0 med / 7 low. All "fix"/"consider" findings resolved; all "likely-refute" findings independently re-verified and refuted (no code change).

- [x] **F1 (fix, doc-accuracy):** Reported test count was stale (785/+41). Verified actual `vitest run` = 79 files / **788** tests (+44 vs the 73/744 baseline). Story Completion Notes (L81, L206) + sprint-status comment already carried the corrected 788/+44 (applied in the review pass); re-confirmed green. No stale 785/+41 remains outside the finding text itself.
- [x] **F2 (fix, provenance):** sprint-status `last_updated` had regressed (non-monotonic). Confirmed it now reads `2026-06-15T08:52:00Z` (monotonic, ≥ prior). Re-bumped to `2026-06-15T09:00:00Z` in this fix round so the tracking timestamp advances for the round-1 edits.
- [x] **F3 (consider, render-display):** Multi-op transition collapsed the earlier op to ~0ms on the single shared teaching band (a 2-op dispel+summon co-fire is valid planner output per `teaching.unit.test.ts:186-205`). FIXED at root: `ArenaScene.renderTeaching` now renders only the LAST op (last-op-wins) instead of iterating every op (set-then-overwrite + per-op timer churn) — the surviving line gets its full dwell with no flicker, and exactly ONE auto-dismiss timer is armed. Pinned by a new regression in `arena-teaching.test.ts` (spies the Scene clock: `delayedCall` called once, for the last op's dwell), verified RED on the old loop (`expected 1, got 2`) then GREEN. Stacking distinct beatType lines remains deferred to Epic 5. Unreachable on the committed fixture (dispel@Beat0 and shaman@discharge never share a transition).
- [refuted] **F4 (likely-refute, correctness):** Shaman + Summon ops co-firing on a dual-tagged breakthrough is INTENTIONAL — it faithfully mirrors the approved `planBeatBehaviors` dual-emit; no AC requires single-lesson precedence; unreachable on the committed fixture (no summon tag). The only user-visible symptom would be at the render band, now correct via F3 (last-op-wins). Epic-5 precedence decision (e.g. summon wins) deferred. No code change.
- [refuted] **F5 (likely-refute, trigger-accuracy):** Shaman teaching keying on `isBreakthroughDischarge + hasShaman` (not on the shaman anchor advancing this transition) is BY DESIGN per Dev Notes #3 + AC1's worked example — the lesson lands on the felt DEATH moment, not the earlier-advancing anchor. Proven by the negative real-fixture test `teaching.test.ts:156-169` (no shaman op on the pre-discharge advancing transition). On the fixture the anchor (Beat[7]) always precedes the discharge (Beat[9]). An `anchorReached`-OR gate is a deferred Epic-5 honest-gap for out-of-order data. No code change.
- [refuted] **F6 (likely-refute, immutability):** `groundingRefs` aliasing the frozen overlay's `eventRefs` array is safe — `TeachingOp.groundingRefs` and `AnnotatedView.annotations` are both `readonly` (compile-time mutation block), the render seam reads only `op.text`/`op.dwellMs` (never `groundingRefs`), and it mirrors `beat-behavior.ts`. A defensive `[...eventRefs]` copy would be speculative hardening against an impossible-today scenario (simplicity-first). No code change.
- [refuted] **F7 (likely-refute, hygiene):** The transient `src/portal/__probe__.test.ts` scratch test is absent from the delivered tree (confirmed via `ls` — file does not exist; `src/portal/` holds only the 6 delivered teaching files + `.gitkeep`). Already cleaned up. No code change.

## Dev Notes

### Source-of-truth ACs

The two ACs are quoted VERBATIM above from `epics.md` L464-478. The PRD elaborates the intent: teaching is **partly always-on** because a purely opt-in overlay fails SM-1 (comprehension) while SM-2 (wow) passes — "at each of the three signature beats, a concise plain-dev caption auto-surfaces (non-dismissible, brief)" [Source: prds/prd-dev-chronicles-2026-06-14/prd.md#4.6 L242]. FR-11 itself: "auto-surfaces a brief plain-dev explanation at each signature beat" with the Shaman worked example matching AC1 [Source: prd.md#FR-11 L246-252]. SM-1 is the load-bearing metric this story serves: "A first-time technical viewer who watches the full Replay **with no overlay toggled** (relying only on the always-on signature-beat teaching) can, unprompted, correctly explain ... root cause vs. symptom" [Source: prd.md#SM-1 L297].

### THE decisive design decisions (resolved on documented merits — decide, do not re-litigate)

**1. Module home = `src/portal/teaching.ts` (NOT `src/scribe/`).** Resolved in favor of portal/ on three documented merits:
- architecture.md names `portal/portal.ts` as the transparency-portal home and maps **FR-11 explicitly to `portal/` + `render/` ("always-on beat captions")** [Source: architecture.md#FR→Structure Mapping L378; #Directory Structure L363-364]. This story IS FR-11's always-on half; the on-demand Legend (Story 4.4) is the other half and ALSO lives in portal/. Co-locating both halves of the teaching layer in portal/ is the documented structure.
- **Register/layer separation.** scribe/ is the Layer-2 TOLD voice — Tolkien register, "variable, never mutates", the captions + Saga [Source: architecture.md#"Layer 2 — TOLD" L35-37, L356-358]. Teaching is **plain-dev** ("earnest and a little playful ... confident and clear" [Source: prd.md#Tone-of-the-teaching L345]) — a DIFFERENT register serving a DIFFERENT goal (it TEACHES the agentic-dev concept; it does not narrate the fable). The PRD groups it under "Codex / Legend (Teaching Overlay)" = the portal [Source: prd.md#4.6 L240-242; #Codex/Legend L80]. Putting plain-dev teaching in scribe/ would conflate the Scribe's mythic voice with the plain teacher's voice.
- **Lint reality.** `eslint.config.ts` has NO zone for portal/ (only R1 Layer-0→interpret, R4 anthropic, R5 phaser). portal/ may freely import `interpret/` (the overlay/annotations) + `model/` (MODEL_TUNING) + `schema/` as TYPES — exactly what the planner needs — while the global anthropic + phaser bans keep it SDK-free + phaser-free. A source-grep discipline test is the real guard (the scribe/ r1-discipline.test.ts precedent), since portal/ is browser-reachable.

**2. Trigger source = mirror the `beat-behavior.ts` L1→L0 bridge, keyed by `beatType`.** Do NOT invent a new detection path and do NOT add a new beat tag / Layer-0 path. The signature beats are ALREADY detected by `planBeatBehaviors` (`src/render/beat-behavior.ts`): a tagged `BeatAnnotation.eventRef` is found in an advanced `Beat.sourceEventIds` via `view.byEventRef` (the pace CONSERVATION invariant). `planTeaching` reuses that exact fold but emits a plain-dev one-liner per beatType instead of behavior intents. This guarantees teaching auto-surfaces ON the same transition the viewer sees the beat — the AC1 "when it fires" coincidence — with zero new triggering machinery. [Source: src/render/beat-behavior.ts L70-122 (annotationsFiringInBeats / isBreakthroughDischarge / anchorReached); src/scribe/captions.ts L67-77 (captionFamilyForBeat — the same bridge for captions)].

**3. Per-beat trigger conditions (parity with the cinematics, so the lesson lands with the spectacle):**
- **dispel** → on a `dispel`-tagged beat firing in the transition (identical to the Story 4.1 dispel caption + Story 3.3 mirage-shatter + Story 3.5 dispel cinematic). [Source: src/render/beat-behavior.ts L185-191].
- **shaman** → on the **breakthrough discharge** (`isBreakthroughDischarge` + `hasShaman`) — the swarm-clear/defeat moment. AC1's worked example is the Shaman **death** ("The whole bug class died at once"), which is precisely the breakthrough discharge transition (Story 3.3 emits `swarm-clear` + `defeat` there; Story 3.5 plays the swarm-clear cinematic there). Teaching on the death (not the resurrect loop) matches the felt moment SM-1 tests. [Source: src/render/beat-behavior.ts L163-176; epics.md L474].
- **summon** → on a **summon-tagged breakthrough** (`isBreakthroughDischarge` + a `summon`-tagged annotation firing) — identical to the Story 3.3 eidolon-summon gate + Story 3.4 cinematic. Read `dischargeThreshold` from `MODEL_TUNING` (NFR-4, NO hardcoded 50). [Source: src/render/beat-behavior.ts L193-206].

**4. Auto-surface / auto-dismiss timing model: pure data decides WHAT + HOW LONG; render owns the wall-clock dismiss.** The pure `planTeaching` is time-free (R2 posture, even though portal/ is not lint-bound to purity — it stays pure to be deterministic + replay-stable). Each `TeachingOp` carries a finite `dwellMs` (the presentation duration). The Phaser scene arms the dismiss timer (`this.time.delayedCall(dwellMs, hide)`) — the render-side wall-clock, the SAME split as Story 3.3's `BeatBehaviorIntent.durationMs` (pure plan emits durations; the scene runs the timers) and the boot's rAF wall-clock (time lives in render/, never in the pure layers). This makes auto-surface + auto-dismiss BOTH gate-provable at the data level (the op is emitted on the beat with a finite dwell) while the actual on-screen dwell FEEL is operator-verified. "No viewer action" is structural: there is no `open()`/toggle/click anywhere on this path — the boot pushes the op on the tick.

**5. Content = config-as-data `src/config/teaching.json` (single line per beatType, NOT an array).** Mirrors `captions.json` for the config-as-data discipline (NFR-4 — no hardcoded tuning/strings; the voice lives in config, the code reads it generically) [Source: architecture.md#config L365-368; src/scribe/captions-config.ts]. UNLIKE captions, there is NO variant rotation — teaching is a FIXED lesson per beat (the same concept every time; SM-1 wants the lesson stable, "infinite tellings, one story" [Source: architecture.md L41]). So the value is one string, not a `>=2` array. The loader (`teaching-config.ts`) is `.strict()` + exhaustive over the three `BeatType` keys (a missing/typo'd key fails loud at import — the captions-config.ts / model-tuning.ts fail-closed posture).

### Layer & purity discipline (R1 — the load-bearing property)

`portal/teaching.ts` is a Layer-1-CONSUMER (reads the frozen read-only overlay) + Layer-0-READER (reads `BattleState`/`Beat` deltas), and writes NOTHING back into mechanics:
- It imports `BattleState`/`Beat`/`BeatType`/`AnnotatedView` as TYPES only; it reads `MODEL_TUNING.insight.dischargeThreshold` as a config VALUE (the render-model.ts / beat-behavior.ts precedent — render/portal reading MODEL_TUNING is allowed).
- It returns ONLY `TeachingOp[]`. It NEVER constructs/returns a `BattleState`/`Beat`, NEVER writes `problemIntegrity` / `resolve` / `insightGauge` / `hp` / `weight`. `dwellMs` is a PRESENTATION duration on the op, not a state mutation — not a mechanics field (the same kind of field as `BeatBehaviorIntent.durationMs`). [Source: architecture.md#R1 L225-228 (the read-only overlay never feeds HP/pacing); #"Layer 1" L32-34 (READ-ONLY overlay); src/render/beat-behavior.ts L16-28 (the R1 structural embodiment this mirrors)].
- The overlay is the SAME read-only `AnnotatedView` the boot already builds once (`applyOverlay(events, fixtureAnnotations())`) — no second interpreter, no new annotation.

R4 (SDK isolation): `teaching.ts` + `teaching-config.ts` import NO `@anthropic-ai/sdk` (teaching is templated config-as-data — there is NO LLM call here; the only LLM calls in the whole project are the offline Interpreter [3.2] + the offline Saga author [4.2]). portal/ is NOT an R4-re-allowed zone, so lint already bans the SDK there; the source-grep is belt-and-suspenders. `grep -ril anthropic dist/` must stay NOTHING. [Source: architecture.md#R4 L236-238; eslint.config.ts L9-10, L94-100].

R5 (phaser confined to render/+game/): the teaching SELECTION/TEXT lives in portal/ (no phaser); only the DISPLAY lives in `render/phaser/`. portal/ is lint-banned from importing phaser; the source-grep re-states it. [Source: architecture.md#R5 L239-241; eslint.config.ts L11-12, L102-106].

### Current state of the files this story TOUCHES (read before editing — do not break these)

- `src/render/render-port.ts` (UPDATE): the one-way `RenderPort` interface. Already carries the OPTIONAL `?` command precedents `renderBeatBehaviors?` (3.3), `previewSummonCinematic?` (3.4), `previewShaman/DispelCinematic?` (3.5), `renderCaptions?` (4.1), `renderSaga?` (4.2), and the lone query `isCinematicActive?`. ADD `renderTeaching?(ops: TeachingOp[]): void` in the same one-way `?` style. **Must preserve**: the one-way contract (commands return void, nothing flows upstream); every command stays optional so the Story 2.5 fake still satisfies the interface.
- `src/render/phaser/phaser-render-adapter.ts` (UPDATE): `implements RenderPort`. `renderCaptions(ops)` / `renderSaga(saga)` forward to the scene guarded on `this.ready`. ADD `renderTeaching(ops)` forwarding to `scene.renderTeaching(ops)` the same way. **Must preserve**: the ready-guard + scene-lookup pattern; warns-not-throws when called before init.
- `src/render/phaser/arena-scene.ts` (UPDATE): has the create-once caption band (`captionText` near y=50, `captionStrike`, `captionRewrite`) + the `sagaPanel` + `renderCaptions` / `renderSaga`. ADD a `teachingText` band + `renderTeaching(ops)` with the `delayedCall` auto-dismiss. **Must preserve**: the create-once-in-`create()`, mutate-in-place pattern; the caption band's position/styling (place the teaching band so it does NOT overlap it — see Project Structure Notes); never-throw fail-closed posture.
- `src/render/arena-boot.ts` (UPDATE): wires the reducer → adapter on the forward tick. Already runs `planCaptions` (L290-293) + `planBeatBehaviors` signals (L294-295) + the Saga victory latch (L304-307) inside `advanceIfPlaying` AFTER the `renderTransition` + `renderBeatBehaviors` calls. ADD the `planTeaching(...)` call + `adapter.renderTeaching?.(...)` in the SAME forward-tick block. **Must preserve**: only the forward tick narrates (seek/restart SNAP via `render()` and must not surface teaching); the cinematic-active suspend guard (L255-262) — teaching, like captions, is part of the forward-tick body that the guard `return`s before; the held-frame `renderBeatBehaviors?(...,[],view)` keeps the overlay flowing but emits no teaching (empty `beatsAdvanced` → `planTeaching` returns `[]`).

### Reuse map (do NOT reinvent)

| Need | Reuse | Where |
|---|---|---|
| Pure transition planner shape `(prev, next, beatsAdvanced, view)` | `planCaptions` / `planBeatBehaviors` | `src/scribe/captions.ts` L128; `src/render/beat-behavior.ts` L133 |
| L1→L0 bridge (tagged annotation → firing beat) | `annotationsFiringInBeats` / `captionFamilyForBeat` | `src/render/beat-behavior.ts` L78-93; `src/scribe/captions.ts` L67-77 |
| Breakthrough discharge detector (shaman/summon gate) | `isBreakthroughDischarge` | `src/render/beat-behavior.ts` L102-104 |
| `dischargeThreshold` (config, no hardcode) | `MODEL_TUNING.insight.dischargeThreshold` | `src/model/model-tuning.ts` L70 |
| Config-as-data loader (`.strict()` exhaustive Zod, validate-at-load) | `captions-config.ts` / `model-tuning.ts` | `src/scribe/captions-config.ts`; `src/model/model-tuning.ts` |
| One-way `?` render command + scene forwarding | `renderCaptions?` / `renderSaga?` | `src/render/render-port.ts` L55-72; `phaser-render-adapter.ts` `renderCaptions`; `arena-scene.ts` `renderCaptions` |
| Render-side display duration on a transient op | `BeatBehaviorIntent.durationMs` | `src/render/beat-behavior.ts` L53-68 |
| Source-grep discipline guard (SDK-free + phaser-free) | `r1-discipline.test.ts` (SCRIBE_MODULES greps) | `src/scribe/r1-discipline.test.ts` L28-50 |
| Real-fixture drive in a test | `runIngest` + `fixtureAnnotations` + `applyOverlay` | existing `src/render/beat-behavior.test.ts` / `src/scribe/captions.test.ts` |
| Render-side auto-dismiss timer | `this.time.delayedCall(ms, cb)` (Phaser Scene clock) | Phaser 4 Scene `time` (`Phaser.Time.Clock`) — confined to `arena-scene.ts` |

### Previous-story intelligence (Epic 4 so far + the 3.x dependencies)

- **Story 4.1 (Captions, FR-9, done)** established the EXACT pattern this story mirrors one layer over: a pure planner reading the overlay + transition → transient ops, a `.strict()` config-as-data table, an optional one-way `renderCaptions?` command, a scene band, and the boot threading it on the forward tick (only). The Tolkien register lives there; teaching is the PLAIN-DEV sibling. The dispel beat's caption AND its teaching both fire on the same `dispel`-tagged Beat[0] transition on the committed fixture. [Source: src/scribe/captions.ts; src/scribe/captions-config.ts; sprint-status 4-1 notes].
- **Story 3.3 (signature-beat behaviors, FR-4, done)** is the trigger source: `planBeatBehaviors` emits the `{shaman,defeat}` / `{mirage,shatter}` / `{eidolon,summon}` intents this story keys its teaching off, and built the L1→L0 bridge + `isBreakthroughDischarge` + `anchorReached`. The `scribe-correction` `BeatSignal` is a cross-layer signal; teaching does NOT need a new signal (it reads the overlay directly, the captions-emit posture, NOT the signal posture). [Source: src/render/beat-behavior.ts; src/interpret/beat-signal.ts].
- **Reachability win (Story 3.5):** UNLIKE summon (omitted from the committed FixtureInterpreter), `dispel@u-0002#1` + `shaman@u-0010#0` ARE tagged, so their teaching auto-surfaces on the committed fixture during normal `pnpm dev` playback — the operator sees two of three live. Drive the AC1 gate end-to-end for dispel + shaman on the real fixture; UNIT-prove summon (the documented honest gap, the 3.3/3.4 precedent). [Source: src/interpret/fixture-interpreter.ts annotations; sprint-status 3-1/3-3/3-5 notes].
- **Dormant-in-fixture honest gap (Story 3.4):** the `summon` teaching branch is unit-proven only; it fires end-to-end with no code change once the full bundle carries a summon-tagged annotation (Epic 5). Document this in `teaching.ts`.
- **Boot-tick discipline (Stories 2.5/3.3/4.1/4.2):** narration rides the forward tick ONLY; seek/restart SNAP. Teaching follows suit (no auto-surface across a jump). No new boot state needed (teaching is stateless per-transition, unlike the caption history).

### Git intelligence

HEAD `97ffc3f` (Story 4.2). Recent commits (3.1→4.2) are the Layer-1 spine + cinematics + Layer-2 captions/Saga — each added a pure planner/reader + an optional one-way render command + a scene method + a forward-tick boot wire, SDK-free/phaser-confined, golden snapshots byte-stable. This story is the same shape, one module over (portal/). Test baseline at HEAD: **73 files / 744 tests, all green** (verified via `pnpm test`). Do NOT `git commit` — the operator commits between stories.

### Testing standards

- Vitest, co-located `*.test.ts`; `vitest run` runs `src/**/*.test.ts` (so the testable logic MUST live under `src/` — `teaching.ts` is in `src/portal/`, correct; scripts/ would not run). Layer-0 determinism is golden-snapshot guarded under `src/pace/__snapshots__/` — this story adds NO Layer-0 code, so both snapshots stay byte-stable.
- AC-level test on the REAL committed fixture for dispel + shaman (the gate-verifiable half); hand-built UNIT test for summon (fixture omits it) + the negative/brevity/determinism/R1-data branches.
- Source-grep discipline test (portal/ SDK-free + phaser-free) — the real R4/R5 guard for a browser-reachable module, since portal/ has no lint zone.
- Operator-verified (NOT a gate, jsdom advances no Phaser timers/tweens): on-screen placement/legibility/dwell feel via `pnpm dev`.

### Project Structure Notes

- New files: `src/config/teaching.json`, `src/portal/teaching.ts`, `src/portal/teaching-config.ts`, `src/portal/teaching.test.ts`, `src/portal/teaching.unit.test.ts`, `src/portal/r1-discipline.test.ts`. (portal/ currently holds only `.gitkeep`.)
- UPDATE files: `src/render/render-port.ts`, `src/render/phaser/phaser-render-adapter.ts`, `src/render/phaser/arena-scene.ts`, `src/render/arena-boot.ts` (+ a boot test, e.g. `src/render/arena-boot-teaching.test.ts`).
- **Placement of the teaching band (operator-verified, give the dev a concrete starting point):** the Story 4.1 caption band sits centered near the TOP (y≈50) [Source: arena-scene.ts L179-182]. Place the plain-dev teaching banner so it does NOT overlap it — e.g. near the BOTTOM of the stage (above the controls) or a clearly distinct lower band — and style it plainly (NOT the Tolkien caption styling) to signal the different register. The exact y/style is operator-tuned; the gate does not assert pixels.
- Conventions (match exactly): kebab-case files; `PascalCase` types; Zod `export const XxxSchema` + `export type Xxx = z.infer<...>`; string-literal unions (NO numeric/native enums — `BeatType` already is one); config-as-data in `src/config/*.json` (no hardcoded tuning/strings); prefer explicit `null` over `undefined` for serialized data (N/A here — `TeachingOp` is transient, not serialized). No runtime LLM/network anywhere browser-reachable.
- No conflict with the unified structure: `portal/` is the architecture's named home for FR-11; `teaching.json` joins the existing `src/config/*.json` family.

### References

- [Source: epics.md#Story-4.3 L464-478] — the two ACs, verbatim, + the Shaman worked example.
- [Source: epics.md#Epic-4 L424-428] — Epic 4 scope (FR-9/10/11; "always-on beat teaching, and the on-demand Legend/transparency portal").
- [Source: prds/prd-dev-chronicles-2026-06-14/prd.md#4.6 L240-242] — "teaching is partly always-on ... a concise plain-dev caption auto-surfaces (non-dismissible, brief)".
- [Source: prd.md#FR-11 L246-256] — the always-on + on-demand split; the deferral note (full collectible Codex deferred; v0.1 = always-on teaching + on-demand Legend).
- [Source: prd.md#SM-1 L297] — the comprehension metric this story serves (no overlay toggled).
- [Source: prd.md#SM-C2 L306] — "Caption density should not bury the action" (the brevity bound).
- [Source: prd.md#Tone-of-the-teaching L345] — plain-dev register: "earnest and a little playful ... confident and clear, never condescending."
- [Source: architecture.md#Directory-Structure L363-364, #FR→Structure-Mapping L378] — portal/ is the FR-11 home (portal + render).
- [Source: architecture.md#"Layer 1"/"Layer 2" L30-42, #R1 L225-228, #R4 L236-238, #R5 L239-241] — the three-layer model + the R-rules.
- [Source: src/render/beat-behavior.ts] — the trigger source + L1→L0 bridge + `isBreakthroughDischarge` to reuse.
- [Source: src/scribe/captions.ts; src/scribe/captions-config.ts; src/scribe/r1-discipline.test.ts] — the exact pattern (planner + config loader + discipline guard) to mirror.
- [Source: src/render/render-port.ts; src/render/phaser/phaser-render-adapter.ts; src/render/phaser/arena-scene.ts; src/render/arena-boot.ts] — the one-way display seam + the boot forward-tick wiring.
- [Source: src/schema/beat-annotation.ts] — `BeatType` (`shaman`|`dispel`|`summon`), `GroundingPointer.eventRefs` (the accuracy/grounding proof).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Opus 4.8), BMAD dev-story workflow (autonomous, single pass).

### Debug Log References

- RED confirmed before implementation: the 5 committed ATDD files failed on the missing `./teaching` / `./teaching-config` imports (the intended red); HEAD at start = `97ffc3f` (the story baseline).
- One iteration during the GREEN render pass: the headless adapter smoke (`arena-teaching.test.ts`) initially failed with `TypeError: adapter.renderTeaching is not a function` — I had added the `RenderPort` declaration + scene method but not the concrete `PhaserRenderAdapter.renderTeaching` forwarder. Added it (mirroring `renderCaptions`) → green.
- One typecheck miss: `arena-scene.ts` referenced `TeachingOp` without importing it (TS2304). Added the type-only import → `pnpm typecheck` clean.
- Full gate sweep all green (see Completion Notes for counts/evidence). No HALT conditions hit; no new dependencies; `eslint.config.ts` untouched; no `git commit`.

### Completion Notes List

Implemented the always-on signature-beat teaching layer (FR-11, SM-1) as a PURE portal/ module + a thin render display, mirroring the Story 4.1 caption pattern one layer over.

- **AC1 (right line auto-surfaces per beat, then auto-dismisses)** — gate-proven. `planTeaching` (pure) emits at most one plain-dev one-liner `TeachingOp` per signature beatType firing in a transition, keyed off the reused `beat-behavior.ts` L1→L0 bridge: `dispel` on the dispel-tagged beat firing (Beat[0], `text === TEACHING.dispel`), `shaman` on the breakthrough-discharge death (`isBreakthroughDischarge` + a shaman annotation, `text === TEACHING.shaman`), `summon` on a summon-tagged breakthrough (UNIT-proven; the fixture omits summon by design — the documented 3.3/3.4 honest gap). Auto-surface is structural: the boot calls `planTeaching` + `adapter.renderTeaching?.(...)` on the FORWARD tick only — no toggle/click/open() on the path. Auto-dismiss is encoded as a finite per-op `dwellMs` (per-beatType const map, ~4000ms) that the Phaser scene arms via `this.time.delayedCall(dwellMs, hide)`; a new op cancels/replaces the prior pending dismiss.
- **AC2 (brevity + accuracy)** — gate-proven. Brevity: `TEACHING_MAX_LEN = 140` is the single source of truth for both the `OneLinerSchema` `.max()` floor and the unit assertion; at most one op per beatType per transition (dedupe by beatType — no stacking). Accuracy-to-event: each op carries the firing annotation's `groundingPointer.eventRefs` (dispel `['u-0002#1','u-0002#2','u-0003#0']`, shaman `['u-0009#0','u-0010#0']`), and every ref resolves to a real overlay event (no dangling ref) — the structural proof the line is keyed to a grounded beat.
- **R1 / layer discipline** — gate-proven. `planTeaching` reads only the frozen read-only `AnnotatedView` (L1) + L0 `BattleState`/`Beat` deltas, reads `MODEL_TUNING.insight.dischargeThreshold` as a config value (no hardcode), returns ONLY `TeachingOp[]`, constructs/returns no `BattleState`, writes no mechanics field (runtime `hasOwnProperty` checks + the source-grep guard). `teaching.ts` + `teaching-config.ts` are SDK-free + phaser-free (source-grep, the real R4/R5 guard since portal/ has no lint zone). Determinism + no-mutation pinned.

**Senior Developer Review fix round 1 (2026-06-15)** — 0 high / 0 med / 7 low. The only code change is the F3 (consider) display fix: `ArenaScene.renderTeaching` renders the LAST op (last-op-wins) rather than iterating every op, so a valid multi-op transition (dispel+summon co-fire) no longer flashes the earlier line ~0ms or churns the dismiss timer — exactly one timer is armed, for the surviving line's full dwell. Pinned by a new RED-then-GREEN regression in `arena-teaching.test.ts` (spies the Scene clock). F1/F2 (doc/provenance) re-verified. F4/F5/F6/F7 independently re-verified and refuted as intentional/unreachable/already-clean (no code change). See "### Review Follow-ups (AI)" for the per-finding record. Re-run gates GREEN: typecheck/lint clean (`eslint.config.ts` UNTOUCHED, R1/R4/R5 hold), `pnpm test` = **79 files / 789 tests** (was 788; +1 F3 regression), build OK, `grep -ril anthropic dist/` = NOTHING, both golden snapshots byte-stable. No `git commit`.

Gates: `pnpm typecheck` clean; `pnpm lint` clean (R1/R4/R5 hold, `eslint.config.ts` UNCHANGED); `pnpm test` = **79 files / 788 tests, all green** (baseline 73/744 at HEAD `97ffc3f` → +6 files / +44 tests: the 5 committed ATDD files + 1 added `teaching-config.unit.test.ts`); BOTH golden snapshots byte-stable (pace md5 `7883770f2f32852bcdc7096437832721` unchanged; `git diff` on `__snapshots__/` empty — no Layer-0 code touched); `pnpm build` OK; `grep -ril anthropic dist/` = NOTHING.

ATDD honesty: the 5 red-phase acceptance tests were made GREEN by the implementation — none deleted, skipped, or weakened, and none encoded a wrong expectation (no test edits were needed). The only test ADDED on top is the loader fail-closed unit test.

OPERATOR-VERIFIED (NOT gates — `pnpm dev`; jsdom advances no Phaser timers/tweens): the teaching banner's on-screen PLACEMENT (a bottom band at y≈700, distinct from the top caption band at y≈40 — non-intrusive, no collision with the Tolkien caption), the LEGIBILITY of the plain-dev line, and the auto-dismiss TIMING FEEL (the ~4000ms dwell reads long enough to absorb / the dismiss feels natural). `dispel` + `shaman` auto-surface live on the committed fixture (two of three beats); `summon` stays dormant-in-fixture until Epic 5 ships a summon-tagged annotation (no code change needed then).

### File List

New:
- `src/config/teaching.json` — config-as-data: one fixed plain-dev one-liner per `BeatType` (no rotation).
- `src/portal/teaching-config.ts` — the `.strict()` exhaustive Zod loader (`TeachingTableSchema`, `TEACHING`, `TEACHING_MAX_LEN`), validate-at-load fail-closed.
- `src/portal/teaching.ts` — the PURE `planTeaching` planner + the `TeachingOp` type.
- `src/portal/teaching-config.unit.test.ts` — loader fail-closed unit test (added on top of the ATDD suite).

Modified:
- `src/render/render-port.ts` — added the optional one-way `renderTeaching?(ops: TeachingOp[]): void` command + the `TeachingOp` type-only import.
- `src/render/phaser/phaser-render-adapter.ts` — added `renderTeaching(ops)` forwarding to the scene (ready-guarded) + the `TeachingOp` type-only import.
- `src/render/phaser/arena-scene.ts` — added the create-once `teachingText` bottom band + `renderTeaching(ops)` with the `delayedCall` auto-dismiss (cancel/replace pending) + the `TeachingOp` type-only import. **(Review fix round 1, F3): `renderTeaching` now renders the LAST op only (last-op-wins) instead of iterating every op.**
- `src/render/arena-boot.ts` — threaded `planTeaching` + `adapter.renderTeaching?.(...)` on the forward tick only + the `planTeaching` / `TeachingOp` imports.
- `src/render/phaser/arena-teaching.test.ts` — **(Review fix round 1, F3): added a multi-op last-op-wins regression (spies the Scene clock → `delayedCall` armed once for the last op), verified RED on the old per-op loop then GREEN.**

ATDD acceptance tests (already in the working tree; made GREEN, unchanged):
- `src/portal/teaching.test.ts`, `src/portal/teaching.unit.test.ts`, `src/portal/r1-discipline.test.ts`, `src/render/arena-boot-teaching.test.ts`, `src/render/phaser/arena-teaching.test.ts`.

Story tracking (permitted non-source edits):
- `_bmad-output/implementation-artifacts/4-3-always-on-beat-teaching.md` — frontmatter `baseline_commit`, task checkboxes, Dev Agent Record, File List, Status, Review Follow-ups, Change Log.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `4-3` ready-for-dev → in-progress → review → done.

## Change Log

| Date | Version | Change | Author |
|---|---|---|---|
| 2026-06-15 | 0.1 | Story 4.3 implemented (always-on signature-beat teaching, FR-11/SM-1) via dev-story; Status → review. | Amelia (dev-story) |
| 2026-06-15 | 0.2 | Senior Developer Review (AI): APPROVE, 0 high / 0 med / 7 low. F1/F2 auto-fixed (doc/provenance). | Andres Felipe Grisales |
| 2026-06-15 | 0.3 | Review fix round 1: F3 (consider) fixed at root — `ArenaScene.renderTeaching` renders the last op (last-op-wins), pinned by a RED-then-GREEN regression. F1/F2 re-verified; F4/F5/F6/F7 refuted (intentional/unreachable/already-clean). Gates GREEN (79 files / 789 tests). Status → done. | Senior Review fix (AI) |

## Senior Developer Review (AI)

**Reviewer:** Andres Felipe Grisales · **Date:** 2026-06-15 · **Outcome:** APPROVE

**Verdict:** All ACs pass; implementation is faithful to the planCaptions/planBeatBehaviors precedent and R1/R4/R5-clean. 0 high, 0 med, 6 low (2 auto-fixed doc/provenance; 4 refuted as intentional/unreachable). Suite verified 79 files / 788 tests green; both golden snapshots byte-stable.

**Method:** 3 adversarial layers (Blind Hunter, Edge/Boundary Hunter, Acceptance Auditor) + independent verification against `git diff HEAD`, `teaching.ts`, `arena-scene.ts:421-435`, `arena-boot.ts`, the fixture, and a fresh `vitest run`.

### AC Summary
- **AC1 (right line auto-surfaces no-action per signature beat, then auto-dismisses; trigger is deterministic/pure):** PASS — `planTeaching` selects `TEACHING[beatType]` and is pure (no Date.now/Math.random/IO); boot pushes ops on the forward tick only (no toggle/open()); finite `dwellMs=4000` armed render-side via `delayedCall`.
- **AC2 (brevity SM-C2 + accuracy-to-event):** PASS — `TEACHING_MAX_LEN=140` single source for schema floor + unit assertion; ≤1 op per beatType per transition (dedupe Set, unit-proven on hand-built double-tagged/fused data); each op carries the firing annotation's `groundingPointer.eventRefs`, all resolving to real overlay events.
- **R1/R4/R5 layer discipline:** PASS — reads frozen L1 overlay + L0 deltas, writes no mechanics field, returns no BattleState; teaching.ts/teaching-config.ts SDK-free + phaser-free (source-grep guard); render→portal import is type-only.
- **Scope boundaries (no 4.4 Legend pulled forward):** PASS — portal/ holds only teaching files + .gitkeep; no on-demand overlay/open(); summon honestly unit-only (fixture omits it by design).

### Findings

**[Low][doc-accuracy] F1 — Reported test count stale (785 vs actual 788)** · `4-3-always-on-beat-teaching.md:81,206` + `sprint-status.yaml`
Raised by: Blind Hunter, Acceptance Auditor. Verified `vitest run` = 79 files / 788 tests (delta +44, not +41). Recommendation: **fix** (applied — counts corrected in story Completion Notes/Task 6 + sprint-status comment).

**[Low][provenance] F2 — sprint-status `last_updated` regressed (08:45→08:37Z)** · `sprint-status.yaml:2`
Raised by: Blind Hunter. Non-monotonic tracking timestamp could confuse resume/ordering. Recommendation: **fix** (applied — bumped to 08:52:00Z, monotonic).

**[Low][render-display] F3 — Multi-op transition collapses to last op on the single teaching band** · `arena-scene.ts:421-435`
Raised by: Edge/Boundary Hunter. `renderTeaching` loops all ops into one shared `teachingText` band (setText+setVisible+arm-timer each), so a 2-op transition shows the earlier line ~0ms. The 2-op case is a tested-valid planner output (`teaching.unit.test.ts:186-205`: dispel+summon co-fire). UNREACHABLE on the committed fixture (no summon; dispel@Beat0 and shaman@discharge never share a transition). Recommendation: **consider** — latent display-correctness gap for richer Epic-5 data; cheap to address by rendering only the last op or documenting/asserting a ≤1-op-per-transition invariant in v0.1.

**[Low][correctness] F4 — Shaman + Summon teaching ops co-fire on a dual-tagged breakthrough (planner emission)** · `teaching.ts:167-185`
Raised by: Blind Hunter, Acceptance Auditor. Shaman gates on `breakthrough && hasShaman`, summon on `breakthrough && summonFires`; a future dual-tagged breakthrough emits both ops. Recommendation: **likely-refute** — intentional, documented v0.1 simplification that faithfully mirrors the approved `planBeatBehaviors` dual-emit; no AC requires single-lesson precedence; unreachable on the fixture. The only user-visible symptom would surface at the render layer (tracked as F3). Revisit precedence if Epic 5 ships summon+shaman on one breakthrough.

**[Low][trigger-accuracy] F5 — Shaman teaching fires on the discharge without requiring the shaman anchor reached this transition (forward-tagged shaman)** · `teaching.ts:161-173`
Raised by: Edge/Boundary Hunter, Acceptance Auditor. Shaman keys on `isBreakthroughDischarge + hasShaman`, not on the shaman beat advancing this transition (unlike beat-behavior's resurrect anchorReached gate). Recommendation: **likely-refute** — BY DESIGN per Dev Notes #3 and AC1's worked example: the lesson intentionally lands on the felt death moment, not the (earlier-advancing) anchor. On the fixture the anchor (Beat[7]) always precedes the discharge (Beat[9]). Consider an `anchorReached`-OR gate only for out-of-order Epic-5 data.

**[Low][immutability] F6 — groundingRefs aliases the frozen overlay's eventRefs array (no copy)** · `teaching.ts:102`
Raised by: Edge/Boundary Hunter. `teachOp` shares the overlay's array instance. Recommendation: **likely-refute** — no mutation path exists: `TeachingOp.groundingRefs` and `AnnotatedView.annotations` are both `readonly`, the render seam reads only `op.text`/`op.dwellMs` (never groundingRefs), and it mirrors beat-behavior.ts. Compile-time readonly fully blocks the risk; a defensive copy would be speculative hardening against an impossible-today scenario.

**[Low][hygiene] F7 — Transient `__probe__.test.ts` scratch test existed mid-session** · `src/portal/__probe__.test.ts`
Raised by: Acceptance Auditor. Recommendation: **likely-refute** — already removed by the dev; absent from the delivered tree (`git ls-files --others` confirms). Nothing to fix.

### Action Items
- [x] F1, F2 auto-fixed in this review pass (doc/provenance only; no source change). RESOLVED — re-verified in fix round 1 (actual count 788/+44; `last_updated` monotonic).
- [x] F3 (consider) RESOLVED in fix round 1: `ArenaScene.renderTeaching` now renders the LAST op (last-op-wins) so a multi-op transition no longer flashes the earlier line ~0ms / churns the timer; pinned by a RED-then-GREEN regression in `arena-teaching.test.ts`. Stacking distinct beatType lines stays deferred to Epic 5.
- [ ] F4/F5 carry forward as documented Epic-5 design decisions (summon+shaman precedence; out-of-order anchor gating) — refuted for v0.1 (intentional/unreachable), no code change.
