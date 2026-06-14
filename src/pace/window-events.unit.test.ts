import { describe, expect, it } from 'vitest';
import type { TranslatedAction } from '../translate/translated-action';
import type { ActionType } from '../schema/normalized-event';

// RED-PHASE acceptance tests for Story 1.5 Task 4 — windowEvents: the pure single-pass walk
// that collapses trivial/repetitive bursts into montage windows while keeping significant
// beats discrete. These FAIL until src/pace/window-events.ts exports
// `windowEvents(scored, cfg = WINDOW_CONFIG): EventWindow[]`. The import error is the red signal.
//
// The run rule under test (RESOLVED in Dev Notes):
//  - a SIGNIFICANT action (weight > montageThresholdWeight) is its OWN discrete window
//    (sourceEventIds.length === 1) and ALWAYS breaks a montage run;
//  - a maximal run of >= minRunToCollapse consecutive TRIVIAL actions (weight <= threshold) on
//    the SAME orderKey.streamId collapses into ONE montage window (sourceEventIds = the N ids);
//  - a trivial run SHORTER than minRunToCollapse stays discrete (do NOT over-collapse);
//  - stream discipline: a run NEVER crosses streamId (separate windows per stream);
//  - each window carries the ordered sourceEventIds it collapses, the FIRST action's orderKey,
//    a representative actionType, and an aggregated weight (these four field names are named
//    verbatim in Task 4 — they are the contract deriveBeats consumes).
//
// We import the validated WINDOW_CONFIG to read the REAL minRunToCollapse / threshold so the
// test tracks the committed policy (not a hardcoded guess), then hand-build ScoredAction[].
import { windowEvents } from './window-events';
import { WINDOW_CONFIG } from './pacing-config';

type ScoredAction = TranslatedAction & { weight: number };

const THRESHOLD = WINDOW_CONFIG.montageThresholdWeight;
const MIN_RUN = WINDOW_CONFIG.minRunToCollapse;
const TRIVIAL_W = THRESHOLD; // at the threshold => trivial (<=)
const SIGNIFICANT_W = THRESHOLD + 10; // strictly above => significant

function scored(opts: {
  actionType: ActionType;
  weight: number;
  eventId: string;
  seq: number;
  streamId?: string;
}): ScoredAction {
  return {
    actionType: opts.actionType,
    sourceEventId: opts.eventId,
    orderKey: {
      logicalClock: opts.seq,
      streamId: opts.streamId ?? 'main',
      seqWithinStream: opts.seq,
    },
    target: null,
    isMirage: null,
    resolveDelta: 0,
    problemIntegrityDelta: 0,
    isAetherStorm: false,
    weight: opts.weight,
  };
}

function trivial(eventId: string, seq: number, streamId?: string): ScoredAction {
  return scored({ actionType: 'idle', weight: TRIVIAL_W, eventId, seq, streamId });
}
function significant(eventId: string, seq: number, streamId?: string): ScoredAction {
  return scored({ actionType: 'melee', weight: SIGNIFICANT_W, eventId, seq, streamId });
}
// A trivial action whose actionType is NOT idle (a lone scout is also trivial, weight <=
// threshold) — used to prove the montage's representative actionType is the run's HEADLINE
// (most-significant member), not just the first action's type.
function trivialScout(eventId: string, seq: number, streamId?: string): ScoredAction {
  return scored({ actionType: 'scout', weight: TRIVIAL_W, eventId, seq, streamId });
}

describe('Story 1.5 AC1/Task4 — a run of >= minRunToCollapse trivial actions collapses to ONE montage', () => {
  it('exactly minRunToCollapse consecutive trivial actions on one stream -> a single montage window', () => {
    const run = Array.from({ length: MIN_RUN }, (_, i) => trivial(`t${i}`, i));
    const windows = windowEvents(run);
    expect(windows).toHaveLength(1);
    expect(windows[0].sourceEventIds).toEqual(run.map((a) => a.sourceEventId));
    expect(windows[0].sourceEventIds.length).toBe(MIN_RUN);
  });

  it('the montage window carries the FIRST action orderKey (preserves total order)', () => {
    const run = Array.from({ length: MIN_RUN }, (_, i) => trivial(`t${i}`, i));
    const windows = windowEvents(run);
    expect(windows[0].orderKey).toEqual(run[0].orderKey);
  });
});

describe('Story 1.5 AC1/Task4 — runs shorter than minRunToCollapse are NOT collapsed', () => {
  it('a run of (minRunToCollapse - 1) trivial actions stays discrete (one window per action)', () => {
    const shortRun = Array.from({ length: MIN_RUN - 1 }, (_, i) => trivial(`s${i}`, i));
    const windows = windowEvents(shortRun);
    expect(windows).toHaveLength(MIN_RUN - 1);
    for (const w of windows) {
      expect(w.sourceEventIds).toHaveLength(1);
    }
  });
});

