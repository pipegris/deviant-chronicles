export const meta = {
  name: 'dev-chronicles-pipeline',
  description: 'Epic-agnostic autonomous BMAD pipeline for ONE Dev Chronicles story (driven by args): create -> ATDD red tests -> dev to green -> test-quality review -> 3-layer adversarial review -> auto-fix all real findings -> independent verify, bounded Fix<->Verify loop. No human triage gate. No git commit (operator commits between stories). Forked from kebox bmad-epic-pipeline.js and re-soaked for this stack: pure-TS Vite/Phaser, Vitest golden-snapshot determinism, the three-layer provenance model (R1-R5), no DB/backend. Self-heals interrupted runs via resumeFromRunId + on-disk recovery agents. Every phase runs on the latest Opus.',
  phases: [
    { title: 'Create', detail: 'bmad-create-story: write the story context file' },
    { title: 'ATDD', detail: 'bmad-testarch-atdd: red-phase Vitest acceptance tests encoding the ACs (pre-implementation)' },
    { title: 'Dev', detail: 'bmad-dev-story: implement to green (make the ATDD acceptance tests pass)' },
    { title: 'TestReview', detail: 'bmad-testarch-test-review: test-quality review + apply findings, keep green' },
    { title: 'Review', detail: '3 parallel adversarial layers + triage synthesis' },
    { title: 'Fix', detail: 'auto-fix all real findings (refute false positives), bookkeeping, flip to done' },
    { title: 'Verify', detail: 'independent gate re-run + ATDD-AC coverage + determinism + provenance + scope check; loop if fail' },
  ],
}

const ROOT = '/home/archfelipe/dev/dev-chronicles'
const MAX_FIX_ROUNDS = 3

// ============ Model routing (all phases on the latest Opus) ============
const MODEL = {
  create: 'opus', atdd: 'opus', dev: 'opus', testReview: 'opus',
  hunter: 'opus', synth: 'opus', fix: 'opus', verify: 'opus',
}
const RECOVERY_MODEL = { readonly: 'opus', active: 'opus' }

// A1-RESUME: a mid-run interruption terminates subagents before their StructuredOutput
// call -> null phase result. Two layers of resilience: (1) harness-level resumeFromRunId
// replays green phases instantly; (2) script-level runAgent retries once, then runs an
// on-disk recovery agent that FINISHES the job from working-tree truth.

// ---- per-story parameters (from args; tolerant of JSON-string or object) ----
let _args = args
if (typeof _args === 'string') { try { _args = JSON.parse(_args) } catch { _args = {} } }
const S = _args || {}
if (!S.num || !S.key) {
  throw new Error('dev-chronicles-pipeline: args did not bind (num/key missing) — got typeof ' + typeof args)
}
const NUM = S.num // e.g. "1.2"
const STORY_KEY = S.key // sprint-status key, e.g. "1-2"
const STORY_FILE = S.file // _bmad-output/implementation-artifacts/<key>.md
const TITLE = S.title
const EPIC_ANCHOR = S.epicAnchor // "### Story 1.2: ..."
const EPIC_NUM = S.epicNum || String(NUM).split('.')[0] // "1"
const EPIC_KEY = S.epicKey || `epic-${EPIC_NUM}` // "epic-1"
const COMMITTED_NOTE = S.committedNote || ''
const EXTRA_PRIOR_ART = S.priorArt || ''
const CREATE_BRIEF = S.createBrief || ''
const DEV_BRIEF = S.devBrief || ''
const REVIEW_FOCUS = S.reviewFocus || ''
const VERIFY_FOCUS = S.verifyFocus || ''
const TOUCHES_RENDER = S.touchesRender === true // true once a story renders via Phaser (Epic 2+)

// ============ Project gate + convention runbook ============
const GATES = `PROJECT GATES (dev-chronicles — pure-TS offline pipeline + Phaser renderer; NO DB, NO backend, NO auth):
- Typecheck: \`pnpm typecheck\` (tsc --noEmit, strict).
- Lint: \`pnpm lint\` (ESLint flat config) — MUST pass. It encodes the LOAD-BEARING import boundaries: R1 (Layer-0 dirs ingest/translate/pace/model never import src/interpret/), R4 (@anthropic-ai/sdk only in scripts/+src/interpret/+src/scribe/), R5 (phaser only in src/render/+src/game/). NEVER relax/disable these rules to make code pass — fix the code instead.
- Tests: \`pnpm test\` (vitest run) — full suite green. Tests are co-located \`*.test.ts\`. Layer-0 determinism is guarded by committed golden snapshots under \`src/pace/__snapshots__/\`.
- Build: \`pnpm build\` (vite build -> dist/) must succeed; @anthropic-ai/sdk must NEVER appear in the browser bundle (R4).
DETERMINISM / PURITY (R2): modules in src/ingest|translate|pace|model are PURE — FORBIDDEN: Date.now(), Math.random(), performance.now(), network, file I/O, global mutable state. Time derives ONLY from event timestamps/orderKey. This is what keeps the golden BattleTimeline snapshot stable.
ANTI-CORRUPTION (R3): ONLY src/ingest/ parses raw JSONL and Zod-validates it; everything downstream consumes the validated NormalizedEvent[]. No second parser of the untrusted format.
CONVENTIONS: kebab-case files; types PascalCase; Zod \`export const XxxSchema\` + \`export type Xxx = z.infer<typeof XxxSchema>\`; enums = string-literal unions (NO numeric/native enums); internal JSON camelCase (raw field names never leak past ingest/); prefer explicit \`null\` over \`undefined\` for serialized data; config-as-data in src/config/*.json (no hardcoded tuning constants); fail-closed-to-default on unmapped events at replay time, but Ingest validation fails LOUD at build time. NO runtime LLM/network calls anywhere browser-reachable. DO NOT git commit (the operator commits between stories).`

