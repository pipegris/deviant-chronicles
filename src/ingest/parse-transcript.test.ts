import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// RED-PHASE acceptance test for Story 1.3 — Task 2: src/ingest/parse-transcript.ts
// (the PURE raw-text -> raw-record parser at the R3 anti-corruption boundary). Encodes
// AC1 (ONLY ingest/ parses + Zod-validates the raw JSONL) and AC3 (a malformed/unknown
// raw record aborts the build LOUD with a clear, located message — fail LOUD, never
// warn-and-skip). The implementation does not exist yet, so the import below fails to
// resolve and these tests ERROR (RED). When the dev authors parse-transcript.ts with the
// exact signature the story requires, this file turns GREEN unchanged.
//
// fs lives in the TEST (allowed — tests are not Layer-0 modules), keeping fs OUT of
// ingest/ so the R2 purity boundary holds for the parser itself.
import { parseTranscript, RawTranscriptRecordSchema } from './parse-transcript';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

describe('Story 1.3 / AC1 — parseTranscript validates raw JSONL into RawTranscriptRecord[]', () => {
  it('parses every non-blank line of the committed redacted fixture', () => {
    const records = parseTranscript(readFixture('sample-transcript.jsonl'), DEV_STREAM_ID);
    // The fixture has 12 records (1 kickoff user + assistant/user turns, incl. an
    // array-content tool_result, + 1 attachment).
    expect(records).toHaveLength(12);
    expect(records[0].type).toBe('user');
    expect(records[records.length - 1].type).toBe('attachment');
  });

  it('skips blank lines instead of throwing on them', () => {
    const withBlanks = '\n' + readFixture('sample-transcript.jsonl').trim() + '\n\n';
    const records = parseTranscript(withBlanks, DEV_STREAM_ID);
    expect(records).toHaveLength(12);
  });

  it('emits records that satisfy RawTranscriptRecordSchema (Zod-validated at the boundary)', () => {
    // AC1: ingest/ Zod-validates the untrusted shape. Re-parsing each returned record with
    // the exported raw schema proves validation actually ran (a pass-through that skipped
    // Zod would still let a malformed record reach this assertion).
    const records = parseTranscript(readFixture('sample-transcript.jsonl'), DEV_STREAM_ID);
    for (const record of records) {
      expect(() => RawTranscriptRecordSchema.parse(record)).not.toThrow();
    }
  });

  it('accepts string message.content AND array message.content (both real shapes)', () => {
    const records = parseTranscript(readFixture('sample-transcript.jsonl'), DEV_STREAM_ID);
    const kickoff = records[0];
    const assistantTurn = records[1];
    // The kickoff user record carries a plain string; assistant turns carry an array.
    expect(typeof (kickoff.message as { content: unknown }).content).toBe('string');
    expect(Array.isArray((assistantTurn.message as { content: unknown }).content)).toBe(true);
  });
});

describe('Story 1.3 / AC3 — a malformed transcript record aborts LOUD with a located message', () => {
  it('throws (does NOT warn-and-skip) when a line is not valid JSON', () => {
    // Fail-LOUD at the build-time boundary: malformed input must throw, never be skipped.
    expect(() =>
      parseTranscript(readFixture('malformed-transcript.jsonl'), DEV_STREAM_ID),
    ).toThrow();
  });

  it('names the stream id and the offending line in the error message', () => {
    // The message must locate the failure: stream + line index (the malformed line is the
    // SECOND line of the fixture). Asserting both keeps the build error actionable (AC3).
    let message = '';
    try {
      parseTranscript(readFixture('malformed-transcript.jsonl'), DEV_STREAM_ID);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain(DEV_STREAM_ID);
    expect(message).toMatch(/line\s*1\b/i); // 0-based index of the 2nd line
    expect(message.toLowerCase()).toContain('ingest');
  });

  it('aborts LOUD with a located message on an unparseable timestamp (not a bare ZodError)', () => {
    // F6: Date.parse on a junk timestamp returns NaN; without boundary validation it would
    // escape as a generic ZodError on emission with no Ingest:/stream/line context. The raw
    // schema now refines timestamp to a parseable date, so this routes through the located
    // abort message (AC3).
    const badTimestamp = JSON.stringify({
      type: 'user',
      uuid: 'x',
      parentUuid: null,
      timestamp: 'not-a-real-date',
      agentId: 'a',
      isSidechain: true,
      sessionId: 's',
      cwd: '/work/project',
      gitBranch: 'main',
      message: { role: 'user', content: 'hi' },
    });
    let message = '';
    expect(() => parseTranscript(badTimestamp, DEV_STREAM_ID)).toThrow();
    try {
      parseTranscript(badTimestamp, DEV_STREAM_ID);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message.toLowerCase()).toContain('ingest');
    expect(message).toContain(DEV_STREAM_ID);
    expect(message).toMatch(/line\s*0\b/i);
  });

  it('throws a ZodError-rooted failure on a schema-invalid record (uses .parse, not swallowed .safeParse)', () => {
    // A record that is valid JSON but the wrong shape must still abort. Using a record
    // missing the required `type` discriminator proves Zod .parse() bit (AC1/AC3).
    const badShape = JSON.stringify({ uuid: 'x', timestamp: '2026-01-01T00:00:00.000Z' });
    expect(() => parseTranscript(badShape, DEV_STREAM_ID)).toThrow();
    // The thrown error must be (or wrap) a Zod validation failure, not a generic TypeError.
    let caught: unknown;
    try {
      parseTranscript(badShape, DEV_STREAM_ID);
    } catch (err) {
      caught = err;
    }
    const text = caught instanceof Error ? `${caught.name} ${caught.message}` : String(caught);
    const isZodRooted = caught instanceof z.ZodError || /zod/i.test(text);
    expect(isZodRooted).toBe(true);
  });
});
