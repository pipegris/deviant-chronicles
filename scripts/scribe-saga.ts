// OFFLINE authoring step. The browser reader is src/scribe/saga.ts (SDK-free). The thin argv/fs/stdout
// glue that authors ONE lush Tolkien-register Saga over a session's NAME-FREE SagaBrief (Story 5.8 — the
// payload-free projection + teaching; beats-less here, see briefFor) and writes the Saga text to disk as
// the artifact Story 5.2 folds into ReplayBundle.saga. The canonical bake (WITH real beats) is build-bundle.ts.
//
// BACKEND SELECTOR (CI-safe by default):
//   (no flag)  the PLACEHOLDER Saga — NO LLM, NO key, NO network (the dev/CI path).
//   --cli      inject the ClaudeCliClient into SagaAuthor — the `claude -p` CLI bake (no key).
//   --real     the lazy-SDK SagaAuthor — the deferred, BILLED ANTHROPIC_API_KEY bake.
// Or set BAKE_BACKEND=cli to select the CLI backend without the flag.
//
// ALL testable logic lives in src/scribe/saga-author.ts + src/llm/ (which `pnpm test` runs); this
// file carries no logic worth a unit test. Usage:
//   jiti scripts/scribe-saga.ts --transcript <path> --journal <path> --stream-id <id> \
//     --out <path> [--cli | --real] [--model <id>] [--prompt-version <v>]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NormalizedEvent } from '../src/schema/normalized-event';
import { parseTranscript } from '../src/ingest/parse-transcript';
import { parseJournal } from '../src/ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../src/ingest/normalize';
import { mergeStreams } from '../src/ingest/merge';
import { projectEvents } from '../src/bundle/project-events';
import { buildSagaBrief } from '../src/scribe/saga-brief';
import { TEACHING } from '../src/portal/teaching-config';

// Default saga model for the CLI/real bakes — claude-opus-4-8 is accepted by `claude --model`
// verbatim. Mirrors SagaAuthor's own DEFAULT_MODEL so stdout/notices are accurate.
const DEFAULT_SAGA_MODEL = 'claude-opus-4-8';

// The mocked-path placeholder Saga (matches build-bundle.ts) — a stand-in, NOT authored prose, so the
// default CI path needs no LLM/key. The --cli/--real bakes replace it with the lush claude-opus-4-8 Saga.
const PLACEHOLDER_SAGA =
  '«PLACEHOLDER SAGA — the real claude-opus-4-8 bake over the full scrubbed session is the deferred ' +
  'operator step. Run with --cli (claude -p, no key) or --real (ANTHROPIC_API_KEY) to author it.»';

// Stamps only the no-flag PLACEHOLDER bake; kept in lockstep with SagaAuthor.DEFAULT_PROMPT_VERSION so the
// placeholder artifact's provenance version isn't misleadingly stale. --cli/--real use author.promptVersion.
const DEFAULT_PROMPT_VERSION = 'saga-tolkien-v2';

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
    throw new Error(`scripts/scribe-saga.ts: missing required --${name} flag.`);
  }
  return value;
}

// Story 5.8 — build the NAME-FREE Saga brief over the public surface. This standalone baker has no interpret
// step, so it has NO beats: it passes `annotations: []` (a beats-less brief — the build-bundle.ts --cli path
// is the canonical bake WITH real beats; this is a convenience baker). It needs NO scrub step to be name-safe:
// projectEvents (Story 5.5) structurally drops payload/path/name (classifyRole discards the path; toolName is
// the abstract tool; outcome is a bool), so the projection is name-free BY CONSTRUCTION even over un-scrubbed
// events — adding a scrub dependency here would be scope-creep for no name-safety gain (Dev Notes §3, the
// PREFERRED minimal-correct choice). The teaching one-liners are the safe authored narrative material.
function briefFor(events: NormalizedEvent[]) {
  return buildSagaBrief({
    projectedEvents: projectEvents(events),
    annotations: [],
    teaching: TEACHING,
  });
}

