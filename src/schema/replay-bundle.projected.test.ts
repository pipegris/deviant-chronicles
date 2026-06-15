import { describe, expect, it } from 'vitest';

// RED-PHASE acceptance test for Story 5.5 — Task 2 / AC1: the payload-free ProjectedEvent schema +
// the bundle field rename (normalizedEvents → projectedEvents), staying schemaVersion: 1.
//
// It imports the NOT-YET-EXPORTED `ProjectedEventSchema`, `OutcomeSchema`, `AbstractedRoleSchema` and
// the renamed `projectedEvents` field from `./replay-bundle`, so it ERRORS / FAILS now (RED — the
// schema today exports `normalizedEvents` and none of these new leaf schemas). It turns GREEN when the
// dev (Task 2) adds ProjectedEventSchema (a `.strict()` object), OutcomeSchema = z.enum(['success',
// 'isError']), AbstractedRoleSchema = z.enum([...the six]), and replaces normalizedEvents with
// projectedEvents: z.array(ProjectedEventSchema).
//
// AC1: the per-event data is the MINIMAL projection {orderKey, eventId, eventType, toolName, outcome,
// role}; a `.strict()` ProjectedEvent makes "no per-event payload field" a PARSE-TIME guarantee, not
// just a test (Dev Notes §2 — the absence is structurally enforced).
import {
  ProjectedEventSchema,
  OutcomeSchema,
  AbstractedRoleSchema,
  ReplayBundleSchema,
} from './replay-bundle';

// A minimal, schema-valid projected event (the five-key set + the opaque identity; Dev Notes §1).
const VALID_PROJECTED = {
  orderKey: { logicalClock: 2, streamId: 'main', seqWithinStream: 2 },
  eventId: 'u-0002#1',
  eventType: 'tool_use',
  toolName: 'Read',
  outcome: 'success',
  role: 'schema',
} as const;

// ---------------------------------------------------------------------------------------------------
// AC1 — ProjectedEventSchema accepts the minimal projection and ROUND-TRIPS it.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC1 — ProjectedEventSchema validates the minimal payload-free projection', () => {
  it('a valid projected event parses and round-trips', () => {
    expect(() => ProjectedEventSchema.parse(VALID_PROJECTED)).not.toThrow();
    const parsed = ProjectedEventSchema.parse(VALID_PROJECTED);
    expect(parsed).toEqual(VALID_PROJECTED);
  });

  it('toolName is nullable (a prompt/text/result event has no tool)', () => {
    expect(() =>
      ProjectedEventSchema.parse({ ...VALID_PROJECTED, toolName: null, role: 'source' }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------
// AC1 / AC2 — the schema is .strict(): an extra field (a leaked payload/content) is REJECTED at parse
// time. This makes the byte-absence guarantee structural — a ProjectedEvent CANNOT carry a payload.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC1 — ProjectedEventSchema is .strict(): a leaked payload field fails closed', () => {
  it('REJECTS an event carrying a `payload` field (the dropped leak surface)', () => {
    expect(() =>
      ProjectedEventSchema.parse({
        ...VALID_PROJECTED,
        payload: { input: { file_path: '/work/project/src/schema/normalized-event.ts' } },
      }),
    ).toThrow();
  });

  it('REJECTS an event carrying a `content` field (raw tool-output)', () => {
    expect(() =>
      ProjectedEventSchema.parse({ ...VALID_PROJECTED, content: 'export const X = ...' }),
    ).toThrow();
  });

  it('REJECTS any extra unknown key (e.g. timestamp / subtype carried over from NormalizedEvent)', () => {
    expect(() =>
      ProjectedEventSchema.parse({ ...VALID_PROJECTED, timestamp: '2026-06-14T00:00:00.000Z' }),
    ).toThrow();
    expect(() => ProjectedEventSchema.parse({ ...VALID_PROJECTED, subtype: null })).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------
// AC1 / AC3 — the enums are CLOSED string-literal unions (the no-numeric-enum convention): an unknown
// outcome or role string is rejected.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC1 — OutcomeSchema is the closed {success, isError} union', () => {
  it('accepts "success" and "isError"', () => {
    expect(OutcomeSchema.parse('success')).toBe('success');
    expect(OutcomeSchema.parse('isError')).toBe('isError');
  });

  it('REJECTS any other string', () => {
    expect(() => OutcomeSchema.parse('failure')).toThrow();
    expect(() => OutcomeSchema.parse('error')).toThrow();
    expect(() => OutcomeSchema.parse('')).toThrow();
  });
});

describe('Story 5.5 AC3 — AbstractedRoleSchema is the closed six-token role union', () => {
  it('accepts each of the six coarse role tokens', () => {
    for (const role of ['test', 'schema', 'migration', 'config', 'doc', 'source']) {
      expect(AbstractedRoleSchema.parse(role)).toBe(role);
    }
  });

  it('REJECTS an unknown role string (e.g. a leaked path or an invented role)', () => {
    expect(() => AbstractedRoleSchema.parse('src/schema/normalized-event.ts')).toThrow();
    expect(() => AbstractedRoleSchema.parse('controller')).toThrow();
    expect(() => AbstractedRoleSchema.parse('')).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------
// AC1 — the BUNDLE now carries `projectedEvents` (NOT `normalizedEvents`); it stays schemaVersion: 1.
// ReplayBundleSchema with a `normalizedEvents` array must FAIL; with `projectedEvents` it must PASS.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC1 — ReplayBundleSchema ships projectedEvents, not normalizedEvents (schemaVersion 1)', () => {
  function baseBundle(eventsField: 'projectedEvents' | 'normalizedEvents') {
    const events = [VALID_PROJECTED];
    return {
      schemaVersion: 1,
      [eventsField]: events,
      annotations: [],
      battleTimeline: {
        schemaVersion: 1,
        beats: [
          {
            orderKey: { logicalClock: 2, streamId: 'main', seqWithinStream: 2 },
            actionType: 'scout',
            sourceEventIds: ['u-0002#1'],
            weight: 2,
            dwellMs: 240,
          },
        ],
        totalDurationMs: 240,
      },
      tuningConfig: {},
      saga: null,
      assetManifest: {},
      annotationHash: 'a'.repeat(64),
    } as Record<string, unknown>;
  }

  it('a bundle whose per-event array is `projectedEvents` PARSES (the new public shape)', () => {
    expect(() => ReplayBundleSchema.parse(baseBundle('projectedEvents'))).not.toThrow();
    const parsed = ReplayBundleSchema.parse(baseBundle('projectedEvents')) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe(1);
    // The leaf array is exposed under `projectedEvents`.
    expect(Array.isArray((parsed as { projectedEvents?: unknown }).projectedEvents)).toBe(true);
    // And the OLD field name is GONE (no consumer can read a payload that no longer exists).
    expect(Object.prototype.hasOwnProperty.call(parsed, 'normalizedEvents')).toBe(false);
  });

  it('a bundle still carrying `normalizedEvents` (the OLD leak vector) FAILS the new schema', () => {
    // The rename is the point: a bundle with normalizedEvents + no projectedEvents must NOT parse.
    expect(() => ReplayBundleSchema.parse(baseBundle('normalizedEvents'))).toThrow();
  });

  it('the bundle stays schemaVersion: 1 (a pre-ship rename, not a version bump — Dev Notes §2)', () => {
    expect(() =>
      ReplayBundleSchema.parse({ ...baseBundle('projectedEvents'), schemaVersion: 2 }),
    ).toThrow();
  });
});
