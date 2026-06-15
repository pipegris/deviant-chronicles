# Story 5.5: Payload-free ReplayBundle + abstracted grounding

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the builder shipping a PUBLIC ReplayBundle,
I want the bundle to carry only a minimal, payload-free, NAME-free projection of each event (an opaque id + eventType + toolName + outcome + a mechanically-derived coarse role) instead of the full normalized events,
so that the showcase teaches the agentic-dev STRUCTURE (tools + higher-level logic) WITHOUT ever exposing a verbatim transcript, file contents, prompt/command body, tool-output, or any real file path / file name / symbol name. (NFR-3, the privacy guardrail)

## Acceptance Criteria

_Author's note: this story is a build-surfaced privacy/teaching refinement decided with the operator; it is NOT in `epics.md`. The Given/When/Then ACs below are the authoritative source for this story (authored verbatim per the operator). They extend the Epic-5 privacy posture (`epics.md#Story-5.1`/`#Story-5.2`; `architecture.md#Privacy & Security` L176-179) — the bundle is PUBLIC, so its exposure surface must be minimized to a coarse, name-free projection._

**AC1 — payload-free, name-free projection in the assembled bundle.**
**Given** the ReplayBundle assembly,
**When** the bundle is built,
**Then** it contains battleTimeline + frozen annotations + saga + assetManifest + schemaVersion + hashes, and the per-event data is a MINIMAL PAYLOAD-FREE projection keeping only `{opaque id (orderKey), eventType, toolName, outcome(success/isError), abstracted role}`; AND no raw payload (file contents/prompts/command bodies/tool-output), no raw file path, no file name, and no symbol name appears anywhere in the bundle.

**AC2 — byte-level absence proof.**
**Given** a built bundle,
**When** its full byte content is inspected,
**Then** a test asserts (a) no per-event payload/content field is present and per-event size is bounded small, and (b) the serialized bundle contains NONE of the fixture's known raw content strings AND none of its raw file paths/names (grep-absent).

**AC3 — the abstracted role classifier is a pure, name-discarding bake-time function.**
**Given** the abstracted role classifier,
**When** it maps a path,
**Then** it is a PURE deterministic function emitting only a coarse role token (`test`/`schema`/`migration`/`config`/`doc`/`source`) and NEVER echoes the path/name; classification happens at bake time and only the token ships.

**AC4 — the transparency portal grounds beats to the abstracted projection.**
**Given** the transparency portal during playback,
**When** a beat is inspected,
**Then** it shows the abstracted grounding (tool + role + outcome + teaching concept) resolved from the beat's groundingPointer, accurate to the real Event at the abstracted level, with NO raw transcript and NO file/symbol name shown; the verbatim deep-dive is a deferred local-only mode (not built).

**AC5 — bake reads full local session, ships only abstracted projection.**
**Given** the offline bake,
**When** interpreter + Saga run,
**Then** they MAY read the full local session for quality but emit only annotations + prose + the abstracted projection into the bundle (full content + real names never ship); the secret/PII scrub still runs on the projection.

### Scope fence (READ FIRST — what this story IS and IS NOT)

- **IS:** a privacy/teaching REFINEMENT of the Story 5.2 bundle. It REPLACES the bundle's full `normalizedEvents` array (which today ships payloads up to ~28KB/event AND real file paths — verified, see Dev Notes §0) with a minimal `projectedEvents` array, adds a pure bake-time `classifyRole(path)` classifier, re-points the portal grounding to the abstracted projection, and regenerates the committed `public/bundles/story-10-1.json` + the guard tests. The bake (offline interpreter + Saga) is UNCHANGED in its right to read the full local session for quality — only what SHIPS changes.
- **IS NOT:** a new schema version (the change is additive/transforming WITHIN `schemaVersion: 1` — see Dev Notes §2 for the field-shape decision), a Layer-0 change (ingest/translate/pace/model are untouched; the golden snapshots stay byte-stable), the deferred "sight-beyond-sight" verbatim transcript deep-dive (AC4 explicitly DEFERS that — keep the seam clean, do NOT build it), final art (5.3), or deploy (5.4).
- **HARD OPERATOR CONSTRAINT (the load-bearing line):** the public bundle must **NEVER** ship a real file name, file path, or symbol name — only a mechanically-derived **COARSE ROLE** token. There is no "redact most of the path" middle ground here: the path is read at bake time, classified, and **discarded**. Only the token ships.

### Gate-verifiable vs operator-verified (this story is ~fully gate-verifiable)

- **GATE-VERIFIABLE (Vitest — this is what "done" means):** (AC1) the assembler/projector emits a bundle whose per-event data is exactly `{orderKey, eventType, toolName, outcome, role}` and Zod-validates; (AC2) a byte-absence test asserts no payload/content field on any projected event, a bounded per-event size, AND that the serialized bundle `.not.toContain`s the fixture's known raw content strings + raw paths/names (grep-absent); (AC3) `classifyRole` is pure/deterministic, table-driven, emits only the six role tokens, and a source-grep + a property test prove it never returns/echoes its input path; (AC4) the portal resolves a beat's groundingPointer to the abstracted `{tool, role, outcome, concept}` rows (no raw event, no name) — proven on the committed fixture for dispel + shaman; (AC5) the bake pipeline reads the full local session but the assembled bundle carries only the projection (the scrub still runs on the projection); plus R1/R4/R5 discipline, `grep -ril anthropic dist/` empty, BOTH golden snapshots byte-stable, determinism (rebuild byte-identical).
- **OPERATOR-VERIFIED (NOT a gate — watch `pnpm dev`):** the on-screen portal grounding READS clearly at the abstracted level (tool + role + outcome + concept) and the spectacle is unaffected. jsdom advances no Phaser tweens / lays out no real pixels.

## Tasks / Subtasks

- [x] **Task 1 — The pure, name-discarding role classifier (AC3).** (NEW `src/bundle/classify-role.ts` + co-located `*.test.ts`)
  - [x] Author `export type AbstractedRole = 'test' | 'schema' | 'migration' | 'config' | 'doc' | 'source';` (a string-literal union — NO numeric/native enum, the project convention) and `export function classifyRole(path: string | null): AbstractedRole` — a PURE deterministic function. It maps a path PATTERN to a coarse role and returns ONLY the token; it NEVER returns, echoes, logs, or embeds the path/name. `null` (no target — e.g. a `prompt`/`text`/`tool_result` event with no file) maps to the fallback role `'source'` (decide on merits; `'source'` is the documented catch-all — see Dev Notes §3).
  - [x] Classification rules (ordered; FIRST match wins — order is documented in Dev Notes §3): `*.test.*` / `*.spec.*` → `'test'`; a `schema/` segment OR `*.schema.*` → `'schema'`; a `migrations/` segment OR `*.migration.*` → `'migration'`; `*.json` / a `config/` segment / known config basenames (e.g. `*.config.*`, `tsconfig*`, `eslint*`, `*.yaml`/`*.yml`/`*.toml`) → `'config'`; `*.md`/`*.mdx`/`*.txt` → `'doc'`; everything else → `'source'`. Drive these from a SMALL committed config table `src/config/role-classification.json` loaded via a `.strict()` Zod loader IF it earns its keep (config-as-data, NFR-4 — mirror `scrub-patterns.ts`); OTHERWISE keep the rule table inline as a documented `const` (decide on the simplicity-vs-config-as-data merits in Dev Notes §3 and record the choice). NO semantic/LLM mapping, NO real names anywhere.
  - [x] CRITICAL — the classifier is matched against a normalized basename/segment view, but it MUST NOT leak any portion of the path into its output or into any error: it returns the role token and nothing else. Operate on the path only as a local string; discard it.
  - [x] `src/bundle/classify-role.test.ts` (AC3): table-driven cases for each role (incl. precedence — e.g. `src/schema/foo.test.ts` → `'test'` because test wins over schema per the documented order; `migrations/001_init.sql` → `'migration'`; `package.json` → `'config'`; `README.md` → `'doc'`; `src/render/arena.ts` → `'source'`; `null` → `'source'`); determinism (call-twice `toBe`); a PROPERTY-style assertion that for a set of paths containing distinctive name substrings, the returned token is one of the six literals AND does NOT contain any substring of the input path (the no-echo proof); and (if a config table is used) the `.strict()` loader fails closed on a malformed table.

