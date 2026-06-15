import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleState, BattleTimeline, Beat } from '../schema/battle-timeline';

// RED-PHASE acceptance tests for Story 2.4 (Task 1 + Task 4) — the PURE animation-plan layer
// `planAnimations(prev, next, beatsAdvanced) -> AnimationIntent[]` plus the `isHammerFlurry(beat)`
// predicate. These FAIL until src/render/animation-plan.ts exports `planAnimations`,
// `isHammerFlurry`, and the `AnimationIntent` / `AnimName` / `AnimTarget` types. The import error is
// the intended RED (exactly the posture render-model.test.ts had in its own red phase). This is the
// bulk of the gate-provable surface for AC1/AC2/AC3 — the transition->intent DECISION logic,
// expressed as plain data, with ZERO Phaser (node env, no DOM).
//
// What the gate CAN prove here (per the story's "VERIFICATION REALITY"): WHICH animation INTENTS
// fire for a given (prev, next, beatsAdvanced) transition — Hammer-Flurry-vs-single-strike (a pure
// function of the Beat's sourceEventIds cardinality), stagger->rise correlation with the gauge
// increment, hit/death intents, the Aether-Storm trigger, and bar/gauge from->to deltas. It CANNOT
// prove motion quality / 60fps / "reads as a flurry" / "looks like defiance" — those are the visual
// READING of these intents, OPERATOR-verified by watching `pnpm dev`.
//
// Pipeline reuse (Dev Notes "Testing Standards" + render-model.test.ts L43-57, copied VERBATIM): we
// read the COMMITTED ingest fixtures with fs IN THE TEST (tests are not Layer-0 modules, so this
// respects R2) and run the SAME parse -> normalize -> merge -> translate -> pace chain the golden
// snapshot pins, then fold the resulting BattleTimeline to drive REAL transitions through
// planAnimations. Hand-built Beat/BattleState are used ONLY for branches the committed fixture does
// not reach (the POSITIVE Hammer-Flurry branch — the fixture has no multi-source melee).
import {
  planAnimations,
  isHammerFlurry,
  type AnimationIntent,
} from './animation-plan';
import { foldBattleState, applyBeat } from '../model/battle-model';
import { MODEL_TUNING } from '../model/model-tuning';
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

// Copied verbatim from src/render/render-model.test.ts L43-57 so the renderer maps the EXACT
// committed BattleTimeline / BattleState the model tests fold.
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

function timeline(): BattleTimeline {
  return pace(translate(runIngest()));
}

// ---- hand-built Beat/BattleState helpers (for branches the committed fixture does not reach) ----

// A minimal Beat with the given actionType + source-event cardinality. orderKey/weight/dwellMs are
// filled with plausible-but-irrelevant values — planAnimations keys off actionType + sourceEventIds
// (and weight only for intensity), so the exact orderKey/dwellMs do not affect the asserted intents.
function beat(actionType: Beat['actionType'], sourceEventIds: string[], weight = 16): Beat {
  return {
    orderKey: { logicalClock: 0, streamId: DEV_STREAM_ID, seqWithinStream: 0 },
    actionType,
    sourceEventIds,
    weight,
    dwellMs: weight * 120,
  };
}

// A hand-built snapshot for branches the fixture doesn't reach (the positive rise). Defaults are the
// t=0 full bars; override only the fields a given transition needs.
function snap(overrides: Partial<BattleState> = {}): BattleState {
  return {
    problemIntegrity: 100,
    resolve: 100,
    insightGauge: 0,
    enemies: [{ id: 'boss', type: 'feature', hp: 100 }],
    cursor: 0,
    victory: false,
    ...overrides,
  };
}

// Convenience: the intents targeting the Forgemaiden whose anim matches `anim`.
function intentsFor(intents: AnimationIntent[], target: AnimationIntent['target'], anim?: AnimationIntent['anim']) {
  return intents.filter((i) => i.target === target && (anim === undefined || i.anim === anim));
}

