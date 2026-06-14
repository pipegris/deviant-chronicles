---
baseline_commit: d395c449ebce76e0c410e922a17af3eb5b685b91
---

# Story 1.3: Ingest the real Story 10.1 session into a normalized Event timeline

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the builder,
I want the chosen Story 10.1 transcript and the workflow-journal streams parsed into a deterministic, ordered `NormalizedEvent[]`,
so that the demo runs on genuinely real events (SM-3) with a stable total ordering. (FR-1)

## Acceptance Criteria

(Verbatim from `_bmad-output/planning-artifacts/epics.md#Story 1.3`, with the one architecture
adaptation noted in Dev Notes → "Architecture adaptation: journal, not `.omc/state`".)

1. **Given** the Story 10.1 Claude Code transcript JSONL + the second lifecycle stream
   **When** ingestion runs
   **Then** ONLY `src/ingest/` parses the raw JSONL, Zod-validates it, and emits a normalized camelCase `NormalizedEvent[]` (raw field names never leak past `ingest/`) (R3)
   **And** the same input yields a byte-identical event list (deterministic).

2. **Given** the main and sub-agent (transcript + journal) streams
   **When** they are merged
   **Then** an `orderKey = (logicalClock, streamId, seqWithinStream)` stamped at ingest produces a single total order via a pure stable sort (wall-clock alone is NOT used for ordering).

3. **Given** events irrelevant to the battle (internal bookkeeping)
   **When** the allowlist filter applies
   **Then** they are excluded per a documented allowlist
   **And** a malformed/unknown raw record aborts the build LOUD with a clear message (no broken timeline).

4. **Given** the need for tests
   **When** the fixture is committed
   **Then** a redacted sample Session lives in `src/ingest/__fixtures__/` so pipeline tests are meaningful without the real private transcript.

## Tasks / Subtasks

