import type { TranslatedAction } from '../translate/translated-action';
import type { Beat, BattleTimeline } from '../schema/battle-timeline';
import type { PacingWeights } from './pacing-config';
import type { EventWindow, ScoredAction } from './pace-types';
import { BattleTimelineSchema } from '../schema/battle-timeline';
import { PACING_WEIGHTS, WINDOW_CONFIG } from './pacing-config';
import { scoreEvent } from './score-event';
import { windowEvents } from './window-events';

// derive-beats — the Pace stage entry point (Layer-0, R2). `pace()` composes
// scoreEvent -> windowEvents -> deriveBeats into the pipeline step `pace(translate(ingest(raw)))`
// and is the Epic-1 capstone: TranslatedAction[] in, a typed, schema-validated BattleTimeline out,
// guarded by a golden snapshot (the NFR-2 determinism anchor).
//
// PURE: no clock/random/IO/global state. dwellMs derives ONLY from a Beat's weight via the config
// dwell block (NEVER from event-timestamp deltas — the fixture's journal events carry an empty
// timestamp, and FR-12's "dwell" is a narrative budget, not a replay of real elapsed time), so the
// snapshot is stable. The only literals here are structural (0/1 — the empty-sum seed and the
// schemaVersion the committed BattleTimelineSchema pins).

export function pace(
  actions: TranslatedAction[],
  weights: PacingWeights = PACING_WEIGHTS,
  windowCfg = WINDOW_CONFIG,
): BattleTimeline {
  const scored: ScoredAction[] = actions.map((action) => ({
    ...action,
    weight: scoreEvent(action, weights),
  }));
  const windows = windowEvents(scored, windowCfg);
  const beats = deriveBeats(windows, weights);
  const totalDurationMs = beats.reduce((sum, b) => sum + b.dwellMs, 0);

  // Boundary-validate the stage output and fail closed (a malformed timeline throws rather than
  // flowing a bad artifact downstream). schemaVersion is the literal the committed schema pins.
  return BattleTimelineSchema.parse({ schemaVersion: 1, beats, totalDurationMs });
}

// deriveBeats maps each EventWindow -> one Beat using the COMMITTED BeatSchema shape (mechanics
// ONLY — no beatType/confidence/isMontage label; montage-vs-discrete is encoded solely by
// sourceEventIds cardinality + weight/dwellMs, never a label — R1). dwellMs = weight *
// dwellMsPerWeightUnit, so a significant beat (higher weight) gets MORE dwell than a montage.
export function deriveBeats(
  windows: EventWindow[],
  weights: PacingWeights = PACING_WEIGHTS,
): Beat[] {
  const perUnit = weights.dwell.dwellMsPerWeightUnit;
  return windows.map((w) => ({
    orderKey: w.orderKey,
    actionType: w.actionType,
    sourceEventIds: w.sourceEventIds,
    weight: w.weight,
    dwellMs: w.weight * perUnit,
  }));
}
