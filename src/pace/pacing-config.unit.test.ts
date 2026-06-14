import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// RED-PHASE acceptance tests for Story 1.5 Task 2 — the pacing-config Zod loaders
// (validated-at-import, fail-closed). These FAIL until src/pace/pacing-config.ts exists and
// exports PacingWeightsSchema / WindowConfigSchema / PACING_WEIGHTS / WINDOW_CONFIG. That
// import-error is the intended TDD red signal.
//
// Why these assertions: AC1 ("all per config/*.json, no hardcoded constants") + NFR-4 require
// that EVERY weight/threshold/dwell magnitude lives in DATA and is validated at module load.
// The loader contract that proves this is: (a) the weights map is EXHAUSTIVE over the 7-member
// ActionType union (a missing weight must fail LOUD at import, never silently fall back to a
// code constant); (b) both schemas are .strict() so a typo'd key fails closed; (c) $schemaVersion
// is a literal so a future shape bump fails closed under an old reader. We mirror the committed
// src/translate/translation-rules.ts precedent verbatim.
import {
  PacingWeightsSchema,
  WindowConfigSchema,
  PACING_WEIGHTS,
  WINDOW_CONFIG,
} from './pacing-config';
import { ActionTypeSchema } from '../schema/normalized-event';

const ALL_ACTION_TYPES = ActionTypeSchema.options; // the frozen 7-member union

describe('Story 1.5 Task2 — PACING_WEIGHTS is parsed, validated, and exhaustive over ActionType', () => {
  it('exposes a numeric weight for EVERY one of the 7 ActionType members (no missing key)', () => {
    // The whole NFR-4 point: a missing actionType weight is exactly the "hardcoded constant"
    // the architecture forbids. Every member must be present in DATA.
    for (const t of ALL_ACTION_TYPES) {
      expect(typeof PACING_WEIGHTS.weights[t], `weight for ${t}`).toBe('number');
    }
  });

  it('carries $schemaVersion === 1 (a bumped artifact must fail closed under an old reader)', () => {
    expect(PACING_WEIGHTS.$schemaVersion).toBe(1);
  });

  it('rejects a weights map MISSING an ActionType member (fail loud at parse, not a code fallback)', () => {
    // Build a config that drops `summon` — the exhaustive record/object validation must throw
    // rather than letting pace/ silently default the missing weight.
    const base = PacingWeightsSchema.parse(PACING_WEIGHTS);
    const partial = { ...base, weights: { ...base.weights } };
    delete (partial.weights as Record<string, number>).summon;
    expect(() => PacingWeightsSchema.parse(partial)).toThrow(z.ZodError);
  });

  it('rejects an unknown top-level key (.strict — a typo in the committed JSON fails closed)', () => {
    const bad = { ...PacingWeightsSchema.parse(PACING_WEIGHTS), bogusKey: 1 };
    expect(() => PacingWeightsSchema.parse(bad)).toThrow(z.ZodError);
  });

  it('rejects a non-literal $schemaVersion (e.g. 2 — old reader must not parse a bumped shape)', () => {
    const bad = { ...PacingWeightsSchema.parse(PACING_WEIGHTS), $schemaVersion: 2 };
    expect(() => PacingWeightsSchema.parse(bad)).toThrow(z.ZodError);
  });

  it('exposes a dwell budget block (the config lever that maps weight -> dwellMs)', () => {
    // Task 1 mandates a `dwell` block (base dwellMsPerWeightUnit OR a tiered dwellByTier map)
    // so "significant beats out-dwell trivial ones" and the ~2-4 min target are CONFIG facts.
    // It must be present and non-empty (its exact shape is the dev's choice; we assert it exists).
    expect(PACING_WEIGHTS.dwell).toBeTruthy();
    expect(typeof PACING_WEIGHTS.dwell).toBe('object');
  });

  it('exposes a modifiers block for the dramatic non-actionType score bumps (mirage/boss/drain)', () => {
    // Task 1: mirageStrike / solidStrike / bossDamage / resolveDrain etc. live in DATA as
    // additive/multiplicative knobs scoreEvent reads — never hardcoded.
    expect(PACING_WEIGHTS.modifiers).toBeTruthy();
    expect(typeof PACING_WEIGHTS.modifiers).toBe('object');
  });
});

describe('Story 1.5 Task2 — WINDOW_CONFIG is parsed, validated, and carries the montage policy', () => {
  it('carries $schemaVersion === 1', () => {
    expect(WINDOW_CONFIG.$schemaVersion).toBe(1);
  });

  it('exposes a numeric montageThresholdWeight (the trivial/significant boundary)', () => {
    expect(typeof WINDOW_CONFIG.montageThresholdWeight).toBe('number');
  });

  it('exposes a minRunToCollapse >= 2 (a single trivial action is NOT a montage; a RUN is)', () => {
    // FR-12 collapses "bursts" — a burst is a run, not one event. minRunToCollapse encodes that.
    expect(typeof WINDOW_CONFIG.minRunToCollapse).toBe('number');
    expect(WINDOW_CONFIG.minRunToCollapse).toBeGreaterThanOrEqual(2);
  });

  it('rejects an unknown top-level key (.strict)', () => {
    const bad = { ...WindowConfigSchema.parse(WINDOW_CONFIG), bogusKey: true };
    expect(() => WindowConfigSchema.parse(bad)).toThrow(z.ZodError);
  });

  it('rejects a non-literal $schemaVersion', () => {
    const bad = { ...WindowConfigSchema.parse(WINDOW_CONFIG), $schemaVersion: 99 };
    expect(() => WindowConfigSchema.parse(bad)).toThrow(z.ZodError);
  });
});

describe('Story 1.5 Task3 — the weights data encodes the significant > trivial ordering (AC1)', () => {
  it('every significant verb (summon/spell/counter/melee) outweighs every filler (idle/lone scout)', () => {
    // AC1: "significant beats get visual weight ... trivial bursts aggregate". The base-weight
    // ordering is the mechanical root of that: a significant actionType must score strictly
    // higher than filler BEFORE any modifier is applied. This is a DATA fact, asserted here.
    const w = PACING_WEIGHTS.weights;
    const significant = [w.summon, w.spell, w.counter, w.melee];
    const filler = [w.idle, w.scout];
    for (const s of significant) {
      for (const f of filler) {
        expect(s).toBeGreaterThan(f);
      }
    }
  });

  it('idle is the lowest-weight (the floor of filler)', () => {
    const w = PACING_WEIGHTS.weights;
    expect(w.idle).toBeLessThanOrEqual(w.scout);
    expect(w.idle).toBeLessThan(w.melee);
  });
});
