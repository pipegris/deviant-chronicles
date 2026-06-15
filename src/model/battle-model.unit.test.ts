import { describe, expect, it } from 'vitest';
import type { ActionType } from '../schema/normalized-event';
import type { Beat, BattleTimeline, BattleState } from '../schema/battle-timeline';

type Enemy = BattleState['enemies'][number];

// RED-PHASE unit tests for Story 2.1 (Task 6 "optional unit splits") — narrow edge cases of
// initialBattleState / applyBeat / foldBattleState that the fixture suite does not exercise
// directly: the t=0 snapshot, the empty timeline, cursor clamping, bar clamping at 0, and the
// fail-closed-to-default no-op on a verb with no bar effect. FAIL until battle-model.ts +
// model-tuning.ts exist (the import error is the intended red).
import { initialBattleState, applyBeat, foldBattleState } from './battle-model';
import { MODEL_TUNING } from './model-tuning';

// A synthetic Beat (mechanics only — no interpretation fields, per BeatSchema). orderKey/
// dwellMs/sourceEventIds are required by the type but irrelevant to the bar math; the model
// reads actionType + weight ONLY.
function beat(actionType: ActionType, weight: number): Beat {
  return {
    orderKey: { logicalClock: 0, streamId: 's', seqWithinStream: 0 },
    actionType,
    sourceEventIds: [],
    weight,
    dwellMs: 0,
  };
}

function timelineOf(beats: Beat[]): BattleTimeline {
  return { schemaVersion: 1, beats, totalDurationMs: 0 };
}

describe('Story 2.1 — initialBattleState is the t=0 snapshot from config', () => {
  it('full bars, gauge 0, one Boss enemy at full hp, cursor 0, not victory', () => {
    const s = initialBattleState();
    expect(s.problemIntegrity).toBe(MODEL_TUNING.initial.problemIntegrity);
    expect(s.resolve).toBe(MODEL_TUNING.initial.resolve);
    expect(s.insightGauge).toBe(0);
    expect(s.cursor).toBe(0);
    expect(s.victory).toBe(false);
    // The Boss is seeded from config and its hp tracks problemIntegrity at t=0.
    const boss = s.enemies.find((e: Enemy) => e.id === MODEL_TUNING.boss.id);
    expect(boss, 'Boss enemy seeded from config').toBeDefined();
    expect(boss!.hp).toBe(MODEL_TUNING.boss.hp);
    expect(boss!.type).toBe(MODEL_TUNING.boss.type);
  });

  it('two calls produce equal, independent snapshots (no shared mutable module state, R2)', () => {
    const a = initialBattleState();
    const b = initialBattleState();
    expect(a).toEqual(b);
    expect(a.enemies).not.toBe(b.enemies); // fresh arrays, not a shared reference
  });
});

describe('Story 2.1 — foldBattleState edge cases (empty timeline, cursor clamping)', () => {
  it('an empty timeline folds to the initial state (cursor 0)', () => {
    const s = foldBattleState(timelineOf([]));
    expect(s).toEqual(initialBattleState());
  });

  it('cursor <= 0 returns the initial state regardless of beats present', () => {
    const tl = timelineOf([beat('melee', 10), beat('spell', 10)]);
    expect(foldBattleState(tl, 0)).toEqual(initialBattleState());
    expect(foldBattleState(tl, -5)).toEqual(initialBattleState());
  });

  it('cursor beyond beats.length clamps to folding the whole timeline', () => {
    const tl = timelineOf([beat('melee', 10), beat('spell', 10)]);
    const whole = foldBattleState(tl, tl.beats.length);
    const overshoot = foldBattleState(tl, 999);
    expect(overshoot).toEqual(whole);
    expect(overshoot.cursor).toBe(tl.beats.length);
  });
});