// Stable project foundation — true for every Epic-1+ story.
const BASE_PRIOR_ART = `PROJECT FOUNDATION (Story 1.1, COMMITTED at HEAD — read it, build ON it, do NOT re-scaffold or edit the lint config):
- Stack: Phaser 4 + Vite 6 + TypeScript 5.7 (strict) + Vitest + Zod 4.4.3 (runtime) + @anthropic-ai/sdk 0.104.1 (devDependency, OFFLINE/build-time only). pnpm.
- src/ provenance tree exists (mostly empty .gitkeep dirs awaiting their story): schema/ ingest/(+__fixtures__/) translate/ pace/(+__snapshots__/) model/ interpret/ scribe/ render/(+phaser/) portal/ config/ ; plus top-level scripts/ and public/bundles/. Phaser bootstrap in src/game/ + src/main.ts (from the template).
- ESLint flat config (eslint.config.ts) encodes R1/R4/R5; a deliberate boundary violation fails lint (proven in Story 1.1).
- THE SPINE — three-layer provenance model: Layer 0 OBSERVED (ingest/translate/pace/model — pure, deterministic; the ONLY input to battle mechanics/HP/pacing); Layer 1 INTERPRETED (interpret/ — frozen, content-addressed, READ-ONLY overlay; never feeds mechanics; every BeatAnnotation carries a groundingPointer back to the Layer-0 event(s) it dramatizes); Layer 2 TOLD (scribe/ — variable prose, makes no truth claim, reads only frozen L1 + L0).
- AUTHORITATIVE SPECS (read the relevant parts before writing): \`_bmad-output/planning-artifacts/architecture.md\` (directory structure, Data Architecture/schemas, Implementation Patterns R1-R5, data flow) and \`_bmad-output/planning-artifacts/epics.md\` (the story ACs verbatim).`

const PRIOR_ART = EXTRA_PRIOR_ART ? `${BASE_PRIOR_ART}\n\nSTORY-SPECIFIC PRIOR ART:\n${EXTRA_PRIOR_ART}` : BASE_PRIOR_ART

// ============ StructuredOutput resilience ============
async function runAgent(prompt, opts, recoveryPrompt, recoveryModel) {
  const label = (opts && opts.label) || 'agent'
  let r = null
  try { r = await agent(prompt, opts) } catch (e) { log(`[warn] ${label} threw: ${String((e && e.message) || e).slice(0, 200)}`) }
  if (r) return r
  log(`[warn] ${label} returned no StructuredOutput — retrying once with nudge`)
  const nudge = `${prompt}\n\nSYSTEM RETRY NOTICE: your previous attempt ENDED WITHOUT calling the StructuredOutput tool — that counts as a FAILED run. Do NOT redo work that is already on disk; re-read the working tree / story file if you need to, then FINISH by calling the StructuredOutput tool now with honest values.`
  try { r = await agent(nudge, opts) } catch (e) { log(`[warn] ${label} retry threw: ${String((e && e.message) || e).slice(0, 200)}`) }
  if (r) return r
  if (recoveryPrompt) {
    const recoveryOpts = recoveryModel ? { ...opts, model: recoveryModel } : opts
    log(`[warn] ${label} still empty after retry — running recovery agent (on-disk truth, model=${recoveryOpts.model || 'inherit'})`)
    try { r = await agent(recoveryPrompt, recoveryOpts) } catch (e) { log(`[warn] ${label} recovery threw: ${String((e && e.message) || e).slice(0, 200)}`) }
  }
  return r
}

