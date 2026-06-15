import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type BeatAnnotation } from '../schema/beat-annotation';

// RED-PHASE acceptance test for Story 3.2 — AC3: the PURE tagging-quality scorer (out-of-band,
// never gates CI). It imports the not-yet-authored `./eval` (evaluateTagging, EvalReport), so it
// ERRORS now (RED — module resolution fails); turns GREEN when the dev authors src/interpret/eval.ts.
//
// AC3 (verbatim, epics.md#Story-3.2): "Given interpreter quality concerns When evaluated Then
// scripts/eval-interpreter.ts measures tagging quality out-of-band and never gates CI; escalation
// to claude-opus-4-8 is available if quality needs it."
//
// The scorer is PURE: it scores two already-produced BeatAnnotation[] sets and never calls the LLM.
// The precision/recall/F1 vocabulary is exactly what the story names ("per-beatType
// precision/recall/F1 keyed on (beatType, eventRef) matches").
import { evaluateTagging, type EvalReport } from './eval';

// --- Three small hand-built annotations keyed by (beatType, eventRef). They need not resolve to
// the ingest fixture here — this scorer compares expected-vs-actual sets, it does not validate
// groundings (that is freeze.test.ts's job).
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

describe('Story 3.2 / AC3 — evaluateTagging scores a perfect match as precision/recall/F1 = 1', () => {
  it('reports 1.0 across the board when actual exactly equals expected', () => {
    const expected = [DISPEL, SHAMAN];
    const actual = [DISPEL, SHAMAN];
    const report: EvalReport = evaluateTagging({ expected, actual });
    expect(report.precision).toBe(1);
    expect(report.recall).toBe(1);
    expect(report.f1).toBe(1);
  });
});

describe('Story 3.2 / AC3 — a MISSED beat drops recall below 1', () => {
  it('recall < 1 when actual omits an expected beat (precision still 1 — nothing spurious)', () => {
    const expected = [DISPEL, SHAMAN];
    const actual = [DISPEL]; // missed the Shaman
    const report = evaluateTagging({ expected, actual });
    expect(report.recall).toBeLessThan(1);
    expect(report.precision).toBe(1);
  });
});

describe('Story 3.2 / AC3 — a SPURIOUS beat drops precision below 1', () => {
  it('precision < 1 when actual adds a beat not in expected (recall still 1 — nothing missed)', () => {
    const expected = [DISPEL, SHAMAN];
    const actual = [DISPEL, SHAMAN, SUMMON]; // spurious Summon
    const report = evaluateTagging({ expected, actual });
    expect(report.precision).toBeLessThan(1);
    expect(report.recall).toBe(1);
  });
});

describe('Story 3.2 / AC3 — every reported metric is a number in [0,1]', () => {
  it('keeps precision/recall/f1 bounded for a mixed (partial-match) case', () => {
    const expected = [DISPEL, SHAMAN];
    const actual = [DISPEL, SUMMON]; // one hit, one miss, one spurious
    const report = evaluateTagging({ expected, actual });
    for (const v of [report.precision, report.recall, report.f1]) {
      expect(typeof v).toBe('number');
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('Story 3.2 / AC3 — the scorer is deterministic (no clock / no RNG)', () => {
  it('returns a deep-equal report across two calls with the same inputs', () => {
    const args = { expected: [DISPEL, SHAMAN], actual: [DISPEL, SUMMON] };
    expect(evaluateTagging(args)).toEqual(evaluateTagging(args));
  });
});

describe('Story 3.2 / AC3 — eval.ts is PURE + SDK-free (source-grep, mirrors 3.1)', () => {
  // eval.ts scores two already-produced sets; it does NOT call the LLM. So it imports no SDK and
  // reads no clock/RNG — the same discipline as freeze.ts.
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'eval.ts'), 'utf8');

  it('does not import @anthropic-ai/sdk (the scorer never calls the LLM)', () => {
    expect(source).not.toContain('@anthropic-ai/sdk');
  });

  it('does not read a clock or RNG (Date.now / Math.random / performance.now)', () => {
    expect(source).not.toContain('Date.now');
    expect(source).not.toContain('Math.random');
    expect(source).not.toContain('performance.now');
  });
});

describe('Story 3.2 / AC3 — the eval is NOT wired into the CI gate (the literal "never gates CI" proof)', () => {
  // Structural proof, exactly as the story specifies: the out-of-band CLI exists under scripts/,
  // vitest does not run scripts/*.test.ts, and no package.json test/build script references the
  // eval CLI. Tests may read files with fs (they are not Layer-0 modules).
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

  it('the out-of-band CLI scripts/eval-interpreter.ts exists', () => {
    expect(() => readFileSync(join(ROOT, 'scripts', 'eval-interpreter.ts'), 'utf8')).not.toThrow();
  });

  it('vitest.config.ts only includes src/**/*.test.ts (so scripts/*.test.ts never run in CI)', () => {
    const vitestConfig = readFileSync(join(ROOT, 'vitest.config.ts'), 'utf8');
    expect(vitestConfig).toContain("'src/**/*.test.ts'");
  });

  it('package.json test/build scripts do NOT reference eval-interpreter', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.test ?? '').not.toContain('eval-interpreter');
    expect(pkg.scripts.build ?? '').not.toContain('eval-interpreter');
  });
});
