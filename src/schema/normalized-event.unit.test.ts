import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// Unit tests (dev-story, on top of the ATDD acceptance tests in normalized-event.test.ts).
// These cover the documented design DECISIONS the ATDD suite does not exercise: the full
// ActionType member set (incl. the `aetherStorm` member chosen in Dev Notes) and the
// remaining .nullable() serialized fields (exitCode, subtype, payload) per AC3.
import { ActionTypeSchema, NormalizedEventSchema, OrderKeySchema } from './normalized-event';

const validOrderKey = { logicalClock: 0, streamId: 'main', seqWithinStream: 0 };

const validEvent = {
  orderKey: validOrderKey,
  eventId: 'evt-0001',
  eventType: 'tool_use',
  toolName: 'Edit',
  subtype: null,
  timestamp: '2026-06-14T14:55:00.000Z',
  streamDepth: 0,
  exitCode: 0,
  isError: false,
  retryCount: 0,
  payload: { filePath: 'src/main.ts' },
};

describe('Story 1.2 unit — ActionType carries the full documented member set', () => {
  it('includes the environmental-hazard member aetherStorm (Dev Notes "ActionType derivation")', () => {
    expect(ActionTypeSchema.parse('aetherStorm')).toBe('aetherStorm');
  });

  it('does NOT include mirage/solid as members (they are 1.4 Beat-level modifiers)', () => {
    expect(() => ActionTypeSchema.parse('mirageStrike')).toThrow(z.ZodError);
    expect(() => ActionTypeSchema.parse('solidStrike')).toThrow(z.ZodError);
  });
});

describe('Story 1.2 unit — remaining serialized fields are nullable, not optional (AC3)', () => {
  it('accepts explicit null for exitCode, subtype, and payload', () => {
    const value = NormalizedEventSchema.parse({
      ...validEvent,
      exitCode: null,
      subtype: null,
      payload: null,
    });
    expect(value.exitCode).toBeNull();
    expect(value.subtype).toBeNull();
    expect(value.payload).toBeNull();
  });

  it('rejects an absent payload key (nullable permits null but not undefined/absent)', () => {
    const { payload: _omit, ...withoutPayload } = validEvent;
    void _omit;
    expect(() => NormalizedEventSchema.parse(withoutPayload)).toThrow(z.ZodError);
  });

  it('rejects a non-integer seqWithinStream in orderKey', () => {
    expect(() => OrderKeySchema.parse({ ...validOrderKey, seqWithinStream: 2.5 })).toThrow(
      z.ZodError,
    );
  });
});
