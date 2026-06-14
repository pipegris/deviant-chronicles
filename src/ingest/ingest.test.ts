import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NormalizedEventSchema, type NormalizedEvent } from '../schema/normalized-event';

// GREEN-phase dev-story unit tests + the COMMITTED ingest-level determinism snapshot the
// ATDD merge.test intentionally deferred (Story 1.3 Task 8). The full pipeline (parse ->
// normalize -> merge) runs over the committed redacted fixtures; the fs read lives HERE in
// the test (tests are not Layer-0 modules), keeping fs OUT of ingest/ (R2).
import { parseTranscript } from './parse-transcript';
import { parseJournal } from './parse-journal';
import { normalizeTranscript, normalizeJournal } from './normalize';
import { mergeStreams } from './merge';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

function runIngest(): NormalizedEvent[] {
  const transcript = normalizeTranscript(
    parseTranscript(readFixture('sample-transcript.jsonl'), DEV_STREAM_ID),
    DEV_STREAM_ID,
  );
  // Anchor the journal at the dev-phase boundary (Dev Notes "orderKey derivation"): just
  // after the max transcript epoch so the lifecycle records bracket their phase instead of
  // front-loading. The harness sees every stream, so it (not the pure normalize) computes
  // the epoch — keeping normalizeJournal free of cross-stream coupling.
  const devMaxEpoch = Math.max(
    ...transcript.map((e) => Date.parse(e.timestamp)).filter((n) => !Number.isNaN(n)),
  );
  const journal = normalizeJournal(parseJournal(readFixture('sample-journal.jsonl')), devMaxEpoch + 1);
  return mergeStreams([transcript, journal]);
}

describe('Story 1.3 — committed determinism snapshot of the merged NormalizedEvent[]', () => {
  it('matches the committed snapshot (the ingest-level determinism anchor, AC1)', () => {
    // This committed snapshot is the ingest-stage determinism guard; the full BattleTimeline
    // golden snapshot is Story 1.5. Any nondeterminism (a leaked clock, unstable key order,
    // a changed allowlist) flips this loudly.
    expect(runIngest()).toMatchSnapshot();
  });

  it('produces the expected merged event count from the fixture (12 transcript + 2 journal)', () => {
    // 12 kept transcript events (1 prompt + 1 text + 5 tool_use + 5 tool_result; thinking +
    // attachment dropped) + 2 journal lifecycle events.
    expect(runIngest()).toHaveLength(14);
  });
});

describe('Story 1.3 — orderKey invariants over the MERGED set (F1 + F2 regression)', () => {
  it('gives every event a unique eventId across the merged timeline (not just per stream)', () => {
    // F1: journal started + result share one raw `key`; the per-stream uniqueness test in
    // normalize.test.ts could not see the collision, so assert uniqueness over the MERGED set.
    const ids = runIngest().map((e) => e.eventId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('anchors journal lifecycle records at their phase boundary, not the timeline head', () => {
    // F2: with the dev-phase anchor threaded into normalizeJournal, the journal events must
    // sort AFTER the dev transcript phase (bracketing it) rather than front-loading to index 0.
    const merged = runIngest();
    const firstJournalIndex = merged.findIndex((e) => e.orderKey.streamId === 'orchestrator');
    const lastDevIndex = merged.map((e) => e.orderKey.streamId).lastIndexOf(DEV_STREAM_ID);
    expect(firstJournalIndex).toBeGreaterThan(0);
    expect(firstJournalIndex).toBeGreaterThan(lastDevIndex);
  });
});

describe('Story 1.3 — array-content tool_result is camelCased, no raw key leaks (F3 + F4 regression)', () => {
  it('camelCases nested tool_use_id/is_error inside an array-typed tool_result.content', () => {
    // F3: tool_result.content can be an ARRAY of raw content blocks; a verbatim spread would
    // leak tool_use_id/is_error past ingest/. F4: the fixture now carries exactly that shape,
    // so this guard is real, not vacuous.
    const arrayResult = runIngest().find(
      (e) => e.eventType === 'tool_result' && Array.isArray((e.payload as { content?: unknown })?.content),
    );
    expect(arrayResult).toBeDefined();
    const serialized = JSON.stringify(arrayResult);
    expect(serialized).not.toContain('tool_use_id');
    expect(serialized).not.toContain('is_error');
    expect(serialized).toContain('toolUseId');
    expect(serialized).toContain('isError');
  });
});

describe('Story 1.3 — normalize field mapping (camelCase, R3)', () => {
  it('maps the kickoff string-content record to a prompt event carrying the text in payload', () => {
    const events = runIngest();
    const prompts = events.filter((e) => e.eventType === 'prompt');
    expect(prompts).toHaveLength(1);
    expect(prompts[0].payload).toEqual({
      text: 'Kickoff: implement the ingest pipeline for Story 10.1.',
    });
    expect(prompts[0].toolName).toBeNull();
    expect(prompts[0].timestamp).toBe('2026-06-14T15:56:48.752Z');
  });

  it('carries tool_use input in payload and the tool name in toolName', () => {
    const events = runIngest();
    const read = events.find((e) => e.eventType === 'tool_use' && e.toolName === 'Read');
    expect(read).toBeDefined();
    expect(read?.payload).toEqual({ input: { file_path: '/work/project/src/schema/normalized-event.ts' } });
  });

  it('folds the journal opaque key into payload and derives subtype from result.status', () => {
    const events = runIngest();
    const result = events.find((e) => e.eventType === 'journal_result');
    expect(result).toBeDefined();
    expect('key' in (result as object)).toBe(false);
    expect(result?.payload).toEqual({
      result: { status: 'complete', verdict: 'pass' },
      key: 'phase-dev-OPAQUEHASH-1',
    });
    // status preferred over verdict as the Interpreter signal.
    expect(result?.subtype).toBe('complete');
    // started has no result -> null payload.result + null subtype.
    const started = events.find((e) => e.eventType === 'journal_started');
    expect(started?.subtype).toBeNull();
    expect(started?.payload).toEqual({ result: null, key: 'phase-dev-OPAQUEHASH-1' });
  });
});

describe('Story 1.3 — pure functions do not mutate their inputs (R2 determinism)', () => {
  it('mergeStreams returns fresh objects without mutating the per-stream arrays', () => {
    const transcript = normalizeTranscript(
      parseTranscript(readFixture('sample-transcript.jsonl'), DEV_STREAM_ID),
      DEV_STREAM_ID,
    );
    const journal = normalizeJournal(parseJournal(readFixture('sample-journal.jsonl')));
    const snapshotBefore = JSON.stringify([transcript, journal]);
    mergeStreams([transcript, journal]);
    // The provisional per-stream orderKeys must be untouched by the merge's clock rewrite.
    expect(JSON.stringify([transcript, journal])).toBe(snapshotBefore);
  });

  it('every merged event is NormalizedEventSchema-valid (validated emission)', () => {
    for (const event of runIngest()) {
      expect(() => NormalizedEventSchema.parse(event)).not.toThrow();
    }
  });
});
