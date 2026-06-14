---
baseline_commit: 401ca3db9db27f7e307da7b28d28da3ec7ff2d60
---

# Story 1.2: Define the versioned Zod schemas

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the builder,
I want the core data contracts defined as Zod schemas with inferred types in `src/schema/`,
so that every stage shares one validated, versioned contract and the schema gates all downstream work (Ingest → Translate → Pace → Model → Interpret → Scribe → Render/Portal).

## Acceptance Criteria

**AC1 — All four contracts exist as `XxxSchema` const + inferred type**
**Given** the `src/schema/` directory
**When** the schemas are authored
**Then** `NormalizedEvent` (with `orderKey`), `BattleTimeline` + `Beat` + `BattleState`, `BeatAnnotation` (`eventRef`, `beatType`, `confidence`, `interpreterVersion`, `sourceHash`, `groundingPointer`), and `ReplayBundle` (with `schemaVersion` + hash fields) each exist as a `XxxSchema` const **and** a `type Xxx = z.infer<typeof XxxSchema>`.

**AC2 — Enums are string-literal unions; no numeric enums**
**Given** the schemas
**When** types are used downstream
**Then** enums are string-literal unions (`ActionType`, `BeatType`) with **no** numeric/native TS enums.

**AC3 — Serialized-data fields prefer explicit `null` over `undefined`**
**Given** the schemas
**When** optional/serialized fields are modeled
**Then** serialized-data fields prefer explicit `null` over `undefined` (per architecture Format Patterns "Null vs absent").

**AC4 — Round-trip parse: valid passes, invalid fails with a Zod error**
**Given** the schemas
**When** validated against sample objects
**Then** a round-trip parse (`Schema.parse(validSample)`) of a valid sample object succeeds **and** an invalid one fails with a `z.ZodError`.

## Tasks / Subtasks

- [x] **Task 1 — `src/schema/normalized-event.ts` (Layer 0 contract; gates everything)** (AC: 1, 2, 3)
  - [x] Export `OrderKeySchema = z.object({ logicalClock: z.number().int(), streamId: z.string(), seqWithinStream: z.number().int() })` and `type OrderKey = z.infer<typeof OrderKeySchema>`.
  - [x] Export `ActionType` as a string-literal union via `z.enum([...])` (Zod 4 — produces a literal union type, see Dev Notes "Zod 4 enum guidance"): at minimum `'melee' | 'spell' | 'scout' | 'summon' | 'counter' | 'idle'`; add the others the brainstorm mapping implies (`'aetherStorm'`, `'mirageStrike'`, `'solidStrike'`) — see Dev Notes "ActionType derivation".
  - [x] Export `NormalizedEventSchema = z.object({...})` + `type NormalizedEvent` carrying: `orderKey: OrderKeySchema`; `eventId: z.string()`; tool/event context (camelCase — `eventType`, `toolName` (nullable), `subtype` (nullable)); timestamps **as-ingested** as `string` (never reformatted) — `timestamp: z.string()`; sub-agent stream depth — `streamDepth: z.number().int()`; deterministic mechanical signals the Pacer needs — `exitCode: z.number().int().nullable()`, `isError: z.boolean()`, `retryCount: z.number().int()`; and a `payload`/`raw` field carrying the normalized camelCase event detail the Interpreter needs (`z.record(z.string(), z.unknown())` or a typed object — see Dev Notes "payload fidelity"). Use explicit `.nullable()` (not `.optional()`) for serialized fields per AC3.
  - [x] Co-locate `src/schema/normalized-event.test.ts`: valid sample parses; an object with a non-integer `orderKey.logicalClock` (or missing `orderKey`) throws `z.ZodError`.

- [x] **Task 2 — `src/schema/battle-timeline.ts` (Pacer output / battle model state)** (AC: 1, 2, 3)
  - [x] Export `BeatSchema` + `type Beat`: the paced unit emitted by `pace/` — carries `orderKey: OrderKeySchema` (import from `./normalized-event`), `actionType: ActionTypeSchema`, `sourceEventIds: z.array(z.string())` (the event(s) collapsed into this beat — supports grounding), and pacing/weight fields the renderer needs (`weight: z.number()`, `dwellMs: z.number()`). Decide the minimal field set on documented merits — see Dev Notes "Beat field rationale".
  - [x] Export `BattleTimelineSchema` + `type BattleTimeline`: `schemaVersion: z.literal(1)`, `beats: z.array(BeatSchema)`, and any timeline-level metadata (e.g. `totalDurationMs: z.number()`).
  - [x] Export `BattleStateSchema` + `type BattleState`: the immutable snapshot the model/playback reducer emits — `problemIntegrity: z.number()`, `resolve: z.number()`, `insightGauge: z.number()`, `enemies: z.array(...)`, `cursor: z.number().int()`, `victory: z.boolean()`. Keep it the model/playback contract (Story 2.1/2.2 consume it) — see Dev Notes "BattleState scope".
  - [x] Co-locate `src/schema/battle-timeline.test.ts`: valid timeline parses; invalid (e.g. a `beat` missing `orderKey`) throws.