// ============ Schemas ============
const FINDING_ITEM = {
  type: 'object', additionalProperties: false,
  required: ['severity', 'title', 'file', 'why'],
  properties: {
    severity: { type: 'string', enum: ['high', 'med', 'low'] },
    title: { type: 'string' }, file: { type: 'string' }, line: { type: ['string', 'null'] },
    category: { type: 'string' }, why: { type: 'string' }, suggestedFix: { type: 'string' },
  },
}
const FINDINGS_SCHEMA = { type: 'object', additionalProperties: false, required: ['findings'], properties: { findings: { type: 'array', items: FINDING_ITEM } } }
const ACCEPTANCE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['acVerdicts'],
  properties: {
    acVerdicts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['ac', 'verdict', 'evidence'], properties: { ac: { type: 'string' }, verdict: { type: 'string', enum: ['pass', 'partial', 'fail'] }, evidence: { type: 'string' }, gap: { type: 'string' } } } },
    findings: { type: 'array', items: FINDING_ITEM },
  },
}
const CREATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['storyKey', 'storyFile', 'status', 'summary'],
  properties: {
    storyKey: { type: 'string' }, storyFile: { type: 'string' }, status: { type: 'string' },
    keyGuardrails: { type: 'array', items: { type: 'string' } },
    designDecisions: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' },
  },
}
const DEV_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['status', 'filesChanged', 'suiteResult', 'typecheck', 'lint', 'summary'],
  properties: {
    status: { type: 'string', enum: ['review', 'blocked'] }, haltReason: { type: ['string', 'null'] },
    filesChanged: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'change'], properties: { path: { type: 'string' }, change: { type: 'string' } } } },
    testsAdded: { type: 'integer' },
    suiteResult: { type: 'string' }, typecheck: { type: 'string' }, lint: { type: 'string' }, buildResult: { type: 'string' },
    acsImplemented: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['ac', 'howVerified'], properties: { ac: { type: 'string' }, howVerified: { type: 'string' } } } },
    deviationsFromStory: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' },
  },
}
const SYNTH_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['overallVerdict', 'highCount', 'medCount', 'lowCount', 'findings', 'acSummary', 'reviewSectionAppended'],
  properties: {
    overallVerdict: { type: 'string' }, highCount: { type: 'integer' }, medCount: { type: 'integer' }, lowCount: { type: 'integer' },
    findings: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['id', 'severity', 'title', 'location', 'why', 'recommendation', 'suggestedFix'],
      properties: {
        id: { type: 'string' }, severity: { type: 'string', enum: ['high', 'med', 'low'] }, title: { type: 'string' },
        location: { type: 'string' }, category: { type: 'string' }, why: { type: 'string' },
        recommendation: { type: 'string', enum: ['fix', 'consider', 'likely-refute'] }, suggestedFix: { type: 'string' },
        layers: { type: 'array', items: { type: 'string' } },
      },
    } },
    acSummary: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['ac', 'verdict'], properties: { ac: { type: 'string' }, verdict: { type: 'string' }, note: { type: 'string' } } } },
    reviewSectionAppended: { type: 'boolean' },
  },
}
const FIX_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['status', 'findingsAddressed', 'gates', 'storyStatus', 'summary'],
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] }, haltReason: { type: ['string', 'null'] },
    findingsAddressed: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'action', 'note'], properties: { id: { type: 'string' }, action: { type: 'string', enum: ['fixed', 'refuted', 'deferred'] }, note: { type: 'string' } } } },
    filesChanged: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'change'], properties: { path: { type: 'string' }, change: { type: 'string' } } } },
    storyStatus: { type: 'string' }, sprintStatus: { type: 'string' }, reviewFollowupsRecorded: { type: 'boolean' },
    gates: { type: 'object', additionalProperties: false, required: ['typecheck', 'lint', 'suiteResult', 'buildResult'], properties: { typecheck: { type: 'string' }, lint: { type: 'string' }, suiteResult: { type: 'string' }, buildResult: { type: 'string' } } },
    summary: { type: 'string' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'checks', 'unexpectedChanges', 'outstandingFindings', 'recommendCommit', 'summary'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    checks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'result', 'evidence'], properties: { name: { type: 'string' }, result: { type: 'string', enum: ['pass', 'fail'] }, evidence: { type: 'string' } } } },
    unexpectedChanges: { type: 'array', items: { type: 'string' } },
    outstandingFindings: { type: 'array', items: { type: 'string' } },
    recommendCommit: { type: 'boolean' }, summary: { type: 'string' },
  },
}
const ATDD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['status', 'testFilesAdded', 'redConfirmed', 'summary'],
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] }, haltReason: { type: ['string', 'null'] },
    testFilesAdded: { type: 'array', items: { type: 'string' } },
    acsCovered: { type: 'array', items: { type: 'string' } },
    redConfirmed: { type: 'boolean' }, redEvidence: { type: 'string' }, summary: { type: 'string' },
  },
}
const TESTREVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['status', 'suiteResult', 'summary'],
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] }, haltReason: { type: ['string', 'null'] },
    findingsApplied: { type: 'array', items: { type: 'string' } },
    suiteResult: { type: 'string' }, summary: { type: 'string' },
  },
}

// ============ Phase 1: Create ============
phase('Create')
log(`Phase 1/7 - bmad-create-story for Epic ${EPIC_NUM} Story ${NUM} (${TITLE})`)

const create = await runAgent(`You are running the BMAD "create-story" workflow autonomously (no interactive user). Working dir: ${ROOT}.

AUTHORITATIVE SPEC: Read \`.claude/skills/bmad-create-story/SKILL.md\` COMPLETELY and execute every step in order (resolve customization via \`python3 _bmad/scripts/resolve_customization.py --skill .claude/skills/bmad-create-story --key workflow\` if the skill says so; load \`_bmad/bmm/config.yaml\`; exhaustively analyze artifacts; write the story file).

TARGET (explicit — do NOT auto-discover a different story): Story ${NUM}, key \`${STORY_KEY}\`. Definition + Given/When/Then ACs are in \`_bmad-output/planning-artifacts/epics.md\` under "${EPIC_ANCHOR}". ${EPIC_KEY} is already in-progress.${COMMITTED_NOTE ? ' ' + COMMITTED_NOTE : ''}

STORY-SPECIFIC GUIDANCE (read the actual prior-art + architecture before deciding, do not guess):
${CREATE_BRIEF}

${PRIOR_ART}

${GATES}

Write the story file to \`${STORY_FILE}\`, status ready-for-dev, with thorough Dev Notes that RESOLVE every design decision on documented merits (this is autonomous — decide and proceed; record each decision + rationale, citing architecture.md where relevant). Run the checklist validation step. Flip sprint-status \`${STORY_KEY}\` backlog->ready-for-dev (${EPIC_KEY} stays in-progress) in \`_bmad-output/implementation-artifacts/sprint-status.yaml\`. Put any genuinely consequential scope/design decisions in designDecisions[] of the StructuredOutput. CRITICAL OUTPUT CONTRACT: your FINAL action MUST be a call to the StructuredOutput tool — that tool call IS your entire deliverable. Keep each string concise (under ~300 chars). A response that ends without the StructuredOutput tool call is a FAILED run.`,
  { schema: CREATE_SCHEMA, model: MODEL.create, phase: 'Create', label: `create:${NUM}` },
  `RECOVERY (read-only): the create agent for Story ${NUM} may have written the story file but failed to emit StructuredOutput. Do NOT redo analysis. Read \`${STORY_FILE}\` and \`_bmad-output/implementation-artifacts/sprint-status.yaml\`, then report StructuredOutput honestly: storyKey=\`${STORY_KEY}\`, storyFile=\`${STORY_FILE}\`, status = the story file's actual Status (or "missing" if absent), and a one-line summary. Finish by calling StructuredOutput.`,
  RECOVERY_MODEL.readonly)

