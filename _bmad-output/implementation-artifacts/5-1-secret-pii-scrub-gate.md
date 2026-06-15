---
baseline_commit: 6025447c983ad2361f093139e5ceac17acd703d0
---

# Story 5.1: Secret/PII scrub pass + manual review gate

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the builder,
I want a config-driven redaction pass over the ingested Session that emits a manual-review report, plus a publish gate that refuses to ship an unscrubbed-or-unreviewed bundle,
so that no secrets/credentials/PII ever reach the PUBLIC ReplayBundle (the privacy guardrail — the fantasy/narration layers are NOT assumed to redact).

## Acceptance Criteria

**AC1 (gate-verifiable) — scrub + report**
**Given** the scrub logic running over a `NormalizedEvent[]` Session (driven by `scripts/scrub.ts` offline; logic lives in `src/scrub/`)
**When** it runs over a fixture containing PLANTED secrets (API keys/tokens, `Bearer` headers, credentials, PII emails, absolute home paths `/home/<user>/...`, DB role names)
**Then** every planted pattern is redacted from the emitted SCRUBBED Session copy, AND a manual-review report lists what was redacted **by category + count** and what needs human eyes (suspicious-but-unmatched candidates) — with **NO secret value** ever appearing in the report or in any error message.

**AC2 (gate-verifiable) — publish gate**
**Given** the publish-gate predicate (the contract Story 5.2's bundle build wires)
**When** a bundle is checked for publishability
**Then** the gate **BLOCKS** when the scrub pass has not run (or its input no longer matches the scrubbed output) OR when no explicit manual-review approval marker is present, and **PASSES** only when BOTH a completed scrub AND a valid approval marker exist — refusing to emit an unscrubbed-or-unreviewed bundle.

**AC3 (gate-verifiable) — config-as-data, purity, isolation**
**Given** the deny-pattern set
**When** the scrub runs
**Then** the patterns are loaded from a versioned `src/config/scrub-patterns.json` via a `.strict()` Zod loader (config-as-data, NFR-4 — no hardcoded patterns in logic), the scrub is PURE/deterministic (same input → same scrubbed output + same report; no `Date.now()`/`Math.random()`/network), and the scrub logic is SDK-free (R4) — proven by a source-grep guard (the `scribe/r1-discipline.test.ts` precedent).

**Operator step (NOT gate-automatable):** a human actually READS the report and creates the approval marker before publishing. The gate only enforces that a valid marker EXISTS — it cannot prove a human read it. The real scrub over the FULL `.sources/story-10-1/*` session is a DEFERRED operator step (the `.sources/` are git-ignored; see Dev Notes "Data-source reality").

## Tasks / Subtasks

- [x] **Task 1 — `src/config/scrub-patterns.json` + `.strict()` loader (AC3)** *(config-as-data, NFR-4)*
  - [x] Author `src/config/scrub-patterns.json`: a versioned, ordered list of deny patterns, each `{ id, category, pattern, flags?, description }` where `category ∈ {secret, token, credential, pii-email, home-path, db-role}` (a string-literal union) and `pattern` is a string compiled to a `RegExp`. Cover at minimum: generic high-entropy secrets, API keys/tokens (`sk-…`, `Bearer …`), credentials (`password=`/`PASSWORD`/connection-string creds), PII emails (RFC-lite email regex), absolute home paths (`/home/<user>/…`, `/Users/<user>/…`, `C:\Users\<user>\…`), DB role names (a configurable allowlist of role identifiers, e.g. `postgres`, `app_rw`). Carry a `$schemaVersion: 1`.
  - [x] Author `src/scrub/scrub-patterns.ts`: a `.strict()` Zod schema (`ScrubPatternsSchema`) + `export const SCRUB_PATTERNS = ScrubPatternsSchema.parse(rawScrubPatterns)` — validates at module load (fail-closed), mirroring `portal/teaching-config.ts` / `scribe/captions-config.ts` / `model/model-tuning.ts` VERBATIM in structure. Compile each `pattern` string to a `RegExp` here (validate it compiles; a bad regex fails LOUD at load). Export a `ScrubCategory` string-literal union type.
  - [x] Add `src/scrub/scrub-patterns.unit.test.ts`: loader fail-closed guards (missing key / typo'd field / bad regex / over-broad empty pattern / bumped `$schemaVersion` each throw) — the `teaching-config.unit.test.ts` precedent. *(ATDD-authored; now GREEN, 10 tests.)*

- [x] **Task 2 — `src/scrub/scrub.ts` — the PURE redactor + report (AC1, AC3)**
  - [x] `export function scrubSession(events: NormalizedEvent[], patterns = SCRUB_PATTERNS): ScrubResult` — PURE/deterministic. Walks every event's redaction-relevant fields (the `payload` open record's string leaves — recursively — plus `toolName`/`subtype`; `eventId`/`orderKey`/`timestamp`/numeric/boolean fields are structural and NOT scrubbed). For each string leaf, apply each deny pattern in config order, replacing every match with a fixed redaction token `«REDACTED:{category}»` (token carries the CATEGORY, never the matched text). Return `{ scrubbedEvents, report, scrubHash }`.
  - [x] `ScrubResult.report: ScrubReport` shape (see Dev Notes "Report shape — no value leakage"): `{ $reportVersion: 1, redactions: Array<{ category, count }> (counts aggregated per category), locations: Array<{ eventId, jsonPath, category }> (WHERE each redaction happened, NO value), candidates: Array<{ eventId, jsonPath, reason }> (suspicious-but-UNMATCHED — e.g. a long high-entropy token that no deny pattern caught — flagged for human eyes, NO value), patternSetVersion, scrubHash }`. CRITICAL: assert in tests that no field of the report (and no thrown error) contains any planted secret substring.
  - [x] `scrubHash = sha256(canonicalJSON(scrubbedEvents) + patternSetVersion)` — REUSE `canonicalJSON` from `src/interpret/freeze.ts` (do NOT author a second canonical-JSON serializer; it is the documented one). This content-addresses the scrubbed output so the gate (Task 3) can detect a post-scrub mutation. `node:crypto` only — SDK-free, pure.
  - [x] Suspicious-candidate heuristic: a conservative high-entropy / long-opaque-token detector over string leaves that did NOT match a deny pattern (e.g. ≥20 chars, mixed alnum, no whitespace) → a `candidate` (the "what needs human eyes" half of AC1). Keep it simple — it is a hint for the operator, not a second redactor.
  - [x] Add `src/scrub/scrub.test.ts` (AC1): drive against a PLANTED-secret fixture (Task 5). Assert: each planted pattern category is redacted from `scrubbedEvents`; the report `redactions` lists each category with the right count; `locations` point at the right `eventId`/`jsonPath`; a planted-but-unmatched opaque token shows up as a `candidate`; **NO planted secret value appears anywhere in `scrubbedEvents`'s string leaves NOR in the report** (the load-bearing privacy assertion — iterate the serialized report + scrubbed events and assert `.not.toContain(plantedValue)` for each planted secret); determinism (call twice → `toEqual`). *(ATDD-authored; now GREEN, 12 tests.)*

- [x] **Task 3 — `src/scrub/gate.ts` — the PURE publish gate + approval-marker contract (AC2)**
  - [x] Define the approval-marker contract (the Story-5.2 seam): `interface ScrubApproval { $markerVersion: 1; scrubHash: string; approvedBy: string; approvedAt: string; reportHash: string }`. The marker binds an approval to a SPECIFIC scrubbed output (`scrubHash`) and a SPECIFIC report (`reportHash = sha256(canonicalJSON(report))`) so an approval cannot be reused after the session/patterns change. Add `ScrubApprovalSchema` (`.strict()` Zod). NOTE: `approvedAt`/`approvedBy` are DATA recorded by the operator step, not computed by the pure gate (so the gate stays clock-free).
  - [x] `export function isPublishable(args: { scrubResult: ScrubResult; approval: ScrubApproval | null }): GateDecision` where `GateDecision = { ok: boolean; reasons: string[] }`. PURE. Returns `ok:false` with reasons when: `approval === null` (unreviewed); `approval.scrubHash !== scrubResult.scrubHash` (approval is for a DIFFERENT scrub — stale/mismatched); `approval.reportHash !== sha256(canonicalJSON(scrubResult.report))` (report tampered/changed since approval); the schema is invalid. Returns `ok:true` only when a scrub result is present AND a schema-valid approval matches BOTH hashes. The reasons strings must NOT leak secrets (they reference hashes/ids only).
  - [x] Document the contract in a top-of-file comment as the Story-5.2 wiring point: 5.2's `build-bundle.ts` MUST call `scrubSession` then `isPublishable` and ABORT the bundle write when `!ok`. This story DEFINES + tests the predicate; 5.2 WIRES it into the orchestration.
  - [x] Add `src/scrub/gate.test.ts` (AC2): BLOCKS with `null` approval; BLOCKS with an approval whose `scrubHash` mismatches; BLOCKS with a tampered report (mutate report → `reportHash` mismatch); BLOCKS on a schema-invalid marker; PASSES with a matching valid approval over a real scrubbed fixture. Assert reasons carry no secret value. *(ATDD-authored; now GREEN, 9 tests.)*

- [x] **Task 4 — `scripts/scrub.ts` — the THIN offline glue (AC1 driver)** *(untested; mirrors `scripts/interpret.ts` + `scripts/scribe-saga.ts`)*
  - [x] Thin argv/fs/stdout glue ONLY (no logic worth a unit test — vitest `include` is `src/**/*.test.ts`, so logic MUST live in `src/scrub/`, the 3.2 precedent). Usage: `jiti scripts/scrub.ts --transcript <path> --journal <path> --stream-id <id> --out-scrubbed <path> --out-report <path> [--patterns <path>]`.
  - [x] Anti-corruption (R3): REUSE the EXACT ingest chain from `scripts/interpret.ts`/`scripts/scribe-saga.ts` (`parseTranscript`/`parseJournal` → `normalizeTranscript`/`normalizeJournal` → `mergeStreams`) to get the validated `NormalizedEvent[]`. Do NOT add a second raw-JSONL parser.
  - [x] Call `scrubSession(events)` → write `scrubbedEvents` to `--out-scrubbed` and `report` to `--out-report` (JSON, 2-space, trailing newline — the `scripts/scribe-saga.ts` form). Print to stdout: per-category redaction counts + candidate count + the `scrubHash` + a CLEAR operator instruction ("review {out-report}, then create an approval marker bound to scrubHash {hash} before publishing"). NEVER print a secret value. Run-only-when-invoked-directly guard (`process.argv[1] === fileURLToPath(import.meta.url)`).
  - [x] Add a `package.json` script `"scrub:story-10-1"` pointing at the COMMITTED fixtures (the `interpret:story-10-1` precedent) — the dev-runnable smoke. NOTE: the committed hand-redacted fixture carries NO secrets, so this smoke emits an (expected) near-empty report — it proves the CLI WIRING runs, not redaction; redaction is proven by `scrub.test.ts` against the planted fixture (Task 5), and the real `.sources/story-10-1/*` run is the deferred operator step. Do NOT add the script to `test`/`build`/CI.

- [x] **Task 5 — Planted-secret fixture (AC1/AC2 test input)**
  - [x] Add `src/scrub/__fixtures__/planted-secrets.ts` (or `.jsonl` parsed via the ingest chain): a small `NormalizedEvent[]` (Zod-valid) whose `payload` string leaves carry one OBVIOUSLY-FAKE planted value per category (e.g. `sk-FAKE0000000000000000`, `Bearer FAKEtoken…`, `password=FAKEpw123`, `dev@example.invalid`, `/home/fakeuser/secret/key`, DB role `app_rw`) PLUS one suspicious-but-unmatched opaque token for the `candidate` path. Keep values clearly synthetic ("FAKE"/`.invalid`) so the fixture itself ships no real secret. Co-locate under `src/scrub/__fixtures__/` (the `src/**/__fixtures__/` convention). *(ATDD-authored; consumed by the now-GREEN scrub.test.ts + gate.test.ts.)*

- [x] **Task 6 — R4/R5 SDK-free source-grep guard (AC3)** *(the `scribe/r1-discipline.test.ts` precedent)*
  - [x] Add `src/scrub/r4-isolation.test.ts`: assert each `src/scrub/` MODULE (`scrub.ts`, `scrub-patterns.ts`, `gate.ts`) source contains zero `@anthropic-ai/sdk` references AND zero `phaser` references. `src/scrub/` has NO eslint zone, so this source-grep is the REAL R4/R5 guard for the new dir (lint's global anthropic + phaser bans also hold; `src/config/*.json` is data). Do NOT touch `eslint.config.ts`. *(ATDD-authored; now GREEN, 6 tests.)*

- [x] **Task 7 — Gates green (all ACs)**
  - [x] `pnpm typecheck` clean; `pnpm lint` clean (R1/R4/R5 hold, `eslint.config.ts` UNCHANGED); `pnpm test` green (new `src/scrub/*` suites added on top of the baseline 83 files); `pnpm build` OK and `grep -ril anthropic dist/` returns NOTHING (scrub + config are SDK-free; `src/scrub/` is browser-UNREACHABLE — never imported by `main.ts`/`game/`/`render/` — so it is tree-shaken regardless); BOTH golden snapshots (`pace/` + `ingest/`) byte-stable (this story adds NO Layer-0 code).

### Review Follow-ups (AI)

Senior Developer Review fix round 1 (2026-06-15) — addressed every finding marked fix/consider; confirmed
and recorded the two likely-refutes. Gates re-run GREEN (typecheck/lint clean, 87 files / 887 tests, build
OK + no anthropic in dist, pace/ingest golden snapshots byte-stable). No git commit.

- [x] **[MED] R1 (fix)** — `src/scrub/scrub.ts`: replaced the `redactions` `localeCompare` sort with a
  codepoint sort (`a<b?-1:a>b?1:0`), matching canonicalJSON's key sort so `reportHash` is host-independent.
  No observable change for the 6 ASCII categories; closes the cross-host approval-BLOCK footgun.
- [x] **[MED] R2 (consider→fixed)** — `src/scrub/gate.ts`: added `scrubHashOf(scrubResult)` and a fail-closed
  self-validation FIRST in `isPublishable` — recomputes scrubHash from `scrubbedEvents + report.patternSetVersion`
  and BLOCKS if it disagrees with the supplied `scrubHash` field, so a caller that hand-mutates `scrubbedEvents`
  while reusing the stale field is caught before the approval is trusted. Tests: gate.test.ts mutation-block + no-leak.
- [x] **[LOW] R3 (consider→addressed)** — `src/config/scrub-patterns.json`: did NOT tighten `password=\S+`
  (verified that tightening to `[^\s@/]+` LEAKS the `@host:port/db` tail on the shared fixture, because
  `password-assignment` runs before `connection-string-credential` and eats the boundary the conn-str pattern
  needs — the wrong direction for a privacy guard). Instead documented the greedy fall-back as intentional
  fail-safe over-redaction AND added a password-literal-free conn-string fixture (`PLANTED_CONN_STRING`) +
  test so `connection-string-credential` (line 31) is now exercised (the previously-dead pattern).
- [x] **[LOW] R4 (consider→documented)** — `src/config/scrub-patterns.json`: documented the `db-role`
  whole-word matchers as intentionally aggressive fail-safe operator-review noise; did NOT narrow them to a
  `role=`/`://` neighborhood, which would risk UNDER-redacting a real role (a privacy regression). Manual
  review (AC1) resolves the benign-prose noise.
- [x] **[LOW] R5 (consider→fixed)** — `src/config/scrub-patterns.json`: extended the home-path patterns to
  consume the path tail (`/home/[^\s"']+`, and the macOS/Windows siblings) so `.ssh/id_rsa`-style residual
  signal is also redacted (strictly more private, the fail-safe direction). Test: scrub.test.ts home-tail.
- [x] **[LOW] R6 (consider→fixed)** — `src/scrub/scrub.ts`: dropped `Object.keys(source).sort()` in
  `walkValue` so scrubbed output preserves input key order (a surgical redaction must not reorder structure);
  scrubHash stays stable because canonicalJSON re-sorts keys for the hash and locations/candidates key on
  jsonPath+eventId. Golden inline snapshot updated to reflect input-order keys + the R5 tail-consumption.
- [x] **[LOW] R7 (fix)** — Dev Agent Record counts corrected: 41 scrub tests / 883 total at review time
  (was 37/879); 45 scrub / 887 total after this round's +4 follow-up tests.
- [ ] **[LOW] R8 (likely-refute → REFUTED, no change)** — the dead `«REDACTED:` guard at scrub.ts:154 is
  confirmed unreachable (`«` is outside the OPAQUE_TOKEN char class so a captured token never starts with it;
  `REDACTED:category` is 14 chars and fails the ≥20-length+mixed-alnum gate) but HARMLESS — zero behavior
  impact. Left in place per the surgical-pass instruction; not worth a change.
- [ ] **[LOW] R9 (likely-refute → REFUTED, no change)** — the gate throwing on a malformed `scrubResult.report`
  is WITHIN the documented contract: the never-throw guarantee covers a bad MARKER only, and the sole
  sanctioned producer (`scrubSession`) always yields a valid report. R2's self-validation is the proportionate
  hardening on the result object; no separate fix needed (and R2 reads `report.patternSetVersion`, so a
  malformed report fails the same documented producer-contract way).

## Dev Notes

### Scope (decisive — read before coding)

This story builds the **privacy guardrail**: a config-driven secret/PII scrub + the **publish gate** that Story 5.2's bundle build will enforce. It is the FIRST source story in Epic 5 (Showcase Delivery). It does NOT build the bundle (5.2), the final art (5.3), or the deploy (5.4).

**What ships here (all NEW, additive — no existing source edited):**
- `src/config/scrub-patterns.json` — versioned deny-pattern set (config-as-data, NFR-4).
- `src/scrub/scrub-patterns.ts` — `.strict()` Zod loader (compiles patterns to RegExp; fail-closed at load).
- `src/scrub/scrub.ts` — PURE `scrubSession(events) → { scrubbedEvents, report, scrubHash }` (the gate-tested redaction + report logic).
- `src/scrub/gate.ts` — PURE `isPublishable(...)` predicate + the `ScrubApproval` marker contract (the Story-5.2 seam).
- `scripts/scrub.ts` — THIN offline argv/fs glue (untested; mirrors `interpret.ts`/`scribe-saga.ts`).
- `src/scrub/__fixtures__/planted-secrets.*` + co-located `*.test.ts` + `r4-isolation.test.ts`.
- `package.json` `"scrub:story-10-1"` script.

**Why a NEW `src/scrub/` directory (the load-bearing module-home decision):** the architecture lists `scripts/scrub.ts` (architecture.md#FR→Structure "Privacy guardrail: `scripts/scrub.ts`") but vitest only runs `src/**/*.test.ts` (`vitest.config.ts:14`). The Story 3.2 precedent split the LLM work into thin untested `scripts/interpret.ts` glue + the testable `src/interpret/{claude-interpreter,freeze}.ts` logic so `pnpm test` covers it. We MIRROR that: the testable scrub logic lives under `src/scrub/`; `scripts/scrub.ts` is glue. `src/scrub/` is its own layer-neutral dir (the scrub is neither Layer-0 mechanics nor Layer-1/2 narration — it is a build-time privacy stage over the Session). It has NO eslint import-zone; the SDK-free + phaser-free source-grep (`r4-isolation.test.ts`, the `scribe/r1-discipline.test.ts` posture) is the real R4/R5 guard. Do NOT add a zone to `eslint.config.ts` — the global anthropic/phaser bans already cover it and the grep pins it.

### Data-source reality (CRITICAL — what the gate proves vs the deferred operator step)

- The FULL real Story 10.1 session is `.sources/story-10-1/{dev,fix,journal}.jsonl` (810 lines) but `.sources/` is **git-ignored** (`.gitignore:44`). It is NOT committed and NOT available in CI.
- The COMMITTED fixture (`src/ingest/__fixtures__/sample-*.jsonl`, Story 1.3) is the hand-redacted THIN slice (14 events; e.g. `file_path` already `/work/project/...`, not a real `/home/<user>/...`). It carries NO planted secrets — it was redacted by hand.
- Therefore the GATE is proven against a NEW **planted-secret fixture** (Task 5): synthetic-but-shaped secrets that exercise every category + the candidate path. This is the 3.2/3.4 honest-gap posture: the systematic scrub over the real `.sources` session (which DOES carry real secrets/home-paths/etc.) is the **deferred operator step**, run via `scripts/scrub.ts` against `.sources/...` before publishing — exactly parallel to the deferred real LLM bake (`scripts/interpret.ts`, `scripts/scribe-saga.ts`). The gate guarantees that an unscrubbed-or-unreviewed bundle CANNOT be published; it does not (and cannot) prove the operator actually ran the real scrub — that is what the manual review + approval marker enforce procedurally.

### Report shape — NO value leakage (resolved on documented merits)

The report must list **what was redacted and what needs human eyes** (AC1) WITHOUT becoming a secret-exfiltration vector (the whole point is privacy). Decision:
- `redactions: Array<{ category, count }>` — aggregate counts per category (the "what was redacted" summary). NO values.
- `locations: Array<{ eventId, jsonPath, category }>` — WHERE each redaction happened (so a human can audit the scrubbed event), keyed by `eventId` + a `jsonPath` into the payload. NO values, NO surrounding context that could reveal the secret.
- `candidates: Array<{ eventId, jsonPath, reason }>` — suspicious-but-UNMATCHED string leaves (the "what needs human eyes" half: a high-entropy/opaque token no deny pattern caught). NO value — just the location + WHY it looked suspicious (e.g. `"opaque-token-len-44"`).
- The redaction token in `scrubbedEvents` is `«REDACTED:{category}»` — carries the category for auditability, never the matched text.
- **The load-bearing test invariant:** serialize the entire report + the scrubbed events and assert each planted secret value is `.not.toContain`'d. A report that listed values would FAIL this gate. Error messages likewise must reference ids/hashes only, never the matched substring (the `freeze.ts` "dangling ref" error names the ref id, not a value — same posture).

Rationale: a public-facing privacy artifact that printed the secrets it found would defeat itself; counts + locations give the operator everything needed to audit without re-leaking. This is the conservative, defensible shape.

### Gate / approval-marker contract (resolved — the Story-5.2 seam)

- The gate is a PURE predicate `isPublishable({ scrubResult, approval }) → { ok, reasons }`. It does NOT read files, NO clock, NO network — Story 5.2's `build-bundle.ts` does the fs/orchestration and CALLS this predicate, aborting the write when `!ok`.
- The approval marker `ScrubApproval { $markerVersion, scrubHash, reportHash, approvedBy, approvedAt }` binds an approval to a SPECIFIC scrubbed output + report via content-address hashes. This closes the "approve once, change the session, ship unreviewed" hole: if the session or pattern set changes, `scrubHash`/`reportHash` change and the old marker no longer matches → gate BLOCKS. `approvedBy`/`approvedAt` are operator-recorded DATA (not gate-computed), keeping the predicate clock-free/deterministic.
- `scrubHash = sha256(canonicalJSON(scrubbedEvents) + patternSetVersion)`; `reportHash = sha256(canonicalJSON(report))`. REUSE `canonicalJSON` from `src/interpret/freeze.ts` (architecture.md mandates ONE canonical-JSON serializer; `freeze.ts` is it — do NOT write a second). `node:crypto` only.
- The ReplayBundle schema is NOT edited in this story. `src/schema/replay-bundle.ts` has no scrub/approval field today; ADDING bundle fields is Story 5.2's job when it wires the gate (mirroring how `TuningConfigSchema` is a deliberate forward-reference in that file). This story DEFINES the contract types in `src/scrub/gate.ts`; 5.2 decides whether/how the marker is persisted alongside the bundle. Document this seam in the gate file's header.

### Purity & determinism (R2-adjacent; AC3)

- `src/scrub/` is NOT a Layer-0 dir (R2 names `ingest/translate/pace/model`), but the scrub MUST be deterministic for the content-address gate to work: same `NormalizedEvent[]` + same pattern set → byte-identical `scrubbedEvents`, `report`, and `scrubHash`. FORBIDDEN in `src/scrub/`: `Date.now()`, `Math.random()`, `performance.now()`, network, file I/O, global mutable state. The fs read/write is the thin `scripts/scrub.ts` glue ONLY. Regex application is order-stable (iterate config patterns in array order). `node:crypto` (sha256) is deterministic and allowed (the `freeze.ts` precedent).
- `RegExp` caution: compile patterns ONCE at load (in `scrub-patterns.ts`); when reusing a `/g` regex across strings, reset `lastIndex` or construct fresh per-leaf — a stateful `/g` regex shared across `.test()`/`.exec()` calls is a classic determinism footgun. Prefer `String.prototype.replace(regex, token)` (stateless w.r.t. the call) over manual `exec` loops.

### R4 / browser-unreachability (AC3, gate Task 7)

- `@anthropic-ai/sdk` is NOT imported anywhere in `src/scrub/` or `scripts/scrub.ts` (the scrub is pattern-based, NO LLM). `src/scrub/` is browser-UNREACHABLE — nothing in `main.ts`/`game/`/`render/` imports it (it is a build-time stage). So it is tree-shaken from `dist/` regardless; `grep -ril anthropic dist/` stays empty. The `r4-isolation.test.ts` source-grep is the explicit guard since `src/scrub/` has no eslint zone.
- Do NOT import `scrub.ts`/`gate.ts` from any browser-reachable module. If a browser-side bundle-validation ever wants the gate, that is a Story-5.2 decision — not this story.

### Project Structure Notes

- New dir `src/scrub/` (NEW; no eslint zone — global bans + source-grep guard cover R4/R5). New config `src/config/scrub-patterns.json` (the `src/config/*.json` config-as-data convention; loaded by `src/scrub/scrub-patterns.ts`, the `teaching-config.ts`/`captions-config.ts`/`model-tuning.ts` `.strict()` loader pattern).
- `scripts/scrub.ts` already enumerated in architecture.md#Complete-Directory-Structure (L325) and FR→Structure "Privacy guardrail" (L379) — this story fills it in as thin glue.
- Conventions honored: kebab-case files; types PascalCase; Zod `export const XxxSchema` + inferred type; string-literal unions for `ScrubCategory` (NO numeric enums); internal JSON camelCase; explicit `null` (`approval: ScrubApproval | null`); config-as-data (no hardcoded patterns in logic); fail-LOUD at build/load (bad config throws on import; the gate fails CLOSED — `ok:false` — on any mismatch). NO git commit (operator commits between stories).
- No conflicts with the unified structure. The only variance from a literal reading of architecture.md (which names just `scripts/scrub.ts`) is the testable-logic split into `src/scrub/` — justified by the vitest include scope + the Story 3.2 precedent (documented above under "Why a NEW `src/scrub/` directory").

### Previous story intelligence (4-4, and the Epic 3/4 deferred-bake pattern)

- `4-4-transparency-portal.md` (Epic 4 capstone, done): established the `src/portal/` `.strict()` config loader + a PURE core + a source-grep discipline test in a non-zoned dir (`portal/r1-discipline.test.ts`). MIRROR that posture for `src/scrub/`.
- Story 3.2 (`scripts/interpret.ts` + `src/interpret/freeze.ts`): the canonical thin-script/testable-logic split + `canonicalJSON`/sha256 content-addressing this story reuses. Story 4.2 (`scripts/scribe-saga.ts`): the thin-CLI shape (argv flags, `requireFlag`, run-only-when-invoked guard, billed-call stderr notice) — scrub's CLI mirrors it minus the SDK/billing notice (scrub has NO LLM call).
- Recurring deferred-operator pattern (3.2, 4.2): the single real LLM bake is a deferred operator step, gate-tested against a mock/fixture. Story 5.1 follows it EXACTLY: the real scrub over `.sources/` (which holds real secrets) is deferred; the gate is proven against a planted-secret fixture.
- Sprint-status discipline: `5-1` flips `backlog → ready-for-dev` (this create-story step); `epic-5` stays `in-progress` (already in-progress; 5-1 is the first epic-5 story so no epic flip is triggered). NO git commit — the operator commits between stories.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-5.1] — the two Given/When/Then ACs verbatim (scrub+report; publish gate).
- [Source: _bmad-output/planning-artifacts/architecture.md#Privacy & Security L176-179] — "Pre-publish secret scrub … config-driven deny patterns for secrets/tokens/PII + a manual review gate before publishing."
- [Source: _bmad-output/planning-artifacts/architecture.md#FR→Structure L379] — "Privacy guardrail: `scripts/scrub.ts`"; [#Complete-Directory-Structure L325] — `scrub.ts` "secret/PII redaction pass + manual-review report".
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation-Patterns R2 L229-232] — purity (no clock/RNG/IO); [R4 L236-238] — `@anthropic-ai/sdk` offline-only, never browser-reachable; [#Format-Patterns L264-266] — sha256 over canonical JSON; [Structure L254-258] — config-as-data in `src/config/*.json`.
- [Source: src/interpret/freeze.ts] — `canonicalJSON` (REUSE) + `annotationHash`/`freezeAnnotations` (the pure content-address + fail-loud-on-bad-ref precedent for the scrubHash/gate).
- [Source: src/schema/normalized-event.ts] — `NormalizedEvent` (the scrub input; `payload: z.record(string, unknown).nullable()` is where string-leaf secrets live; `toolName`/`subtype` nullable strings).
- [Source: src/schema/replay-bundle.ts] — the bundle (NOT edited here; `TuningConfigSchema` is the documented forward-reference precedent for adding fields in a later story).
- [Source: src/portal/teaching-config.ts | src/scribe/captions-config.ts | src/model/model-tuning.ts] — the `.strict()` Zod config-loader pattern to mirror.
- [Source: src/scribe/r1-discipline.test.ts | src/interpret/r4-isolation.test.ts] — the SDK-free/phaser-free source-grep guard for a non-zoned dir.
- [Source: scripts/interpret.ts | scripts/scribe-saga.ts] — the thin offline CLI glue shape (argv/fs, run-only-when-invoked guard) + the SHARED ingest chain (R3) to reuse.
- [Source: vitest.config.ts:14] — `include: ['src/**/*.test.ts']` (why logic lives in `src/scrub/`, not `scripts/`).
- [Source: .gitignore:44] — `.sources/` git-ignored (data-source reality: the real session is the deferred operator step).
- [Source: _bmad-output/implementation-artifacts/4-4-transparency-portal.md] — previous story (Epic 4 capstone) patterns.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (BMAD dev-story workflow)

### Debug Log References

- `pnpm test src/scrub/scrub-patterns.unit.test.ts` → 10 passed (Task 1 loader fail-closed guards GREEN).
- `pnpm test src/scrub/scrub.test.ts` → 12 passed (Task 2 redactor + report + no-leak + determinism GREEN).
- `pnpm test src/scrub/gate.test.ts` → 9 passed (Task 3 publish-gate BLOCK/PASS + schema + no-leak GREEN).
- `pnpm test src/scrub/r4-isolation.test.ts` → 6 passed (Task 6 SDK-free + phaser-free source-grep GREEN).
- `jiti scripts/scrub.ts …` smoke over the committed hand-redacted fixture (14 events) → 0 redactions
  (expected — the committed slice carries no secrets), 2 opaque-token candidates flagged, scrubHash printed,
  operator instruction printed, NO secret value printed. Proves the CLI WIRING (Task 4), not redaction.
- Full suite: 87 files / 883 tests passed (baseline 83/842 + the four scrub suites: 41 tests).
  Review fix round 1 (2026-06-15): scrub suites grew to 45 (added R3 conn-string + R5 home-tail in
  scrub.test.ts, R2 mutation-block + no-leak in gate.test.ts); full suite now 87 files / 887 tests.

### Completion Notes List

- All four ATDD red-phase suites (`scrub-patterns.unit.test.ts`, `scrub.test.ts`, `gate.test.ts`,
  `r4-isolation.test.ts`) made GREEN HONESTLY by implementing the feature — none deleted, skipped, weakened,
  or modified. No ATDD assertion needed a justified test-fix (every expectation matched the spec as written).
- AC1 (scrub + report): `src/scrub/scrub.ts` `scrubSession` redacts every planted category
  (token via `sk-`/`Bearer`, credential via `password=` + connection-string `user:pass@`, pii-email,
  home-path, db-role) with a category-carrying `«REDACTED:{category}»` token; the report lists redactions
  by category+count, locations (eventId + jsonPath, NO value), and candidates (opaque-token-len hints, NO
  value). The load-bearing privacy invariant is proven: no planted value appears in `scrubbedEvents` (the
  candidate is the deliberate exception — flagged, not redacted) nor anywhere in the serialized report.
- AC2 (publish gate): `src/scrub/gate.ts` `isPublishable` is a PURE, clock-free, fail-closed predicate that
  BLOCKS on a null/schema-invalid marker or a scrubHash/reportHash mismatch and PASSES only on a schema-valid
  `ScrubApproval` bound to BOTH hashes. The Story-5.2 wiring seam is documented in the file header (5.2's
  build-bundle.ts MUST call `scrubSession` then `isPublishable` and ABORT on `!ok`). Reasons carry no secret.
- AC3 (config-as-data / purity / isolation): the deny set is `src/config/scrub-patterns.json` loaded via the
  `.strict()` `ScrubPatternsSchema` (mirrors teaching-config/captions-config/model-tuning VERBATIM; a bad
  regex / empty pattern / typo'd key / unknown category / bumped `$schemaVersion` each fail LOUD at module
  load). The scrub is PURE/deterministic (same input → identical scrubbedEvents/report/scrubHash; fresh regex
  per leaf avoids the `/g` lastIndex footgun; canonicalJSON REUSED from interpret/freeze.ts — no second
  serializer). SDK-free + phaser-free, pinned by the `r4-isolation.test.ts` source-grep.
- Gates: `pnpm typecheck` clean; `pnpm lint` clean (`eslint.config.ts` UNCHANGED — R1/R4/R5 hold; `src/scrub/`
  has no eslint zone, the global anthropic+phaser bans + the source-grep cover it); `pnpm test` 87/883 green
  (review fix round 1: 87/887 after the +4 follow-up tests);
  `pnpm build` OK and `grep -ril anthropic dist/` returns NOTHING (`src/scrub/` is browser-unreachable →
  tree-shaken; the `«REDACTED:` token is absent from dist, confirming the tree-shake). BOTH golden snapshots
  (`pace/` + `ingest/`) byte-stable (no Layer-0 code added). NO git commit (operator commits between stories).
- Deferred operator step (NOT gate-automatable, per Dev Notes "Data-source reality"): the real scrub over the
  git-ignored `.sources/story-10-1/*` session + a human reading the report and authoring the approval marker.
  The gate only enforces that a matching marker EXISTS at bundle time (Story 5.2 wires it).
- Senior-review fix round 1 (2026-06-15): all fix/consider findings (R1 codepoint sort, R2 gate
  self-validation, R3 conn-string coverage + greedy-password doc, R4 db-role doc, R5 home-path tail, R6
  input-key-order, R7 counts) addressed; R8/R9 confirmed REFUTED (harmless dead guard / within the
  documented producer contract — no code change). Behavioral fixes each gained a test (gate mutation-block
  + no-leak; conn-string credential coverage; home-path tail). +4 tests (41→45 scrub, 883→887 total). The
  golden inline snapshot was intentionally re-baselined for R5 (filePath tail consumed) + R6 (input key
  order); it still contains no leaked secret value. Privacy posture only TIGHTENED (R5 more redaction; R3/R4
  kept fail-safe over-redaction rather than narrowing). Gates GREEN; no git commit.

### File List

- `src/config/scrub-patterns.json` (NEW) — versioned, ordered deny-pattern set (config-as-data, NFR-4).
- `src/scrub/scrub-patterns.ts` (NEW) — `.strict()` Zod loader; compiles patterns to RegExp; fail-closed at load.
- `src/scrub/scrub.ts` (NEW) — PURE `scrubSession(events) → { scrubbedEvents, report, scrubHash }`.
- `src/scrub/gate.ts` (NEW) — PURE `isPublishable(...)` predicate + `ScrubApproval`/`ScrubApprovalSchema` (the Story-5.2 seam).
- `scripts/scrub.ts` (NEW) — THIN offline argv/fs/stdout glue (untested; mirrors interpret.ts/scribe-saga.ts).
- `src/scrub/scrub-patterns.unit.test.ts` (ATDD red → GREEN) — loader fail-closed guards (10 tests).
- `src/scrub/scrub.test.ts` (ATDD red → GREEN) — AC1 redaction + report + no-leak + determinism (12 tests).
- `src/scrub/gate.test.ts` (ATDD red → GREEN) — AC2 publish gate + marker schema + no-leak (9 tests).
- `src/scrub/r4-isolation.test.ts` (ATDD red → GREEN) — R4/R5 SDK-free + phaser-free source-grep (6 tests).
- `src/scrub/__fixtures__/planted-secrets.ts` (ATDD-authored) — the planted-secret NormalizedEvent[] fixture.
- `package.json` (MODIFIED) — added the `scrub:story-10-1` dev-runnable smoke script (not in test/build/CI).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (MODIFIED) — 5-1 ready-for-dev → in-progress → review.
- `_bmad-output/implementation-artifacts/5-1-secret-pii-scrub-gate.md` (MODIFIED) — frontmatter baseline_commit, task checkboxes, Status, Dev Agent Record.

**Review fix round 1 (2026-06-15) — files changed:**
- `src/scrub/scrub.ts` (MODIFIED) — R1 codepoint sort for `redactions`; R6 `walkValue` preserves input key order.
- `src/scrub/gate.ts` (MODIFIED) — R2 `scrubHashOf` + fail-closed self-validation of `scrubResult.scrubHash`.
- `src/config/scrub-patterns.json` (MODIFIED) — R5 home-path patterns consume the tail; R3/R4 doc updates (greedy-password + db-role fail-safe rationale).
- `src/scrub/__fixtures__/planted-secrets.ts` (MODIFIED) — R3 `PLANTED_CONN_STRING` (password-literal-free conn string).
- `src/scrub/scrub.test.ts` (MODIFIED) — R3 conn-string-credential coverage test; R5 home-path-tail test; golden inline snapshot re-baselined (R5/R6).
- `src/scrub/gate.test.ts` (MODIFIED) — R2 mutated-result-BLOCKS + reason-no-leak tests.

## Change Log

- 2026-06-15 — Story 5.1 implemented (dev-story): the secret/PII scrub + manual-review report + the publish-gate
  predicate (the privacy guardrail). NEW `src/scrub/` (scrub-patterns/scrub/gate) + `src/config/scrub-patterns.json`
  + thin `scripts/scrub.ts` + the planted-secret fixture. Four ATDD suites made GREEN honestly; +41 tests
  (83→87 files, 842→883 tests). Gates green (typecheck/lint/test/build); golden snapshots byte-stable; no
  anthropic in dist. Status ready-for-dev → review. No git commit.
- 2026-06-15 — Senior Developer Review fix round 1: addressed R1–R7 (fix/consider), refuted R8/R9. R1 codepoint
  sort for `redactions` (host-independent reportHash); R2 gate self-validates scrubHash against its own
  scrubbedEvents (defense-in-depth, fail-closed); R3 added a password-literal-free conn-string fixture/test so
  `connection-string-credential` is exercised + documented the greedy `password=\S+` fail-safe (tightening was
  verified to LEAK the conn-string host tail); R4 documented db-role as intentionally aggressive; R5 home-path
  patterns now consume the path tail (strictly more private); R6 `walkValue` preserves input key order; R7 doc
  counts corrected. Code touched: src/scrub/scrub.ts, src/scrub/gate.ts, src/config/scrub-patterns.json + tests/
  fixture. +4 tests (883→887 total; 41→45 scrub). Golden inline snapshot re-baselined for R5/R6 (no value leak).
  Gates GREEN: typecheck/lint clean, 87 files / 887 tests, build OK + no anthropic in dist, pace/ingest golden
  snapshots byte-stable. Status review → done. No git commit (operator commits between stories).

## Senior Developer Review (AI)

**Reviewer:** Andres Felipe Grisales — **Date:** 2026-06-15 — **Outcome:** Approve with minor fixes.

**Verdict:** All 3 gate-verifiable ACs PASS (verified by re-running `pnpm test src/scrub/` → 41 green, and by running `scrubSession` over the planted fixture). The privacy guardrail is correct, pure, fail-closed, config-as-data, and SDK-free. No high-severity defects. Findings are localized determinism/coverage/over-redaction polish + a stale doc count. Synthesized from 3 adversarial layers (Blind Hunter, Edge/Boundary Hunter, Acceptance Auditor) after independent code verification; overlapping findings merged.

**Severity tally:** high 0 / med 2 / low 5.

> **RESOLUTION (fix round 1, 2026-06-15):** All Action Items below are RESOLVED — R1, R2, R5, R6, R7 fixed in
> code/docs; R3, R4 addressed (conn-string coverage added + greedy-password/db-role documented as intentional
> fail-safe over-redaction; narrowing was verified to be the privacy-WRONG direction); R8, R9 confirmed REFUTED
> (harmless dead guard / within the documented sole-producer contract — no change). See "### Review Follow-ups
> (AI)" under Tasks/Subtasks for the per-finding actions + tests. Gates GREEN (87 files / 887 tests, build OK,
> no anthropic in dist, pace/ingest golden snapshots byte-stable). Story Status → done.

### Findings

- **[MED] R1 — `redactions` ordered by locale-sensitive `localeCompare` → `reportHash` determinism footgun** (`src/scrub/scrub.ts:226`; layers: Blind Hunter, Edge/Boundary Hunter). `report.redactions` array order is baked into `reportHash = sha256(canonicalJSON(report))` (canonicalJSON sorts object KEYS but preserves ARRAY order). `localeCompare` is locale/ICU-collation dependent, so the same report can serialize differently across hosts → an approval made on one machine could spuriously BLOCK on another. Masked today only by the 6 fixed ASCII-lowercase-hyphen categories (codepoint == locale order for these). Inconsistent with the mandated canonicalJSON codepoint posture. **Recommendation: fix.** Replace with codepoint sort: `.sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0))`.

- **[MED] R2 — Gate compares the supplied `scrubResult.scrubHash` field; never recomputes it from `scrubbedEvents` (defense-in-depth gap, NOT an AC2 failure)** (`src/scrub/gate.ts:88`; layer: Blind Hunter). AC2 ("input no longer matches scrubbed output") IS satisfied via the marker round-trip: re-scrubbing a changed session yields a new scrubHash and the old approval BLOCKS (proven gate.test.ts:106-113). The residual gap is only for a 5.2 caller that VIOLATES the documented sole-producer contract (gate header: scrubResult MUST come from `scrubSession`) by hand-mutating `scrubbedEvents` while reusing the stale `scrubHash` field. Low real-world likelihood, but cheap to harden the gate so it self-validates the result object. **Recommendation: consider** (lean fix — recompute expected scrubHash from `scrubResult.scrubbedEvents` + `patternSetVersion` and BLOCK on mismatch before comparing the approval).

- **[LOW] R3 — Greedy `password=\S+` over-redacts across the `@` boundary; leaves `connection-string-credential` an untested dead pattern on the fixture** (`src/config/scrub-patterns.json:25`; layers: Blind Hunter, Acceptance Auditor). Verified: `postgres://app_rw:password=FAKEpw123!@db.example.invalid:5432/app` → `«REDACTED:db-role»://«REDACTED:db-role»:«REDACTED:credential»` — the `@host:port/db` tail vanishes (the credential count=1 comes from `password=`, not the conn-str pattern, which never fires for this leaf). This is the FAIL-SAFE direction (over-redact), so privacy is intact and AC1 passes; but the conn-str pattern (line 31) has zero test coverage. **Recommendation: consider** (tighten `password=\S+` to stop at `@`/delimiter, e.g. `[^\s@/]+`, AND add a fixture with a password-literal-free conn string so line 31 is actually exercised — or document the greedy fallback as intentional).

- **[LOW] R4 — `db-role` patterns are unconditional whole-word matchers → over-redact benign prose** (`src/config/scrub-patterns.json:61`; layers: Blind Hunter, Edge/Boundary Hunter). Verified: `"We deployed to the postgres database cluster"` → `"...the «REDACTED:db-role» database cluster"`. `\bpostgres\b`/`\bapp_rw\b` redact those words anywhere (prose, paths, commit text); the real `.sources/story-10-1` session (a DB-backed app) will see many benign mentions, adding noise to the deferred operator's review. Privacy-safe (fail-closed over-redact). **Recommendation: consider** (scope to a credential/role neighborhood — `role=`/`user=`/`://` — or document db-role as intentionally aggressive operator-review noise).

- **[LOW] R5 — Home-path patterns redact only the `/home/<user>` prefix; the path tail (incl. filename) survives** (`src/config/scrub-patterns.json:43`; layers: Blind Hunter, Edge/Boundary Hunter). Verified: `/home/fakeuser/secret/private.key` → `«REDACTED:home-path»/secret/private.key`. The privacy-relevant USERNAME is removed (the main goal; the no-leak test checks the full planted string and passes), but `.ssh/id_rsa`/`.aws/credentials`-style tails remain residual signal. AC1 ("absolute home paths /home/<user>/... are redacted") is read as user-segment removal — defensible by-design. **Recommendation: consider** (either extend to consume the path tail, e.g. `/home/[^\s"']+`, if the full path is sensitive, OR document that only the prefix+user is deliberately removed).

- **[LOW] R6 — `walkValue` reorders payload object keys even with zero redactions** (`src/scrub/scrub.ts:127`; layer: Blind Hunter). `Object.keys(source).sort()` rebuilds every object key-sorted, so a benign event's output key order differs from input (`{command, apiKey}` → `{apiKey, command}`). Harmless for scrubHash (canonicalJSON re-sorts) and JSON semantics, but the written `scrubbed.json` no longer preserves original key order — a structural mutation beyond redaction. **Recommendation: consider** (iterate `Object.keys(source)` without `.sort()`; locations/candidates already key on jsonPath+eventId and canonicalJSON handles hash stability, so the sort is unnecessary).

- **[LOW] R7 — Stale test count in Dev Agent Record (claims 37 scrub tests / 879 total; actual 41 / 883)** (`_bmad-output/implementation-artifacts/5-1-secret-pii-scrub-gate.md:167`; layers: Edge/Boundary Hunter, Acceptance Auditor). Re-ran `pnpm test src/scrub/` → 41 passing (scrub/gate suites grew beyond the noted 10+12+9+6 with extra round-trip/no-leak cases). Harmless direction (more coverage than documented). **Recommendation: fix** (update Debug Log/Completion/Change-Log tallies to 41 scrub tests / 883 total).

**Refuted / not raised as fix:**
- Edge/Boundary Hunter "dead `«REDACTED:` guard at scrub.ts:154": CONFIRMED dead (`«` is outside the OPAQUE_TOKEN char class; the `REDACTED:category` text is 14 chars and fails the ≥20 length+mixed-alnum gate). Genuinely unreachable but HARMLESS — left as a documented likely-refute (no behavior impact; not worth a change in this surgical pass).
- Edge/Boundary Hunter "gate throws on a malformed `scrubResult.report`": within the literal contract — the header promises never-throw on a bad MARKER only, and the sole sanctioned producer of `scrubResult` is `scrubSession`. Likely-refute (covered by the documented producer contract; R2's optional hardening is the proportionate response if any).

### AC Summary

- **AC1 (scrub + report):** PASS. Every planted category redacted via `«REDACTED:{cat}»`; report lists redactions by category+count, locations (eventId+jsonPath, no value), candidates (opaque-token-len hints); no planted value appears in scrubbedEvents or the serialized report (verified by run + scrub.test.ts no-leak assertions).
- **AC2 (publish gate):** PASS. `isPublishable` is pure + fail-closed: BLOCKS on null marker, schema-invalid marker, scrubHash mismatch, reportHash mismatch; PASSES only on dual-hash match. Content-addressing proven by the mutate-B-blocks-A round-trip (gate.test.ts:99-113). (R2 is defense-in-depth on top, not an AC gap.)
- **AC3 (config-as-data / purity / isolation):** PASS. Patterns load from versioned JSON via `.strict()` Zod (compiles each regex at load, fail-loud); scrub is pure/deterministic (no clock/RNG/IO; fresh regex per leaf); SDK-free + phaser-free pinned by `r4-isolation.test.ts`.
- **Operator step / scope boundaries:** PASS. Real `.sources` scrub + human approval correctly deferred; gate only enforces a matching marker exists; no 5.2 bundle-assembly pulled forward; `replay-bundle.ts`/`eslint.config.ts`/`freeze.ts` unmodified; 5.1 uses its own planted fixture, not the 1.3 committed sample.
