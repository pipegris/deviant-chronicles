import { describe, expect, it } from 'vitest';
import type { BeatAnnotation } from '../schema/beat-annotation';
import { evaluateTagging } from './eval';

// Story 3.2 — focused UNIT tests for evaluateTagging's raw COUNTS (truePositives/
// falsePositives/falseNegatives) and the empty-input convention — the parts of EvalReport the
// ATDD eval.test.ts does not assert (it checks precision/recall/f1 only).

function annot(beatType: BeatAnnotation['beatType'], eventRef: string): BeatAnnotation {
  return {
    eventRef,
    beatType,
    confidence: 0.9,
    interpreterVersion: 'expected-v1',
    sourceHash: 'fixture',
    groundingPointer: { eventRefs: [eventRef] },
  };
}

const DISPEL = annot('dispel', 'u-0002#1');
const SHAMAN = annot('shaman', 'u-0010#0');
const SUMMON = annot('summon', 'u-0005#0');

describe('Story 3.2 — evaluateTagging reports the raw TP/FP/FN counts', () => {
  it('counts one hit, one miss, one spurious in a mixed case', () => {
    const report = evaluateTagging({ expected: [DISPEL, SHAMAN], actual: [DISPEL, SUMMON] });
    expect(report.truePositives).toBe(1); // DISPEL matched
    expect(report.falseNegatives).toBe(1); // SHAMAN missed
    expect(report.falsePositives).toBe(1); // SUMMON spurious
  });

  it('treats the SAME beatType at a DIFFERENT eventRef as a non-match (key is the pair)', () => {
    const expected = [annot('dispel', 'u-0002#1')];
    const actual = [annot('dispel', 'u-0003#0')]; // same type, different anchor
    const report = evaluateTagging({ expected, actual });
    expect(report.truePositives).toBe(0);
    expect(report.falsePositives).toBe(1);
    expect(report.falseNegatives).toBe(1);
  });
});

describe('Story 3.2 — empty inputs score the vacuous-denominator convention (=1)', () => {
  it('two empty sets are a perfect (vacuously true) match', () => {
    const report = evaluateTagging({ expected: [], actual: [] });
    expect(report.precision).toBe(1);
    expect(report.recall).toBe(1);
    expect(report.f1).toBe(1);
    expect(report.truePositives).toBe(0);
  });
});
