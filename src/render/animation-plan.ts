import type { BattleState, Beat } from '../schema/battle-timeline';
import type { RenderLayout } from './render-model';
import { DEFAULT_LAYOUT } from './render-model';

// animation-plan — the PURE animation-plan layer: a plain function mapping a playback TRANSITION
// (prevBattleState, nextBattleState, and the Beat[] that advanced the cursor between them) to an
// ordered list of animation INTENTS. This is where ALL the combat-animation DECISION logic lives
// (Forgemaiden action states, Hammer-Flurry detection, stagger->rise<->gauge correlation, enemy
// hit/death, bar/gauge tween deltas, the Aether-Storm trigger), expressed as plain data with ZERO
// phaser — unit-testable in the node env. The Phaser scene is a THIN consumer that runs a tween /
// sprite-anim per intent. [story Task 1; story Dev Notes "RECOMMENDED SHAPE"]
//
// PURE: no Date.now / Math.random / performance.now / IO / module-mutable state — deterministic
// (same inputs -> deep-equal output) and mutates NEITHER input. R2's lint-enforced purity binds
// Layer-0 only; we keep this pure deliberately so it stays node-testable (the same posture as
// render-model.ts). It reads beat.actionType + beat.sourceEventIds (Layer-0 Beat data, the SAME
// fields battle-model.ts reads) and BattleState deltas — it reads NO beatType/BeatAnnotation
// (Layer 1, Epic 3, R1), adds NO HP/gauge/victory math, and feeds NOTHING upstream (R5: it returns
// intents the scene consumes; no callback to the reducer). It imports NO phaser. [architecture.md#R1/R5]

// The thing an intent targets. Forgemaiden + enemies are the cast; environment is the scene-global
// overlay (Aether Storm); the three bar/gauge widgets are tween targets. String-literal union
// (project convention — NO numeric enum); more targets arrive additively with no shape change.
export type AnimTarget =
  | 'forgemaiden'
  | 'boss'
  | 'minion'
  | 'environment'
  | 'insightGauge'
  | 'problemIntegrityBar'
  | 'resolveBar';

// The named animations v0.1 fires. String-literal union (NO numeric enum). The Forgemaiden action
// anims (idle/forge-strike/hammer-flurry/cast/stagger/rise), the enemy hit/death, the environmental
// aether-storm, and the two tween kinds (bar/gauge). Epic 3 set-pieces (summon/shatter) arrive
// additively here with no shape change.
export type AnimName =
  | 'idle'
  | 'forge-strike'
  | 'hammer-flurry'
  | 'cast'
  | 'stagger'
  | 'rise'
  | 'hit'
  | 'death'
  | 'aether-storm'
  | 'bar-tween'
  | 'gauge-tween';

// A single animation intent: WHAT to animate (target), HOW (anim), and FOR HOW LONG (durationMs).
// from/to carry the [0,1] bar/gauge fractions for tween intents (bar-tween / gauge-tween); repeat
// is the multi-strike count for hammer-flurry (how many quick sub-strikes the Phaser layer fires).
// Plain `type`, NOT Zod — it is TRANSIENT in-memory view state (consumed within a frame, NEVER
// serialized into a bundle, NEVER read from an untrusted source), the same call as RenderModel /
// PlaybackState. from/to/repeat are optional `?` like PlaybackState's transient fields, but we
// DEFAULT the absent case to `null` when constructing intents so the emitted shape is uniform
// (prefer-explicit-null applied to the constructed value). [story Dev Notes "Intent shape"]
export type AnimationIntent = {
  target: AnimTarget;
  anim: AnimName;
  durationMs: number;
  from?: number | null;
  to?: number | null;
  repeat?: number | null;
};

// Per-anim durations (ms). A flurry's PER-STRIKE duration is deliberately SHORTER than a single
// forge-strike so the burst reads as "visibly faster" (AC1) — asserted as a number relation in the
// tests. These are presentation timings (render-side), not battle tuning, so they live here.
const FORGE_STRIKE_MS = 300;
const FLURRY_PER_STRIKE_MS = 120;
const CAST_MS = 300;
const STAGGER_MS = 320;
const RISE_MS = 360;
const IDLE_MS = 200;
const HIT_MS = 200;
const DEATH_MS = 400;
const AETHER_STORM_MS = 500;
const BAR_TWEEN_MS = 300;
const GAUGE_TWEEN_MS = 300;

// Clamp into [0,1] — the SAME fail-closed logic render-model.ts uses (a non-positive/NaN max yields
// an empty bar rather than throwing). Duplicated locally (a 4-line guard) rather than exported from
// render-model.ts to keep that module's surface unchanged (surgical); both stay identical.
function fraction(value: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.min(Math.max(value / max, 0), 1);
}

