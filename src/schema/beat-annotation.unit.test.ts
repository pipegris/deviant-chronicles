import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// Unit tests on top of beat-annotation.test.ts. Cover decisions the ATDD suite leaves
// implicit: the exact three-member BeatType closure (incl. that `summon` is a member of
// BeatType in its own right, distinct from the ActionType `summon` verb) and the
// primary-anchor (eventRef) vs full-set (groundingPointer.eventRefs) distinction.
import {
  BeatAnnotationSchema,
  BeatTypeSchema,
  GroundingPointerSchema,
} from './beat-annotation';

const validAnnotation = {
  eventRef: 'evt-0001',
  beatType: 'dispel',
  confidence: 0.9,
  interpreterVersion: 'interp-v1',
  sourceHash: 'sha256:abc123',
  groundingPointer: { eventRefs: ['evt-0001', 'evt-0002'] },
};

describe('Story 1.2 unit — BeatType is closed to exactly three members', () => {
  it('accepts summon as a BeatType member (distinct from the ActionType summon verb)', () => {
    expect(BeatTypeSchema.parse('summon')).toBe('summon');
  });

  it('rejects ActionType-only verbs that are not signature beats (e.g. melee, scout)', () => {
    expect(() => BeatTypeSchema.parse('melee')).toThrow(z.ZodError);
    expect(() => BeatTypeSchema.parse('scout')).toThrow(z.ZodError);
  });
});

describe('Story 1.2 unit — groundingPointer carries the full dramatized set', () => {
  it('accepts an empty eventRefs array (shape-valid; ingest decides population in 1.3)', () => {
    const value = GroundingPointerSchema.parse({ eventRefs: [] });
    expect(value.eventRefs).toHaveLength(0);
  });

  it('keeps eventRef (anchor) and groundingPointer.eventRefs (full set) as separate fields', () => {
    const value = BeatAnnotationSchema.parse(validAnnotation);
    expect(value.eventRef).toBe('evt-0001');
    expect(value.groundingPointer.eventRefs).toEqual(['evt-0001', 'evt-0002']);
  });

  it('rejects a missing groundingPointer.eventRefs', () => {
    const bad = { ...validAnnotation, groundingPointer: {} };
    expect(() => BeatAnnotationSchema.parse(bad)).toThrow(z.ZodError);
  });
});