- [x] **Task 2 — The projected-event schema + the pure projector (AC1, AC5).** (`src/schema/replay-bundle.ts` + `.test.ts`; NEW `src/bundle/project-events.ts` + `.test.ts`)
  - [x] Add `ProjectedEventSchema` to `src/schema/replay-bundle.ts` (the leaf schema everyone consumes): a `.strict()` `z.object({ orderKey: OrderKeySchema, eventType: z.string(), toolName: z.string().nullable(), outcome: OutcomeSchema, role: AbstractedRoleSchema })` where `OutcomeSchema = z.enum(['success','isError'])` (a string-literal union; the AC's `outcome(success/isError)`) and `AbstractedRoleSchema = z.enum(['test','schema','migration','config','doc','source'])`. The `eventId` IS the opaque id — keep it as the projection's identity key (Decision §1: `eventId` is an opaque `orderKey`-derived string like `u-0002#1`, NOT a name/path; the freeze guard, the timeline `sourceEventIds`, the annotation `eventRef`/`groundingPointer.eventRefs`, AND the portal grounding ALL key on it, so it MUST stay). RESOLVE on documented merits whether the projection keeps a separate `eventId: z.string()` field in addition to `orderKey`, or derives the opaque id from `orderKey` — the AC says "opaque id (orderKey)", and the existing refs are `eventId` strings; record the decision in Dev Notes §1. Define `AbstractedRoleSchema` HERE (or import the union type from `classify-role.ts` and mirror it as a Zod enum — keep ONE source of truth; document which).
  - [x] Decide + record (Dev Notes §2) the bundle field shape: REPLACE `normalizedEvents: z.array(NormalizedEventSchema)` with `projectedEvents: z.array(ProjectedEventSchema)`. The bundle is the PUBLIC artifact and `normalizedEvents` was the leak vector — rename it so no consumer accidentally expects payloads, and so the byte-absence test (AC2) is structurally enforced by the schema (a `ProjectedEvent` has no `payload`/`subtype`/`content` field; `.strict()` REJECTS any extra field). Keep `schemaVersion: z.literal(1)` (this is a v0.1 pre-ship refinement; no external consumer of the old shape exists — the only consumers are in-repo and are updated in this story; document that a rename within v0.1 is acceptable vs a version bump, Dev Notes §2).
  - [x] Author `src/bundle/project-events.ts` — `export function projectEvents(events: NormalizedEvent[]): ProjectedEvent[]`, PURE/deterministic. For each scrubbed `NormalizedEvent` it emits ONLY `{ eventId/orderKey (the opaque identity per §1), eventType, toolName, outcome: event.isError ? 'isError' : 'success', role: classifyRole(resolveTargetPath(event)) }`. `resolveTargetPath(event)` reads `payload.input.file_path ?? payload.input.path ?? null` — the SAME precedence `translate.ts` `resolveTarget` uses (reuse the documented precedence; do NOT author a second target resolver if `translate`'s can be shared cleanly — but note `translate.resolveTarget` is currently file-local/not exported; Decision §3 resolves whether to export-and-reuse vs re-derive minimally). It reads the path ONLY to classify, then DISCARDS it. It carries NO payload/content forward. NOTE the outcome nuance (Dev Notes §4): a `tool_use` carries the path but its success/failure lives on the paired `tool_result`; v0.1 `outcome` is the per-event `isError` (a `tool_use` is `isError:false` itself) — this is honest at the abstracted level (each event's own outcome) and is NOT a claim about the tool's downstream result. Record this so a reviewer does not "fix" it to cross-event correlation.
  - [x] Tests (`src/bundle/project-events.test.ts`): over the committed fixture events, every projected event has EXACTLY the five keys (assert `Object.keys` set equality — no `payload`/`subtype`/`content`/`timestamp`/etc.); `outcome` matches `isError`; `role` matches `classifyRole` on the event's resolved target (and `'source'` for the path-less prompt/text/result events); determinism (call-twice `toEqual`); does NOT mutate inputs; and the load-bearing NO-LEAK assertion — serialize `projectEvents(fixture)` and assert it `.not.toContain`s each known raw path/name/content substring from the fixture (the same posture as Story 5.1's no-leak test).

- [x] **Task 3 — Wire the projector into the assembler; ship the projection, not the events (AC1, AC5).** (`src/bundle/assemble-bundle.ts` + tests)
  - [x] In `assembleBundle`: the gate runs FIRST (unchanged — fail-closed on `!ok`). `freezeAnnotations` STILL runs over the SCRUBBED FULL `normalizedEvents` (Decision §5: provenance is over the INPUT — `annotationHash = sha256(normalizedEvents + interpreterVersion + promptVersion)` is UNCHANGED, correct, and stays computed over the full scrubbed events; the bundle carries the HASH, not the events). AFTER freeze + the gate, compute `projectedEvents = projectEvents(scrubResult.scrubbedEvents)` and place THAT in the bundle (NOT `normalizedEvents`). The full scrubbed events are used for hashing/freeze/the dangling-ref guards and then DROPPED — they never reach the returned bundle.
  - [x] The F3 dangling-beat-ref guard (review follow-up in 5.2): it currently builds `eventIds` from `normalizedEvents`. Re-point it to build `eventIds` from `projectedEvents` (the SHIPPED identities) so it still proves every `battleTimeline` beat `sourceEventId` resolves to a SHIPPED projected event. Likewise `freezeAnnotations`'s dangling-grounding-ref guard runs over the full scrubbed events (which carry the SAME eventIds as the projection — §1), so it is unaffected; ADD an assertion (or confirm by construction) that the projection preserves exactly the eventIds the annotations/timeline reference (no id dropped/renamed in projection), so the portal grounding (Task 4) cannot dangle. Resolve on merits whether to assert "projected eventIds ⊇ all referenced refs" explicitly in the assembler (defense-in-depth, mirroring F3) — record in Dev Notes §5.
  - [x] `bundleHash` is UNCHANGED in formula (`sha256(canonicalJSON(bundle))`) but now hashes the projection-bearing bundle — still deterministic. Update the assembler header comment to state the bundle ships `projectedEvents` (payload-free), and that the full scrubbed events are an INTERNAL hashing/freeze input never shipped.
  - [x] Tests (`src/bundle/assemble-bundle.test.ts` + `assemble-bundle.unit.test.ts`): update the existing assertions that read `bundle.normalizedEvents` to `bundle.projectedEvents`; assert the assembled bundle has NO `normalizedEvents` key and that every `projectedEvents` entry is payload-free (the five-key set); the existing planted-secret test becomes a planted-secret + planted-PATH test — assert the planted file content AND the planted path/name are BOTH absent from the serialized assembled bundle (grep-absent, AC2); keep the gate-BLOCK / gate-PASS / determinism / dangling-beat-ref cases (re-pointed to `projectedEvents`).

- [x] **Task 4 — Re-point the transparency portal grounding to the abstracted projection (AC4).** (`src/portal/portal.ts` + `.test.ts`; `src/render/arena-boot.ts`; `src/render/legend-overlay.ts` + tests; `src/interpret/overlay.ts` if the view shape changes)
  - [x] The browser now loads a bundle whose events are `ProjectedEvent[]`, NOT `NormalizedEvent[]`. The `AnnotatedView` / `applyOverlay` (currently typed over `NormalizedEvent`) + the portal `resolveGrounding` (returns `readonly NormalizedEvent[]`) + `getActiveGrounding` (in `arena-boot.ts`, already reduces to `eventIds`) MUST be re-typed/re-shaped to consume the projection. Decide on documented merits (Dev Notes §6) the cleanest seam:
    - **Preferred:** introduce an `AbstractedGrounding` row type `{ tool: string | null, role: AbstractedRole, outcome: Outcome, concept: string }` and a portal resolver `resolveAbstractedGrounding(annotation, view): readonly AbstractedGrounding[]` that maps `groundingPointer.eventRefs` → the projected events (by `eventId`) → the `{tool, role, outcome, concept}` rows. `tool` = `projectedEvent.toolName`; `role`/`outcome` = the projected fields; `concept` = the teaching concept for the annotation's `beatType` (REUSE the Story 4.3 `teaching.json` plain-dev one-liner OR the Story 4.4 `legend.json` `real` string for that beat — pick the one that reads as the "teaching concept" and cite it; do NOT invent new copy). FAIL LOUD on a dangling ref (the existing policy — a frozen-overlay invariant violation; §6).
    - Re-type `AnnotatedView` to carry `events: readonly ProjectedEvent[]` (the overlay pairs the projection with annotations side-by-side; R1 is UNCHANGED — the overlay still writes no mechanics, and the projection has even LESS surface). Update `applyOverlay`, the overlay tests, and every `view.events`-by-`eventId` lookup.
  - [x] `arena-boot.ts` `getActiveGrounding`: change `eventIds: resolveGrounding(...).map(e => e.eventId)` to resolve the ABSTRACTED rows (`resolveAbstractedGrounding`) and hand the overlay the abstracted grounding (tool + role + outcome + concept) instead of bare eventIds. The `beatIndexOfAnchor` / latest-reached-beat selection logic is UNCHANGED (it keys on `eventRef` + the baked timeline `sourceEventIds`, both still present).
  - [x] `legend-overlay.ts`: change `LegendGrounding` from `{ beatKey, eventIds: readonly string[] }` to display the abstracted rows (`{ beatKey, rows: readonly AbstractedGrounding[] }` or similar) and render them as the human-readable "tool + role + outcome + concept" lines — NO raw eventId list shown to the viewer is acceptable (eventIds are opaque, but the AC asks for the abstracted grounding, so surface tool/role/outcome/concept; you MAY keep the opaque eventId as a debug attribute but the VISIBLE text is the abstracted grounding). NO file/symbol name can appear (there are none in the projection — structurally guaranteed). Keep the non-interruption contract (open/close mutates only visibility — UNCHANGED).
  - [x] Update `src/portal/portal.test.ts` + the overlay/boot tests: `resolveAbstractedGrounding` over the committed fixture resolves dispel → its rows (e.g. `tool: 'Read'`/null, `role`, `outcome: 'success'`, the dispel teaching concept) and shaman → its rows, IN ORDER, accurate to the projected events; a fabricated dangling ref THROWS; determinism + no input mutation; the resolved rows contain NO file/symbol name and NO raw content (assert the row fields are exactly tool/role/outcome/concept). Keep the AC1-non-interruption gate in `arena-boot-legend.test.ts` (deep-equal PlaybackState + BattleState across open→close) — UNCHANGED.
  - [x] Extend `src/portal/r1-discipline.test.ts` if a new portal module/symbol is added (keep the SDK-free + phaser-free + no-mechanics greps covering the new resolver).

