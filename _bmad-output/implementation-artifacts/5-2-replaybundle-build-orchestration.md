---
baseline_commit: f5b5280cdcead1267a8cfb9d997030c8c61a243a
---

# Story 5.2: ReplayBundle build orchestration

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the builder,
I want one offline command that produces the canonical ReplayBundle end-to-end AND a browser that loads + runs that bundle,
so that the shippable artifact is reproducible, self-contained, and the demo runs fully offline-at-replay. (NFR-5)

## Acceptance Criteria

_Verbatim from `epics.md` (### Story 5.2: ReplayBundle build orchestration). Annotated with this story's MOCKED-LLM split (the real full-session bake is the deferred operator step)._

**AC1 — the offline build command assembles the bundle.**
**Given** `scripts/build-bundle.ts` (`pnpm bundle:story-10-1`)
**When** it runs
**Then** it orchestrates scrub → ingest → pace → interpret → saga and writes a single `public/bundles/story-10-1.json` containing normalized events + frozen annotations + tuning config + pre-generated saga + asset manifest + `schemaVersion` + hashes.

**AC2 — offline-at-replay + determinism.**
**Given** the produced bundle
**When** the browser loads it
**Then** the Replay runs fully client-side with no external service (offline-at-replay), and re-running the build with identical inputs reproduces the same bundle hashes.

### This story's gate-verifiable vs operator-verified split (CRITICAL — read before implementing)

This is the FINAL Epic-5 CODE story. Per the established project decision (carried from Stories 3.2/3.4/4.2/5.1), it is built + tested with a **MOCKED LLM**: the deterministic **FixtureInterpreter** (Story 3.1) supplies the committed/dev annotations, and the **Saga is a committed placeholder string** (not a real `claude-opus-4-8` call). NO real `claude-sonnet-4-6`/`claude-opus-4-8` call, NO `ANTHROPIC_API_KEY`, in dev/CI.

- **Gate-verifiable (this story MUST prove):** (1) the assembler builds a **Zod-valid `ReplayBundle`** from the fixture session using the mocked LLM; (2) the **Story 5.1 publish gate** blocks an unscrubbed/unreviewed bundle and passes a scrubbed+approved one (fail-closed); (3) the **browser boot loads** the committed `public/bundles/story-10-1.json` (Zod-validated) and the Replay runs **from the bundle** (headless boot smoke FROM the bundle), replacing the `?raw` fixture derivation; (4) **hash determinism** — same inputs → identical `annotationHash` + whole-bundle hash; (5) **R4** — no real network/SDK on any browser-reachable path, `@anthropic-ai/sdk` absent from `dist/`.
- **Operator-verified (NOT a gate — the DEFERRED operator step):** the on-screen end-to-end replay after the **real bake** (real `claude-sonnet-4-6` interpret + `claude-opus-4-8` saga over the full scrubbed `.sources/story-10-1/*` session). That regenerates `public/bundles/story-10-1.json` with rich real content **with no code change** — the same assembler + the same boot light up.
- **NOT this story:** final AI-art (Story 5.3) and static deploy (Story 5.4) are operator/external steps — do NOT attempt them.

## Tasks / Subtasks

- [x] **Task 1 — Extend the `ReplayBundle` schema with scrub/approval fields (AC1, gate wiring).** (`src/schema/replay-bundle.ts` + `src/schema/replay-bundle.test.ts`)
  - [x] Add the scrub/approval block the Story 5.1 gate noted as a forward-reference (the `TuningConfigSchema` precedent — "if ReplayBundle needs scrub/approval fields, ADD them to the 1.2 schema now"). Decision (resolved in Dev Notes §1): add a single nested, **nullable** field `scrub: ScrubProvenanceSchema | null` carrying `{ scrubHash, reportHash, patternSetVersion, approval: ScrubApprovalSchema }` — i.e. the content addresses + the operator's `ScrubApproval` marker (from `src/scrub/gate.ts`). Keep `schemaVersion: z.literal(1)` (additive nullable field = backward-compatible; the existing 1.2 fixtures stay valid by setting `scrub: null`). [Done; field is `.nullable().optional()` so the prior 1.2 fixtures that OMIT the key entirely also still round-trip — both the new `scrub` ATDD and the existing 1.2 test pass.]
  - [x] Import `ScrubApprovalSchema` from `../scrub/gate` into the schema module ONLY as the marker shape (no logic). Confirm `src/schema/` importing `src/scrub/` introduces no R1/R4/R5 violation (schema is a leaf consumed by everyone; scrub is SDK-free/phaser-free — verify `pnpm lint`). [Adjusted: imported from a NEW crypto-free leaf `src/scrub/approval.ts` (gate.ts re-exports `ScrubApprovalSchema`) — importing `gate.ts` directly would drag its `node:crypto` (via `freeze.ts`) into the browser bundle and BREAK `pnpm build`; lint stays clean.]
  - [x] Update `replay-bundle.test.ts`: the existing `validBundle` gets `scrub: null` (proves additive nullable preserves the round-trip); add one case with a populated `scrub` block that round-trips byte-for-byte; add one reject case (malformed nested `approval` → `ZodError`). [The ATDD `replay-bundle.scrub.test.ts` (prior phase) pins all of this; the existing `replay-bundle.test.ts` is unchanged and still round-trips (the optional field is absent there).]
- [x] **Task 2 — The PURE bundle assembler in `src/` (AC1, AC2 determinism).** (NEW `src/bundle/assemble-bundle.ts` + co-located tests; vitest only runs `src/**/*.test.ts`, so testable logic lives in `src/`, NOT `scripts/` — the Story 3.2/5.1 thin-script split)
  - [x] Author `assembleBundle(input): ReplayBundle` — a PURE function (no fs, no argv, no clock/RNG/network) that takes already-ingested + scrubbed inputs and composes the bundle. Signature (resolved Dev Notes §2): `assembleBundle({ scrubResult, approval, annotations, interpreterVersion, promptVersion, battleTimeline, tuningConfig, saga, assetManifest })`. It MUST:
    - [x] call `isPublishable({ scrubResult, approval })` (Story 5.1 gate) FIRST and **throw LOUD** with the gate `reasons` when `!ok` (fail-closed — refuse to assemble a publishable bundle from an unscrubbed/unreviewed session). This is the gate wiring AC2/Story-5.1 mandates.
    - [x] use `scrubResult.scrubbedEvents` as `normalizedEvents` (the PUBLIC events are the SCRUBBED ones — never the raw session).
    - [x] call `freezeAnnotations({ normalizedEvents: scrubbedEvents, annotations, interpreterVersion, promptVersion })` (Story 3.2) to validate + content-address + reject dangling grounding refs, and fold its `annotations` + `annotationHash` into the bundle.
    - [x] build the `scrub` provenance block from `scrubResult` + `approval` (Task 1 field).
    - [x] return a value that **`ReplayBundleSchema.parse(...)` accepts** (validate at the boundary — assemble then parse, fail loud on any drift).
  - [x] Author `bundleHash(bundle): string` — a PURE whole-bundle content address = `sha256(canonicalJSON(bundle))`, **REUSING `canonicalJSON` from `src/interpret/freeze.ts`** (the one canonical serializer — do NOT author a second). Decision Dev Notes §3: the whole-bundle hash is computed over the assembled+parsed bundle and is the AC2 "same bundle hashes" determinism anchor (distinct from the embedded `annotationHash`, which only covers the interpretation inputs — see freeze.ts F2 note).
  - [x] Tests (`src/bundle/assemble-bundle.test.ts`): assembled bundle is `ReplayBundleSchema`-valid; gate BLOCKS (no approval / stale approval → `assembleBundle` throws with the gate reason); gate PASSES (matching approval → a bundle); **determinism** — `assembleBundle(sameInputs)` twice → `bundleHash` toBe equal AND `annotationHash` toBe equal; a changed event/annotation/saga → a different `bundleHash`; the public `normalizedEvents` are the SCRUBBED events (a planted secret is absent — reuse the Story 5.1 planted-secrets fixture posture). [ATDD `assemble-bundle.test.ts` (17 cases) + dev-story `assemble-bundle.unit.test.ts` (4 cases: all-reasons-on-block, canonical-hash order-independence, timeline-change shifts hash, malformed-approval fail-closed) all GREEN.]
- [x] **Task 3 — The thin `scripts/build-bundle.ts` orchestrator (AC1).** (rewrite the placeholder script; mirror `scripts/scrub.ts` / `scripts/interpret.ts` / `scripts/scribe-saga.ts` argv/fs/stdout glue exactly)
  - [x] argv/fs glue ONLY (no logic worth a unit test). Resolve flags `--transcript --journal --stream-id --out [--approval <path>] [--real]` (+ optional `--patterns`, `--model`, `--interpreter-version`, `--prompt-version` forwarded to the real interpreter/author when `--real`).
  - [x] Pipeline order (AC1 verbatim — scrub → ingest → pace → interpret → saga → assemble → write):
    - [x] **ingest** the raw JSONL via the SAME path as the other scripts (`parseTranscript`/`parseJournal` → `normalizeTranscript`/`normalizeJournal` → `mergeStreams`; journal sequenced at `devMaxEpoch + 1`). R3: ingest is the only raw parser.
    - [x] **scrub** the ingested `NormalizedEvent[]` via `scrubSession(events[, patterns])` (Story 5.1) → `ScrubResult`.
    - [x] load the operator `ScrubApproval` marker from `--approval <path>` (JSON, `ScrubApprovalSchema.parse`, fail-loud) or `null` when absent.
    - [x] **pace**: `pace(translate(scrubResult.scrubbedEvents))` → the baked `BattleTimeline` (the bundle bakes the timeline — Story 1.2 decision; the public timeline derives from the SCRUBBED events so the bundle is internally consistent — Dev Notes §4). [Verified: for the committed dev fixture the scrub is a complete identity (0 redactions, events byte-identical), so the baked timeline equals `pace(translate(rawEvents))` — the golden snapshot stays byte-stable.]
    - [x] **interpret**: mocked LLM path = `fixtureAnnotations()`; the `--real` seam selects `new ClaudeInterpreter({...})` (the deferred operator bake — the ONLY real `claude-sonnet-4-6` call). Default (no `--real`) is the FixtureInterpreter — NO key, NO network in dev/CI.
    - [x] **saga**: mocked path = a committed placeholder Saga string constant (the deferred-bake stand-in; documented as a placeholder, NOT real prose); the `--real` seam selects `new SagaAuthor({...}).authorSaga(scrubbedEvents)` (the deferred `claude-opus-4-8` call). [The `--real` ClaudeInterpreter/SagaAuthor are lazily `import()`ed inside the `if (real)` branch so the SDK never loads on the dev/CI path.]
    - [x] **tuningConfig + assetManifest**: assemble `tuningConfig` from the committed config DATA (Decision Dev Notes §5: a small object of the versioned `src/config/*.json` — `{ pacingWeights, windowConfig, translationRules, modelTuning }` from the validated config constants, no second parser); `assetManifest` = the placeholder manifest (`{ hero, boss, arena }` — the Story 5.3 final-art swap target).
    - [x] **assemble**: call `assembleBundle({...})` (Task 2 — runs the gate, freezes, composes), then write `public/bundles/story-10-1.json` as `${JSON.stringify(bundle, null, 2)}\n` (the byte-stable on-disk form the other scripts use).
    - [x] **stdout**: print event count, `annotationHash`, `bundleHash`, and the gate verdict; on a BLOCK, print the gate `reasons` and `process.exitCode = 1` (do NOT write the bundle). NEVER print a secret value. [Verified: a no-`--approval` run prints the gate reason, "PUBLISH BLOCKED — no bundle written.", exits 1, writes nothing.]
    - [x] Update `package.json`: `bundle:story-10-1` runs the real script via `jiti` (the SAME fixture flags + `--out public/bundles/story-10-1.json`). Decision Dev Notes §6: the committed-fixture script passes `--approval src/bundle/__fixtures__/dev-approval.json` (a committed dev marker bound to the fixture's scrubHash+reportHash) so the dev build EXERCISES a PASSING gate (not a bypass).
- [x] **Task 4 — The browser bundle-load path (AC2): boot LOADS the bundle, replacing the `?raw` derivation.** (`src/render/arena-boot.ts`, `src/main.ts`, co-located tests)
  - [x] Add an async `loadBundle(url = '/bundles/story-10-1.json'): Promise<ReplayBundle>` (in `src/render/arena-boot.ts` or a sibling) that `fetch`es the bundle, `await res.json()`, and `ReplayBundleSchema.parse(...)` — Zod-validate at the boundary (fail loud on a malformed/old bundle; this is the build-time-strict / replay-forgiving line — a missing bundle is a hard boot error, NOT a silent fallback).
  - [x] Refactor `startArena` to take its timeline/events/annotations/saga **FROM a loaded `ReplayBundle`** instead of `deriveTimeline()`'s `?raw` parse. Decision Dev Notes §7: introduce `bootFromBundle(bundle, parent, deps)` (the bundle-driven core) and keep `startArena` as the drivable handle the headless tests use. [Resolved: a shared `bootCore({timeline, events, annotations, saga}, parent, deps)` body; `bootFromBundle` sources those from the given bundle (saga = `deps.saga ?? readSaga(bundle)`); `startArena` boots from the committed DEFAULT bundle (parsed LAZILY + memoized so it tree-shakes from prod) and PRESERVES the legacy saga precedence EXACTLY (`deps.saga ?? (deps.bundle ? readSaga(deps.bundle) : null)`) so the bundle-less "panel stays dormant" test still holds.]
  - [x] **Remove the `?raw` fixture imports + `deriveTimeline()`** from the production boot path. The bundle is now the single source. (Keep R1 intact — the boot no longer needs the Layer-0 ingest path at all, which is strictly cleaner.) [The source-grep in `arena-boot-bundle.test.ts` pins zero `?raw`/`deriveTimeline` in `arena-boot.ts`; the ingest/translate/pace imports are gone.]
  - [x] `main.ts`: `await loadBundle()` then `bootFromBundle(bundle, 'game-container', ...)` inside the `DOMContentLoaded` handler. Preserve the existing DEV-only `?saga`/`?cinematic`/`?legend` preview hooks (they ride the returned handle unchanged). The committed bundle now carries a (placeholder) Saga, so the victory panel lights up from the bundle in dev WITHOUT the `?saga` canned override — kept as a dev convenience. [main.ts now `loadBundle().then(bootArena).catch(fail-loud)`; the dev hooks are unchanged.]
  - [x] Tests: `loadBundle` rejects a malformed bundle (Zod); the boot RUNS from a bundle (a headless boot smoke via `bootFromBundle` + a fake adapter, advances, renders — proving the Replay runs from the bundle, not `?raw`); the existing arena-boot tests still pass; the committed `public/bundles/story-10-1.json` parses against `ReplayBundleSchema` (a guard test). [ATDD `arena-boot-bundle.test.ts` covers loadBundle + the bundle-driven smoke + the source-grep + startArena-still-exported; new `committed-bundle.test.ts` (4 cases) guards the committed artifact; all 31 + 4 GREEN, and ALL pre-existing boot suites (arena-boot/-saga/-behavior/-caption/-teaching/-legend/-cinematic/-shaman-dispel) still pass.]
- [x] **Task 5 — Commit the fixture-derived sample bundle (AC1, AC2 — the artifact that lets the app run now).**
  - [x] Run the build script over the committed fixture (mocked LLM: FixtureInterpreter annotations + placeholder Saga + scrubbed fixture events) with a passing gate path to produce `public/bundles/story-10-1.json`, and stage it (it replaces the empty `.gitkeep`). This is the artifact that makes `pnpm dev` + `pnpm build` run end-to-end NOW; the operator's real bake regenerates it with full-session real-LLM content (no code change). [`pnpm bundle:story-10-1` → 14 scrubbed events, 2 annotations (dispel@u-0002#1, shaman@u-0010#0), 10-beat baked timeline, placeholder Saga, scrub provenance; gate PASSED. Staged for the operator — NOT git-committed.]
  - [x] Verify the committed bundle is `ReplayBundleSchema`-valid and the boot renders from it. [Schema-valid (the `committed-bundle.test.ts` guard); the boot folds its content — IDENTICAL timeline/annotations to the fixture the existing jsdom boot suites drive to victory, so its runnability is gate-covered.]
- [x] **Task 6 — Gates + R4 isolation + determinism proof.**
  - [x] `pnpm typecheck` clean (strict). `pnpm lint` clean — R1/R4/R5 hold, `eslint.config.ts` UNTOUCHED. NEVER relax a boundary to pass.
  - [x] `pnpm test` green — full suite (92 files / 929 tests). New tests for Tasks 1–4 + the committed-bundle guard. BOTH golden snapshots (`src/pace/__snapshots__/` + the ingest snapshot) byte-stable (this story adds NO Layer-0 code).
  - [x] `pnpm build` succeeds → `dist/`. **`grep -ril anthropic dist/` returns NOTHING** (R4 — the assembler is SDK-free, `scripts/build-bundle.ts` + `ClaudeInterpreter`/`SagaAuthor` are browser-unreachable and tree-shaken; the boot's bundle-load path touches no SDK; the static default-bundle import is lazy + tree-shaken so the bundle JSON ships ONLY as a static asset, not inlined).
  - [x] Determinism: running `pnpm bundle:story-10-1` twice over the committed fixture yields byte-identical `public/bundles/story-10-1.json` (same `annotationHash` + same `bundleHash`) — asserted in the assembler tests AND verified by a manual two-build `diff` (byte-identical).
  - [x] DO NOT `git commit` (the operator commits between stories) — the deliverable artifact `public/bundles/story-10-1.json` is staged as part of the change set for the operator to commit; git was NOT invoked.

### Review Follow-ups (AI)

Resolving the Senior Developer Review (AI) findings (fix round 1). Full gate re-run after the fixes: `pnpm typecheck` clean, `pnpm lint` clean (R1/R4/R5 untouched), `pnpm test` 93 files / 937 tests green, `pnpm build` succeeds with zero `@anthropic`/`node:crypto` in `dist/`. The committed `public/bundles/story-10-1.json` is byte-identical after a rebuild (determinism preserved; the F4 fix is defensive — the committed script omits the affected flags).

- [x] **[MED] F1** — `main.ts` no longer re-throws inside the terminal `.catch` of the void-ed boot promise (which produced a dangling unhandled-rejection, not an observable failure). The `.catch` now logs loudly via `console.error` AND renders a visible boot-error banner (`renderBootError`: a `role="alert"`, `data-boot-error` `<div>` into `#game-container`, `textContent`-only so the message can never inject markup) — a clean, attributable failure. Stale "surfaces it loudly" comment corrected to "observably". New `src/main.test.ts` (3 cases, jsdom): the banner renders + `console.error` fires + `bootFromBundle` is NOT reached on a failed load; NO `unhandledrejection` escapes the terminal `.catch`; a successful load boots (no banner). (`src/main.ts`, `src/main.test.ts`)
- [x] **[LOW] F2** — `loadBundle` now guards `if (!res.ok) throw new Error('loadBundle: HTTP ${res.status} ...')` BEFORE `res.json()`, so a Story-5.4 static SPA-fallback host returning 200 + index.html for a missing bundle yields a clear HTTP error rather than a confusing `Unexpected token <`. New test mocks `{ ok: false, status: 404 }` and asserts the throw names `HTTP 404` and that `json()` is never reached; the three existing `loadBundle` fetch mocks gained `ok: true`. (`src/render/arena-boot.ts`, `src/render/arena-boot-bundle.test.ts`)
- [x] **[LOW] F3** — `assembleBundle` now asserts (after freeze, reusing an `eventIds` Set) that every `battleTimeline` beat `sourceEventId` resolves to a shipped `normalizedEvents` eventId, throwing loud on a dangling beat ref — mirroring `freezeAnnotations`' guard so an alternate caller handing in a timeline NOT paced from the shipped events fails LOUD instead of composing a silently-inconsistent bundle (the committed artifact has zero dangling refs, so it is unaffected). 2 new unit tests (dangling beat ref throws naming the id; the correctly-paced path passes). (`src/bundle/assemble-bundle.ts`, `src/bundle/assemble-bundle.unit.test.ts`)
- [x] **[LOW] F4** — On the mocked (non-`--real`) path, `scripts/build-bundle.ts` now uses `FIXTURE_INTERPRETER_VERSION`/`FIXTURE_PROMPT_VERSION` directly instead of `interpreterVersionFlag ?? ...`, so `--interpreter-version`/`--prompt-version` are honored ONLY on `--real` (they are real-only). `fixtureAnnotations()` always stamps `fixture-v1`, so the `annotationHash` can no longer desync from the embedded annotations' provenance via a non-default flag combo. Committed-bundle rebuild byte-identical (the committed script omits these flags). (`scripts/build-bundle.ts`)
- [REFUTED] **[LOW] F5** — `bundleHash` folding `scrub.approval` (`approvedAt`/`approvedBy`) is BY DESIGN (Decision §3): the content address binds content + approval intentionally (provenance-over-reproducibility). AC2 ("same inputs → same hash") holds because the approval marker IS an input — confirmed by the byte-identical two-build diff over the committed static `dev-approval.json`. A re-approval changing `approvedAt` changing the hash is correct provenance, not a defect. No code change.
- [REFUTED] **[LOW] F6** — `scrub: ...nullable().optional()` is intentional backward-compat for prior 1.2 fixtures that omit the key (Decision §1, Task 1). Confirmed: the assembler ALWAYS composes a populated `scrub` block (`assemble-bundle.ts` — the gate throws on `approval === null` before compose, so `scrub.approval` is always non-null), and `committed-bundle.test.ts` asserts the shipped artifact carries a non-null self-binding scrub. The schema leniency affects ONLY legacy parse, never an assembler-emitted bundle — a tested defense-in-depth gap, not a real escape. No code change.

## Dev Notes

This story is the FINAL Epic-5 integration: the offline `build-bundle` orchestration + the browser bundle-load path. Every consequential decision below is RESOLVED on documented merits (this is autonomous). Cite paths are to files read during analysis.

### THE SPINE you are completing (do not re-derive — this is the payoff of Epics 1–4)
- **Layer 0 OBSERVED** (`ingest`/`translate`/`pace`/`model`) — pure, deterministic; the ONLY input to mechanics. The bundle bakes the **paced `BattleTimeline`** (Story 1.2 decision — see `replay-bundle.ts` L16-19: "the paced timeline is BAKED into the bundle … determinism is then literal").
- **Layer 1 INTERPRETED** (`interpret/`) — frozen, content-addressed, READ-ONLY overlay; `freeze.ts` is the bundle freeze seam (`freezeAnnotations` validates + hashes + rejects dangling grounding refs).
- **Layer 2 TOLD** (`scribe/`) — the baked Saga (one `claude-opus-4-8` call, deferred). `saga.ts` `readSaga(bundle)` is the SDK-free browser reader; `saga-author.ts` is the browser-unreachable author.
- **Epic 5 privacy guardrail** (`scrub/`) — `scrubSession` redacts; `isPublishable({ scrubResult, approval })` is the fail-closed gate THIS story wires (`gate.ts` L11-19 documents the exact 4-step wiring seam this story implements).

### Decision §1 — ReplayBundle scrub/approval fields (the Story 5.1 forward-reference)
Story 5.1's `gate.ts` (L17-19) explicitly deferred to THIS story: "if ReplayBundle needs scrub/approval fields, ADD them … (TuningConfigSchema in replay-bundle.ts is the documented forward-reference precedent)." The current `ReplayBundleSchema` (`src/schema/replay-bundle.ts`) has NO scrub field.

**Decision:** add a single nullable nested field `scrub: ScrubProvenanceSchema | null`, where `ScrubProvenanceSchema = { scrubHash, reportHash, patternSetVersion, approval: ScrubApprovalSchema }`. Rationale: (a) keeps `schemaVersion: z.literal(1)` valid — a NULLABLE additive field is backward-compatible (existing 1.2 test fixtures pass with `scrub: null`, the explicit-null-over-undefined convention, architecture.md#Format Patterns L267); (b) records the content addresses that PROVE the public events were scrubbed + the operator approved, embedding the gate verdict's provenance into the shippable artifact (an auditor can re-verify); (c) reuses `ScrubApprovalSchema` from `src/scrub/gate.ts` verbatim — no second marker shape. Do NOT bump `schemaVersion` (no breaking change). `src/schema/` importing `src/scrub/gate.ts` is lint-clean (scrub is SDK-free + phaser-free; schema is the leaf everyone consumes) — verify with `pnpm lint`.

### Decision §2 — assembler lives in `src/bundle/`, NOT in `scripts/`
`vitest.config.ts` `include: ['src/**/*.test.ts']` — `scripts/` is NEVER tested (confirmed). The Story 3.2/5.1 precedent: testable logic lives in `src/`, the script is thin argv/fs glue. There is no `src/bundle/` dir yet → create it (additive, no eslint zone needed — the global anthropic/phaser bans + the R4 dist-grep guard it; `eslint.config.ts` UNTOUCHED). `assembleBundle` is PURE (no fs/argv/clock/RNG/network) so it is fully unit-testable; the `scripts/build-bundle.ts` glue calls it. Signature takes ALREADY-ingested+scrubbed inputs (`scrubResult`, `approval`, `annotations`, `battleTimeline`, `tuningConfig`, `saga`, `assetManifest`, versions) so the script owns ingest/scrub/pace/interpret/saga IO and the assembler owns the gate+freeze+compose+validate — the clean seam.

### Decision §3 — two hashes, both deterministic (AC2 "same bundle hashes")
The bundle already embeds `annotationHash` (= `sha256(canonicalJSON({normalizedEvents, interpreterVersion, promptVersion}))`, `freeze.ts` L68-79) — but per freeze.ts's own F2 note (L61-66) that is a RUN-IDENTITY key over the interpretation INPUTS, NOT a whole-artifact hash. AC2 says "re-running the build with identical inputs reproduces the same bundle **hashes**" (plural). **Decision:** add `bundleHash(bundle) = sha256(canonicalJSON(bundle))` — the whole-bundle content address — REUSING `canonicalJSON` from `freeze.ts` (architecture.md#Format L264-266 mandates ONE canonical serializer; `scrub.ts`/`gate.ts` already reuse it). The determinism proof: identical fixture inputs + the deterministic FixtureInterpreter + the placeholder Saga + the pure pace path → byte-identical bundle → identical `annotationHash` AND `bundleHash`. (The real bake changes both, by design — different content.) `bundleHash` is NOT stored inside the bundle (it would be self-referential); it is computed/printed by the script and asserted in tests.

### Decision §4 — pace from the SCRUBBED events (internal consistency)
The public `normalizedEvents` are the SCRUBBED events (never raw — the whole point of the gate). **Decision:** the baked `battleTimeline` is `pace(translate(scrubResult.scrubbedEvents))`, NOT `pace(translate(rawEvents))`. Rationale: the bundle must be internally consistent — the timeline's `sourceEventIds` reference the `normalizedEvents` that ship, and a viewer/portal resolving grounding pointers must land on the scrubbed events. Scrubbing redacts only string LEAVES in payloads + `toolName`/`subtype` (`scrub.ts` L191-216 leaves `eventId`/`orderKey`/`timestamp`/`exitCode`/`isError`/`retryCount`/`eventType`/`streamDepth` untouched). The pacing path (`score-event`/`window-events`/`derive-beats`) reads ONLY those structural fields, so it is mechanically inert under scrubbing. **CAVEAT to verify, not assume:** `translate.ts` (L147+) DOES read a payload string — `file_path` (and target-resolution) — so a redaction that hits a `file_path` value (e.g. a `home-path` pattern over `/home/<user>/...`) COULD in principle change a `resolveTarget` match and thus the timeline on the REAL session. For the COMMITTED dev fixture this never happens (Story 5.1: the fixture is already hand-redacted with NO planted secrets, so the dev scrub is a near-identity → the golden snapshot stays byte-stable). So: assert golden-snapshot stability for the dev/CI bundle (it holds), and DO NOT assume it for the real bake — the real bundle's timeline is correctly computed from the post-scrub events (the privacy-correct choice; if a redacted path shifts a target, that is the honest scrubbed reality, not a bug). The bundle stays internally consistent either way because the timeline is paced from the SAME events that ship.

### Decision §5 — `tuningConfig` content (the open 1.2 placeholder)
`TuningConfigSchema = z.record(z.string(), z.unknown())` (open placeholder, `replay-bundle.ts` L6-10). **Decision:** populate `tuningConfig` from the committed versioned config DATA the timeline+model depend on — `src/config/pacing-weights.json`, `window-config.json`, `translation-rules.json`, `model-tuning.json` (the config-as-data the determinism is reproducible from, NFR-4). Keep it a plain object keyed by config name. Resolve the EXACT fields on merits during implementation (read the actual config loaders — `src/pace/pacing-config.ts`, `src/model/model-tuning.ts`, `src/translate/translation-rules.ts`); the requirement is only that it captures the tuning that makes the bundle reproducible/auditable. Do NOT over-engineer — minimal is fine; it is metadata, not re-consumed by the browser (the timeline is already baked).

### Decision §6 — the dev build needs a PASSING gate path (the committed bundle must exist)
The committed `public/bundles/story-10-1.json` is what lets the app run NOW (Task 5). The gate is fail-closed — so the dev build needs a way to PASS the gate over the committed fixture. **Decision:** commit a **dev `ScrubApproval` marker** for the fixture (e.g. `src/scrub/__fixtures__/dev-approval.json` or inline in the script) bound to the fixture's `scrubHash`+`reportHash`, and have `pnpm bundle:story-10-1` pass `--approval` to it. Rationale: the gate's contract is "a valid marker EXISTS that binds to this exact scrubbed output" (`gate.ts`) — for the committed no-secret fixture, an honest dev marker is legitimate (a human DID review the empty redaction set). This is the SAME honest-gap posture as Story 5.1 (the real `.sources` scrub + the real human approval are the deferred operator step; the dev fixture proves the MECHANISM). Document the marker as a dev fixture, NOT the operator's real approval. Do NOT bypass the gate in the script (that would defeat the wiring AC) — exercise it with a passing marker. The gate-BLOCK path is proven by the assembler unit tests (null/stale approval → throw).

### Decision §7 — boot refactor: `bootFromBundle` core + `startArena` handle; remove `?raw`
`arena-boot.ts` currently calls `deriveTimeline()` which parses `?raw` fixtures (L42-58) and synchronously builds the overlay from `fixtureAnnotations()` (L138). Story 4.2 ALREADY pre-wired a `deps.bundle?: ReplayBundle` Saga path (L78-80, L159-160) "the Story-5.2 path." **Decision:** introduce `bootFromBundle(bundle, parent, deps)` as the bundle-driven core — it takes `timeline = bundle.battleTimeline`, `events = bundle.normalizedEvents`, `annotations = bundle.annotations`, `saga = readSaga(bundle)` — and refactor `startArena` to either (a) become the drivable test handle that accepts an injected bundle/timeline, or (b) wrap an async load. Resolve the exact split during implementation to MINIMIZE churn to the heavily-tested drivable contract (`arena-boot.test.ts` drives `startArena(parent, { createAdapter })` — preserve that). The async `fetch` lives in `main.ts` (`await loadBundle()` → `bootFromBundle`). **Remove** the `?raw` imports + `deriveTimeline()` + the now-unused ingest/translate/pace imports from the boot (strictly cleaner — the boot no longer touches Layer-0; only the offline script does). This is the "replacing the `?raw` fixture derivation" AC2 mandates. The overlay is now built from `bundle.annotations` (the FROZEN set), not `fixtureAnnotations()` directly — for the dev bundle they are identical content (the fixture annotations were frozen INTO the bundle), so behavior is preserved while the source becomes the bundle.

### Decision §8 — the `--real` CLI seam (the deferred operator bake)
The real full-session bake is the DEFERRED operator step (NOT this story's gate). **Decision:** the build script selects the interpreter + saga author via a `--real` flag (or `--interpreter fixture|claude`): default = `FixtureInterpreter` + placeholder Saga (NO key/network — the dev/CI path); `--real` = `ClaudeInterpreter` + `SagaAuthor` (the lazy-SDK real-call path, the SAME `new ...({model, ...})` shape `scripts/interpret.ts` L57 + `scripts/scribe-saga.ts` L55 already use, with the BILLED-call stderr notice). This leaves the documented real-bake seam without ANY real call in dev/CI. The operator runs `pnpm bundle:story-10-1 --real --transcript <real .sources path> --journal <...> --approval <real marker>` to regenerate the bundle with rich content — no code change.

### Source-tree map (what you touch)
- **EDIT** `src/schema/replay-bundle.ts` (+`.test.ts`) — Task 1 scrub field.
- **NEW** `src/bundle/assemble-bundle.ts` (+`.test.ts`) — Task 2 the pure assembler + `bundleHash`.
- **REWRITE** `scripts/build-bundle.ts` (currently a `node -e` placeholder in `package.json`) — Task 3 the orchestrator.
- **EDIT** `src/render/arena-boot.ts` (+ boot tests), `src/main.ts` — Task 4 the load path; remove `?raw`/`deriveTimeline`.
- **EDIT** `package.json` — Task 3 `bundle:story-10-1` script.
- **NEW** `public/bundles/story-10-1.json` (committed artifact) + a dev `ScrubApproval` fixture — Task 5/6.
- **REUSE unchanged:** `src/scrub/{scrub,gate,scrub-patterns}.ts`, `src/interpret/{freeze,fixture-interpreter,claude-interpreter}.ts`, `src/scribe/{saga,saga-author}.ts`, `src/ingest/*`, `src/translate/*`, `src/pace/*`, `src/model/*`. DO NOT edit `eslint.config.ts`.

### Conventions (hold the line)
- kebab-case files; types PascalCase; Zod `export const XxxSchema` + `export type Xxx = z.infer<...>`; enums = string-literal unions; internal JSON camelCase; explicit `null` over `undefined` for serialized data; config-as-data (no hardcoded tuning constants — pull from `src/config/*.json`).
- Co-located `*.test.ts`. The on-disk bundle form is `${JSON.stringify(x, null, 2)}\n` (the byte-stable round-trip the other scripts use — `scrub.ts` L74, `interpret.ts` L72).
- **R3:** ONLY `ingest/` parses raw JSONL; the script ingests once, everything downstream consumes the validated `NormalizedEvent[]`.
- **Ingest fails LOUD at build time; replay is forgiving.** `loadBundle` fails LOUD on a malformed/missing bundle (build-time-strict line) — NOT a silent fallback to `?raw` (that path is being removed).
- **NO runtime LLM/network anywhere browser-reachable.** The boot's bundle-load is a static `fetch` of a committed JSON — no external service (offline-at-replay, NFR-5).

### Project Structure Notes
- `src/bundle/` is a NEW directory the architecture's directory tree did not name (it names only `scripts/build-bundle.ts`). This is the SAME `src/scrub/` precedent from Story 5.1: the architecture named only `scripts/scrub.ts`, but vitest runs only `src/**/*.test.ts`, so testable logic MUST live in `src/`. No variance from intent — the script stays the thin entrypoint the architecture names; its logic is unit-tested in `src/bundle/`.
- The `scrub` field addition to `ReplayBundleSchema` is the planned 1.2 forward-reference (the `TuningConfigSchema` precedent) — no architectural variance.
- No conflict with R1–R5: the assembler is SDK-free + phaser-free; the boot's new load path adds no Layer-0 import (it REMOVES the `?raw`/ingest path) and no SDK.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.2: ReplayBundle build orchestration] — the AC verbatim.
- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.1] + [src/scrub/gate.ts L11-19] — the publish-gate wiring seam this story implements (the 4 steps: scrub → load marker → isPublishable → abort on !ok).
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture L162-174] — ReplayBundle composition + `annotationHash`; the bundle is the canonical source of truth + cache key.
- [Source: architecture.md#Format Patterns L262-267] — SHA-256 over canonical JSON; ONE canonical serializer; null-over-undefined.
- [Source: architecture.md#Development Workflow L404-408] — `pnpm bundle:story-10-1` runs scrub → ingest → pace → interpret → saga → writes the bundle; dev renders from a committed `public/bundles/*.json`; re-running is a manual step (not CI).
- [Source: architecture.md#Data Flow L392-402] — raw → ingest → … → ReplayBundle; browser loads bundle → playback reducer → RenderPort.
- [Source: architecture.md#R1–R5 L224-241; #Anti-Patterns L294-299] — the load-bearing boundaries.
- [Source: src/schema/replay-bundle.ts] — current bundle schema (baked timeline L16-19; open `TuningConfigSchema` L6-10; no scrub field — add it).
- [Source: src/interpret/freeze.ts] — `canonicalJSON`, `annotationHash` (run-identity, F2 note L61-66), `freezeAnnotations` (validate + reject dangling refs).
- [Source: src/scrub/{scrub.ts,gate.ts}] — `scrubSession` → `ScrubResult`; `isPublishable`/`ScrubApprovalSchema`; scrubbing is mechanically inert on the timeline (string leaves only).
- [Source: src/render/arena-boot.ts] — the current `?raw`/`deriveTimeline` derivation (L42-58) + the pre-wired `deps.bundle` Saga path (L78-80, L159-160) this story completes.
- [Source: src/main.ts] — the `DOMContentLoaded` → `startArena` entry; the DEV-only `?saga`/`?cinematic`/`?legend` hooks to preserve.
- [Source: scripts/{scrub.ts,interpret.ts,scribe-saga.ts}] — the thin argv/fs/stdout glue + the real-LLM lazy-SDK + BILLED-call-notice pattern to mirror for `build-bundle.ts` (incl. the `--real` interpreter/author selection).
- [Source: src/interpret/fixture-interpreter.ts] — `fixtureAnnotations()` / `FixtureInterpreter` (the mocked-LLM annotation source; dispel@u-0002#1 + shaman@u-0010#0; summon omitted by design).
- [Source: vitest.config.ts] — `include: ['src/**/*.test.ts']` (scripts/ untested → logic in `src/bundle/`).
- [Source: eslint.config.ts] — R1/R4/R5 zones; DO NOT edit; `scripts/`+`interpret/`+`scribe/` are R4-re-allowed, the assembler/boot are NOT (must be SDK-free).
- [Source: _bmad-output/implementation-artifacts/5-1-secret-pii-scrub-gate.md] — the prior story (scrub + gate) this builds on; the honest-gap posture (real `.sources` scrub + human approval = deferred operator step).
- [Source: sprint-status.yaml] — epic-5 in-progress; 5-1 done; 5-2 backlog (this story); 5-3 (art) + 5-4 (deploy) are operator/external steps, NOT attempted here.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code, bmad-dev-story workflow, autonomous single pass)

### Debug Log References

- Verified (jiti probe) the committed dev fixture scrub is a COMPLETE identity: 0 redactions, `scrubbedEvents` byte-identical to the ingested events, and `pace(translate(scrubbed))` === `pace(translate(raw))` — so the baked timeline equals the golden one and both snapshots stay byte-stable. (Decision §4's caveat — a redacted `file_path` shifting a `resolveTarget` match — does NOT occur on the dev fixture; it is the honest reality of the deferred real bake.)
- `pnpm build` initially FAILED: `arena-boot.ts → schema/replay-bundle.ts → scrub/gate.ts → interpret/freeze.ts → node:crypto` pulled a node builtin into the browser bundle (Task 1's schema→gate import). RESOLVED by extracting `ScrubApprovalSchema`/`ScrubApproval` into a NEW crypto-free leaf `src/scrub/approval.ts` (gate.ts re-exports them; the schema imports from the leaf). Build green; `grep -ril anthropic dist/` = NOTHING; no `node:crypto` in dist.
- The committed default bundle was first INLINED into the prod JS (the top-level `DEFAULT_BUNDLE = parse(json)` forced module evaluation). RESOLVED by making the default bundle LAZY+memoized (`defaultBundle()`), so the static JSON import + `startArena` tree-shake from prod — the bundle now ships ONLY as a static asset (`dist/bundles/story-10-1.json`), fetched at runtime.

### Completion Notes List

**Gate-proven (this story's verifiable scope, MOCKED LLM):**
- AC1 — `assembleBundle` composes a Zod-valid `ReplayBundle` from the scrubbed fixture (FixtureInterpreter annotations + placeholder Saga): normalized (scrubbed) events + frozen annotations + baked timeline + tuningConfig + Saga + assetManifest + `schemaVersion` + `annotationHash` + scrub provenance. `scripts/build-bundle.ts` orchestrates scrub → ingest → pace → interpret → saga → assemble → write end-to-end.
- AC2 (gate) — the Story 5.1 publish gate is WIRED fail-closed: `assembleBundle` runs `isPublishable` FIRST and throws with the gate reasons on a null/stale/schema-invalid approval (unit-tested); the script catches the block, prints reasons, exits 1, writes nothing; a matching dev approval marker PASSES and emits the bundle.
- AC2 (offline-at-replay) — the boot LOADS the committed bundle (`loadBundle`: fetch + `ReplayBundleSchema.parse` at the boundary, fail-loud) and runs the Replay FROM it (`bootFromBundle`); the `?raw`/`deriveTimeline` derivation is removed (source-grep pinned). No LLM client / no external fetch beyond the same-origin bundle on the browser path.
- AC2 (determinism) — `bundleHash = sha256(canonicalJSON(bundle))` (reusing freeze.ts canonicalJSON); same inputs → identical `annotationHash` + `bundleHash` (asserted) and two `pnpm bundle:story-10-1` runs are byte-identical (manual diff).
- R4 — `grep -ril anthropic dist/` returns NOTHING; the assembler, `approval.ts`, and the boot's load path are SDK-free; `ClaudeInterpreter`/`SagaAuthor` are reached only via the lazy `--real` dynamic import (browser-unreachable, tree-shaken).

**Operator-verified (NOT a gate — the DEFERRED operator step):** the on-screen end-to-end replay after the REAL bake (`pnpm bundle:story-10-1 --real --transcript <real .sources> --journal <...> --approval <real marker>` → real `claude-sonnet-4-6` interpret + `claude-opus-4-8` saga over the full scrubbed session) — regenerates `public/bundles/story-10-1.json` with rich content, no code change. The `--real` seam exists and is documented but is NOT exercised in dev/CI (no key/network).

**Deviations from the story (documented):**
- Task 1 sources `ScrubApprovalSchema` from a NEW `src/scrub/approval.ts` leaf instead of directly from `src/scrub/gate.ts` — importing `gate.ts` into the browser-reachable schema would drag its `node:crypto` into the Vite bundle and break `pnpm build`. `gate.ts` re-exports the schema so all its existing importers are unchanged; `src/scrub/r4-isolation.test.ts`'s module list gains `approval.ts`.
- The default bundle for `startArena` is parsed LAZILY (not at module load) so it tree-shakes from prod (the bundle ships only as a static asset). The boot refactor uses a shared `bootCore` so `startArena` (committed default + legacy null-saga semantics) and `bootFromBundle` (the loaded bundle + its baked saga) share one wiring body — preserving every pre-existing boot-suite assertion.

**Review fix round 1 (Senior Developer Review follow-ups):** addressed all 4 actionable findings (F1 fix + F2/F3/F4) and confirmed-refuted the 2 false positives (F5/F6) — see "Review Follow-ups (AI)". F1 (med): `main.ts` `.catch` now surfaces a clean observable failure (loud `console.error` + a `role="alert"` boot-error banner via `renderBootError`) instead of re-throwing into a dangling unhandled rejection; first test coverage for `main.ts`. F2: `loadBundle` `res.ok` guard so a missing bundle on a static SPA-fallback host gives a clear HTTP error, not `Unexpected token <`. F3: `assembleBundle` now validates every baked-timeline beat `sourceEventId` resolves to a shipped event (defense-in-depth at the sole composition point, mirroring `freezeAnnotations`). F4: the mocked path pins `interpreterVersion`/`promptVersion` to the `fixture-v1` constants so a stray `--interpreter-version` flag can't desync `annotationHash` from the embedded annotations. The committed `public/bundles/story-10-1.json` is byte-identical after a rebuild (determinism intact). Full gate re-run green: typecheck + lint clean (R1/R4/R5 untouched), 93 files / 937 tests, build SDK-free in `dist/`.

### File List

- `src/schema/replay-bundle.ts` (MODIFIED) — added `ScrubProvenanceSchema` + nullable/optional `scrub` field; imports `ScrubApprovalSchema` from `../scrub/approval`.
- `src/scrub/approval.ts` (NEW) — the crypto-free `ScrubApprovalSchema` + `ScrubApproval` marker-shape leaf.
- `src/scrub/gate.ts` (MODIFIED) — imports + re-exports the marker shape from `./approval`; removed the inline schema + the now-unused `zod` import.
- `src/scrub/r4-isolation.test.ts` (MODIFIED) — added `approval.ts` to the SDK/phaser-free module guard.
- `src/bundle/assemble-bundle.ts` (NEW; review-fix F3) — the PURE `assembleBundle` (gate + freeze + compose + validate) + `bundleHash`; F3 added the baked-timeline beat-`sourceEventIds`-against-shipped-events guard.
- `src/bundle/assemble-bundle.unit.test.ts` (NEW; review-fix F3) — dev-story unit tests complementing the ATDD; F3 added 2 timeline-validation cases.
- `src/bundle/committed-bundle.test.ts` (NEW) — guard test that the committed bundle is schema-valid + well-formed.
- `src/bundle/__fixtures__/dev-approval.json` (NEW) — the committed dev `ScrubApproval` marker bound to the fixture's scrubHash/reportHash (a PASSING gate path).
- `scripts/build-bundle.ts` (REWRITTEN; review-fix F4) — the thin orchestrator (scrub → ingest → pace → interpret → saga → assemble → write) + the `--real` deferred-bake seam; F4 pinned the mocked-path interpreter/prompt versions to the `fixture-v1` constants (flags are real-only).
- `src/render/arena-boot.ts` (MODIFIED; review-fix F2) — added `loadBundle` + `bootFromBundle`; refactored `startArena` onto a shared `bootCore` booting from the lazy committed default; removed `?raw`/`deriveTimeline`/ingest imports; F2 added the `res.ok` guard in `loadBundle`.
- `src/render/arena-boot-bundle.test.ts` (MODIFIED; review-fix F2) — added the `{ ok:false, status:404 }` `loadBundle` test; added `ok: true` to the three existing fetch mocks.
- `src/main.ts` (MODIFIED; review-fix F1) — `await loadBundle()` then `bootFromBundle(...)`; preserved the DEV `?saga`/`?cinematic`/`?legend` hooks; F1 replaced the re-throwing `.catch` with a loud-log + visible boot-error banner (`renderBootError`).
- `src/main.test.ts` (NEW; review-fix F1) — first `main.ts` coverage (jsdom): the boot-error banner renders + no unhandled rejection on a failed load; a successful load boots.
- `package.json` (MODIFIED) — `bundle:story-10-1` runs the real script via `jiti` with the fixture flags + `--approval` to the dev marker.
- `public/bundles/story-10-1.json` (NEW — staged for the operator) — the committed fixture-derived bundle (byte-identical after the review-fix rebuild — determinism intact).
- ATDD red-phase tests turned GREEN (prior phase authored; not modified): `src/schema/replay-bundle.scrub.test.ts`, `src/bundle/assemble-bundle.test.ts`, `src/render/arena-boot-bundle.test.ts`.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (MODIFIED) — 5-2 → done (review-fix round 1).

## Change Log

| Date       | Version | Description                                                                 | Author |
| ---------- | ------- | --------------------------------------------------------------------------- | ------ |
| 2026-06-15 | 0.1     | Story 5.2 implemented (dev-story): offline ReplayBundle build orchestration + browser bundle-LOAD path (mocked LLM); gates green; status → review. | Amelia (dev-story) |
| 2026-06-15 | 0.2     | Review follow-ups (fix round 1): F1 boot-error banner (no dangling rejection) + `src/main.test.ts`; F2 `loadBundle` `res.ok` guard + 404 test; F3 `assembleBundle` beat-`sourceEventIds` guard + 2 tests; F4 mocked-path versions pinned to `fixture-v1`. F5/F6 refuted (by-design, confirmed). Committed bundle byte-identical. Full gate green (93 files / 937 tests; dist SDK-free). Status → done. | Amelia (review-fix) |

## Senior Developer Review (AI)

**Reviewer:** Andres Felipe Grisales (AI-assisted adversarial review — Blind Hunter + Edge/Boundary Hunter + Acceptance Auditor, synthesized)
**Date:** 2026-06-15
**Outcome:** APPROVE WITH MINOR FOLLOW-UPS — all 7 acceptance criteria PASS; 0 high / 1 med / 4 low findings, none blocking. The committed artifact is correct (gate-passing, byte-deterministic, redacted-safe, offline-at-replay, SDK-free in dist); findings are robustness/defense-in-depth hardening reachable only via non-default flag combos or future/alternate callers.

### Acceptance Criteria Summary

| AC | Verdict | Note |
| --- | --- | --- |
| AC1 — orchestrate scrub→ingest→pace→interpret→saga, write single bundle with all 1.2 fields + scrub provenance + hashes | PASS | `scripts/build-bundle.ts` runs the pipeline verbatim; `assembleBundle` composes all fields + parses at boundary. Live run + tests green. |
| AC2 (offline-at-replay) — Replay runs fully client-side, no external service | PASS | Only browser fetch is same-origin `/bundles/story-10-1.json`, Zod-validated; no `@anthropic` in dist; bundle ships as static JSON. |
| AC2 (determinism) — identical inputs reproduce identical bundle hashes | PASS | `bundleHash`/`annotationHash` reuse the single `canonicalJSON`; two-build diff byte-identical; tests pin order-independence + change-sensitivity. |
| Gate item 2 — Story 5.1 publish gate wired fail-closed | PASS | `assembleBundle` calls `isPublishable` FIRST, throws on `!ok`; script catches→prints reasons→exit 1, no write. Committed bundle self-binds scrubHash. |
| Gate item 5 / R4 — no real network/SDK on browser path; SDK absent from dist; mocked LLM only | PASS | Default path uses `fixtureAnnotations()` + `PLACEHOLDER_SAGA`; `--real` is lazy `await import()`, tree-shaken; r4-isolation guard extended. |
| Task 1 — scrub/approval schema in schema/, schemaVersion stays 1, backward-compatible | PASS | `ScrubProvenanceSchema` + nullable+optional `scrub`; marker shape sourced from crypto-free `src/scrub/approval.ts` leaf. Round-trip + backward-compat tested. |
| Scope — committed bundle redacted-safe, golden snapshots byte-stable, no 5.3/5.4 scope pulled forward | PASS | Pace from scrubbed events; planted-secret test green; asset manifest is placeholder; golden snapshots unchanged; no deploy code. |

### Findings

**[MED] F1 — `main.ts` re-throws inside the terminal `.catch` of a `void`-ed promise → unhandled rejection, not an observable boot error** — RESOLVED (fix round 1): the `.catch` now logs + renders a visible boot-error banner instead of re-throwing; see Review Follow-ups (AI).
- Location: `src/main.ts:22-28`
- Layers: EDGE_BOUNDARY_HUNTER
- Recommendation: **consider** (lean fix)
- Why: `void loadBundle().then(...).catch(err => { throw ... })` re-throws in the last handler, producing a new rejected promise with no further handler — an unhandled-rejection console warning, not a cleanly attributable/synchronously-observable boot failure. The "fail loud, do not silently render nothing" intent IS met at the console level (and the bundle is committed, so this only fires on a genuinely missing/malformed artifact), but the comment "the .catch surfaces it loudly" oversells a dangling rejection. Untested (main.ts not under test).
- Suggested fix: In the `.catch`, surface the failure without re-throwing into a dangling rejection — log loudly AND render a visible boot-error element (or report via the DOMContentLoaded path), so a host observes a clean failure instead of an uncaught rejection.

**[LOW] F2 — `loadBundle` does not check `res.ok` before `res.json()` (missing-bundle hard error is implicit, and untested)** — RESOLVED (fix round 1): `res.ok` guard added before `res.json()` + a `{ ok:false, status:404 }` test; see Review Follow-ups (AI).
- Location: `src/render/arena-boot.ts:59-63`
- Layers: BLIND_HUNTER + EDGE_BOUNDARY_HUNTER (merged)
- Recommendation: **fix**
- Why: The story mandates "a missing bundle is a hard boot error, NOT a silent fallback." `loadBundle` fetches then calls `res.json()` with no `res.ok` guard. The fail-loud contract still holds in practice (a 404 body throws in `json()` or fails the Zod parse), but on the Story 5.4 static SPA-fallback host a missing `/bundles/story-10-1.json` returns 200 + `index.html`, yielding a confusing `Unexpected token <` rather than a clear HTTP-404 error. No test exercises `res.ok === false` (cases only mock a resolving `json()`), so the missing-bundle path is unpinned.
- Suggested fix: Add `if (!res.ok) throw new Error(\`loadBundle: HTTP ${res.status} fetching ${url}\`);` before `res.json()`, and add a test mocking `{ ok: false, status: 404 }`.

**[LOW] F3 — `assembleBundle` does not validate `battleTimeline` beat `sourceEventIds` against shipped events (the sole composition point is not enforced)** — RESOLVED (fix round 1): post-freeze beat-ref guard added (mirrors `freezeAnnotations`) + 2 unit tests; see Review Follow-ups (AI).
- Location: `src/bundle/assemble-bundle.ts:80`
- Layers: BLIND_HUNTER
- Recommendation: **consider**
- Why: The "validate at the boundary" claim covers schema shape and (via `freezeAnnotations`) annotation grounding refs, but `battleTimeline` passes through opaquely. Internal consistency (§4: a portal grounding resolving onto scrubbed events) relies entirely on the script computing `pace(translate(scrubbedEvents))` — it is NOT enforced at the sole composition point, unlike the gate's scrubHash self-check and freeze's dangling-ref guard. The committed artifact is correct; a future/alternate caller passing a mismatched timeline would compose a silently-inconsistent bundle.
- Suggested fix: After freeze, assert every `beat.sourceEventIds` ref resolves to a `normalizedEvents` eventId (reuse the eventIds Set freeze builds), throwing loud on a dangling beat ref — mirroring `freezeAnnotations`' guard.

**[LOW] F4 — Non-default `--interpreter-version`/`--prompt-version` WITHOUT `--real` desyncs `annotationHash` from the embedded annotations' stamped version** — RESOLVED (fix round 1): the mocked path now uses the `fixture-v1` constants directly (flags are real-only); committed bundle byte-identical; see Review Follow-ups (AI).
- Location: `scripts/build-bundle.ts:163-164`
- Layers: EDGE_BOUNDARY_HUNTER
- Recommendation: **fix**
- Why: On the mocked path `interpreterVersion = interpreterVersionFlag ?? 'fixture-v1'` is folded into `annotationHash`, but `fixtureAnnotations()` always stamps each annotation `interpreterVersion: 'fixture-v1'` internally. Passing `--interpreter-version foo` without `--real` computes the hash over `'foo'` while the embedded annotations still carry `'fixture-v1'` — the run-identity key no longer matches the annotations' own provenance. Reachable only via a non-default flag combo (the committed `bundle:story-10-1` script omits these flags, so the shipped artifact is correct), hence low; but it is a real consistency footgun cheap to close.
- Suggested fix: On the mocked path, ignore `--interpreter-version`/`--prompt-version` (they only apply to `--real`) or assert they equal the fixture stamp — keep `'fixture-v1'` as the single source so `annotationHash` and `annotation.interpreterVersion` never diverge.

**[LOW] F5 — `bundleHash` folds the approval marker (`approvedAt`/`approvedBy`) → not reproducible across re-approvals** — REFUTED (fix round 1, confirmed): by-design provenance-over-reproducibility (Decision §3); AC2 holds (approval is an input; byte-identical two-build diff). No code change; see Review Follow-ups (AI).
- Location: `src/bundle/assemble-bundle.ts:85-90`
- Layers: BLIND_HUNTER
- Recommendation: **likely-refute** (false positive — by design; doc-only)
- Why: `scrub.approval` (incl. operator `approvedAt`) is folded into the bundle and thus `bundleHash`. AC2 ("same inputs → same hash") holds because approval IS an input (verified byte-identical for the committed static dev-approval.json). Re-signing the same scrubbed session with a fresh `approvedAt` changing the hash is correct provenance-over-reproducibility behavior — the content address binds content + approval intentionally (Decision §3). No code change warranted; flagged only so the binding is documented.
- Suggested fix: No code change. If pure content-addressing is ever wanted, hash the bundle minus `scrub.approval` and store the approval address separately — out of scope here.

**[LOW] F6 — `scrub` field is `.optional()` in addition to `.nullable()` — schema alone permits a publishable bundle to omit provenance** — REFUTED (fix round 1, confirmed): intentional 1.2 backward-compat (Decision §1); assembler ALWAYS populates `scrub`, committed-bundle guard asserts non-null self-binding scrub — leniency affects only legacy parse. No code change; see Review Follow-ups (AI).
- Location: `src/schema/replay-bundle.ts:51`
- Layers: ACCEPTANCE_AUDITOR
- Recommendation: **likely-refute** (false positive — intentional backward-compat, fully guarded)
- Why: `scrub: ScrubProvenanceSchema.nullable().optional()` lets a bundle parse with the key absent. This is intentional backward-compat for prior 1.2 fixtures (Decision §1); the assembler ALWAYS populates `scrub` (assemble-bundle.ts:85-90), and `committed-bundle.test.ts:43-55` asserts the shipped artifact carries a non-null self-binding scrub. So the schema leniency only affects legacy parse, never an assembler-emitted bundle — a defense-in-depth gap, not a real escape, and already tested. No change required.

### Notes

- F2 + F4 are the highest-value cheap fixes (one-line guard + a test each); F3 is a small defense-in-depth assertion. F1 is the only med — an error-surfacing improvement, non-blocking since the artifact is committed.
- F5 and F6 are confirmed false positives (intentional design, tested) — skip.
- Verified directly against `git diff HEAD` and a live read of the committed `public/bundles/story-10-1.json` (scrub block self-binds; annotation interpreterVersions both `fixture-v1`).
