import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { BeatAnnotation } from '../schema/beat-annotation';
import { type NormalizedEvent } from '../schema/normalized-event';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';
import { freezeAnnotations } from './freeze';
import { ClaudeInterpreter } from './claude-interpreter';

// Story 10.1 — the REAL ClaudeInterpreter must be robust to a HALLUCINATED / dangling eventRef.
// Over a 600+ event bake the LLM occasionally invents an eventId; its output is UNTRUSTED LLM data
// and must be sanitized against the authoritative grounding id set BEFORE it reaches freezeAnnotations
// (which stays fail-loud). These tests drive the sanitize seam with a mocked client (zero network):
// (a) a valid annotation is kept intact, (b) an annotation whose primary eventRef is hallucinated is
// DROPPED, (c) an annotation with a mix of valid + dangling groundingPointer.eventRefs is kept with
// ONLY the valid refs (never empty), and the returned set is fully resolvable against groundingEvents.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'ingest', '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

function runIngest(): NormalizedEvent[] {
  const transcript = normalizeTranscript(
    parseTranscript(readFixture('sample-transcript.jsonl'), DEV_STREAM_ID),
    DEV_STREAM_ID,
  );
  const devMaxEpoch = Math.max(
    ...transcript.map((e) => Date.parse(e.timestamp)).filter((n) => !Number.isNaN(n)),
  );
  const journal = normalizeJournal(parseJournal(readFixture('sample-journal.jsonl')), devMaxEpoch + 1);
  return mergeStreams([transcript, journal]);
}

// A hallucinated id in the shape of a real eventId but absent from the ingest — the exact failure
// mode that fail-loud-blocked the real bake (e.g. an LLM-invented ref like `492dfac6-…#0`).
const HALLUCINATED = 'deadbeef-not-a-real-event#0';
const HALLUCINATED_2 = 'cafebabe-also-fake#7';

// (a) valid: anchor + grounding all resolve to real fixture eventIds.
const VALID: BeatAnnotation = {
  eventRef: 'u-0002#1',
  beatType: 'dispel',
  confidence: 0.8,
  interpreterVersion: 'mock',
  sourceHash: 'mock',
  groundingPointer: { eventRefs: ['u-0002#1', 'u-0002#2', 'u-0003#0'] },
};

// (b) hallucinated primary eventRef → the whole annotation must be DROPPED (cannot be grounded).
const HALLUCINATED_PRIMARY: BeatAnnotation = {
  eventRef: HALLUCINATED,
  beatType: 'shaman',
  confidence: 0.7,
  interpreterVersion: 'mock',
  sourceHash: 'mock',
  groundingPointer: { eventRefs: [HALLUCINATED, 'u-0010#0'] },
};

// (c) valid primary, but groundingPointer mixes valid + dangling refs → KEPT with only the valid refs.
const MIXED_GROUNDING: BeatAnnotation = {
  eventRef: 'u-0010#0',
  beatType: 'shaman',
  confidence: 0.6,
  interpreterVersion: 'mock',
  sourceHash: 'mock',
  groundingPointer: { eventRefs: ['u-0009#0', HALLUCINATED, 'u-0010#0', HALLUCINATED_2] },
};

interface FakeContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface FakeClient {
  messages: { create(body: Record<string, unknown>): Promise<{ content: FakeContentBlock[] }> };
  calls: Array<Record<string, unknown>>;
}

function fakeReturning(annotations: BeatAnnotation[]): FakeClient {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    messages: {
      async create(body: Record<string, unknown>) {
        calls.push(body);
        return {
          content: [
            { type: 'tool_use', id: 'toolu_mock', name: 'emit_beat_annotations', input: { annotations } },
          ],
        };
      },
    },
  };
}

// Silence the (expected) console.warn the sanitizer emits, and let tests assert on it.
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