describe('Story 2.4 AC1 — isHammerFlurry: a multi-source MELEE beat is a flurry, everything else is not', () => {
  it('is true for a melee beat with MORE THAN ONE source event (a collapsed burst of edits)', () => {
    expect(isHammerFlurry(beat('melee', ['a', 'b', 'c']))).toBe(true);
  });

  it('is false for a melee beat with EXACTLY ONE source event (a single forge-strike)', () => {
    expect(isHammerFlurry(beat('melee', ['a']))).toBe(false);
  });

  it('is false for a multi-source NON-melee beat (only MELEE multi-source is a flurry)', () => {
    // The committed fixture's multi-source windows are scout(4) and scout(2) — they must NOT be
    // flurries. A multi-source spell/counter is likewise not a flurry.
    expect(isHammerFlurry(beat('scout', ['a', 'b', 'c', 'd']))).toBe(false);
    expect(isHammerFlurry(beat('spell', ['a', 'b']))).toBe(false);
    expect(isHammerFlurry(beat('counter', ['a', 'b']))).toBe(false);
  });
});

describe('Story 2.4 AC1 — planAnimations: Hammer Flurry vs a single forge-strike', () => {
  it('a transition advancing a multi-source MELEE beat emits a hammer-flurry intent with repeat === the strike count', () => {
    const intents = planAnimations(snap(), snap({ problemIntegrity: 60, cursor: 1 }), [
      beat('melee', ['a', 'b', 'c']),
    ]);
    const flurry = intentsFor(intents, 'forgemaiden', 'hammer-flurry');
    expect(flurry).toHaveLength(1);
    // The multi-strike count = the number of collapsed source events (3) so the Phaser layer fires
    // that many quick sub-strikes.
    expect(flurry[0].repeat).toBe(3);
    // The flurry, NOT a single forge-strike, is the Forgemaiden action for this transition.
    expect(intentsFor(intents, 'forgemaiden', 'forge-strike')).toHaveLength(0);
  });

  it('a transition advancing a single-source MELEE beat emits a forge-strike (NOT a flurry)', () => {
    const intents = planAnimations(snap(), snap({ problemIntegrity: 80, cursor: 1 }), [
      beat('melee', ['a']),
    ]);
    expect(intentsFor(intents, 'forgemaiden', 'forge-strike')).toHaveLength(1);
    expect(intentsFor(intents, 'forgemaiden', 'hammer-flurry')).toHaveLength(0);
  });

  it('the flurry per-strike durationMs is SHORTER than a single forge-strike (the "visibly faster" decision, as a number relation)', () => {
    const flurryIntents = planAnimations(snap(), snap({ problemIntegrity: 60, cursor: 1 }), [
      beat('melee', ['a', 'b', 'c']),
    ]);
    const strikeIntents = planAnimations(snap(), snap({ problemIntegrity: 80, cursor: 1 }), [
      beat('melee', ['a']),
    ]);
    const flurry = intentsFor(flurryIntents, 'forgemaiden', 'hammer-flurry')[0];
    const strike = intentsFor(strikeIntents, 'forgemaiden', 'forge-strike')[0];
    expect(flurry.durationMs).toBeLessThan(strike.durationMs);
  });
});

