import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NormalizedEventSchema, type NormalizedEvent } from '../schema/normalized-event';

// RED-PHASE acceptance test for Story 1.3 — Task 5 + Task 8 e2e: src/ingest/merge.ts
// (PURE stable merge -> single total order) end-to-end over the committed fixtures. Encodes:
//   AC2 — orderKey = (logicalClock, streamId, seqWithinStream) yields a single TOTAL order
//         via a pure stable sort; wall-clock alone is NOT the order key. After merge,
//         logicalClock is rewritten to the dense 0..n-1 merged index.
//   AC1 — same input -> byte-identical NormalizedEvent[] (determinism), asserted via
//         JSON.stringify(run1) === JSON.stringify(run2).
// merge.ts does not exist yet, so the import fails to resolve and these tests ERROR (RED).
//
// NOTE on the determinism anchor: Story 1.3 Task 8 also calls for a COMMITTED Vitest
// snapshot of the merged list. That snapshot is intentionally authored in the GREEN
// (dev-story) phase — toMatchSnapshot() writes-then-passes on first run, which would be a
// false green here in the RED phase. The byte-identical equality assertion below encodes
// the SAME determinism invariant without auto-passing, so this file stays meaningfully RED.
//
// fs is used in the TEST only (allowed); it stays OUT of ingest/ (R2 purity).
import { parseTranscript } from './parse-transcript';
import { parseJournal } from './parse-journal';
import { normalizeTranscript, normalizeJournal } from './normalize';
import { mergeStreams } from './merge';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

// The full ingest pipeline over the committed redacted fixtures: parse -> normalize ->
// merge. fs read happens HERE in the test, never inside ingest/ (R2).
function runIngest(): NormalizedEvent[] {
  const transcript = normalizeTranscript(
    parseTranscript(readFixture('sample-transcript.jsonl'), DEV_STREAM_ID),
    DEV_STREAM_ID,
  );
  const journal = normalizeJournal(parseJournal(readFixture('sample-journal.jsonl')));
  return mergeStreams([transcript, journal]);
}

describe('Story 1.3 / AC2 — mergeStreams produces a single total order', () => {
  it('returns every event from every input stream (concat, none dropped)', () => {
    const transcript = normalizeTranscript(
      parseTranscript(readFixture('sample-transcript.jsonl'), DEV_STREAM_ID),
      DEV_STREAM_ID,
    );
    const journal = normalizeJournal(parseJournal(readFixture('sample-journal.jsonl')));
    const merged = mergeStreams([transcript, journal]);
    expect(merged).toHaveLength(transcript.length + journal.length);
  });

  it('rewrites logicalClock to a dense, gap-free 0..n-1 merged index', () => {
    const merged = runIngest();
    merged.forEach((event, index) => {
      expect(event.orderKey.logicalClock).toBe(index);
    });
  });

  it('orders strictly by the composite key (logicalClock, streamId, seqWithinStream)', () => {
    // A TOTAL order: for every adjacent pair the composite key is strictly increasing.
    // Never returns 0 for distinct events, so the result does not depend on sort stability.
    const merged = runIngest();
    for (let i = 1; i < merged.length; i++) {
      const prev = merged[i - 1].orderKey;
      const curr = merged[i].orderKey;
      const before =
        prev.logicalClock < curr.logicalClock ||
        (prev.logicalClock === curr.logicalClock &&
          (prev.streamId < curr.streamId ||
            (prev.streamId === curr.streamId &&
              prev.seqWithinStream < curr.seqWithinStream)));
      expect(before).toBe(true);
    }
  });

  it('preserves origin provenance: streamId + seqWithinStream survive the merge', () => {
    const merged = runIngest();
    const streamIds = new Set(merged.map((e) => e.orderKey.streamId));
    // Both origin streams remain identifiable after merge.
    expect(streamIds.has(DEV_STREAM_ID)).toBe(true);
    expect(streamIds.has('orchestrator')).toBe(true);
  });

  it('does not order by wall-clock alone — the journal (timestamp "") still places in the total order', () => {
    // AC2: wall-clock alone is NOT the order key. Journal events carry timestamp "" yet must
    // still receive a well-defined logicalClock position — proof ordering is driven by the
    // composite orderKey, not the timestamp string.
    const merged = runIngest();
    const journalEvents = merged.filter((e) => e.orderKey.streamId === 'orchestrator');
    expect(journalEvents.length).toBeGreaterThan(0);
    for (const event of journalEvents) {
      expect(event.timestamp).toBe('');
      expect(Number.isInteger(event.orderKey.logicalClock)).toBe(true);
    }
  });
});

