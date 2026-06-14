---
stepsCompleted: [1, 2, 3, 4]
status: 'complete'
completedAt: '2026-06-14'
inputDocuments:
  - '_bmad-output/planning-artifacts/prds/prd-dev-chronicles-2026-06-14/prd.md'
  - '_bmad-output/planning-artifacts/prds/prd-dev-chronicles-2026-06-14/addendum.md'
  - '_bmad-output/planning-artifacts/architecture.md'
---

# dev-chronicles - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for dev-chronicles, decomposing the requirements from the PRD and Architecture requirements into implementable stories. (No UX Design document exists for v0.1.)

## Requirements Inventory

### Functional Requirements

FR-1: Parse a curated Session (Claude Code transcript JSONL + `.omc/state/*.jsonl`) into a deterministic, normalized, ordered Event timeline.
FR-2: Apply an Annotation Sidecar that tags the three special narrative beats (Fallen Shaman, Dispel, breakthrough/Eidolon Summon); annotation is data, not code; invalid Event references fail loud.
FR-3: Map each Event to Battle Action(s) via an ordered, declarative ruleset (Edit/Write→melee, Read/Grep→scout, Bash test→spell, Task→summon, failing test→enemy counter, scout-before-strike→Mirage vs solid, environmental hazard→Aether Storm); unmatched Events produce a defined default, never a crash.
FR-4: Translate the three signature beats into their specified Battle Actions (Shaman resurrects imps until defeated then clears swarm; Dispel shatters Mirage + Resolve stagger + Scribe self-correction; Eidolon Summon fires on charged Insight Gauge at breakthrough).
FR-5: Maintain single-Arena, turn-based battle state from the Battle Action stream — Problem Integrity + Resolve bars, Insight Gauge (charges on struggle, discharges on breakthrough), live Enemy instances; reproducible per timeline position; Boss defeated on completion Event.
FR-6: Provide deterministic playback controls — play, pause, restart, scrub to any point (correct state), at least one speed control; identical experience on replay.
FR-7: Render the Arena and core combat animations — Forgemaiden (idle/forge-strike/cast/stagger/rise), Hammer Flurry for edit bursts, distinct Enemy types with hit/death, health bars + Insight Gauge, Aether Storm visual; smooth frame pacing.
FR-8: Render the three signature cinematics — THUNDORR summon (full-scene cutaway), Shaman swarm-clear (simultaneous imp death), Dispel shatter (glass-break + visible Scribe correction); legible to a first-time viewer.
FR-9: Emit live, templated Captions per significant Battle Action (no runtime network call); variants rotate; the Dispel Caption visibly corrects a prior Caption.
FR-10: Display a pre-generated, LLM-authored closing Saga at the victory milestone, baked into the bundle for deterministic offline playback (no runtime LLM call).
FR-11: Always-on signature-beat teaching (concise plain-dev one-liner auto-surfaces at each of the three beats, non-dismissible, brief) + an on-demand Legend overlay covering beats and core actions; every explanation accurate to the real Event.
FR-12: Aggregate and pace Events so the Replay reads as drama, not noise — trivial bursts collapse into single Actions/montages, significant beats get visual weight/dwell time, pacing is data-driven config; target a watchable ~2–4 min Replay.

### NonFunctional Requirements

NFR-1 (Performance): The Arena targets ≈60fps with no perceptible jank during cinematics on a current mid-range laptop browser; first frame within ~5s of page load on typical broadband.
NFR-2 (Determinism — scoped): A given curated Session + Annotation Sidecar always produces an identical Replay — battle timeline (Layer 0) reproducible byte-for-byte, interpretation (Layer 1) reproducible once frozen/hashed, narration (Layer 2) intentionally variable; no runtime randomness that alters outcomes; no runtime LLM calls.
NFR-3 (Portability / Shareability): Runs in current Chrome/Firefox/Safari/Edge desktop browsers from a static URL — no install, no login.
NFR-4 (Maintainability): Translation rules, pacing weights, and Captions are versioned data (config), editable without engine-code changes; the brainstorm mapping table is the source-of-truth seed.
NFR-5 (Offline-at-Replay): No external service is required during playback; the Saga and frozen interpretation are pre-generated and stored in the ReplayBundle.

### Additional Requirements

