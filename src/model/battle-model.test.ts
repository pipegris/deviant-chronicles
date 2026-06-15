import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleState, BattleTimeline } from '../schema/battle-timeline';

type Enemy = BattleState['enemies'][number];

// RED-PHASE acceptance tests for Story 2.1 (Task 6) — the pure Layer-0 Battle Model:
// a BattleTimeline in, a BattleState out, computed as a PURE FOLD of the timeline's Beat[]
// up to any cursor. These FAIL until src/model/battle-model.ts exports initialBattleState,
// applyBeat, foldBattleState (and src/model/model-tuning.ts exports MODEL_TUNING). The import
// error is the intended red (exactly like pace.test.ts was in its own red phase).
//
// Pipeline reuse (Dev Notes "The fixture-reading test pattern — copy VERBATIM"): we read the
// COMMITTED ingest fixtures with fs IN THE TEST (tests are not Layer-0 modules, so this respects
// R2) and run the SAME parse -> normalize -> merge -> translate -> pace chain the committed
// golden snapshot (src/pace/__snapshots__/pace.test.ts.snap) pins, then fold the resulting
// BattleTimeline. We do NOT re-implement ingest/translate/pace — we import and call them.
import { initialBattleState, applyBeat, foldBattleState } from './battle-model';
import { MODEL_TUNING } from './model-tuning';
import { BattleStateSchema } from '../schema/battle-timeline';
import { pace } from '../pace/derive-beats';
import { translate } from '../translate/translate';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'ingest', '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

// Copied verbatim from src/pace/pace.test.ts L42-63 (which mirrors translate.test.ts /
// ingest.test.ts) so the model folds the EXACT committed BattleTimeline — including the
// devMaxEpoch+1 journal anchor that orders the orchestrator stream after the dev stream.
function runIngest(): NormalizedEvent[] {
  const transcript = normalizeTranscript(
    parseTranscript(readFixture('sample-transcript.jsonl'), DEV_STREAM_ID),
    DEV_STREAM_ID,
  );
  const devMaxEpoch = Math.max(
    ...transcript.map((e) => Date.parse(e.timestamp)).filter((n) => !Number.isNaN(n)),
  );
  const journal = normalizeJournal(parseJournal(readFixture('sample-journal.jsonl')), devMaxEpoch + 1);
  return mergeStreams([transcript, journal]);
}

// The BattleTimeline the model folds: the SAME object pace.test.ts snapshots. Built per-test
// (a fresh object) so the no-mutation assertions cannot be polluted across tests.
function timeline(): BattleTimeline {
  return pace(translate(runIngest()));
}

// Re-fold a state from scratch by applying each beat with applyBeat (the model's own step
// function), independent of foldBattleState's internal reduce — the cross-check for AC1.
function refoldFromScratch(tl: BattleTimeline, cursor: number): BattleState {
  const n = Math.max(0, Math.min(cursor, tl.beats.length));
  let s = initialBattleState();
  for (let i = 0; i < n; i++) s = applyBeat(s, tl.beats[i], MODEL_TUNING);
  return s;
}

describe('Story 2.1 — fixture sanity (DERIVED from the committed golden timeline, not hardcoded)', () => {
  it('the folded timeline is the committed 10-beat fixture with the expected shape', () => {
    const tl = timeline();
    // Guards the test intuition (Dev Notes fixture table): 10 beats, beat 7 (index 6) the lone
    // counter/struggle, the final beat the completion melee (phase…#result).
    expect(tl.beats.length).toBe(10);
    expect(tl.beats.filter((b) => b.actionType === 'counter')).toHaveLength(1);
    const last = tl.beats[tl.beats.length - 1];
    expect(last.actionType).toBe('melee');
    expect(last.sourceEventIds).toContain('phase-dev-OPAQUEHASH-1#result');
  });
});