describe('Story 2.1 — applyBeat bar mechanics (actionType + weight only)', () => {
  it('melee damages Problem Integrity AND the Boss hp in lockstep (same quantity)', () => {
    const before = initialBattleState();
    const after = applyBeat(before, beat('melee', 10), MODEL_TUNING);
    expect(after.problemIntegrity).toBeLessThan(before.problemIntegrity);
    const boss = after.enemies.find((e: Enemy) => e.id === MODEL_TUNING.boss.id);
    expect(boss!.hp).toBe(after.problemIntegrity);
  });

  it('spell also damages Problem Integrity', () => {
    const before = initialBattleState();
    const after = applyBeat(before, beat('spell', 10), MODEL_TUNING);
    expect(after.problemIntegrity).toBeLessThan(before.problemIntegrity);
  });

  it('counter drains Resolve and charges the Insight Gauge (the struggle signal)', () => {
    const before = initialBattleState();
    const after = applyBeat(before, beat('counter', 13), MODEL_TUNING);
    expect(after.resolve).toBeLessThan(before.resolve);
    expect(after.insightGauge).toBeGreaterThan(before.insightGauge);
    // A counter is not an integrity strike — it must not damage the Boss bar.
    expect(after.problemIntegrity).toBe(before.problemIntegrity);
  });

  it('scout / summon / idle / aetherStorm are NO-OPs on the bars (fail-closed-to-default)', () => {
    const before = initialBattleState();
    for (const verb of ['scout', 'summon', 'idle', 'aetherStorm'] as ActionType[]) {
      const after = applyBeat(before, beat(verb, 5), MODEL_TUNING);
      expect(after.problemIntegrity).toBe(before.problemIntegrity);
      expect(after.resolve).toBe(before.resolve);
      expect(after.insightGauge).toBe(before.insightGauge);
    }
  });
});

// AC2 breakthrough heuristic — the LOAD-BEARING gate, isolated at applyBeat level.
//
// Why these tests exist: the fixture suite (battle-model.test.ts AC2) only proves the gauge is 0
// at the FINAL fold cursor — but in that fixture the breakthrough strike IS the completion melee,
// so victory, bossHp===0 and the discharge all coincide on the same beat. That single assertion
// would ALSO pass a wrong implementation that zeroed the gauge on victory, on the last beat, or on
// ANY integrity strike regardless of the gauge. The Dev Notes justify THIS heuristic over those
// alternatives precisely by the `insightGauge >= dischargeThreshold` gate ("an unstruggled strike
// never discharges — the discharge is EARNED"). These tests pin that gate directly, on strikes that
// are NOT the completion beat, so the discharge cannot be conflated with victory. Thresholds are
// read from MODEL_TUNING (no magic numbers): a future tune flows through unchanged.
describe('Story 2.1 AC2 — breakthrough discharge is GATED on a charged gauge (earned, not free)', () => {
  it('a charged gauge (>= dischargeThreshold) discharges to 0 on the NEXT integrity strike — and damage still lands', () => {
    // Charge first: a single counter takes the gauge to chargePerStruggle, which the committed
    // config sets at/above dischargeThreshold (the struggle is what arms the breakthrough).
    const charged = applyBeat(initialBattleState(), beat('counter', 13), MODEL_TUNING);
    expect(charged.insightGauge).toBeGreaterThanOrEqual(MODEL_TUNING.insight.dischargeThreshold);
    expect(charged.victory).toBe(false); // a counter never kills the Boss — discharge is decoupled from victory

    // The decisive strike: a modest melee that does NOT empty the bar (Boss survives), so the
    // discharge cannot be attributed to victory / the completion beat / hp hitting 0.
    const breakthrough = applyBeat(charged, beat('melee', 10), MODEL_TUNING);
    expect(breakthrough.insightGauge).toBe(0); // discharged BY the breakthrough, mid-fight
    expect(breakthrough.victory).toBe(false); // still alive — the discharge stands on its own
    expect(breakthrough.problemIntegrity).toBeLessThan(charged.problemIntegrity); // damage still landed
  });

  it('an integrity strike does NOT discharge a gauge that is BELOW dischargeThreshold (the gate is real)', () => {
    // A below-threshold charge (one tick under the gate) must SURVIVE a strike — proving the
    // discharge is conditioned on the gauge, not fired by every melee/spell. Construct the charged
    // state directly (applyBeat is pure over any BattleState input) so the gauge sits just under
    // the configured threshold without depending on a particular charge magnitude.
    const underThreshold = MODEL_TUNING.insight.dischargeThreshold - 1;
    const armed = { ...initialBattleState(), insightGauge: underThreshold };
    const after = applyBeat(armed, beat('melee', 10), MODEL_TUNING);
    expect(after.insightGauge).toBe(underThreshold); // untouched — strike did NOT discharge
    expect(after.problemIntegrity).toBeLessThan(armed.problemIntegrity); // damage still landed
  });

  it('a counter does not discharge (only an integrity strike can be a breakthrough)', () => {
    // Even when the gauge is already at/over threshold, another struggle (counter) keeps charging /
    // holds — it is not itself a breakthrough. This pins that the discharge branch is keyed to the
    // integrity-strike verbs (melee/spell), not to "any beat while charged".
    const charged = { ...initialBattleState(), insightGauge: MODEL_TUNING.insight.dischargeThreshold };
    const after = applyBeat(charged, beat('counter', 13), MODEL_TUNING);
    expect(after.insightGauge).toBeGreaterThanOrEqual(MODEL_TUNING.insight.dischargeThreshold);
  });
});

