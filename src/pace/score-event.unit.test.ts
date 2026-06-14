import { describe, expect, it } from 'vitest';
import type { TranslatedAction } from '../translate/translated-action';
import type { ActionType } from '../schema/normalized-event';

// RED-PHASE acceptance tests for Story 1.5 Task 3 — scoreEvent: the pure per-action
// significance weight. These FAIL until src/pace/score-event.ts exports
// `scoreEvent(action, weights = PACING_WEIGHTS): number`. The import error is the red signal.
//
// What the AC requires (AC1 "significant beats get visual weight" + AC2 purity):
//  - a significant verb (summon/spell/counter/melee) scores strictly HIGHER than filler
//    (idle / a lone scout);
//  - the dramatic signals already on the TranslatedAction add a DATA-driven bump: a mirage
//    strike (isMirage:true) is the wasted-effort beat (scored above a plain low action), a
//    landed Boss hit (problemIntegrityDelta < 0) and a Resolve drain (resolveDelta < 0) bump,
//    an aetherStorm scores in a documented MIDDLE tier (not filler, not top);
//  - the function is PURE: same (action, weights) -> same number; no clock/random/IO.
//
// The fixture has no Task/Summon/AetherStorm action, so we hand-author small TranslatedAction[]
// here (a test-authored action is legitimate — tests are not Layer-0 modules).
import { scoreEvent } from './score-event';

function makeAction(opts: {
  actionType: ActionType;
  isMirage?: boolean | null;
  resolveDelta?: number;
  problemIntegrityDelta?: number;
  isAetherStorm?: boolean;
  eventId?: string;
  seq?: number;
}): TranslatedAction {
  return {
    actionType: opts.actionType,
    sourceEventId: opts.eventId ?? 'evt-1',
    orderKey: { logicalClock: opts.seq ?? 0, streamId: 'test-stream', seqWithinStream: opts.seq ?? 0 },
    target: null,
    isMirage: opts.isMirage ?? null,
    resolveDelta: opts.resolveDelta ?? 0,
    problemIntegrityDelta: opts.problemIntegrityDelta ?? 0,
    isAetherStorm: opts.isAetherStorm ?? false,
  };
}

const idle = makeAction({ actionType: 'idle' });
const loneScout = makeAction({ actionType: 'scout' });
const summon = makeAction({ actionType: 'summon' });
const plainSpell = makeAction({ actionType: 'spell' });
const counterDrain = makeAction({ actionType: 'counter', resolveDelta: -10 });
const mirageMelee = makeAction({ actionType: 'melee', isMirage: true });
const bossHitMelee = makeAction({ actionType: 'melee', problemIntegrityDelta: -25 });
const aetherStorm = makeAction({ actionType: 'aetherStorm', isAetherStorm: true });

describe('Story 1.5 AC1/Task3 — scoreEvent: significant verbs outscore filler', () => {
  it('summon scores strictly higher than idle and a lone scout', () => {
    expect(scoreEvent(summon)).toBeGreaterThan(scoreEvent(idle));
    expect(scoreEvent(summon)).toBeGreaterThan(scoreEvent(loneScout));
  });

  it('a spell scores strictly higher than idle / lone scout', () => {
    expect(scoreEvent(plainSpell)).toBeGreaterThan(scoreEvent(idle));
    expect(scoreEvent(plainSpell)).toBeGreaterThan(scoreEvent(loneScout));
  });

  it('a counter (backfire draining Resolve) scores strictly higher than filler', () => {
    expect(scoreEvent(counterDrain)).toBeGreaterThan(scoreEvent(idle));
    expect(scoreEvent(counterDrain)).toBeGreaterThan(scoreEvent(loneScout));
  });

  it('a mirage melee strike scores strictly higher than filler (the wasted-effort beat)', () => {
    expect(scoreEvent(mirageMelee)).toBeGreaterThan(scoreEvent(idle));
    expect(scoreEvent(mirageMelee)).toBeGreaterThan(scoreEvent(loneScout));
  });

  it('idle is the lowest-scoring action of all', () => {
    const all = [loneScout, summon, plainSpell, counterDrain, mirageMelee, bossHitMelee, aetherStorm];
    for (const a of all) {
      expect(scoreEvent(idle)).toBeLessThanOrEqual(scoreEvent(a));
    }
    // strictly below the significant ones
    expect(scoreEvent(idle)).toBeLessThan(scoreEvent(summon));
  });
});