const storyFile = (create && create.storyFile) ? create.storyFile : STORY_FILE
log(`Story file: ${storyFile} | status: ${create ? create.status : 'unknown'}`)
if (create && create.status === 'missing') {
  log(`[warn] Create phase produced no story file for ${NUM} — stopping; operator decision needed`)
  return { outcome: 'create-blocked', num: NUM, storyFile, create }
}

// ============ Phase 2: ATDD (red-phase acceptance tests) ============
phase('ATDD')
log(`Phase 2/7 - bmad-testarch-atdd: red Vitest acceptance tests for Story ${NUM} (pre-implementation)`)

const atdd = await runAgent(`You are running the BMAD "testarch-atdd" workflow autonomously for Story ${NUM}. Working dir: ${ROOT}. Story file: \`${storyFile}\`.

AUTHORITATIVE SPEC: Read \`.claude/skills/bmad-testarch-atdd/SKILL.md\` COMPLETELY and execute it for this story. GOAL: generate RED-PHASE acceptance tests encoding Story ${NUM}'s Given/When/Then ACs BEFORE the implementation exists — the red half of red-green-refactor.

CRITICAL adaptation to THIS repo (the skill is framework-generic; tests must fit dev-chronicles):
- Write acceptance tests in the repo's framework — **Vitest** — co-located as \`*.test.ts\` next to where the implementation will live (so dev extends, not duplicates). Pure-TS pipeline tests run under node (no DOM); only renderer stories need jsdom.
- Tests MUST be runnable (compile + execute under \`pnpm test\` / \`pnpm vitest run <path>\`) and currently FAIL/ERROR meaningfully because the feature is not built yet (RED) — NOT skipped/todo placeholders. Encode the REAL assertions each AC describes (e.g. for a schema story: a valid sample round-trip parses, an invalid one throws ZodError, enums reject unknown strings).
- Do NOT write production code. Do NOT git commit. If the atdd skill emits non-Vitest scaffolds (Gherkin/Playwright), TRANSLATE them into runnable Vitest tests.
- Confirm RED: run the new test file(s) and confirm they fail (capture brief evidence).

${GATES}

HALT only on a true blocker. Record testFilesAdded, acsCovered, redConfirmed (+ redEvidence). CRITICAL OUTPUT CONTRACT: your FINAL action MUST be a call to the StructuredOutput tool — a response that ends without it is a FAILED run.`,
  { schema: ATDD_SCHEMA, model: MODEL.atdd, phase: 'ATDD', label: `atdd:${NUM}` })

if (!atdd || atdd.status === 'blocked') {
  log(`[warn] ATDD phase blocked for ${NUM} — stopping; operator decision needed`)
  return { outcome: 'atdd-blocked', num: NUM, storyFile, create, atdd }
}
log(`ATDD: ${atdd.testFilesAdded ? atdd.testFilesAdded.length : '?'} test file(s) | red=${atdd.redConfirmed}`)

// ============ Phase 3: Dev ============
phase('Dev')
log(`Phase 3/7 - bmad-dev-story: implementing Story ${NUM} to green (make the ATDD acceptance tests pass)`)

const DEV_RECOVERY = `RECOVERY (read-only, do NOT implement anything new): the dev agent for Story ${NUM} may have finished implementing but failed to emit StructuredOutput. Inspect the working tree honestly: \`git status --porcelain\`, \`git diff HEAD --stat\`, the story file Status in \`${storyFile}\`, and RE-RUN the gates (\`pnpm typecheck\`; \`pnpm lint\`; \`pnpm test\`; \`pnpm build\`). Report StructuredOutput reflecting the ACTUAL on-disk state: status="review" if gates are green and the feature is present, else "blocked" with haltReason. Finish by calling StructuredOutput.`