Architecture-derived technical and structural requirements that shape implementation:

- **Starter template (Epic 1, Story 1):** Scaffold from `phaserjs/template-vite-ts` (Phaser 4.1 + Vite 6.3 + TypeScript 5.7) via `pnpm dlx degit phaserjs/template-vite-ts dev-chronicles`; add Vitest + pnpm. This is the first implementation story.
- **Three-layer provenance model (R1):** Layer 0 OBSERVED (`ingest/translate/pace/model`, deterministic, pure), Layer 1 INTERPRETED (`interpret/`, frozen read-only overlay), Layer 2 TOLD (`scribe/`, variable). Interpretation MUST NOT feed HP/pacing math.
- **Purity in the core (R2):** `ingest/translate/pace/model` are pure functions — no `Date.now()`/`Math.random()`/`performance.now()`/network/file-I/O/global mutable state; time derives from event timestamps/orderKey only.
- **Anti-corruption boundary (R3):** ONLY `ingest/` parses raw JSONL and Zod-validates it (Zod 4.4.3); everything downstream consumes the validated `NormalizedEvent[]`; no second parser of the untrusted format.
- **LLM isolation (R4):** `@anthropic-ai/sdk` 0.104.1 imported ONLY by offline authoring scripts in `interpret/`/`scribe/`; never reachable from the browser entrypoint; no API key in client. Interpreter = `claude-sonnet-4-6` (structured/tool output → Zod-validated `BeatAnnotation[]`, escalate to `claude-opus-4-8` if needed); Saga = `claude-opus-4-8` (single offline call).
- **RenderPort one-way seam (R5):** `render/` is the only place Phaser is imported; nothing depends on `render/`; swapping to PixiJS touches only `render/`.
- **Total ordering:** `orderKey = (logicalClock, streamId, seqWithinStream)` stamped at Ingest; main + sub-agent streams merge via a pure stable sort.
- **ReplayBundle:** the single shippable artifact (normalized events + frozen annotations + tuning config + pre-generated saga + asset manifest + schemaVersion); content-addressed `annotationHash = sha256(normalizedEvents + interpreterVersion + promptVersion)`; lives in `public/bundles/`.
- **Versioned schemas (gate everything):** `NormalizedEvent`, `BattleTimeline` + `Beat` + `BattleState`, `BeatAnnotation` (`eventRef`, `beatType`, `confidence`, `interpreterVersion`, `sourceHash`, `groundingPointer`), `ReplayBundle` — Zod + inferred types in `schema/`.
- **Playback = deterministic reducer** over the BattleTimeline driven by a playback cursor (no Redux/Pinia/XState).
- **Testing & determinism guard:** Vitest; `FixtureInterpreter` test double (zero LLM calls in CI); golden `BattleTimeline` snapshot as the determinism anchor; committed sample/redacted Session fixture; out-of-band LLM eval harness (never gates the build).
- **Enforcement:** ESLint import-boundary rule (`eslint-plugin-boundaries` / `import/no-restricted-paths`) encoding R1/R4/R5; CI (GitHub Actions) = typecheck + Vitest + `vite build`.
- **Privacy guardrail:** `scripts/scrub.ts` config-driven secret/token/PII redaction pass + a manual review gate before publishing the public bundle.
- **Process patterns:** fail-closed-to-default on unmapped events at replay time; Ingest validation fails LOUD at build time; config-as-data in versioned `src/config/*.json`.
- **Deployment:** static `dist/` + JSON ReplayBundle to a static host (Coolify VPS / Netlify / Vercel / GitHub Pages).

### UX Design Requirements

_No UX Design Specification exists for v0.1. Visual/interaction direction is captured in the PRD §Aesthetic and Tone (16-bit FF battle screens, Tolkien Scribe register) and is realized inside the renderer stories (FR-7/FR-8/FR-11)._

### FR Coverage Map