- [x] **Task 5 — Regenerate the committed bundle + update the committed-bundle guard (AC1, AC2).** (`scripts/build-bundle.ts` if any glue changes; `public/bundles/story-10-1.json`; `src/bundle/committed-bundle.test.ts`)
  - [x] `scripts/build-bundle.ts` is mostly UNCHANGED (it already ingests → scrubs → paces → interprets → sagas → `assembleBundle` → writes). Confirm the script still hands `assembleBundle` the full scrubbed events (the assembler now projects internally) — no script logic should need to change beyond what `assembleBundle`'s signature dictates (the signature still takes `scrubResult`; the projection happens inside). If the assembler signature is unchanged, the script is unchanged.
  - [x] Re-run `pnpm bundle:story-10-1` (mocked-LLM dev path: FixtureInterpreter annotations + placeholder Saga + scrubbed fixture events + the committed `dev-approval.json`) to regenerate `public/bundles/story-10-1.json` with the NEW payload-free shape (`projectedEvents`, no `normalizedEvents`). Stage it for the operator (do NOT git commit). Verify two runs are byte-identical (determinism).
  - [x] Rewrite `src/bundle/committed-bundle.test.ts` to the new shape: it parses against the (updated) `ReplayBundleSchema`; asserts `projectedEvents.length > 0` and every entry is payload-free (five-key set, no `payload`/`content`); asserts the byte-level absence (AC2) — read the committed JSON as text and assert it `.not.toContain`s the fixture's known raw content strings (e.g. `"Kickoff: implement the ingest pipeline"`, the `export const NormalizedEventSchema` body) AND the raw paths/names (e.g. `/work/project/src/schema/normalized-event.ts`, `normalized-event.ts`, `parse-transcript.ts`); asserts a bounded per-event size (e.g. each projected event serializes under a small byte cap — pick a defensible bound like ≤ 400 bytes/event and document it, AC2); keeps the scrub-provenance self-binding assertion + the `annotationHash`/`bundleHash` shape checks (UNCHANGED — provenance is over the input, §5).

- [x] **Task 6 — Gates green; R4 isolation; determinism (all ACs).**
  - [x] `pnpm typecheck` clean (strict). `pnpm lint` clean — R1/R4/R5 hold, `eslint.config.ts` UNTOUCHED. NEVER relax a boundary to pass.
  - [x] `pnpm test` green — full suite (baseline 93 files / 937 tests at the 5-2 HEAD; this story ADDS `classify-role`/`project-events` suites + re-points the bundle/portal/overlay/boot suites). BOTH golden snapshots (`src/pace/__snapshots__/` + the ingest snapshot) byte-stable — this story adds NO Layer-0 code (the classifier/projector live in `src/bundle/`, the portal in `src/portal/`).
  - [x] `pnpm build` succeeds → `dist/`. `grep -ril anthropic dist/` returns NOTHING (R4 — the classifier/projector are SDK-free; the assembler stays SDK-free; the portal/overlay are SDK-free). Confirm the OLD raw payload/path strings are absent from `dist/bundles/story-10-1.json` too (the static asset is the regenerated payload-free bundle).
  - [x] Determinism: two `pnpm bundle:story-10-1` runs yield byte-identical `public/bundles/story-10-1.json`.
  - [x] Do NOT `git commit` (the operator commits between stories) — the regenerated `public/bundles/story-10-1.json` is staged in the change set for the operator.

### Review Follow-ups (AI)

Fix round 1 — addressing the Senior Developer Review findings. All gates re-run green after the fixes (typecheck/lint/test/build; committed bundle byte-identical).

- [x] **[F1][Low][fix] Config-basename rule over-match** (`src/bundle/classify-role.ts` + `classify-role.test.ts`). The dotted-config-basename rule used `(tsconfig|eslint|vite|package)[^/]*$`, so any SOURCE basename merely STARTING with a prefix (`PackageList.tsx`, `vite-plugin-custom.ts`, `eslint-runner.ts`, `packageResolver.ts`) mislabeled `config` instead of `source` — a name-free but WRONG coarse role rendered to the viewer (AC4 accuracy; not a leak). FIXED at root cause: split into `(^|/)(tsconfig|eslint|vite|jest)\.[^/]+$` (a DOT is now required after the prefix) + `(^|/)package\.json$` (exact basename match). Verified: all 4 over-match paths now return `source`; every legitimate config case still returns `config` (covered by the `.json`/`.config.*` rules either way). Added the `F1/ANCHORING` regression test pinning the over-match paths → `source` and a dotted config → `config`.
- [x] **[F2][Low][consider] Envelope not `.strict()`** (`src/schema/replay-bundle.ts` + `replay-bundle.test.ts`). The per-event `ProjectedEventSchema` was `.strict()` but the bundle envelope `ReplayBundleSchema` was not, so a regression re-introducing a top-level `normalizedEvents` (the old leak vector) would be SILENTLY STRIPPED by Zod rather than rejected. APPLIED `.strict()` to the envelope (defense-in-depth for NFR-3, mirroring the per-event rationale, Dev Notes §2). Verified the sole composition point (`assembleBundle`) and the committed bundle carry exactly the 9 declared keys, so `.strict()` is safe. Added two reject tests: a stray top-level `normalizedEvents` and any unknown top-level key both throw `ZodError`.
- [x] **[F3][Low][likely-refute] Projection ships `eventId` (6 keys)** — REFUTED, no code change. Confirmed `eventId` is the documented Decision §1 ref-stable opaque id (verified values `u-0001`, `u-0002#1` — opaque ordinals, no path/name/content) that the timeline `sourceEventIds`, annotation `eventRef`/`groundingPointer.eventRefs`, the freeze guard, and the portal lookup ALL key on. Dropping it would break freeze/F3/overlay/grounding. The 6-key set matches the existing `EXPECTED_KEYS` in the projection tests. Sound decision, not a defect.

## Dev Notes

This is a build-surfaced privacy/teaching refinement of the Story 5.2 bundle, decided with the operator. Every consequential decision below is RESOLVED on documented merits (this is autonomous — decide and proceed). Cited paths are to files read during analysis. **The operator's hard line: NO real file/symbol name in the public bundle — coarse role only.**

### §0 — Current state of the leak (verified, the WHY)