describe('Story 2.4 AC1 — planAnimations: each Forgemaiden action state fires its intent', () => {
  it('a spell beat -> a cast intent', () => {
    const intents = planAnimations(snap(), snap({ problemIntegrity: 88, cursor: 1 }), [
      beat('spell', ['a'], 12),
    ]);
    expect(intentsFor(intents, 'forgemaiden', 'cast')).toHaveLength(1);
  });

  it('a counter beat -> a stagger intent', () => {
    const intents = planAnimations(
      snap(),
      snap({ resolve: 87, insightGauge: 60, cursor: 1 }),
      [beat('counter', ['a'], 13)],
    );
    expect(intentsFor(intents, 'forgemaiden', 'stagger')).toHaveLength(1);
  });

  it('an idle beat -> an idle intent', () => {
    const intents = planAnimations(snap(), snap({ cursor: 1 }), [beat('idle', ['a'], 1)]);
    expect(intentsFor(intents, 'forgemaiden', 'idle')).toHaveLength(1);
  });

  it('an EMPTY beatsAdvanced (a held frame / tick that crossed no beat boundary) emits NO Forgemaiden action intent', () => {
    const intents = planAnimations(snap(), snap(), []);
    expect(intentsFor(intents, 'forgemaiden')).toHaveLength(0);
  });

  it('scout / summon beats emit NO Forgemaiden action intent (not a melee/spell/struggle)', () => {
    const scout = planAnimations(snap(), snap({ cursor: 1 }), [beat('scout', ['a', 'b'], 2)]);
    expect(intentsFor(scout, 'forgemaiden')).toHaveLength(0);
    const summon = planAnimations(snap(), snap({ cursor: 1 }), [beat('summon', ['a'], 3)]);
    expect(intentsFor(summon, 'forgemaiden')).toHaveLength(0);
  });
});

describe('Story 2.4 AC2 — stagger -> rise coincides with the Insight Gauge charging (struggle -> power)', () => {
  it('a stagger (counter) transition emits a stagger intent AND a gauge-tween with to > from (the gauge charges)', () => {
    // counter: Resolve DOWN and gauge UP — the struggle that charges the gauge.
    const prev = snap({ resolve: 100, insightGauge: 0 });
    const next = snap({ resolve: 87, insightGauge: 60, cursor: 1 });
    const intents = planAnimations(prev, next, [beat('counter', ['a'], 13)]);

    expect(intentsFor(intents, 'forgemaiden', 'stagger')).toHaveLength(1);
    const gaugeTween = intentsFor(intents, 'insightGauge', 'gauge-tween');
    expect(gaugeTween).toHaveLength(1);
    expect(gaugeTween[0].to!).toBeGreaterThan(gaugeTween[0].from!);
  });

  it('a RETRY strike transition where the gauge climbs further emits BOTH a rise AND a gauge-tween (to > from), together', () => {
    // A melee/spell strike landing AS the gauge keeps climbing is "the rise after the stagger,
    // gauge charging further" (defiance not defeat). This branch is NOT reached by the committed
    // fixture (its only post-counter strike DISCHARGES the gauge), so it is hand-built.
    const prev = snap({ insightGauge: 20, problemIntegrity: 50 });
    const next = snap({ insightGauge: 40, problemIntegrity: 34, cursor: 1 });
    const intents = planAnimations(prev, next, [beat('melee', ['a'], 16)]);

    expect(intentsFor(intents, 'forgemaiden', 'rise')).toHaveLength(1);
    const gaugeTween = intentsFor(intents, 'insightGauge', 'gauge-tween');
    expect(gaugeTween).toHaveLength(1);
    expect(gaugeTween[0].to!).toBeGreaterThan(gaugeTween[0].from!);
  });

  it('the BREAKTHROUGH/DISCHARGE case (a charged strike that empties the gauge) emits NO rise but a gauge-tween TO 0', () => {
    // prev.insightGauge >= dischargeThreshold (50) and a strike lands -> the model discharges the
    // gauge to 0 (it goes DOWN). That is the breakthrough (Epic 3's THUNDORR moment), NOT a rise.
    const prev = snap({ insightGauge: 60, problemIntegrity: 16 });
    const next = snap({ insightGauge: 0, problemIntegrity: 0, victory: true, cursor: 1 });
    const intents = planAnimations(prev, next, [beat('melee', ['a'], 16)]);

    expect(intentsFor(intents, 'forgemaiden', 'rise')).toHaveLength(0);
    const gaugeTween = intentsFor(intents, 'insightGauge', 'gauge-tween');
    expect(gaugeTween).toHaveLength(1);
    expect(gaugeTween[0].to).toBe(0);
    expect(gaugeTween[0].to!).toBeLessThan(gaugeTween[0].from!);
  });

  it('a speed>=2 advance fusing a REAL counter + a REAL strike (gauge still below dischargeThreshold) emits a rise on genuine model-folded data', () => {
    // The HONEST realization of "counter then strike in one tick" (R2): the rise positive branch is
    // unreachable at speed=1 in the committed fixture (the only post-counter strike DISCHARGES the
    // gauge — see the Honest-Gaps note + R1). Here we prove the rise fires on data the BATTLE MODEL
    // itself produces (not a hand-faked melee-charges-the-gauge snapshot, which the model can never
    // emit): with an in-memory tuning where chargePerStruggle (20) < dischargeThreshold (50), a real
    // counter beat charges the gauge 0->20, then a real melee strike (gauge 20 < 50 -> NO discharge)
    // damages integrity while the gauge stays charged. A speed>=2 tick fuses both into ONE
    // beatsAdvanced slice, so prev->next shows the gauge genuinely risen WITH a strike present -> rise.
    const tuning = {
      ...MODEL_TUNING,
      insight: { ...MODEL_TUNING.insight, chargePerStruggle: 20, dischargeThreshold: 50 },
    };
    const counterBeat = beat('counter', ['c'], 13);
    const strikeBeat = beat('melee', ['m'], 16);
    // Fold the two beats through the REAL reducer (applyBeat) so prev/next are genuine model output.
    const prev = snap({ insightGauge: 0, problemIntegrity: 100, resolve: 100 });
    const afterCounter = applyBeat(prev, counterBeat, tuning);
    const next = applyBeat(afterCounter, strikeBeat, tuning);
    // Sanity: the model genuinely charged the gauge (0 -> 20) and did NOT discharge it on the strike.
    expect(prev.insightGauge).toBe(0);
    expect(next.insightGauge).toBe(20);
    expect(next.problemIntegrity).toBeLessThan(prev.problemIntegrity);

    const intents = planAnimations(prev, next, [counterBeat, strikeBeat]);
    expect(intentsFor(intents, 'forgemaiden', 'rise')).toHaveLength(1);
    const gaugeTween = intentsFor(intents, 'insightGauge', 'gauge-tween');
    expect(gaugeTween).toHaveLength(1);
    expect(gaugeTween[0].to!).toBeGreaterThan(gaugeTween[0].from!);
  });
});