FR-1: Epic 1 - Parse the real Story 10.1 session into a normalized Event timeline
FR-2: Epic 3 - Beat tagging (frozen interpretation / annotation) for the three signature beats
FR-3: Epic 1 - Declarative Event → Battle Action translation rules
FR-4: Epic 3 - Translate the three signature beats into their Battle Actions
FR-5: Epic 2 - Turn-based battle state machine from the Action stream
FR-6: Epic 2 - Deterministic playback controls (play/pause/restart/scrub/speed)
FR-7: Epic 2 - Arena + core combat animations (placeholder art)
FR-8: Epic 3 - The three signature cinematics (THUNDORR / Shaman clear / Dispel shatter)
FR-9: Epic 4 - Live templated Captions per Battle Action
FR-10: Epic 4 - Pre-generated closing Saga, baked into the bundle
FR-11: Epic 4 - Always-on beat teaching + on-demand Legend/transparency portal
FR-12: Epic 1 - Event aggregation + active-time pacing into the BattleTimeline

NFR-1 (Performance): Epic 2 - smooth ~60fps Arena, first frame ~5s
NFR-2 (Determinism): Epic 1 - golden BattleTimeline snapshot + R2 purity (cross-cutting)
NFR-3 (Portability): Epic 5 - static URL, current desktop browsers, no install/login
NFR-4 (Maintainability): Epic 1 - translation/pacing/captions as versioned config (cross-cutting)
NFR-5 (Offline-at-Replay): Epic 5 - baked Saga + frozen interpretation in the ReplayBundle

## Epic List

### Epic 1: The Deterministic Battle Core (Layer 0 — Observed)
The real Story 10.1 session is transformed into a reproducible, inspectable BattleTimeline — proving the real-events honesty thesis and end-to-end determinism before any sprite exists. Establishes the scaffold, the provenance-enforced module structure (R1–R5), versioned Zod schemas, ingestion of the real transcript (orderKey total-ordering), declarative translation, and data-driven pacing guarded by a golden snapshot.
**FRs covered:** FR-1, FR-3, FR-12 (+ Additional: starter template, schemas, R1–R5 lint, orderKey, Zod, CI, golden snapshot)

### Epic 2: The Playable Arena (Battle Model + Renderer)
A viewer can watch and scrub the battle play out on screen with placeholder sprites — the Forgemaiden trades blows with the Boss, the health bars and Insight Gauge move, and playback controls work. Adds the turn-based battle state machine, the deterministic playback reducer, the RenderPort seam, the Phaser arena, and core combat animations.
**FRs covered:** FR-5, FR-6, FR-7 (+ NFR-1)

### Epic 3: The Signature Beats (Layer 1 — Interpreted + Cinematics)
The three hero moments land on screen — the frozen, hashed LLM interpretation tags the beats, and THUNDORR / the Fallen Shaman swarm-clear / the Dispel shatter render as polished set-pieces. Adds the BeatInterpreter interface + FixtureInterpreter, the real frozen interpreter, beat translation, and the three signature cinematics.
**FRs covered:** FR-2, FR-4, FR-8

### Epic 4: The Telling & The Teaching (Layer 2 — Told + Portal)
The battle is narrated in Tolkien register and is self-explanatory — live rotating Captions (with the Dispel self-correction), the baked closing Saga, always-on signature-beat teaching one-liners, and the on-demand Legend / transparency portal that grounds every fantasy beat back to its real Event.
**FRs covered:** FR-9, FR-10, FR-11

### Epic 5: Showcase Delivery (Scrub → Bundle → Public URL)
The polished demo goes live at a shareable public URL, safely scrubbed — realizing UJ-1 (drop the link, no install/login). Adds the secret/PII scrub pass + manual review gate, final ReplayBundle generation, the final AI-art swap-in pass, and static deployment.
**FRs covered:** NFR-3, NFR-5 (+ Additional: scrub/privacy gate, bundle build, deployment, art finalization)

## Epic 1: The Deterministic Battle Core (Layer 0 — Observed)

The real Story 10.1 session is transformed into a reproducible, inspectable BattleTimeline — proving the real-events honesty thesis and end-to-end determinism before any sprite exists.

**FRs covered:** FR-1, FR-3, FR-12 · **Additional:** starter template, schemas, R1–R5 lint boundaries, orderKey, Zod, CI, golden snapshot · **NFRs:** NFR-2, NFR-4

### Story 1.1: Scaffold the project with provenance-enforced structure

As the builder,
I want the Phaser 4 + Vite + TS project scaffolded with the provenance-aligned module structure and import-boundary enforcement,
So that every later story is written inside a foundation that mechanically prevents the determinism and provenance violations (R1–R5).

