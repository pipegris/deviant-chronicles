// OFFLINE BUILD STEP — the canonical ReplayBundle build orchestration (Epic 5 / Story 5.2). The
// DEFAULT (no --real) path is run in dev/CI to produce the committed fixture-derived bundle: it makes
// NO LLM call, needs NO ANTHROPIC_API_KEY, touches NO network (the FixtureInterpreter + a placeholder
// Saga stand in for the deferred real bake). The --real seam is the DEFERRED operator bake.
//
// Thin argv/fs/stdout glue ONLY — ALL testable logic lives in src/bundle/assemble-bundle.ts (the
// gate + freeze + compose + validate) which `pnpm test` runs; this file carries no logic worth a unit
// test (vitest include is src/**/*.test.ts — the Story 3.2/5.1 thin-script precedent). It orchestrates
// the AC1 pipeline verbatim: scrub → ingest → pace → interpret → saga → assemble → write.
//
// Usage (dev/CI, mocked LLM — the DEFAULT, no flag):
//   jiti scripts/build-bundle.ts --transcript <path> --journal <path> --stream-id <id> \
//     --out public/bundles/story-10-1.json --approval <dev-marker path> [--patterns <path>]
// Usage (the `claude -p` CLI bake — real interpret + saga, NO ANTHROPIC_API_KEY):
//   jiti scripts/build-bundle.ts --cli --transcript <path> --journal <...> --stream-id <id> \
//     --out public/bundles/story-10-1.json --approval <marker> [--model <id>] [...versions]
//   (or BAKE_BACKEND=cli with no --cli flag)
// Usage (the DEFERRED operator bake — real claude-sonnet-4-6 interpret + claude-opus-4-8 saga via SDK):
//   jiti scripts/build-bundle.ts --real --transcript <real .sources path> --journal <...> \
//     --stream-id <id> --out public/bundles/story-10-1.json --approval <real marker> \
//     [--model <id>] [--interpreter-version <v>] [--prompt-version <v>]
//
// Story 5.6 — MULTI-STREAM ingest (AC2): the FULL session is dev + fix transcripts + the journal. Supply
// EITHER repeated --transcript/--stream-id pairs OR a single --session-manifest JSON (a checked-in
// [{transcript, streamId}, ...] table) — EXACTLY ONE of the two (fail-loud on both/neither). --journal
// stays a single required flag (one journal per session). The legacy single --transcript/--stream-id pair
// is unchanged (it maps to a one-element source list → byte-identical bundle).
//   jiti scripts/build-bundle.ts --cli --session-manifest <session.json> --journal <...> \
//     --out public/bundles/story-10-1.json --approval <marker> [--model <id>] [...versions]
//
// Story 5.6 — BAKE over the REDUCED view (AC3): on --cli/--real the interpreter + Saga receive the
// compact buildTaggingView(scrubbedEvents) (so the ~689-event session fits the context window), yet the
// interpreter's sourceHash + assembleBundle's annotationHash/freeze stay over the FULL scrubbed events
// (provenance UNCHANGED). The DEFAULT mocked path never builds the view.
//
// Story 5.7 — CHUNKED interpret (AC1, AC2): on --cli/--real the interpret is now WINDOWED into bounded
// chunks (each well under the 600s `claude -p` timeout the whole ~689-event view exceeded one-shot), merged
// + deduped via interpretChunked — yet each chunk call grounds over the FULL scrubbed events, so
// annotationHash/freeze/provenance stay over the full events (UNCHANGED). The Saga stays ONE-SHOT (it is
// not the bottleneck). The DEFAULT mocked path never builds the view nor chunks.
//
// Story 5.8 — NAME-SAFE Saga (AC1): on --cli/--real the Saga is now authored over the NAME-FREE public
// surface (buildSagaBrief over the payload-free projection + the frozen beats + teaching), NOT the
// snippet-bearing tagging-view. The tagging-view STAYS the interpret prompt (the two diverge); the Saga
// honors the Story 5.5 hard line (the public bundle never ships a real file/symbol name or path). The
// DEFAULT mocked path is UNTOUCHED — it uses PLACEHOLDER_SAGA + builds no brief (committed bundle byte-identical).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ingestSession } from '../src/bundle/session-ingest';
import { SessionManifestSchema } from '../src/bundle/session-manifest';
import { planTranscriptSources, manifestToPlannedSources } from '../src/bundle/transcript-source-plan';
import { buildTaggingView } from '../src/bundle/tagging-view';
import { projectEvents } from '../src/bundle/project-events';
import { buildSagaBrief } from '../src/scribe/saga-brief';
import { TEACHING } from '../src/portal/teaching-config';
import { scrubSession } from '../src/scrub/scrub';
import {
  COMPILED_SCRUB_PATTERNS,
  ScrubPatternsSchema,
  compileScrubPatterns,
  type CompiledScrubPattern,
} from '../src/scrub/scrub-patterns';
import { ScrubApprovalSchema, type ScrubApproval } from '../src/scrub/gate';
import { translate } from '../src/translate/translate';
import { pace } from '../src/pace/derive-beats';
import { PACING_WEIGHTS, WINDOW_CONFIG } from '../src/pace/pacing-config';
import { RULES } from '../src/translate/translation-rules';
import { MODEL_TUNING } from '../src/model/model-tuning';
import { fixtureAnnotations } from '../src/interpret/fixture-interpreter';
// Story 5.7 — the PURE chunked interpret orchestrator. SDK-FREE (it injects the interpret callback), so this
// STATIC import never pulls @anthropic-ai/sdk onto the default dev/CI path; only the LAZY
// `await import('../src/interpret/claude-interpreter')` below does, inside the --cli/--real branch.
import { interpretChunked } from '../src/interpret/chunked-interpret';
import type { BeatAnnotation } from '../src/schema/beat-annotation';
import { assembleBundle, bundleHash } from '../src/bundle/assemble-bundle';