describe('Story 2.1 — clamping at 0 and victory latching', () => {
  it('Problem Integrity / Boss hp clamp at 0 under overwhelming damage and never go negative', () => {
    // Many huge melee strikes — far more than enough to drop the bar below zero if unclamped.
    const beats = Array.from({ length: 50 }, () => beat('melee', 100));
    const s = foldBattleState(timelineOf(beats));
    expect(s.problemIntegrity).toBe(0);
    const boss = s.enemies.find((e: Enemy) => e.id === MODEL_TUNING.boss.id);
    expect(boss!.hp).toBe(0);
    expect(s.victory).toBe(true);
  });

  it('Resolve clamps at 0 under repeated counters and never goes negative', () => {
    const beats = Array.from({ length: 50 }, () => beat('counter', 100));
    const s = foldBattleState(timelineOf(beats));
    expect(s.resolve).toBe(0);
    expect(s.resolve).toBeGreaterThanOrEqual(0);
  });

  it('once the Boss is at 0, a further integrity beat keeps hp at 0 and victory true', () => {
    const beats = [beat('melee', 100), beat('melee', 100), beat('melee', 100)];
    const after2 = foldBattleState(timelineOf(beats), 2);
    const after3 = foldBattleState(timelineOf(beats), 3);
    expect(after2.victory).toBe(true);
    expect(after3.victory).toBe(true);
    expect(after3.problemIntegrity).toBe(0);
  });

  // F1: victory is keyed to the defeating integrity STRIKE, not the bare bar value (AC3's "the
  // Boss is defeated at exactly that point"). Under a degenerate tuning where the bar already
  // starts at 0, a no-op beat (idle/scout/summon/aetherStorm/counter) must NOT spuriously flip
  // victory — only an integrity strike that brings the bar to 0 may. The old `state.victory ||
  // problemIntegrity <= 0` (evaluated on every beat) would have flipped victory on the first
  // no-op beat here; gating the latch inside the strike branch is what this pins.
  it('a no-op beat does NOT flip victory even when the bar already sits at 0 (strike-keyed latch)', () => {
    const zeroBarTuning = {
      ...MODEL_TUNING,
      initial: { ...MODEL_TUNING.initial, problemIntegrity: 0 },
      boss: { ...MODEL_TUNING.boss, hp: 0 },
    };
    const init = initialBattleState(zeroBarTuning);
    expect(init.victory).toBe(false); // bar at 0 at t=0, but no defeating strike has landed
    for (const verb of ['idle', 'scout', 'summon', 'aetherStorm', 'counter'] as ActionType[]) {
      const after = applyBeat(init, beat(verb, 5), zeroBarTuning);
      expect(after.victory).toBe(false); // no-op beats never defeat the Boss
    }
    // An actual integrity strike on a bar already at 0 DOES register the defeat (it "lands" at 0).
    const struck = applyBeat(init, beat('melee', 5), zeroBarTuning);
    expect(struck.victory).toBe(true);
  });
});

// Fail-closed boundary (Task 3): foldBattleState ends with BattleStateSchema.parse(state) so a
// malformed state THROWS rather than flowing downstream. The fixture suite only proves the
// positive case (valid states parse) — which would still pass if the .parse guard were deleted.
// This drives a malformed state through the legitimate `tuning` injection seam (no monkeypatching,
// no production change) and asserts the parse actually rejects it, pinning the guard's presence.
describe('Story 2.1 — foldBattleState fails CLOSED on a malformed computed state (boundary parse)', () => {
  it('a NaN-producing tuning makes the computed bar non-finite and the boundary parse throws', () => {
    // z.number() rejects NaN; a NaN per-weight scalar drives problemIntegrity to NaN, so the
    // closing BattleStateSchema.parse must reject the state instead of returning it. A timeline
    // with at least one integrity strike is required to actually apply the bad scalar.
    const badTuning = {
      ...MODEL_TUNING,
      effects: { ...MODEL_TUNING.effects, integrityDamagePerWeight: Number.NaN },
    };
    const tl = timelineOf([beat('melee', 10)]);
    expect(() => foldBattleState(tl, tl.beats.length, badTuning)).toThrow();
    // Sanity: the SAME timeline with the real (committed) tuning does NOT throw — proving the
    // throw is the malformed-state guard firing, not an unrelated failure in the fold itself.
    expect(() => foldBattleState(tl, tl.beats.length, MODEL_TUNING)).not.toThrow();
  });
});