**Acceptance Criteria:**

**Given** an empty target directory
**When** I run `pnpm dlx degit phaserjs/template-vite-ts dev-chronicles && cd dev-chronicles && pnpm install && pnpm add -D vitest`
**Then** the Phaser 4.1 + Vite 6.3 + TS 5.7 template builds and `pnpm dev` serves the dev server
**And** the `src/` tree contains the empty layer directories `schema/ ingest/ translate/ pace/ model/ interpret/ scribe/ render/ portal/ config/` plus `scripts/` and `public/bundles/`.

**Given** the scaffold
**When** ESLint runs
**Then** an import-boundary rule (`eslint-plugin-boundaries` or `import/no-restricted-paths`) is configured encoding R1 (no `interpret/` import from Layer 0), R4 (`@anthropic-ai/sdk` only in `scripts/`+`interpret/`+`scribe/`), and R5 (Phaser only in `render/`)
**And** a deliberate boundary-violating import fails lint.

**Given** the repo
**When** CI (GitHub Actions) runs on push
**Then** it executes `typecheck + vitest + vite build` and fails on any error
**And** TS `strict` is enabled and files follow kebab-case with co-located `*.test.ts`.

### Story 1.2: Define the versioned Zod schemas

As the builder,
I want the core data contracts defined as Zod schemas with inferred types in `schema/`,
So that every stage shares one validated, versioned contract and the schema gates all downstream work.

**Acceptance Criteria:**

**Given** the `schema/` directory
**When** the schemas are authored
**Then** `NormalizedEvent` (with `orderKey`), `BattleTimeline` + `Beat` + `BattleState`, `BeatAnnotation` (`eventRef`, `beatType`, `confidence`, `interpreterVersion`, `sourceHash`, `groundingPointer`), and `ReplayBundle` (with `schemaVersion` + hash fields) each exist as `XxxSchema` const + `type Xxx = z.infer<typeof XxxSchema>`.

**Given** the schemas
**When** types are used downstream
**Then** enums are string-literal unions (`ActionType`, `BeatType`) with no numeric enums
**And** serialized-data fields prefer explicit `null` over `undefined`
**And** a round-trip parse of a valid sample object succeeds and an invalid one fails with a Zod error.

### Story 1.3: Ingest the real Story 10.1 session into a normalized Event timeline

As the builder,
I want the chosen Story 10.1 transcript and `.omc/state` streams parsed into a deterministic, ordered `NormalizedEvent[]`,
So that the demo runs on genuinely real events (SM-3) with a stable total ordering. (FR-1)

**Acceptance Criteria:**

**Given** the Story 10.1 Claude Code transcript JSONL + `.omc/state/agent-replay-*.jsonl`
**When** ingestion runs
**Then** ONLY `ingest/` parses the raw JSONL, Zod-validates it, and emits a normalized camelCase `NormalizedEvent[]` (raw field names never leak past `ingest/`) (R3)
**And** the same input yields a byte-identical event list (deterministic).

**Given** the main and sub-agent streams
**When** they are merged
**Then** an `orderKey = (logicalClock, streamId, seqWithinStream)` stamped at ingest produces a single total order via a pure stable sort (wall-clock alone is not used for ordering).

**Given** events irrelevant to the battle (internal bookkeeping)
**When** the allowlist filter applies
**Then** they are excluded per a documented allowlist
**And** a malformed/unknown raw record aborts the build LOUD with a clear message (no broken timeline).

**Given** the need for tests
**When** the fixture is committed
**Then** a redacted sample Session lives in `ingest/__fixtures__/` so pipeline tests are meaningful without the real private transcript.

### Story 1.4: Translate Events into Battle Actions via declarative rules

As the builder,
I want each Event mapped to Battle Action(s) through an ordered, data-driven ruleset in `config/`,
So that the fantasy metaphor is tunable without engine-code changes (NFR-4) and reads as cause-and-effect. (FR-3)

**Acceptance Criteria:**

**Given** the translation ruleset in `src/config/translation-rules.json`
**When** core events are translated
**Then** `Edit`/`Write` → melee strike on the Boss, `Read`/`Grep`/`Glob` → scout/reveal, `Bash` test/build → channeled spell resolving on outcome, `Task` → ally/summon entrance, a failing test/result → an enemy counter-attack draining Resolve, and a passing/completed-work event → damage to Problem Integrity.

