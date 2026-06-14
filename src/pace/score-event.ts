import type { TranslatedAction } from '../translate/translated-action';
import type { PacingWeights } from './pacing-config';
import { PACING_WEIGHTS } from './pacing-config';

// scoreEvent — the pure per-action significance weight (Layer-0, R2). It reads the base weight
// for action.actionType and adds the DATA-driven modifiers for the dramatic signals already on
// the TranslatedAction. EVERY magnitude comes from `weights`; NONE is hardcoded (the only
// literal here is 0, the additive identity when a modifier is absent — structural, not tuning).
//
// PURE: no clock/random/IO/global state. Output is a deterministic function of (action, weights)
// — same input, same number — and the input action is never mutated.
//
// Resulting tier (significant strictly out-scores filler — the AC1 "visual weight" requirement).
// Modifier-adjusted scores can reorder the BASE tiers, so the chain below is magnitude-accurate
// (a drained counter = base 8 + resolveDrain 5 = 13 outscores spell base 12; a boss/mirage melee
// = base 10 + bossDamage 6 and/or mirageStrike 4 = 16-20 outscores spell):
//   summon15 > {boss/mirage melee 16-20} > counter+drain13 > spell12 > melee(base)10
//   > aetherStorm5 > scout2 > idle1.
// Significant verbs (summon/spell/counter/melee) outscore filler (idle/lone scout); a mirage
// strike out-scores a solid one (wasted effort is the more dramatic beat); a landed Boss hit
// and a Resolve drain bump their action; an aetherStorm sits in a documented MIDDLE tier
// (above filler, below a headline summon). [Source: epics.md#Story-1.5 AC1; brainstorm tiers]
export function scoreEvent(
  action: TranslatedAction,
  weights: PacingWeights = PACING_WEIGHTS,
): number {
  let score = weights.weights[action.actionType];

  const m = weights.modifiers;

  // A strike's scout-before-strike flag: a Mirage (wasted-effort) strike reads as more dramatic
  // than a solid one. isMirage is null for non-strikes, so neither bump applies there.
  if (action.isMirage === true) {
    score += m.mirageStrike ?? 0;
  } else if (action.isMirage === false) {
    score += m.solidStrike ?? 0;
  }

  // COUPLING ASSUMPTION (doc-guard): bossDamage / resolveDrain apply for ANY actionType, so they
  // assume a TRIVIAL action (idle / lone scout) NEVER carries a negative delta. Today that holds —
  // translation-rules.json's read-scout/default rules emit no negative deltas — but a future
  // translation-rules edit that put a negative delta on an idle/scout would push it past
  // montageThresholdWeight and invisibly reclassify filler as a significant beat (inverting the
  // pacing). If that ever changes, gate these bumps by actionType. [Source: review R-002]

  // A landed Boss hit (the result/strike that actually damaged Problem Integrity).
  if (action.problemIntegrityDelta < 0) {
    score += m.bossDamage ?? 0;
  }

  // A Resolve drain (a counter / backfire that cost the Hero Resolve).
  if (action.resolveDelta < 0) {
    score += m.resolveDrain ?? 0;
  }

  return score;
}
