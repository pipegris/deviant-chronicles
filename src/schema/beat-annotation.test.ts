import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// RED-PHASE acceptance test for Story 1.2 — Task 3: src/schema/beat-annotation.ts
// (Layer-1, frozen, content-addressed overlay). Encodes ACs 1–4 for BeatType,
// GroundingPointer, BeatAnnotation. Imports the not-yet-authored module, so it ERRORS
// now (RED); turns GREEN when the dev authors these schemas + inferred types.
import {
  BeatAnnotationSchema,
  BeatTypeSchema,
  GroundingPointerSchema,
  type BeatAnnotation,
  type BeatType,
  type GroundingPointer,
} from './beat-annotation';

const validGroundingPointer = {
  eventRefs: ['evt-0001', 'evt-0002'],
};

// BeatAnnotation must carry EXACTLY the architecture-named fields (AC1):
// eventRef, beatType, confidence, interpreterVersion, sourceHash, groundingPointer.
const validAnnotation = {
  eventRef: 'evt-0001',
  beatType: 'dispel',
  confidence: 0.9,
  interpreterVersion: 'interp-v1',
  sourceHash: 'sha256:abc123',
  groundingPointer: validGroundingPointer,
};

describe('Story 1.2 / AC2 — BeatType is exactly the three signature literal beats', () => {
  it('parses the three signature beat types', () => {
    for (const member of ['shaman', 'dispel', 'summon']) {
      expect(BeatTypeSchema.parse(member)).toBe(member);
    }
  });

  it('rejects an unknown beat type with a ZodError', () => {
    // AC2 behavioral proof: closed string-literal union, not a free string.
    expect(() => BeatTypeSchema.parse('wizard')).toThrow(z.ZodError);
  });

  it('binds a literal member to the inferred BeatType (proves the type is exported)', () => {
    const b: BeatType = 'shaman';
    expect(BeatTypeSchema.parse(b)).toBe('shaman');
  });
});

describe('Story 1.2 / AC1+AC4 — GroundingPointerSchema const + GroundingPointer type', () => {
  it('parses a grounding pointer carrying the full set of dramatized event refs', () => {
    const value: GroundingPointer = GroundingPointerSchema.parse(validGroundingPointer);
    expect(value.eventRefs).toEqual(['evt-0001', 'evt-0002']);
  });

  it('throws ZodError when eventRefs is not an array of strings', () => {
    expect(() => GroundingPointerSchema.parse({ eventRefs: [1, 2] })).toThrow(z.ZodError);
  });
});

describe('Story 1.2 / AC1+AC4 — BeatAnnotationSchema const + BeatAnnotation type', () => {
  it('parses a valid annotation with all six architecture-named fields', () => {
    // AC1: reading each architecture-named field back off the parsed value proves the
    // contract carries exactly those fields (eventRef, beatType, confidence,
    // interpreterVersion, sourceHash, groundingPointer).
    const value: BeatAnnotation = BeatAnnotationSchema.parse(validAnnotation);
    expect(value.eventRef).toBe('evt-0001');
    expect(value.beatType).toBe('dispel');
    expect(value.confidence).toBe(0.9);
    expect(value.interpreterVersion).toBe('interp-v1');
    expect(value.sourceHash).toBe('sha256:abc123');
    expect(value.groundingPointer.eventRefs).toContain('evt-0001');
  });

  it('throws ZodError when beatType is an invalid member (e.g. "wizard")', () => {
    expect(() => BeatAnnotationSchema.parse({ ...validAnnotation, beatType: 'wizard' })).toThrow(
      z.ZodError,
    );
  });

  it('throws ZodError when groundingPointer is missing', () => {
    const { groundingPointer: _omit, ...withoutPointer } = validAnnotation;
    void _omit;
    expect(() => BeatAnnotationSchema.parse(withoutPointer)).toThrow(z.ZodError);
  });

  it('throws ZodError when eventRef is missing', () => {
    const { eventRef: _omit, ...withoutEventRef } = validAnnotation;
    void _omit;
    expect(() => BeatAnnotationSchema.parse(withoutEventRef)).toThrow(z.ZodError);
  });

  it('throws ZodError when confidence is outside the 0–1 self-rating range', () => {
    // confidence is the interpreter's 0–1 self-rating; out-of-range must fail closed here.
    expect(() => BeatAnnotationSchema.parse({ ...validAnnotation, confidence: 9.7 })).toThrow(
      z.ZodError,
    );
    expect(() => BeatAnnotationSchema.parse({ ...validAnnotation, confidence: -5 })).toThrow(
      z.ZodError,
    );
  });

  it('accepts the 0 and 1 confidence bounds', () => {
    expect(BeatAnnotationSchema.parse({ ...validAnnotation, confidence: 0 }).confidence).toBe(0);
    expect(BeatAnnotationSchema.parse({ ...validAnnotation, confidence: 1 }).confidence).toBe(1);
  });
});