// isHammerFlurry — the PURE flurry-vs-single-strike decision (AC1, the headline gate-provable
// claim). A melee Beat whose sourceEventIds.length > 1 is, BY CONSTRUCTION, a montage of consecutive
// edits the Pacer collapsed into one window (windowEvents collapses a run of trivial same-stream
// actions into ONE window carrying ALL the collapsed ids, headlined by the run's most-significant
// actionType) — exactly "a burst of consecutive edits" (AC1). A single edit that scored significant
// stays a discrete window with ONE source id -> a single forge-strike. Cardinality (not weight) is
// the direct burst-size signal and is robust to pacing-weight retuning. Only MELEE multi-source is a
// flurry (a multi-source scout/spell/counter is not). [story Dev Notes "Hammer Flurry"; pace/window-events.ts]
export function isHammerFlurry(beat: Beat): boolean {
  return beat.actionType === 'melee' && beat.sourceEventIds.length > 1;
}

// The Forgemaiden action intent for a single advanced beat, or null when the beat is not a
// Forgemaiden melee/spell/struggle (scout/summon are not her action; aetherStorm is environmental,
// handled separately; an unmapped future verb is a safe null). melee -> forge-strike UNLESS it is a
// Hammer Flurry (a faster repeated multi-strike). [story Task 1 "AC1 — Forgemaiden action intents"]
function forgemaidenActionFor(beat: Beat): AnimationIntent | null {
  switch (beat.actionType) {
    case 'melee':
      return isHammerFlurry(beat)
        ? {
            target: 'forgemaiden',
            anim: 'hammer-flurry',
            durationMs: FLURRY_PER_STRIKE_MS,
            from: null,
            to: null,
            // The multi-strike count = how many edits collapsed, so the Phaser layer fires that
            // many quick sub-strikes (the "multi-strike").
            repeat: beat.sourceEventIds.length,
          }
        : { target: 'forgemaiden', anim: 'forge-strike', durationMs: FORGE_STRIKE_MS, from: null, to: null, repeat: null };
    case 'spell':
      return { target: 'forgemaiden', anim: 'cast', durationMs: CAST_MS, from: null, to: null, repeat: null };
    case 'counter':
      // counter is the ONLY struggle/failure signal that survives to the Beat layer -> the recoil.
      return { target: 'forgemaiden', anim: 'stagger', durationMs: STAGGER_MS, from: null, to: null, repeat: null };
    case 'idle':
      return { target: 'forgemaiden', anim: 'idle', durationMs: IDLE_MS, from: null, to: null, repeat: null };
    default:
      // scout / summon / aetherStorm (and any future union member) — no Forgemaiden action intent.
      return null;
  }
}

// A bar/gauge tween intent from two raw values normalized to [0,1] against the layout maximum (the
// SAME fraction() clamp + DEFAULT_LAYOUT maxima render-model.ts uses — NO hardcoded 100). Reused for
// the two health bars and the gauge so the Phaser layer interpolates a [0,1] fill fraction.
function tweenIntent(
  target: AnimTarget,
  anim: AnimName,
  prevValue: number,
  nextValue: number,
  max: number,
  durationMs: number,
): AnimationIntent {
  return {
    target,
    anim,
    durationMs,
    from: fraction(prevValue, max),
    to: fraction(nextValue, max),
    repeat: null,
  };
}

