// OUT-OF-BAND quality eval — requires ANTHROPIC_API_KEY; NEVER gates CI.
// Runs the real ClaudeInterpreter over a session, scores its output against an expected
// (hand-graded) annotation set via the PURE evaluateTagging scorer, and prints the EvalReport.
// It is NOT referenced by package.json test/build, and (being under scripts/) is not matched by
// vitest.config.ts's include ['src/**/*.test.ts'] — so it never blocks the build. The report is
// the SIGNAL that tells the operator whether to escalate to claude-opus-4-8 (--model). Usage:
//   jiti scripts/eval-interpreter.ts --transcript <p> --journal <p> --stream-id <id> \
//     --expected <expected-annotations.json> [--model claude-opus-4-8]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { BeatAnnotationSchema, type BeatAnnotation } from '../src/schema/beat-annotation';
import { parseTranscript } from '../src/ingest/parse-transcript';
import { parseJournal } from '../src/ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../src/ingest/normalize';
import { mergeStreams } from '../src/ingest/merge';
import { ClaudeInterpreter } from '../src/interpret/claude-interpreter';
import { evaluateTagging } from '../src/interpret/eval';

function getFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function requireFlag(argv: string[], name: string): string {
  const value = getFlag(argv, name);
  if (value === undefined) {
    throw new Error(`scripts/eval-interpreter.ts: missing required --${name} flag.`);
  }
  return value;
}

async function main(argv: string[]): Promise<void> {
  const transcriptPath = requireFlag(argv, 'transcript');
  const journalPath = requireFlag(argv, 'journal');
  const streamId = requireFlag(argv, 'stream-id');
  const expectedPath = requireFlag(argv, 'expected');
  const model = getFlag(argv, 'model');

  // The expected set is operator-graded ground truth, so Zod-validate it as BeatAnnotation[].
  const expected: BeatAnnotation[] = z
    .array(BeatAnnotationSchema)
    .parse(JSON.parse(readFileSync(expectedPath, 'utf8')));

  const transcript = normalizeTranscript(
    parseTranscript(readFileSync(transcriptPath, 'utf8'), streamId),
    streamId,
  );
  const devMaxEpoch = Math.max(
    ...transcript.map((e) => Date.parse(e.timestamp)).filter((n) => !Number.isNaN(n)),
  );
  const journal = normalizeJournal(parseJournal(readFileSync(journalPath, 'utf8')), devMaxEpoch + 1);
  const events = mergeStreams([transcript, journal]);

  const actual = await new ClaudeInterpreter({ model }).interpret(events);
  const report = evaluateTagging({ expected, actual });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

// Run only when invoked directly (never on import). Tests never import this file.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
