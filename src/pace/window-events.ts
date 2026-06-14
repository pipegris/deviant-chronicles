import type { ActionType } from '../schema/normalized-event';
import type { WindowConfig } from './pacing-config';
import type { EventWindow, ScoredAction } from './pace-types';
import { WINDOW_CONFIG } from './pacing-config';

// windowEvents — the pure single-pass walk that collapses trivial/repetitive bursts into
// montage windows while keeping significant beats discrete (Layer-0, R2).
//
// The run rule: a SIGNIFICANT action (weight > montageThresholdWeight) is its own discrete
// window and ALWAYS breaks a montage run. A maximal run of >= minRunToCollapse consecutive
// TRIVIAL actions (weight <= threshold) on the SAME orderKey.streamId collapses into ONE
// montage window; a trivial run shorter than minRunToCollapse is NOT collapsed (each stays a
// discrete single-action window — do not over-collapse a lone idle). A run NEVER crosses
// streamId (stream discipline — the same boundary translate enforces for strike resolution).
//
// PURE: function-local accumulators only (a current-run array allocated fresh per call) — NOT
// module-level mutable state. The input array and its elements are never mutated; fresh window
// objects are built. There is no clock/random/IO. The only literals are structural (1, indices).
export function windowEvents(
  scored: ScoredAction[],
  cfg: WindowConfig = WINDOW_CONFIG,
): EventWindow[] {
  const windows: EventWindow[] = [];
  let run: ScoredAction[] = [];

  const isTrivial = (a: ScoredAction): boolean => a.weight <= cfg.montageThresholdWeight;

  // Flush the accumulated trivial run: collapse to ONE montage iff it is long enough on a single
  // stream, otherwise emit each trivial action as its own discrete window.
  const flushRun = (): void => {
    if (run.length === 0) return;
    if (run.length >= cfg.minRunToCollapse) {
      windows.push(montageWindow(run, cfg));
    } else {
      for (const a of run) windows.push(discreteWindow(a));
    }
    run = [];
  };

  for (const action of scored) {
    if (isTrivial(action)) {
      // A trivial action extends the current run only if it stays on the SAME stream; a stream
      // change ends the prior run and starts a new one (stream discipline).
      if (run.length > 0 && run[run.length - 1].orderKey.streamId !== action.orderKey.streamId) {
        flushRun();
      }
      run.push(action);
    } else {
      // A significant action ends any open run, then takes its own discrete window.
      flushRun();
      windows.push(discreteWindow(action));
    }
  }
  flushRun();

  return windows;
}

function discreteWindow(action: ScoredAction): EventWindow {
  return {
    orderKey: action.orderKey,
    actionType: action.actionType,
    sourceEventIds: [action.sourceEventId],
    weight: action.weight,
  };
}

// A montage carries the ordered ids it collapses, the FIRST action's orderKey (preserves total
// order + stable sort), the most-significant actionType in the run (the "headline" of what was
// collapsed — so a scout-heavy montage reads as scouting), and a weight CAPPED at the threshold
// (the run's max trivial weight). Capping (not summing) keeps a long idle run from out-weighing
// a real beat and inverting the dwell ordering — significant beats must out-dwell montages.
function montageWindow(run: ScoredAction[], cfg: WindowConfig): EventWindow {
  let maxWeight = run[0].weight;
  let headline: ActionType = run[0].actionType;
  let headlineWeight = run[0].weight;
  for (const a of run) {
    if (a.weight > maxWeight) maxWeight = a.weight;
    if (a.weight > headlineWeight) {
      headlineWeight = a.weight;
      headline = a.actionType;
    }
  }
  return {
    orderKey: run[0].orderKey,
    actionType: headline,
    sourceEventIds: run.map((a) => a.sourceEventId),
    weight: Math.min(maxWeight, cfg.montageThresholdWeight),
  };
}