The committed `public/bundles/story-10-1.json` (Story 5.2's output) ships `normalizedEvents` as the FULL scrubbed events — verified directly:
- 14 events, each with a **non-null `payload`**; bundle is ~16.5KB for the THIN dev fixture (the real-bake bundle would be far larger — the prior art notes payloads up to ~28KB/event).
- Payloads carry **raw content** (`{"text": "Kickoff: implement the ingest pipeline for Story 10.1."}`, `{"content": "export const NormalizedEventSchema = ..."}`) AND **raw file paths/names** (`{"input": {"file_path": "/work/project/src/schema/normalized-event.ts"}}` — 4 events carry a `file_path`). Tool names present: `Bash`, `Edit`, `Read`, `Write`.
- This is exactly what AC1/AC2 must REMOVE. The scrub (Story 5.1) only redacts *secrets/PII* from string leaves — it deliberately does NOT remove `/work/project/...` paths or file contents (those are not secrets). This story removes the *entire* payload + path/name surface, keeping only the coarse projection. The scrub still runs (AC5) as defense-in-depth on the (now tiny) projection.

### §0b — Why the projection is mechanically inert at replay (the load-bearing safety proof)

The bundle BAKES the `battleTimeline` (Story 1.2/5.2 decision — `replay-bundle.ts` L33-36). At REPLAY, the browser folds the baked timeline via the deterministic reducer (`model/playback.ts`); it does **NOT** re-run `translate`/`pace`. I grepped every browser-reachable dir (`src/render`, `src/portal`, `src/scribe`, `src/model`, `src/game`) for `.payload`/`.toolName` reads — **ZERO hits outside Layer-0 `translate.ts`** (which runs at BAKE time only). So at replay, `bundle.normalizedEvents` is consumed by exactly two things:
1. `applyOverlay(events, annotations)` → the `AnnotatedView` (`interpret/overlay.ts`) — pairs events with annotations side-by-side, keyed by `eventId`/`eventRef`. Uses NO payload.
2. The portal grounding (`portal.resolveGrounding` + `arena-boot.getActiveGrounding`) — and `getActiveGrounding` ALREADY reduces to `.map(e => e.eventId)` (`arena-boot.ts` L431/435). Uses NO payload.

Therefore replacing the full events with a payload-free projection that **keeps `eventId`/`orderKey`** is mechanically inert at replay: the timeline (HP/pacing) is untouched, the overlay still pairs by id, and the portal grounding gets RICHER (tool/role/outcome/concept) instead of bare ids. This is why the change is safe and surgical.

### §1 — The opaque id: keep `eventId`; `orderKey` is the opaque id (RESOLVED)

The AC says the projection keeps "opaque id (orderKey)". The existing cross-references — `battleTimeline.beats[].sourceEventIds`, `BeatAnnotation.eventRef`, `groundingPointer.eventRefs` — are all `eventId` STRINGS (verified: `u-0002#1`, `u-0005#0`, etc.). `eventId` is itself opaque + `orderKey`-derived (it is `${streamId}-...#${seq}`-shaped, carries no name/path/content). **Decision:** the projection keeps BOTH `orderKey` (the structured total-ordering key the AC names) AND `eventId` (the opaque string identity every ref + the freeze guard + the portal lookup uses). Dropping `eventId` would break `freezeAnnotations`' dangling-ref check, the F3 timeline-beat guard, `applyOverlay`'s pairing, and `resolveGrounding`'s lookup — all of which resolve `ref → event by eventId`. `eventId` is NOT a privacy leak (it is `u-0002#1`, an opaque ordinal), so keeping it satisfies "opaque id" honestly. If a reviewer insists on ONLY `orderKey`, note that `eventId` is reconstructible from `orderKey` but every existing ref is the string form — keeping `eventId` is the minimal, ref-stable choice. Record: projection identity = `{ orderKey, eventId }` (both opaque), plus `eventType`, `toolName`, `outcome`, `role`.

### §2 — Field shape: REPLACE `normalizedEvents` with `projectedEvents`, stay `schemaVersion: 1` (RESOLVED)

**Decision:** rename the bundle field `normalizedEvents → projectedEvents: z.array(ProjectedEventSchema)`, and make `ProjectedEventSchema` a `.strict()` object so the schema STRUCTURALLY rejects any payload/content/extra field (AC2's "no per-event payload field" becomes a parse-time guarantee, not just a test). Rationale:
- The bundle is the PUBLIC artifact; `normalizedEvents` was THE leak vector. Renaming makes every consumer's expectation explicit (no consumer can accidentally read a payload that no longer exists) and makes the absence test structural.
- Stay `schemaVersion: z.literal(1)`: this is a v0.1 PRE-SHIP refinement (nothing public has shipped yet — Story 5.4 deploy is still `backlog`). The ONLY consumers of the bundle shape are in-repo (`assemble-bundle.ts`, `arena-boot.ts`, `committed-bundle.test.ts`, `overlay.ts`) and they are ALL updated in this story. A version bump buys nothing (there is no old reader to keep compatible) and would force `z.literal(2)` churn. The architecture's "schemaVersion is a z.literal so a bumped artifact fails closed" (`battle-timeline.ts` L20-21) is about FUTURE breaking changes for SHIPPED readers — not relevant pre-ship. Document this reasoning in the schema comment. (Contrast: Story 5.2 ADDED a nullable `scrub` field and kept v1 because it was additive+backward-compatible; here we REPLACE a field, but the same "no external reader exists yet" logic applies even more strongly.)
- `AbstractedRoleSchema = z.enum([...])` and `OutcomeSchema = z.enum(['success','isError'])` — string-literal unions (the project's no-numeric-enum convention). Keep ONE source of truth for the role union: define the TS union in `classify-role.ts` and the Zod enum in `replay-bundle.ts`, and reference them so a drift is caught (e.g. a `satisfies` check or a shared const array — decide minimally; the unit test for the classifier + the schema enum both enumerate the six, so a drift fails a test either way).

### §3 — The classifier: pure, ordered, name-discarding; config-as-data vs inline (RESOLVED)

The classifier is AC3's core. **Decision on the rule home:** prefer a SMALL committed `src/config/role-classification.json` + a `.strict()` Zod loader (`src/bundle/classify-role.ts` parses it at module load, fail-closed) — this matches the project's universal config-as-data posture (NFR-4; `scrub-patterns.ts`/`teaching-config.ts`/`model-tuning.ts` precedent) and lets the role mapping evolve without code. BUT the rule set is tiny and the precedence is load-bearing logic (not pure data), so if a JSON table makes the FIRST-MATCH precedence awkward or over-engineered, keep the table as a documented inline `const` array of `{ test: RegExp|matcher, role }` in `classify-role.ts` and note the deviation. **Either way the classifier is a PURE function returning ONLY a token.** Record the chosen home in Completion Notes.

**Ordered rules (FIRST match wins — order is the spec):** the order matters because a path can match multiple patterns (`src/schema/foo.test.ts` is both `schema/` and `*.test.*`). The documented precedence:
1. `test` — `*.test.*` / `*.spec.*` / a `__tests__/` segment. (Test wins: a test FILE in a schema dir is teaching-wise a "test".)
2. `schema` — `*.schema.*` OR a `schema/` path segment.
3. `migration` — `*.migration.*` OR a `migrations/` path segment.
4. `config` — `*.json` / `*.config.*` / `*.yaml` / `*.yml` / `*.toml` / known config basenames (`tsconfig*`, `eslint*`, `vite*`, `package.json`) / a `config/` segment.
5. `doc` — `*.md` / `*.mdx` / `*.txt`.
6. `source` — the fallback (everything else, INCLUDING `null`/no-target).

**The no-echo invariant (the operator's hard line):** `classifyRole` reads the path as a local string ONLY to test patterns; it returns one of the six literals and NOTHING derived from the path text. AC3's gate is a property test: for paths with distinctive substrings, the returned token contains NO substring of the input. A source-grep test (the `r4-isolation.test.ts` posture) can also assert the function body never templates the path into its return.

**Target resolution for the classifier input:** `resolveTargetPath(event) = payload.input.file_path ?? payload.input.path ?? null` — the SAME precedence `translate.ts resolveTarget` uses (L41-55). **Decision:** `translate.resolveTarget` is currently file-local (not exported) and lives in a Layer-0 module; do NOT import it into `src/bundle/` (that would create an `src/bundle/ → src/translate/` dependency — lint-check it; it is not an R1 violation since `bundle/` is not a Layer-0 dir, but it couples the projector to Layer-0 internals). Instead re-derive the SAME minimal precedence inline in `project-events.ts` (it is two lines: `file_path ?? path ?? null`, trimmed-to-null-on-empty), documented as mirroring `translate.resolveTarget`. The projector reads this path ONLY to feed `classifyRole`, then discards it. (If the dev prefers a shared helper, exporting `resolveTarget` from `translate.ts` and importing it is acceptable IF lint stays clean — but the minimal re-derivation is the lower-coupling choice; record which was taken.)

### §4 — `outcome` is the per-event `isError` (honest at the abstracted level) (RESOLVED)

The AC's `outcome(success/isError)` maps directly to `NormalizedEvent.isError` (a non-nullable boolean, `normalized-event.ts` L41): `outcome = isError ? 'isError' : 'success'`. **Nuance to document (so a reviewer does not "fix" it):** a `tool_use` event carries the file path but its DOWNSTREAM success/failure lives on the PAIRED `tool_result` event (a separate event in the stream). v0.1 `outcome` is each event's OWN `isError` — a `tool_use` is `isError:false` (the call was issued), and its `tool_result` carries the real pass/fail `isError`. This is HONEST at the abstracted, per-event level (it reports each event's own outcome) and is intentionally NOT a cross-event correlation (correlating a tool_use to its result is the translate/pace engine's job at Layer 0, already baked into the timeline). The projection is a flat per-event summary, not a re-derivation of mechanics. Keeping `outcome = event.isError` per-event is the minimal, truthful choice.

### §5 — Provenance is over the INPUT, unchanged: bundle carries the HASH not the events (RESOLVED — the determinism/provenance invariant)

`annotationHash = sha256(canonicalJSON({ normalizedEvents, interpreterVersion, promptVersion }))` (`freeze.ts` L68-79) is computed at bake time over the FULL scrubbed `normalizedEvents` + the two versions. **Decision:** this is UNCHANGED. Provenance/content-addressing is correctly over the INPUT to interpretation (the events the interpreter saw), and the bundle carries the HASH, not the events. So:
- `freezeAnnotations` runs over `scrubResult.scrubbedEvents` (the full scrubbed events) — UNCHANGED. Its dangling-grounding-ref guard resolves `eventRef`/`groundingPointer.eventRefs` against those events' `eventId`s — and the projection preserves exactly those `eventId`s (§1), so the guard and the portal grounding stay consistent.
- The full scrubbed events are an INTERNAL bake input (hashing + freeze + the F3 guard); they are DROPPED after assembly and NEVER placed in the returned bundle. Only `projectedEvents` ship.
- `bundleHash = sha256(canonicalJSON(bundle))` (`assemble-bundle.ts` L124-126) now hashes the projection-bearing bundle — still deterministic (same fixture → same projection → same bundle → same hash). Two builds are byte-identical.
- **Defense-in-depth (mirror F3):** ADD an assertion in `assembleBundle` that every `eventId` referenced by an annotation (`eventRef` + `groundingPointer.eventRefs`) AND by the timeline (`beat.sourceEventIds`) is present in `projectedEvents` — so a projection that accidentally dropped a referenced id fails LOUD at the sole composition point (the portal grounding would otherwise dangle at replay). The F3 guard (timeline beats → shipped ids) is re-pointed from `normalizedEvents` to `projectedEvents`. Record this.

This keeps the architecture's determinism story literal: the shipped artifact's hashes reproduce; the provenance is auditable over the (local, full) input the interpreter saw; the PUBLIC artifact carries no input payload — only the hash that proves which run produced it.

### §6 — Portal grounding: abstracted rows, fail-loud, R1 unchanged (RESOLVED)

AC4: the portal grounds a beat to the ABSTRACTED projection (tool + role + outcome + teaching concept), NOT raw events, NOT file names. **Decision:**
- Re-type `AnnotatedView.events` from `readonly NormalizedEvent[]` to `readonly ProjectedEvent[]` (`interpret/overlay.ts`). The overlay still pairs the projection with annotations side-by-side, keyed by `eventId`. R1 is UNCHANGED (the overlay writes no mechanics; the projection has strictly LESS surface than before). Update `applyOverlay` + its tests + every `view.events.find(e => e.eventId === ref)` lookup (they still work — `eventId` is preserved).
- Add `resolveAbstractedGrounding(annotation, view): readonly AbstractedGrounding[]` to `portal.ts`, where `AbstractedGrounding = { tool: string | null, role: AbstractedRole, outcome: Outcome, concept: string }`. It maps `groundingPointer.eventRefs → projected events (by eventId) → rows`, in order. `concept` = the teaching concept for `annotation.beatType` — REUSE the existing config copy: the Story 4.3 `teaching.json` plain-dev one-liner for that beat is the natural "teaching concept" (it is the PLAIN-DEV lesson, exactly the register AC4 wants); cite `src/config/teaching.json` + `src/portal/teaching-config.ts`. (The Story 4.4 `legend.json` `real` string is an alternative; pick teaching.json as the primary "concept" and record the choice — do NOT invent new copy.) FAIL LOUD on a dangling ref (the existing `resolveGrounding` policy — a frozen-overlay invariant violation per Story 3.1/3.2; do NOT silent-skip).
- Keep `resolveGrounding` (the eventId resolver) if other callers need it, OR replace its return shape — decide minimally. The portal's PUBLIC grounding surface is now abstracted; if `resolveGrounding` returned `NormalizedEvent[]` it can no longer (the view has projections) — so it returns `ProjectedEvent[]` or is folded into `resolveAbstractedGrounding`. Resolve on merits to MINIMIZE churn; record it.
- `arena-boot.getActiveGrounding` + `legend-overlay` (`LegendGrounding`): surface the abstracted rows (tool + role + outcome + concept) as the VISIBLE grounding text instead of bare eventIds. Structurally there are NO names/paths to leak (the projection has none). Non-interruption is UNCHANGED.
- **The verbatim "sight-beyond-sight" deep-dive is DEFERRED (AC4) — a local-only learning mode reading the raw transcript. Do NOT build it. Keep the seam clean:** the portal grounds to the projection only; there is no code path from the public bundle to a raw transcript (there is no raw transcript in the bundle). A future local-only mode would read the git-ignored `.sources/` session directly (the same deferred-operator-data posture as Story 5.1/5.2) — out of scope here.

### §7 — Reuse, do NOT reinvent (anti-wheel-reinvention)

- The `canonicalJSON`/sha256 content-address is `interpret/freeze.ts` — REUSE (do NOT author a second serializer). `assemble-bundle.ts`/`scrub.ts`/`gate.ts` already reuse it.
- The target-path precedence (`file_path ?? path`) is `translate.ts resolveTarget` (L41-55) — MIRROR it (re-derive minimally per §3, do not couple `bundle/ → translate/`).
- The `.strict()` config-as-data loader is `scrub-patterns.ts`/`teaching-config.ts`/`model-tuning.ts` — copy its shape for `role-classification.json` IF used.
- The teaching concept copy is `teaching.json` (4.3) / `legend.json` (4.4) — REUSE for the portal `concept`; do NOT write new copy.
- The portal grounding resolver + the read-only overlay are `portal.ts resolveGrounding` + `interpret/overlay.ts` — EXTEND/re-type them; the L1→L0 link is already modeled (keyed by `eventId`).
- The no-leak test posture is Story 5.1's `scrub.test.ts` (serialize, assert `.not.toContain(plantedValue)`) — copy it for the path/name/content absence (AC2).
- The committed-bundle guard is `committed-bundle.test.ts` — rewrite to the new shape, keep the self-binding scrub + hash assertions.

### §8 — R-rules quick reference (the gates that MUST hold)

- **R1 (Layer discipline):** the classifier/projector live in `src/bundle/` (NOT a Layer-0 dir; lint enforces `ingest/translate/pace/model !→ interpret/`, which is irrelevant here). The projector READS scrubbed Layer-0 events at BAKE time and emits a flat projection; it writes NO mechanics, returns no `BattleState`/`Beat`. The portal re-typing keeps the overlay read-only (writes no mechanics). Layer-0 (`ingest/translate/pace/model`) is UNTOUCHED → both golden snapshots byte-stable.
- **R2 (determinism/purity):** `classifyRole` + `projectEvents` are PURE (no `Date.now`/`Math.random`/IO/global-mutable-state; same input → deep-equal output). The bundle rebuild is byte-identical.
- **R3 (anti-corruption):** ONLY `ingest/` parses raw JSONL; the projector consumes the validated+scrubbed `NormalizedEvent[]`, never re-parses. No second parser.
- **R4 (LLM isolation):** the classifier/projector/portal are SDK-free; `grep -ril anthropic dist/` empty. The bake's interpreter/Saga (which MAY read the full session, AC5) stay browser-unreachable + tree-shaken (UNCHANGED from 5.2). The classifier is pattern-based — NO LLM, NO semantic mapping (AC3).
- **R5 (RenderPort one-way):** phaser stays in `render/`+`game/`. The portal selection/resolution is in `portal/` (no phaser); the overlay DISPLAY is in `render/legend-overlay.ts` (no phaser — the controls.ts posture). One-way data flow unchanged.
- **Do NOT relax/disable any lint rule or edit `eslint.config.ts`** — fix the code.

### Project Structure Notes

- **NEW files** (additive): `src/bundle/classify-role.ts` (+`.test.ts`), `src/bundle/project-events.ts` (+`.test.ts`), and IF config-as-data is chosen `src/config/role-classification.json`.
- **EDIT files** (surgical): `src/schema/replay-bundle.ts` (+`.test.ts`) — add `ProjectedEventSchema`/`OutcomeSchema`/`AbstractedRoleSchema`, replace `normalizedEvents` with `projectedEvents`; `src/bundle/assemble-bundle.ts` (+ both test files) — project after freeze, ship the projection, re-point the F3 guard; `src/interpret/overlay.ts` (+ test) — re-type `AnnotatedView.events` to `ProjectedEvent[]`; `src/portal/portal.ts` (+`.test.ts`, `r1-discipline.test.ts`) — add `resolveAbstractedGrounding`; `src/render/arena-boot.ts` (+ `arena-boot-legend.test.ts` / other boot suites) — `getActiveGrounding` surfaces abstracted rows; `src/render/legend-overlay.ts` (+ test) — display abstracted grounding; `src/bundle/committed-bundle.test.ts` — rewrite to the new shape; `public/bundles/story-10-1.json` — regenerate (staged).
- `src/bundle/` is the EXISTING Story 5.2 dir (no eslint zone; the global anthropic/phaser bans + the R4 dist-grep guard it). No new eslint zone needed. The architecture's directory tree did not name `classify-role.ts`/`project-events.ts` — same `src/bundle/`/`src/scrub/` precedent (vitest runs `src/**/*.test.ts`, so testable logic lives in `src/`). No variance from intent.
- Conventions: kebab-case files; types PascalCase; Zod `export const XxxSchema` + `export type Xxx = z.infer<...>`; string-literal unions for `AbstractedRole`/`Outcome` (NO numeric enums); internal JSON camelCase; explicit `null` over `undefined`; config-as-data (no hardcoded tuning). Co-located `*.test.ts`. On-disk bundle form is `${JSON.stringify(bundle, null, 2)}\n`. NO git commit.

### Current-state of the files this story UPDATES (read before editing)

- **`src/schema/replay-bundle.ts`** (read in full): `ReplayBundleSchema` has `normalizedEvents: z.array(NormalizedEventSchema)` (L31), the baked `battleTimeline` (L33-36), `annotationHash` (L43-45), and the nullable `scrub` provenance (L46-51, Story 5.2). **Change:** replace `normalizedEvents` with `projectedEvents: z.array(ProjectedEventSchema)`; add `ProjectedEventSchema`/`OutcomeSchema`/`AbstractedRoleSchema`. **Preserve:** `schemaVersion: z.literal(1)`, the baked timeline, the hash field, the scrub block, the import of `ScrubApprovalSchema` from `../scrub/approval` (NOT gate.ts — the node:crypto-avoidance, 5.2 Debug Log).
- **`src/bundle/assemble-bundle.ts`** (read in full): runs the gate FIRST (throws on `!ok`), then `freezeAnnotations` over `scrubResult.scrubbedEvents` (L66-71), the F3 dangling-beat-ref guard building `eventIds` from `normalizedEvents` (L78-87), composes the bundle with `normalizedEvents` (L92-107), parses at the boundary (L111). `bundleHash` (L124-126). **Change:** after freeze+gate, compute `projectedEvents = projectEvents(scrubResult.scrubbedEvents)`; put `projectedEvents` (not `normalizedEvents`) in the composed bundle; re-point the F3 guard's `eventIds` to `projectedEvents`; add the §5 referenced-ids-present assertion. **Preserve:** the gate-first fail-closed, the freeze over the full scrubbed events, the assemble-then-parse boundary, `bundleHash`'s formula.
- **`src/interpret/overlay.ts`** (read in full): `AnnotatedView { events: readonly NormalizedEvent[]; annotations; byEventRef }` + `applyOverlay`. **Change:** re-type `events` to `readonly ProjectedEvent[]` (and `applyOverlay`'s param). **Preserve:** the side-by-side read-only shape (R1), the `byEventRef` index keyed on `eventRef`/`eventId`.
- **`src/portal/portal.ts`** (read in full): `resolveGrounding(annotation, view): readonly NormalizedEvent[]` (L81-96, maps refs → events by eventId, fail-loud on dangling) + `resolveActiveBeatGrounding` (L104-111). **Change:** add `resolveAbstractedGrounding` returning `{tool, role, outcome, concept}` rows; adapt `resolveGrounding`'s return to the projection (or fold it). **Preserve:** the fail-loud dangling policy, purity, no-mechanics-write, the eventRefs-order resolution.
- **`src/render/arena-boot.ts`** (read the grounding region L410-447): `getActiveGrounding` resolves the latest-reached signature beat and returns `{ beatKey, eventIds }` via `resolveGrounding(...).map(e => e.eventId)` (L431/435). **Change:** return the abstracted grounding rows. **Preserve:** `beatIndexOfAnchor` + the latest-reached selection (keys on `eventRef` + baked `sourceEventIds`), the bundle-driven `bootFromBundle`/`bootCore` wiring (the events now come from `bundle.projectedEvents`), the non-interruption.
- **`src/render/legend-overlay.ts`** (read in full): `LegendGrounding { beatKey, eventIds }` (L28-31), `refreshGrounding` renders `Active beat "..." grounds: <eventIds>` (L103-114). **Change:** display the abstracted grounding (tool/role/outcome/concept). **Preserve:** the non-interruption mechanism (open/close mutates only visibility), the AbortController teardown, no-phaser.
- **`src/bundle/committed-bundle.test.ts`** (read in full): asserts the committed bundle parses, has `normalizedEvents.length > 0`, the scrub self-binding, the hashes. **Change:** rewrite to `projectedEvents`, add the byte-absence (AC2) + bounded-size assertions. **Preserve:** the scrub self-binding + hash-shape checks.

### Testing standards summary

- Vitest, co-located `*.test.ts`; `// @vitest-environment jsdom` for DOM/boot tests (the `arena-boot-legend.test.ts`/`legend-overlay.test.ts` precedent), node default for pure tests (classifier/projector/assembler/portal core).
- Layer-0 determinism is guarded by the committed golden snapshots (`src/pace/__snapshots__/` + the ingest snapshot) — this story adds NO Layer-0 code, so both MUST stay byte-stable.
- Gate-verifiable proofs: classifier purity + the no-echo property (AC3); projection shape = exactly five keys + no-leak `.not.toContain` (AC1); the assembled/committed bundle byte-absence of payload/content + raw paths/names + bounded per-event size (AC2); the portal abstracted-grounding rows accurate on the committed fixture + fail-loud-on-dangling + no name/content in rows (AC4); the bake reads full events but ships only the projection + the scrub runs on it (AC5); R1/R4/R5 source-greps; `grep -ril anthropic dist/` empty; rebuild byte-identical.
- The committed fixture tags `dispel@u-0002#1` + `shaman@u-0010#0` (the FixtureInterpreter); `summon` is OMITTED by design (the 3.3/3.4 honest gap). So the abstracted-grounding gates run END-TO-END for dispel + shaman on the real fixture; summon symmetry is unit-only if desired.
- Operator-verified (NOT a gate): the on-screen abstracted grounding legibility + the spectacle (jsdom advances no Phaser tweens / lays out no real pixels).

### References

- [Source: build-surfaced refinement decided with the operator — the Given/When/Then ACs are authoritative for THIS story (NOT in epics.md); authored verbatim above.]
- [Source: _bmad-output/planning-artifacts/architecture.md#Privacy & Security L176-179] — the ReplayBundle is PUBLIC; a pre-publish redaction pass + a manual review gate; minimize the exposure surface (this story takes it to a coarse name-free projection).
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture L162-174] — the ReplayBundle composition + `annotationHash = sha256(normalizedEvents + interpreterVersion + promptVersion)` (provenance over the INPUT — §5); the bundle is the canonical source of truth.
- [Source: _bmad-output/planning-artifacts/architecture.md#Format Patterns L262-267] — sha256 over canonical JSON; ONE canonical serializer; explicit null over undefined.
- [Source: _bmad-output/planning-artifacts/architecture.md#R1–R5 L224-241] — the load-bearing import boundaries.
- [Source: _bmad-output/implementation-artifacts/5-2-replaybundle-build-orchestration.md] — the prior story this refines: the assembler (`assembleBundle`/`bundleHash`), the F3 dangling-beat-ref guard, the committed-bundle guard, the bundle-load boot path, the `--real` deferred bake.
- [Source: _bmad-output/implementation-artifacts/5-1-secret-pii-scrub-gate.md] — the scrub (still runs on the projection, AC5) + the no-leak `.not.toContain` test posture (AC2).
- [Source: _bmad-output/implementation-artifacts/4-4-transparency-portal.md] + [src/portal/portal.ts] — the portal grounding resolver + the read-only overlay this story re-points to the abstracted projection (AC4).
- [Source: src/schema/replay-bundle.ts] — the bundle schema (`normalizedEvents` L31 → `projectedEvents`; `schemaVersion: z.literal(1)` L30; the scrub block L46-51).
- [Source: src/schema/normalized-event.ts] — `NormalizedEvent` (the bake input): `orderKey`/`eventId`/`eventType`/`toolName`/`isError` (the projection's source fields, L34-49) + `payload` (the leak surface dropped, L48).
- [Source: src/bundle/assemble-bundle.ts L46-126] — the assembler (gate→freeze→F3 guard→compose→parse; `bundleHash`) the projection wires into.
- [Source: src/interpret/freeze.ts L68-135] — `annotationHash` (over the input, UNCHANGED), `freezeAnnotations` (dangling-grounding-ref guard, over the full scrubbed events), `canonicalJSON` (REUSE).
- [Source: src/interpret/overlay.ts] — `AnnotatedView`/`applyOverlay` (re-typed to the projection; R1 side-by-side read-only shape).
- [Source: src/portal/portal.ts L81-111] — `resolveGrounding` (fail-loud-on-dangling) + `resolveActiveBeatGrounding` (the abstracted-grounding base).
- [Source: src/render/arena-boot.ts L410-447] — `getActiveGrounding` (already `.map(e => e.eventId)`; now surfaces abstracted rows) + the bundle-driven boot.
- [Source: src/render/legend-overlay.ts L25-114] — `LegendGrounding` + `refreshGrounding` (display the abstracted rows).
- [Source: src/translate/translate.ts L41-55] — `resolveTarget` (`file_path ?? path`, trimmed-to-null) — the target precedence the classifier input MIRRORS (re-derive minimally, §3; do NOT couple bundle/→translate/).
- [Source: src/config/teaching.json + src/portal/teaching-config.ts] — the plain-dev teaching concept per beat (REUSE for the portal `concept`, §6); [src/config/legend.json] — the alternative fantasy↔real copy.
- [Source: src/config/scrub-patterns.ts | src/portal/teaching-config.ts] — the `.strict()` config-as-data loader pattern for `role-classification.json` IF used.
- [Source: src/bundle/committed-bundle.test.ts] — the committed-artifact guard (rewrite to the projection shape + byte-absence).
- [Source: vitest.config.ts L14] — `include: ['src/**/*.test.ts']` (logic lives in `src/bundle/`, not `scripts/`).
- [Source: eslint.config.ts] — R1/R4/R5 zones; DO NOT edit; `src/bundle/`+`src/portal/` must stay SDK-free.
- [Source: sprint-status.yaml] — epic-5 in-progress; 5-1/5-2 done; 5-5 backlog (this story); 5-3 art + 5-4 deploy are operator/external (NOT attempted).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMAD dev-story workflow, autonomous single-pass red→green→refactor)

### Debug Log References

- ATDD red baseline confirmed: `pnpm typecheck` reported 5 missing exports/modules (`classify-role`, `project-events`, `ProjectedEventSchema`/`OutcomeSchema`/`AbstractedRoleSchema`, `resolveAbstractedGrounding`/`AbstractedGrounding`) before implementation.
- Final gates (all GREEN): `pnpm typecheck` clean; `pnpm lint` clean (`eslint.config.ts` UNTOUCHED, R1/R4/R5 hold); `pnpm test` = 100 files / 1019 tests passing (baseline 93/937); `pnpm build` succeeds.
- R4: `grep -ril anthropic dist/` empty. `dist/bundles/story-10-1.json` is payload-free (`projectedEvents` len 14, no `normalizedEvents`, 0 matches for raw paths/content/`"payload"`).
- Determinism: 3 consecutive `pnpm bundle:story-10-1` runs byte-identical (annotationHash `c10c15aa…`, bundleHash `a0ebc77c…`). Per-event max size 203 bytes (cap 400).
- Provenance unchanged (§5): the regenerated bundle's `annotationHash` + `scrub.scrubHash` are BYTE-IDENTICAL to the prior committed bundle's — the content-address is over the (unchanged) full scrubbed events + versions; only the shipped per-event surface changed.
- Golden snapshots (`src/pace/__snapshots__/`, `src/ingest/`) byte-stable (no git diff) — Layer-0 untouched.

### Completion Notes List

Implemented the payload-free ReplayBundle + abstracted grounding. All 5 ACs satisfied; the 6 ATDD red tests are honestly green plus added unit coverage.

Key decisions (resolved on documented merits):
- §1 (opaque id): the projection keeps BOTH `orderKey` (the AC's named id) AND `eventId` (the ref-stable opaque string every timeline/annotation ref + freeze guard + portal lookup keys on). Five-key set = `{orderKey, eventId, eventType, toolName, outcome, role}`.
- §2 (field shape): RENAMED `normalizedEvents → projectedEvents: z.array(ProjectedEventSchema)`, `.strict()` so payload absence is a parse-time guarantee. Stayed `schemaVersion: 1` (pre-ship refinement; all consumers in-repo + updated here). `AbstractedRole` union lives in `classify-role.ts`; the Zod enum mirrors it in `replay-bundle.ts` (both enumerate the six, so a drift fails a test either way).
- §3 (classifier home): kept the ordered rule table INLINE as a documented `const` (not `role-classification.json` + a Zod loader) — six FIXED rules whose first-match precedence is load-bearing LOGIC, not operator-tunable data; the story explicitly permits avoiding the config table when it would be over-engineered. Target-path precedence (`file_path ?? path`, trimmed-to-null) re-derived minimally in `project-events.ts` (NOT importing the Layer-0 `translate.resolveTarget`, which would couple `bundle/ → translate/`).
- §4 (outcome): `outcome = event.isError ? 'isError' : 'success'` — each event's OWN per-event outcome (a `tool_use` is `success`; its paired `tool_result` carries the real pass/fail). Honest at the abstracted level; intentionally NOT cross-event correlation.
- §5 (provenance + guards): `annotationHash`/`freezeAnnotations` UNCHANGED (over the full scrubbed events). The full scrubbed events are an INTERNAL bake input (hash/freeze/guards) and are DROPPED — only `projectedEvents` ship. Re-pointed the F3 dangling-beat guard to the SHIPPED `projectedEvents`, and ADDED a §5 defense-in-depth assertion that every annotation `eventRef` + `groundingPointer.eventRefs` is present in `projectedEvents` (fail loud) so portal grounding cannot dangle at replay.
- §6 (portal seam — the one consequential DEVIATION from the literal Dev Notes text, taken to MINIMIZE churn per §6's own guidance): rather than re-typing `AnnotatedView.events` to a CONCRETE `ProjectedEvent[]` (which would have forced edits to ~8 untouched Story 3.1/3.3/4.1/4.3 behavior/caption/teaching test files), made `AnnotatedView<E extends { eventId: string } = { eventId: string }>` and `applyOverlay<E>` GENERIC. Bake-time callers infer `AnnotatedView<NormalizedEvent>` (unchanged); the browser boot threads `bundle.projectedEvents` → `AnnotatedView<ProjectedEvent>`. `resolveGrounding<E>`/`resolveActiveBeatGrounding<E>` are generic; `resolveAbstractedGrounding(annotation, view: AnnotatedView<ProjectedEvent>)` reads the projected `toolName`/`role`/`outcome` and the teaching concept (`concept = TEACHING[beatType]`, reused from Story 4.3 `teaching.json` — no invented copy). FAIL LOUD on a dangling ref preserved.
- AC4 portal display: `getActiveGrounding` now returns `{ beatKey, rows: AbstractedGrounding[] }`; `legend-overlay.ts` renders each row as a `tool · role · outcome — concept` line. NO raw eventId / file / symbol name is the visible grounding text (structurally guaranteed — the projection carries none).

Test-fix justifications (no test silently gutted):
- `classify-role.test.ts` no-echo property: dropped `'schema'` from one path's forbidden-substring list — that path lives in a `schema/` dir so its CORRECT role token IS `'schema'` (the classifier working, not a name leak); the genuinely-distinctive secret substrings still prove no path text leaks. Documented inline.
- `abstracted-grounding.test.ts`: removed the now-incorrect `projected as unknown as NormalizedEvent[]` cast (the view must carry `ProjectedEvent` for the abstracted fields) — a strengthening; no assertion weakened.
- Re-pointed (NOT weakened) the Story 1.2/5.2/4.4 suites whose bundle fixtures / grounding stubs encoded the OLD shape: `replay-bundle{,.unit,.scrub}.test.ts`, `assemble-bundle{,.unit}.test.ts`, `saga.test.ts`, `arena-boot-{bundle,saga,legend}.test.ts`, `legend-overlay.test.ts`, `portal.test.ts`, `committed-bundle.test.ts`. The legend/boot AC2 reveal assertions were re-pointed from raw-eventId display to the AC4 abstracted-grounding display (the legend no longer shows eventIds — the AC's explicit requirement).

Out of scope (per the story): the verbatim "sight-beyond-sight" local-only deep-dive (DEFERRED — not built; the seam stays clean, no code path from the public bundle to a raw transcript); Layer-0 untouched; `eslint.config.ts` untouched. NO git commit (the regenerated `public/bundles/story-10-1.json` is staged for the operator).

### File List

NEW (source):
- `src/bundle/classify-role.ts` — the pure, name-discarding abstracted-role classifier (AC3).
- `src/bundle/project-events.ts` — the pure payload-free projector (AC1, AC5).

NEW (tests — ATDD red-phase, authored by the prior ATDD pass; made green here):
- `src/bundle/classify-role.test.ts`
- `src/bundle/project-events.test.ts`
- `src/schema/replay-bundle.projected.test.ts`
- `src/bundle/payload-free-bundle.test.ts`
- `src/portal/abstracted-grounding.test.ts`
- `src/bundle/committed-bundle.payload-free.test.ts`

EDIT (source):
- `src/schema/replay-bundle.ts` — added `OutcomeSchema`/`AbstractedRoleSchema`/`ProjectedEventSchema` (`.strict()`); replaced `normalizedEvents` with `projectedEvents`.
- `src/bundle/assemble-bundle.ts` — project after freeze; ship `projectedEvents`; re-point F3 guard + add §5 referenced-ids assertion; updated header.
- `src/interpret/overlay.ts` — `AnnotatedView<E>` + `applyOverlay<E>` made generic (§6).
- `src/portal/portal.ts` — added `AbstractedGrounding` + `resolveAbstractedGrounding`; made `resolveGrounding`/`resolveActiveBeatGrounding` generic.
- `src/render/arena-boot.ts` — thread `bundle.projectedEvents`; `getActiveGrounding` returns abstracted rows; view typed `AnnotatedView<ProjectedEvent>`.
- `src/render/legend-overlay.ts` — `LegendGrounding` displays abstracted rows (`{ beatKey, rows }`); added `LegendGroundingRow`.
- `scripts/build-bundle.ts` — stdout label updated to "projected, payload-free" (the assembler projects internally; no logic change).

EDIT (tests — re-pointed to the new shape, documented):
- `src/bundle/assemble-bundle.test.ts`, `src/bundle/assemble-bundle.unit.test.ts`, `src/bundle/committed-bundle.test.ts`
- `src/schema/replay-bundle.test.ts`, `src/schema/replay-bundle.unit.test.ts`, `src/schema/replay-bundle.scrub.test.ts`
- `src/portal/portal.test.ts`
- `src/render/arena-boot-bundle.test.ts`, `src/render/arena-boot-saga.test.ts`, `src/render/arena-boot-legend.test.ts`, `src/render/legend-overlay.test.ts`
- `src/scribe/saga.test.ts`

REGENERATED (staged, NOT committed):
- `public/bundles/story-10-1.json` — payload-free shape (`projectedEvents`, no `normalizedEvents`); byte-stable; annotationHash/scrubHash unchanged from the prior committed bundle.

TRACKING:
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 5-5 in-progress → review.

## Senior Developer Review (AI)

**Reviewer:** Andres Felipe Grisales (AI-assisted adversarial review — 3 hunter layers + acceptance auditor, synthesized + verified against `git diff HEAD` and the committed bundle)
**Date:** 2026-06-15
**Outcome:** APPROVE — all 5 ACs PASS. The payload-free projection is real and structurally enforced; the committed bundle is grep-clean of payload/content/paths/names; provenance hashes are byte-identical to the prior bundle. One low-severity correctness defect (config-role over-match) warrants a surgical fix; one low-severity defense-in-depth hardening is worth applying; one flagged "finding" is a documented, sound decision (not a defect).

### Verdict

The privacy guarantee holds by construction: `ProjectedEventSchema` is `.strict()` (payload/content absence is parse-enforced), `projectEvents` carries no payload forward, and the sole composition point (`assembleBundle`) ships only `projectedEvents` (verified: committed bundle has 0 `normalizedEvents`, grep-clean of `payload`/`/work/project`/`file_path`/`Kickoff`/source filenames). The role classifier never echoes the path. The portal grounds beats to abstracted `{tool, role, outcome, concept}` rows with no raw name. The only real defect is a mis-classification (role accuracy), not a leak.

### Findings

| id | severity | recommendation | status | location | title |
|----|----------|----------------|--------|----------|-------|
| F1 | low | fix | RESOLVED (fix round 1) | `src/bundle/classify-role.ts:27` (+ `classify-role.test.ts`) | config-basename rule over-matches: source files prefixed `package`/`vite`/`eslint`/`tsconfig` mislabeled `config` |
| F2 | low | consider | RESOLVED (fix round 1) | `src/schema/replay-bundle.ts:55` | `ReplayBundleSchema` envelope is not `.strict()` — a stray top-level `normalizedEvents` would be silently stripped, not rejected |
| F3 | low | likely-refute | REFUTED (sound decision §1) | `src/schema/replay-bundle.ts:43-53` | projection ships `eventId` in addition to the AC's named `orderKey` (6 keys, not 5) |

**F1 — config-basename over-match (Edge/Boundary Hunter). VERIFIED REAL.** Rule `/(^|\/)(tsconfig|eslint|vite|package)[^/]*$/` uses `[^/]*$`, so ANY final-segment basename merely STARTING with one of those prefixes matches. Verified by replicating the full ordered `RULES`: `src/render/PackageList.tsx`, `src/vite-plugin-custom.ts`, `eslint-runner.ts`, `apps/web/src/lib/packageResolver.ts`, `src/packageManager.ts` all classify as `config` instead of `source`. The `role` token IS rendered to the viewer (`legend-overlay.ts:119-120` — "tool · role · outcome — concept"), so this directly violates AC4's "accurate to the real Event at the abstracted level." NOT a privacy leak (only the coarse token ships, never the name). The committed fixture (paths `normalized-event.ts`/`parse-transcript.ts`) does not trigger it, so all tests pass; `classify-role.test.ts` has NO over-match coverage. **Fix:** require a dot after the dotted-config prefixes (e.g. `(tsconfig|eslint|vite|jest)\.[^/]+$`) and match `package.json` exactly (`(^|\/)package\.json$`), so `packageResolver.ts`/`vite-plugin-custom.ts` fall through to `source`; add the regression cases.

**F2 — envelope not `.strict()` (Blind Hunter). VERIFIED.** `ProjectedEventSchema` is `.strict()` (per-event payload absence is parse-enforced — correct), but `ReplayBundleSchema` (L55) is non-strict, so Zod STRIPS unknown top-level keys rather than failing closed. Safe by construction today (verified: `assembleBundle` is the sole composition point, only adds `projectedEvents`; committed bundle has 0 `normalizedEvents`). Adding `.strict()` to the envelope makes a regression that re-introduces `normalizedEvents` fail LOUD at the boundary, mirroring the documented per-event `.strict()` rationale (Dev Notes §2). Low-cost hardening; the privacy guarantee already holds without it.

**F3 — projection ships `eventId` (6 keys). VERIFIED — NOT A DEFECT (refuted).** AC1 names the opaque id as `orderKey`; the projection ships BOTH `orderKey` and `eventId` (6 keys). This is the deliberate, documented Decision §1: `eventId` is the ref-stable opaque string every timeline `sourceEventIds` / annotation `eventRef` / `groundingPointer.eventRefs` / freeze guard / portal lookup keys on. Verified `eventId` values are opaque ordinals (`u-0001`, `u-0002#1`) — no path/name/content. Dropping it would break freeze/F3/overlay/grounding. No action; the shipped key count of 6 matches the tests' `EXPECTED_KEYS`.

### Acceptance Criteria Summary

| AC | verdict | note |
|----|---------|------|
| AC1 — payload-free, name-free projection in the assembled bundle | PASS | `.strict()` `ProjectedEventSchema` replaces `normalizedEvents`; `projectEvents` keeps the 6 documented keys, drops payload. Committed bundle: 0 payload, 0 `normalizedEvents`. |
| AC2 — byte-level absence proof (no payload field, bounded size, grep-absent of raw content/paths/names) | PASS | `payload-free-bundle.test.ts` + `committed-bundle.payload-free.test.ts` assert ≤400 bytes/event + `.not.toContain` content/paths/names. Verified committed JSON grep-clean (0 matches across payload//work/project/file_path/Kickoff/source filenames). |
| AC3 — pure, name-discarding bake-time role classifier emitting only a coarse token | PASS | `classifyRole` is pure, returns one of six literals, discards the path; no-echo property tested. NOTE: F1 — token is sometimes the WRONG coarse role for `package`/`vite`/`eslint`/`tsconfig`-prefixed source files (accuracy, not a leak; AC3's purity/no-echo still hold). |
| AC4 — portal grounds beats to abstracted projection (tool+role+outcome+concept), no raw transcript/name | PASS | `resolveAbstractedGrounding` maps refs → projected events → rows; fail-loud on dangling; rows carry no name/content; deep-dive not built. NOTE: F1 — the visible `role` can be inaccurate for the over-match paths. |
| AC5 — bake reads full local session, ships only the projection; scrub runs on projection; annotationHash over full events | PASS | Gate first, freeze over full scrubbed events (annotationHash unchanged), then project; full events dropped. Provenance verified byte-identical to HEAD (annotationHash `c10c15aa…`, scrubHash unchanged). |

(reviewed via 3 adversarial layers + acceptance auditor, deduped/triaged/verified; Status and git NOT changed)

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-06-15 | Story 5.5 implemented (payload-free ReplayBundle + abstracted grounding); Status → review. | Andres Felipe Grisales (AI) |
| 2026-06-15 | Senior Developer Review (AI) appended — APPROVE; F1 (fix), F2 (consider), F3 (likely-refute). | Andres Felipe Grisales (AI) |
| 2026-06-15 | Review fix round 1: F1 config-basename over-match fixed (dot/exact anchor + regression tests); F2 `ReplayBundleSchema` `.strict()` applied (+ reject tests); F3 refuted (sound §1 decision, no code change). All gates green; committed bundle byte-identical. Status → done. | Andres Felipe Grisales (AI) |

## Completion Note (Review fix round 1 — 2026-06-15)

All Senior Developer Review findings resolved. Two surgical source fixes, both root-cause, each with a regression test; one finding refuted with confirmation.

- **F1 (fix)** — `src/bundle/classify-role.ts`: the dotted-config-basename rule `(tsconfig|eslint|vite|package)[^/]*$` over-matched any source file STARTING with those prefixes (`PackageList.tsx`, `vite-plugin-custom.ts`, `eslint-runner.ts`, `packageResolver.ts` → `config` instead of `source`). Replaced with `(^|/)(tsconfig|eslint|vite|jest)\.[^/]+$` (dot required) + `(^|/)package\.json$` (exact). Regression cases added in `classify-role.test.ts` (`F1/ANCHORING`). The fix is behavior-preserving for every legitimate config path (those are caught by the `.json`/`.config.*` rules regardless), so the committed bundle's roles are unchanged.
- **F2 (consider, applied)** — `src/schema/replay-bundle.ts`: added `.strict()` to `ReplayBundleSchema` so a regression re-introducing a top-level `normalizedEvents` fails LOUD at the parse boundary instead of being silently stripped (defense-in-depth, mirroring the per-event `.strict()`). Two reject tests added in `replay-bundle.test.ts`.
- **F3 (likely-refute, refuted)** — no code change. `eventId` is the documented §1 ref-stable opaque id (opaque ordinals, no name/path/content) that all refs + the freeze guard + the portal lookup key on; dropping it breaks the pipeline. 6-key set matches the existing `EXPECTED_KEYS`.

**Gates (real results, fix round 1):** `pnpm typecheck` clean; `pnpm lint` clean (R1/R4/R5 hold, `eslint.config.ts` untouched); `pnpm test` = 100 files / 1024 tests passing (was 1019; +5 new regression tests); `pnpm build` succeeds. `grep -ril anthropic dist/` empty; `dist/bundles/story-10-1.json` payload-free (no `normalizedEvents`/`payload`, 0 raw path/content matches). Determinism: regenerated `public/bundles/story-10-1.json` byte-identical (annotationHash `c10c15aa…`, bundleHash `a0ebc77c…` unchanged). NO git commit (operator commits between stories; the regenerated bundle is unchanged from the prior committed bytes anyway).
