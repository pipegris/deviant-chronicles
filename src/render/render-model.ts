import type { BattleState } from '../schema/battle-timeline';
import { MODEL_TUNING } from '../model/model-tuning';

// render-model — the PURE view-model: a plain function BattleState -> RenderModel. This is where the
// snapshot->visual LOGIC lives (which entities exist, each one's hpFraction, the gauge fraction, the
// victory flag), expressed as plain data with ZERO phaser, so it is unit-testable in the node env.
// The Phaser scene is a THIN consumer that paints this model onto display objects. [story Dev Notes
// "Why RenderModel is pure"; architecture.md#Testability L62-64]
//
// PURE: no Date.now / Math.random / clock / IO / module-mutable state — deterministic (same snapshot
// -> same model). Any wall-clock (the rAF drive loop) lives in the adapter/boot, never here. R2's
// lint-enforced purity binds Layer-0 only; we keep this pure deliberately so it stays node-testable.

// Three kinds for v0.1; a string-literal union (project convention — NO numeric enum). More kinds
// (imp, Shaman, THUNDORR) arrive additively in later epics with no shape change.
export type EntityKind = 'forgemaiden' | 'boss' | 'minion';

// A flat, drawable entity. hpFraction is a [0,1] number (NOT raw HP) so the scene draws a bar of
// fraction*barWidth without knowing the max — decoupling the bar widget from model-tuning magnitudes.
export type RenderEntity = {
  id: string;
  kind: EntityKind;
  x: number;
  y: number;
  hpFraction: number;
};

// insightGauge + victory live at the top level (scene-global, not tied to one entity). entities is a
// flat list (not named slots) so the scene iterates it to create/update display objects and N minions
// come for free; the scene finds the Forgemaiden/Boss by kind when it needs a specific bar.
export type RenderModel = {
  entities: RenderEntity[];
  insightGauge: number;
  victory: boolean;
};

// Render-side PRESENTATION config (NOT battle tuning — it lives in render/, never feeds mechanics, R1).
// max* mirror model-tuning.json initial values so a full bar maps to 1.0. minions are synthesized
// here (see DEFAULT_LAYOUT) because v0.1's BattleState carries ONLY the Boss enemy.
export type RenderLayout = {
  bossId: string;
  maxProblemIntegrity: number;
  maxResolve: number;
  maxGauge: number;
  forgemaiden: { x: number; y: number };
  boss: { x: number; y: number };
  minions: { id: string; x: number; y: number }[];
};

// Placeholder positions on the 1024x768 stage: Forgemaiden left (hero), Boss right (antagonist),
// minion flanking the Boss. Exact pixels are operator-tunable later — kept here as the one place to
// adjust. The default layout MUST include >=1 minion so AC2 ("at least one Minion") is satisfied.
// The max* are DERIVED from MODEL_TUNING (the single source of tuning truth, NFR-4) rather than
// hardcoded so an operator retune of initial.problemIntegrity/resolve or insight.maxGauge keeps a
// full bar mapping to 1.0 — no silent mis-scale. render -> model import is allowed (R1 only forbids
// Layer-0 -> interpret).
export const DEFAULT_LAYOUT: RenderLayout = {
  bossId: MODEL_TUNING.boss.id,
  maxProblemIntegrity: MODEL_TUNING.initial.problemIntegrity,
  maxResolve: MODEL_TUNING.initial.resolve,
  maxGauge: MODEL_TUNING.insight.maxGauge,
  forgemaiden: { x: 220, y: 430 },
  boss: { x: 800, y: 400 },
  minions: [{ id: 'minion-1', x: 640, y: 470 }],
};

// Clamp into [0,1]. Defensive: foldBattleState already clamps the bars to [0,max], but a render-side
// clamp guarantees a sane bar fraction even if a layout max is mis-set (fail-closed, never throws).
function fraction(value: number, max: number): number {
  if (!(max > 0)) return 0; // a non-positive/NaN max can't produce a meaningful fraction → empty bar
  return Math.min(Math.max(value / max, 0), 1);
}

// toRenderModel — map the immutable BattleState to the drawable RenderModel, PURELY. Contains the
// Forgemaiden, the Boss, and >=1 Minion (AC2). Does not mutate the input snapshot.
export function toRenderModel(
  snapshot: BattleState,
  layout: RenderLayout = DEFAULT_LAYOUT,
): RenderModel {
  // The Forgemaiden's health bar IS the Resolve bar — she is the hero; Resolve is her stamina.
  const forgemaiden: RenderEntity = {
    id: 'forgemaiden',
    kind: 'forgemaiden',
    x: layout.forgemaiden.x,
    y: layout.forgemaiden.y,
    hpFraction: fraction(snapshot.resolve, layout.maxResolve),
  };

  // The Boss's hp IS problemIntegrity (the Battle Model seeds exactly one enemy, the Boss). Prefer
  // the live enemy hp; if the Boss enemy is absent (defensive — should not happen in v0.1) fall back
  // to the top-level problemIntegrity (fail-closed-to-default, never throw).
  const bossEnemy = snapshot.enemies.find((e) => e.id === layout.bossId);
  const bossHp = bossEnemy ? bossEnemy.hp : snapshot.problemIntegrity;
  const boss: RenderEntity = {
    id: layout.bossId,
    kind: 'boss',
    x: layout.boss.x,
    y: layout.boss.y,
    hpFraction: fraction(bossHp, layout.maxProblemIntegrity),
  };

  // Minion(s) are SYNTHESIZED from layout.minions, NOT from BattleState (v0.1's enemies carries only
  // the Boss — there is no minion in the model yet). Each minion is a static full bar (1) for v0.1;
  // per-minion HP / death animation is Story 2.4. This is presentation only — it adds no mechanics.
  const minions: RenderEntity[] = layout.minions.map((m) => ({
    id: m.id,
    kind: 'minion',
    x: m.x,
    y: m.y,
    hpFraction: 1,
  }));

  return {
    entities: [forgemaiden, boss, ...minions],
    insightGauge: fraction(snapshot.insightGauge, layout.maxGauge),
    victory: snapshot.victory,
  };
}