// Resolve { saga, promptVersion } per backend. The SagaAuthor (and its SDK/CLI clients) is lazily
// imported ONLY on --cli/--real, so the default path pulls in no @anthropic-ai/sdk or node:child_process.
async function authorSaga(
  events: NormalizedEvent[],
  opts: { cli: boolean; real: boolean; model?: string; promptVersion?: string },
): Promise<{ saga: string; promptVersion: string }> {
  if (opts.cli) {
    const { SagaAuthor } = await import('../src/scribe/saga-author');
    const { ClaudeCliClient } = await import('../src/llm/claude-cli-client');
    process.stderr.write(
      `scripts/scribe-saga.ts --cli: authoring the Saga via \`claude -p\` ` +
        `(model ${opts.model ?? DEFAULT_SAGA_MODEL}, no ANTHROPIC_API_KEY).\n`,
    );
    const author = new SagaAuthor({
      client: new ClaudeCliClient(),
      model: opts.model,
      promptVersion: opts.promptVersion,
    });
    return { saga: await author.authorSaga(briefFor(events)), promptVersion: author.promptVersion };
  }

  if (opts.real) {
    const { SagaAuthor } = await import('../src/scribe/saga-author');
    process.stderr.write(
      `scripts/scribe-saga.ts --real: about to make a REAL, BILLED Anthropic call ` +
        `(model ${opts.model ?? DEFAULT_SAGA_MODEL}) over the resolved ANTHROPIC_API_KEY.\n`,
    );
    const author = new SagaAuthor({ model: opts.model, promptVersion: opts.promptVersion });
    return { saga: await author.authorSaga(briefFor(events)), promptVersion: author.promptVersion };
  }

  // Default (CI-safe): the placeholder — no LLM, no key, no network. No brief is built.
  return { saga: PLACEHOLDER_SAGA, promptVersion: opts.promptVersion ?? DEFAULT_PROMPT_VERSION };
}

async function main(argv: string[]): Promise<void> {
  const transcriptPath = requireFlag(argv, 'transcript');
  const journalPath = requireFlag(argv, 'journal');
  const streamId = requireFlag(argv, 'stream-id');
  const outPath = requireFlag(argv, 'out');
  const model = getFlag(argv, 'model');
  const promptVersionFlag = getFlag(argv, 'prompt-version');
  const cli = hasFlag(argv, 'cli') || process.env.BAKE_BACKEND === 'cli';
  const real = hasFlag(argv, 'real');

  // Anti-corruption: ingest parses + Zod-validates the raw JSONL; the author consumes the validated
  // NormalizedEvent[] only (R3). Journal events are sequenced just after the dev stream. This is the
  // SAME ingest path as scripts/interpret.ts — the Saga window is the full validated event set.
  const transcript = normalizeTranscript(
    parseTranscript(readFileSync(transcriptPath, 'utf8'), streamId),
    streamId,
  );
  const devMaxEpoch = Math.max(
    ...transcript.map((e) => Date.parse(e.timestamp)).filter((n) => !Number.isNaN(n)),
  );
  const journal = normalizeJournal(parseJournal(readFileSync(journalPath, 'utf8')), devMaxEpoch + 1);
  const events = mergeStreams([transcript, journal]);

  const { saga, promptVersion } = await authorSaga(events, {
    cli,
    real,
    model,
    promptVersion: promptVersionFlag,
  });

  // Write the Saga text as the artifact Story 5.2 folds into ReplayBundle.saga. JSON-stringify the
  // bare string so the on-disk form round-trips byte-stable into the bundle field (a plain string).
  writeFileSync(outPath, `${JSON.stringify(saga, null, 2)}\n`, 'utf8');
  process.stdout.write(`Wrote a ${saga.length}-char Saga (prompt ${promptVersion}) to ${outPath}\n`);
}

// Run only when invoked directly (never on import). Tests never import this file.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
