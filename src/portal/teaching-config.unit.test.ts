import { describe, expect, it } from 'vitest';

// Unit tests for the Story 4.3 teaching-table LOADER (src/portal/teaching-config.ts). The committed
// teaching.json is exercised end-to-end by teaching.test.ts / teaching.unit.test.ts (the right line per
// beat, the brevity bound); this file pins the .strict() exhaustive Zod schema's FAIL-CLOSED behavior —
// the load-bearing config-as-data decision (NFR-4) the AC-level suites do not directly assert. Mirrors
// model/model-tuning.unit.test.ts verbatim in shape (a valid object parses; a missing key, a typo'd
// key, an over-length line, an empty line, and a bumped $schemaVersion each fail closed at parse).
// These are build-time invariants: a malformed committed file throws on import, never silently
// mis-teaches or quietly drops a key / busts the SM-C2 brevity floor. [story Task 1; Dev Notes #5]
import { TeachingTableSchema, TEACHING, TEACHING_MAX_LEN } from './teaching-config';

// A valid in-memory table (short lines well under the bound) — the baseline each failure mutates.
function validTable(): Record<string, unknown> {
  return { $schemaVersion: 1, shaman: 'root cause', dispel: 'verify, do not guess', summon: 'the breakthrough' };
}

describe('Story 4.3 Task 1 — TEACHING is the validated, committed config', () => {
  it('the committed config parses against TeachingTableSchema (validated at import)', () => {
    expect(() => TeachingTableSchema.parse(TEACHING)).not.toThrow();
  });

  it('TEACHING_MAX_LEN is finite and positive (the single SM-C2 brevity source of truth)', () => {
    expect(Number.isFinite(TEACHING_MAX_LEN)).toBe(true);
    expect(TEACHING_MAX_LEN).toBeGreaterThan(0);
  });
});

describe('Story 4.3 Task 1 — TeachingTableSchema fails CLOSED (fail-loud at build time)', () => {
  it('a valid in-memory table parses', () => {
    expect(() => TeachingTableSchema.parse(validTable())).not.toThrow();
  });

  it('a MISSING BeatType key (summon) is rejected — the table must be EXHAUSTIVE (not z.record)', () => {
    const bad = validTable();
    delete bad.summon;
    expect(() => TeachingTableSchema.parse(bad)).toThrow();
  });

  it('an unknown/typo`d key is rejected (.strict — no silent extra/misspelled key)', () => {
    expect(() => TeachingTableSchema.parse({ ...validTable(), shamn: 'oops' })).toThrow();
  });

  it('a one-liner OVER TEACHING_MAX_LEN is rejected (the SM-C2 brevity floor is enforced at parse)', () => {
    expect(() => TeachingTableSchema.parse({ ...validTable(), shaman: 'x'.repeat(TEACHING_MAX_LEN + 1) })).toThrow();
  });

  it('an EMPTY one-liner is rejected (.min(1) — a beat must carry a real lesson)', () => {
    expect(() => TeachingTableSchema.parse({ ...validTable(), dispel: '' })).toThrow();
  });

  it('a bumped $schemaVersion (2) is rejected — an old reader will not parse a new artifact', () => {
    expect(() => TeachingTableSchema.parse({ ...validTable(), $schemaVersion: 2 })).toThrow();
  });
});
