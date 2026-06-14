---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-06-14'
inputDocuments:
  - '_bmad-output/planning-artifacts/prds/prd-dev-chronicles-2026-06-14/prd.md'
  - '_bmad-output/planning-artifacts/prds/prd-dev-chronicles-2026-06-14/addendum.md'
  - '_bmad-output/brainstorming/brainstorming-session-2026-06-14-023651.md'
workflowType: 'architecture'
project_name: 'dev-chronicles'
user_name: 'Archfelipe'
date: '2026-06-14'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### The Core Architectural Model: Three Layers by Provenance
The system separates by PROVENANCE, not just by speed. This is the spine of the whole design.

- **Layer 0 — OBSERVED (deterministic).** Raw session JSONL → a normalized, versioned Event
  stream. This is the only input to all battle MECHANICS (HP, pacing weights) — computed
  purely from deterministic signals (exit codes, success/error, retry counts, timing).
  Same session → identical battle timeline. The transparency portal's ground truth.
- **Layer 1 — INTERPRETED (frozen-per-session).** An LLM Interpreter tags the causal spine
  and dramatic beats (root-cause "Shaman", assumption-correction "Dispel", breakthrough
  "summon"). FROZEN once per session and content-addressed; provenance-flagged; every beat
  carries a GROUNDING POINTER back to the Layer-0 event(s) it dramatizes. It is a READ-ONLY
  overlay — it never feeds HP math or pacing weights. The "WHICH beat is the Shaman" decision
  is fixed; it does not vary run-to-run.
- **Layer 2 — TOLD (variable).** The Scribe's prose (captions + closing Saga) may vary every
  run — register/wording is free, but it can only narrate Layer-1's frozen structure, so it
  drifts in voice, never in referent. No truth claim of its own.

