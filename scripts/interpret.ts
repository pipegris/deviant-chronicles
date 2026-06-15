// OFFLINE OPERATOR STEP — requires ANTHROPIC_API_KEY (see .env.example); NOT run in dev/CI.
// The CI double for all Layer-1 tests is the FixtureInterpreter (Story 3.1). This is the thin
// argv/fs/stdout glue for the DEFERRED real bake (Epic 5 / Story 5.2 bundle assembly): it runs
// the real ClaudeInterpreter over a session's NormalizedEvent[], freezes + content-addresses the
// annotations, and writes the frozen artifact (the seam Story 5.2 folds into the ReplayBundle).
//
// ALL testable logic lives in src/interpret/{claude-interpreter,freeze}.ts (which `pnpm test`
// runs); this file carries no logic worth a unit test. Re-running with identical inputs yields
// the SAME annotationHash. Usage:
//   jiti scripts/interpret.ts --transcript <path> --journal <path> --stream-id <id> \
//     --out <path> [--model claude-opus-4-8] [--interpreter-version <v>] [--prompt-version <v>]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseTranscript } from '../src/ingest/parse-transcript';
import { parseJournal } from '../src/ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../src/ingest/normalize';
import { mergeStreams } from '../src/ingest/merge';
import { ClaudeInterpreter } from '../src/interpret/claude-interpreter';
import { freezeAnnotations } from '../src/interpret/freeze';

function getFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function requireFlag(argv: string[], name: string): string {
  const value = getFlag(argv, name);
  if (value === undefined) {
    throw new Error(`scripts/interpret.ts: missing required --${name} flag.`);
  }
  return value;
}

async function main(argv: string[]): Promise<void> {
  const transcriptPath = requireFlag(argv, 'transcript');
  const journalPath = requireFlag(argv, 'journal');
  const streamId = requireFlag(argv, 'stream-id');
  const outPath = requireFlag(argv, 'out');
  const model = getFlag(argv, 'model');
  const interpreterVersion = getFlag(argv, 'interpreter-version');
  const promptVersion = getFlag(argv, 'prompt-version');

  // Anti-corruption: ingest parses + Zod-validates the raw JSONL; the interpreter consumes the
  // validated NormalizedEvent[] only (R3). Journal events are sequenced just after the dev stream.
  const transcript = normalizeTranscript(
    parseTranscript(readFileSync(transcriptPath, 'utf8'), streamId),
    streamId,
  );
  const devMaxEpoch = Math.max(
    ...transcript.map((e) => Date.parse(e.timestamp)).filter((n) => !Number.isNaN(n)),
  );
  const journal = normalizeJournal(parseJournal(readFileSync(journalPath, 'utf8')), devMaxEpoch + 1);
  const events = mergeStreams([transcript, journal]);

  // No injected client → ClaudeInterpreter lazily constructs the real SDK client (reads
  // ANTHROPIC_API_KEY from env). THIS is the single real call — the deferred operator step.
  const interpreter = new ClaudeInterpreter({ model, interpreterVersion, promptVersion });
  // Loud heads-up before the lazy `new Anthropic()` — this is a real, BILLED Anthropic call (F6).
  process.stderr.write(
    `scripts/interpret.ts: about to make a REAL, BILLED Anthropic call (model ${model ?? 'claude-sonnet-4-6'}) ` +
      'over the resolved ANTHROPIC_API_KEY — the deferred operator bake, never run in dev/CI.\n',
  );
  const annotations = await interpreter.interpret(events);

  const frozen = freezeAnnotations({
    normalizedEvents: events,
    annotations,
    interpreterVersion: interpreter.interpreterVersion,
    promptVersion: interpreter.promptVersion,
  });

  writeFileSync(outPath, `${JSON.stringify(frozen, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `Wrote ${frozen.annotations.length} frozen annotations (hash ${frozen.annotationHash}) to ${outPath}\n`,
  );
}

// Run only when invoked directly (never on import). Tests never import this file.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
