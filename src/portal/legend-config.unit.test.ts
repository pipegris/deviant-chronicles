import { describe, expect, it } from 'vitest';

// RED-PHASE unit tests for the Story 4.4 LEGEND-table LOADER (src/portal/legend-config.ts) — the
// on-demand transparency-portal content (FR-11), the on-demand sibling of the Story 4.3 always-on
// teaching one-liner. These FAIL until `legend-config.ts` is authored and exports
// `LegendTableSchema`, `LEGEND`, and `LEGEND_MAX_LEN` (the import below resolves to nothing and the
// module import ERRORs — the intended red, exactly as teaching-config.unit.test.ts was in its own
// red phase). They pin the .strict() EXHAUSTIVE Zod schema's FAIL-CLOSED behavior — the load-bearing
// config-as-data decision (NFR-4) the coverage gate (portal.test.ts) does not directly assert.
//
// Mirrors src/portal/teaching-config.unit.test.ts VERBATIM in shape (a valid object parses; a missing
// key, a typo'd key, an over-length string, an empty string, and a bumped $schemaVersion each fail
// closed at parse). These are BUILD-TIME invariants: a malformed committed legend.json throws on
// import, never silently mis-maps or quietly drops a fantasy<->real row / busts the brevity floor.
// [story Task 1; Dev Notes #2, #6]
import { LegendTableSchema, LEGEND, LEGEND_MAX_LEN } from './legend-config';

// A valid in-memory table (short strings well under the bound) — the baseline each failure mutates.
// Shape (story Task 1): $schemaVersion + a `beats` map keyed by the three BeatType members and an
// `actions` map keyed by the four CORE LegendActionType members, each row a { fantasy, real } pair.
function validRow(): { fantasy: string; real: string } {
  return { fantasy: 'a hammer strike', real: 'a code edit' };
}

function validTable(): Record<string, unknown> {
  return {
    $schemaVersion: 1,
    beats: {
      shaman: validRow(),
      dispel: validRow(),
      summon: validRow(),
    },
    actions: {
      melee: validRow(),
      spell: validRow(),
      scout: validRow(),
      aetherStorm: validRow(),
    },
  };
}

describe('Story 4.4 Task 1 — LEGEND is the validated, committed config', () => {
  it('the committed config parses against LegendTableSchema (validated at import)', () => {
    expect(() => LegendTableSchema.parse(LEGEND)).not.toThrow();
  });

  it('LEGEND_MAX_LEN is finite and positive (the single brevity source of truth)', () => {
    expect(Number.isFinite(LEGEND_MAX_LEN)).toBe(true);
    expect(LEGEND_MAX_LEN).toBeGreaterThan(0);
  });
});

describe('Story 4.4 Task 1 — LegendTableSchema fails CLOSED (fail-loud at build time)', () => {
  it('a valid in-memory table parses', () => {
    expect(() => LegendTableSchema.parse(validTable())).not.toThrow();
  });

  it('a MISSING BeatType key (summon) is rejected — the beats map must be EXHAUSTIVE (not z.record)', () => {
    const bad = validTable();
    delete (bad.beats as Record<string, unknown>).summon;
    expect(() => LegendTableSchema.parse(bad)).toThrow();
  });

  it('a MISSING core action key (aetherStorm) is rejected — the actions map must be EXHAUSTIVE', () => {
    const bad = validTable();
    delete (bad.actions as Record<string, unknown>).aetherStorm;
    expect(() => LegendTableSchema.parse(bad)).toThrow();
  });

  it('an unknown/typo`d beat key is rejected (.strict — no silent extra/misspelled key)', () => {
    const bad = validTable();
    (bad.beats as Record<string, unknown>).shamn = validRow();
    expect(() => LegendTableSchema.parse(bad)).toThrow();
  });

  it('an unknown/typo`d action key is rejected (.strict — summon is a BEAT, never an action row)', () => {
    const bad = validTable();
    // summon/counter/idle are NOT Legend action rows (story Dev Notes #3): the actions map is the four
    // CORE actions only. A stray `counter` action key must be rejected by .strict().
    (bad.actions as Record<string, unknown>).counter = validRow();
    expect(() => LegendTableSchema.parse(bad)).toThrow();
  });

  it('a row missing `real` is rejected (each row is a fantasy<->real PAIR, .strict)', () => {
    const bad = validTable();
    (bad.beats as Record<string, Record<string, unknown>>).dispel = { fantasy: 'only fantasy' };
    expect(() => LegendTableSchema.parse(bad)).toThrow();
  });

  it('a `fantasy` string OVER LEGEND_MAX_LEN is rejected (the brevity floor is enforced at parse)', () => {
    const bad = validTable();
    (bad.beats as Record<string, Record<string, unknown>>).shaman = {
      fantasy: 'x'.repeat(LEGEND_MAX_LEN + 1),
      real: 'ok',
    };
    expect(() => LegendTableSchema.parse(bad)).toThrow();
  });

  it('a `real` string OVER LEGEND_MAX_LEN is rejected (BOTH strings carry the brevity bound)', () => {
    const bad = validTable();
    (bad.actions as Record<string, Record<string, unknown>>).melee = {
      fantasy: 'ok',
      real: 'y'.repeat(LEGEND_MAX_LEN + 1),
    };
    expect(() => LegendTableSchema.parse(bad)).toThrow();
  });

  it('an EMPTY fantasy string is rejected (.min(1) — a row must carry a real mapping)', () => {
    const bad = validTable();
    (bad.beats as Record<string, Record<string, unknown>>).dispel = { fantasy: '', real: 'ok' };
    expect(() => LegendTableSchema.parse(bad)).toThrow();
  });

  it('a bumped $schemaVersion (2) is rejected — an old reader will not parse a new artifact', () => {
    expect(() => LegendTableSchema.parse({ ...validTable(), $schemaVersion: 2 })).toThrow();
  });
});

describe('Story 4.4 Task 1 — the committed LEGEND honors the brevity bound + accuracy register', () => {
  it('every committed fantasy/real string is within LEGEND_MAX_LEN (concise, gate-checkable)', () => {
    const rows = [...Object.values(LEGEND.beats), ...Object.values(LEGEND.actions)];
    expect(rows.length).toBe(7); // 3 beats + 4 core actions
    for (const row of rows) {
      expect(row.fantasy.length).toBeGreaterThan(0);
      expect(row.fantasy.length).toBeLessThanOrEqual(LEGEND_MAX_LEN);
      expect(row.real.length).toBeGreaterThan(0);
      expect(row.real.length).toBeLessThanOrEqual(LEGEND_MAX_LEN);
    }
  });
});