describe('Story 2.4 AC3 — enemy hit/death + bar/gauge tweens from the snapshot deltas', () => {
  it('a transition where problemIntegrity DROPS emits a Boss hit AND a problemIntegrityBar bar-tween with to < from', () => {
    const intents = planAnimations(
      snap({ problemIntegrity: 80 }),
      snap({ problemIntegrity: 64, cursor: 1 }),
      [beat('melee', ['a'], 16)],
    );
    expect(intentsFor(intents, 'boss', 'hit')).toHaveLength(1);
    const barTween = intentsFor(intents, 'problemIntegrityBar', 'bar-tween');
    expect(barTween).toHaveLength(1);
    expect(barTween[0].to!).toBeLessThan(barTween[0].from!);
  });

  it('the Boss-vs-Minion distinction: a damaging transition also emits the placeholder minion hit cue (paired with the Boss hit)', () => {
    // AC3 "Boss vs Minion/imp render distinctly". The Boss gets a MODEL-driven hit; the minion gets a
    // PRESENTATION-ONLY placeholder hit cue when a strike lands (v0.1 BattleState has no per-minion HP,
    // so a minion death cannot be model-driven yet). Pin that the minion cue actually fires alongside
    // the Boss hit — without this, the only AC3 behavior that distinguishes the minion from the Boss is
    // asserted nowhere and a regression that dropped it would pass.
    const intents = planAnimations(
      snap({ problemIntegrity: 80 }),
      snap({ problemIntegrity: 64, cursor: 1 }),
      [beat('melee', ['a'], 16)],
    );
    expect(intentsFor(intents, 'minion', 'hit')).toHaveLength(1);
    expect(intentsFor(intents, 'boss', 'hit')).toHaveLength(1);
  });

  it('a NON-damaging transition (problemIntegrity unchanged) emits NEITHER a Boss hit NOR a minion cue', () => {
    // The fail-closed half of the hit/minion logic: no integrity drop -> no hit of either kind. An
    // idle beat that changes no bar must leave the enemies un-hit (the minion cue is keyed to the Boss
    // taking damage, not to any beat advancing). This pins the negative branch the positive tests skip.
    const intents = planAnimations(snap(), snap({ cursor: 1 }), [beat('idle', ['a'], 1)]);
    expect(intentsFor(intents, 'boss', 'hit')).toHaveLength(0);
    expect(intentsFor(intents, 'minion', 'hit')).toHaveLength(0);
  });

  it('the DEFEATING transition (!prev.victory && next.victory) emits a Boss death', () => {
    const intents = planAnimations(
      snap({ problemIntegrity: 16, victory: false }),
      snap({ problemIntegrity: 0, victory: true, cursor: 1 }),
      [beat('melee', ['a'], 16)],
    );
    expect(intentsFor(intents, 'boss', 'death')).toHaveLength(1);
  });

  it('a Resolve drop emits a resolveBar bar-tween (to < from)', () => {
    const intents = planAnimations(
      snap({ resolve: 100 }),
      snap({ resolve: 87, insightGauge: 60, cursor: 1 }),
      [beat('counter', ['a'], 13)],
    );
    const resolveTween = intentsFor(intents, 'resolveBar', 'bar-tween');
    expect(resolveTween).toHaveLength(1);
    expect(resolveTween[0].to!).toBeLessThan(resolveTween[0].from!);
  });

  it('an aetherStorm beat emits an environment / aether-storm intent (the distinct environmental visual)', () => {
    const intents = planAnimations(snap(), snap({ cursor: 1 }), [beat('aetherStorm', ['a'], 4)]);
    expect(intentsFor(intents, 'environment', 'aether-storm')).toHaveLength(1);
  });

  it('the bar/gauge tween fractions are NORMALIZED [0,1] (NOT raw HP), reusing the layout maxima', () => {
    // problemIntegrity 80 -> 64 against the default max 100 must yield from 0.8, to 0.64 — proving
    // the layer divides by the layout max rather than carrying raw 80/64 (which would break the
    // Phaser tween that interpolates a [0,1] fill fraction).
    const intents = planAnimations(
      snap({ problemIntegrity: 80 }),
      snap({ problemIntegrity: 64, cursor: 1 }),
      [beat('melee', ['a'], 16)],
    );
    const barTween = intentsFor(intents, 'problemIntegrityBar', 'bar-tween')[0];
    expect(barTween.from!).toBeCloseTo(0.8, 10);
    expect(barTween.to!).toBeCloseTo(0.64, 10);
    expect(barTween.from!).toBeGreaterThanOrEqual(0);
    expect(barTween.from!).toBeLessThanOrEqual(1);
    expect(barTween.to!).toBeGreaterThanOrEqual(0);
    expect(barTween.to!).toBeLessThanOrEqual(1);
  });

  it('a bar/gauge whose value is UNCHANGED across the transition emits NO tween for it (the !== guard, fail-closed)', () => {
    // AC3 tweens fire "on state change" — the guard is `next.X !== prev.X`. Only the positive
    // (changed) side is tested elsewhere; pin the negative side so a regression that emitted a no-op
    // 0.8->0.8 tween every transition (a flicker / wasted tween) is caught. Here ONLY problemIntegrity
    // changes: resolve and the gauge are flat, so neither a resolveBar tween nor a gauge-tween fires,
    // while the problemIntegrityBar tween still does.
    const intents = planAnimations(
      snap({ problemIntegrity: 80, resolve: 100, insightGauge: 40 }),
      snap({ problemIntegrity: 64, resolve: 100, insightGauge: 40, cursor: 1 }),
      [beat('melee', ['a'], 16)],
    );
    expect(intentsFor(intents, 'resolveBar', 'bar-tween')).toHaveLength(0);
    expect(intentsFor(intents, 'insightGauge', 'gauge-tween')).toHaveLength(0);
    expect(intentsFor(intents, 'problemIntegrityBar', 'bar-tween')).toHaveLength(1);
  });
});

