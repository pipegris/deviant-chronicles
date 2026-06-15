import type { BattleState, BattleTimeline, Beat } from '../schema/battle-timeline';
import type { ActionType } from '../schema/normalized-event';
import type { ModelTuning } from './model-tuning';
import { BattleStateSchema } from '../schema/battle-timeline';
import { MODEL_TUNING } from './model-tuning';

// battle-model — the pure, deterministic Layer-0 Battle Model (FR-5). A BattleTimeline in, a
// BattleState out, computed as a PURE FOLD of the timeline's Beat[] (in orderKey order, which
// is array order since pace() preserves it) up to any cursor position. It maintains the two
// bars (Problem Integrity, Resolve), the Insight Gauge, the live Boss enemy, and the victory
// flag. This is step (5) in the architecture's sequence ("Battle Model + playback reducer");
// the playback reducer that DRIVES this fold is Story 2.2 — NOT built here.
//
// PURE (R2): no Date.now / Math.random / performance.now / network / fs / module-level mutable
// state. Time/order derive ONLY from orderKey (already baked into the beat array order). The
// reduce's running accumulator is FUNCTION-LOCAL working memory (a fresh BattleState threaded
// through applyBeat), NOT global mutable state — exactly the argument translate.ts L15-20 makes.
// Same (timeline, cursor, tuning) ALWAYS yields a byte-identical state — this reproducibility
// is the determinism anchor for this story (there is no golden snapshot here; the every-cursor
// fold-vs-refold test is the guard). The static JSON import in model-tuning.ts and
// BattleStateSchema.parse() are pure (no clock/IO), as pacing-config.ts argues.
//
// LAYER-0 ONLY (R1): the model reads beat.actionType + beat.weight ONLY. It reads NO
// beatType / confidence / isMontage / dramatic label and MUST NOT import src/interpret/ (lint-
// enforced via the ./src/model -> ./src/interpret zone). The "breakthrough" tag is Layer-1 and
// arrives in Epic 3; the struggle/breakthrough detection below is a deterministic Layer-0
// STAND-IN, not the final LLM tagger — the renderer will later consume the L1 tag via the
// read-only overlay, but THIS model keeps computing its own deterministic gauge (L1 never feeds
// mechanics — R1). It is also NOT a second parser (R3): it consumes the in-memory
// BattleTimeline and never re-reads raw JSONL.

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// The t=0 snapshot from config: full bars, gauge 0, the Boss seeded at full hp (its hp IS the
// problemIntegrity bar — the same quantity viewed two ways, kept in lockstep below), cursor 0,
// not victory. A FRESH state with its own enemies array each call (no shared mutable state, R2).
export function initialBattleState(tuning: ModelTuning = MODEL_TUNING): BattleState {
  return {
    problemIntegrity: tuning.initial.problemIntegrity,
    resolve: tuning.initial.resolve,
    insightGauge: 0,
    enemies: [{ id: tuning.boss.id, type: tuning.boss.type, hp: tuning.boss.hp }],
    cursor: 0,
    victory: false,
  };
}

// The metaphor verbs that damage Problem Integrity (= Boss HP). melee = an Edit/Write strike or
// a passing result that resolved a strike (incl. the journal completion); spell = a Bash
// test/build cast that landed progress. counter drains Resolve (handled separately); scout /
// summon / idle / aetherStorm are no-ops on the bars (fail-closed-to-default).
function isIntegrityStrike(actionType: ActionType): boolean {
  return actionType === 'melee' || actionType === 'spell';
}

// The pure per-beat step: returns a FRESH BattleState, never mutating `state` or `beat`. Bar
// changes are RE-DERIVED from beat.actionType (the metaphor verb) + beat.weight (the Pacer's
// significance) via the config scalars — the upstream signed deltas were dropped at the pace
// boundary (derive-beats.ts keeps no delta on a Beat), so the model cannot "apply deltas"; it
// re-derives them here. An unmapped/effect-less verb is a no-op on the bars (never throws).
export function applyBeat(
  state: BattleState,
  beat: Beat,
  tuning: ModelTuning = MODEL_TUNING,
): BattleState {
  const init = tuning.initial;

  let { problemIntegrity, resolve, insightGauge } = state;
  // Victory LATCHES and is (re)evaluated ONLY on the integrity-strike branch below, so it tracks
  // the defeating STRIKE event (AC3's "defeated at exactly that point"), not the bare bar value —
  // a no-op beat (idle/scout/summon/aetherStorm/counter) can never flip it.
  let victory = state.victory;

  if (isIntegrityStrike(beat.actionType)) {
    // BREAKTHROUGH (Layer-0 stand-in): a decisive integrity strike that lands while the gauge
    // is already charged at/above dischargeThreshold reads as the hard-won fix — discharge the
    // gauge to 0 on this beat. Gating on the INCOMING gauge enforces "earned" (an unstruggled
    // strike never discharges); the integrity damage still lands. The check uses state.insightGauge
    // (the gauge BEFORE this beat) so a single strike both detects and discharges the charge.
    if (state.insightGauge >= tuning.insight.dischargeThreshold) {
      insightGauge = 0;
    }
    const damage = beat.weight * tuning.effects.integrityDamagePerWeight;
    // problemIntegrity and the Boss hp are the SAME quantity — decrement in lockstep, clamp at 0.
    problemIntegrity = clamp(problemIntegrity - damage, 0, init.problemIntegrity);
    // The defeating strike: when THIS integrity strike brings the bar to 0, the Boss falls AT
    // this fold position. OR with state.victory to keep the latch idempotent on later strikes.
    victory = victory || problemIntegrity <= 0;
  } else if (beat.actionType === 'counter') {
    // The struggle signal (the only one that survives to the Beat layer — retries/timing live on
    // NormalizedEvent and were dropped upstream). Drains Resolve AND charges the Insight Gauge.
    const drain = beat.weight * tuning.effects.resolveDrainPerWeight;
    resolve = clamp(resolve - drain, 0, init.resolve);
    insightGauge = clamp(insightGauge + tuning.insight.chargePerStruggle, 0, tuning.insight.maxGauge);
  }
  // else: scout / summon / idle / aetherStorm (and any future union member) — no bar effect.

  // The Boss enemy's hp tracks problemIntegrity exactly (same quantity). A fresh enemies array
  // (state.enemies is never mutated); non-Boss enemies (none in v0.1) pass through untouched.
  const enemies = state.enemies.map((enemy) =>
    enemy.id === tuning.boss.id ? { ...enemy, hp: problemIntegrity } : enemy,
  );

  return {
    problemIntegrity,
    resolve,
    insightGauge,
    enemies,
    cursor: state.cursor + 1,
    victory,
  };
}

// The FOLD: reduce beats[0..cursor) from initialBattleState via applyBeat. The state at ANY
// position is therefore a PURE function of (timeline, cursor, tuning) — no path dependence, no
// hidden accumulator (AC1). cursor is clamped to [0, beats.length]: <= 0 returns the initial
// state, > length folds the whole timeline. The emitted state.cursor equals the number of beats
// folded (an integer — BattleStateSchema pins cursor: int). Boundary-validate and fail closed
// (a malformed state throws rather than flowing downstream), mirroring pace()'s parse.
export function foldBattleState(
  timeline: BattleTimeline,
  cursor: number = timeline.beats.length,
  tuning: ModelTuning = MODEL_TUNING,
): BattleState {
  const end = clamp(cursor, 0, timeline.beats.length);
  let state = initialBattleState(tuning);
  for (let i = 0; i < end; i++) {
    state = applyBeat(state, timeline.beats[i], tuning);
  }
  return BattleStateSchema.parse(state);
}