// planAnimations — the PURE entry point. Maps a playback TRANSITION (prev snapshot, next snapshot,
// and the Beat(s) that advanced the cursor between them) to an ordered AnimationIntent[]. Empty
// beatsAdvanced (a tick that crossed no beat boundary, or prev.cursor === next.cursor) emits no
// action/environment intents (the held frame) but still emits any bar/gauge tweens implied by a
// state delta (defensive; in practice an empty advance has no delta). PURE + deterministic + mutates
// neither input.
//
// EMISSION ORDER (stable + documented — the determinism the tests pin): (1) environment intents
// (aether-storm) for each advanced beat, then (2) per-beat the Forgemaiden action + the rise (when
// the gauge charged on a strike) + the enemy hit/death implied by the transition, then (3) the
// bar/gauge tweens (problemIntegrity, resolve, gauge). The same transition always yields a
// byte-identical list.
export function planAnimations(
  prev: BattleState,
  next: BattleState,
  beatsAdvanced: Beat[],
  layout: RenderLayout = DEFAULT_LAYOUT,
): AnimationIntent[] {
  const intents: AnimationIntent[] = [];

  // The struggle->power read: did the Insight Gauge CHARGE this transition? The model charges the
  // gauge on a counter (struggle) and discharges it to 0 on a breakthrough strike, so gauge UP means
  // a struggle charged it — and a Forgemaiden strike landing AS it climbs is the "rise after the
  // stagger, gauge charging further" (defiance, not defeat). Keying rise on a CHARGE (next > prev)
  // cleanly excludes the breakthrough/discharge (gauge goes DOWN). [story Dev Notes "stagger -> rise"]
  const gaugeCharged = next.insightGauge > prev.insightGauge;
  const hasStrike = beatsAdvanced.some((b) => b.actionType === 'melee' || b.actionType === 'spell');

  // (1) Environment: an aetherStorm beat -> a distinct environmental visual (the Phaser layer draws a
  // screen tint/overlay). Pure trigger off the Beat's actionType. Emitted first so the overlay reads
  // behind the cast for that transition.
  for (const beat of beatsAdvanced) {
    if (beat.actionType === 'aetherStorm') {
      intents.push({ target: 'environment', anim: 'aether-storm', durationMs: AETHER_STORM_MS, from: null, to: null, repeat: null });
    }
  }

  // (2) Per-beat Forgemaiden action intents (forge-strike / hammer-flurry / cast / stagger / idle).
  for (const beat of beatsAdvanced) {
    const action = forgemaidenActionFor(beat);
    if (action) intents.push(action);
  }

  // The rise fires AS the gauge increments after a struggle: a Forgemaiden strike in this transition
  // while the gauge charged. Emitted once per transition (not per strike beat) — it is the read of
  // the whole transition ("a strike landed and the gauge climbed"), not one strike. NOT emitted on a
  // breakthrough/discharge (gauge down) — that is Epic 3's THUNDORR moment, not a rise.
  if (hasStrike && gaugeCharged) {
    intents.push({ target: 'forgemaiden', anim: 'rise', durationMs: RISE_MS, from: null, to: null, repeat: null });
  }

  // (2b) Enemy hit/death from the snapshot deltas. Boss is MODEL-DRIVEN (the one enemy the model
  // tracks). problemIntegrity dropped -> the Boss took damage -> a hit. The defeating strike
  // (!prev.victory && next.victory) -> a Boss death (the held-victory frame Story 2.3 deferred here).
  if (next.problemIntegrity < prev.problemIntegrity) {
    intents.push({ target: 'boss', anim: 'hit', durationMs: HIT_MS, from: null, to: null, repeat: null });
    // Minion hit is PRESENTATION-ONLY (the Boss-vs-Minion distinction, AC3): v0.1's BattleState
    // carries NO per-minion HP, so a minion death cannot be model-driven yet (the SAME honest gap
    // Story 2.3 documented). We add a placeholder minion hit cue when a strike lands so the minion
    // reacts distinctly from the Boss; real per-minion hit/death is gated on the model growing live
    // minions (Epic 3 imps / Story 5.3). NO minion HP is invented in BattleState. [story Dev Notes
    // "the Boss-vs-Minion distinction"]
    intents.push({ target: 'minion', anim: 'hit', durationMs: HIT_MS, from: null, to: null, repeat: null });
  }
  if (!prev.victory && next.victory) {
    intents.push({ target: 'boss', anim: 'death', durationMs: DEATH_MS, from: null, to: null, repeat: null });
  }

  // (3) Bar/gauge tweens on every state change (Story 2.3 SNAPPED these; this story TWEENS them).
  // from/to are normalized fractions via the SAME fraction() clamp against the layout maxima (NOT
  // raw HP), so the Phaser layer interpolates a [0,1] fill fraction. The Forgemaiden's health bar IS
  // the Resolve bar (render-model.ts), so a Resolve change tweens resolveBar.
  if (next.problemIntegrity !== prev.problemIntegrity) {
    intents.push(
      tweenIntent('problemIntegrityBar', 'bar-tween', prev.problemIntegrity, next.problemIntegrity, layout.maxProblemIntegrity, BAR_TWEEN_MS),
    );
  }
  if (next.resolve !== prev.resolve) {
    intents.push(tweenIntent('resolveBar', 'bar-tween', prev.resolve, next.resolve, layout.maxResolve, BAR_TWEEN_MS));
  }
  if (next.insightGauge !== prev.insightGauge) {
    intents.push(tweenIntent('insightGauge', 'gauge-tween', prev.insightGauge, next.insightGauge, layout.maxGauge, GAUGE_TWEEN_MS));
  }

  return intents;
}
