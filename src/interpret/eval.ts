import type { BeatAnnotation } from '../schema/beat-annotation';

// Story 3.2 / AC3 — the PURE, out-of-band tagging-quality scorer. It compares two
// already-produced BeatAnnotation[] sets (expected vs. actual) and never calls the LLM, so it
// is SDK-FREE and deterministic (no clock/RNG). It is a quality SIGNAL for the operator — the
// scripts/eval-interpreter.ts CLI wires the real interpreter's output into it out-of-band — and
// is NEVER part of the CI gate. [epics.md#Story-3.2 AC3; architecture.md#CI L206-207]

/**
 * A tagging-quality report keyed on the set of (beatType, eventRef) pairs:
 * - truePositives:  pairs present in BOTH expected and actual
 * - falsePositives: pairs in actual but NOT expected (spurious beats)
 * - falseNegatives: pairs in expected but NOT actual (missed beats)
 * - precision = TP / (TP + FP); recall = TP / (TP + FN); f1 = harmonic mean.
 * Each rate is a number in [0,1] (a vacuous denominator yields 1 — nothing to get wrong).
 */
export interface EvalReport {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

// A beat's identity for scoring is the (beatType, eventRef) pair — exactly what the story
// names ("keyed on (beatType, eventRef) matches"). Confidence/grounding are NOT part of the
// match key (that is freeze.ts's grounding-resolution concern, not the quality metric).
function beatKey(a: BeatAnnotation): string {
  return `${a.beatType}::${a.eventRef}`;
}

/**
 * Score a produced tagging against an expected reference, by set membership over
 * (beatType, eventRef) pairs. PURE + deterministic — identical inputs yield a deep-equal
 * report (no clock/RNG). [epics.md#Story-3.2 AC3]
 */
export function evaluateTagging(args: {
  expected: BeatAnnotation[];
  actual: BeatAnnotation[];
}): EvalReport {
  const expectedKeys = new Set(args.expected.map(beatKey));
  const actualKeys = new Set(args.actual.map(beatKey));

  let truePositives = 0;
  for (const key of actualKeys) {
    if (expectedKeys.has(key)) truePositives += 1;
  }
  const falsePositives = actualKeys.size - truePositives;
  const falseNegatives = expectedKeys.size - truePositives;

  // A vacuous denominator scores 1: with nothing predicted there is no false positive to
  // penalize precision, and with nothing expected there is no miss to penalize recall.
  const precision = actualKeys.size === 0 ? 1 : truePositives / actualKeys.size;
  const recall = expectedKeys.size === 0 ? 1 : truePositives / expectedKeys.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return { truePositives, falsePositives, falseNegatives, precision, recall, f1 };
}