const dev = await runAgent(`You are running the BMAD "dev-story" workflow autonomously to IMPLEMENT Story ${NUM}. Working dir: ${ROOT}. Story file (explicit path): \`${storyFile}\`.

AUTHORITATIVE SPEC: Read \`.claude/skills/bmad-dev-story/SKILL.md\` COMPLETELY and execute every step in order using the explicit story path. Red-green-refactor. Only modify permitted story-file sections. Run to completion in a single pass.

RED TESTS ALREADY EXIST: the prior ATDD phase wrote red-phase acceptance tests in the working tree (${JSON.stringify(atdd.testFilesAdded || [])}). Make them GREEN — do NOT delete, skip, or weaken them; implement the feature so they pass honestly. Add the unit tests dev-story normally writes on top. If an ATDD test encodes a wrong expectation, fix the test WITH a documented justification (do not silently gut it).

Implement EXACTLY what the story Dev Notes/Tasks specify — do not invent scope beyond the ACs. STORY-SPECIFIC IMPLEMENTATION NOTES:
${DEV_BRIEF}

${PRIOR_ART}

${GATES}

Respect the provenance wall and purity rules (R1-R5, R2) — they are enforced by lint + the golden snapshot; a violation is a real failure, not a nuisance. ${TOUCHES_RENDER ? 'This story touches the renderer: Phaser imports stay inside src/render/ (R5); the RenderPort is one-way (render/ consumes immutable snapshots, never feeds upstream).' : 'This story is pure-TS pipeline/schema (no Phaser); keep Layer-0 modules pure (R2).'}

FULL GATE before declaring done: \`pnpm typecheck\`, \`pnpm lint\`, \`pnpm test\` (full suite green), \`pnpm build\`. Then flip story Status to \`review\` and sprint-status \`${STORY_KEY}\` in-progress->review.

HALT only on a TRUE blocker (a genuinely required new dependency the story did not anticipate, 3 consecutive irrecoverable failures, missing spec). Do NOT fabricate green tests. DO NOT git commit. Return ONLY the StructuredOutput with HONEST gate results.`,
  { schema: DEV_SCHEMA, model: MODEL.dev, phase: 'Dev', label: `dev:${NUM}` },
  DEV_RECOVERY, RECOVERY_MODEL.readonly)

if (!dev || dev.status === 'blocked') {
  log(`[warn] Dev phase blocked or empty for ${NUM} — stopping; operator decision needed`)
  return { outcome: 'dev-blocked', num: NUM, storyFile, create, dev }
}
log(`Dev complete: suite ${dev.suiteResult} | typecheck ${dev.typecheck} | lint ${dev.lint} | files ${dev.filesChanged ? dev.filesChanged.length : '?'}`)

// ============ Phase 4: Test Review (test-quality) ============
phase('TestReview')
log(`Phase 4/7 - bmad-testarch-test-review: test-quality review for Story ${NUM}`)

const testReview = await runAgent(`You are running the BMAD "testarch-test-review" workflow autonomously for Story ${NUM}. Working dir: ${ROOT}. Story file: \`${storyFile}\`.

AUTHORITATIVE SPEC: Read \`.claude/skills/bmad-testarch-test-review/SKILL.md\` COMPLETELY and execute it. GOAL: review the QUALITY of the tests written for this story (the ATDD acceptance tests + the unit tests dev added) against the skill's best-practices knowledge base, and APPLY the worthwhile findings.

Focus on test-quality issues the adversarial CODE review (next phase) will NOT catch: weak/missing assertions, tests that pass for the wrong reason, happy-path-only coverage (missing the AC's negative/edge branches — invalid inputs, empty/null, unknown enum values, fail-closed-to-default), non-deterministic/flaky patterns, test interdependence, over-mocking that hides real behavior, ACs asserted only superficially. For determinism-bearing stories, ensure a golden snapshot/round-trip test actually pins the output. Apply fixes (strengthen assertions, add missing AC-branch tests) using best judgement — do NOT weaken or delete tests to pass.

Keep the suite GREEN: after applying findings, re-run \`pnpm test\` and report the result. ${GATES}

Do NOT git commit. Do NOT change Status. HALT only on a true blocker. Record findingsApplied + suiteResult. CRITICAL OUTPUT CONTRACT: your FINAL action MUST be a call to the StructuredOutput tool — a response that ends without it is a FAILED run.`,
  { schema: TESTREVIEW_SCHEMA, model: MODEL.testReview, phase: 'TestReview', label: `testreview:${NUM}` })

if (!testReview || testReview.status === 'blocked') {
  log(`[warn] Test-review phase blocked for ${NUM} — continuing to adversarial review anyway (test-review is advisory)`)
}
log(`Test review: ${testReview && testReview.findingsApplied ? testReview.findingsApplied.length : 0} findings applied | suite ${testReview ? testReview.suiteResult : 'n/a'}`)

// ============ Phase 5: Review ============
phase('Review')
log(`Phase 5/7 - adversarial review of ${NUM}: 3 parallel layers + triage synthesis`)

const REVIEW_CONTEXT = `Working dir: ${ROOT}. Story under review: ${NUM} (file: \`${storyFile}\`) — ${TITLE}. Implementation is in the WORKING TREE (NOT committed; prior stories are committed at HEAD). See ALL changes: \`git status --porcelain\`, \`git diff HEAD\`, and READ every new/untracked file IN FULL. The story's Given/When/Then ACs are in the story file. Report ONLY concrete real defects with file:line and a crisp reason. STORY-SPECIFIC THINGS TO HUNT: ${REVIEW_FOCUS}`

