import { describe, expect, it } from 'vitest';

// RED-PHASE unit tests for Story 2.1 Task 2 — the config-as-data Zod loader
// (src/model/model-tuning.ts + src/config/model-tuning.json). These FAIL until the dev
// creates ModelTuningSchema + the validated MODEL_TUNING const (the import error is the
// intended red, exactly like pace.test.ts in its red phase).
//
// The contract (Dev Notes "Bar/gauge magnitudes — config-as-data (NFR-4)"): a flat,
// .strict()-validated record with `$schemaVersion: z.literal(1)`, mirroring pacing-config.ts.
// We prove: a valid committed config parses; a bumped $schemaVersion fails closed; an unknown
// (typo'd) key is rejected (.strict); a non-number magnitude is rejected. This is the
// fail-LOUD-at-build-time validation the project mandates for committed config.
import { ModelTuningSchema, MODEL_TUNING } from './model-tuning';

// A minimal valid tuning object matching the documented proposed shape. The dev may pick
// different magnitudes (they tune against the fixture fold), but the SHAPE — these keys,
// these types, $schemaVersion === 1 — is the contract this loader validates.
function validTuning() {
  return {
    $schemaVersion: 1 as const,
    initial: { problemIntegrity: 100, resolve: 100 },
    insight: { maxGauge: 100, chargePerStruggle: 60, dischargeThreshold: 50 },
    boss: { id: 'boss', type: 'feature', hp: 100 },
    effects: { integrityDamagePerWeight: 1.0, resolveDrainPerWeight: 1.0 },
  };
}

describe('Story 2.1 Task 2 — MODEL_TUNING is the validated, committed config', () => {
  it('the committed config parses against ModelTuningSchema (validated at import)', () => {
    expect(() => ModelTuningSchema.parse(MODEL_TUNING)).not.toThrow();
  });

  it('$schemaVersion is the literal 1 and the bars/insight/boss/effects blocks are present', () => {
    expect(MODEL_TUNING.$schemaVersion).toBe(1);
    expect(typeof MODEL_TUNING.initial.problemIntegrity).toBe('number');
    expect(typeof MODEL_TUNING.initial.resolve).toBe('number');
    expect(typeof MODEL_TUNING.insight.maxGauge).toBe('number');
    expect(typeof MODEL_TUNING.insight.chargePerStruggle).toBe('number');
    expect(typeof MODEL_TUNING.insight.dischargeThreshold).toBe('number');
    expect(typeof MODEL_TUNING.boss.id).toBe('string');
    expect(typeof MODEL_TUNING.boss.type).toBe('string');
    expect(typeof MODEL_TUNING.boss.hp).toBe('number');
    expect(typeof MODEL_TUNING.effects.integrityDamagePerWeight).toBe('number');
    expect(typeof MODEL_TUNING.effects.resolveDrainPerWeight).toBe('number');
  });
});

describe('Story 2.1 Task 2 — ModelTuningSchema fails CLOSED (fail-loud at build time)', () => {
  it('a valid in-memory tuning object parses', () => {
    expect(() => ModelTuningSchema.parse(validTuning())).not.toThrow();
  });

  it('a bumped $schemaVersion (2) is rejected — an old reader will not parse a new artifact', () => {
    const bad = { ...validTuning(), $schemaVersion: 2 };
    expect(() => ModelTuningSchema.parse(bad)).toThrow();
  });

  it('an unknown/typo`d top-level key is rejected (.strict — no silent extra config)', () => {
    const bad = { ...validTuning(), nemesis: { hp: 5 } };
    expect(() => ModelTuningSchema.parse(bad)).toThrow();
  });

  it('a non-number magnitude (string boss.hp) is rejected', () => {
    const v = validTuning();
    const bad = { ...v, boss: { ...v.boss, hp: '100' } };
    expect(() => ModelTuningSchema.parse(bad)).toThrow();
  });

  it('a missing required block (no effects) is rejected', () => {
    const v = validTuning();
    const { effects: _drop, ...bad } = v;
    void _drop;
    expect(() => ModelTuningSchema.parse(bad)).toThrow();
  });
});
