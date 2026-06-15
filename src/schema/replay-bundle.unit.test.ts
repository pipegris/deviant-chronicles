import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// Unit tests on top of replay-bundle.test.ts. Cover decisions the ATDD suite leaves
// implicit: the BAKED battleTimeline is a required, validated member (so a malformed or
// absent baked timeline fails closed) and the loose-but-present tuningConfig forward-ref.
import { ReplayBundleSchema, TuningConfigSchema } from './replay-bundle';

const validOrderKey = { logicalClock: 0, streamId: 'main', seqWithinStream: 0 };
// dev-story re-point (Story 5.5): the bundle ships `projectedEvents` (payload-free), not the full
// `normalizedEvents`. Fixture updated to a valid ProjectedEvent; these unit assertions (baked-timeline
// required, tuningConfig loose) are unaffected in intent.
const validProjectedEvent = {
  orderKey: validOrderKey,
  eventId: 'evt-0001',
  eventType: 'tool_use',
  toolName: 'Edit',
  outcome: 'success',
  role: 'source',
};
const validBeat = {
  orderKey: validOrderKey,
  actionType: 'melee',
  sourceEventIds: ['evt-0001'],
  weight: 1,
  dwellMs: 400,
};
const validAnnotation = {
  eventRef: 'evt-0001',
  beatType: 'dispel',
  confidence: 0.9,
  interpreterVersion: 'interp-v1',
  sourceHash: 'sha256:abc123',
  groundingPointer: { eventRefs: ['evt-0001'] },
};
const validBundle = {
  schemaVersion: 1,
  projectedEvents: [validProjectedEvent],
  annotations: [validAnnotation],
  battleTimeline: { schemaVersion: 1, beats: [validBeat], totalDurationMs: 400 },
  tuningConfig: { someRule: 'value' },
  saga: null,
  assetManifest: { hero: 'assets/hero.png' },
  annotationHash: 'sha256:deadbeef',
};

describe('Story 1.2 unit — the baked battleTimeline is required and validated', () => {
  it('rejects a bundle missing battleTimeline (determinism is baked, not recomputed)', () => {
    const { battleTimeline: _omit, ...withoutTimeline } = validBundle;
    void _omit;
    expect(() => ReplayBundleSchema.parse(withoutTimeline)).toThrow(z.ZodError);
  });

  it('rejects a bundle whose baked timeline carries a wrong schemaVersion', () => {
    const bad = {
      ...validBundle,
      battleTimeline: { ...validBundle.battleTimeline, schemaVersion: 2 },
    };
    expect(() => ReplayBundleSchema.parse(bad)).toThrow(z.ZodError);
  });
});

describe('Story 1.2 unit — tuningConfig is a present-but-loose forward-reference', () => {
  it('parses an arbitrary record as TuningConfig (narrowed in 1.4/1.5)', () => {
    const value = TuningConfigSchema.parse({ nested: { weight: 2 }, list: [1, 2, 3] });
    expect(value).toEqual({ nested: { weight: 2 }, list: [1, 2, 3] });
  });

  it('rejects a bundle whose assetManifest maps to a non-string path', () => {
    const bad = { ...validBundle, assetManifest: { hero: 123 } };
    expect(() => ReplayBundleSchema.parse(bad)).toThrow(z.ZodError);
  });
});