const layers = await parallel([
  () => agent(`ADVERSARIAL CODE REVIEW — BLIND HUNTER lens (correctness / determinism / provenance / type-safety). ${REVIEW_CONTEXT}

Hunt for REAL defects with priority on the rules unique to this system: R2 PURITY violations (Date.now()/Math.random()/performance.now()/network/file-I-O/global mutable state inside src/ingest|translate|pace|model — these silently break the golden snapshot); R1 PROVENANCE bleed (a Layer-0 module importing src/interpret/, or a BeatAnnotation/interpretation feeding HP/pacing math); R3 ANTI-CORRUPTION (raw JSONL parsed/re-parsed outside src/ingest/, or raw field names leaking past ingest/); Zod validation correctness at boundaries (is untrusted input actually validated? are internal hand-offs trusting types correctly?); schema fidelity vs architecture.md (missing required fields, wrong types, numeric enums instead of string-literal unions, undefined where serialized data should be explicit null); orderKey total-ordering / stable-sort correctness; SHA-256/hash canonicalization (stable key order — non-canonical JSON breaks content-addressing); R4/R5 import boundaries; any runtime LLM/network reachable from the browser entrypoint. For each: severity, file, line, category, why. Be specific and skeptical. CRITICAL OUTPUT CONTRACT: your FINAL action MUST be a call to the StructuredOutput tool; keep each string under ~300 chars; a response without it is a FAILED run.`, { schema: FINDINGS_SCHEMA, model: MODEL.hunter, phase: 'Review', label: `review:blind:${NUM}` }),

  () => agent(`ADVERSARIAL CODE REVIEW — EDGE / BOUNDARY / DETERMINISM HUNTER lens${TOUCHES_RENDER ? ' (+ render-seam one-way correctness)' : ''}. ${REVIEW_CONTEXT}

Walk EVERY branch and boundary. Report UNHANDLED cases: malformed/unknown raw records (does Ingest fail LOUD at build time as required?); unmapped/unknown events (do they fail-closed-to-default to a neutral beat and NEVER crash mid-replay?); empty arrays, missing optional fields, null vs absent, very-large inputs; equal orderKeys (is the sort STABLE / total, or can ties reorder run-to-run?); window/scoring boundary math (off-by-one at thresholds, inclusive/exclusive, montage aggregation edges); hash determinism across runs (same input -> same hash?); Zod \`.parse\` vs \`.safeParse\` misuse; any place a default/cold-start value is assumed. ${TOUCHES_RENDER ? 'For the renderer: render/ must consume immutable snapshots and never mutate/feed upstream (one-way); Phaser confined to render/ (R5).' : ''} For each: severity, file, line, category, why. CRITICAL OUTPUT CONTRACT: your FINAL action MUST be a call to the StructuredOutput tool; keep each string under ~300 chars; a response without it is a FAILED run.`, { schema: FINDINGS_SCHEMA, model: MODEL.hunter, phase: 'Review', label: `review:edge:${NUM}` }),

  () => agent(`ACCEPTANCE AUDITOR lens. ${REVIEW_CONTEXT}

For EACH acceptance criterion of Story ${NUM} (read verbatim from the story file's Given/When/Then), verify the implementation AND a test satisfy it. Quote the AC clause, cite implementing code + proving test (file:line), verdict pass/partial/fail with evidence. Flag any AC unimplemented, untested, or only superficially satisfied. Also confirm the story documents its scope boundaries (what it correctly DEFERS to later stories) and that nothing from a later story was pulled forward. CRITICAL OUTPUT CONTRACT: your FINAL action MUST be a call to the StructuredOutput tool; keep each string under ~300 chars; a response without it is a FAILED run.`, { schema: ACCEPTANCE_SCHEMA, model: MODEL.hunter, phase: 'Review', label: `review:accept:${NUM}` }),
])

const blind = layers[0] || { findings: [] }
const edge = layers[1] || { findings: [] }
const accept = layers[2] || { acVerdicts: [], findings: [] }
log(`Raw findings: blind ${(blind.findings || []).length}, edge ${(edge.findings || []).length}, acceptance-extra ${(accept.findings || []).length}; synthesizing`)

const synthesis = await runAgent(`You are the REVIEW SYNTHESIZER / TRIAGE LEAD for Story ${NUM}. Working dir: ${ROOT}. Story file: \`${storyFile}\`.

Raw findings from 3 adversarial layers + the acceptance auditor's per-AC verdicts are below. Your job:
1) DEDUPE overlapping findings (merge; list which layers raised each).
2) Final severity (high/med/low) per finding.
3) Triage RECOMMENDATION per finding: "fix" (real defect, must fix), "consider" (debatable — lean toward fix unless genuinely a judgment call), or "likely-refute" (FALSE POSITIVE — explain precisely WHY). This run is FULLY AUTONOMOUS: anything marked "fix"/"consider" WILL be auto-fixed; only "likely-refute" is skipped — so mark "likely-refute" ONLY when confident.
4) Verify uncertain findings yourself against the actual code (\`git diff HEAD\`, read files).
5) overallVerdict one-liner + per-AC acSummary.
6) APPEND a "## Senior Developer Review (AI)" section to \`${storyFile}\` documenting verdict + all findings (id/severity/location/recommendation/why) + AC summary. Set reviewSectionAppended=true. Do NOT change Status or commit.

RAW LAYER OUTPUT (JSON):
BLIND_HUNTER: ${JSON.stringify(blind)}
EDGE_BOUNDARY_HUNTER: ${JSON.stringify(edge)}
ACCEPTANCE_AUDITOR: ${JSON.stringify(accept)}

CRITICAL OUTPUT CONTRACT: your FINAL action MUST be a call to the StructuredOutput tool; keep each string under ~300 chars; a response without it is a FAILED run.`,
  { schema: SYNTH_SCHEMA, model: MODEL.synth, phase: 'Review', label: `review:synth:${NUM}` })