describe('Story 1.5 AC1/Task4 — significant actions stay discrete and BREAK runs', () => {
  it('a single significant action -> a discrete window with one sourceEventId', () => {
    const windows = windowEvents([significant('m0', 0)]);
    expect(windows).toHaveLength(1);
    expect(windows[0].sourceEventIds).toEqual(['m0']);
  });

  it('a significant action in the MIDDLE of a trivial run splits it into [montage, discrete, montage]', () => {
    // run(MIN_RUN trivial) + 1 significant + run(MIN_RUN trivial), all one stream.
    const left = Array.from({ length: MIN_RUN }, (_, i) => trivial(`L${i}`, i));
    const mid = significant('M', MIN_RUN);
    const right = Array.from({ length: MIN_RUN }, (_, i) => trivial(`R${i}`, MIN_RUN + 1 + i));
    const windows = windowEvents([...left, mid, ...right]);
    expect(windows).toHaveLength(3);
    expect(windows[0].sourceEventIds).toEqual(left.map((a) => a.sourceEventId)); // montage
    expect(windows[1].sourceEventIds).toEqual(['M']); // discrete significant
    expect(windows[2].sourceEventIds).toEqual(right.map((a) => a.sourceEventId)); // montage
  });
});

describe('Story 1.5 AC1/Task4 — stream discipline: a montage run never crosses streamId', () => {
  it('MIN_RUN trivial on stream A then MIN_RUN trivial on stream B -> TWO separate montage windows', () => {
    const a = Array.from({ length: MIN_RUN }, (_, i) => trivial(`a${i}`, i, 'streamA'));
    const b = Array.from({ length: MIN_RUN }, (_, i) => trivial(`b${i}`, MIN_RUN + i, 'streamB'));
    const windows = windowEvents([...a, ...b]);
    expect(windows).toHaveLength(2);
    expect(windows[0].orderKey.streamId).toBe('streamA');
    expect(windows[1].orderKey.streamId).toBe('streamB');
    expect(windows[0].sourceEventIds).toEqual(a.map((x) => x.sourceEventId));
    expect(windows[1].sourceEventIds).toEqual(b.map((x) => x.sourceEventId));
  });
});

describe('Story 1.5 AC1/Task4 — montage weight stays LOW (must not out-dwell a real beat)', () => {
  it("a montage window's aggregated weight is <= the montage threshold (capped, not summed)", () => {
    const run = Array.from({ length: MIN_RUN + 2 }, (_, i) => trivial(`t${i}`, i));
    const [montage] = windowEvents(run);
    // Summing a long trivial run could exceed a real beat and invert dwell ordering; the
    // RESOLVED decision caps montage weight at the threshold (the run's max trivial weight).
    expect(montage.weight).toBeLessThanOrEqual(THRESHOLD);
  });

  it("a discrete significant window's weight is strictly greater than a montage's weight", () => {
    const run = Array.from({ length: MIN_RUN }, (_, i) => trivial(`t${i}`, i));
    const [montage] = windowEvents(run);
    const [disc] = windowEvents([significant('m', 0)]);
    expect(disc.weight).toBeGreaterThan(montage.weight);
  });
});

describe('Story 1.5 Task4 — a montage actionType is the run HEADLINE (most-significant in run)', () => {
  // Dev Notes "Montage representative actionType" RESOLVED: a montage Beat's actionType is the
  // MOST-SIGNIFICANT actionType in the collapsed run (a scout-heavy montage reads as scouting),
  // NOT arbitrary and NOT just the first action's type. The unit suite otherwise only builds
  // idle-only runs, so this pins the headline-selection branch directly. A regression that
  // returned run[0].actionType would pass every idle-only test but fail here.
  it('a trivial run of [idle, idle, scout] -> the montage actionType is `scout` (the headline)', () => {
    // idles strictly below the scout's weight, scout AT the threshold (still trivial), so the
    // headline is the scout even though it is not the first action. Robust to the committed
    // threshold (idleW <= THRESHOLD holds for any THRESHOLD >= 1).
    const idleW = Math.max(0, TRIVIAL_W - 1);
    const run: ScoredAction[] = [
      scored({ actionType: 'idle', weight: idleW, eventId: 'i0', seq: 0 }),
      scored({ actionType: 'idle', weight: idleW, eventId: 'i1', seq: 1 }),
      trivialScout('s0', 2),
    ];
    const windows = windowEvents(run);
    expect(windows).toHaveLength(1);
    expect(windows[0].sourceEventIds).toEqual(['i0', 'i1', 's0']);
    expect(windows[0].actionType).toBe('scout');
  });

  it('a pure-idle run -> the montage actionType is `idle` (the only member)', () => {
    const run = Array.from({ length: MIN_RUN }, (_, i) => trivial(`t${i}`, i));
    const [montage] = windowEvents(run);
    expect(montage.actionType).toBe('idle');
  });
});

describe('Story 1.5 Task4 — conservation + purity', () => {
  it('every input action appears in exactly one window (no drop, no dup)', () => {
    const left = Array.from({ length: MIN_RUN }, (_, i) => trivial(`L${i}`, i));
    const mid = significant('M', MIN_RUN);
    const right = Array.from({ length: MIN_RUN }, (_, i) => trivial(`R${i}`, MIN_RUN + 1 + i));
    const input = [...left, mid, ...right];
    const windows = windowEvents(input);
    const collapsed = windows.flatMap((w) => w.sourceEventIds);
    expect(collapsed).toEqual(input.map((a) => a.sourceEventId)); // same order, same set
  });

  it('does not mutate the input scored-action array', () => {
    const input = Array.from({ length: MIN_RUN }, (_, i) => trivial(`t${i}`, i));
    const before = JSON.stringify(input);
    windowEvents(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('an empty input yields an empty window list', () => {
    expect(windowEvents([])).toEqual([]);
  });
});