// The mocked-LLM placeholder Saga (Decision §8): the deferred-bake stand-in that lets the committed
// bundle light up the victory panel in dev. It is a PLACEHOLDER, NOT real prose — the operator's
// --real bake replaces it with the lush claude-opus-4-8 Saga (no code change). Marked as such so it is
// never mistaken for an authored Saga.
const PLACEHOLDER_SAGA =
  '«PLACEHOLDER SAGA — the real claude-opus-4-8 bake over the full scrubbed session is the deferred ' +
  'operator step. Run `pnpm bundle:story-10-1 --real ...` to replace this with the authored Saga.»';

// The interpreter/prompt VERSIONS stamped into the bundle's annotationHash on the mocked path. They
// match the FixtureInterpreter's own fixture-v1 stamp so the dev bundle's annotationHash is stable.
const FIXTURE_INTERPRETER_VERSION = 'fixture-v1';
const FIXTURE_PROMPT_VERSION = 'fixture-v1';

// The placeholder asset manifest (logical name → path) — the Story 5.3 final-art swap target. Keep
// the placeholder logical names; the renderer's Phaser loader is fed by this.
const PLACEHOLDER_ASSET_MANIFEST: Record<string, string> = {
  hero: 'assets/hero.png',
  boss: 'assets/boss.png',
  arena: 'assets/arena.png',
};

// tuningConfig (Decision §5): the versioned config DATA the timeline + model are reproducible from —
// keyed by config name. REUSES the validated config constants (no second parser); it is metadata for
// auditability, not re-consumed by the browser (the timeline is already baked). Minimal by design.
function buildTuningConfig(): Record<string, unknown> {
  return {
    pacingWeights: PACING_WEIGHTS,
    windowConfig: WINDOW_CONFIG,
    translationRules: RULES,
    modelTuning: MODEL_TUNING,
  };
}

function getFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function requireFlag(argv: string[], name: string): string {
  const value = getFlag(argv, name);
  if (value === undefined) {
    throw new Error(`scripts/build-bundle.ts: missing required --${name} flag.`);
  }
  return value;
}

// Resolve the transcript source list (raw text + stream-id per stream). The fail-CLOSED decision (EXACTLY
// ONE of {--session-manifest, repeated --transcript/--stream-id pairs}; fail-loud on both/neither or a
// count mismatch) is the gate-tested planTranscriptSources (src/bundle/transcript-source-plan.ts §4). The
// SCRIPT owns only the fs reads here; planTranscriptSources owns the validation (so the negative branches
// are covered by vitest, which never runs this file). A single --transcript + --stream-id (in any order
// relative to --journal) reproduces the pre-5.6 single-stream ingest — byte-identical bundle.
function resolveTranscriptSources(argv: string[]): Array<{ raw: string; streamId: string }> {
  const plan = planTranscriptSources(argv);
  const planned =
    plan.kind === 'manifest'
      ? manifestToPlannedSources(SessionManifestSchema.parse(JSON.parse(readFileSync(plan.manifestPath, 'utf8'))))
      : plan.sources;
  return planned.map(({ path, streamId }) => ({ raw: readFileSync(path, 'utf8'), streamId }));
}

