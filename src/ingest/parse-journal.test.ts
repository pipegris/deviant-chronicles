import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// RED-PHASE acceptance test for Story 1.3 — Task 3: src/ingest/parse-journal.ts
// (the PURE raw-text -> raw-journal-record parser; the workflow-orchestrator journal is a
// DIFFERENT shape from the transcript — no timestamp, no message). Encodes AC1 (ingest/
// Zod-validates the second lifecycle stream) and AC3 (malformed/unknown record aborts
// LOUD with a located message). Import fails to resolve until the dev authors the module
// (RED).
import { parseJournal, RawJournalRecordSchema, type RawJournalRecord } from './parse-journal';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

describe('Story 1.3 / AC1 — parseJournal validates the journal stream into RawJournalRecord[]', () => {
  it('parses the committed journal fixture (started + result lifecycle records)', () => {
    const records = parseJournal(readFixture('sample-journal.jsonl'));
    expect(records).toHaveLength(2);
    expect(records.map((r: RawJournalRecord) => r.type)).toEqual(['started', 'result']);
  });

  it('emits records that satisfy RawJournalRecordSchema (Zod-validated at the boundary)', () => {
    const records = parseJournal(readFixture('sample-journal.jsonl'));
    for (const record of records) {
      expect(() => RawJournalRecordSchema.parse(record)).not.toThrow();
    }
  });

  it('carries the journal-specific shape: key + agentId present, NO timestamp/message', () => {
    // The journal is parsed SEPARATELY precisely because it lacks timestamp/message. Proving
    // those keys are absent on the raw record guards against accidentally reusing the
    // transcript schema here.
    const [started, result] = parseJournal(readFixture('sample-journal.jsonl'));
    expect(started.key).toBeTruthy();
    expect(started.agentId).toBeTruthy();
    expect('timestamp' in started).toBe(false);
    expect('message' in started).toBe(false);
    // The `result` record carries the nested result payload (status/verdict signal).
    expect(result.result).toBeDefined();
  });
});

describe('Story 1.3 / AC3 — a malformed/unknown journal record aborts LOUD with a located message', () => {
  it('throws (does NOT warn-and-skip) on an unknown journal record type', () => {
    expect(() => parseJournal(readFixture('malformed-journal.jsonl'))).toThrow();
  });

  it('throws a located message on a non-JSON line (the JSON.parse abort arm, not only the Zod arm)', () => {
    // The unknown-type fixture exercises the Zod-validation abort. This pins the OTHER
    // loud-abort arm — a line that is not valid JSON at all — which the journal parser
    // shares with the transcript parser but was previously only covered there. The bad
    // line is the SECOND line (0-based index 1) so the located message must say "line 1".
    const withBadJson =
      '{"type":"started","key":"k-1","agentId":"a-1"}\n{"type":"result", THIS_IS_NOT_VALID_JSON }';
    expect(() => parseJournal(withBadJson)).toThrow();
    let message = '';
    try {
      parseJournal(withBadJson);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message.toLowerCase()).toContain('ingest');
    expect(message.toLowerCase()).toContain('journal');
    expect(message).toMatch(/line\s*1\b/i);
  });

  it('names the journal and the offending line index in the error message', () => {
    // The unknown-type record is the SECOND line (0-based index 1). The message must say so.
    let message = '';
    try {
      parseJournal(readFixture('malformed-journal.jsonl'));
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message.toLowerCase()).toContain('journal');
    expect(message).toMatch(/line\s*1\b/i);
    expect(message.toLowerCase()).toContain('ingest');
  });
});