describe('Story 2.1 AC1 — bars are reproducible for ANY timeline position (the headline)', () => {
  it('foldBattleState(tl, cursor) deep-equals re-folding from scratch — for EVERY cursor', () => {
    const tl = timeline();
    for (let cursor = 0; cursor <= tl.beats.length; cursor++) {
      expect(foldBattleState(tl, cursor)).toEqual(refoldFromScratch(tl, cursor));
    }
  });

  it('two folds of the same (timeline, cursor) are BYTE-identical (R2 determinism)', () => {
    const tl = timeline();
    for (let cursor = 0; cursor <= tl.beats.length; cursor++) {
      expect(JSON.stringify(foldBattleState(tl, cursor))).toBe(
        JSON.stringify(foldBattleState(tl, cursor)),
      );
    }
  });

  it("the emitted state.cursor equals the number of beats folded", () => {
    const tl = timeline();
    for (let cursor = 0; cursor <= tl.beats.length; cursor++) {
      expect(foldBattleState(tl, cursor).cursor).toBe(cursor);
    }
  });

  it('folding does NOT mutate the input timeline (immutable fold over Beat[])', () => {
    const tl = timeline();
    const before = JSON.stringify(tl);
    foldBattleState(tl, tl.beats.length);
    foldBattleState(tl, 3);
    expect(JSON.stringify(tl)).toBe(before);
  });

  it('applyBeat returns a FRESH state and never mutates the state it is given', () => {
    const tl = timeline();
    const s0 = initialBattleState();
    const snapshot = JSON.stringify(s0);
    const s1 = applyBeat(s0, tl.beats[1], MODEL_TUNING); // beat 2: a melee strike
    expect(s1).not.toBe(s0);
    expect(JSON.stringify(s0)).toBe(snapshot); // input untouched
  });
});

describe('Story 2.1 AC1 — bars update CONSISTENTLY (monotonic, clamped to [0, initial])', () => {
  it('Problem Integrity is monotonically non-increasing across the fold and stays in [0, initial]', () => {
    const tl = timeline();
    const init = initialBattleState();
    let prev = init.problemIntegrity;
    for (let cursor = 0; cursor <= tl.beats.length; cursor++) {
      const pi = foldBattleState(tl, cursor).problemIntegrity;
      expect(pi).toBeLessThanOrEqual(prev);
      expect(pi).toBeGreaterThanOrEqual(0);
      expect(pi).toBeLessThanOrEqual(init.problemIntegrity);
      prev = pi;
    }
  });

  it('Resolve is monotonically non-increasing across the fold and stays in [0, initial]', () => {
    const tl = timeline();
    const init = initialBattleState();
    let prev = init.resolve;
    for (let cursor = 0; cursor <= tl.beats.length; cursor++) {
      const r = foldBattleState(tl, cursor).resolve;
      expect(r).toBeLessThanOrEqual(prev);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(init.resolve);
      prev = r;
    }
  });

  it('the lone counter beat (the struggle) actually DRAINS Resolve', () => {
    const tl = timeline();
    const counterIdx = tl.beats.findIndex((b) => b.actionType === 'counter');
    expect(counterIdx).toBeGreaterThanOrEqual(0);
    const before = foldBattleState(tl, counterIdx).resolve;
    const after = foldBattleState(tl, counterIdx + 1).resolve;
    expect(after).toBeLessThan(before);
  });
});

describe('Story 2.1 AC2 — Insight Gauge: charges on struggle, discharges on breakthrough', () => {
  it('folding to just AFTER the counter beat charges the gauge above 0 (struggle)', () => {
    const tl = timeline();
    const counterIdx = tl.beats.findIndex((b) => b.actionType === 'counter');
    expect(counterIdx).toBeGreaterThanOrEqual(0);
    // Before the struggle the gauge is empty; after the counter beat it is charged.
    expect(foldBattleState(tl, counterIdx).insightGauge).toBe(0);
    expect(foldBattleState(tl, counterIdx + 1).insightGauge).toBeGreaterThan(0);
  });

  it('folding across the breakthrough DISCHARGES the gauge back to 0', () => {
    const tl = timeline();
    const counterIdx = tl.beats.findIndex((b) => b.actionType === 'counter');
    const charged = foldBattleState(tl, counterIdx + 1).insightGauge;
    expect(charged).toBeGreaterThan(0);
    // The breakthrough is the decisive integrity strike that follows the charged gauge
    // (Dev Notes "Breakthrough-from-Layer-0 heuristic"). In this fixture that is the completion
    // melee (the final beat). Pin the TRANSITION, not just the end-state: the gauge must remain
    // charged across the intervening non-strike beats (the scout/idle at cursors 8-9) and stay
    // charged right up to the beat BEFORE the breakthrough, then drop to 0 on the breakthrough beat.
    // Asserting only "0 at the final cursor" would also pass a wrong impl that zeroed the gauge on
    // victory or on the last beat; asserting the charge SURVIVES until the breakthrough then drops
    // ties the discharge to the heuristic firing on that specific strike.
    const lastIdx = tl.beats.length - 1;
    expect(foldBattleState(tl, lastIdx).insightGauge).toBe(charged); // still charged the beat before
    expect(foldBattleState(tl, lastIdx + 1).insightGauge).toBe(0); // discharged ON the breakthrough beat
  });

  it('the gauge is never negative and never exceeds the configured maxGauge', () => {
    const tl = timeline();
    for (let cursor = 0; cursor <= tl.beats.length; cursor++) {
      const g = foldBattleState(tl, cursor).insightGauge;
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(MODEL_TUNING.insight.maxGauge);
    }
  });
});