describe('Story 10.1 — ClaudeInterpreter sanitizes hallucinated / dangling refs (untrusted LLM data)', () => {
  it('keeps a fully-valid annotation INTACT (anchor + all grounding refs preserved)', async () => {
    const events = runIngest();
    const annotations = await new ClaudeInterpreter({ client: fakeReturning([VALID]) }).interpret(events);

    expect(annotations).toHaveLength(1);
    expect(annotations[0].eventRef).toBe('u-0002#1');
    expect(annotations[0].beatType).toBe('dispel');
    // No real refs were dropped: the grounding set is byte-for-byte the input order.
    expect(annotations[0].groundingPointer.eventRefs).toEqual(['u-0002#1', 'u-0002#2', 'u-0003#0']);
  });

  it('DROPS an annotation whose primary eventRef is a hallucinated id (cannot be grounded)', async () => {
    const events = runIngest();
    const annotations = await new ClaudeInterpreter({
      client: fakeReturning([HALLUCINATED_PRIMARY]),
    }).interpret(events);

    expect(annotations).toHaveLength(0);
  });

  it('KEEPS an annotation with mixed grounding, retaining ONLY the valid refs (never empty)', async () => {
    const events = runIngest();
    const annotations = await new ClaudeInterpreter({
      client: fakeReturning([MIXED_GROUNDING]),
    }).interpret(events);

    expect(annotations).toHaveLength(1);
    expect(annotations[0].eventRef).toBe('u-0010#0');
    // The two dangling refs are stripped; the two real refs (in input order) survive.
    expect(annotations[0].groundingPointer.eventRefs).toEqual(['u-0009#0', 'u-0010#0']);
    expect(annotations[0].groundingPointer.eventRefs).not.toContain(HALLUCINATED);
    expect(annotations[0].groundingPointer.eventRefs).not.toContain(HALLUCINATED_2);
    expect(annotations[0].groundingPointer.eventRefs.length).toBeGreaterThan(0);
  });

  it('the sanitized output across (a)+(b)+(c) is fully resolvable and unblocks freezeAnnotations', async () => {
    const events = runIngest();
    const interpreterVersion = 'claude-sonnet-4-6/v1';
    const promptVersion = 'beat-tag-v2';
    const annotations = await new ClaudeInterpreter({
      client: fakeReturning([VALID, HALLUCINATED_PRIMARY, MIXED_GROUNDING]),
      interpreterVersion,
      promptVersion,
    }).interpret(events);

    // (a) kept, (b) dropped, (c) kept → 2 survive, and every surviving ref resolves to a real eventId.
    expect(annotations).toHaveLength(2);
    const ids = new Set(events.map((e) => e.eventId));
    for (const a of annotations) {
      expect(ids.has(a.eventRef)).toBe(true);
      for (const ref of a.groundingPointer.eventRefs) {
        expect(ids.has(ref)).toBe(true);
      }
    }

    // The load-bearing claim: freezeAnnotations (UNCHANGED, fail-loud) now PASSES on this output —
    // it would have thrown on the hallucinated ref had the interpreter not sanitized it.
    expect(() =>
      freezeAnnotations({ normalizedEvents: events, annotations, interpreterVersion, promptVersion }),
    ).not.toThrow();
  });

  it('warns a count-only (no-PII) summary naming the dropped + dangling counts', async () => {
    const events = runIngest();
    await new ClaudeInterpreter({
      client: fakeReturning([VALID, HALLUCINATED_PRIMARY, MIXED_GROUNDING]),
    }).interpret(events);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0][0] as string;
    // 1 dropped (b), 2 dangling refs removed from (c).
    expect(msg).toContain('dropped 1 annotations');
    expect(msg).toContain('2 dangling refs');
    // No PII / no leaked event ids in the warning — counts only.
    expect(msg).not.toContain(HALLUCINATED);
    expect(msg).not.toContain(HALLUCINATED_2);
    expect(msg).not.toContain('u-0010#0');
  });

  it('emits NO warning when every ref already resolves (clean output is untouched + silent)', async () => {
    const events = runIngest();
    const annotations = await new ClaudeInterpreter({ client: fakeReturning([VALID]) }).interpret(events);

    expect(annotations).toHaveLength(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