async function main(argv: string[]): Promise<void> {
  const journalPath = requireFlag(argv, 'journal');
  const outPath = requireFlag(argv, 'out');
  const approvalPath = getFlag(argv, 'approval');
  const patternsPath = getFlag(argv, 'patterns');
  const cli = hasFlag(argv, 'cli') || process.env.BAKE_BACKEND === 'cli';
  const real = hasFlag(argv, 'real');
  const model = getFlag(argv, 'model');
  const interpreterVersionFlag = getFlag(argv, 'interpreter-version');
  const promptVersionFlag = getFlag(argv, 'prompt-version');

  // ── ingest (R3: ingest is the ONLY raw-JSONL parser, called inside ingestSession per stream). The
  // script owns the fs reads; ingestSession parses+normalizes EACH transcript with its stream-id and
  // merges [...allTranscripts, journal] into one orderKey-total-ordered session (Story 5.6 AC2). A single
  // --transcript/--stream-id pair reproduces the pre-5.6 merge byte-for-byte (the byte-identical-bundle
  // guarantee). The SAME merged events feed scrub/interpret/scribe-saga as before.
  const transcripts = resolveTranscriptSources(argv);
  const events = ingestSession({ transcripts, journalRaw: readFileSync(journalPath, 'utf8') });

  // ── scrub: redact the ingested events (Story 5.1). An optional override deny set, validated +
  // compiled fail-closed; defaults to the committed COMPILED_SCRUB_PATTERNS.
  const patterns: CompiledScrubPattern[] = patternsPath
    ? compileScrubPatterns(ScrubPatternsSchema.parse(JSON.parse(readFileSync(patternsPath, 'utf8'))))
    : COMPILED_SCRUB_PATTERNS;
  const scrubResult = scrubSession(events, patterns);

  // ── load the operator ScrubApproval marker (fail-loud on a malformed file) or null when absent.
  // The gate (run inside assembleBundle) BLOCKS on null/stale — fail-closed.
  const approval: ScrubApproval | null = approvalPath
    ? ScrubApprovalSchema.parse(JSON.parse(readFileSync(approvalPath, 'utf8')))
    : null;

  // ── pace: the bundle BAKES the timeline (Story 1.2). Paced from the SCRUBBED events so the bundle is
  // internally consistent (Decision §4 — the timeline's sourceEventIds reference the shipped events).
  const battleTimeline = pace(translate(scrubResult.scrubbedEvents));

  // ── interpret + saga: the mocked-LLM path (default) vs the --real deferred operator bake.
  let annotations: BeatAnnotation[];
  let saga: string;
  let interpreterVersion: string;
  let promptVersion: string;

  if (cli || real) {
    // Real interpret + saga. Lazily imported so neither @anthropic-ai/sdk nor node:child_process is ever
    // on the default dev/CI path (R4). --cli injects the key-free `claude -p` adapter; --real falls back
    // to ClaudeInterpreter/SagaAuthor's lazy SDK client.
    //
    // Story 5.6 (AC3, §8): the interpreter + Saga PROMPT is the REDUCED tagging view — buildTaggingView
    // over the SCRUBBED events — so the ~689-event session fits the context window. The interpreter ALSO
    // receives the FULL scrubbed events as its grounding arg, so its per-annotation sourceHash stays over
    // the full events (provenance unchanged). The Saga only serializes its input + makes no truth claim,
    // so it takes the reduced view directly (it needs the per-event arc, not the bytes). annotationHash +
    // freeze run inside assembleBundle over scrubResult (the FULL events), UNCHANGED — see the assemble step.
    const taggingView = buildTaggingView(scrubResult.scrubbedEvents);
    const { ClaudeInterpreter } = await import('../src/interpret/claude-interpreter');
    const { SagaAuthor } = await import('../src/scribe/saga-author');
    let client: import('../src/llm/claude-cli-client').AnthropicLike | undefined;
    if (cli) {
      const { ClaudeCliClient } = await import('../src/llm/claude-cli-client');
      client = new ClaudeCliClient();
      process.stderr.write(
        'scripts/build-bundle.ts --cli: authoring interpret + saga via `claude -p` ' +
          '(no ANTHROPIC_API_KEY).\n',
      );
    } else {
      process.stderr.write(
        'scripts/build-bundle.ts --real: about to make REAL, BILLED Anthropic calls (interpret + saga) ' +
          'over the resolved ANTHROPIC_API_KEY — the deferred operator bake, never run in dev/CI.\n',
      );
    }
    const interpreter = new ClaudeInterpreter({
      client,
      model,
      interpreterVersion: interpreterVersionFlag,
      promptVersion: promptVersionFlag,
    });
    const author = new SagaAuthor({ client, model, promptVersion: promptVersionFlag });
    // Story 5.7: CHUNK the interpret so each `claude -p` call fits under the 600s timeout the whole
    // ~689-event view exceeded one-shot. Prompt = each chunk of the reduced view; grounding = the FULL
    // scrubbed events on EVERY call (so sourceHash stays over them); per-chunk results merged + deduped.
    annotations = await interpretChunked({
      promptView: taggingView,
      groundingEvents: scrubResult.scrubbedEvents,
      interpret: (chunk, grounding) => interpreter.interpret(chunk, grounding),
    });
    // Story 5.8 (AC1) — the Saga is authored over the NAME-FREE public-surface brief, NOT the snippet-bearing
    // tagging-view (which still feeds the INTERPRET prompt above — the two DIVERGE). The brief is built from
    // the SAME payload-free projection assembleBundle ships (projectEvents over the scrubbed events) + the
    // frozen beats (the chunked-interpret result) + the teaching concepts — name-free BY CONSTRUCTION, so the
    // Layer-2/Told Saga honors the Story 5.5 hard line. The Saga stays ONE-SHOT (it is not the bottleneck).
    const projectedEvents = projectEvents(scrubResult.scrubbedEvents);
    const sagaBrief = buildSagaBrief({
      projectedEvents,
      annotations,
      teaching: TEACHING,
      battleTimeline,
    });
    saga = await author.authorSaga(sagaBrief);
    interpreterVersion = interpreter.interpreterVersion;
    promptVersion = interpreter.promptVersion;
  } else {
    // The dev/CI mocked path: the deterministic FixtureInterpreter's SYNCHRONOUS annotation source +
    // the placeholder Saga. NO key, NO network. (The FixtureInterpreter is content-independent — it
    // returns the committed fixture beats; fixtureAnnotations() is the same source without the async seam.)
    annotations = fixtureAnnotations();
    saga = PLACEHOLDER_SAGA;
    // review F4: --interpreter-version/--prompt-version are REAL-only. fixtureAnnotations() always
    // stamps each annotation interpreterVersion: 'fixture-v1', so the mocked path must hash annotationHash
    // over that SAME constant — honoring the flags here would desync the run-identity key from the
    // embedded annotations' provenance. The constants are the single source on this path.
    interpreterVersion = FIXTURE_INTERPRETER_VERSION;
    promptVersion = FIXTURE_PROMPT_VERSION;
  }

  // ── assemble: the gate runs HERE (assembleBundle calls isPublishable FIRST + throws on a BLOCK).
  // Catch the BLOCK so the script prints the gate reasons + exits 1 WITHOUT writing the bundle.
  let bundle;
  try {
    bundle = assembleBundle({
      scrubResult,
      approval,
      annotations,
      interpreterVersion,
      promptVersion,
      battleTimeline,
      tuningConfig: buildTuningConfig(),
      saga,
      assetManifest: PLACEHOLDER_ASSET_MANIFEST,
    });
  } catch (err) {
    // The gate's no-leak invariant means the message carries hashes/ids only, never a secret value.
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.stderr.write('PUBLISH BLOCKED — no bundle written.\n');
    process.exitCode = 1;
    return;
  }

  // ── write: the byte-stable on-disk form (2-space JSON + trailing newline — the other scripts' form).
  writeFileSync(outPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');

  // ── stdout: event count, the two hashes, and the gate verdict. NEVER a secret value.
  process.stdout.write(
    `Assembled ReplayBundle → ${outPath}\n` +
      `Public events (projected, payload-free): ${bundle.projectedEvents.length}\n` +
      `Annotations: ${bundle.annotations.length}\n` +
      `annotationHash: ${bundle.annotationHash}\n` +
      `bundleHash: ${bundleHash(bundle)}\n` +
      `Saga: ${cli ? 'real (claude -p CLI bake)' : real ? 'real (claude-opus-4-8 SDK bake)' : 'PLACEHOLDER (deferred real bake)'}\n` +
      `Publish gate: PASSED (scrubbed + approved)\n`,
  );
}

// Run only when invoked directly (never on import). Tests never import this file.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exitCode = 1;
  });
}