describe('Story 2.1 AC3 — Boss defeated at EXACTLY the completion point -> victory', () => {
  it('the full fold (through the completion beat) is a victory with the Boss at hp 0', () => {
    const tl = timeline();
    const end = foldBattleState(tl, tl.beats.length);
    expect(end.victory).toBe(true);
    const boss = end.enemies.find((e: Enemy) => e.id === MODEL_TUNING.boss.id);
    expect(boss, 'the Boss enemy is present in the roster').toBeDefined();
    expect(boss!.hp).toBe(0);
    // Problem Integrity and the Boss HP are the same quantity (Dev Notes "Boss hp and
    // problemIntegrity are the SAME quantity"): the bar empties when the Boss falls.
    expect(end.problemIntegrity).toBe(0);
  });

  it('folding to ONE beat before completion is NOT yet a victory (Boss still alive)', () => {
    const tl = timeline();
    // cursor = length-1 folds beats[0..length-1), i.e. excludes the final completion beat.
    const beforeCompletion = foldBattleState(tl, tl.beats.length - 1);
    expect(beforeCompletion.victory).toBe(false);
    const boss = beforeCompletion.enemies.find((e: Enemy) => e.id === MODEL_TUNING.boss.id);
    expect(boss!.hp).toBeGreaterThan(0);
    expect(beforeCompletion.problemIntegrity).toBeGreaterThan(0);
  });

  it('once victory is reached it stays true (folding the whole timeline keeps it set)', () => {
    const tl = timeline();
    const atCompletion = foldBattleState(tl, tl.beats.length - 1 + 1); // the completion beat
    const full = foldBattleState(tl, tl.beats.length);
    expect(atCompletion.victory).toBe(true);
    expect(full.victory).toBe(true);
  });

  it('the model output parses against the committed BattleStateSchema (boundary-validated)', () => {
    const tl = timeline();
    for (let cursor = 0; cursor <= tl.beats.length; cursor++) {
      expect(() => BattleStateSchema.parse(foldBattleState(tl, cursor))).not.toThrow();
    }
  });

  // F2: AC3 hinges on a tight coupling — the cumulative integrity damage across the fixture
  // (sum of integrity-strike weights * integrityDamagePerWeight) must REACH boss.hp so the Boss
  // dies on the completion beat. The committed config lands it on exactly 0 (sum == hp). This
  // EARLY-WARNING guard asserts the invariant `sum(integrity-strike weights * scalar) >= boss.hp`
  // directly: a future weight/pacing tune (or a boss.hp/scalar change) that breaks the relation
  // fails HERE with a clear message, instead of silently shifting the victory cursor and surfacing
  // as a confusing victory-±1-beat failure. (Dev Notes L136 flagged this coupling.)
  it('AC3 coupling guard — cumulative integrity damage reaches boss.hp (the Boss can be defeated)', () => {
    const tl = timeline();
    const scalar = MODEL_TUNING.effects.integrityDamagePerWeight;
    const totalIntegrityDamage = tl.beats
      .filter((b) => b.actionType === 'melee' || b.actionType === 'spell')
      .reduce((sum, b) => sum + b.weight * scalar, 0);
    expect(totalIntegrityDamage).toBeGreaterThanOrEqual(MODEL_TUNING.boss.hp);
  });

  it('AC3 purity guard — the model exposes only the 6 BattleState fields (consumes Layer-0 only)', () => {
    // R1 (no interpret/ import) is enforced by eslint; here we prove the EMITTED state carries no
    // smuggled interpretation field — exactly the 6 BattleState keys, nothing more.
    const end = foldBattleState(timeline(), timeline().beats.length);
    expect(Object.keys(end).sort()).toEqual(
      ['cursor', 'enemies', 'insightGauge', 'problemIntegrity', 'resolve', 'victory'].sort(),
    );
  });
});
