import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import { FixtureInterpreter } from './fixture-interpreter';

// Focused GREEN-phase unit tests beyond the ATDD acceptance suite (fixture-interpreter.test.ts,
// which drives the real ingest pipeline). These pin the double's content-INDEPENDENCE: a fixed
// test double must return the same authored annotations regardless of (or even without) input,
// which is precisely why interpret() ignores its `_events` parameter.

const emptyEvents: NormalizedEvent[] = [];

describe('FixtureInterpreter — content-independence (the fixed-double contract)', () => {
  it('returns the authored annotations even for an empty event list', async () => {
    // The annotations are pre-authored against KNOWN eventIds, so the input is never read.
    const annotations = await new FixtureInterpreter().interpret(emptyEvents);
    expect(annotations).toHaveLength(2);
    expect(annotations.map((a) => a.beatType).sort()).toEqual(['dispel', 'shaman']);
  });

  it('returns deep-equal results for two different inputs (input is not read)', async () => {
    const interp = new FixtureInterpreter();
    const fromEmpty = await interp.interpret([]);
    const fromOther = await interp.interpret([
      {
        orderKey: { logicalClock: 0, streamId: 's', seqWithinStream: 0 },
        eventId: 'unrelated',
        eventType: 'prompt',
        toolName: null,
        subtype: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        streamDepth: 0,
        exitCode: null,
        isError: false,
        retryCount: 0,
        payload: null,
      },
    ]);
    expect(fromEmpty).toEqual(fromOther);
  });

  it('returns a fresh array each call (callers cannot mutate the shared literal set)', async () => {
    // interpret() maps over the literals, so each call yields a distinct array instance —
    // a caller pushing onto one result cannot corrupt the next call's output.
    const interp = new FixtureInterpreter();
    const first = await interp.interpret(emptyEvents);
    const second = await interp.interpret(emptyEvents);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