**Given** an `Edit`/`Write` not preceded by a relevant scout `Read` of the same target
**When** translated
**Then** the target is flagged as a **Mirage**; when scouted first it is flagged solid/true (scout-before-strike loop).

**Given** an environmental-hazard event (rate limit, backoff, network wait)
**When** translated
**Then** it produces an **Aether Storm** (environmental, pauses channeling) — NOT a Hero failure or an Enemy counter-attack (protects SM-C1).

**Given** an Event with no matching rule
**When** translated
**Then** it produces a defined default neutral "idle/thinking" beat (fail-closed-to-default) and never crashes
**And** `translate/` is a pure function and adding a rule requires no engine-code change.

### Story 1.5: Aggregate and pace Events into a golden BattleTimeline

As the builder,
I want trivial event bursts collapsed and significant beats weighted into a paced `BattleTimeline`, guarded by a golden snapshot,
So that the Replay reads as drama not noise (FR-12) and determinism is mechanically enforced (NFR-2).

**Acceptance Criteria:**

**Given** the translated action stream
**When** the pacing pass (`scoreEvent` / `windowEvents` / `deriveBeats`) runs
**Then** trivial/repetitive bursts aggregate into a single Action or brief montage while significant beats get visual weight/dwell time, all per `config/pacing-weights.json` + `config/window-config.json` (no hardcoded constants).

**Given** `pace/` and all Layer-0 modules
**When** they execute
**Then** they are pure — no `Date.now()`/`Math.random()`/`performance.now()`/network/file-I/O/global mutable state; time derives only from event timestamps/orderKey (R2).

**Given** the fixture Session
**When** the pacing pass produces a `BattleTimeline`
**Then** a committed Vitest golden snapshot matches byte-for-byte on re-run, and any nondeterministic change fails the snapshot
**And** the resulting timeline targets a watchable ~2–4 minute Replay length.

## Epic 2: The Playable Arena (Battle Model + Renderer)

A viewer can watch and scrub the battle play out on screen with placeholder sprites — the Forgemaiden trades blows with the Boss, the bars and Insight Gauge move, and playback controls work.

**FRs covered:** FR-5, FR-6, FR-7 · **NFRs:** NFR-1

### Story 2.1: Maintain turn-based battle state from the Action stream

As the builder,
I want a pure battle state machine that advances Problem Integrity, Resolve, the Insight Gauge, and live Enemy instances from the Battle Action stream,
So that the Arena has a reproducible logical state at every timeline position. (FR-5)

**Acceptance Criteria:**

**Given** a `BattleTimeline`
**When** Actions are consumed in timeline order
**Then** Problem Integrity and Resolve bars update consistently and are reproducible for any given timeline position.

**Given** struggle events (failed attempts/retries) and a breakthrough event
**When** processed
**Then** the Insight Gauge charges on struggle and discharges on the breakthrough.

**Given** the story's completion Event
**When** reached
**Then** the Boss is defeated at exactly that point and the Battle enters a victory state
**And** `model/` remains pure (R2) and consumes only Layer-0 data (R1 — no `interpret/` import).

### Story 2.2: Deterministic playback reducer

As a viewer,
I want playback driven by a deterministic cursor over the timeline that emits immutable battle snapshots,
So that play/pause/restart/scrub/speed all produce the exact correct state. (FR-6)

**Acceptance Criteria:**

**Given** a `BattleTimeline` and a playback cursor
**When** the reducer advances/seeks
**Then** it emits immutable `BattleState` snapshots and scrubbing to any cursor position yields the same state as playing to that position (no path dependence).

**Given** repeated runs
**When** the same Session is replayed
**Then** the experience is identical (deterministic; no randomness altering outcomes)
**And** the reducer is a small typed function with no heavy store (no Redux/Pinia/XState).

### Story 2.3: Render the Arena via the RenderPort seam (placeholder art)

As a viewer,
I want the battle snapshots rendered as a Phaser arena behind a one-way `RenderPort` interface,
So that I can see the fight with placeholder sprites and the renderer stays swappable. (FR-7, R5)

**Acceptance Criteria:**