- [x] **Task 3 — `src/schema/beat-annotation.ts` (Layer 1 — frozen, content-addressed overlay)** (AC: 1, 2, 3)
  - [x] Export `BeatType` as a string-literal union via `z.enum([...])`: at minimum `'shaman' | 'dispel' | 'summon'` (the three signature beats); see Dev Notes "BeatType derivation".
  - [x] Export `GroundingPointerSchema` + `type GroundingPointer`: resolves a beat back to the Layer-0 event(s) it dramatizes — `eventRefs: z.array(z.string())` (eventIds) at minimum. Decide shape on merits — see Dev Notes "groundingPointer shape".
  - [x] Export `BeatAnnotationSchema = z.object({...})` + `type BeatAnnotation` with EXACTLY the architecture-named fields: `eventRef` (string — the primary event id), `beatType: BeatTypeSchema`, `confidence: z.number()` (0–1), `interpreterVersion: z.string()`, `sourceHash: z.string()`, `groundingPointer: GroundingPointerSchema`. Prefer `null` over `undefined` for any optional serialized field (AC3).
  - [x] Co-locate `src/schema/beat-annotation.test.ts`: valid annotation parses; an annotation with an out-of-range/invalid `beatType` (e.g. `'wizard'`) or missing `groundingPointer` throws.

- [x] **Task 4 — `src/schema/replay-bundle.ts` (the single shippable artifact)** (AC: 1, 2, 3)
  - [x] Export `ReplayBundleSchema = z.object({...})` + `type ReplayBundle` composing the prior schemas: `schemaVersion: z.literal(1)`, `normalizedEvents: z.array(NormalizedEventSchema)`, `annotations: z.array(BeatAnnotationSchema)`, `tuningConfig` (the versioned translation/pacing config — type it loosely now: `z.record(z.string(), z.unknown())` or a `TuningConfigSchema` placeholder, since `config/*.json` schemas land in 1.4/1.5 — see Dev Notes "tuningConfig scope"), `saga: z.string()` (the baked closing prose; `null`able if not yet authored), `assetManifest` (`z.record(z.string(), z.string())` mapping logical asset name → path — keep minimal, see Dev Notes), and the hash fields: `annotationHash: z.string()` (sha256), and a bundle-level hash if warranted. Optionally `battleTimeline: BattleTimelineSchema` if the bundle bakes the paced timeline (architecture lists "normalized events + frozen annotations + tuning config + saga + asset manifest + schemaVersion") — decide and record (see Dev Notes "ReplayBundle composition").
  - [x] Co-locate `src/schema/replay-bundle.test.ts`: a minimal valid bundle parses; one with a malformed nested `annotation` or wrong `schemaVersion` throws.

- [x] **Task 5 — Verify all four gates** (AC: 1–4)
  - [x] `pnpm typecheck` — clean (tsc --noEmit, strict).
  - [x] `pnpm lint` — clean (NO new boundary violations; `src/schema/` is shared, imports nothing from `interpret/`/phaser/anthropic).
  - [x] `pnpm test` — green (the 4 new co-located tests + the existing `schema.test.ts` smoke test).
  - [x] `pnpm build` — succeeds (schemas are pure TS; no browser-reachable SDK).
  - [x] Confirm the existing `src/schema/schema.test.ts` smoke test still passes (do NOT delete it; it is an independent toolchain probe).

### Review Follow-ups (AI)

Fix round 1 (Senior Developer Review, 2026-06-14). All 10 synthesized findings addressed.

- [x] **F1 (fix)** — `confidence` now `z.number().min(0).max(1)` in `beat-annotation.ts`; added out-of-range reject tests (`9.7`, `-5` throw) + 0/1-bound accept test in `beat-annotation.test.ts`. The documented 0–1 self-rating now bites at the Layer-1 gate.
- [x] **F9 (fix)** — corrected stale test count `58 → 60` in Debug Log References and Change Log (actual `pnpm test` = 9 files / 60 tests).
- [x] **F4 (consider)** — softened the byte-fidelity comment in `replay-bundle.test.ts`: canonical (stable-key-order) JSON is a hashing-step responsibility (later story), not a parse round-trip property; `z.record` preserves insertion order without canonicalizing.
- [x] **F2 (consider → record)** — recorded `orderKey` total-order/uniqueness assumption in Dev Notes "Deferred invariants"; carried to the 1.3 merge comparator (must not rely on input stability).
- [x] **F3 (consider → record)** — recorded in Dev Notes that versioning is bundle-level only (intentional: bundle is the versioned, content-addressed cache key).
- [x] **F5 (consider → record)** — recorded that `annotationHash`/`sourceHash` shape is enforced at bundle-build/freeze time, not by parse.
- [x] **F6 (consider → record)** — recorded `eventRef → eventId` referential integrity + de-dup as owned by the bundle-build script (1.4/5.2), not the schema.
- [x] **F7 (consider → record)** — recorded `.min(1)` requirement for `groundingPointer.eventRefs` / `Beat.sourceEventIds` carried to 1.3+ once ingest populates them.
- [x] **F8 (consider → record)** — recorded that gauge clamping (`problemIntegrity`/`resolve`/`insightGauge`) is owned by the Story 2.2 reducer, so the open range here is intentional.
- [Refuted] **F10 (likely-refute)** — NO code change. Confirmed against architecture L171: `annotationHash = sha256(normalizedEvents + interpreterVersion + promptVersion)`. The bundle correctly stores only the resulting `annotationHash`; `promptVersion` is a hash *input* captured at the later freeze/hash step, and `interpreterVersion` already lives per-annotation. Surfacing `promptVersion` in the bundle now would be speculative scope. The auditor's own suggested action was "no change now". Recorded as a future-freeze-story reminder only.

## Dev Notes