describe('Story 2.4 — planAnimations is PURE (deterministic, no input mutation, stable order)', () => {
  const prev = snap({ resolve: 100, insightGauge: 0 });
  const next = snap({ resolve: 87, insightGauge: 60, cursor: 1 });
  const beats = [beat('counter', ['a'], 13)];

  it('two calls on the same inputs deep-equal (same inputs -> byte-identical intent list)', () => {
    expect(planAnimations(prev, next, beats)).toEqual(planAnimations(prev, next, beats));
  });

  it('does NOT mutate prev / next / beatsAdvanced (stringify before/after is identical)', () => {
    const prevBefore = JSON.stringify(prev);
    const nextBefore = JSON.stringify(next);
    const beatsBefore = JSON.stringify(beats);
    planAnimations(prev, next, beats);
    expect(JSON.stringify(prev)).toBe(prevBefore);
    expect(JSON.stringify(next)).toBe(nextBefore);
    expect(JSON.stringify(beats)).toBe(beatsBefore);
  });

  it('the emission order is stable across calls (the determinism the gate pins)', () => {
    const a = planAnimations(prev, next, beats).map((i) => `${i.target}:${i.anim}`);
    const b = planAnimations(prev, next, beats).map((i) => `${i.target}:${i.anim}`);
    expect(a).toEqual(b);
  });

  it('pins the CONCRETE documented emission order on a transition that fires every intent stage (env -> action -> rise -> boss/minion hit -> tweens)', () => {
    // The story makes the STABLE, documented emission order the determinism contract ("environment
    // first, then per-beat action + rise + enemy hit/death, then the bar/gauge tweens -> a
    // byte-identical list"). The self-vs-self check above can only catch internal non-determinism; it
    // does NOT pin the actual order, so a refactor that reordered the stages would stay green. Build a
    // SINGLE transition that fires EVERY stage at once and assert the exact ordered sequence, so any
    // reordering (or a dropped/extra stage) fails loudly. This is also the only place the multi-intent
    // CO-OCCURRENCE (the stages interleaving on one call) is asserted.
    const richPrev = snap({ problemIntegrity: 50, resolve: 100, insightGauge: 20, victory: false });
    const richNext = snap({ problemIntegrity: 34, resolve: 80, insightGauge: 40, victory: true, cursor: 2 });
    // beatsAdvanced: an aetherStorm (environment) THEN a melee strike (the action). The melee drops
    // problemIntegrity (boss hit + the placeholder minion cue) and the gauge charged (next>prev) with a
    // strike present -> a rise. Resolve dropped + gauge changed -> their tweens. victory latched -> a
    // boss death. This single call exercises env, action, rise, boss-hit, minion-hit, boss-death, and
    // all three tweens together.
    const intents = planAnimations(richPrev, richNext, [
      beat('aetherStorm', ['s'], 4),
      beat('melee', ['m'], 16),
    ]);
    const order = intents.map((i) => `${i.target}:${i.anim}`);
    expect(order).toEqual([
      'environment:aether-storm', // (1) environment first
      'forgemaiden:forge-strike', // (2) per-beat Forgemaiden action
      'forgemaiden:rise', // (2) the rise (strike + gauge charged), after the action
      'boss:hit', // (2b) enemy hit from the integrity drop
      'minion:hit', // (2b) the placeholder minion cue paired with the boss hit
      'boss:death', // (2b) the defeating strike latched victory
      'problemIntegrityBar:bar-tween', // (3) bar/gauge tweens last, in a fixed sub-order
      'resolveBar:bar-tween',
      'insightGauge:gauge-tween',
    ]);
  });
});