**Given** `BattleState` snapshots
**When** the Phaser adapter renders
**Then** it consumes immutable snapshots through `render/render-port.ts` and never feeds state back upstream (one-way)
**And** Phaser is imported ONLY inside `render/` (R5), verified by the import-boundary lint.

**Given** the arena scene
**When** loaded
**Then** the Forgemaiden, Boss, and at least one Minion render as placeholder sprites with health bars and the Insight Gauge visible
**And** assets load via the bundle's asset manifest (placeholder-first; engine never blocks on final art).

### Story 2.4: Core combat animations

As a viewer,
I want the core Battle Actions animated distinctly and smoothly,
So that the fight reads as a fluid FF-style battle. (FR-7, NFR-1)

**Acceptance Criteria:**

**Given** the Forgemaiden
**When** Battle Actions play
**Then** she has at least idle, forge-strike (melee), cast (spell), stagger, and **rise/recover** animations
**And** a burst of consecutive edits renders as a **Hammer Flurry** (visibly faster multi-strike) distinct from a single forge-strike.

**Given** a failure/stagger followed by a retry
**When** the rise animation plays
**Then** it visibly coincides with the Insight Gauge charging further (struggle → power, reads as defiance not defeat).

**Given** the enemies and environment
**When** animated
**Then** Boss vs Minion/imp render distinctly with hit/death animations, the bars and gauge animate with state changes, and the Aether Storm has a distinct environmental visual
**And** frame pacing stays smooth (≈60fps target, no perceptible jank) on a mid-range laptop browser.

### Story 2.5: Playback controls UI

As a viewer,
I want on-screen playback controls wired to the cursor,
So that I can play, pause, restart, scrub, and change speed. (FR-6)

**Acceptance Criteria:**

**Given** the Arena
**When** I use the controls in `render/controls.ts`
**Then** play, pause, restart behave predictably and a speed control (at least normal/fast) is available.

**Given** the scrub control
**When** I drag to any point
**Then** the Arena renders the correct state for that position (driven by the reducer cursor from Story 2.2).

## Epic 3: The Signature Beats (Layer 1 — Interpreted + Cinematics)

The three hero moments land on screen — the frozen, hashed LLM interpretation tags the beats, and THUNDORR / the Fallen Shaman swarm-clear / the Dispel shatter render as polished set-pieces.

**FRs covered:** FR-2, FR-4, FR-8

### Story 3.1: BeatInterpreter interface + FixtureInterpreter overlay

As the builder,
I want a `BeatInterpreter` interface with a deterministic `FixtureInterpreter` double whose annotations apply as a read-only overlay,
So that the whole beat system is testable in CI with zero LLM calls and provenance discipline (R1) is enforced from the start. (FR-2 foundation)

**Acceptance Criteria:**

**Given** the `interpret/` module
**When** the interface is defined
**Then** `BeatInterpreter` produces `BeatAnnotation[]` and a `FixtureInterpreter` returns fixed annotations for the test fixture with no network call.

**Given** the annotations
**When** they are consumed
**Then** they apply as a READ-ONLY overlay — they never feed HP/pacing math, and no Layer-0 module imports `interpret/` (R1, enforced by lint)
**And** every `BeatAnnotation` carries a `groundingPointer` resolving back to the Layer-0 event(s) it dramatizes.

### Story 3.2: Real frozen LLM Interpreter baked into the bundle

As the builder,
I want an offline authoring script that runs the real LLM interpreter and freezes + hashes its annotations into the ReplayBundle,
So that interpretation is reproducible once frozen and never runs at replay time. (FR-2, NFR-2, NFR-5)

**Acceptance Criteria:**

**Given** `scripts/interpret.ts`
**When** it runs offline
**Then** it calls `claude-sonnet-4-6` via structured/tool output, Zod-validates the result into `BeatAnnotation[]`, and `@anthropic-ai/sdk` is imported only here/`interpret/` (never browser-reachable; no API key in client) (R4).

**Given** the produced annotations
**When** frozen
**Then** they are content-addressed via `annotationHash = sha256(normalizedEvents + interpreterVersion + promptVersion)` and baked into the `ReplayBundle`; re-running with identical inputs yields the same hash.