### SCOPE (read first — this is a contracts-only story)
- **Author schemas + their co-located tests ONLY.** Do **NOT** implement ingest/translate/pace/model/interpret/scribe logic — those are Stories 1.3–1.5 (and Epics 2–4). This story produces four `src/schema/*.ts` files + four `*.test.ts` files. [Source: epics.md#Story-1.2; epics.md#Implementation-sequence]
- These schemas **GATE everything**: "the `NormalizedEvent` schema gates everything; the ReplayBundle format gates render + portal." Field-set decisions made here ripple through every downstream story, so decide on documented merits and record rationale (this Dev Notes section). [Source: architecture.md#Decision Impact Analysis]
- This is autonomous — **decide and proceed**; do not leave a schema unwritten waiting for clarification. Where the architecture under-specifies a field set (it deliberately leaves room), pick the minimal set that serves the documented two consumers and note it.

### Stack / library facts (verified against the installed tree — do NOT guess)
- **Zod is `4.4.3`** (exact-pinned, runtime `dependencies`). This is **Zod 4**, not Zod 3. [Source: package.json; Story 1.1 Dev Notes]
- Import as `import { z } from 'zod';` (matches the existing `src/schema/schema.test.ts`).
- TypeScript `5.7.3`, strict + `noUnusedLocals`/`noUnusedParameters`/`noImplicitReturns` on; `strictPropertyInitialization` OFF, `exactOptionalPropertyTypes` OFF. [Source: 1-1 Dev Notes#TS strict + conventions]
- Vitest `4.1.8`, `environment: 'node'`, `include: ['src/**/*.test.ts']` — so tests MUST be named `*.test.ts` under `src/`. [Source: 1-1 Dev Notes#Vitest; vitest.config.ts]

### Zod 4 enum guidance (prevents a wrong-API disaster)
- For string-literal unions use **`z.enum(['melee','spell',...])`** — in Zod this yields a TS type that is the **string-literal union** (`'melee' | 'spell' | ...`), satisfying AC2 ("string-literal unions, no numeric enums"). `z.enum` over a string array is NOT a numeric/native TS `enum`; it is exactly the allowed pattern. Do NOT use the native TS `enum` keyword, and do NOT use `z.nativeEnum`. [Source: architecture.md#Naming Patterns "Enums as string-literal unions"; epics.md#Story-1.2 AC2]
- Alternative `z.union([z.literal('melee'), z.literal('spell'), ...])` is equivalent and also acceptable; `z.enum([...])` is terser — prefer it.
- Export both the schema and the type: `export const ActionTypeSchema = z.enum([...]); export type ActionType = z.infer<typeof ActionTypeSchema>;`
- **Zod 4 note for `z.record`:** Zod 4 requires two args — `z.record(z.string(), z.unknown())` (key schema, value schema). The single-arg `z.record(z.unknown())` form is Zod 3. Verify against the installed version if typecheck complains; consult Zod 4 docs (Context7 `resolve-library-id` → `zod`) before improvising.

### Naming / convention rules (mechanically enforced — do not deviate)
- Files **kebab-case**: `normalized-event.ts`, `battle-timeline.ts`, `beat-annotation.ts`, `replay-bundle.ts`. [Source: architecture.md#Naming Patterns]
- Types **PascalCase**; Zod schema const `XxxSchema`; inferred type `type Xxx = z.infer<typeof XxxSchema>`. [Source: architecture.md#Naming Patterns; epics.md#Story-1.2 AC1]
- **Internal JSON is camelCase everywhere** — `orderKey`, `streamId`, `seqWithinStream`, `logicalClock`, `interpreterVersion`, `sourceHash`, `groundingPointer`, `eventRef`, `beatType`, `schemaVersion`, `annotationHash`. Raw JSONL field names never appear here (they are normalized at the Ingest boundary in Story 1.3; schema fields are already-normalized camelCase). [Source: architecture.md#Naming Patterns; #Anti-corruption boundary]
- **`null` over `undefined`** for serialized fields: use `.nullable()` (which permits `null`) rather than `.optional()` (which permits `undefined`/absent) for any field that is part of the serialized ReplayBundle JSON. This keeps the bundle JSON explicit and stable for the sha256 hash. [Source: architecture.md#Format Patterns "Null vs absent"]

### `orderKey` — the total-ordering contract (must be exact)
`orderKey = { logicalClock: number, streamId: string, seqWithinStream: number }`, stamped at Ingest; main + sub-agent streams merge via a pure stable sort. Model it as its own `OrderKeySchema` in `normalized-event.ts` and reuse it (import) wherever ordering is referenced (e.g. `Beat`). `logicalClock` and `seqWithinStream` are integers (`z.number().int()`). [Source: architecture.md#Data Architecture "Ordering"; epics.md#Story-1.3 AC2]

### Schema fidelity requirement — design for TWO consumers
The anti-corruption note is explicit: "The schema must carry enough fidelity (sub-agent stack depth, tool context, timing, a total-order key) to feed **BOTH** the Pacer and the Interpreter." So `NormalizedEvent` must carry:
- **For the Pacer (mechanics, deterministic):** the signals pacing/HP math reads — `exitCode`, `isError`, `retryCount`, `eventType`, `toolName`, timing (`timestamp` string), `orderKey`. [Source: architecture.md#The Core Architectural Model "computed purely from deterministic signals (exit codes, success/error, retry counts, timing)"]
- **For the Interpreter (dramatic, Layer 1):** enough context to tag beats — `subtype`, `streamDepth` (sub-agent depth), and the normalized `payload`/detail. The Interpreter consumes `NormalizedEvent[]` (R3 — no second parser), so all interpretive signal must live in the schema. [Source: architecture.md#Non-Functional Requirements "feed BOTH the Pacer and the Interpreter"; #Anti-corruption]

#### payload fidelity
Model the event detail as a normalized camelCase bag. Minimal merits-based choice: `payload: z.record(z.string(), z.unknown()).nullable()` for v0.1 — keeps the contract open while ingest (1.3) decides exactly which normalized fields to populate, without re-opening this schema for every new field. If a tighter shape emerges in 1.3, it can be narrowed then. **Rationale:** over-specifying payload now risks churning the gating schema; under-specifying loses fidelity. A typed open record is the documented middle path. Record this decision.

### ActionType derivation (string-literal union)
The brainstorm/translation mapping (epics.md FR-3 / Story 1.4) implies these action kinds: `Edit/Write→melee`, `Read/Grep/Glob→scout`, `Bash test/build→spell`, `Task→summon`, `failing test→counter`, `scout-before-strike→Mirage vs solid`, `environmental hazard→Aether Storm`, unmatched→`idle`. Minimal `ActionType` union: `'melee' | 'spell' | 'scout' | 'summon' | 'counter' | 'idle' | 'aetherStorm'`. The Mirage/solid distinction is a **modifier** on a strike, not necessarily its own ActionType — model it either as extra members (`'mirageStrike' | 'solidStrike'`) OR as a boolean/flag on the Beat. **Decide:** keep `ActionType` to the core verbs and carry Mirage-ness as a Beat-level flag in 1.4 — DON'T over-bloat the union now; but DO include all members the literal verbs require so 1.4 needn't edit this gating file. Record the chosen member list and rationale. [Source: epics.md#Story-1.4 AC; architecture.md#Process Patterns "fail-closed-to-default … neutral 'idle/thinking' beat"]

### BeatType derivation (string-literal union)
The three signature beats are the hard requirement: `'shaman' | 'dispel' | 'summon'`. The Interpreter (Story 3.x) tags only these three special narrative beats (FR-2). Keep `BeatType` to exactly these three unless architecture names more — it does not, so author exactly three. [Source: architecture.md#The Core Architectural Model; epics.md#Story-1.2 AC2 (`BeatType`), FR-2]

### Beat field rationale
A `Beat` is the Pacer's output unit (a paced/aggregated action). It needs: `orderKey` (its position in the total order), `actionType`, `sourceEventIds` (the event(s) collapsed into it — these double as the L0 grounding the portal/interpreter reference), and pacing weight/dwell so the renderer knows visual emphasis (`weight`, `dwellMs`). Do NOT put interpretation (beatType/confidence) on `Beat` — that is Layer-1 `BeatAnnotation`, kept separate to honor R1 (mechanics never see interpretation). Record this separation rationale. [Source: architecture.md#R1 Layer discipline; #Data Architecture "BattleTimeline + Beat (Pacer output)"]

### BattleState scope
`BattleState` is the immutable snapshot the playback reducer emits (Story 2.2) and the RenderPort consumes (Story 2.3). It lives in `battle-timeline.ts` per the architecture tree comment (`battle-timeline.ts # BattleTimeline, Beat, BattleState`). Include the bars/gauges the FRs name: `problemIntegrity`, `resolve`, `insightGauge`, live `enemies`, a `cursor`/position, and a `victory` flag (Boss defeated on completion event). Keep enemy shape minimal (`{ id, type, hp }`) — full enemy modeling is Epic 2. Record that enemy detail is intentionally thin here. [Source: architecture.md tree §`schema/`; epics.md#Story-2.1 AC]

### groundingPointer shape
Every `BeatAnnotation` carries a `groundingPointer` resolving fantasy→real (the portal's core feature, R-communication). Minimal merits-based shape: `{ eventRefs: string[] }` (one or more `NormalizedEvent.eventId`s). `eventRef` (singular, top-level) is the primary/anchor event; `groundingPointer.eventRefs` is the full set it dramatizes (a Dispel spans an assumption event + its ground-truth Read). Record this primary-vs-full distinction. [Source: architecture.md#Communication Patterns "Beat ↔ event link"; epics.md#Story-3.3 (Dispel = assumption Event + tagged Read)]

### ReplayBundle composition (decide and record)
Architecture lists the bundle as: "normalized events + frozen annotations + tuning config + pre-generated saga + asset manifest + schemaVersion" + "content-addressed `annotationHash = sha256(normalizedEvents + interpreterVersion + promptVersion)`". So `ReplayBundle` MUST include: `schemaVersion`, `normalizedEvents`, `annotations`, `tuningConfig`, `saga`, `assetManifest`, `annotationHash`. **Decision to make:** does the bundle also bake `battleTimeline`? The architecture data-flow shows the browser does `load bundle → playback reducer`, and the reducer runs over a `BattleTimeline`. The timeline is a pure function of `normalizedEvents + tuningConfig`, so it can be (a) recomputed in-browser, or (b) baked. **Recommend baking `battleTimeline: BattleTimelineSchema` into the bundle** (determinism is then literal — the shipped artifact carries the exact golden timeline, no in-browser recompute drift) and record this as a consequential decision. If you instead omit it, record why. [Source: architecture.md#Data Architecture "ReplayBundle"; #Data Flow; #Freeze/determinism]

#### tuningConfig scope
The translation rules + pacing weights + window config get their own JSON schemas in Stories 1.4/1.5. Do NOT author those now. Type `tuningConfig` loosely (`z.record(z.string(), z.unknown())` or a one-line `TuningConfigSchema = z.record(...)` placeholder) so the bundle compiles today and is narrowed when 1.4/1.5 land. Record this as a deliberate forward-reference, not an omission. [Source: architecture.md#Structure Patterns "Config-as-data"; epics.md#Story-1.4/1.5]

#### assetManifest scope
Minimal: `z.record(z.string(), z.string())` (logical asset name → path). The renderer (Epic 2/5) consumes it; full manifest shape is decided when render/final-art stories land. Keep thin; record. [Source: architecture.md#Frontend Architecture "Phaser loader fed by the bundle's asset manifest"]

### Boundary / determinism rules that bear on THIS file (don't trip them)
- **R1 (Layer discipline):** `schema/` is shared by all layers and imports nothing from `interpret/`, no Phaser, no Anthropic SDK. Schemas are plain Zod — they will not trip the import-boundary lint. Keep them dependency-light (only `zod`). [Source: architecture.md#R1; #R4; #R5]
- **R3 (Anti-corruption):** these schemas DEFINE the validated `NormalizedEvent` contract; do NOT add any JSONL parsing here — parsing is `ingest/` only (Story 1.3). [Source: architecture.md#R3]
- **No runtime values:** schema files declare contracts only — no `Date.now()`, no constants-as-tuning. Tuning lives in `config/*.json` (1.4/1.5). [Source: architecture.md#R2; #Anti-Patterns]
- **Timestamps stay as-ingested strings** in `NormalizedEvent` — never reformatted; `timestamp: z.string()`. [Source: architecture.md#Format Patterns "Timestamps in events stay as-ingested"]

### Deferred invariants / forward-references (recorded in review fix round 1)

These invariants are real but are NOT enforceable (or not owned) by this contracts-only story. Each is recorded here so the downstream owner picks it up; none is a defect in 1.2.

- **`orderKey` total-order / uniqueness (→ Story 1.3 merge comparator).** `OrderKeySchema` validates three independent fields but cannot express cross-row uniqueness or a total order on a single Zod object. Equal `(logicalClock, streamId, seqWithinStream)` triples under a stable sort can reorder run-to-run if input order isn't itself deterministic. The 1.3 merge (`merge.ts`) MUST establish the total order in its comparator and MUST NOT rely on input stability — `orderKey` is the determinism anchor for the golden timeline. [F2]
- **Versioning is bundle-level only (intentional).** Only `BattleTimeline` and `ReplayBundle` carry `z.literal(1)`; `NormalizedEvent` and `BeatAnnotation` have no per-schema version discriminator. This is deliberate: the `ReplayBundle` is the shippable, versioned, content-addressed artifact (its `schemaVersion` + `annotationHash` are the cache key), so a single top-level version gates the whole graph. Add per-schema literals only if a future story needs to evolve `NormalizedEvent`/`BeatAnnotation` independently of the bundle. [F3]
- **Hash format enforced at bundle-build, not at parse (`annotationHash`/`sourceHash`).** These are bare `z.string()`, so `''` parses. They are content-address/cache keys, but hash *production* lands in a later freeze/build story; that step is responsible for emitting and validating the sha256 shape. The schema intentionally does not pre-judge the digest format. [F5]
- **Cross-array referential integrity owned by the bundle-build script (Story 1.4 / 5.2).** A `ReplayBundle` with a dangling annotation `eventRef` (no matching `NormalizedEvent.eventId`) or duplicate `eventId`s parses — Zod cannot express cross-array referential integrity cleanly. The bundle-build script that assembles the artifact owns `eventRef → eventId` integrity and de-duplication; the portal's `groundingPointer` resolution assumes it. [F6]
- **`.min(1)` for `groundingPointer.eventRefs` / `Beat.sourceEventIds` carried to 1.3+.** Both permit `[]` today (a beat that grounds/dramatizes nothing), which is correct for v0.1 because ingest does not populate these yet. Once ingest (1.3+) populates them, the owning story should add `.min(1)` so a beat always references at least one Layer-0 event. [F7]
- **Gauge clamping owned by the Story 2.2 reducer.** `BattleState.problemIntegrity` / `resolve` / `insightGauge` are bare `z.number()`, so `-50` parses. The open range here is intentional — these are HP/gauge bars and the Story 2.2 playback reducer owns clamping them to their display range before the 2.3 RenderPort consumes them. The schema does not bake gauge bounds that belong to reducer policy. [F8]

### Testing standards (AC4)
- Each schema gets a co-located `*.test.ts` proving AC4: `Schema.parse(validSample)` returns the value; an invalid sample throws `z.ZodError` (assert with `expect(() => Schema.parse(bad)).toThrow(z.ZodError)`, matching the existing smoke test's style). [Source: 1-1 Dev Notes#Vitest; architecture.md#Testing]
- Build the valid samples by hand (small literal objects) — there is no fixture Session yet (that arrives in Story 1.3 under `ingest/__fixtures__/`). Do NOT block on the fixture. [Source: epics.md#Story-1.3 AC4]
- Keep the existing `src/schema/schema.test.ts` (independent toolchain smoke test) — do not remove or fold it in.

## Project Structure Notes

- Files land exactly where the architecture tree places them: `src/schema/normalized-event.ts`, `src/schema/battle-timeline.ts`, `src/schema/beat-annotation.ts`, `src/schema/replay-bundle.ts` (+ co-located `*.test.ts`). [Source: architecture.md#Complete Project Directory Structure §`schema/`]
- `src/schema/` currently contains ONLY `schema.test.ts` (the Story 1.1 smoke test). No `.gitkeep` here (per 1.1 notes "smoke test lives here; no .gitkeep"). The four new schema files are the first real source in `schema/`.
- No conflicts with existing structure. Cross-file imports within `schema/` (e.g. `battle-timeline.ts` and `replay-bundle.ts` importing `OrderKeySchema`/`NormalizedEventSchema` from `./normalized-event`) are intra-layer and allowed.
- Do NOT touch `eslint.config.ts`, `tsconfig.json`, `vitest.config.ts`, `package.json`, or any `src/` dir outside `schema/`. (Story 1.1 is committed at HEAD; build ON it.)

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2: Define the versioned Zod schemas] — verbatim ACs.
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture (schemas & the bundle)] — the four core schemas, `orderKey`, `annotationHash`, ReplayBundle composition.
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules] — R1–R5, Naming Patterns (Zod const/type, kebab-case, string-literal unions, camelCase), Format Patterns (null-vs-absent, timestamps-as-ingested).
- [Source: _bmad-output/planning-artifacts/architecture.md#Complete Project Directory Structure] — exact file placement under `src/schema/`.
- [Source: _bmad-output/planning-artifacts/architecture.md#Non-Functional Requirements] — "schema must carry enough fidelity … to feed BOTH the Pacer and the Interpreter."
- [Source: _bmad-output/implementation-artifacts/1-1-scaffold-provenance-structure.md] — installed versions (Zod 4.4.3), TS strict config, Vitest config, lint boundaries, existing `schema.test.ts`.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMAD dev-story workflow, autonomous single-pass).

### Debug Log References

- RED baseline confirmed: `pnpm test` → 4 schema test files FAIL ("Cannot find module"), `schema.test.ts` smoke PASS (2 tests).
- GREEN: after authoring the four schema files, full suite 6 files / 41 tests pass; with the four added unit test files, 9 files / 60 tests pass.
- Gates: `pnpm typecheck` exit 0; `pnpm lint` exit 0; `pnpm test` exit 0 (60 passed); `pnpm build` exit 0.
- R4 check: `grep -rl "@anthropic-ai" dist/` → no match (SDK absent from the browser bundle). Schema symbols are tree-shaken out of the bundle (nothing imports `schema/` yet — contracts-only story).

### Completion Notes List

- Implemented the four versioned Zod schemas as pure data contracts in `src/schema/` (only `zod` imported — no JSONL parsing per R3, no runtime values per R2, no `interpret/`/Phaser/Anthropic imports per R1/R4/R5). The pre-existing ATDD red-phase tests (`*.test.ts`) were made GREEN honestly — none deleted, skipped, or weakened. No ATDD test encoded a wrong expectation, so none was modified.
- Added four co-located unit test files (`*.unit.test.ts`) on top of the ATDD suite, covering the documented design DECISIONS the ATDD tests do not exercise (the `aetherStorm` ActionType member and exclusion of mirage/solid; the remaining `.nullable()` serialized fields; the `summon` BeatType-vs-ActionType overlap; the empty-array edge cases; the BAKED `battleTimeline` being required; the loose `tuningConfig` forward-reference). The `*.unit.test.ts` suffix is matched by the vitest include glob `src/**/*.test.ts` (verified empirically).
- Design decisions recorded (per the story's "decide and record" directive):
  - **payload**: `z.record(z.string(), z.unknown()).nullable()` — open record for v0.1 so ingest (1.3) need not re-open this gating schema per field.
  - **ActionType members**: `melee | spell | scout | summon | counter | idle | aetherStorm`. Mirage/solid is a Beat-level modifier for 1.4, NOT its own member, keeping the gating union lean.
  - **Beat vs BeatAnnotation**: `Beat` carries mechanics only (no `beatType`/`confidence`); interpretation lives in Layer-1 `BeatAnnotation` (R1 — mechanics never see interpretation).
  - **groundingPointer**: `{ eventRefs: string[] }` (full dramatized set); the singular top-level `eventRef` is the primary anchor — kept as distinct fields.
  - **ReplayBundle composition**: BAKES `battleTimeline: BattleTimelineSchema` — determinism is literal (shipped artifact carries the exact golden timeline; no in-browser recompute drift). `tuningConfig`/`assetManifest` typed loosely as forward-references (real JSON schemas land in 1.4/1.5 and render stories).
- Zod 4 APIs verified against the installed 4.4.3 tree before authoring: `z.enum([...])` yields a string-literal union (AC2) and rejects out-of-set strings with `ZodError`; `z.record(z.string(), z.unknown())` is the required two-arg form; `.nullable()` permits `null` but rejects absent/undefined (AC3 behavioral basis).
- Did NOT git commit (operator commits between stories). Updated sprint-status `1-2` ready-for-dev → in-progress at start; → review at completion. Added `baseline_commit: 401ca3db9db27f7e307da7b28d28da3ec7ff2d60` to the story frontmatter.
- **Review fix round 1 (2026-06-14):** the one real defect (F1 — `confidence` lacked the documented 0–1 bound) was fixed at root cause: `confidence: z.number().min(0).max(1)`, proven by added reject tests (`9.7`, `-5`) and bound-accept tests (`0`, `1`). All other findings were either documentation drift (F9 — count 58→60) or correctly-deferred forward-references (F2/F3/F5/F6/F7/F8 — recorded in Dev Notes "Deferred invariants / forward-references", no code change since Zod cannot express cross-row/cross-array invariants on a single object and the owning step is a later story). F4 was a comment-precision fix only (parse is byte-transparent; canonical ordering belongs to the hashing step). F10 is refuted: `promptVersion` is an input to the later `annotationHash` computation, not a stored bundle field. No schema field set changed except the `confidence` bound. Re-ran all four gates green: `pnpm typecheck` exit 0; `pnpm lint` exit 0; `pnpm test` exit 0 (9 files / 62 tests); `pnpm build` exit 0. Status → done.

### File List

- `src/schema/normalized-event.ts` (new) — `OrderKeySchema`/`OrderKey`, `ActionTypeSchema`/`ActionType`, `NormalizedEventSchema`/`NormalizedEvent`.
- `src/schema/battle-timeline.ts` (new) — `BeatSchema`/`Beat`, `BattleTimelineSchema`/`BattleTimeline`, `BattleStateSchema`/`BattleState`.
- `src/schema/beat-annotation.ts` (new) — `BeatTypeSchema`/`BeatType`, `GroundingPointerSchema`/`GroundingPointer`, `BeatAnnotationSchema`/`BeatAnnotation`.
- `src/schema/replay-bundle.ts` (new) — `TuningConfigSchema`/`TuningConfig`, `ReplayBundleSchema`/`ReplayBundle`.
- `src/schema/normalized-event.unit.test.ts` (new) — dev-story unit tests for documented ActionType/AC3 decisions.
- `src/schema/battle-timeline.unit.test.ts` (new) — dev-story unit tests for Beat-mechanics-only/BattleState contract.
- `src/schema/beat-annotation.unit.test.ts` (new) — dev-story unit tests for BeatType closure/groundingPointer.
- `src/schema/replay-bundle.unit.test.ts` (new) — dev-story unit tests for baked timeline/loose tuningConfig.
- `src/schema/normalized-event.test.ts`, `battle-timeline.test.ts`, `beat-annotation.test.ts`, `replay-bundle.test.ts` (pre-existing ATDD red-phase tests — made GREEN, unchanged).
- `_bmad-output/implementation-artifacts/1-2-versioned-zod-schemas.md` (this story file — permitted sections only).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status `1-2` → in-progress → review).

## Change Log

- 2026-06-14 — Story 1.2 drafted (create-story workflow): contracts-only scope for the four versioned Zod schemas in `src/schema/`; design decisions resolved on documented merits (payload fidelity, ActionType/BeatType members, Beat vs BeatAnnotation separation, groundingPointer primary-vs-full, ReplayBundle baking the BattleTimeline, loose tuningConfig/assetManifest forward-references). Status set ready-for-dev.
- 2026-06-14 — Story 1.2 implemented (dev-story workflow, red→green→refactor): authored `normalized-event.ts`, `battle-timeline.ts`, `beat-annotation.ts`, `replay-bundle.ts` as pure Zod data contracts and made the pre-existing ATDD red-phase tests GREEN (none weakened); added four `*.unit.test.ts` files covering the documented decisions. All four gates green — `pnpm typecheck`, `pnpm lint`, `pnpm test` (9 files / 60 tests), `pnpm build` (no `@anthropic-ai/sdk` in the browser bundle, R4). Status → review.
- 2026-06-14 — Review fix round 1 (Senior Developer Review follow-ups): bounded `confidence` to `z.number().min(0).max(1)` in `beat-annotation.ts` and added out-of-range/bounds tests (F1); softened the `replay-bundle.test.ts` byte-fidelity comment to attribute canonical ordering to the hashing step (F4); recorded six deferred invariants/forward-references in Dev Notes (F2/F3/F5/F6/F7/F8); corrected the stale test count 58 → 60 (F9); confirmed F10 as a refuted finding (no code change — `promptVersion` is a later-freeze hash input, not a bundle field). All four gates re-run green — `pnpm typecheck`, `pnpm lint`, `pnpm test` (9 files / 62 tests), `pnpm build`. Status → done.

## Senior Developer Review (AI)

**Reviewer:** Andres Felipe Grisales (AI-assisted adversarial review — 3 hunter layers + acceptance auditor, synthesized)
**Date:** 2026-06-14
**Outcome:** APPROVE WITH MINOR FIXES — all four ACs PASS; the four schemas + 10 test files are sound and faithful to architecture. One real unenforced documented invariant (`confidence` 0–1), several intentional contracts-only forward-references worth recording, and a stale test count. No blocking defects.

### Overall Verdict

All 4 ACs PASS (typecheck/lint/test/build green; `pnpm test` = 9 files / 60 tests). One must-fix (`confidence` lacks the 0–1 bound its own task spec + code comment assert); the rest are low-severity forward-reference notes or doc drift. None block "review".

### Findings

| ID | Severity | Location | Recommendation | Layers | Why |
|----|----------|----------|----------------|--------|-----|
| F1 | med | `src/schema/beat-annotation.ts:22` | fix | BlindHunter, EdgeHunter | `confidence` is bare `z.number()`, but Task 3 (story L56) and the inline comment (L17–18) both state the interpreter's "0–1 self-rating". Verified `confidence:9.7` / `-5` parse cleanly, leaking out-of-range values past this Layer-1 gate into downstream gauge/threshold math. The documented invariant should bite here. Fix: `z.number().min(0).max(1)` + an out-of-range reject test. (Architecture L166 lists the field but does not itself bound it; the story/code do, so this is a self-inconsistency.) |
| F2 | med | `src/schema/normalized-event.ts:8` (`OrderKeySchema`) | consider | EdgeHunter | Architecture L173–174 makes `orderKey` the total order for a pure stable sort merging main+sub-agent streams; the golden timeline is the determinism anchor. The schema validates 3 independent fields but enforces no totality/uniqueness, so equal `(logicalClock,streamId,seqWithinStream)` triples + a stable sort can reorder run-to-run if input order isn't deterministic. Cross-row uniqueness is not expressible on a single Zod object and the merge lands in Story 1.3 (`merge.ts`), so this is a genuine forward-reference — record the uniqueness/total-order assumption on `OrderKeySchema` and carry it to 1.3's comparator. |
| F3 | low | `src/schema/normalized-event.ts` / `beat-annotation.ts` | consider | BlindHunter | Story is titled "versioned" and architecture L165 calls all core schemas versioned, but only `BattleTimeline` and `ReplayBundle` carry `z.literal(1)`; `NormalizedEvent` and `BeatAnnotation` have no version discriminator. Defensible (the bundle is versioned at top and is the cache key), but inconsistent. Action: record in Dev Notes that versioning is bundle-level only (or add literals). |
| F4 | low | `src/schema/replay-bundle.test.ts:75-91` | consider | BlindHunter | Byte-fidelity test comment (L88–90) calls `JSON.stringify` round-trip equality "the concrete property the sha256 freeze depends on", but `z.record` (tuningConfig/assetManifest/payload) preserves insertion order without canonicalizing; architecture L265 enforces canonical (stable-key-order) JSON *at hashing*, not at parse. The test itself is correct (it proves parse neither coerces, drops, nor reorders); only the comment over-claims. Action: soften the comment to note canonical ordering is a hashing-step (1.x) responsibility. |
| F5 | low | `src/schema/replay-bundle.ts:28` (`annotationHash`/`sourceHash`) | consider | EdgeHunter | `annotationHash`/`sourceHash` are bare `z.string()`; `''` parses. They are the content-address/cache key (architecture L170–172). Hash *production* is a later story, so deferral is correct — record that hash format is enforced at bundle-build time (or add `.min(1)` / a sha256 regex). |
| F6 | low | `src/schema/replay-bundle.ts:12` | consider | EdgeHunter | No cross-array referential integrity: a bundle with a dangling annotation `eventRef` and duplicate `eventId`s parses. Zod cannot express this cleanly; `groundingPointer` resolution is the portal's job and integrity is owned by the bundle-build script (Story 1.4/5.2). Correctly deferred — record the gap as a known forward-reference. |
| F7 | low | `src/schema/beat-annotation.ts:12` / `battle-timeline.ts:14` | consider | BlindHunter | `groundingPointer.eventRefs` and `Beat.sourceEventIds` permit `[]` (a beat that grounds/dramatizes nothing). Acceptable as a documented v0.1 decision (ingest doesn't populate these yet), but the invariant is unenforced — carry a `.min(1)` requirement forward to 1.3+ once ingest populates them. |
| F8 | low | `src/schema/battle-timeline.ts:37` (`BattleState`) | consider | EdgeHunter | Gauges (`problemIntegrity`/`resolve`/`insightGauge`) are bare `z.number()`; `-50` parses. Consumed as HP/gauge bars by the Story 2.2 reducer / 2.3 RenderPort. Reasonable to defer clamping to Epic 2 — record that gauge clamping is owned by the 2.2 reducer so the open range here is intentional. |
| F9 | low | `_bmad-output/implementation-artifacts/1-2-versioned-zod-schemas.md:166-167,200` | fix | EdgeHunter, AcceptanceAuditor | Debug Log / Change Log state "9 files / 58 tests"; actual `pnpm test` = 9 files / 60 tests (verified this review). Direction is harmless but the recorded evidence is stale. Fix: update the count to 60. |
| F10 | low | `src/schema/replay-bundle.ts:26-28` (`annotationHash` formula `promptVersion`) | likely-refute | AcceptanceAuditor | Architecture L171 defines `annotationHash = sha256(normalizedEvents + interpreterVersion + promptVersion)`; the bundle stores only the resulting `annotationHash` and does not surface `promptVersion`. This is CORRECT for a contracts-only story — hash computation lands later and `interpreterVersion` already lives on each annotation. The auditor's own suggested fix is "no change now". There is nothing to fix in THIS story; the only action is a future-story reminder, so it is not an actionable defect here (refuted as a finding-to-fix, not as a concern). |

### Acceptance Criteria Summary

| AC | Verdict | Note |
|----|---------|------|
| AC1 — all four contracts as `XxxSchema` const + `z.infer` type (with named fields, orderKey, schemaVersion+hash) | PASS | All schemas present with both const + inferred type; field sets match architecture L165–169,173. Proven by co-located tests; typecheck exit 0. |
| AC2 — enums are string-literal unions; no numeric/native TS enums | PASS | `z.enum([...])` for `ActionType`/`BeatType`; no `enum`/`z.nativeEnum` in `src/schema`. Out-of-set rejection proven (`'teleport'`, `'wizard'` → ZodError). |
| AC3 — serialized fields prefer explicit `null` over `undefined` | PASS | `.nullable()` on toolName/subtype/exitCode/payload/saga; behavioral proof that absent/undefined is rejected (not merely null-accepted). |
| AC4 — round-trip parse: valid passes, invalid fails with `z.ZodError` | PASS | All four schemas have parse-valid + throw-on-invalid tests; ReplayBundle additionally pins byte-for-byte round-trip (see F4 re: comment precision). `pnpm test` = 9 files / 60 tests pass. |

### Action Items (autonomous fix pass)

- [x] **F1 (fix) — RESOLVED:** added `.min(0).max(1)` to `confidence` in `beat-annotation.ts` + out-of-range reject tests (9.7, -5) and 0/1-bound accept test.
- [x] **F9 (fix) — RESOLVED:** corrected the recorded test count 58 → 60 in Debug Log References and Change Log.
- [x] **F2–F8 (consider → record) — RESOLVED:** added the "Deferred invariants / forward-references" note in Dev Notes (orderKey total-order/uniqueness →1.3 merge; bundle-level-only versioning; hash-format enforced at bundle-build; referential integrity owned by bundle-build 1.4/5.2; `.min(1)` for eventRefs/sourceEventIds carried to 1.3+; gauge clamping owned by 2.2 reducer) and softened the `replay-bundle.test.ts` byte-fidelity comment to attribute canonical ordering to the hashing step.
- [x] **F10 (likely-refute) — RESOLVED (refuted):** no change this story; confirmed `promptVersion` is a hash input for the later freeze step, not a bundle field. Recorded as a future-freeze-story reminder.
