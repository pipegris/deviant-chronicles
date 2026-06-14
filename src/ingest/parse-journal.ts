/// <reference lib="es2022.error" />
// ^ See parse-transcript.ts: file-local ES2022 Error typing for `new Error(msg, { cause })`
// under the tsconfig's `lib: ES2020`, so the loud-abort errors preserve their cause.
import { z } from 'zod';

// The R3 boundary for the SECOND lifecycle stream — the workflow-orchestrator journal.
// Parsed SEPARATELY from the transcript because it is a different shape: no `timestamp`,
// no `message`, just phase lifecycle. PURE (R2): the fs read lives in the test/harness.

// `result` is present on `result` records (carries status/verdict + story metadata) and
// absent on `started`. The opaque `key` hash is folded into payload at normalize time, not
// leaked as a top-level NormalizedEvent field (AC3).
export const RawJournalRecordSchema = z.object({
  type: z.enum(['started', 'result']),
  key: z.string(),
  agentId: z.string(),
  result: z.record(z.string(), z.unknown()).optional(),
});
export type RawJournalRecord = z.infer<typeof RawJournalRecordSchema>;

/**
 * Parse + Zod-validate the workflow-journal JSONL string into RawJournalRecord[].
 *
 * PURE. Blank lines are skipped. A malformed line or an unknown record type throws LOUD
 * with a located message (AC3) — the journal `type` enum rejects anything but
 * started/result, so a stray record aborts the build rather than corrupting the timeline.
 */
export function parseJournal(jsonl: string): RawJournalRecord[] {
  const lines = jsonl.split('\n');
  const records: RawJournalRecord[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (line.trim() === '') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Ingest: malformed journal record at line ${lineIndex} — ${detail}`, {
        cause: err,
      });
    }

    try {
      records.push(RawJournalRecordSchema.parse(parsed));
    } catch (err) {
      // .parse so an unknown record type throws a ZodError; re-wrap with the located,
      // Zod-rooted message (AC3), preserving the original error as `cause`.
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      throw new Error(`Ingest: malformed journal record at line ${lineIndex} — ${detail}`, {
        cause: err,
      });
    }
  }

  return records;
}