- [x] **Task 1 — Raw-record contracts (the untrusted-shape Zod schemas, R3 boundary) (AC: #1, #3)**
  - [x] In `src/ingest/`, author Zod schemas for the TWO raw shapes (these validate the
        untrusted JSONL; they are NOT the same as `NormalizedEvent`). Keep them `ingest/`-local
        (do not put raw shapes in `src/schema/` — only the normalized contract gates downstream).
  - [x] `RawTranscriptRecordSchema`: the Claude Code transcript line. Required keys observed in
        BOTH dev.jsonl and fix.jsonl: `type` ('user'|'assistant'|'attachment'), `uuid`,
        `parentUuid` (nullable), `timestamp` (ISO string), `agentId`, `isSidechain`, `sessionId`,
        `cwd`, `gitBranch`. `message` is present on user/assistant (object `{role, content}`),
        absent on `attachment` (which instead has an `attachment` object). `message.content` is
        EITHER a string OR an array of content items.
  - [x] `RawContentItemSchema` (discriminated on `type`): `tool_use` `{type,id,name,input,caller}`,
        `tool_result` `{type,tool_use_id,content,is_error?}`, `text` `{type,text}`,
        `thinking` `{type,thinking,signature}`.
  - [x] `RawJournalRecordSchema`: `{type:'started'|'result', key, agentId, result?}`. NOTE the
        journal has NO `timestamp` and NO `message` — it is a different shape parsed separately.
  - [x] Use Zod `.parse()` (NOT `.safeParse()` swallowing) so a malformed/unknown record throws
        a `ZodError`; wrap with a clear, build-time-loud error message (AC3). See Dev Notes
        → "Loud abort".

- [x] **Task 2 — `src/ingest/parse-transcript.ts` (PURE; raw text → raw records) (AC: #1)**
  - [x] `export function parseTranscript(jsonl: string, streamId: string): RawTranscriptRecord[]`
        — split on newlines, skip blank lines, `JSON.parse` each, validate with the Task-1 schema.
  - [x] PURE: takes the file CONTENT as a string argument. NO `fs`, NO `Date.now()`, NO network,
        NO global mutable state (R2 / R3). The fs read happens in the test/harness, never here.
  - [x] On a `JSON.parse` failure or schema-validation failure, throw with a message that names
        the stream and the 0-based line index (e.g. `Ingest: malformed transcript record at
        <streamId>:line 142 — <zod message>`). (AC3)

- [x] **Task 3 — `src/ingest/parse-journal.ts` (PURE; raw text → raw journal records) (AC: #1)**
  - [x] `export function parseJournal(jsonl: string): RawJournalRecord[]` — same pure contract as
        Task 2, validating with `RawJournalRecordSchema`.
  - [x] Same loud-abort behavior (`Ingest: malformed journal record at line N — ...`).

- [x] **Task 4 — `src/ingest/normalize.ts` (PURE; raw records → `NormalizedEvent[]`, per stream) (AC: #1, #2, #3)**
  - [x] Import `NormalizedEventSchema` from `../schema/normalized-event` (DO NOT
        redefine — Story 1.2 owns these). See Dev Notes → "Field mapping". (Only
        `NormalizedEventSchema` is needed; `OrderKeySchema` is exercised transitively via it.)
  - [x] `export function normalizeTranscript(records: RawTranscriptRecord[], streamId: string):
        NormalizedEvent[]` — EXPAND each transcript record into per-content-item events (one
        `NormalizedEvent` per kept `tool_use` / `tool_result` / `text` item; one per
        string-content record), apply the allowlist (Task 6), and map fields to camelCase.
  - [x] `export function normalizeJournal(records: RawJournalRecord[]): NormalizedEvent[]` — one
        event per kept journal `started`/`result` record, `streamId = 'orchestrator'`.
  - [x] Stamp `orderKey` per Dev Notes → "orderKey derivation". `seqWithinStream` is the kept-event
        index within that stream (0-based, monotonic). Validate EVERY produced event with
        `NormalizedEventSchema.parse(...)` before returning (Zod-validated emission, AC1).
  - [x] camelCase only: raw `is_error`→`isError`, `tool_use_id`/`uuid`→`eventId`, etc. Raw
        snake_case / `parentUuid` / `tool_use_id` MUST NOT appear on any returned object (AC1, R3).

- [x] **Task 5 — `src/ingest/merge.ts` (PURE stable merge → single total order) (AC: #2)**
  - [x] `export function mergeStreams(streams: NormalizedEvent[][]): NormalizedEvent[]` — concat,
        then a PURE STABLE sort on the composite key `(logicalClock, streamId, seqWithinStream)`.
        TS `Array.prototype.sort` is not guaranteed stable across engines historically but IS in
        V8/modern engines; nonetheless make the comparator TOTAL (all three keys compared, never
        returning 0 for distinct events) so stability is not relied upon. (R-total-ordering)
  - [x] After merging, REWRITE `orderKey.logicalClock` to the final merged index (0..n-1) so the
        downstream timeline has a dense, gap-free monotonic clock. Keep `streamId` +
        `seqWithinStream` as-stamped (provenance of origin stream). See Dev Notes → "orderKey
        derivation" for why the pre-merge clock and the post-merge clock differ.
  - [x] PURE: no `Date.now()`, no fs (R2).

- [x] **Task 6 — Documented allowlist (config-as-data) (AC: #3)**
  - [x] Author the allowlist as DATA, not inline booleans, so battle-irrelevant bookkeeping is
        excluded by a reviewable list (NFR-4 config-as-data; matches `src/config/*.json` pattern).
        Recommended home: `src/ingest/allowlist.ts` exporting a typed const (an `ingest/`-local
        policy object; it is parse-policy, not battle-tuning, so it stays beside the parser rather
        than in `src/config/`). Document each include/exclude with a one-line rationale comment.
  - [x] KEEP (battle-relevant): `tool_use` for all tool names present (`Edit`, `Write`, `Read`,
        `Bash`, `Monitor`, `ToolSearch`, `StructuredOutput`); `tool_result` (carry `isError`);
        `text` (assistant narration source for Layer 2); the initial-prompt string-content `user`
        record (the autonomous kickoff — meaningful context). Allowlist must TOLERATE tools NOT in
        this session (`Grep`/`Glob`/`Task`) so the list is forward-safe (see Dev Notes → "Allowlist").
  - [x] EXCLUDE (battle-irrelevant bookkeeping): `attachment` records (`deferred_tools_delta` —
        pure tooling list churn); `thinking` content items (internal model reasoning + an opaque
        cryptographic `signature`; never viewer-facing; NOT a battle action). Document both.
  - [x] EXCLUDE journal `started` records' noise but KEEP the phase lifecycle: keep both `started`
        and `result` journal records (they bracket phases → the AETHER STORM / over-fix anchors),
        but DROP the opaque `key` hash from the leaked surface (fold into `payload`, not a top-level
        field). See Dev Notes → "Allowlist".

- [x] **Task 7 — Committed redacted fixture in `src/ingest/__fixtures__/` (AC: #4)**
  - [x] Create a SMALL redacted multi-stream sample so CI is meaningful WITHOUT the private,
        gitignored `.sources/` files. Two files (e.g. `sample-transcript.jsonl` +
        `sample-journal.jsonl`) or one TS module exporting fixture strings — match the existing
        co-located test style. (Authored in the prior ATDD phase; verified structurally faithful
        and public-safe during dev — see Completion Notes → "Fixture audit".)
  - [x] The fixture MUST contain at least: one `Edit`, one `Write`, one `Read`, one `Bash`
        tool_use + matching `tool_result` (one with `is_error:true`, one `false`), one assistant
        `text`, one `thinking` (to prove it is EXCLUDED), one `attachment` (to prove it is
        EXCLUDED), the string-content kickoff `user` record, and ≥2 journal records
        (`started` + `result`). This exercises every allowlist branch + the merge.
  - [x] REDACT: replace real paths/identifiers (`/home/archfelipe/dev/kebox`, real `sessionId`s,
        any tokens) with generic placeholders. The fixture is hand-authored — it does NOT have to
        be a literal slice of the real transcript, only structurally faithful. (The full
        `scripts/scrub.ts` privacy gate over the REAL session is Epic 5 / Story 5.1 — out of scope
        here; this story only needs a synthetic redacted fixture for tests.)

- [x] **Task 8 — Co-located tests (`src/ingest/*.test.ts`) (AC: #1, #2, #3, #4)**
  - [x] `parse-transcript.test.ts` / `parse-journal.test.ts`: valid fixture parses; a malformed
        line throws with the line-indexed message (AC3).
  - [x] `normalize.test.ts`: every emitted object validates against `NormalizedEventSchema`;
        assert NO raw key leaks (snapshot the keys, assert absence of `is_error`, `tool_use_id`,
        `parentUuid`); assert `thinking` + `attachment` are absent from output (allowlist, AC3).
  - [x] `merge.test.ts`: the merged list is in `(logicalClock, streamId, seqWithinStream)` order;
        a second run over the same fixture yields a byte-identical list — assert via
        `JSON.stringify(run1) === JSON.stringify(run2)` (determinism, AC1) AND a committed Vitest
        snapshot of the merged `NormalizedEvent[]` (the ingest-level determinism anchor; the
        full BattleTimeline golden snapshot is Story 1.5). (The byte-identical equality lives in
        `merge.test.ts`; the committed snapshot lives in the e2e `ingest.test.ts`.)
  - [x] An end-to-end `ingest.test.ts` (or within merge.test) reads the fixture files via `fs` in
        the TEST (allowed — tests are not Layer-0 modules), pipes through
        parse → normalize → merge, and asserts the snapshot. This keeps `fs` OUT of `ingest/` (R2).

- [x] **Task 9 — Verify all gates green (AC: all)**
  - [x] `pnpm typecheck` (tsc strict) clean.
  - [x] `pnpm lint` clean — confirm NO R1 violation (ingest/ must not import interpret/) and that
        ingest/ imports only `../schema/*` + `zod` (+ node `fs` only inside `*.test.ts`).
  - [x] `pnpm test` full suite green (existing 62 + new ingest tests → 116 total after review fixes).
  - [x] `pnpm build` succeeds and `@anthropic-ai/sdk` does NOT appear in the browser bundle (R4 —
        ingest/ must never import it; this story adds no SDK usage).
  - [x] DO NOT `git commit` (the operator commits between stories).

### Review Follow-ups (AI)

Fix round 1 — addresses every finding from the Senior Developer Review (AI) below. All
behavioral fixes carry a proving test; gates re-run green (typecheck 0 / lint 0 / test 116 / build 0).

- [x] **[F1 HIGH] Duplicate eventId across the merged timeline.** Journal `eventId` now suffixes
      the record type (`${record.key}#${record.type}`) so `started`/`result` no longer collide,
      mirroring the transcript `${uuid}#${itemIndex}` scheme (`normalize.ts`). Added a uniqueness
      assertion over the MERGED set (`ingest.test.ts`), which the prior transcript-scoped test
      could not catch. Committed snapshot regenerated.
- [x] **[F3 HIGH] Raw snake_case leaks when `tool_result.content` is an array.** Added a pure
      recursive `normalizeResultContent` that camelCases nested raw keys (`tool_use_id`→`toolUseId`,
      `is_error`→`isError`) instead of spreading raw items verbatim (`normalize.ts`). R3 now holds
      for array content (snapshot grep: 0 raw snake_case keys).
- [x] **[F2 MED] Journal events front-loaded instead of bracketing their phase.** `normalizeJournal`
      gained an optional back-compat `anchorClock` param; the e2e harness computes the dev-phase max
      epoch and threads it in so journal records sort AFTER the dev phase. Added an interleaving
      assertion (`ingest.test.ts`). The bare `normalizeJournal(records)` ATDD call is unchanged.
- [x] **[F6 MED] Unparseable timestamp escaped as a bare ZodError.** `RawTranscriptRecordSchema.timestamp`
      now refines to `!Number.isNaN(Date.parse(v))`, routing the failure through the located
      `Ingest: malformed transcript record at <stream>:line N` abort (AC3). Added a proving test
      (`parse-transcript.test.ts`).
- [x] **[F4 LOW] Vacuous recursive no-leak test.** Added an array-content `tool_result` (carrying
      nested `tool_use_id`/`is_error`) to `sample-transcript.jsonl`, turning the deep guard real and
      exercising F3 end-to-end in both the recursive check and the committed snapshot.
- [x] **[F5 LOW] Unsound `as string` cast in journal subtype fallback.** Replaced with `typeof`
      guards (`status` when string, else `verdict` when string, else null) so a non-string truthy
      status can no longer slip into the string `subtype` (`normalize.ts`). The branch coverage is
      pinned by the existing `normalize.test.ts` subtype test.
- [x] **[F7 LOW] Story doc understated the test count.** Corrected the `106` references (now `112`
      for the initial dev pass, `116` after these review fixes).

## Dev Notes

> This story PINS the transcript/journal parser to the REAL Story 10.1 session files
> (architecture.md "Gap Analysis" → "First build task after scaffolding"). All shapes below were
> verified by direct inspection of the real (gitignored) `.sources/story-10-1/*.jsonl`.

### Build ON the committed foundation — do NOT re-scaffold or redefine schemas

- Stories 1.1 (scaffold) + 1.2 (Zod schemas) are COMMITTED at HEAD (`git log`:
  `401ca3d` Story 1.1, `1b13701` Story 1.2). Baseline is GREEN: 9 test files, 62 tests pass.
- `src/schema/normalized-event.ts` already exports `NormalizedEventSchema`, `NormalizedEvent`,
  `OrderKeySchema`, `OrderKey`, `ActionTypeSchema`, `ActionType`. **IMPORT them; do not redefine.**
- `src/ingest/` currently contains only `.gitkeep` + an empty `__fixtures__/`. This story fills it.

### Architecture adaptation: journal, not `.omc/state` (RECORD THIS)

- `architecture.md` (project structure) names `src/ingest/parse-omc-state.ts` reading
  `.omc/state/agent-replay-*.jsonl` as the second stream. **That is stale.** The real second
  source for THIS session is the **workflow orchestrator journal** (`.sources/story-10-1/journal.jsonl`,
  produced by the `bmad-epic-pipeline` run `wf_8d4e59a3-bc8`). The `.omc/state/agent-replay` files
  are stale Feb dates, confirmed irrelevant to 10.1.
- Therefore implement `src/ingest/parse-journal.ts` (NOT `parse-omc-state.ts`). The epics AC text
  ("`.omc/state/agent-replay-*.jsonl`") is read as "the second lifecycle stream", satisfied by the
  journal. This is a deliberate, documented deviation from the architecture file's filename.
- Files to create: `parse-transcript.ts`, `parse-journal.ts`, `merge.ts`, `normalize.ts`,
  `allowlist.ts` + co-located `*.test.ts` + `__fixtures__/`.

### The three real streams (verified shapes)

| Stream | File | streamId (real `agentId`) | records | shape |
|---|---|---|---|---|
| Dev phase | `dev.jsonl` | `aecfc998031eb0576` | 489 | Claude Code transcript |
| Fix phase | `fix.jsonl` | `ade7aab14f277ba49` | 299 | Claude Code transcript |
| Orchestrator | `journal.jsonl` | `orchestrator` (stable label) | 22 | workflow journal (different shape) |

- **Timestamps do NOT overlap:** dev `15:56:48.752Z → 16:32:37.762Z`; fix
  `16:58:09.522Z → 17:23:58.229Z`. A pure stable sort on the composite key interleaves cleanly.
- **`isSidechain` is `true` for ALL transcript records** — it does NOT distinguish streams within
  a file. The stream key is `agentId` (one per file). There are NO in-transcript sub-agent `Task`
  spawns: `caller.type` is `direct` for all 188 (dev) / 109 (fix) tool_use items. The "sub-agent
  stream" the architecture anticipated manifests here as the SEPARATE journal file, not as nested
  sidechains.

### Transcript content granularity — expand to per-content-item events

A transcript LINE is a message envelope; the real battle events live INSIDE `message.content`,
which is an ARRAY of content items. Verified counts:

| content item | dev | fix | disposition |
|---|---|---|---|
| `tool_use` | 188 | 109 | KEEP → one event each |
| `tool_result` | 188 | 109 | KEEP → one event each |
| `thinking` | 85 | 55 | EXCLUDE (internal reasoning + opaque `signature`) |
| `text` | 25 | 24 | KEEP → assistant narration (Layer-2 source) |
| string content | 1 | 1 | KEEP → the autonomous kickoff prompt |

- dev tool_use names: `Bash`×98, `Edit`×41, `Read`×28, `Write`×17, `Monitor`×2, `ToolSearch`×1,
  `StructuredOutput`×1. fix: `Bash`×51, `Edit`×42, `Read`×15, `StructuredOutput`×1.
- **`Grep`/`Glob`/`Task` are ABSENT** in this session. The allowlist must therefore KEEP-by-policy
  (keep all `tool_use` regardless of name) rather than enumerate a closed name set — otherwise a
  later session with `Grep`/`Task` would silently drop them. (1.4 translation maps the names; 1.3
  only needs to NOT lose them.)
- So `normalize` emits roughly: dev → ~402 kept events (188+188+25+1), fix → ~243, journal → ~22.
  Final merged list ≈ **667** `NormalizedEvent`s (exact count is whatever the fixture/real files
  produce; do NOT hardcode it — the snapshot captures it).

### Field mapping (existing `NormalizedEventSchema` → raw) — NO SCHEMA EXTENSION NEEDED

The existing 1.2 contract absorbs every real field. **Decision: do NOT extend the schema** (and so
do NOT touch 1.2 tests). Rationale per field:

| `NormalizedEvent` field | source / derivation | notes |
|---|---|---|
| `orderKey` | see "orderKey derivation" | `{logicalClock, streamId, seqWithinStream}` |
| `eventId` | transcript: `uuid` + content-item index suffix (uuids repeat across a line's items, so suffix to keep unique, e.g. `${uuid}#2`); journal: `key` | must be unique per emitted event |
| `eventType` | `'tool_use'` \| `'tool_result'` \| `'text'` \| `'prompt'` (string content) \| `'journal_started'` \| `'journal_result'` | free string in schema |
| `toolName` | tool_use `name`; else `null` | nullable ✓ |
| `subtype` | tool_use → `null`; tool_result → `null`; journal → `result.status`/`result.verdict` when present, else `null` | nullable ✓ — useful Interpreter signal |
| `timestamp` | transcript `timestamp` (as-ingested string, NEVER reformatted); **journal has none → use `""` (empty string)** | string ✓; see note |
| `streamDepth` | `0` for transcript top-level; journal `0` | int; no nesting in this session |
| `exitCode` | **`null`** — Bash `tool_result` carries NO numeric exit code (only `is_error` + a content string); see "Bash result shape" | nullable ✓ |
| `isError` | tool_result `is_error` (default `false` when key absent — 86/188 dev results omit it); all non-result events `false` | boolean (required, non-null) |
| `retryCount` | `0` (this story does not compute retries; retry/struggle detection is a pacing concern, Story 1.5) | int; keep 0, document |
| `payload` | tool_use → `{input}` (the command/filePath etc.); tool_result → `{content}` (truncate? see note); text → `{text}`; journal → `{result, key}`; or `null` | open `z.record` ✓ — this is the relief valve |

- **`timestamp` for journal = `""`**: the schema requires `timestamp: z.string()` (non-null). The
  journal has no timestamp. Use `""` (explicit-empty, NOT a fabricated wall-clock — fabricating one
  would violate "timestamps stay as-ingested, never reformatted with the wall clock",
  architecture.md "Format Patterns"). Ordering does NOT depend on `timestamp` (it depends on
  `orderKey.logicalClock`), so an empty journal timestamp is safe. RECORD this; a downstream
  consumer needing a time for the journal must use `orderKey`, not `timestamp`.
- **`payload` content size**: tool_result `content` strings can be large (full command output). To
  keep the snapshot reviewable and the bundle lean, store the raw item but consider NOT inflating —
  for v0.1 keep `payload` faithful (the scrub pass in Epic 5 handles redaction of the public
  bundle; 1.3 fixture is already redacted). Do not over-engineer truncation now.
- **Why no extension** (the prompt floated `streamId`/`agentType`/`success`/`durationMs`/`isError`):
  `streamId` already lives in `orderKey.streamId`; `success` is the inverse of the existing
  `isError`; `agentType` fits in `payload`; `durationMs` is not derivable (results carry no
  duration, only line timestamps) and is a pacing concern (Story 1.5). Adding fields would force a
  1.2-test edit for zero benefit. The open `payload` record (added deliberately in 1.2 "keeps the
  gating contract open while ingest (1.3) decides which normalized fields to populate") is the
  intended relief valve. **If implementation hits a field genuinely un-absorbable by `payload`,
  THEN extend `src/schema/normalized-event.ts` + its 1.2 tests and record it here — but the
  analysis says you will not need to.**

### orderKey derivation (R-total-ordering; wall-clock alone forbidden)

`orderKey = (logicalClock, streamId, seqWithinStream)` — two-phase:

1. **Per-stream stamp (in `normalize`)**: `streamId` = the stream's label (`aecfc998031eb0576` /
   `ade7aab14f277ba49` / `orchestrator`). `seqWithinStream` = the kept-event index within that
   stream (0-based, monotonic, gap-free). A *provisional* `logicalClock` is set from the record's
   timestamp converted to epoch-ms (`Date.parse(timestamp)` is a PURE string→number transform — it
   reads NO wall clock, so it is allowed in Layer 0; this is NOT `Date.now()`). For the journal
   (no timestamp) the provisional `logicalClock` is synthesized to bracket its phase: anchor it to
   the surrounding transcript epoch range so journal lifecycle records sort between phases (e.g.
   journal `started`/`result` for the dev agent land at the dev phase boundary). Simplest faithful
   rule: assign the journal a provisional clock just after the max dev timestamp and before the min
   fix timestamp for mid-run records, ordered by journal file index. Document the exact rule chosen.
2. **Post-merge rewrite (in `merge`)**: after the stable composite sort, rewrite each event's
   `orderKey.logicalClock` to its final 0-based index in the merged list → a dense, monotonic,
   gap-free clock that the Pacer (1.5) and Model (Epic 2) advance by. `streamId` +
   `seqWithinStream` are preserved (origin provenance).

Wall-clock-derived epoch is used ONLY as a *sort input*, NEVER as the sole order key — the composite
`(logicalClock, streamId, seqWithinStream)` is the key, and ties (same epoch ms) break
deterministically by `streamId` then `seqWithinStream`. This satisfies AC2 ("wall-clock alone is
not used for ordering").

### Allowlist (documented — AC3)

Author as a typed const in `src/ingest/allowlist.ts` (parse-policy data, reviewable). Each line gets
a rationale comment. The policy:

- **KEEP — battle-relevant:**
  - every `tool_use` (Edit/Write/Read/Bash/Grep/Glob/Task/… — keep by-policy, not by closed list,
    so absent-in-this-session tools like Grep/Glob/Task are not silently dropped). [FR-1: real events]
  - every `tool_result` (carries `isError` + the success/error content — drives counters in 1.4).
  - `text` content items (assistant narration → Layer-2 caption/saga source).
  - the string-content `user` kickoff record (the autonomous prompt; meaningful framing event).
  - journal `started` + `result` records (phase/agent lifecycle → the AETHER STORM synth-stumble &
    the 17/17 over-fix anchors live here).
- **EXCLUDE — battle-irrelevant internal bookkeeping:**
  - `attachment` records (`type:'deferred_tools_delta'`) — tooling-list churn, zero battle meaning.
  - `thinking` content items — internal model reasoning + an opaque cryptographic `signature`;
    never viewer-facing, not a battle action. (Keeping them would 2.4× the event count with noise.)
  - the opaque journal `key` hash is folded into `payload`, not exposed as a leaked top-level field.
- **Caveats this session does NOT contain** (but the allowlist should remain robust to): inline
  `<system-reminder>` injections, `<command-name>`/`<local-command-*>` caveat blocks, `isMeta` /
  `isCompactSummary` no-op meta records — NONE were found in dev.jsonl/fix.jsonl. Do NOT add
  speculative exclusion code for shapes that are absent; the allowlist filters on the `type`/
  content-item-`type` fields that ACTUALLY occur. (If a future session injects these, extend the
  allowlist data — it is config, not engine code, NFR-4.)

### Bash result shape (why `exitCode` is null)

Verified: a `Bash` `tool_use` is `{type, id, name:'Bash', input:{command, description}, caller}`.
Its matching `tool_result` is `{tool_use_id, type, content:<string output>, is_error:<bool>}`. There
is **no numeric exit code field** — success/failure is the `is_error` boolean only. So
`NormalizedEvent.exitCode = null` for these, and `isError` is the real mechanical signal. (The
schema's nullable `exitCode` was authored in 1.2 precisely for this.) Five dev records also carry a
top-level `toolUseResult` STRING (tool-harness error messages like "File has not been read yet") —
informational; fold into `payload` if emitting that record, do not invent structure for it.

### Purity boundary (R2 / R3) — where the `fs` read lives

- `src/ingest/*` (parse/normalize/merge/allowlist) are **PURE**: they take raw text / arrays as
  INPUT and return values. FORBIDDEN inside them: `fs`, `Date.now()`, `Math.random()`,
  `performance.now()`, network, global mutable state. (`Date.parse(string)` is allowed — pure
  string→number, reads no clock.)
- The actual `fs.readFileSync('.sources/story-10-1/*.jsonl', 'utf8')` happens in the TEST (and, in
  Epic 5, in `scripts/build-bundle.ts`) — NEVER inside `ingest/`. Tests are not Layer-0 modules, so
  they may use `fs` freely.
- **Lint nuance to be aware of:** `eslint.config.ts` enforces R1 via `import/no-restricted-paths`
  with `target: ./src/ingest, from: ./src/interpret` (ingest must not import the interpret overlay)
  — verified in the config. It does NOT mechanically ban `node:fs` inside `ingest/`. So the
  no-fs-in-ingest rule (R2) is a CONVENTION + the determinism test, not a lint error. Keep `fs` in
  the test, and the determinism snapshot will fail loudly if anything nondeterministic (a wall
  clock, fs ordering) leaks into the pure path. Do NOT relax any boundary rule to make code pass.

### Loud abort (AC3 — build-time strict)

`Ingest validation fails LOUD` (architecture "Process Patterns"): a malformed line or a record that
fails its raw Zod schema must `throw` (not warn-and-skip) with a clear, located message
(`Ingest: malformed <transcript|journal> record at <streamId|->:line N — <zod issue>`). This is the
strict build-time boundary. (Contrast: the *replay-time* "unmapped event → neutral idle beat"
fail-closed-to-default is a TRANSLATION concern in Story 1.4, NOT here. 1.3 is strict; 1.4 is
forgiving. Do not conflate.)

### Determinism (AC1, NFR-2) — byte-identical output

- Same input → byte-identical `NormalizedEvent[]`. Guard with BOTH: (a) an in-test equality
  `JSON.stringify(run1) === JSON.stringify(run2)`, and (b) a committed Vitest snapshot of the
  merged fixture output (the ingest-level determinism anchor). The full BattleTimeline golden
  snapshot is Story 1.5; this story's snapshot guards the ingest stage specifically.
- No randomness, no clock, stable total-order comparator, stable JSON key order (object literals
  authored in a fixed field order; Zod `.parse` preserves declared shape). Prefer explicit `null`
  over `undefined` (architecture "Null vs absent") so serialized output is stable.

### Project Structure Notes

- New files (all under `src/ingest/`): `parse-transcript.ts`, `parse-journal.ts`, `normalize.ts`,
  `merge.ts`, `allowlist.ts`; co-located `parse-transcript.test.ts`, `parse-journal.test.ts`,
  `normalize.test.ts`, `merge.test.ts` (and/or one `ingest.test.ts` for the e2e); fixtures in
  `src/ingest/__fixtures__/`.
- **Conventions** (architecture "Naming/Structure Patterns"): kebab-case filenames; types
  PascalCase; Zod `export const XxxSchema` + `export type Xxx = z.infer<typeof XxxSchema>`; enums =
  string-literal unions (no numeric enums); internal JSON camelCase (raw names never leak past
  `ingest/`); prefer explicit `null`; config-as-data (the allowlist). Tests `environment: 'node'`,
  `include: ['src/**/*.test.ts']` (`vitest.config.ts`).
- **Imports allowed in `ingest/`:** `zod`, `../schema/*`, node built-ins ONLY in `*.test.ts`.
  FORBIDDEN: `../interpret/*` (R1, lint-enforced), `@anthropic-ai/sdk` (R4), `phaser` (R5).
- `.sources/story-10-1/` is gitignored (`.gitignore:44`) — the REAL files must NOT be committed;
  only the redacted `__fixtures__/` are committed. The `pnpm bundle:story-10-1` script is a stub
  (Story 5.2) — this story does NOT wire the real-file pipeline into a committed artifact.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.3] — ACs verbatim; FR-1.
- [Source: _bmad-output/planning-artifacts/epics.md#Additional Requirements] — R3 anti-corruption,
  total-ordering orderKey, "Ingest validation fails LOUD", committed redacted fixture.
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
  — R1 (layer discipline), R2 (purity), R3 (anti-corruption), R4 (LLM isolation), R5 (render).
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] — Zod 4.4.3 at the
  ingest boundary; `orderKey = (logicalClock, streamId, seqWithinStream)`; pure stable sort.
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries] — the
  `ingest/` file list (note the `parse-omc-state.ts`→`parse-journal.ts` adaptation above).
- [Source: src/schema/normalized-event.ts] — `NormalizedEventSchema`, `OrderKeySchema` (import,
  do NOT redefine); open `payload` relief valve; nullable `exitCode`.
- [Source: .sources/story-10-1/{dev,fix,journal}.jsonl] — real stream shapes verified by direct
  inspection (gitignored; do not commit).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Opus 4.8) — bmad-dev-story workflow, autonomous single-pass.

### Debug Log References

- Initial RED state confirmed: 5 ingest ATDD test files failed (module-not-found), baseline
  9 files / 62 tests green.
- GREEN reached for all 5 ATDD files (37 tests) after authoring parse-transcript / parse-journal
  / normalize / merge / allowlist.
- Two gate failures found and fixed honestly (code, not config/test):
  1. `parse-transcript.test.ts` Zod-rooted assertion: switched both parsers from swallowed
     `.safeParse()` to `.parse()` in try/catch, surfacing `err.name` (`ZodError`) in the located
     message so the thrown error is recognizably Zod-rooted (matches the story's Task-1 directive).
  2. ESLint `preserve-caught-error` flagged the re-thrown loud-abort errors: attached
     `{ cause: err }` to all four `new Error(...)` sites. That 2-arg `Error` overload is ES2022
     and the shared tsconfig pins `lib: ES2020`, so typecheck then failed (TS2554); resolved with
     a file-local `/// <reference lib="es2022.error" />` in each parser (adds only the
     `ErrorOptions`/`cause` typing — a runtime feature the Vite build already emits — without
     editing the foundation tsconfig or the lint config).
- Final gates (initial dev pass): typecheck exit 0, lint exit 0, test 15 files / 112 passing,
  build succeeds, `dist/` contains no `anthropic` reference (R4). (The 106 figure originally
  recorded here understated the real count — corrected per review finding F7; post-review-fix
  count is 116.)

### Completion Notes List

**Implemented (exactly the story scope — ingestion only; no translate/pace/model):** the five
`src/ingest/` modules (`parse-transcript.ts`, `parse-journal.ts`, `normalize.ts`, `merge.ts`,
`allowlist.ts`) consuming the committed `src/schema/normalized-event.ts` contract (imported, NOT
redefined). Schema NOT extended — every real field is absorbed by the existing contract + the open
`payload` relief valve, exactly as the Dev Notes "Field mapping" predicted.

**ATDD tests:** all 5 pre-existing red-phase files (`parse-transcript`, `parse-journal`, `normalize`,
`merge`, `allowlist`) were made GREEN honestly — none deleted, skipped, weakened, or had an
expectation gutted. One on-top e2e file (`ingest.test.ts`) was added per Task 8, carrying the
COMMITTED determinism snapshot (`__snapshots__/ingest.test.ts.snap`, 12 events) plus field-mapping
and non-mutation unit assertions.

**AC verification:**
- AC1 (R3 boundary + determinism): only `src/ingest/` parses + Zod-validates; normalize returns
  clean camelCase `NormalizedEvent`s (the no-leak test inspects `Object.keys` of the *function
  output*, and forbidden raw keys `is_error`/`tool_use_id`/`parentUuid`/`uuid`/… are absent);
  `JSON.stringify(run1) === JSON.stringify(run2)` + the committed snapshot prove byte-identical output.
- AC2 (total ordering): `orderKey = (logicalClock, streamId, seqWithinStream)`; merge uses a TOTAL
  comparator (all three keys, never 0 for distinct events) so stability is not relied on, then
  rewrites `logicalClock` to the dense 0..n-1 index. Journal events (timestamp `""`) still receive a
  well-defined position → wall-clock alone is not the key.
- AC3 (allowlist + loud abort): allowlist is config-as-data in `allowlist.ts` with per-entry
  rationale; `thinking` + `attachment` excluded, all `tool_use` kept by-policy (forward-safe for
  Grep/Glob/Task), journal `key` folded into `payload`. Malformed/unknown records `throw` LOUD with a
  located message (`Ingest: malformed <transcript|journal> record at <streamId|->:line N — ...`).
- AC4 (redacted fixture): `__fixtures__/` committed; no real `/home/archfelipe/...` paths, no DB
  role names (`vibranto_app`/`vibranto_definer`), no tokens — verified by reading the generated
  snapshot. The real `.sources/story-10-1/*.jsonl` stay gitignored and were never committed.

**Fixture audit:** confirmed the prior-ATDD fixtures are structurally faithful AND public-safe (paths
are `/work/project`, sessionId is `redacted-session-dev`, the journal hash is `phase-dev-OPAQUEHASH-1`,
the thinking signature is `OPAQUE_SIGNATURE_REDACTED` and is dropped by the allowlist so it never
reaches output). No fixture expectation was wrong, so none was changed.

**Documented decisions / deviations:**
1. **Architecture adaptation (as the story already records):** implemented `parse-journal.ts` (the
   real workflow-orchestrator journal) instead of the stale `parse-omc-state.ts` named in
   architecture.md. The `.omc/state/agent-replay` files are stale and irrelevant to Story 10.1.
2. **Schema imports:** only `NormalizedEventSchema` is imported (not `OrderKeySchema`) — the orderKey
   shape is validated transitively through `NormalizedEventSchema.parse`, so importing `OrderKeySchema`
   separately would be an unused import (fails `noUnusedLocals`). No schema change.
3. **Journal provisional `logicalClock` = per-stream index (self-contained).** The Dev Notes sketch a
   richer rule (anchor journal records between dev-max and fix-min wall-clock to bracket phases). That
   anchoring needs the transcript epoch range, but the ATDD-fixed signatures `normalizeJournal(records)`
   and `mergeStreams(streams)` carry no such cross-stream input, and putting journal-specific anchoring
   inside the generic `mergeStreams` would couple it to the `orchestrator` label (a design smell the
   story explicitly avoids by keeping the per-stream stamp in `normalize`). Because the post-merge
   dense-clock rewrite makes the provisional value irrelevant to determinism and totality (both ACs
   satisfied — verified by the snapshot + the strict-ordering test), a pure self-contained per-stream
   index is used. Observable effect in the fixture: the dev-phase journal `started`/`result` currently
   sort just *ahead* of the dev transcript rather than bracketing it. This is harmless for 1.3 (no AC
   or test mandates a specific interleaving) but is flagged as a refinement for Story 1.4/1.5 if phase
   bracketing becomes mechanically meaningful (it would require threading the transcript epoch range
   into the journal stamp via a new, non-ATDD parameter).
4. **Loud-abort `cause` + ES2022 lib slice:** see Debug Log — `{ cause: err }` on the thrown errors
   (satisfies ESLint `preserve-caught-error`) plus a file-local `/// <reference lib="es2022.error" />`
   (satisfies typecheck under the foundation's `lib: ES2020`, without editing shared config).

**Untouched orphans noted (not deleted — out of scope):** `src/ingest/.gitkeep` and
`src/ingest/__fixtures__/.gitkeep` are now redundant (their directories hold real files) but were
created by Story 1.1; per surgical-change discipline they are left in place.

**Review fix round 1 (post Senior Developer Review):** all 7 findings resolved, none refuted (every
finding empirically reproduced). Key corrections vs. the initial dev pass:
- **Deviation #3 reversed (F2):** the journal is no longer self-contained-index-clocked. `normalizeJournal`
  now takes an optional `anchorClock`; the e2e harness computes the dev-phase max epoch and threads it
  in so the journal lifecycle records BRACKET their phase (Dev Notes "orderKey derivation") rather than
  front-loading. The bare `normalizeJournal(records)` signature still works (anchor defaults to 0), so
  the ATDD call is untouched and the function stays pure (the caller, which sees every stream, owns the
  epoch math — no cross-stream coupling inside normalize).
- **R3 hardened (F1/F3):** journal `eventId` is now unique on the merged set (`key#type`), and array-typed
  `tool_result.content` is recursively camelCased (`normalizeResultContent`) so no raw `tool_use_id`/`is_error`
  leaks past `ingest/`. The fixture gained an array-content `tool_result` so the recursive no-leak guard and
  the committed snapshot exercise the real Claude Code shape.
- **AC3 + type-safety (F5/F6):** the journal subtype fallback uses `typeof` guards (no unsound cast); an
  unparseable `timestamp` is rejected at the raw boundary so it aborts with the located `Ingest:` message.
- Post-fix gates: typecheck 0 / lint 0 / test 116 / build 0; `dist/` carries no `anthropic` (R4).

### File List

New (all under `src/ingest/`):
- `src/ingest/parse-transcript.ts` — raw Claude Code transcript parser + raw schemas (R3 boundary).
- `src/ingest/parse-journal.ts` — raw workflow-journal parser + `RawJournalRecordSchema`.
- `src/ingest/normalize.ts` — raw records → camelCase `NormalizedEvent[]`, per stream (allowlist + orderKey stamp).
- `src/ingest/merge.ts` — pure total-order stable merge + dense logicalClock rewrite.
- `src/ingest/allowlist.ts` — documented config-as-data allowlist + `isAllowed` predicate.
- `src/ingest/ingest.test.ts` — on-top e2e + committed determinism snapshot + field-mapping units.
- `src/ingest/__snapshots__/ingest.test.ts.snap` — committed ingest-level determinism snapshot (14 events post-review-fix).

Pre-existing red-phase ATDD files made GREEN (authored in the prior ATDD phase; verified, unchanged):
- `src/ingest/parse-journal.test.ts`, `src/ingest/normalize.test.ts`, `src/ingest/merge.test.ts`,
  `src/ingest/allowlist.test.ts`
- `src/ingest/__fixtures__/sample-journal.jsonl`,
  `src/ingest/__fixtures__/malformed-transcript.jsonl`, `src/ingest/__fixtures__/malformed-journal.jsonl`

Modified in review fix round 1 (the source fixes for F1–F6 + their tests/fixtures):
- `src/ingest/normalize.ts` — F1 (journal `eventId` = `key#type`), F3 (`normalizeResultContent` for
  array `tool_result.content`), F2 (optional `anchorClock` param), F5 (`typeof` subtype guards).
- `src/ingest/parse-transcript.ts` — F6 (`timestamp` refined to a parseable date).
- `src/ingest/__fixtures__/sample-transcript.jsonl` — F4 (array-content `tool_result` added).
- `src/ingest/__snapshots__/ingest.test.ts.snap` — regenerated (journal bracketing + camelCased array content).
- `src/ingest/ingest.test.ts` — merged-set uniqueness (F1), interleaving (F2), array-content no-leak (F3/F4) tests; harness anchors the journal.
- `src/ingest/parse-transcript.test.ts` — F6 located-abort test; record-count expectations updated for the added fixture records.

Modified (workflow bookkeeping only):
- `_bmad-output/implementation-artifacts/1-3-ingest-story-10-1.md` — frontmatter `baseline_commit`,
  Tasks/Subtasks checkboxes (+ Review Follow-ups), Dev Agent Record, File List, Change Log, Status, review resolution.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `1-3: ready-for-dev` → `in-progress` → `review` → `done`.

## Change Log

| Date       | Change                                                                                  |
|------------|-----------------------------------------------------------------------------------------|
| 2026-06-14 | Implemented Story 1.3 ingest pipeline (parse-transcript/parse-journal/normalize/merge/allowlist); made the 5 red-phase ATDD suites GREEN; added e2e + committed determinism snapshot. All gates green (typecheck/lint/test 106/build). Status → review. |
| 2026-06-14 | Senior Developer Review (AI) — Changes Requested: F1 duplicate journal eventId, F3 raw snake_case leak on array `tool_result.content`, F2 journal front-loading, F6 bare-ZodError on bad timestamp, F4 vacuous no-leak test, F5 unsound `as string` cast, F7 doc count drift. |
| 2026-06-14 | Review fix round 1 — resolved all 7 findings (F1/F3/F4 + F2/F5/F6 + F7): journal eventId now `key#type` (unique on merged set); `normalizeResultContent` camelCases array `tool_result.content` (R3); `normalizeJournal` gained optional `anchorClock` so journal brackets its phase; `timestamp` refined to a parseable date → located AC3 abort; array-content fixture added (real no-leak guard); `typeof` guards replace the subtype cast; doc counts corrected. Snapshot regenerated. Gates: typecheck 0 / lint 0 / test 116 / build 0. Status → done. |

## Senior Developer Review (AI)

**Reviewer:** Andres Felipe Grisales (andfeg@gmail.com) — AI-assisted adversarial review (Blind Hunter + Edge/Boundary Hunter + Acceptance Auditor, synthesized & verified).
**Date:** 2026-06-14
**Outcome:** Changes Requested.

### Overall Verdict
Solid pure/deterministic ingest with strong tests, but ships 2 real defects against AC1/AC2 (duplicate eventId in the committed snapshot; raw `tool_use_id`/`is_error` leak when `tool_result.content` is an array) plus one vacuous guard test and minor latent/doc gaps. All findings empirically reproduced.

### AC Coverage Summary
- **AC1** (ingest-only parse + Zod-validated camelCase emission + determinism): **PARTIAL** — determinism + camelCase-only output hold for the fixture, but (a) raw snake_case keys leak into `payload.content` when `tool_result.content` is an array (real Claude Code shape) [F3], and (b) eventId is not unique on the merged set — the committed snapshot already ships a duplicate [F1].
- **AC2** (composite orderKey -> single total order, wall-clock not sole key): **PASS with caveat** — comparator is total, dense-rewrite is correct; but journal events front-load to the head of the timeline instead of bracketing their phase, contrary to the normative Dev Notes "orderKey derivation" [F2].
- **AC3** (documented allowlist + loud located abort): **PASS with gap** — allowlist is config-as-data with rationale; most malformed inputs abort loud with a located message, but a malformed/unparseable `timestamp` escapes as a bare ZodError with no `Ingest:`/stream/line prefix [F6].
- **AC4** (redacted fixture in `__fixtures__/`): **PASS** — fixtures are public-safe; real `.sources/` stays gitignored.

### Findings (verified against `git diff HEAD` + runtime probes)

- **F1 [HIGH, fix]** Duplicate eventId across the merged timeline. `src/ingest/normalize.ts:175` sets journal `eventId = record.key`; `started` + `result` reuse one key, so they collide. Confirmed: committed snapshot `__snapshots__/ingest.test.ts.snap:6` & `:26` both emit `phase-dev-OPAQUEHASH-1`; probe over the fixtures gives 12 events / 11 unique (1 dup). Field-mapping table (story line 238) mandates eventId "must be unique per emitted event". The only uniqueness test (`normalize.test.ts:252`) is transcript-scoped, so it guards nothing here. Layers: Blind Hunter. **Fix:** suffix journal eventId with record type/seq, e.g. `${record.key}#${record.type}`, mirroring the transcript `${uuid}#${itemIndex}` scheme; add a uniqueness assertion over the MERGED set.

- **F3 [HIGH, fix]** Raw snake_case leaks past ingest/ when `tool_result.content` is an array. `src/ingest/normalize.ts:78` does `payload: { content: item.content ?? null }`; the raw schema uses `content: z.unknown()` (`parse-transcript.ts:37`), so an array of raw items validates and is spread verbatim. Probe: a `tool_result` with array content leaks `tool_use_id` + `is_error` (and a nested value) into `payload.content` — an R3/AC1 violation; array content is a common real Claude Code shape. Layers: Edge/Boundary Hunter. **Fix:** when `item.content` is an array, map each element through a camelCase normalizer (or keep only text/string portions); never spread raw content items. Add an array-content `tool_result` to the fixture.

- **F2 [MED, consider]** Journal events front-load instead of bracketing their phase. `normalize.ts:174` sets provisional `logicalClock = seqWithinStream` (0..n) while transcript clocks are `Date.parse` epoch-ms (~1.78e12), so `merge.ts:12` sorts ALL journal events to the very front (probe over dev/fix phases: order = `orchestrator x4, dev x3, fix x3`; fix-phase journal lands at the front, nowhere near the fix phase). Dev Notes "orderKey derivation" (story lines 278-282) NORMATIVELY require the journal provisional clock to "bracket its phase ... anchor it to the surrounding transcript epoch range." Disclosed by dev as deviation #3. Judgment call: AC2's literal text (total order, wall-clock not sole key) is satisfied and no test mandates interleaving, so this is debatable — but the Dev Notes are explicit and the fix is cheap. Layers: Blind Hunter + Edge/Boundary Hunter. **Fix:** thread the dev-max / fix-min epoch into `normalizeJournal` (added optional param is back-compatible with the ATDD `normalizeJournal(records)` call) so journal records anchor at their phase boundary; add an interleaving assertion. If genuinely deferred to 1.4/1.5, make the deferral explicit in AC2 (it currently reads as satisfied).

- **F6 [MED, consider]** Malformed timestamp aborts with a bare ZodError, not the AC3 located message. `normalize.ts:105` `Date.parse(record.timestamp)` returns NaN for an unparseable timestamp; the only catch is `NormalizedEventSchema.parse` (`normalize.ts:140`), which throws a generic ZodError with no `Ingest:`/stream/line context (probe: message does not match `/ingest|line|stream/`). The raw boundary validates `timestamp: z.string()` but never that it is a parseable date, so this malformed class escapes the AC3 located-error contract. Latent for the fixture. Layers: Blind Hunter. **Fix:** refine `RawTranscriptRecordSchema.timestamp` with `!Number.isNaN(Date.parse(v))`, or guard in normalize and throw an `Ingest: ... unparseable timestamp` located message.

- **F4 [LOW, fix]** Recursive no-leak test passes vacuously. `normalize.test.ts:122-136` asserts the fixture's `tool_result` items carry `tool_use_id`/`is_error` so the deep guard is "real, not a tautology", but every `tool_result` in `sample-transcript.jsonl` (lines 3,5,7,9) has STRING content, so `collectKeysDeep` never sees a nested raw key. The guard therefore cannot catch F3. Layers: Edge/Boundary Hunter. **Fix:** add a `tool_result` with array-typed content (carrying nested `tool_use_id`/`is_error`) to the fixture so both the recursive no-leak assertion and the determinism snapshot exercise the real shape — this turns the vacuous guard into a real one and surfaces F3.

- **F5 [LOW, consider]** Unsound `as string` cast in the journal subtype fallback. `normalize.ts:168-171`: `(result.status as string | undefined) ?? (result.verdict as string)` only falls back to verdict when status is null/undefined; a non-string truthy status (e.g. number) is kept, making `subtype` a non-string that throws a bare ZodError on emission (probe `{status:5, verdict:'pass'}` -> ZodError). Intended behavior is status-when-string, ELSE verdict. Latent (this session's status/verdict are all strings). Layers: Blind Hunter + Acceptance Auditor. **Fix:** `const subtype = typeof result?.status === 'string' ? result.status : typeof result?.verdict === 'string' ? result.verdict : null;`

- **F7 [LOW, fix]** Story doc understates the final test count. Task 9 / Debug Log / Change Log (story lines 159, 418, 511) state "106" tests; `vitest run` actually reports **15 files / 112 tests** passing (verified). Cosmetic drift, no functional impact. Layers: Acceptance Auditor. **Fix:** update the `106` references to `112` (or drop the hardcoded count).

### Notes
- Pure/deterministic design (R2), the documented config-as-data allowlist (AC3/NFR-4), the total comparator with dense-clock rewrite (AC2), and the loud-abort located messages for malformed JSON / unknown record types (AC3) are all sound and well-tested.
- Status NOT changed and nothing committed, per review protocol. Findings marked fix/consider are auto-fixable; none were refuted.

### Review Resolution (AI) — fix round 1 (2026-06-14)

All seven findings RESOLVED (none refuted — every finding empirically held). See "Review
Follow-ups (AI)" under Tasks/Subtasks for the per-finding fix + proving test.

| Finding | Severity | Action | Resolution |
|---|---|---|---|
| F1 | HIGH | fixed | Journal `eventId` suffixed with record type; merged-set uniqueness test added; snapshot regenerated. |
| F3 | HIGH | fixed | `normalizeResultContent` camelCases array-typed `tool_result.content`; no raw key leaks (R3). |
| F2 | MED | fixed | Optional `anchorClock` threads the dev-phase epoch into `normalizeJournal`; journal now brackets its phase; interleaving test added. |
| F6 | MED | fixed | `timestamp` refined to a parseable date → loud located AC3 abort; proving test added. |
| F4 | LOW | fixed | Array-content `tool_result` added to the fixture; recursive no-leak guard now real. |
| F5 | LOW | fixed | `as string` cast replaced with `typeof` guards in the journal subtype fallback. |
| F7 | LOW | fixed | Doc test counts corrected (106 → 112 initial, 116 post-fix). |

Gates after fixes: `pnpm typecheck` exit 0 · `pnpm lint` exit 0 · `pnpm test` 15 files / 116
passing · `pnpm build` exit 0, `dist/` carries no `anthropic` reference (R4). Outcome: **Approved**
(all Changes-Requested items resolved). Nothing committed (operator commits between stories).
