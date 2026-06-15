---
baseline_commit: 6cfcdb5
---

# Story 4.4: On-demand Legend / transparency portal

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a curious viewer,
I want to open a fuller fantasy↔real Legend overlay grounded in the real events,
so that I can dig into the mapping without interrupting playback (UJ-2). (FR-11)

## Acceptance Criteria

**AC1 — Legend coverage + non-interrupting toggle**
**Given** the Arena during playback
**When** I open the Legend/transparency portal overlay
**Then** it covers the three beats (Shaman / Dispel / Summon) and the four core actions (strike/edit, spell/test, scout/read, Aether Storm/rate-limit)
**And** it can be opened/closed without interrupting playback.

**AC2 — Grounding resolution (fantasy → real), accurate to the real Event**
**Given** an active beat
**When** I inspect it in the portal
**Then** the portal resolves the beat's `groundingPointer` to show the real Event(s) it dramatizes (fantasy → real)
**And** every explanation is accurate to the real Event.

> Source (verbatim): `epics.md#Story-4.4` L480-495; `prd.md#FR-11` L246-254. This is the **on-demand Legend** — NOT the always-on teaching one-liners (Story 4.3, **done**). v0.1 ships the contextual Legend only; the full unlock-by-encounter collectible Codex is deferred (`prd.md#FR-11 Notes` L256).

### Gate-verifiable vs operator-verified (READ THIS FIRST)

This story has a hard split. Do NOT claim AC completion on the operator-verified half.

- **GATE-VERIFIABLE (Vitest, must be green — this is what "done" means here):**
  1. The Legend content **covers** the 3 beats + the 4 core actions (a unit assertion over the validated content table — every required key present).
  2. The grounding **resolver** maps an active beat's `groundingPointer.eventRefs` to the **correct real Event(s)** — real `eventId`s, accurate, **no dangling ref** (resolved against the Story 3.1 read-only `AnnotatedView`).
  3. Open/close toggles a **portal-visibility state WITHOUT mutating the battle state or the cursor** — assert the reducer `PlaybackState` (`cursor`/`status`/`speed`) AND the `BattleState` are **deep-equal before vs after open→close** (the load-bearing R1/non-interruption proof).
  4. R1 / R4 / R5 discipline holds (portal source SDK-free + phaser-free; resolver writes no mechanics field; `dist/` carries no `anthropic`; golden snapshots byte-stable).
- **OPERATOR-VERIFIED (NOT a gate — watch `pnpm dev`; jsdom advances no Phaser tweens / lays out no real DOM pixels):** the overlay **layout / legibility / feel** — the panel reads clearly, does not cover the spectacle badly, the open/close transition feels right.

## Tasks / Subtasks

