import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// RED-PHASE acceptance test for Story 1.2 — Task 1: src/schema/normalized-event.ts
// (the Layer-0 contract that gates everything). Encodes ACs 1–4 for NormalizedEvent,
// OrderKey, and ActionType. The implementation does not exist yet, so the import
// below fails to resolve and these tests ERROR (RED). When the dev authors
// normalized-event.ts with the exact `XxxSchema` const + `type Xxx = z.infer<...>`
// exports the story requires, this file turns GREEN unchanged.
//
// AC1 (schema const + inferred type) is encoded by binding each parse result to its
// inferred type (e.g. `const value: OrderKey = OrderKeySchema.parse(...)`): the binding
// only compiles if BOTH the const and the inferred type are exported, and it fails the
// typecheck gate if the dev's inferred shape diverges from what these samples assert.
import {
  ActionTypeSchema,
  NormalizedEventSchema,
  OrderKeySchema,
  type ActionType,
  type NormalizedEvent,
  type OrderKey,
} from './normalized-event';

// A hand-built valid OrderKey (no fixture Session exists until Story 1.3).
const validOrderKey = {
  logicalClock: 0,
  streamId: 'main',
  seqWithinStream: 0,
};

// A hand-built valid NormalizedEvent carrying the dual-consumer fidelity the
// architecture mandates: Pacer signals (exitCode/isError/retryCount/timing) +
// Interpreter signals (subtype/streamDepth/payload).
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

describe('Story 1.2 / AC1 — OrderKeySchema is a const + inferred OrderKey type', () => {
  it('exports an OrderKeySchema const and a usable OrderKey type', () => {
    // AC1: schema const exists and round-trips. Typed binding proves the inferred type exists.
    const value: OrderKey = OrderKeySchema.parse(validOrderKey);
    expect(value).toEqual(validOrderKey);
  });

  it('throws ZodError when logicalClock is a non-integer', () => {
    expect(() => OrderKeySchema.parse({ ...validOrderKey, logicalClock: 1.5 })).toThrow(z.ZodError);
  });
});

describe('Story 1.2 / AC2 — ActionType is a string-literal union (no numeric enum)', () => {
  it('parses the core action verbs the translation mapping requires', () => {
    // Minimal member set the literal verbs require (Dev Notes "ActionType derivation").
    for (const member of ['melee', 'spell', 'scout', 'summon', 'counter', 'idle']) {
      expect(ActionTypeSchema.parse(member)).toBe(member);
    }
  });

  it('rejects an unknown action string with a ZodError (enum, not free string)', () => {
    // AC2 behavioral proof: a literal-union enum rejects out-of-set strings. A plain
    // z.string() would accept this — so this assertion fails GREEN unless ActionType is
    // genuinely a closed string-literal union.
    expect(() => ActionTypeSchema.parse('teleport')).toThrow(z.ZodError);
  });

  it('binds a literal member to the inferred ActionType (proves the type is exported)', () => {
    const a: ActionType = 'melee';
    expect(ActionTypeSchema.parse(a)).toBe('melee');
  });
});

describe('Story 1.2 / AC4 — NormalizedEvent round-trip: valid passes, invalid throws', () => {
  it('parses a valid NormalizedEvent and preserves it', () => {
    const value: NormalizedEvent = NormalizedEventSchema.parse(validEvent);
    expect(value.eventId).toBe('evt-0001');
    expect(value.orderKey).toEqual(validOrderKey);
  });

  it('throws ZodError when orderKey.logicalClock is non-integer', () => {
    const bad = { ...validEvent, orderKey: { ...validOrderKey, logicalClock: 1.5 } };
    expect(() => NormalizedEventSchema.parse(bad)).toThrow(z.ZodError);
  });

  it('throws ZodError when orderKey is missing entirely', () => {
    const { orderKey: _omit, ...withoutOrderKey } = validEvent;
    void _omit;
    expect(() => NormalizedEventSchema.parse(withoutOrderKey)).toThrow(z.ZodError);
  });

  it('throws ZodError when a Pacer-fidelity mechanical signal has the wrong type', () => {
    // AC4's "invalid fails" must guard the deterministic signals the Pacer reads, not only
    // orderKey. A wrong-typed isError/streamDepth/exitCode leaking past this Layer-0 gate
    // would silently corrupt downstream HP/pacing math (R3 — everything consumes the
    // validated NormalizedEvent, so the type guard has to bite HERE). One assertion per
    // field keeps the failure actionable.
    expect(() => NormalizedEventSchema.parse({ ...validEvent, isError: 'yes' })).toThrow(
      z.ZodError,
    );
    expect(() => NormalizedEventSchema.parse({ ...validEvent, streamDepth: 1.5 })).toThrow(
      z.ZodError,
    );
    expect(() => NormalizedEventSchema.parse({ ...validEvent, exitCode: 'oops' })).toThrow(
      z.ZodError,
    );
  });
});

describe('Story 1.2 / AC3 — serialized fields prefer explicit null over undefined', () => {
  it('accepts explicit null for a nullable serialized field (toolName)', () => {
    const value = NormalizedEventSchema.parse({ ...validEvent, toolName: null });
    expect(value.toolName).toBeNull();
  });

  it('rejects the same field being absent/undefined (nullable, not optional)', () => {
    // AC3: .nullable() permits null but NOT undefined/absent — this is the behavioral
    // difference from .optional() and the reason the bundle JSON stays explicit.
    const { toolName: _omit, ...withoutToolName } = validEvent;
    void _omit;
    expect(() => NormalizedEventSchema.parse(withoutToolName)).toThrow(z.ZodError);
  });

  it('keeps as-ingested timestamp as a string (never reformatted)', () => {
    const value = NormalizedEventSchema.parse(validEvent);
    expect(typeof value.timestamp).toBe('string');
    expect(value.timestamp).toBe('2026-06-14T14:55:00.000Z');
  });
});