**Given** interpreter quality concerns
**When** evaluated
**Then** `scripts/eval-interpreter.ts` measures tagging quality out-of-band and never gates CI; escalation to `claude-opus-4-8` is available if quality needs it.

### Story 3.3: Translate the three signature beats into Battle behaviors

As a viewer,
I want the tagged beats to drive their specified battle behaviors,
So that the Shaman, Dispel, and Summon are mechanically real, not just narrated. (FR-4)

**Acceptance Criteria:**

**Given** a tagged **Fallen Shaman**
**When** the encounter plays
**Then** defeated symptom-imps visibly resurrect while the Shaman lives, and when the Shaman is defeated all its imps die in one wave.

**Given** a tagged **Dispel** (an assumption Event followed by its tagged ground-truth `Read`)
**When** it fires
**Then** the on-screen Mirage shatters, the Hero takes a self-inflicted Resolve stagger (wasted effort), the real situation is revealed, and a Scribe-correction signal is emitted (consumed by FR-9).

**Given** a tagged **breakthrough** with a charged Insight Gauge
**When** it fires
**Then** the Eidolon Summon (THUNDORR) is triggered and deals a decisive blow.

### Story 3.4: THUNDORR summon cinematic

As a viewer,
I want the THUNDORR summon to play as a distinct full-scene cinematic,
So that the breakthrough lands as the emotional peak of the demo. (FR-8)

**Acceptance Criteria:**

**Given** a triggered Eidolon Summon
**When** the cinematic plays
**Then** it is a distinct full-scene set-piece (time-freeze cutaway → colossal blow → departure) that returns cleanly to the arena state.

**Given** a first-time viewer
**When** they watch the summon
**Then** the beat is legible without prior explanation, and frame pacing holds through the cinematic (no perceptible jank, NFR-1).

### Story 3.5: Fallen Shaman swarm-clear & Dispel shatter cinematics

As a viewer,
I want the Shaman swarm-clear and the Dispel shatter rendered as polished, readable set-pieces,
So that "root cause vs symptom" and "honesty is cool" land as felt moments. (FR-8)

**Acceptance Criteria:**

**Given** the Shaman's defeat
**When** rendered
**Then** the simultaneous death of all its imps plays as one readable wave.

**Given** a Dispel
**When** rendered
**Then** it shows a glass-shatter + record-scratch beat and a visible Scribe correction (paired with FR-9)
**And** both beats are legible to a first-time viewer without prior explanation.

## Epic 4: The Telling & The Teaching (Layer 2 — Told + Portal)

The battle is narrated in Tolkien register and is self-explanatory — live Captions, the baked Saga, always-on beat teaching, and the on-demand Legend/transparency portal.

**FRs covered:** FR-9, FR-10, FR-11

### Story 4.1: Live templated Captions per Battle Action

As a viewer,
I want a short in-register Caption synchronized to each significant Battle Action,
So that the action is narrated instantly in Tolkien voice with no runtime network call. (FR-9)

**Acceptance Criteria:**

**Given** a significant Battle Action
**When** it plays
**Then** a Caption is drawn from a templated table keyed by Action type (`scribe/captions.ts`, no network call) and variants rotate so repeats don't read identically.

**Given** a Dispel correction signal (from Story 3.3)
**When** it fires
**Then** the Dispel Caption visibly **crosses out and rewrites** a prior Caption (the honesty beat)
**And** `scribe/` makes no truth claim and reads only frozen Layer-1 + Layer-0 data (R1)
**And** caption density does not bury the action (SM-C2).

### Story 4.2: Pre-generated closing Saga

As a viewer,
I want a lush closing Saga displayed at victory, authored once offline and baked into the bundle,
So that the demo ends on elegiac Tolkien prose with zero runtime LLM cost. (FR-10, NFR-5)

**Acceptance Criteria:**

**Given** `scripts/scribe-saga.ts`
**When** it runs offline
**Then** it authors one Saga via `claude-opus-4-8` (Tolkien-register prompt) over the relevant Event window and bakes it into the `ReplayBundle`.

**Given** the Replay at the victory milestone
**When** it reaches the closing
**Then** it displays the stored Saga with no runtime LLM call (offline-at-replay).

### Story 4.3: Always-on signature-beat teaching

As a learner,
I want a concise plain-dev one-liner to auto-surface at each of the three signature beats,
So that I understand what just happened without toggling anything (SM-1). (FR-11)