- [x] **Task 1 — Author the Legend content as config-as-data + a `.strict()` loader (AC1, AC2-accuracy).** (AC: #1)
  - [x] Add `src/config/legend.json` (config-as-data, NFR-4 — NO hardcoded copy in `.ts`), mirroring `src/config/teaching.json` / `captions.json`. Shape: `$schemaVersion: 1` + a `beats` map keyed by the three `BeatType` members (`shaman | dispel | summon`) + an `actions` map keyed by the four core `ActionType` members (`melee | spell | scout | aetherStorm`). Each entry is `{ fantasy: string, real: string }` (the fantasy↔real mapping row). Keep each string SHORT (the SM-C2 spirit + the rubric note to bound "concise", see Dev Notes #6).
  - [x] Add `src/portal/legend-config.ts` — a Zod `.strict()` exhaustive loader (mirror `teaching-config.ts` VERBATIM in structure): an outer `.object({...}).strict()` with `$schemaVersion: z.literal(1)`, a `beats` `.object({ shaman, dispel, summon }).strict()`, an `actions` `.object({ melee, spell, scout, aetherStorm }).strict()`; each row `z.object({ fantasy: z.string().min(1).max(LEGEND_MAX_LEN), real: z.string().min(1).max(LEGEND_MAX_LEN) }).strict()`. Export `LEGEND_MAX_LEN` (the single brevity source of truth — see Dev Notes #6), `LegendTableSchema`, the inferred `LegendTable` type, and `export const LEGEND = LegendTableSchema.parse(rawLegend)` (validate-at-load, fail-closed — a malformed committed file throws on import).
  - [x] Author the four core-action rows from the REAL translation rules (`src/config/translation-rules.json` — the source of truth for the metaphor): `melee` = strike/edit (Edit/Write tool → integrity damage), `spell` = spell/test (Bash `pnpm test`/`build`/`lint` → opens a strike), `scout` = scout/read (Read/Grep/Glob), `aetherStorm` = Aether Storm/rate-limit (529/overload/backoff/rate-limit → environmental pause). Author the three beat rows from the signature-beat lessons (reuse the register/intent of `teaching.json`, but the Legend row is the fuller fantasy↔real mapping, not the one-liner verbatim — see Dev Notes #2).
  - [x] Add `src/portal/legend-config.unit.test.ts` (the `teaching-config.unit.test.ts` precedent): the loader fails CLOSED on a missing key / a typo'd key / an over-`LEGEND_MAX_LEN` string / an empty string / a bumped `$schemaVersion` (each `.parse` THROWS). This is the fail-closed guard, NOT the coverage gate.

- [x] **Task 2 — The PURE portal core: coverage + the grounding resolver (AC1 coverage, AC2).** (AC: #1, #2)
  - [x] Add `src/portal/portal.ts` — the PURE, phaser-free, node-testable transparency-portal core (the architecture-named module, `architecture.md` L363-364). It exposes:
    - `LEGEND_BEATS: readonly BeatType[]` and `LEGEND_ACTIONS: readonly LegendActionType[]` — the closed coverage domains (string-literal unions, NO numeric enum), so a coverage test and the renderer iterate ONE canonical list. `LegendActionType = 'melee' | 'spell' | 'scout' | 'aetherStorm'` (the four CORE actions the AC names — a SUBSET of `ActionType`; `summon`/`counter`/`idle` are deliberately NOT Legend action rows — see Dev Notes #3).
    - `getLegendEntries(): LegendEntry[]` — a PURE accessor returning the full covered set as a flat, ordered, display-ready list (beats first, then actions), each `{ kind: 'beat' | 'action', key, fantasy, real }`, read straight from the validated `LEGEND` table. This is the renderer's content feed AND the coverage gate's surface.
    - `resolveGrounding(annotation: BeatAnnotation, view: AnnotatedView): readonly NormalizedEvent[]` — the PURE grounding resolver (AC2). Maps `annotation.groundingPointer.eventRefs` (the fantasy beat's full dramatized set) to the REAL Layer-0 `NormalizedEvent[]` they reference, resolved against the read-only `view` (look each `eventRef` up in `view.events` by `eventId`). Returns the resolved events in `eventRefs` order. **Dangling-ref policy: FAIL LOUD** (throw) — see Dev Notes #4. Reads ONLY the read-only overlay; constructs/returns NO `BattleState`/`Beat`; writes NO mechanics field (the R1 data-level proof).
    - (Optional helper) `resolveActiveBeatGrounding(view, beatType): readonly NormalizedEvent[] | null` — convenience: find the (first) annotation of `beatType` in `view.annotations` and resolve it, or `null` if none. Keep it thin; the load-bearing pure unit is `resolveGrounding`.
  - [x] Add `src/portal/portal.test.ts` (PURE, node) — the gate. Prove: (a) `getLegendEntries()` COVERS all 3 beats + all 4 core actions (every `LEGEND_BEATS`/`LEGEND_ACTIONS` key present, each with a non-empty fantasy+real); (b) `resolveGrounding` over the COMMITTED fixture overlay resolves the dispel annotation's grounding (`u-0002#1` etc.) to the real `NormalizedEvent`s with matching `eventId`s, in order, no dangling; (c) the shaman annotation's grounding resolves to its real root-cause events; (d) a FABRICATED dangling ref THROWS (fail-loud); (e) determinism (call-twice deep-equal) + no input mutation (`view`/`annotation` unchanged); (f) the returned events are the SAME real Layer-0 events (accurate — assert a couple of real fields like `eventId`/`toolName` match the fixture).
  - [x] Extend `src/portal/r1-discipline.test.ts` — add `'portal.ts'` and `'legend-config.ts'` to `PORTAL_MODULES` (the SDK-free + phaser-free source-grep) and add `portal.ts` to the no-mechanics-field grep list (mirror the existing `teaching.ts` block). This is the real R4/R5 guard for the new browser-reachable portal modules (portal/ has no eslint zone).

- [x] **Task 3 — The thin render overlay: open/close WITHOUT interrupting playback (AC1 toggle).** (AC: #1)
  - [x] Add `src/render/legend-overlay.ts` — a THIN HTML DOM overlay (the `controls.ts` precedent VERBATIM: imports NO phaser, renderer-agnostic, accessible + jsdom-testable). `createLegendOverlay(opts)` builds a hidden `<div class="legend-overlay">` containing a toggle button + the panel (rendered from `getLegendEntries()` — the fantasy↔real rows for the 3 beats + 4 actions, AND an optional "active beat → real event(s)" grounding section fed by `resolveGrounding`). Exposes `{ root, open(), close(), toggle(), isOpen(), destroy() }`. All listeners bound to one `AbortController` so `destroy()` removes them all (the `controls.ts` AbortController pattern — no leaked listeners on re-boot).
  - [x] **CRITICAL — the non-interruption mechanism (Dev Notes #5, the load-bearing decision):** open/close mutates ONLY the overlay's OWN visibility (`this.isOpen` + `display`/`hidden`). It MUST NOT dispatch any `PlaybackAction`, MUST NOT pause/seek/restart, MUST NOT set `cinematicActive` (the Story 3.4 suspend path — that WOULD interrupt), and MUST NOT touch the reducer/cursor/`BattleState`. The portal is a pure-read render/UI concern layered over the live arena; the rAF loop keeps ticking while it is open (or the viewer pauses via the existing controls — but the portal itself never does). It reads the portal content (pure) + may read the latest snapshot the boot hands it (read-only) to show the active-beat grounding; it pushes NOTHING upstream (R5/AC1 one-way).
  - [x] Add `src/render/legend-overlay.test.ts` (jsdom) — prove: open/close toggles `isOpen()` + the DOM visibility; the panel renders ALL covered rows (3 beats + 4 actions, the coverage half at the DOM level); `destroy()` removes listeners (no dispatch after teardown). Keep DOM-shape assertions light (exact layout is operator-verified).

- [x] **Task 4 — Wire the overlay into the boot, prove open/close does not mutate playback (AC1 toggle — the gate-proof).** (AC: #1)
  - [x] In `src/render/arena-boot.ts`: mount the Legend overlay additively (the `createControls` precedent — into `#app`/`document.body`), handing it `getLegendEntries()` for content and a read-only accessor for the active-beat grounding (e.g. a closure that resolves `resolveGrounding` against the boot's `view` + the current beat). Add `legend` to the returned `ArenaHandle` (a thin handle: `{ open, close, toggle, isOpen }`) so a test (and `main.ts`) can drive it. The boot OWNS the overlay lifecycle (created at boot, torn down in `destroy()` — extend `destroy()` to also tear it down, mirroring `controls.destroy()`).
  - [x] **DO NOT** route the portal through `advanceIfPlaying`'s `cinematicActive` guard, the `onSignal` sink, or any reducer dispatch. The overlay open/close is OUTSIDE the playback data path entirely.
  - [x] Add `src/render/arena-boot-legend.test.ts` (jsdom) — **the AC1 non-interruption gate** (the `arena-boot-caption.test.ts` / `arena-boot-teaching.test.ts` precedent, using a `FakeRenderAdapter`): boot with the fake adapter, capture `getState()` (the reducer `PlaybackState`) AND `getState().battleState` (or render the snapshot) BEFORE; `handle.legend.open()` then `handle.legend.close()`; assert `getState()` is **deep-equal** to the captured state (cursor/status/speed unchanged) AND the `BattleState` is unchanged — and additionally that the overlay never dispatched (the reducer was not called) and `isCinematicActive()` stayed `false`. Also prove the converse positive: ticking the loop still advances while the overlay is open (open does not freeze playback). This is the assertion the synthesizer calls out: "BattleState/cursor are unchanged across open/close."

- [x] **Task 5 — The display seam + a DEV-friendly open hook (operator-verify the layout).** (AC: #1)
  - [x] Add an OPTIONAL one-way `RenderPort` command IF (and only if) the active-beat grounding must be DISPLAYED through the Phaser scene rather than the DOM panel — e.g. `renderLegendGrounding?(events: readonly NormalizedEvent[]): void` (the `renderCaptions?` / `renderTeaching?` precedent: optional `?` for backward-compat, type-only import, boot guards the call, returns void). **PREFER keeping the entire Legend in the DOM overlay** (the `controls.ts` posture — no Phaser needed, fully jsdom-testable); add the RenderPort command ONLY if a Phaser-side reveal is actually required. Decide on documented merits (Dev Notes #5) and record which you chose in Completion Notes.
  - [x] In `src/main.ts`: mount/show the overlay's toggle so the operator can open it during `pnpm dev`. The toggle button (always visible) is the production affordance (UJ-2's "open the Legend"); a `?legend` URL flag behind `import.meta.env.DEV` may auto-open it for convenience (the `?cinematic=` / `?saga` DCE-preview precedent — tree-shaken from prod). Keep this surgical.
  - [x] **Operator verification (NOT a gate):** run `pnpm dev`, open the Legend mid-playback, confirm the 3 beats + 4 actions read clearly, the active-beat grounding shows the real event(s), and open/close does not stutter playback. Record this as operator-verified in Completion Notes (jsdom proves the RUN + the no-mutation invariant, never the pixels).

- [x] **Task 6 — Gates green; finalize.** (AC: #1, #2)
  - [x] `pnpm typecheck` (0 errors), `pnpm lint` (0 — R1/R4/R5 hold; **do NOT touch `eslint.config.ts`**), `pnpm test` (full suite green; baseline 79 files / ~814 cases at HEAD `6cfcdb5`, +new files), `pnpm build` (OK) and confirm `grep -ril anthropic dist/` returns NOTHING (R4). Confirm BOTH golden snapshots (`src/pace/__snapshots__/` + the ingest snapshot) are byte-UNCHANGED (this story adds NO Layer-0 code).
  - [x] Do NOT `git commit` (the operator commits between stories).

### Review Follow-ups (AI)

Senior Developer Review (2026-06-15) raised 5 low-severity findings: 1 `fix`, 4 `likely-refute`. Fix-round-1 disposition (re-verified independently against the tree at this commit):

- [x] **LOW-001 (fix) — Debug Log GREEN test counts.** Verified the actual suite is **83 files / 842 cases** (`pnpm test` re-run this round → 83 passed / 842 passed). Line 196 was already corrected to `83 files / 842 cases` (the measured value, not the raw Edge finding's incorrect `84/843`). No further change needed — confirmed accurate.
- [x] **LOW-002 (refuted) — Boot hand-rolls active-beat grounding; fail-loud on open().** Confirmed: `grep` shows `resolveActiveBeatGrounding` has NO non-test caller (defined + unit-tested in `portal.test.ts:258-275`, unused in prod). The boot deliberately uses latest-reached-beat selection (explicitly commented `arena-boot.ts:346-353`), distinct from the helper's first-match. The committed fixture has exactly one annotation per beatType (`dispel`, `shaman` — `fixture-interpreter.ts:21,29`), so selection is unambiguous today; the frozen-overlay invariant (Story 3.1/3.2) makes a dangling ref unreachable on the `open()` path, and the fail-loud-vs-fail-soft split is exactly what Dev Notes #4 sanctions. No defect — no code change.
- [x] **LOW-003 (refuted) — `LEGEND_BEATS`/`LEGEND_ACTIONS` widened to `readonly[]`.** Confirmed via `tsc` probe: dropping `summon` compiles cleanly (exhaustiveness not type-enforced) while a typo `'shamn'` errors `TS2820`. NOT a defect: coverage is double-pinned by the runtime asserts in `portal.test.ts` AND the exhaustive `.strict()` Zod schema in `legend-config.ts` (both fail loud on a dropped member). Optional `satisfies` hardening declined as out-of-scope (surgical). No code change.
- [x] **LOW-004 (refuted) — Active-beat grounding stale while panel stays open across a cursor advance.** Confirmed: `refreshGrounding()` fires only in `openOverlay()` (`legend-overlay.ts:126`), not on the rAF tick. Intentional + documented open-time-snapshot semantics (`legend-overlay.ts:96-98,126`); operator-verified-feel territory; no AC requires a live tracker. No code change.
- [x] **LOW-005 (refuted) — `LegendEntry` duplicated across `portal.ts` and `legend-overlay.ts`.** Confirmed: portal key `BeatType | LegendActionType` (`portal.ts:44`) vs overlay key `string` (`legend-overlay.ts:20`). Deliberate, in-file-documented decoupling (`legend-overlay.ts:14-17`) to keep the renderer portal-agnostic; narrow→string is assignable and the boot feeds `getLegendEntries()` via structural compat. No defect — no code change.

**Action Items resolution:** LOW-001 resolved (doc count confirmed accurate at 83/842). LOW-002..005 closed as refuted (verified false-positives / documented invariants) — no Action Items remain open. All gates re-run green this round (typecheck 0, lint 0, 83 files / 842 cases, build OK, `grep -ril anthropic dist/` empty).

## Dev Notes

**This is the FINAL Epic-4 story (the capstone).** After 4-4 reaches `done` (dev-story → review → done), epic-4 ALSO flips `in-progress → done` in sprint-status (the Epic-1/2/3 flip-post-senior-review precedent). create-story leaves `4-4` `ready-for-dev` and epic-4 `in-progress`.

### What this story IS and IS NOT (scope fence)

- **IS:** the **on-demand** Legend/transparency portal — a viewer-OPENED overlay covering the 3 beats + the 4 core actions (fantasy↔real), that **resolves an active beat's `groundingPointer` to the real Layer-0 Event(s)** (the transparency reveal, fantasy → real), opens/closes **without interrupting playback**, and keeps the content + the grounding resolver PURE/testable. [epics.md L480-495; prd.md FR-11 L246-254]
- **IS NOT:** the **always-on** plain-dev teaching one-liners — that is **Story 4.3 (done)**, `src/portal/teaching.ts`, which AUTO-surfaces on the tick with no viewer action. Do NOT modify teaching.ts; the Legend is the distinct **on-demand** half of FR-11. [4.3 prior art, this file's references]
- **IS NOT:** the full collectible Codex (deferred, `prd.md` L256/L290), live Captions (4.1, done), the baked Saga (4.2, done), or final art (5.3).

### #1 — Module home: `src/portal/portal.ts` + a thin `src/render/` overlay (RESOLVED)

`architecture.md` L363-364 names `portal/` the transparency-portal home and L143/L378 maps **FR-11 → `portal/` + `render/`**; the synthesizer instruction names `src/portal/portal.ts` explicitly. Story 4.3 already established `portal/` as a browser-reachable, SDK-free, phaser-free zone (the always-on teaching). So: the **content + the grounding resolver live in `portal/portal.ts`** (pure, testable), `portal/legend-config.ts` + `config/legend.json` hold the content (config-as-data), and the **display lives in `render/`** (the thin DOM overlay `render/legend-overlay.ts`, the `controls.ts` precedent). This is the exact split FR-11 (and Story 4.3) already use: selection/content/resolution in `portal/`, pixels/DOM in `render/`. [architecture.md L143, L363-364, L378; src/portal/teaching.ts; src/render/controls.ts]

### #2 — Legend content model = config-as-data (RESOLVED), and why a fuller mapping (not the 4.3 one-liner)

Mirror `teaching-config.ts` / `captions-config.ts` / `model-tuning.ts` VERBATIM: a `.strict()` Zod schema + `LEGEND = LegendTableSchema.parse(rawLegend)` validated at module load (fail-closed). This is the project's universal config-as-data posture (`architecture.md#Structure Patterns` L254-255 — "Config-as-data lives in versioned files, not hardcoded"; NFR-4). An exhaustive `.object(...).strict()` (NOT `z.record`) so a MISSING key fails LOUD at import and a TYPO'd key is rejected — exactly `TeachingTableSchema` / `CaptionsTableSchema`.

The Legend row is a **fantasy↔real PAIR** (`{ fantasy, real }`), distinct from the 4.3 teaching one-liner: 4.3 surfaces ONE plain-dev sentence at the beat; the Legend is the **mapping table** Dana reads on demand ("the hammer strike = a code edit"; "the reviving imps = recurring test failures from one root cause" — `prd.md` UJ-2 L51). Both teach; the Legend AMPLIFIES (the adversarial-review resolution, `review-adversarial.md` L58: "Make Captions themselves teach … and the Legend just amplifies"). Author the four core-action rows from the REAL `translation-rules.json` mapping so they are ACCURATE to the metaphor:
- `melee` → fantasy "hammer strike / forge blow", real "a code edit (Edit/Write) that chips the problem's integrity" (`edit-write-melee` rule, `problemIntegrityDelta: -10`).
- `spell` → fantasy "a channeled spell", real "running the tests/build/lint (`pnpm test`/`build`/`lint`) — it opens the decisive strike" (`bash-spell` rule, `opensStrike: true`).
- `scout` → fantasy "scouting the terrain", real "reading the code (Read/Grep/Glob) to check before acting" (`read-scout` rule).
- `aetherStorm` → fantasy "the Aether Storm — the party waits out the storm", real "an environmental pause (rate limit / 529 / backoff), NOT the hero's failure" (`aether-storm` rules; `prd.md#Glossary` L72, the SM-C1 honesty point).

### #3 — The four CORE actions are a SUBSET of `ActionType` (RESOLVED — do not over-cover)

The AC names exactly four core actions: **strike/edit, spell/test, scout/read, Aether Storm/rate-limit** → `melee | spell | scout | aetherStorm`. The full `ActionType` union (`schema/normalized-event.ts` L19-27) ALSO has `summon | counter | idle`. The Legend's `actions` map covers ONLY the four CORE actions the AC enumerates — `summon` is a BEAT (covered in the `beats` map, not duplicated as an action row), `counter`/`idle` are not "core actions" the viewer needs the Legend for. Define a closed `LegendActionType` union of the four so the schema, the coverage list, and the coverage test all agree. (If a reviewer argues `counter`/`summon`-as-action belong, that is a content choice; the AC's literal four are the gate.) [epics.md L490; prd.md L253; schema/normalized-event.ts L19-27]

### #4 — Grounding resolution = a PURE resolver over the read-only `AnnotatedView`; dangling refs FAIL LOUD (RESOLVED)

The resolver is the AC2 core. `BeatAnnotation.groundingPointer.eventRefs` is the FULL set of Layer-0 event ids the beat dramatizes (`schema/beat-annotation.ts` L8-14 — "Resolves a beat back to the Layer-0 event(s) it dramatizes (the portal's grounding feature)"; `architecture.md` L274-275 — "every `BeatAnnotation` carries a `groundingPointer` … so the transparency portal can always resolve fantasy → real"). Resolve each `eventRef` to its `NormalizedEvent` via the read-only `view` (`view.events.find(e => e.eventId === ref)` — the overlay already pairs events + annotations side-by-side, `interpret/overlay.ts`; `view.byEventRef` indexes the other direction, event→annotations).

**Dangling-ref policy: FAIL LOUD (throw).** Rationale: the overlay is built from the SAME committed events the annotations were authored against (`arena-boot.ts` L128 `applyOverlay(events, fixtureAnnotations())`), and Story 3.1/3.2 ALREADY enforce "every `groundingPointer.eventRef` resolves to a real fixture eventId (no dangling refs)" as a build-time invariant (sprint-status 3-1 AC2; `freezeAnnotations` throws on a dangling grounding ref, sprint-status 3-2 F5). So a dangling ref at portal-resolve time is a CORRUPT-overlay programmer error, not a runtime-viewer condition — fail loud (the "Ingest validation fails LOUD" / fail-closed-LOUD-at-build posture, `architecture.md` L280-281), don't silently drop. This also makes AC2's "every explanation accurate to the real Event / resolve to real eventIds, no dangling" a HARD gate (the throw is the proof). Contrast with the replay-time fail-closed-to-default (unmapped EVENTS get a neutral idle beat) — that is a different boundary (untrusted raw input at replay), not a frozen-overlay invariant. Document this contrast in code so a reviewer does not "fix" it to silent-skip.

**R1 (the load-bearing property):** `resolveGrounding` READS the read-only overlay and returns `readonly NormalizedEvent[]`. It constructs/returns NO `BattleState`/`Beat`, writes NO mechanics field (`problemIntegrity`/`resolve`/`insightGauge`/`hp`/`weight`), and imports everything as TYPES. The events it returns are Layer-0 truth READ side-by-side, never folded into mechanics — the structural R1 embodiment the overlay already guarantees (`interpret/overlay.ts` L4-9). The r1-discipline grep + the no-input-mutation test are the proofs.

### #5 — Open/close WITHOUT interrupting playback (RESOLVED — the most consequential decision)

The mechanism is a **render/UI-only visibility toggle that touches NOTHING in the playback path** — modeled on `controls.ts` (a DOM overlay wired to the reducer) but, unlike controls, the Legend dispatches NO `PlaybackAction` at all.

Why this satisfies "without interrupting playback" by construction:
- Playback is driven by the **status-gated rAF loop** in `arena-boot.ts` (L244-322): `advanceIfPlaying` ticks the reducer ONLY while `status === 'playing'`. The portal NEVER calls `dispatch`, NEVER pauses, NEVER sets `cinematicActive`. So opening it changes NO loop input — the loop keeps ticking exactly as before (if playing) or stays paused (if the viewer paused via controls). [arena-boot.ts L244-322]
- **Do NOT reuse the Story 3.4 cinematic-suspend posture.** The dev-preview cinematics SET `cinematicActive` which SUSPENDS the forward tick (`advanceIfPlaying` L257-264) — that is precisely an INTERRUPTION. The Legend is the OPPOSITE: it must be invisible to the loop. This is the key distinction from the synthesizer's "reuse the 2.2 reducer / 2.5 controls posture" — reuse the **one-way, reducer-owns-state** POSTURE (render reads, never recomputes), NOT the cinematic guard. [arena-boot.ts L177-191, L257-264]
- The reducer stays PURE/time-free and is the SOLE owner of `cursor`/`status`/`speed` (`model/playback.ts` L37-40). The portal cannot move them because it holds no dispatch edge to the reducer (R5/AC1 one-way: data flows reducer → render, never back; `render-port.ts` L11-15).

The **gate proof** (Task 4): snapshot `PlaybackState` (and `BattleState`) before, `open()` then `close()`, assert deep-equal after. Because the portal has no path to the reducer, this is true by construction — the test PINS it so a future refactor that wires a stray dispatch fails RED. Also assert the loop still advances while open (open does not freeze playback). [synthesizer instruction "assert the BattleState/cursor are unchanged across open/close"]

DOM overlay vs Phaser overlay: prefer the **DOM overlay** (`render/legend-overlay.ts`, the `controls.ts` precedent) — no phaser import (renderer-agnostic, R5 trivially satisfied), accessible, fully jsdom-testable WITHOUT booting Phaser. Add a `RenderPort.renderLegendGrounding?()` Phaser command ONLY if a Phaser-side reveal is genuinely needed (Task 5); default to DOM. Record the choice in Completion Notes.

### #6 — Brevity bound `LEGEND_MAX_LEN` (RESOLVED — closes the rubric's open finding)

The PRD review rubric flagged FR-11's "concise" Legend explanations as UNBOUNDED (`review-rubric.md` L35: "'concise' is not bounded. Fix: optionally cap length"). Close it: `LEGEND_MAX_LEN` is the single brevity source of truth (mirror `TEACHING_MAX_LEN = 140`; the Legend row has TWO short strings, so a similar per-string bound — pick ~120-160 and reference it from BOTH schema fields + the unit test). This makes "concise" gate-checkable and matches SM-C2's "don't bury the action" spirit. [review-rubric.md L35; src/portal/teaching-config.ts L23]

### #7 — Reuse, DO NOT reinvent (anti-wheel-reinvention)

- The L1→L0 grounding link is ALREADY modeled: `view.byEventRef` (event→annotations) and `view.events` (the ordered Layer-0 truth). The resolver is a thin lookup, NOT a new index. [interpret/overlay.ts]
- The config-as-data loader pattern is `teaching-config.ts` / `captions-config.ts` / `model-tuning.ts` — copy its shape. Do NOT invent a new validation style.
- The DOM-overlay-wired-to-the-boot pattern is `controls.ts` + its `createControls` mount in `arena-boot.ts` (L327-334) + the `AbortController` teardown. Copy it.
- The additive one-way `RenderPort.x?()` command pattern (if needed) is `renderCaptions?` / `renderTeaching?` / `renderSaga?`. Copy it (optional `?`, type-only import, boot-guarded call).
- The "active beat" concept: the boot already knows the current cursor + the `beatsAdvanced` per tick; the overlay's active-beat grounding can resolve the annotation(s) firing at/around the current cursor via the SAME `annotationsFiringInBeats`-style fold teaching.ts/captions.ts use (or simply resolve a chosen beatType's annotation). Keep it pure + read-only.

### #8 — R-rules quick reference (the gates that MUST hold)

- **R1 (Layer discipline):** portal/ reads the FROZEN read-only Layer-1 overlay + Layer-0 events; writes NO mechanics; returns no BattleState/Beat. The grep + no-mutation test prove it. portal/ NEVER imports `src/interpret/`'s WRITE path (there is none) and is never imported BY Layer-0. [architecture.md L225-228]
- **R4 (LLM isolation):** the Legend is TEMPLATED config-as-data — NO LLM, NO network anywhere. portal/ is browser-reachable, so `portal.ts` + `legend-config.ts` MUST stay SDK-free (the r1-discipline grep) and `grep -ril anthropic dist/` MUST be NOTHING. [architecture.md L236-238]
- **R5 (RenderPort one-way):** phaser stays in `render/` + `game/`. The Legend SELECTION/content/resolution is in `portal/` (no phaser); DISPLAY (DOM or the optional Phaser command) is in `render/`. The overlay imports NO phaser (the controls.ts posture). [architecture.md L239-241]
- **R2 (determinism):** the resolver + content accessors are PURE (no `Date.now`/`Math.random`/IO/global-mutable-state); same inputs → deep-equal output. No Layer-0 code added → both golden snapshots byte-stable.
- **Do NOT relax/disable any lint rule or edit `eslint.config.ts`** to pass — fix the code instead.

### Project Structure Notes

- **NEW files** (additive — no Layer-0/schema/lint-config edits): `src/config/legend.json`, `src/portal/legend-config.ts`, `src/portal/legend-config.unit.test.ts`, `src/portal/portal.ts`, `src/portal/portal.test.ts`, `src/render/legend-overlay.ts`, `src/render/legend-overlay.test.ts`, `src/render/arena-boot-legend.test.ts`.
- **UPDATE files** (surgical): `src/render/arena-boot.ts` (mount the overlay + add `legend` to `ArenaHandle` + tear it down in `destroy()`), `src/portal/r1-discipline.test.ts` (add the two new modules to the greps), `src/main.ts` (mount the toggle / optional `?legend` dev flag), and IF a Phaser reveal is chosen: `src/render/render-port.ts` (+ `phaser-render-adapter.ts` + `phaser/arena-scene.ts`) for the optional `renderLegendGrounding?` command — otherwise leave the Phaser scene untouched.
- Naming: kebab-case files; `PascalCase` types; Zod `export const XxxSchema` + `export type Xxx = z.infer<...>`; string-literal unions (NO numeric enums); internal JSON camelCase; explicit `null` over `undefined`. Co-located `*.test.ts`. [architecture.md#Naming Patterns L243-252]
- The portal core (`portal.ts`) holds NO phaser; the testable logic lives in `src/portal/` so `vitest` (`src/**/*.test.ts`) runs it (the teaching.ts / captions.ts precedent — pure logic in a non-render dir, display in render/).

### Current-state of the files this story UPDATES (read before editing)

- **`src/render/arena-boot.ts`** (read in full): owns `state: PlaybackState` + the reducer + the adapter + the `createControls` overlay (mounted into `#app`/`document.body`, L327-334) + the status-gated rAF loop (L342-354) + `destroy()` (L359-366, cancels rAF then tears down controls + adapter). The `view: AnnotatedView` is built ONCE at boot (L128). **What this story changes:** mount the Legend overlay alongside controls (handing it `getLegendEntries()` + a read-only grounding accessor over `view`), add `legend` to the returned `ArenaHandle`, and extend `destroy()` to tear it down. **What must be preserved:** the rAF loop, the reducer ownership, the one-way data flow, `destroy()`'s rAF-cancel-first ordering, the dormant Saga/cinematic wiring. Do NOT touch `advanceIfPlaying`'s tick/guard logic.
- **`src/portal/r1-discipline.test.ts`** (read in full): greps `PORTAL_MODULES = ['teaching.ts','teaching-config.ts']` for SDK/phaser + greps `teaching.ts` for mechanics keys. **What this story changes:** add `'portal.ts'` + `'legend-config.ts'` to `PORTAL_MODULES` and add a `portal.ts` no-mechanics grep block (mirror the teaching block). **Preserve** the existing teaching greps.
- **`src/main.ts`** (read in full): boots the arena on `DOMContentLoaded`, has the `?saga` (4.2) + `?cinematic=` (3.4/3.5) DEV-gated preview flags. **What this story changes:** ensure the Legend toggle is reachable (the always-visible affordance) + optional `?legend` DEV auto-open. **Preserve** the existing dev flags + the `import.meta.env.DEV` DCE gating.
- **`src/render/render-port.ts`** (read only if adding the Phaser command): the one-way interface; every cross-layer command is OPTIONAL `?` + type-only import + boot-guarded. If you add `renderLegendGrounding?`, follow the `renderTeaching?` precedent EXACTLY. **Preserve** every existing command.

### Testing standards summary

- Vitest, co-located `*.test.ts`; `// @vitest-environment jsdom` for DOM/Phaser tests (the `arena-teaching.test.ts` / `controls.test.ts` precedent), node default for pure tests.
- Layer-0 determinism is guarded by the committed golden snapshots (`src/pace/__snapshots__/` + the ingest snapshot) — this story adds NO Layer-0 code, so both MUST stay byte-stable (assert via `git diff` / the snapshot run not updating).
- Gate-verifiable proofs: coverage (3 beats + 4 actions present), grounding resolution (correct real eventIds, no dangling, fail-loud on a fabricated ref), the open/close-no-mutation invariant (deep-equal `PlaybackState` + `BattleState`), R1/R4/R5 source-greps, `grep -ril anthropic dist/` empty.
- Operator-verified (NOT gates, document as such): overlay layout / legibility / open-close feel (jsdom advances no Phaser tweens, lays out no real pixels).
- The committed fixture tags `dispel@u-0002#1` + `shaman@u-0010#0` (the FixtureInterpreter); `summon` is OMITTED by design (the 3.3/3.4 honest gap). So grounding-resolution gates run END-TO-END for dispel + shaman on the real fixture; a hand-built annotation covers the summon grounding shape if you want symmetry (unit-only, the established precedent).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-4.4 L480-495] — the verbatim ACs.
- [Source: _bmad-output/planning-artifacts/prds/prd-dev-chronicles-2026-06-14/prd.md#4.6 FR-11 L240-256] — FR-11 consequences (3 beats + 4 core actions; open/close without interrupting; accurate to the real Event).
- [Source: _bmad-output/planning-artifacts/prds/prd-dev-chronicles-2026-06-14/prd.md#UJ-2 L48-53] — the curious-viewer journey ("hammer strike = a code edit", "reviving imps = recurring test failures from one root cause").
- [Source: _bmad-output/planning-artifacts/prds/prd-dev-chronicles-2026-06-14/review-rubric.md L35] — the "concise" Legend explanation is unbounded → cap length (LEGEND_MAX_LEN).
- [Source: _bmad-output/planning-artifacts/architecture.md#R1-R5 L225-241; #portal L143,L363-364; #FR-mapping L378; #grounding L274-275; #config-as-data L254-255] — the layer discipline, portal home, grounding pointer, config-as-data.
- [Source: src/portal/teaching.ts; src/portal/teaching-config.ts; src/config/teaching.json] — Story 4.3 (the ALWAYS-ON sibling; mirror its config-as-data + portal posture, do NOT modify it).
- [Source: src/interpret/overlay.ts] — `AnnotatedView` (`events` / `annotations` / `byEventRef`), the read-only L1↔L0 link the resolver reads.
- [Source: src/schema/beat-annotation.ts L8-14, L19-29] — `BeatAnnotation` + `groundingPointer.eventRefs` (the full dramatized set).
- [Source: src/config/translation-rules.json] — the REAL fantasy↔real mapping the four core-action rows must be accurate to.
- [Source: src/render/controls.ts] — the DOM-overlay + AbortController teardown precedent for `legend-overlay.ts`.
- [Source: src/render/arena-boot.ts L114-380] — the boot wiring, the status-gated rAF loop, `createControls` mount, `destroy()`, the `view` build.
- [Source: src/render/render-port.ts L56-90] — the optional one-way command precedent (`renderCaptions?`/`renderTeaching?`) IF a Phaser reveal is added.
- [Source: src/model/playback.ts L37-40] — `PlaybackState = { status, cursor, speed }`, the reducer-owned authoritative state the portal must not mutate.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMAD dev-story workflow, autonomous single-pass).

### Debug Log References

- RED baseline at HEAD `6cfcdb5`: `pnpm test` → 5 failed files / 11 failed cases (the 5 committed ATDD files), 789 passed; 78 passed files.
- GREEN after implementation: `pnpm test` → **83 files / 842 cases, all passing**; `pnpm typecheck` 0 errors; `pnpm lint` 0 errors (R1/R4/R5 hold, `eslint.config.ts` untouched); `pnpm build` OK; `grep -ril anthropic dist/` → empty (R4); both golden snapshots (`src/pace/__snapshots__/` + ingest) byte-unchanged.
- Two ATDD-scaffold lint/typecheck failures fixed (documented, see Completion Notes): unused imports/helpers the red files left in (`pace`/`translate` in `portal.test.ts`; the full unused `runIngest`/`timeline()`/ingest chain in `arena-boot-legend.test.ts`). No assertion referenced them; nothing weakened.

### Completion Notes List

**GATE-PROVEN (Vitest — this is what "done" means here):**
- **AC1 coverage** — `getLegendEntries()` covers the 3 beats + 4 core actions (`LEGEND_BEATS` / `LEGEND_ACTIONS` exhaustive, each row non-empty), proven in `portal.test.ts`; the loader fails CLOSED on missing/typo'd/over-length/empty/bumped-version (`legend-config.unit.test.ts`); the committed `legend.json` honors `LEGEND_MAX_LEN=160` (longest authored string = 126).
- **AC2 grounding resolution** — `resolveGrounding` maps the committed dispel annotation to the real events `u-0002#1, u-0002#2, u-0003#0` and the shaman annotation to `u-0009#0, u-0010#0`, IN ORDER, end-to-end on the committed fixture overlay (the same `applyOverlay(events, fixtureAnnotations())` the boot builds); returns the SAME object identities the overlay carries (accurate, read side-by-side); a fabricated dangling ref FAILS LOUD (throws); deterministic + mutates neither input; the resolved events carry no injected mechanics field. Summon symmetry is unit-only (the FixtureInterpreter omits summon by design — the 3.3/3.4 honest gap).
- **AC1 non-interruption (the load-bearing gate)** — open→close leaves the reducer `PlaybackState` (cursor/status/speed) AND the `BattleState` DEEP-EQUAL, drives NO render command, and `isCinematicActive()` stays `false`, both PAUSED and mid-PLAYING (`arena-boot-legend.test.ts`); the converse positive holds — the rAF loop keeps advancing while the overlay is open. True by construction: the overlay holds no dispatch edge to the reducer; the gate PINS it so a future stray dispatch fails RED.
- **R1/R4/R5** — `r1-discipline.test.ts` greps `portal.ts` + `legend-config.ts` SDK-free + phaser-free and `portal.ts` for no-mechanics-field; lint's R1/R4/R5 boundaries pass unchanged; `grep -ril anthropic dist/` empty; the `?legend` DEV flag dead-code-eliminates from the prod bundle (0 occurrences, same as `?saga`/`?cinematic`) while the overlay's content/classNames ship; both golden snapshots byte-stable (no Layer-0 code added).

**DISPLAY-SEAM DECISION (Task 5):** kept the ENTIRE Legend in the DOM overlay (`render/legend-overlay.ts`, the `controls.ts` posture — no phaser, fully jsdom-testable). Did NOT add a `RenderPort.renderLegendGrounding?` Phaser command: the active-beat grounding is shown in the DOM panel (fed by a pure read-only closure resolving `resolveGrounding` against the boot's `view` + the live cursor). No Phaser-side reveal was required, so `render-port.ts` / the Phaser scene are UNTOUCHED.

**OPERATOR-VERIFIED (NOT a gate — requires `pnpm dev`; jsdom advances no Phaser tweens / lays out no real pixels):** the overlay layout / legibility / open-close FEEL — that the panel reads clearly mid-playback, does not cover the spectacle badly, and the open/close transition feels right. Open via the always-visible "Legend" toggle button (the production affordance) or `pnpm dev` with `?legend` (DEV auto-open). This half is NOT claimed complete by the gate.

**Documented deviations:**
- 1 unit test ADDED on top of the ATDD suite per the workflow (`legend-config.unit.test.ts` was already a committed red file; the portal core's coverage + grounding gate is `portal.test.ts`). No extra unit files were needed beyond the ATDD set.
- Fixed two ATDD-scaffold lint/typecheck failures (NOT wrong expectations — genuinely dead imports/helpers the red files copied verbatim from sibling tests but never referenced): removed `pace`/`translate` from `portal.test.ts` and the unused `runIngest`/`readFixture`/`timeline()`/ingest-import chain from `arena-boot-legend.test.ts`. Each removal is annotated in-file with the justification; no `expect` referenced the removed code, so no assertion was weakened.
- `LEGEND_MAX_LEN = 160` (vs `TEACHING_MAX_LEN = 140`) because the Legend row is a fuller two-sided fantasy↔real PAIR, not the 4.3 one-liner (Dev Notes #6 sanctions ~120–160).

**Scope note:** sprint-status `4-4` flipped `in-progress → review` (NOT `done`) per the dev-story workflow Step 9 + the project's documented "dev-story flips to review, senior-review flips to done" convention applied to every prior story (1-1..4-3). The `4-4 → done` AND `epic-4 → done` flips are the senior-review step (the story Dev Notes itself states epic-4 flips "after 4-4 reaches done (dev-story → review → done)"). This is surfaced rather than silently done both ways.

### Completion Status

GATE-VERIFIABLE half: COMPLETE (all gates green). OPERATOR-VERIFIED half (overlay layout/legibility/feel): pending operator watch of `pnpm dev` — not gate-provable.

**Senior-review fix round 1 (2026-06-15):** all 5 low-severity findings dispositioned. LOW-001 (the only `fix`) confirmed already-applied and accurate (suite re-measured at 83 files / 842 cases). LOW-002..005 confirmed false-positives / documented invariants and refuted with independent verification (grep for the unused helper's callers, a `tsc` exhaustiveness probe, and source-line confirmation of the open-time-snapshot + dual-`LegendEntry` decoupling) — NO source code changed (the findings are documented design decisions or double-guarded by runtime+schema). Gates re-run GREEN: `pnpm typecheck` 0, `pnpm lint` 0 (R1/R4/R5 hold, `eslint.config.ts` untouched), `pnpm test` 83 files / 842 cases all passing, `pnpm build` OK, `grep -ril anthropic dist/` empty. Story Status flipped `review → done`; sprint-status `4-4 → done` (epic-4 left `in-progress` for the operator's epic capstone flip).

### File List

**New (additive):**
- `src/config/legend.json` — the fantasy↔real mapping table (config-as-data): 3 beats + 4 core actions, authored accurate to `translation-rules.json`.
- `src/portal/legend-config.ts` — the `.strict()` exhaustive Zod loader + `LEGEND_MAX_LEN` + `LEGEND` (validate-at-load, fail-closed). Mirrors `teaching-config.ts`.
- `src/portal/portal.ts` — the PURE transparency-portal core: `LEGEND_BEATS` / `LEGEND_ACTIONS` / `LegendActionType` / `LegendEntry` / `getLegendEntries()` / `resolveGrounding()` / `resolveActiveBeatGrounding()`.
- `src/render/legend-overlay.ts` — the THIN HTML DOM overlay (`createLegendOverlay`): toggle button + panel + optional grounding section; `{ root, open, close, toggle, isOpen, destroy }`; AbortController teardown; no phaser.
- `src/portal/legend-config.unit.test.ts` — ATDD red→green (loader fail-closed guard).
- `src/portal/portal.test.ts` — ATDD red→green (coverage + grounding-resolution gate). Removed 2 unused scaffold imports.
- `src/render/legend-overlay.test.ts` — ATDD red→green (jsdom open/close + coverage-at-DOM + teardown).
- `src/render/arena-boot-legend.test.ts` — ATDD red→green (the AC1 non-interruption gate). Removed the unused ingest-chain scaffold.

**Updated (surgical):**
- `src/render/arena-boot.ts` — mount the Legend overlay additively alongside controls (pure read-only grounding accessor), add `legend` to `ArenaHandle`, tear it down in `destroy()`.
- `src/portal/r1-discipline.test.ts` — ATDD red→green: `portal.ts` + `legend-config.ts` added to the SDK-free/phaser-free greps + a `portal.ts` no-mechanics block.
- `src/main.ts` — the always-visible toggle is the production affordance; added the DEV-only `?legend` auto-open flag (DCE'd from prod).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `4-4` `in-progress → review`.
- `_bmad-output/implementation-artifacts/4-4-transparency-portal.md` — `baseline_commit` frontmatter, Status `→ review`, Tasks checked, this record.

## Senior Developer Review (AI)

**Reviewer:** Andres Felipe Grisales (AI-assisted adversarial review — Blind Hunter + Edge/Boundary Hunter + Acceptance Auditor, triaged & verified).
**Date:** 2026-06-15
**Outcome:** APPROVE. All 7 acceptance criteria pass with end-to-end evidence; gate-verifiable half is complete (typecheck 0, lint 0, build OK, `grep -ril anthropic dist/` empty, both golden snapshots byte-stable, full suite 83 files / 842 cases green). No high/medium-severity defects. Findings are all low-severity observations or documented invariants; one doc-drift fix applied (see LOW-001). The operator-verified half (overlay layout/legibility/feel) remains pending an operator watch of `pnpm dev` and is not gate-provable. Status NOT changed and nothing committed per review protocol.

### Findings

| ID | Severity | Recommendation | Location | Layers | Finding & Why |
|----|----------|----------------|----------|--------|---------------|
| LOW-001 | low | fix (applied) | `4-4-transparency-portal.md:196` (Debug Log GREEN line) | Edge/Boundary | Debug Log claimed `83 files / 833 cases`. Verified actual = **83 files / 842 cases** (`pnpm vitest run`; 4.4 contributes 58 cases across 5 files). Doc drift — recorded evidence no longer matched the tree (later TEST-REVIEW additions). NOTE: the raw Edge finding proposed `84 files / 843 cases`, which is itself wrong; corrected to the measured `83 / 842`. Fixed in this review. |
| LOW-002 | low | likely-refute | `src/render/arena-boot.ts:356-372` (`getActiveGrounding`) | Blind + Edge/Boundary (merged) | Two lenses on one code region: (a) the boot hand-rolls latest-reached-beat selection instead of reusing the exported `resolveActiveBeatGrounding` (first-match), which is exported+unit-tested but unused in production; (b) `getActiveGrounding` calls `resolveGrounding` (fail-loud-on-dangling) on the interactive `open()` path. NOT a present defect: all committed fixture annotations resolve (one annotation per beatType; verified dispel@idx, shaman@idx), the frozen-overlay invariant (Story 3.1/3.2) makes a dangling ref unreachable, and the divergent-vs-helper semantics are explicitly chosen + commented (arena-boot.ts:346-353). The fail-loud-vs-fail-soft boundary split is exactly what Dev Notes #4 distinguishes. Refute as a defect; latent-confusion only if a 2nd annotation per beatType is ever authored (a future-Epic concern, no fixture today). |
| LOW-003 | low | likely-refute | `src/portal/portal.ts:34-35` (`LEGEND_BEATS`/`LEGEND_ACTIONS`) | Edge/Boundary | Both consts are annotated `readonly BeatType[]` / `readonly LegendActionType[]`, widening past the `as const` tuple. Verified via tsc probe: a TYPO is caught (TS2820) but a MISSING member (e.g. omitting `summon`) compiles cleanly — exhaustiveness is not type-enforced. NOT a defect: the 3-beat/4-action coverage is pinned by the runtime assertions in `portal.test.ts` AND the exhaustive `.strict()` Zod schema in `legend-config.ts` (both fail loud on a dropped member). Minor: the line-33 comment calls them "readonly literal tuples" though the annotation widens them — cosmetic, not behavioural. A `satisfies` tuple would add a cheap compile-time backstop but is optional hardening, not a fix. |
| LOW-004 | low | likely-refute | `src/render/legend-overlay.ts:124-128` (`openOverlay`→`refreshGrounding`) | Edge/Boundary | `refreshGrounding()` runs only on `openOverlay()`, not on the rAF tick, so the grounding text is stale if the panel stays open across a cursor advance (open during Dispel, playback crosses to Shaman → still shows Dispel until close+reopen). NOT a defect: this is intentional + documented open-time-snapshot semantics ("reflect the CURRENT active beat at open time", overlay.ts:96-98, 126) and falls in operator-verified-feel territory the gate cannot adjudicate. No AC requires a live tracker. If a live reveal is later desired, the boot already owns the tick and could push `refreshGrounding`. |
| LOW-005 | low | likely-refute | `src/render/legend-overlay.ts:18-23` vs `src/portal/portal.ts:42-47` (dual `LegendEntry`) | Blind | `LegendEntry` is declared twice — portal with `key: BeatType \| LegendActionType`, overlay with `key: string`. NOT a defect: this is a deliberate, in-file-documented decoupling (overlay.ts:14-17) so the renderer stays portal-agnostic; the narrow→string widening is assignable and the boot feeds `getLegendEntries()` into the overlay via structural compatibility. Future silent shape-drift is theoretically possible (a field added to one side won't error on the other), but both are tiny transient view types co-evolving in one story slice. A `satisfies` pin at the boot seam is optional hardening, not required. |

### Triage Summary

- **fix:** 1 (LOW-001, applied — doc count corrected to 83 / 842).
- **consider:** 0.
- **likely-refute (verified false-positive / documented-invariant):** 4 (LOW-002..005). Each is either an explicitly-commented design decision, double-guarded by runtime+schema, or operator-verified-feel territory outside the gate. None are auto-fixed.

No high or medium findings. The portal core (`portal.ts`) is genuinely pure (no `Date.now`/`Math.random`/IO, returns referential identities from the overlay, writes no mechanics field — confirmed by `r1-discipline.test.ts` greps), the overlay is non-interrupting by construction (mutates only `panel.hidden`, dispatches nothing — pinned by `arena-boot-legend.test.ts`), and the config-as-data loader is fail-closed (`.strict()` Zod at module load). Architecture and layer discipline (R1/R4/R5) are clean.

### Acceptance Criteria Summary

| AC | Verdict | Notes |
|----|---------|-------|
| AC1 — Legend covers 3 beats (Shaman/Dispel/Summon) + 4 core actions (strike/edit, spell/test, scout/read, Aether Storm/rate-limit) | PASS | `getLegendEntries()` emits exactly 7 ordered rows (beats then actions) from `LEGEND_BEATS`+`LEGEND_ACTIONS`; `portal.test.ts` asserts count/keys/non-empty pairs + excludes summon/counter/idle from actions; DOM coverage proven in `legend-overlay.test.ts`; content authored from `translation-rules.json`. |
| AC1 — Legend opens/closes without interrupting playback | PASS | Open/close mutates only `panel.hidden`; no dispatch/pause/seek/cinematic. Gate (`arena-boot-legend.test.ts`) deep-equals PlaybackState + battleState across open→close in PAUSED & PLAYING with 0 render calls and `isCinematicActive()===false`; converse test confirms the rAF loop keeps advancing while open. |
| AC2 — Portal resolves the beat's groundingPointer to the real Event(s) (fantasy→real) | PASS | `resolveGrounding` maps `groundingPointer.eventRefs`→`view.events` by `eventId`, in order, fail-loud on dangling; fixture dispel/shaman resolve end-to-end; live cursor→active-beat→DOM reveal proven; dangling throws (`portal.test.ts:170-184`). |
| AC2 — Every explanation accurate to the real Event (real eventIds, no fabrication) | PASS | Resolver returns the SAME object identities the overlay carries (referential `e===fromView`), real fields asserted, no injected mechanics field (`hasOwnProperty` false for problemIntegrity/resolve/insightGauge/hp/weight). Summon symmetry unit-only by fixture design. |
| R1/R4/R5 layer discipline (portal SDK-free + phaser-free, pure resolver, display in render/, no anthropic in dist) | PASS | `r1-discipline.test.ts` greps `portal.ts`+`legend-config.ts`; no `Math.random`/`Date.now`/phaser import; typecheck 0, lint 0, build OK, `grep -ril anthropic dist/` empty; both golden snapshots byte-stable. |
| config-as-data Legend content + fail-closed loader (LEGEND_MAX_LEN brevity bound) | PASS | `legend.json` holds all copy; `legend-config.ts` exhaustive `.strict()` Zod (schemaVersion literal, beats/actions, `LEGEND_MAX_LEN=160`, parsed at load); unit test proves fail-closed on missing/typo/over-len/empty/version-bump; committed strings within bound. |
| Scope boundaries (on-demand Legend only; no 4.3 always-on teaching pulled forward; later-story Codex deferred; epic-4 not prematurely flipped) | PASS | `teaching.ts` untouched; always-visible toggle is the production affordance, `?legend` DEV-only; sprint-status keeps epic-4 in-progress with 4-4 at `review` (not done) per the documented dev-story→review→done convention; full suite green, no regression. |

## Change Log

| Date | Version | Change | Author |
|------|---------|--------|--------|
| 2026-06-15 | 1.0 | dev-story implementation: on-demand Legend / transparency portal (config-as-data + `.strict()` loader, pure portal core with coverage + grounding resolver, thin DOM overlay, boot wiring + AC1 non-interruption gate). Status → review. | Amelia (dev-story) |
| 2026-06-15 | 1.1 | Senior Developer Review (AI) appended: APPROVE, 5 low findings (1 fix / 4 likely-refute), no high/medium defects. | Andres Felipe Grisales (AI review) |
| 2026-06-15 | 1.2 | Review fix round 1: LOW-001 confirmed applied + accurate (83 files / 842 cases); LOW-002..005 refuted with independent verification (no source change — documented invariants / double-guarded). Review Follow-ups (AI) subsection added. All gates re-run green. Status → done; sprint-status `4-4 → done` (epic-4 left in-progress). | Amelia (review fix round 1) |
