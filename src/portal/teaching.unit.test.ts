import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleState, Beat } from '../schema/battle-timeline';
import type { BeatAnnotation, BeatType } from '../schema/beat-annotation';
import { applyOverlay, type AnnotatedView } from '../interpret/overlay';

// RED-PHASE unit tests for Story 4.3 — the brevity bound (SM-C2), the negative branches, and the
// finite dwell, all on HAND-BUILT data (no fixture/fs). These FAIL until src/portal/teaching.ts +
// src/portal/teaching-config.ts exist. Mirrors the captions.unit.test.ts / beat-behavior.unit.test.ts
// posture: the AC-level real-fixture coverage lives in teaching.test.ts; this file pins the schema
// floor + the fail-closed empty cases the gate guarantees.
import { planTeaching, type TeachingOp } from './teaching';
import { TEACHING, TEACHING_MAX_LEN } from './teaching-config';
import { MODEL_TUNING } from '../model/model-tuning';

const DEV_STREAM_ID = 'aecfc998031eb0576';

// The three BeatType members the table is keyed exhaustively by (string-literal union, NO numeric enum).
const BEAT_TYPES: readonly BeatType[] = ['shaman', 'dispel', 'summon'];

// A minimal BattleState for the hand-built negative branches. The exact magnitudes are irrelevant to
// the cases below (held frame / non-signature beat) except where a gauge value is asserted explicitly.
// Mirrors beat-behavior.unit.test.ts snap().
function state(overrides: Partial<BattleState> = {}): BattleState {
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

// A minimal ordered NormalizedEvent — only eventId + orderKey are load-bearing for the overlay's event
// order; the other fields are plausible-but-irrelevant. Mirrors beat-behavior.unit.test.ts ev().
function event(eventId: string, seq = 0): NormalizedEvent {
  return {
    orderKey: { logicalClock: seq, streamId: DEV_STREAM_ID, seqWithinStream: seq },
    eventId,
    eventType: 'unit',
    toolName: null,
    subtype: null,
    timestamp: '2026-01-01T00:00:00.000Z',
    streamDepth: 0,
    exitCode: null,
    isError: false,
    retryCount: 0,
    payload: null,
  };
}

// A hand-built Beat collapsing the given source event ids (the planner keys off actionType +
// sourceEventIds; orderKey/weight/dwellMs are plausible-but-irrelevant). Mirrors beat-behavior.unit.test.ts.
function beat(actionType: Beat['actionType'], sourceEventIds: string[]): Beat {
  return {
    orderKey: { logicalClock: 0, streamId: DEV_STREAM_ID, seqWithinStream: 0 },
    actionType,
    sourceEventIds,
    weight: 16,
    dwellMs: 1920,
  };
}

function annotation(eventRef: string, beatType: BeatType): BeatAnnotation {
  return {
    eventRef,
    beatType,
    confidence: 0.8,
    interpreterVersion: 'unit-test-v1',
    sourceHash: 'unit',
    groundingPointer: { eventRefs: [eventRef] },
  };
}

function viewWith(events: NormalizedEvent[], annotations: BeatAnnotation[]): AnnotatedView {
  return applyOverlay([...events], [...annotations]);
}

describe('Story 4.3 SM-C2 — brevity: every authored one-liner respects the gate-checkable max-length bound', () => {
  it('TEACHING_MAX_LEN is exported, finite, and positive (ONE constant the schema + this test both reference)', () => {
    expect(Number.isFinite(TEACHING_MAX_LEN)).toBe(true);
    expect(TEACHING_MAX_LEN).toBeGreaterThan(0);
  });

  it('every TEACHING[beatType] one-liner is non-empty and <= TEACHING_MAX_LEN (the SM-C2 brevity floor)', () => {
    for (const beatType of BEAT_TYPES) {
      const line = TEACHING[beatType];
      expect(typeof line).toBe('string');
      expect(line.length).toBeGreaterThan(0);
      expect(line.length).toBeLessThanOrEqual(TEACHING_MAX_LEN);
    }
  });

  it('the table is keyed by the SINGLE plain-dev one-liner per beat type (a STRING, not an array — no rotation)', () => {
    // UNLIKE captions, teaching is a FIXED lesson per beat (the same concept every time; SM-1 wants the
    // lesson stable). So each value is one string, not a variant pool.
    for (const beatType of BEAT_TYPES) {
      expect(Array.isArray(TEACHING[beatType])).toBe(false);
      expect(typeof TEACHING[beatType]).toBe('string');
    }
  });
});

describe('Story 4.3 — negative branches: planTeaching fails closed to [] when no signature beat fires', () => {
  it('an EMPTY beatsAdvanced (a held frame, prev.cursor === next.cursor) returns []', () => {
    const view = viewWith([event('e-1')], [annotation('e-1', 'dispel')]);
    const held = state({ cursor: 3 });
    expect(planTeaching(held, held, [], view)).toEqual([]);
  });

  it('a transition crossing a NON-signature beat (no annotation on its events) returns []', () => {
    // A plain melee strike beat with no dispel/shaman/summon annotation surfaces no teaching.
    const events = [event('e-1')];
    const view = viewWith(events, []); // no annotations at all
    const beats = [beat('melee', ['e-1'])];
    expect(planTeaching(state({ cursor: 0 }), state({ cursor: 1 }), beats, view)).toEqual([]);
  });

  it('a CHARGED-but-not-discharged transition with a shaman tag present surfaces NO shaman op (the death gate is the discharge)', () => {
    // The shaman gate is the breakthrough DISCHARGE (gauge >= threshold going in, === 0 out). A
    // transition where the gauge stays charged (no discharge) must not teach shaman even with the
    // shaman annotation in the overlay — the lesson lands on the death, not the live loop.
    const events = [event('e-shaman'), event('e-other')];
    const view = viewWith(events, [annotation('e-shaman', 'shaman')]);
    // Advance a beat that does NOT carry the shaman anchor; gauge stays charged across the transition.
    const beats = [beat('melee', ['e-other'])];
    const prev = state({ cursor: 0, insightGauge: 60 });
    const next = state({ cursor: 1, insightGauge: 60 }); // still charged -> not a discharge
    expect(planTeaching(prev, next, beats, view).filter((o: TeachingOp) => o.beatType === 'shaman')).toEqual([]);
  });

  it('a dispel-tagged beat firing surfaces a dispel op whose dwellMs is finite and positive (the auto-dismiss duration)', () => {
    // The positive sanity at the unit level: the dispel op carries the auto-dismiss dwell the scene
    // arms a timer for. (The full per-beat-type coverage is in teaching.test.ts on the real fixture.)
    const events = [event('e-dispel')];
    const view = viewWith(events, [annotation('e-dispel', 'dispel')]);
    const beats = [beat('scout', ['e-dispel'])];
    const ops = planTeaching(state({ cursor: 0 }), state({ cursor: 1 }), beats, view);
    const dispelOps = ops.filter((o: TeachingOp) => o.beatType === 'dispel');
    expect(dispelOps).toHaveLength(1);
    expect(dispelOps[0]!.text).toBe(TEACHING.dispel);
    expect(Number.isFinite(dispelOps[0]!.dwellMs)).toBe(true);
    expect(dispelOps[0]!.dwellMs).toBeGreaterThan(0);
  });
});

describe('Story 4.3 SM-C2 — the dedupe-by-beatType guard (no stacking) is actively exercised, not merely incidentally satisfied', () => {
  // The real-fixture "at most one op per beatType per transition" assertion in teaching.test.ts holds
  // TRIVIALLY on the committed fixture: no transition there double-tags a beat, so it would pass even
  // if planTeaching's `taught` Set were deleted (a dead-guard / passes-for-the-wrong-reason gap). These
  // hand-built cases FEED the planner a beat tagged twice — the exact scenario the SM-C2 "no stacking"
  // invariant exists for — so the dedupe logic is the only thing keeping the op count at 1. A regression
  // removing the dedupe would turn these RED (the real-fixture test would stay green). Mirrors the
  // beat-behavior.unit.test.ts posture of unit-proving a guard the thin fixture never triggers.

  it('a single beat carrying TWO dispel annotations on the same event surfaces exactly ONE dispel op (byEventRef bucket of 2 collapses)', () => {
    // applyOverlay buckets both annotations under the same eventRef, so annotationsFiringInBeats returns
    // two firing dispel annotations for this one beat. Without the dedupe, planTeaching would push two
    // dispel ops; the `taught` Set must collapse them to one (SM-C2 brevity — one lesson per beat type).
    const events = [event('e-dispel')];
    const view = viewWith(events, [annotation('e-dispel', 'dispel'), annotation('e-dispel', 'dispel')]);
    expect(view.byEventRef.get('e-dispel')).toHaveLength(2); // guard: the planner really sees two
    const beats = [beat('scout', ['e-dispel'])];
    const dispelOps = planTeaching(state({ cursor: 0 }), state({ cursor: 1 }), beats, view).filter(
      (o: TeachingOp) => o.beatType === 'dispel',
    );
    expect(dispelOps).toHaveLength(1);
    expect(dispelOps[0]!.text).toBe(TEACHING.dispel);
  });

  it('TWO distinct dispel-tagged events fused into one transition surface exactly ONE dispel op (dedupe spans the whole transition, not one event)', () => {
    // A fused multi-beat transition (the boot's beatsAdvanced = slice(prevCursor, cursor) at speed>=2)
    // where two separate beats are each dispel-tagged: the dedupe must hold across the whole transition,
    // not reset per beat. Two dispel-tagged beats -> still exactly one dispel op.
    const events = [event('e-d1', 0), event('e-d2', 1)];
    const view = viewWith(events, [annotation('e-d1', 'dispel'), annotation('e-d2', 'dispel')]);
    const beats = [beat('scout', ['e-d1']), beat('scout', ['e-d2'])];
    const dispelOps = planTeaching(state({ cursor: 0 }), state({ cursor: 2 }), beats, view).filter(
      (o: TeachingOp) => o.beatType === 'dispel',
    );
    expect(dispelOps).toHaveLength(1);
  });

  it('two DISTINCT signature beat types in one breakthrough transition co-surface (one dispel + one summon) — dedupe is per beatType, not global', () => {
    // The dedupe collapses repeats of the SAME beatType, but must NOT suppress a different signature beat
    // type firing in the same transition. On the committed fixture dispel (Beat[0]) and the
    // discharge-driven beats never share a transition, so this co-occurrence is structurally untested
    // there; hand-build a breakthrough transition that fires BOTH a dispel-tagged beat and a
    // summon-tagged beat and assert exactly one of each (no cross-suppression, still no stacking).
    const events = [event('e-dispel', 0), event('e-summon', 1)];
    const view = viewWith(events, [annotation('e-dispel', 'dispel'), annotation('e-summon', 'summon')]);
    const beats = [beat('scout', ['e-dispel']), beat('melee', ['e-summon'])];
    // A breakthrough discharge: gauge charged going in (>= threshold), zero coming out.
    const prev = state({ cursor: 0, insightGauge: MODEL_TUNING.insight.dischargeThreshold });
    const next = state({ cursor: 2, insightGauge: 0 });
    const ops = planTeaching(prev, next, beats, view);
    expect(ops.filter((o: TeachingOp) => o.beatType === 'dispel')).toHaveLength(1);
    expect(ops.filter((o: TeachingOp) => o.beatType === 'summon')).toHaveLength(1);
    // And still at most one per type overall (the SM-C2 invariant holds with two types present).
    const counts = new Map<string, number>();
    for (const op of ops) counts.set(op.beatType, (counts.get(op.beatType) ?? 0) + 1);
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(1);
  });
});