log(`Review: ${synthesis ? synthesis.overallVerdict : 'n/a'} (${synthesis ? synthesis.highCount : '?'}H/${synthesis ? synthesis.medCount : '?'}M/${synthesis ? synthesis.lowCount : '?'}L)`)

// ============ Phase 6+7: bounded Fix <-> Verify loop ============
let verify = null
let lastFix = null
let priorVerifyFailures = []
let round = 0
function normalizeRaw(layerFindings, layer) {
  return (layerFindings || []).map((f, i) => ({
    id: `${layer}-${i + 1}`, severity: f.severity || 'med', title: f.title || '(untitled)',
    location: `${f.file || '?'}${f.line ? ':' + f.line : ''}`, category: f.category || layer,
    why: f.why || '', recommendation: 'consider', suggestedFix: f.suggestedFix || '', layers: [layer],
  }))
}
const allFindings = synthesis
  ? synthesis.findings
  : [...normalizeRaw(blind.findings, 'blind'), ...normalizeRaw(edge.findings, 'edge'), ...normalizeRaw(accept.findings, 'acceptance')]
if (!synthesis) {
  log(`[warn] synthesis produced no StructuredOutput — falling back to ${allFindings.length} raw layer findings; fix phase will run the dedupe+refute triage itself before fixing`)
}

