// OFFLINE authoring step. The thin argv/fs/stdout glue that runs a BeatInterpreter over a session's
// NormalizedEvent[], freezes + content-addresses the annotations, and writes the frozen artifact
// (the seam Story 5.2 folds into the ReplayBundle).
//
// BACKEND SELECTOR (CI-safe by default):
//   (no flag)  the FixtureInterpreter — deterministic, NO LLM, NO key, NO network (the dev/CI path).
//   --cli      inject the ClaudeCliClient into ClaudeInterpreter — the `claude -p` CLI bake (no key).
//   --real     the lazy-SDK ClaudeInterpreter — the deferred, BILLED ANTHROPIC_API_KEY bake.
// Or set BAKE_BACKEND=cli to select the CLI backend without the flag.
//
// ALL testable logic lives in src/interpret/{claude-interpreter,freeze}.ts + src/llm/ (which
// `pnpm test` runs); this file carries no logic worth a unit test. Re-running with identical inputs
// yields the SAME annotationHash. Usage:
//   jiti scripts/interpret.ts --transcript <path> --journal <path> --stream-id <id> \
//     --out <path> [--cli | --real] [--model <id>] [--interpreter-version <v>] [--prompt-version <v>]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseTranscript } from '../src/ingest/parse-transcript';
import { parseJournal } from '../src/ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../src/ingest/normalize';
import { mergeStreams } from '../src/ingest/merge';
import { FixtureInterpreter } from '../src/interpret/fixture-interpreter';
import type { BeatInterpreter } from '../src/interpret/beat-interpreter';
import { freezeAnnotations } from '../src/interpret/freeze';

// Default interpreter model for the CLI/real bakes — claude-sonnet-4-6 is accepted by `claude --model`
// verbatim. Mirrors ClaudeInterpreter's own DEFAULT_MODEL so stdout/notices are accurate.
const DEFAULT_INTERPRETER_MODEL = 'claude-sonnet-4-6';

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
    throw new Error(`scripts/interpret.ts: missing required --${name} flag.`);
  }
  return value;
}

// The frozen artifact stamps interpreterVersion/promptVersion (the annotationHash inputs), so the
// chosen interpreter must expose both. FixtureInterpreter does not, so the default path wraps it
// with the same 'fixture-v1' stamp the FixtureInterpreter writes into each annotation (matches
// build-bundle.ts) — keeping the run-identity key consistent with the embedded annotations.
type StampedInterpreter = BeatInterpreter & {
  readonly interpreterVersion: string;
  readonly promptVersion: string;
};

const FIXTURE_VERSION = 'fixture-v1';

interface BackendOptions {
  cli: boolean;
  real: boolean;
  model?: string;
  interpreterVersion?: string;
  promptVersion?: string;
}

async function resolveInterpreter(opts: BackendOptions): Promise<StampedInterpreter> {
  if (opts.cli) {
    // The CLI bake: inject the `claude -p` adapter into the real ClaudeInterpreter — same structured
    // request, no ANTHROPIC_API_KEY. Both modules lazy-imported so neither touches the default path.
    const { ClaudeInterpreter } = await import('../src/interpret/claude-interpreter');
    const { ClaudeCliClient } = await import('../src/llm/claude-cli-client');
    process.stderr.write(
      `scripts/interpret.ts --cli: running the interpreter via \`claude -p\` ` +
        `(model ${opts.model ?? DEFAULT_INTERPRETER_MODEL}, no ANTHROPIC_API_KEY).\n`,
    );
    return new ClaudeInterpreter({
      client: new ClaudeCliClient(),
      model: opts.model,
      interpreterVersion: opts.interpreterVersion,
      promptVersion: opts.promptVersion,
    });
  }

  if (opts.real) {
    // The deferred, BILLED bake — no injected client → ClaudeInterpreter lazily constructs the real
    // SDK client (reads ANTHROPIC_API_KEY from env).
    const { ClaudeInterpreter } = await import('../src/interpret/claude-interpreter');
    process.stderr.write(
      `scripts/interpret.ts --real: about to make a REAL, BILLED Anthropic call ` +
        `(model ${opts.model ?? DEFAULT_INTERPRETER_MODEL}) over the resolved ANTHROPIC_API_KEY.\n`,
    );
    return new ClaudeInterpreter({
      model: opts.model,
      interpreterVersion: opts.interpreterVersion,
      promptVersion: opts.promptVersion,
    });
  }

  // Default (CI-safe): the deterministic FixtureInterpreter — NO LLM, NO key, NO network.
  const interpreter = new FixtureInterpreter();
  return Object.assign(interpreter, {
    interpreterVersion: opts.interpreterVersion ?? FIXTURE_VERSION,
    promptVersion: opts.promptVersion ?? FIXTURE_VERSION,
  });
}

async function main(argv: string[]): Promise<void> {
  const transcriptPath = requireFlag(argv, 'transcript');
  const journalPath = requireFlag(argv, 'journal');
  const streamId = requireFlag(argv, 'stream-id');
  const outPath = requireFlag(argv, 'out');
  const model = getFlag(argv, 'model');
  const interpreterVersion = getFlag(argv, 'interpreter-version');
  const promptVersion = getFlag(argv, 'prompt-version');
  const cli = hasFlag(argv, 'cli') || process.env.BAKE_BACKEND === 'cli';
  const real = hasFlag(argv, 'real');

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

  // Backend selection. The SDK-backed ClaudeInterpreter is lazily imported ONLY on --cli/--real so
  // @anthropic-ai/sdk and node:child_process never load on the default CI path (and so jiti never
  // resolves them when not needed).
  const interpreter = await resolveInterpreter({ cli, real, model, interpreterVersion, promptVersion });
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