**Acceptance Criteria:**

**Given** a signature beat (Shaman / Dispel / Summon)
**When** it fires
**Then** a brief plain-dev one-liner auto-appears with no viewer action (e.g., Shaman death: "The whole bug class died at once — that's fixing the *root cause*, not the symptoms.") and disappears on its own.

**Given** the auto-surfaced teaching
**When** displayed
**Then** it is brief enough not to bury the spectacle (SM-C2) and every line is accurate to the real Event it represents.

### Story 4.4: On-demand Legend / transparency portal

As a curious viewer,
I want to open a fuller fantasy↔real Legend overlay grounded in the real events,
So that I can dig into the mapping without interrupting playback (UJ-2). (FR-11)

**Acceptance Criteria:**

**Given** the Arena during playback
**When** I open the Legend/transparency portal overlay
**Then** it covers the three beats and the core actions (strike/edit, spell/test, scout/read, Aether Storm/rate-limit) and can be opened/closed without interrupting playback.

**Given** an active beat
**When** I inspect it in the portal
**Then** the portal resolves the beat's `groundingPointer` to show the real Event(s) it dramatizes (fantasy → real)
**And** every explanation is accurate to the real Event.

## Epic 5: Showcase Delivery (Scrub → Bundle → Public URL)

The polished demo goes live at a shareable public URL, safely scrubbed — realizing UJ-1.

**FRs covered:** NFR-3, NFR-5 · **Additional:** scrub/privacy gate, bundle build, deployment, art finalization

### Story 5.1: Secret/PII scrub pass + manual review gate

As the builder,
I want a redaction pass over the ingested Session with a manual review report,
So that no secrets/credentials/PII ship in the public bundle. (Privacy guardrail)

**Acceptance Criteria:**

**Given** `scripts/scrub.ts`
**When** it runs over the Session
**Then** it applies config-driven deny patterns for secrets/tokens/PII and emits a manual-review report listing what was redacted and what needs human eyes.

**Given** the public-bundle pipeline
**When** a bundle is built for publishing
**Then** the scrub pass + an explicit manual review gate must pass before the bundle is considered publishable (the fantasy layer is not assumed to redact).

### Story 5.2: ReplayBundle build orchestration

As the builder,
I want one offline command that produces the canonical ReplayBundle end-to-end,
So that the shippable artifact is reproducible and self-contained. (NFR-5)

**Acceptance Criteria:**

**Given** `scripts/build-bundle.ts` (`pnpm bundle:story-10-1`)
**When** it runs
**Then** it orchestrates scrub → ingest → pace → interpret → saga and writes a single `public/bundles/story-10-1.json` containing normalized events + frozen annotations + tuning config + pre-generated saga + asset manifest + `schemaVersion` + hashes.

**Given** the produced bundle
**When** the browser loads it
**Then** the Replay runs fully client-side with no external service (offline-at-replay), and re-running the build with identical inputs reproduces the same bundle hashes.

### Story 5.3: Final AI-art swap-in

As the builder,
I want final AI-generated pixel art swapped in via the asset manifest,
So that the demo looks coherent without any engine change. (Art finalization; parallel workstream)

**Acceptance Criteria:**

**Given** final art produced to a single locked palette/scale/style guide
**When** the asset manifest is updated
**Then** the renderer loads the final assets for the ~7 entities + animation frames + the THUNDORR cinematic with no engine-code change (placeholder → final is a manifest swap).

**Given** the swapped art
**When** the Replay runs
**Then** assets are visually consistent across entities and any license/attribution records are retained.

### Story 5.4: Static deploy to a public URL

As the builder/presenter,
I want the demo deployed as a static build at a shareable URL,
So that anyone can watch it with no install or login. (NFR-3, UJ-1)

**Acceptance Criteria:**

**Given** the finished app + bundle
**When** I run `pnpm build`
**Then** it produces a static `dist/` (+ bundles) deployable to a static host (Coolify/Netlify/Vercel/GitHub Pages).

**Given** the deployed URL
**When** opened on a current Chrome/Firefox/Safari/Edge desktop browser
**Then** it loads with no install/login and reaches first frame in under ~5s on typical broadband (NFR-1/NFR-3).