while (round < MAX_FIX_ROUNDS) {
  round++
  phase('Fix')
  const roundNote = round === 1
    ? (synthesis
        ? `This is fix round 1. Address EVERY finding the synthesizer marked "fix" or "consider". For findings marked "likely-refute", do NOT change code — record action:"refuted" with the reasoning (confirm it yourself first).`
        : `This is fix round 1, and the SYNTHESIZER/TRIAGE STEP DID NOT RUN (it failed to emit output). The findings below are the RAW, UN-DEDUPED, UN-TRIAGED union from the 3 review layers, every one provisionally "consider". The false-positive filter + dedupe that normally run BEFORE you are now YOUR job this round, first: (1) DEDUPE across layers; (2) VERIFY each surviving finding against the actual code (\`git diff HEAD\`); (3) REFUTE genuine false positives (action:"refuted", no code change). THEN fix only what survives. A round that refuted zero of a large raw set is a red flag you skipped the triage.`)
    : `This is fix round ${round}. The independent verifier REJECTED the previous round. You MUST resolve these verifier failures first:\n${JSON.stringify(priorVerifyFailures, null, 2)}\nAlso keep all originally-fixable findings addressed and the suite green.`

  const fix = await runAgent(`You are an implementation agent resolving the code-review findings for Story ${NUM} in ${ROOT}. FULL AUTONOMY — no human gate; fix all real defects and continue until the story is correct and green. Story file: \`${storyFile}\` (review record under "## Senior Developer Review (AI)").

${roundNote}

ALL SYNTHESIZED FINDINGS (JSON):
${JSON.stringify(allFindings, null, 2)}

RULES:
- Fix real defects properly (root cause). Each behavioral fix needs a test that proves it.
- If a finding is genuinely a false positive, mark it action:"refuted" with a crisp reason, NO code change.
- Stay surgical: every changed line traces to a finding or to keeping the suite green. No unrequested features, no refactor of untouched code. NEVER relax the R1/R4/R5 lint rules to pass — fix the code.
- ${GATES}

BOOKKEEPING (BMAD): in \`${storyFile}\` add/update a "### Review Follow-ups (AI)" subsection under Tasks/Subtasks with [x] items for each finding fixed + a note for each refuted; mark matching Action Items resolved; add a Change Log entry + Completion Note. Flip story Status to "done". Update \`_bmad-output/implementation-artifacts/sprint-status.yaml\` \`${STORY_KEY}\` -> done (leave ${EPIC_KEY} in-progress).

FULL GATE (report REAL results): \`pnpm typecheck\`, \`pnpm lint\`, \`pnpm test\`, \`pnpm build\`. If anything is red, fix it before declaring done. If truly blocked, set status:"blocked" + haltReason rather than faking green. DO NOT git commit. CRITICAL OUTPUT CONTRACT: your FINAL action MUST be a call to the StructuredOutput tool; keep each string under ~300 chars; a response without it is a FAILED run.`,
    { schema: FIX_SCHEMA, model: MODEL.fix, phase: 'Fix', label: `fix:${NUM}:r${round}` },
    `RECOVERY — FINISH THE JOB from on-disk truth (the fix agent for Story ${NUM} round ${round} did not emit StructuredOutput, most likely INTERRUPTED mid-run; the implementation is probably already on disk). Do NOT re-derive fixes from scratch. (1) RE-RUN the gates — \`pnpm typecheck\`, \`pnpm lint\`, \`pnpm test\`, \`pnpm build\` — and make ONLY the minimal fixes needed to get them green. (2) If gates are GREEN, COMPLETE THE BOOKKEEPING in \`${storyFile}\`: append a "## Senior Developer Review (AI)" section if absent (document the findings below + how each was resolved/refuted), add a "### Review Follow-ups (AI)" subsection + Change Log entry, flip story Status to "done", set sprint-status \`${STORY_KEY}\` -> done (leave ${EPIC_KEY} in-progress). Report status="done" with REAL gate results + findingsAddressed. (3) If a gate is genuinely red and not trivially fixable, report status="blocked" + haltReason (do NOT fake green). FINDINGS: ${JSON.stringify(allFindings)}. DO NOT git commit. Finish by calling StructuredOutput.`,
    RECOVERY_MODEL.active)

  lastFix = fix
  if (!fix || fix.status === 'blocked') {
    log(`[warn] Fix round ${round} blocked or empty for ${NUM} — stopping for operator`)
    return { outcome: 'fix-blocked', num: NUM, storyFile, create, dev, synthesis, blind, edge, accept, allFindings, fix, round }
  }
  log(`Fix round ${round}: suite ${fix.gates ? fix.gates.suiteResult : '?'} | story ${fix.storyStatus} | addressed ${fix.findingsAddressed ? fix.findingsAddressed.length : '?'}`)

  phase('Verify')
  const v = await runAgent(`You are an INDEPENDENT, adversarial verifier for Story ${NUM} in ${ROOT}. A fix agent claims the story is done and green. Trust NOTHING — inspect the actual working tree (\`git status --porcelain\`, \`git diff HEAD\`, read changed/new files) and RE-RUN gates yourself.

Verify and give evidence (file:line) for each:
1) AC COMPLETENESS: every Story ${NUM} AC is implemented AND tested (read the ACs verbatim from the story file). ${VERIFY_FOCUS}
1b) ATDD ACCEPTANCE TESTS INTACT: the red-phase acceptance tests written in ATDD (${JSON.stringify(atdd.testFilesAdded || [])}) STILL EXIST, are now GREEN, and were NOT deleted/skipped/weakened to pass — they still assert the real AC behavior. If any ATDD test was gutted/removed/.skip'd, FAIL.
2) DETERMINISM / PURITY (R2): no Date.now()/Math.random()/performance.now()/IO/global mutable state in src/ingest|translate|pace|model; if a golden snapshot exists it is stable on re-run (\`pnpm test\` twice if cheap); hashes are canonical/stable.
3) PROVENANCE / BOUNDARIES (R1/R3/R4/R5): \`pnpm lint\` passes WITHOUT the boundary rules being relaxed; no Layer-0 import of interpret/; raw JSONL parsed only in ingest/; @anthropic-ai/sdk not browser-reachable; phaser confined to render/+game/.
4) NO REGRESSION: full suite green; \`pnpm build\` succeeds.
5) SCOPE: no over-reach (nothing from a later story pulled forward); changes trace to ACs/findings; documented scope boundaries honored.
6) FINDINGS RESOLVED: every synthesized finding marked fix/consider genuinely resolved; refuted ones legitimately false positives.
7) BOOKKEEPING: story Status=done, Review Follow-ups recorded, sprint ${STORY_KEY}=done, ${EPIC_KEY} in-progress.
8) GATES (re-run independently): \`pnpm typecheck\`, \`pnpm lint\`, \`pnpm test\`, \`pnpm build\`. Report exact results.

List unexpectedChanges and outstandingFindings. verdict pass ONLY if everything holds and gates are green; else fail with specifics in checks[]. Set recommendCommit accordingly. CRITICAL OUTPUT CONTRACT: your FINAL action MUST be a call to the StructuredOutput tool; keep each string under ~300 chars; a response without it is a FAILED run.`,
    { schema: VERIFY_SCHEMA, model: MODEL.verify, phase: 'Verify', label: `verify:${NUM}:r${round}` },
    `RECOVERY — re-establish the verdict from on-disk truth (the verifier for Story ${NUM} round ${round} did not emit StructuredOutput, likely INTERRUPTED). Do NOT redo a full adversarial pass. Re-run \`pnpm typecheck\`, \`pnpm lint\`, \`pnpm test\`, \`pnpm build\`, confirm story Status=done + sprint-status \`${STORY_KEY}\`=done, and spot-check the ATDD acceptance tests (${JSON.stringify(atdd.testFilesAdded || [])}) still exist and pass. Report verdict="pass" (recommendCommit=true) ONLY if gates are green AND bookkeeping is complete; else verdict="fail" with the specific failing checks[]. Finish by calling StructuredOutput.`,
    RECOVERY_MODEL.active)

  verify = v
  log(`Verify round ${round}: ${v ? v.verdict : 'n/a'} | recommendCommit ${v ? v.recommendCommit : '?'}`)
  if (v && v.verdict === 'pass') break
  priorVerifyFailures = v ? (v.checks || []).filter((c) => c.result === 'fail').concat((v.outstandingFindings || []).map((o) => ({ name: 'outstanding', result: 'fail', evidence: o }))) : []
  if (round >= MAX_FIX_ROUNDS) log(`[warn] Reached MAX_FIX_ROUNDS=${MAX_FIX_ROUNDS} without a passing verify for ${NUM}`)
}

return { outcome: 'completed', num: NUM, storyFile, create, atdd, dev, testReview, synthesis, blind, edge, accept, fix: lastFix, verify, rounds: round }