Determinism is thus scoped precisely: Layers 0 and 1 are reproducible (1 via a frozen,
hashed interpretation artifact); Layer 2 is intentionally variable. This resolves the
recording-vs-fable tension AND keeps the lesson stable across retellings ("infinite tellings,
one story").

### Requirements Overview
12 FRs map onto: an offline DETERMINISTIC pipeline (Ingest → Translate → Pace → Battle Model,
Layer 0) producing a typed BattleTimeline; a frozen LLM Interpreter (Layer 1); a variable
Scribe/UATU narrator (Layer 2); a transparency portal that exposes Layer-1 grounding pointers;
and a renderer (TBD).

### Non-Functional Requirements (architecture drivers)
- **Determinism — scoped:** battle timeline (L0) reproducible byte-for-byte; interpretation
  (L1) reproducible once frozen/hashed; narration (L2) intentionally variable. NOT
  pixel-frame determinism. Guaranteed for OFFLINE REPLAY; real-time is best-effort and may
  segment differently.
- **Anti-corruption:** everything downstream of Ingest reads ONLY the normalized Event stream
  (one parser of the untrusted format). The schema must carry enough fidelity (sub-agent stack
  depth, tool context, timing, a total-order key) to feed BOTH the Pacer and the Interpreter.
- **Total ordering:** main + sub-agent JSONL stacks merge via an explicit orderKey
  (logicalClock, streamId, seqWithinStream) stamped at Ingest — wall-clock alone is insufficient.
- **Maintainability:** translation mapping = DATA (mobile part); pacing = CODE + tuning DATA
  (versioned PacingWeights/WindowConfig). Renderer behind a thin interface.
- **Testability:** Interpreter behind a BeatInterpreter interface with a FixtureInterpreter
  double (zero LLM calls in CI); a golden BattleTimeline snapshot as the determinism anchor;
  LLM quality measured by an out-of-band eval harness, never blocking the build.

### Scale & Complexity
- Domain: client app (2D timeline/battle player) + offline transform pipeline + a frozen LLM
  interpretation/narration layer (TypeScript). No backend/DB/auth.
- Complexity: medium. Concentrated design risk now NAMED and contained: the provenance wall
  (L0/L1/L2) and the normalized Event schema are the two artifacts that must be right first.
- Components (~9): Ingestor (+ anti-corruption schema + orderKey), Translator (data rules),
  Pacer (scoreEvent/windowEvents/deriveBeats → BattleTimeline), Battle Model, Interpreter
  (frozen, hashed, grounded BeatAnnotations), Scribe/UATU (variable prose over main+subagent
  streams, never mutates), Transparency Portal (grounding pointers, the causal "because"),
  Renderer (TBD).

### Cross-Cutting Concerns
- Provenance discipline (Observed never authored; Interpreted never flattened into Observed;
  Told makes no truth claim).
- The normalized Event schema as the system's true contract — designed for two consumers
  (mechanical pacing + dramatic interpretation).
- Determinism scoping (L0/L1 reproducible, L2 variable; offline-only guarantee).
- Real-time readiness without promoting it to a correctness guarantee (v0.1 replay-first).
- Asset- and renderer-swappability.

### Party-Mode Pressure-Test (resolved decisions)
Two rounds with Winston (architect), Amelia (engineer), Dr. Quinn (problem-solver), Sophia
(storyteller) converged on one crux — the LLM Interpreter straddling the honesty/determinism
wall — resolved by the three-layer provenance model plus three user decisions:
1. Interpreted beats are a READ-ONLY overlay; mechanics use deterministic signals only.
2. Interpretation is FROZEN per session (structure fixed); only Scribe prose varies per run.
3. The transparency portal's fantasy↔reality reveal is a FEATURE (honest disclosure),
   mandating a grounding pointer on every interpreted beat.

## Starter Template Evaluation

### Primary Technology Domain
Client-side static web application (TypeScript). The system is a pure-TS offline pipeline
(Layers 0–1, DOM-free, Vitest-tested) + a browser renderer (Layer 2 presentation) behind a
thin `RenderPort` interface. No backend/DB/auth.

### Starter Options Considered
- **Official `phaserjs/template-vite-ts`** (Phaser 4.1 "Salusa" + Vite 6.3 + TypeScript 5.7) —
  maintained by the Phaser team; hot-reload, TS throughout, production build to `dist/`.
- **PixiJS v8 + custom scaffold** — lighter/faster renderer, but tweening/particles/scene
  sequencing must be hand-built; rejected for v0.1 velocity (kept as the swappable fallback).
- **Decide-at-build-time spike** — rejected; defers a concrete foundation for a solo MVP.

### Selected Starter: phaserjs/template-vite-ts (Phaser 4), extended
**Rationale:** Phaser 4 provides the FF battle idiom (sprite sheets, tweens, particles, scene
timelines) out of the box — the THUNDORR cinematic and combat animation are native to it.
Vite + TS matches the kebox toolchain. We extend the template with Vitest (for the pure-TS
pipeline) and pnpm, and impose the provenance-layer module structure.

**Initialization Command:**
```bash
# Scaffold from the official Phaser 4 + Vite + TS template (no git history)
pnpm dlx degit phaserjs/template-vite-ts dev-chronicles
cd dev-chronicles
pnpm install
pnpm add -D vitest
pnpm dev   # Vite dev server on http://localhost:8080
```

**Architectural Decisions Provided / Imposed:**
- **Language & Runtime:** TypeScript 5.7, ES modules, browser target; pnpm.
- **Rendering:** Phaser 4.1, consumed ONLY through a `RenderPort` interface (swappable; PixiJS fallback).
- **Build Tooling:** Vite 6.3 (dev server, HMR, static `dist/` build for the shareable URL).
- **Testing:** Vitest for the pure-TS pipeline + the `FixtureInterpreter` contract; a golden
  `BattleTimeline` snapshot as the determinism anchor. Renderer excluded from determinism tests
  (timeline-level, not pixel-level).
- **Code Organization (provenance-aligned):**
```
src/
  ingest/    # raw JSONL → normalized Event[] (anti-corruption boundary, orderKey)
  schema/    # versioned NormalizedEvent, BattleTimeline, BeatAnnotation types
  translate/ # data-driven tool→action mapping rules (config)
  pace/      # scoreEvent / windowEvents / deriveBeats → BattleTimeline (code + tuning data)
  model/     # battle state machine (HP, gauges) — Layer 0, deterministic
  interpret/ # LLM BeatInterpreter (frozen, hashed) + FixtureInterpreter — Layer 1
  scribe/    # UATU narrator: captions + saga (variable) — Layer 2
  render/    # RenderPort interface + Phaser adapter + scenes — presentation
  portal/    # transparency portal (grounding pointers)
  game/      # Phaser bootstrap (from template)
public/assets/  # sprites/audio (AI-generated, placeholder-first)
```
- **Development Experience:** Vite HMR, TS strict, Vitest watch; `pnpm build` → static bundle.

**Note:** Project initialization using this command should be the first implementation story.

## Core Architectural Decisions

### Decision Priority Analysis
**Critical (block implementation):** normalized Event schema + validation; the ReplayBundle
format + freeze/hash; LLM integration boundary (offline-only); playback state model; hosting.
**Important:** orderKey total-ordering; tuning-config format; asset manifest.
**Deferred (post-MVP):** real-time data source; multi-session/drop-in; CDN/perf tuning.

**Already decided (starter/context):** TypeScript 5.7, Vite 6.3, Phaser 4.1, Vitest, pnpm,
RenderPort interface, three-layer provenance model.

### Data Architecture (schemas & the bundle — this is the system's spine)
- **Validation: Zod 4.4.3.** Runtime-validate the untrusted JSONL at the Ingest boundary only;
  internal stages trust the validated `NormalizedEvent[]`. Matches the kebox toolchain.
- **Core schemas (versioned):** `NormalizedEvent` (Layer 0), `BattleTimeline` + `Beat`
  (Pacer output), `BeatAnnotation` (Layer 1: `{eventRef, beatType, confidence,
  interpreterVersion, sourceHash, groundingPointer}`), `ReplayBundle` (the single shippable
  artifact: normalized events + frozen annotations + tuning config + pre-generated saga +
  asset manifest + schemaVersion).
- **Freeze/determinism:** the frozen interpretation is content-addressed —
  `annotationHash = sha256(normalizedEvents + interpreterVersion + promptVersion)`. The
  ReplayBundle is the canonical source of truth and the cache key (not the raw transcript).
- **Ordering:** `orderKey = (logicalClock, streamId, seqWithinStream)` stamped at Ingest;
  main + sub-agent streams merge via a pure stable sort. No DB — all artifacts are JSON files.

### Privacy & Security (no auth; static app)
- **Pre-publish secret scrub:** since the ReplayBundle is public, Ingest includes a redaction
  pass (config-driven deny patterns for secrets/tokens/PII) + a manual review gate before
  publishing. No runtime security surface (no server, no auth, no user input).

### LLM Integration
- **`@anthropic-ai/sdk` 0.104.1, OFFLINE / build-time ONLY.** No API key or SDK ships in the
  browser bundle; the Interpreter and Saga are authoring scripts that bake artifacts into the
  ReplayBundle.
- **Interpreter (structured beat-tagging):** `claude-sonnet-4-6` via structured/tool output
  → Zod-validated `BeatAnnotation[]`; escalate to `claude-opus-4-8` if tagging quality needs
  it. Behind a `BeatInterpreter` interface with a `FixtureInterpreter` for tests.
- **Scribe Saga (one lush prose passage):** `claude-opus-4-8` (single offline call). Captions
  are templated (no LLM). Saga frozen into the bundle for replay; regenerating is an explicit
  manual authoring step.

### Frontend Architecture
- **Playback state = a deterministic reducer over the BattleTimeline**, driven by a playback
  cursor (play/pause/restart/scrub/speed). No heavy store (no Redux/Pinia/XState) — a small
  typed reducer + snapshot emitter is enough for a timeline player; keeps it lean and testable.
- **RenderPort interface** is the only seam to Phaser; the Phaser adapter consumes immutable
  state snapshots and never feeds back upstream.
- **Assets:** Phaser loader fed by the bundle's asset manifest; placeholder-first so the
  engine/pipeline never blocks on final AI art.
- **Routing:** none — single full-screen Arena. **Transparency portal** is an overlay reading
  the active beat's grounding pointer.

### Infrastructure & Deployment
- **Hosting: static.** Coolify VPS (already operated) or any static host
  (Netlify/Vercel/GitHub Pages) — the build is a static `dist/` + the JSON ReplayBundle.
- **CI (GitHub Actions):** typecheck + Vitest (incl. the golden `BattleTimeline` determinism
  snapshot) + `vite build`. The LLM **eval harness runs out-of-band**, never gating the build.
  Bundle (re)generation is an offline authoring step, not CI.

### Decision Impact Analysis
**Implementation sequence:** (1) schemas + Zod validation → (2) Ingest + orderKey → (3)
Translate (data rules) → (4) Pace → BattleTimeline (+ golden snapshot) → (5) Battle Model +
playback reducer → (6) RenderPort + Phaser adapter (placeholder art) → (7) FixtureInterpreter
→ real Interpreter (frozen) → (8) Scribe captions + baked Saga → (9) transparency portal.
**Cross-component dependencies:** the `NormalizedEvent` schema gates everything; the
ReplayBundle format gates render + portal; RenderPort gates the renderer staying swappable.

## Implementation Patterns & Consistency Rules

### Critical Conflict Points Identified
The dangerous divergences here aren't REST/DB conventions (none exist) — they're the rules
that protect determinism, the provenance wall, and the swappable seams. Nine rules below.

### Provenance & Determinism Patterns (the load-bearing ones)
- **R1 — Layer discipline.** `ingest/translate/pace/model` (Layer 0) compute mechanics from
  deterministic signals ONLY. `interpret/` (Layer 1) output is a READ-ONLY overlay — it MUST
  NOT be imported by any Layer-0 module or influence HP/pacing math. `scribe/` (Layer 2) makes
  no truth claims and reads only frozen Layer-1 + Layer-0 data.
- **R2 — Purity in the core.** Modules in `ingest/translate/pace/model` are PURE functions.
  FORBIDDEN there: `Date.now()`, `Math.random()`, `performance.now()`, network, file I/O,
  global mutable state. Time derives from event timestamps/orderKey only. This is what makes
  the golden `BattleTimeline` snapshot stable.
- **R3 — Anti-corruption.** ONLY `ingest/` reads/parses raw JSONL and Zod-validates it.
  Everything downstream consumes the validated `NormalizedEvent[]`; no other module re-parses
  the raw session (no second parser of the untrusted format).
- **R4 — LLM isolation.** `@anthropic-ai/sdk` is imported ONLY by offline authoring scripts in
  `interpret/` and `scribe/`. It MUST NOT appear in any module reachable from the browser
  entrypoint (`game/`, `render/`). Enforced by an import-boundary lint rule. No API key in client.
- **R5 — RenderPort is one-way.** `render/` depends on `schema/` + state snapshots; nothing
  depends on `render/`. Phaser imports are confined to `render/` (the adapter). Swapping to
  PixiJS touches only `render/`.

### Naming Patterns
- **Files:** kebab-case (`battle-timeline.ts`, `beat-interpreter.ts`). Tests co-located:
  `pace.ts` → `pace.test.ts` (matches kebox Vitest convention).
- **Types:** PascalCase (`NormalizedEvent`, `BattleTimeline`, `Beat`, `BeatAnnotation`).
- **Zod:** schema const `XxxSchema`; inferred type `type Xxx = z.infer<typeof XxxSchema>`.
- **Enums as string-literal unions:** `type ActionType = 'melee' | 'spell' | ...`;
  `type BeatType = 'shaman' | 'dispel' | 'summon' | ...`. No numeric enums.
- **Internal JSON: camelCase** everywhere (the messy raw JSONL is normalized to camelCase at
  the Ingest boundary; raw field names never leak past `ingest/`).

### Structure Patterns
- **Config-as-data lives in versioned files**, not hardcoded: translation rules and
  `PacingWeights`/`WindowConfig` in `src/config/*.json` (or `.ts` exporting typed constants).
- **Fixtures & golden snapshots:** `src/**/__fixtures__/` for sample streams; Vitest snapshots
  for the `BattleTimeline` determinism anchor. A committed sample/redacted Session fixture is
  required (no test is meaningful without it).
- **ReplayBundle artifacts** live in `public/bundles/` (served statically); generated by
  offline scripts under `scripts/` (or `interpret/`+`scribe/` CLIs).

### Format Patterns
- **All cross-stage data is typed + Zod-validated at boundaries** (Ingest input, Interpreter
  output). Internal stage-to-stage hand-offs trust types (no redundant re-validation).
- **Determinism artifacts:** `annotationHash`/bundle hash via SHA-256 over canonical JSON
  (stable key order). Timestamps in events stay as-ingested — never reformatted with the wall clock.
- **Null vs absent:** prefer explicit `null` in schemas over `undefined` for serialized data.

### Communication Patterns
- **Stages communicate by returning typed artifacts**, not via shared mutable state or events.
  The pipeline is a function composition: `pace(translate(ingest(raw)))`.
- **Playback → render is snapshot-based:** the playback reducer emits immutable
  `BattleState` snapshots; the RenderPort renders snapshots and never mutates upstream state.
- **Beat ↔ event link:** every `BeatAnnotation` carries a `groundingPointer` (the eventRef[s]
  it dramatizes) so the transparency portal can always resolve fantasy → real.

### Process Patterns
- **Unmapped/unknown events: fail-closed-to-default**, never crash mid-replay. An event with
  no translation rule → a logged warning + a neutral "idle/thinking" beat (asserted by test).
- **Ingest validation fails LOUD** (a malformed/unknown raw schema aborts bundle-build with a
  clear message) — the build-time boundary is strict; the runtime replay is forgiving.
- **LLM testing:** any test touching Layer 1 uses `FixtureInterpreter`; the real LLM is never
  called in CI. LLM quality lives in the out-of-band eval harness.

### Enforcement Guidelines
**All AI agents MUST:** keep Layer-0 modules pure (R2); never let `interpret/` feed mechanics
(R1); parse raw JSONL only in `ingest/` (R3); confine `@anthropic-ai/sdk` to offline scripts
(R4); confine Phaser to `render/` (R5); validate at boundaries with Zod; co-locate tests.

**Enforcement:** an ESLint import-boundary rule (`eslint-plugin-boundaries` or
`import/no-restricted-paths`) encodes R1/R4/R5; the golden `BattleTimeline` snapshot guards R2;
CI runs typecheck + Vitest + build.

### Anti-Patterns (do NOT)
- ❌ Reading `Date.now()`/`Math.random()` inside `pace/` or `model/` (breaks determinism).
- ❌ Using a `BeatAnnotation` to add/subtract HP or change pacing weight (breaks R1).
- ❌ Importing Phaser outside `render/`, or the Anthropic SDK in browser code.
- ❌ Re-parsing the raw transcript outside `ingest/`.
- ❌ Hardcoding translation/pacing constants instead of the versioned config files.

## Project Structure & Boundaries

### Complete Project Directory Structure
```
dev-chronicles/
├── README.md
├── package.json                 # pnpm; scripts: dev, build, test, typecheck, lint, bundle:*
├── pnpm-lock.yaml
├── vite.config.ts               # Vite 6.3 (from template)
├── vitest.config.ts             # pipeline tests; jsdom only where needed
├── tsconfig.json                # strict
├── eslint.config.ts             # + import-boundary rules encoding R1/R4/R5
├── index.html                   # Phaser mount (from template)
├── .env.example                 # ANTHROPIC_API_KEY (offline scripts only — never bundled)
├── .github/workflows/ci.yml     # typecheck + vitest + build
├── public/
│   ├── assets/                  # AI-gen sprites/audio (placeholder-first): heroes, enemies,
│   │   │                        #   shaman, thundorr, fx, ui
│   └── bundles/
│       └── story-10-1.json      # the shippable ReplayBundle (committed artifact)
├── scripts/                     # OFFLINE authoring CLIs (Node; may import @anthropic-ai/sdk)
│   ├── build-bundle.ts          # raw session → ReplayBundle (orchestrates ingest→pace→freeze)
│   ├── interpret.ts             # runs the LLM BeatInterpreter, freezes + hashes annotations
│   ├── scribe-saga.ts           # one-shot Saga generation, baked into the bundle
│   ├── scrub.ts                 # secret/PII redaction pass + manual-review report
│   └── eval-interpreter.ts      # out-of-band LLM quality eval (never in CI gate)
└── src/
    ├── main.ts                  # browser entry (from template)
    ├── game/                    # Phaser bootstrap/config (from template)
    │   └── main.ts
    ├── schema/                  # Layer-0/1 contracts (Zod + inferred types) — gates everything
    │   ├── normalized-event.ts  # NormalizedEvent, orderKey
    │   ├── battle-timeline.ts   # BattleTimeline, Beat, BattleState
    │   ├── beat-annotation.ts   # BeatAnnotation (groundingPointer, sourceHash, ...)
    │   └── replay-bundle.ts     # ReplayBundle (schemaVersion, hashes)
    ├── ingest/                  # [Layer 0] ONLY parser of raw JSONL (anti-corruption, R3)
    │   ├── parse-transcript.ts  # Claude Code transcript JSONL → raw
    │   ├── parse-omc-state.ts   # .omc/state agent-replay JSONL → raw
    │   ├── merge.ts             # orderKey stable-sort of main + sub-agent streams
    │   ├── normalize.ts         # → NormalizedEvent[] (camelCase), Zod-validated
    │   └── __fixtures__/        # committed sample/redacted session
    ├── translate/               # [Layer 0] data-driven tool→action mapping (pure)
    │   └── translate.ts
    ├── pace/                    # [Layer 0] windowing + weighting (pure) → BattleTimeline
    │   ├── score-event.ts
    │   ├── window-events.ts
    │   ├── derive-beats.ts
    │   └── __snapshots__/       # golden BattleTimeline (determinism anchor, R2)
    ├── model/                   # [Layer 0] battle state machine (HP, gauges) + playback reducer
    │   ├── battle-model.ts
    │   └── playback.ts          # cursor-driven reducer → BattleState snapshots
    ├── interpret/               # [Layer 1] frozen LLM beat-tagging (READ-ONLY overlay, R1)
    │   ├── beat-interpreter.ts  # BeatInterpreter interface
    │   ├── claude-interpreter.ts# real impl (used only by scripts/)
    │   └── fixture-interpreter.ts # test double (CI)
    ├── scribe/                  # [Layer 2] UATU narrator (variable; never mutates)
    │   ├── captions.ts          # templated, instant
    │   └── saga.ts              # reads the baked Saga from the bundle
    ├── render/                  # presentation — ONLY place Phaser is imported (R5)
    │   ├── render-port.ts       # RenderPort interface (the swap seam)
    │   ├── phaser/              # Phaser 4 adapter + scenes (arena, cinematics)
    │   └── controls.ts          # play/pause/restart/scrub/speed UI → playback cursor
    ├── portal/                  # transparency portal overlay (grounding pointers)
    │   └── portal.ts
    └── config/                  # versioned tuning DATA (not code)
        ├── translation-rules.json
        ├── pacing-weights.json
        └── window-config.json
```

### FR → Structure Mapping
- **FR-1/FR-2 (ingest + annotation):** `ingest/`, `scripts/build-bundle.ts`, `scripts/interpret.ts`, `schema/`
- **FR-3/FR-4 (translate + signature beats):** `translate/`, `config/translation-rules.json`, `interpret/`
- **FR-5/FR-6 (battle model + playback):** `model/`, `render/controls.ts`
- **FR-12 (aggregation/pacing):** `pace/`, `config/pacing-weights.json` + `window-config.json`
- **FR-7/FR-8 (renderer + cinematics):** `render/phaser/`, `public/assets/`
- **FR-9/FR-10 (Scribe captions + Saga):** `scribe/`, `scripts/scribe-saga.ts`
- **FR-11 (teaching/transparency):** `portal/`, `render/` (always-on beat captions)
- **Privacy guardrail:** `scripts/scrub.ts`

### Architectural Boundaries
- **Anti-corruption boundary** at `ingest/` output (`NormalizedEvent[]`). Raw JSONL never
  crosses it; only `ingest/` and offline `scripts/` touch raw sources.
- **Determinism boundary** wraps Layer 0 (`ingest→translate→pace→model`): pure, snapshot-
  guarded, no wall clock. The ReplayBundle is the frozen artifact crossing into the browser.
- **Provenance boundary:** `interpret/` (L1) is consumed by `scribe/` + `portal/` + the render
  overlay, never by Layer 0 (ESLint import rules).
- **Render boundary:** `render/render-port.ts` is the only seam to Phaser.
- **Offline/online boundary:** `scripts/` (Node, Anthropic SDK + fs) produce
  `public/bundles/*.json`; the browser only ever loads a finished bundle.

### Data Flow
```
raw JSONL ──ingest──> NormalizedEvent[] ──translate──> actions ──pace──> BattleTimeline ─┐
(scripts, offline)                                            (golden-snapshot tested)    │
NormalizedEvent[] ──interpret(LLM, frozen+hashed)──> BeatAnnotation[] ────────────────────┤
                                                                                          ▼
                                  scribe-saga(LLM, one-shot) ──> ReplayBundle (public/bundles/*.json)
                                                                                          │
  ── browser (Vite static) ──> load bundle ──> playback reducer ──> BattleState ──> RenderPort(Phaser)
                                                                     └─> Scribe captions + portal overlay
```

### Development Workflow
- **Dev:** `pnpm dev` (Vite HMR) renders from a committed `public/bundles/*.json`.
- **Authoring (offline):** `pnpm bundle:story-10-1` runs scrub → ingest → pace → interpret →
  saga → writes the bundle. Re-running is an explicit manual step (not CI).
- **Build/deploy:** `pnpm build` → static `dist/` (+ bundles) → static host (Coolify/etc.).

## Architecture Validation Results

### Coherence Validation ✅
- **Decision compatibility:** Phaser 4.1 + Vite 6.3 + TS 5.7 + Vitest + Zod 4.4 +
  @anthropic-ai/sdk 0.104 (offline only) are mutually compatible; no version conflicts.
- **Pattern consistency:** R1–R5 are enforceable by ESLint import boundaries + the golden
  snapshot; naming/format rules are internally consistent and match the kebox toolchain.
- **Structure alignment:** the `src/` layers map 1:1 to the three provenance tiers; the
  boundaries (anti-corruption, determinism, provenance, render, offline/online) each have a
  concrete home in the tree.

### Requirements Coverage Validation ✅
All 12 FRs trace to a component (see FR→Structure Mapping): FR-1/2 → ingest+scripts; FR-3/4 →
translate+interpret+config; FR-5/6 → model; FR-12 → pace; FR-7/8 → render; FR-9/10 → scribe;
FR-11 → portal+render. No orphan FRs; no component without an FR.

**NFR coverage:** determinism (scoped to L0/L1, golden-snapshot guarded) ✅; animation safety
(Pacer throttling + Phaser) ✅; portability (static build) ✅; maintainability (config-as-data) ✅;
offline-at-replay (baked bundle) ✅; privacy (scrub script + manual gate) ✅.

### Implementation Readiness Validation ✅
- **Decisions:** all critical decisions documented with verified versions.
- **Structure:** complete tree with concrete files; boundaries explicit.
- **Patterns:** the conflict points unique to this system (determinism leak, provenance
  bleed, parser drift, renderer/LLM coupling) are each addressed by a named rule + enforcement.

### Gap Analysis Results
**Critical gaps:** none.
**Important gaps (empirical, not architectural — resolve early in build):**
1. The transcript parser is *designed* against the observed schema but not yet *pinned* to the
   specific Story 10.1 session files (PRD Open Q2 remainder). First build task after scaffolding.
2. Pacing weights/window thresholds are *structurally* defined but their *values* are empirical
   (PRD Open Q6) — tuned against real 10.1 density.
3. AI-art production is a named delivery risk (placeholder-first keeps it off the critical path).
**Minor gaps:** performance is designed for but not yet benchmarked; real-time-mode boundaries
are kept clean but unbuilt (deferred); annotation authoring ergonomics (hand-edit vs helper UI).

### Architecture Completeness Checklist
**Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed (designed; benchmark pending — minor gap)

**Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment
**Overall Status:** READY WITH MINOR GAPS — no critical gaps; the open items are empirical
(schema pin, pacing tuning, art, perf benchmark), resolved naturally in early build, not
architectural blockers.
**Confidence Level:** High — the design was adversarially pressure-tested over two party rounds
and every concern resolved into a concrete boundary.

**Key strengths:** the three-layer provenance model (honest core, variable telling); determinism
scoped precisely with a golden-snapshot guard; data-driven translation/pacing; clean swap seams
(RenderPort, BeatInterpreter); risk (art) kept off the critical path.

**Areas for future enhancement:** real-time mode (data-source swap), drop-in arbitrary sessions
(LLM contract-creator), a richer collectible Codex, perf benchmarking pass.

### Implementation Handoff
**AI Agent Guidelines:** follow R1–R5 exactly; keep Layer 0 pure; never let interpretation feed
mechanics; parse raw JSONL only in `ingest/`; confine Phaser to `render/` and the Anthropic SDK
to `scripts/`; validate at boundaries with Zod.
**First Implementation Priority:**
`pnpm dlx degit phaserjs/template-vite-ts dev-chronicles && cd dev-chronicles && pnpm install`
then define `src/schema/` (the contracts gate everything), then pin the transcript parser to
the real Story 10.1 session.