describe('Story 2.4 AC1/AC3 — a REAL fixture walk: planAnimations over the genuine committed timeline', () => {
  it('the 5 single-source melee beats each yield a forge-strike (NOT a flurry — the fixture has no multi-source melee)', () => {
    const tl = timeline();
    // Every melee Beat in the committed golden snapshot is single-source (verified in the snapshot:
    // indices 1,2,3,4,9 all have sourceEventIds.length === 1) — so each is a forge-strike, never a
    // flurry. This pins the negative-on-real-data half of AC1.
    const meleeBeats = tl.beats.filter((b) => b.actionType === 'melee');
    expect(meleeBeats.length).toBe(5);
    for (const b of meleeBeats) {
      expect(isHammerFlurry(b)).toBe(false);
    }

    // Walk the timeline beat-by-beat; for each transition compute beatsAdvanced and plan it.
    let forgeStrikes = 0;
    let flurries = 0;
    for (let cursor = 0; cursor < tl.beats.length; cursor++) {
      const prevState = foldBattleState(tl, cursor);
      const nextState = foldBattleState(tl, cursor + 1);
      const beatsAdvanced = tl.beats.slice(cursor, cursor + 1);
      const intents = planAnimations(prevState, nextState, beatsAdvanced);
      forgeStrikes += intentsFor(intents, 'forgemaiden', 'forge-strike').length;
      flurries += intentsFor(intents, 'forgemaiden', 'hammer-flurry').length;
    }
    expect(forgeStrikes).toBe(5);
    expect(flurries).toBe(0);
  });

  it('the spell beat yields a cast and the counter beat yields a stagger on real data', () => {
    const tl = timeline();
    const spellIdx = tl.beats.findIndex((b) => b.actionType === 'spell');
    const counterIdx = tl.beats.findIndex((b) => b.actionType === 'counter');
    expect(spellIdx).toBeGreaterThanOrEqual(0);
    expect(counterIdx).toBeGreaterThanOrEqual(0);

    const spellIntents = planAnimations(
      foldBattleState(tl, spellIdx),
      foldBattleState(tl, spellIdx + 1),
      tl.beats.slice(spellIdx, spellIdx + 1),
    );
    expect(intentsFor(spellIntents, 'forgemaiden', 'cast')).toHaveLength(1);

    const counterIntents = planAnimations(
      foldBattleState(tl, counterIdx),
      foldBattleState(tl, counterIdx + 1),
      tl.beats.slice(counterIdx, counterIdx + 1),
    );
    expect(intentsFor(counterIntents, 'forgemaiden', 'stagger')).toHaveLength(1);
  });

  it('the counter transition charges the gauge on real data (gauge-tween to > from, the stagger arc)', () => {
    const tl = timeline();
    const counterIdx = tl.beats.findIndex((b) => b.actionType === 'counter');
    const prevState = foldBattleState(tl, counterIdx);
    const nextState = foldBattleState(tl, counterIdx + 1);
    // The committed fixture: gauge 0 -> 60 across the counter beat (verified in render-model.test.ts).
    expect(prevState.insightGauge).toBe(0);
    expect(nextState.insightGauge).toBe(60);
    const intents = planAnimations(prevState, nextState, tl.beats.slice(counterIdx, counterIdx + 1));
    const gaugeTween = intentsFor(intents, 'insightGauge', 'gauge-tween');
    expect(gaugeTween).toHaveLength(1);
    expect(gaugeTween[0].to!).toBeGreaterThan(gaugeTween[0].from!);
  });

  it('the final defeating transition (last beat) yields a Boss death on real data', () => {
    const tl = timeline();
    const lastIdx = tl.beats.length - 1;
    const prevState = foldBattleState(tl, lastIdx);
    const nextState = foldBattleState(tl, lastIdx + 1);
    // The committed fixture ends with the Boss defeated (problemIntegrity 0, victory true).
    expect(prevState.victory).toBe(false);
    expect(nextState.victory).toBe(true);
    const intents = planAnimations(prevState, nextState, tl.beats.slice(lastIdx, lastIdx + 1));
    expect(intentsFor(intents, 'boss', 'death')).toHaveLength(1);
  });
});
