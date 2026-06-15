// OFFLINE OPERATOR STEP — the privacy guardrail's CLI driver; NOT run in dev/CI. NO LLM, NO network, NO
// ANTHROPIC_API_KEY (the scrub is pattern-based, unlike scripts/interpret.ts / scripts/scribe-saga.ts).
//
// This is the thin argv/fs/stdout glue for the secret/PII scrub: it runs the PURE scrubSession over a
// session's NormalizedEvent[], writes the SCRUBBED Session copy + the MANUAL-REVIEW report to disk, and
// prints per-category redaction counts + the candidate count + the scrubHash + a CLEAR operator
// instruction. ALL testable logic lives in src/scrub/ (which `pnpm test` runs); this file carries no
// logic worth a unit test (vitest include is src/**/*.test.ts — the Story 3.2 thin-script precedent).
//
// THE DEFERRED OPERATOR STEP (Dev Notes "Data-source reality"): the real scrub over the git-ignored
// .sources/story-10-1/* session (which DOES carry real secrets/home-paths) is run HERE, by hand, before
// publishing — then a human READS the report and authors a ScrubApproval marker bound to the printed
// scrubHash (the gate, src/scrub/gate.ts, enforces that a matching marker EXISTS at bundle time, Story 5.2).
// Usage:
//   jiti scripts/scrub.ts --transcript <path> --journal <path> --stream-id <id> \
//     --out-scrubbed <path> --out-report <path> [--patterns <path>]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseTranscript } from '../src/ingest/parse-transcript';
import { parseJournal } from '../src/ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../src/ingest/normalize';
import { mergeStreams } from '../src/ingest/merge';
import { scrubSession } from '../src/scrub/scrub';
import {
  COMPILED_SCRUB_PATTERNS,
  ScrubPatternsSchema,
  compileScrubPatterns,
  type CompiledScrubPattern,
} from '../src/scrub/scrub-patterns';

function getFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function requireFlag(argv: string[], name: string): string {
  const value = getFlag(argv, name);
  if (value === undefined) {
    throw new Error(`scripts/scrub.ts: missing required --${name} flag.`);
  }
  return value;
}

function main(argv: string[]): void {
  const transcriptPath = requireFlag(argv, 'transcript');
  const journalPath = requireFlag(argv, 'journal');
  const streamId = requireFlag(argv, 'stream-id');
  const outScrubbedPath = requireFlag(argv, 'out-scrubbed');
  const outReportPath = requireFlag(argv, 'out-report');
  const patternsPath = getFlag(argv, 'patterns');

  // Anti-corruption (R3): ingest parses + Zod-validates the raw JSONL; the scrub consumes the validated
  // NormalizedEvent[] only — NO second raw-JSONL parser. This is the SAME ingest path as
  // scripts/interpret.ts / scripts/scribe-saga.ts (journal sequenced just after the dev stream).
  const transcript = normalizeTranscript(
    parseTranscript(readFileSync(transcriptPath, 'utf8'), streamId),
    streamId,
  );
  const devMaxEpoch = Math.max(
    ...transcript.map((e) => Date.parse(e.timestamp)).filter((n) => !Number.isNaN(n)),
  );
  const journal = normalizeJournal(parseJournal(readFileSync(journalPath, 'utf8')), devMaxEpoch + 1);
  const events = mergeStreams([transcript, journal]);

  // An optional override deny set (a JSON file in the scrub-patterns.json shape) — validated + compiled
  // fail-closed (a bad file throws LOUD). Defaults to the committed COMPILED_SCRUB_PATTERNS.
  const patterns: CompiledScrubPattern[] = patternsPath
    ? compileScrubPatterns(ScrubPatternsSchema.parse(JSON.parse(readFileSync(patternsPath, 'utf8'))))
    : COMPILED_SCRUB_PATTERNS;

  const { scrubbedEvents, report, scrubHash } = scrubSession(events, patterns);

  // JSON, 2-space, trailing newline — the scripts/scribe-saga.ts on-disk form (byte-stable round-trip).
  writeFileSync(outScrubbedPath, `${JSON.stringify(scrubbedEvents, null, 2)}\n`, 'utf8');
  writeFileSync(outReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  // Print the SUMMARY only — counts/locations/candidate-count + the scrubHash + the operator instruction.
  // NEVER a secret value (the report itself carries none; this echo mirrors that no-leak posture).
  const countsLine = report.redactions.length
    ? report.redactions.map((r) => `${r.category}=${r.count}`).join(', ')
    : '(none)';
  process.stdout.write(
    `Scrubbed ${scrubbedEvents.length} events → ${outScrubbedPath}\n` +
      `Redactions by category: ${countsLine}\n` +
      `Suspicious-but-unmatched candidates (need human eyes): ${report.candidates.length}\n` +
      `Report → ${outReportPath}\n` +
      `scrubHash: ${scrubHash}\n` +
      `OPERATOR: review ${outReportPath}, then create a ScrubApproval marker bound to scrubHash ${scrubHash} before publishing.\n`,
  );
}

// Run only when invoked directly (never on import). Tests never import this file.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err: unknown) {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exitCode = 1;
  }
}