describe('Story 1.3 / AC2 — the merge comparator is TOTAL across all three orderKey arms', () => {
  // The fixture-driven ordering test only ever exercises the logicalClock arm (pre-merge
  // clocks are distinct, and post-merge they are rewritten dense 0..n-1). These synthetic
  // inputs force ties on logicalClock so the streamId arm decides, and ties on
  // logicalClock+streamId so the seqWithinStream arm decides — pinning the AC2 guarantee
  // that the comparator is TOTAL (never returns 0 for distinct events) rather than relying
  // on Array.sort stability. Fed straight to mergeStreams (pure, no fs).
  function ev(logicalClock: number, streamId: string, seqWithinStream: number): NormalizedEvent {
    return {
      orderKey: { logicalClock, streamId, seqWithinStream },
      eventId: `${streamId}:${logicalClock}:${seqWithinStream}`,
      eventType: 'text',
      toolName: null,
      subtype: null,
      timestamp: '',
      streamDepth: 0,
      exitCode: null,
      isError: false,
      retryCount: 0,
      payload: null,
    };
  }

  it('breaks a logicalClock tie deterministically by streamId, regardless of input order', () => {
    // Same provisional clock, different streams. Provide them in REVERSE streamId order so a
    // stability-only sort that left them as-is would fail; a total comparator reorders them.
    const merged = mergeStreams([[ev(5, 'zzz', 0)], [ev(5, 'aaa', 0)]]);
    // streamId is preserved as provenance; assert it sorted aaa-before-zzz.
    expect(merged.map((e) => e.orderKey.streamId)).toEqual(['aaa', 'zzz']);
    // logicalClock is rewritten dense, but the relative order is the comparator's decision.
    expect(merged.map((e) => e.orderKey.logicalClock)).toEqual([0, 1]);
  });

  it('breaks a logicalClock+streamId tie deterministically by seqWithinStream', () => {
    // Identical clock and stream; only seqWithinStream distinguishes. Provide reversed.
    const merged = mergeStreams([[ev(7, 's', 2), ev(7, 's', 0), ev(7, 's', 1)]]);
    expect(merged.map((e) => e.orderKey.seqWithinStream)).toEqual([0, 1, 2]);
  });

  it('never collapses two distinct events into the same merged position (total order)', () => {
    // Three events that tie on the first two arms — a comparator returning 0 (non-total)
    // would risk a stability-dependent or arbitrary order. Assert all three land at distinct
    // dense logicalClocks AND the count is preserved (none merged/dropped).
    const merged = mergeStreams([[ev(1, 's', 1)], [ev(1, 's', 0)], [ev(1, 's', 2)]]);
    expect(merged).toHaveLength(3);
    expect(new Set(merged.map((e) => e.orderKey.logicalClock)).size).toBe(3);
  });
});

describe('Story 1.3 / AC1 — ingest output is deterministic (byte-identical across runs)', () => {
  it('yields a byte-identical NormalizedEvent[] on a second run over the same fixtures', () => {
    const run1 = runIngest();
    const run2 = runIngest();
    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });

  it('emits a fully NormalizedEventSchema-valid merged timeline (validated emission, AC1)', () => {
    for (const event of runIngest()) {
      expect(() => NormalizedEventSchema.parse(event)).not.toThrow();
    }
  });
});
