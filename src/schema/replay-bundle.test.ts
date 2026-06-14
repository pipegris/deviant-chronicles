import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// RED-PHASE acceptance test for Story 1.2 — Task 4: src/schema/replay-bundle.ts
// (the single shippable artifact). Encodes ACs 1–4 for ReplayBundle composing the
// prior schemas + schemaVersion + hash fields. Imports the not-yet-authored module,
// so it ERRORS now (RED); turns GREEN when the dev composes ReplayBundleSchema.
import { ReplayBundleSchema, type ReplayBundle } from './replay-bundle';

const validOrderKey = { logicalClock: 0, streamId: 'main', seqWithinStream: 0 };

const validNormalizedEvent = {
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

// Architecture bundle composition: normalized events + frozen annotations + tuning
// config + saga + asset manifest + schemaVersion + annotationHash, with the paced
// battleTimeline baked in (Dev Notes "ReplayBundle composition" — determinism literal).
const validBundle = {
  schemaVersion: 1,
  normalizedEvents: [validNormalizedEvent],
  annotations: [validAnnotation],
  battleTimeline: {
    schemaVersion: 1,
    beats: [validBeat],
    totalDurationMs: 400,
  },
  tuningConfig: { someRule: 'value' },
  saga: null,
  assetManifest: { hero: 'assets/hero.png' },
  annotationHash: 'sha256:deadbeef',
};

describe('Story 1.2 / AC1+AC4 — ReplayBundleSchema const + ReplayBundle type', () => {
  it('parses a minimal valid bundle and exposes the inferred ReplayBundle type', () => {
    // AC1: reading the composed fields back off the parsed value proves the bundle
    // contract carries the architecture-named fields (schemaVersion, normalizedEvents,
    // annotations, tuningConfig, saga, assetManifest, annotationHash).
    const value: ReplayBundle = ReplayBundleSchema.parse(validBundle);
    expect(value.schemaVersion).toBe(1);
    expect(value.normalizedEvents).toHaveLength(1);
    expect(value.annotations).toHaveLength(1);
    expect(value.tuningConfig).toEqual({ someRule: 'value' });
    expect(value.assetManifest).toEqual({ hero: 'assets/hero.png' });
    expect(value.annotationHash).toBe('sha256:deadbeef');
  });

  it('round-trips the bundle byte-for-byte: parse neither coerces, drops, nor reorders any field', () => {
    // The ReplayBundle is THE shippable artifact whose annotationHash = sha256(...) must be
    // stable. AC4 ("round-trip parse of a valid sample succeeds") is only meaningful if the
    // parsed value equals the input — otherwise a silent coercion or dropped nested field
    // (e.g. the baked battleTimeline, the explicit-null saga, the nested event/annotation
    // arrays) would change the serialized bytes the hash is taken over. Pin the whole object.
    const value: ReplayBundle = ReplayBundleSchema.parse(validBundle);
    expect(value).toEqual(validBundle);
    // The baked timeline (determinism literal) must survive intact, beats and all.
    expect(value.battleTimeline).toEqual(validBundle.battleTimeline);
    expect(value.battleTimeline.beats).toHaveLength(1);
    // The explicit null saga is preserved as null (AC3 — not coerced to undefined/absent).
    expect(value.saga).toBeNull();
    // Serializing the parsed bundle yields the same JSON as serializing the input — i.e.
    // parse is byte-transparent. Canonical (stable-key-order) JSON is enforced at the
    // hashing step (a later story), not by this parse round-trip; z.record preserves
    // insertion order without canonicalizing.
    expect(JSON.stringify(value)).toBe(JSON.stringify(validBundle));
  });
});

describe('Story 1.2 / AC4 — bundle rejects malformed input with a ZodError', () => {
  it('throws when a nested annotation is malformed (invalid beatType)', () => {
    const bad = {
      ...validBundle,
      annotations: [{ ...validAnnotation, beatType: 'wizard' }],
    };
    expect(() => ReplayBundleSchema.parse(bad)).toThrow(z.ZodError);
  });

  it('throws on a wrong schemaVersion literal', () => {
    expect(() => ReplayBundleSchema.parse({ ...validBundle, schemaVersion: 2 })).toThrow(
      z.ZodError,
    );
  });

  it('throws when a nested normalizedEvent is malformed (non-integer logicalClock)', () => {
    const bad = {
      ...validBundle,
      normalizedEvents: [
        { ...validNormalizedEvent, orderKey: { ...validOrderKey, logicalClock: 1.5 } },
      ],
    };
    expect(() => ReplayBundleSchema.parse(bad)).toThrow(z.ZodError);
  });
});

describe('Story 1.2 / AC3 — bundle saga prefers explicit null over undefined', () => {
  it('accepts an explicit null saga (prose not yet authored)', () => {
    const value = ReplayBundleSchema.parse({ ...validBundle, saga: null });
    expect(value.saga).toBeNull();
  });
});