describe('Story 1.5 AC1/Task3 — the DATA-driven dramatic modifiers bump the score', () => {
  it('a mirage strike scores higher than a plain (no-signal) melee — wasted effort is dramatic', () => {
    const plainMelee = makeAction({ actionType: 'melee', isMirage: false });
    expect(scoreEvent(mirageMelee)).toBeGreaterThan(scoreEvent(plainMelee));
  });

  it('a melee that lands a Boss hit (problemIntegrityDelta < 0) scores higher than one that does not', () => {
    const noDamageMelee = makeAction({ actionType: 'melee', problemIntegrityDelta: 0 });
    expect(scoreEvent(bossHitMelee)).toBeGreaterThan(scoreEvent(noDamageMelee));
  });

  it('a Resolve drain (resolveDelta < 0) bumps the score above the same action with no drain', () => {
    const counterNoDrain = makeAction({ actionType: 'counter', resolveDelta: 0 });
    expect(scoreEvent(counterDrain)).toBeGreaterThan(scoreEvent(counterNoDrain));
  });
});

describe('Story 1.5 AC1/Task3 — aetherStorm sits in the documented MIDDLE tier', () => {
  it('an aetherStorm scores STRICTLY ABOVE filler (idle / lone scout) — a noticeable beat', () => {
    expect(scoreEvent(aetherStorm)).toBeGreaterThan(scoreEvent(idle));
    expect(scoreEvent(aetherStorm)).toBeGreaterThan(scoreEvent(loneScout));
  });

  it('an aetherStorm scores STRICTLY BELOW a top beat (a summon) — not a headline hit', () => {
    expect(scoreEvent(aetherStorm)).toBeLessThan(scoreEvent(summon));
  });

  it('an aetherStorm scores STRICTLY BELOW every significant verb (counter/melee/spell/summon)', () => {
    // "Middle tier" is not just "below the top beat" — Task3 + the score-event.ts tier comment
    // place aetherStorm BELOW all significant verbs (counter < melee < spell < summon). The
    // prior test only pinned the summon extreme, so a config bump that let aetherStorm out-score
    // a counter/melee/spell would have slipped through. Pin the full lower bound of the tier.
    const plainCounter = makeAction({ actionType: 'counter' });
    const plainMelee = makeAction({ actionType: 'melee' });
    for (const above of [plainCounter, plainMelee, plainSpell, summon]) {
      expect(scoreEvent(aetherStorm)).toBeLessThan(scoreEvent(above));
    }
  });
});

describe('Story 1.5 AC2/Task3 — scoreEvent is pure (deterministic function of its input)', () => {
  it('same (action, weights) -> same number across repeated calls', () => {
    expect(scoreEvent(mirageMelee)).toBe(scoreEvent(mirageMelee));
    expect(scoreEvent(bossHitMelee)).toBe(scoreEvent(bossHitMelee));
  });

  it('does not mutate the input action', () => {
    const a = makeAction({ actionType: 'melee', isMirage: true, problemIntegrityDelta: -5 });
    const before = JSON.stringify(a);
    scoreEvent(a);
    expect(JSON.stringify(a)).toBe(before);
  });

  it('honors an in-memory weights override (NFR-4: tuning is a data change, not a code change)', () => {
    // Pass a config that makes idle out-weigh summon. If scoreEvent reads the passed weights
    // (not a hardcoded table), the ordering must INVERT — the mechanical NFR-4 proof.
    const inverted = {
      $schemaVersion: 1 as const,
      weights: {
        melee: 1, spell: 1, scout: 1, summon: 1, counter: 1, idle: 100, aetherStorm: 1,
      },
      modifiers: {},
      dwell: { dwellMsPerWeightUnit: 1 },
    };
    // scoreEvent accepts its config as a default param; passing a different one must take effect.
    expect(scoreEvent(idle, inverted as never)).toBeGreaterThan(scoreEvent(summon, inverted as never));
  });
});
