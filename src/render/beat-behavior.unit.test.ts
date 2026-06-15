import { describe, expect, it } from 'vitest';
import type { BattleState, Beat } from '../schema/battle-timeline';
import type { BeatAnnotation } from '../schema/beat-annotation';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { AnnotatedView } from '../interpret/overlay';
import { applyOverlay } from '../interpret/overlay';
import { fixtureAnnotations, FixtureInterpreter } from '../interpret/fixture-interpreter';
import { MODEL_TUNING } from '../model/model-tuning';
import { planBeatBehaviors, type BeatBehaviorIntent } from './beat-behavior';

// Focused GREEN-phase UNIT tests beyond the ATDD acceptance suite (beat-behavior.test.ts, which drives
// the REAL committed fixture for AC1/AC2/AC3). These pin the contracts the real-fixture ATDD leaves
// unproven because the thin slice never co-locates them: (1) the documented CROSS-behavior EMISSION
// ORDER (Shaman -> Dispel -> Summon) when several behaviors fire on ONE transition — the real fixture
// never fires the Dispel and the Shaman/Summon together (the Dispel is Beat[0], gauge=0; the Shaman/
// Summon are the breakthrough), so the order is hand-built here; (2) the L1->L0 bridge over a FUSED
// multi-beat (speed>=2) slice; (3) that fixtureAnnotations() (the boot's synchronous data path) returns
// the SAME content the async interpret() does (the extract-method refactor must not drift). Hand-built
// data is used deliberately for the unreachable co-occurrence — exactly the animation-plan.test.ts
// posture for its unreachable positive branch.

const DEV_STREAM_ID = 'aecfc998031eb0576';

// A minimal Beat with the given actionType + source-event ids (the planner keys off actionType +
// sourceEventIds; orderKey/weight/dwellMs are plausible-but-irrelevant). Mirrors animation-plan.test.ts.
function beat(actionType: Beat['actionType'], sourceEventIds: string[], weight = 16): Beat {
  return {
    orderKey: { logicalClock: 0, streamId: DEV_STREAM_ID, seqWithinStream: 0 },
    actionType,
    sourceEventIds,
    weight,
    dwellMs: weight * 120,
  };
}

// A hand-built snapshot; override only the fields a transition needs. Mirrors animation-plan.test.ts.
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

function annotation(eventRef: string, beatType: BeatAnnotation['beatType'], grounding: string[]): BeatAnnotation {
  return {
    eventRef,
    beatType,
    confidence: 0.9,
    interpreterVersion: 'unit-test-v1',
    sourceHash: 'unit',
    groundingPointer: { eventRefs: grounding },
  };
}

// A minimal ordered NormalizedEvent — only eventId + orderKey are load-bearing for the overlay's event
// ORDER (anchorReached compares anchor vs frontier event index in view.events). The other fields are
// plausible-but-irrelevant. ev('a', 0), ev('b', 1), ... gives a deterministic event ordering.
function ev(eventId: string, seq: number): NormalizedEvent {
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

// A view whose events appear in the given id order (anchorReached keys off view.events order).
function viewWithEvents(eventIds: string[], annotations: BeatAnnotation[]): AnnotatedView {
  return applyOverlay(eventIds.map((id, i) => ev(id, i)), annotations);
}

const THRESHOLD = MODEL_TUNING.insight.dischargeThreshold;

function order(intents: BeatBehaviorIntent[]): string[] {
  return intents.map((i) => `${i.target}:${i.behavior}`);
}

describe('beat-behavior — the documented CROSS-behavior emission order (Shaman -> Dispel -> Summon)', () => {
  it('a breakthrough transition carrying BOTH a dispel and a summon tag emits Shaman (swarm-clear+defeat), then Dispel (shatter+stagger+reveal), then Summon (summon+decisive-blow), in that fixed order', () => {
    // Build a single FUSED transition (a speed>=2 tick) whose beatsAdvanced carries a dispel-tagged beat
    // AND a summon-tagged breakthrough strike, while the gauge discharges (charged -> 0) and the
    // FixtureInterpreter-style shaman tag is present in the overlay. This is the only place all three
    // behaviors fire at once; assert the byte-stable documented order. The dispel beat is first in the
    // slice, the breakthrough strike second.
    const dispelBeat = beat('scout', ['e-dispel']);
    const breakthroughBeat = beat('melee', ['e-summon']);
    const view = applyOverlay(
      [],
      [
        annotation('e-shaman', 'shaman', ['e-shaman']),
        annotation('e-dispel', 'dispel', ['e-dispel', 'e-dispel-2']),
        annotation('e-summon', 'summon', ['e-summon']),
      ],
    );
    const prev = snap({ insightGauge: THRESHOLD, problemIntegrity: 20 });
    const next = snap({ insightGauge: 0, problemIntegrity: 0, victory: true, cursor: 2 });

    const { intents, signals } = planBeatBehaviors(prev, next, [dispelBeat, breakthroughBeat], view);

    expect(order(intents)).toEqual([
      'imp:swarm-clear', // (1) Shaman first: the breakthrough fells the root cause -> one-wave clear
      'shaman:defeat',
      'mirage:shatter', // (2) Dispel next: shatter -> resolve-stagger CUE -> reveal
      'forgemaiden:resolve-stagger',
      'mirage:reveal',
      'eidolon:summon', // (3) Summon last: the THUNDORR dramatization of the decisive blow
      'eidolon:decisive-blow',
    ]);
    // The Dispel still emits exactly its one scribe-correction signal alongside the other behaviors.
    expect(signals).toHaveLength(1);
    expect(signals[0]).toEqual({
      kind: 'scribe-correction',
      beatType: 'dispel',
      cursor: 2,
      grounding: { eventRefs: ['e-dispel', 'e-dispel-2'] },
    });
  });
});

describe('beat-behavior — the L1->L0 bridge fires over a FUSED multi-beat slice (speed>=2)', () => {
  it('a dispel tag carried by the SECOND beat of a 2-beat advanced slice still fires the Dispel behavior', () => {
    // The bridge intersects EVERY advanced beat's sourceEventIds with the overlay, so a tag anywhere in
    // a fused multi-beat transition fires. Put the dispel anchor on the second beat of the slice.
    const first = beat('melee', ['e-plain']);
    const second = beat('scout', ['e-dispel']);
    const view = applyOverlay([], [annotation('e-dispel', 'dispel', ['e-dispel'])]);
    const prev = snap({ cursor: 0 });
    const next = snap({ cursor: 2 });

    const { intents, signals } = planBeatBehaviors(prev, next, [first, second], view);
    expect(intents.filter((i) => i.target === 'mirage')).toHaveLength(2); // shatter + reveal
    expect(intents.some((i) => i.target === 'forgemaiden' && i.behavior === 'resolve-stagger')).toBe(true);
    expect(signals).toHaveLength(1);
  });
});

describe('beat-behavior — a session WITHOUT a Shaman tag fires no Shaman behavior on the breakthrough', () => {
  it('the breakthrough still discharges but emits NO swarm-clear/defeat when the overlay has no shaman tag', () => {
    // hasShaman gates the Shaman behavior on the overlay actually carrying a shaman tag — so a session
    // the interpreter never tagged with a shaman fires no resurrect/swarm-clear (the fail-closed half
    // the real fixture cannot show, since its FixtureInterpreter always tags a shaman).
    const view = applyOverlay([], []); // no annotations at all
    const prev = snap({ insightGauge: THRESHOLD, problemIntegrity: 16 });
    const next = snap({ insightGauge: 0, problemIntegrity: 0, victory: true, cursor: 1 });

    const { intents } = planBeatBehaviors(prev, next, [beat('melee', ['e'])], view);
    expect(intents.filter((i) => i.target === 'imp')).toHaveLength(0);
    expect(intents.filter((i) => i.target === 'shaman')).toHaveLength(0);
  });
});

describe('beat-behavior — resurrect requires the Shaman anchor to have been REACHED, not merely a charged gauge (F1)', () => {
  it('a charged gauge BEFORE the shaman anchor beat is crossed fires NO imp/shaman intents (anchor-crossing gate, not a gauge proxy)', () => {
    // F1 regression guard: the resurrect loop must fire only "while the Shaman beat has been REACHED"
    // (Dev Notes L132), not on a charged gauge alone. Here the shaman anchor (e-shaman) sits at event
    // index 4 — AHEAD of the transition's frontier (the advanced beat collapses e-early at index 0).
    // The gauge is charged (THRESHOLD) and this is NOT a discharge (gauge stays charged), so the OLD
    // gauge-only gate would have fired resurrect prematurely; the tightened anchorReached gate must not.
    const view = viewWithEvents(
      ['e-early', 'e-1', 'e-2', 'e-3', 'e-shaman'],
      [annotation('e-shaman', 'shaman', ['e-shaman'])],
    );
    const prev = snap({ insightGauge: THRESHOLD });
    const next = snap({ insightGauge: THRESHOLD, cursor: 1 }); // charged but NOT discharged -> no breakthrough

    const { intents } = planBeatBehaviors(prev, next, [beat('idle', ['e-early'])], view);
    expect(intents.filter((i) => i.target === 'imp')).toHaveLength(0);
    expect(intents.filter((i) => i.target === 'shaman')).toHaveLength(0);
  });

  it('once the shaman anchor beat is crossed (frontier at/after the anchor) with a charged gauge, resurrect DOES fire', () => {
    // The positive companion: the same charged-gauge transition, but now the advanced beat collapses the
    // shaman anchor (frontier == e-shaman), so the anchor has been reached -> resurrect fires. This pins
    // the gate as a true crossing check (it flips ON exactly when the anchor enters the consumed range).
    const view = viewWithEvents(
      ['e-early', 'e-1', 'e-2', 'e-3', 'e-shaman'],
      [annotation('e-shaman', 'shaman', ['e-shaman'])],
    );
    const prev = snap({ insightGauge: THRESHOLD });
    const next = snap({ insightGauge: THRESHOLD, cursor: 1 });

    const { intents } = planBeatBehaviors(prev, next, [beat('scout', ['e-shaman'])], view);
    expect(intents.filter((i) => i.target === 'imp' && i.behavior === 'resurrect')).toHaveLength(1);
  });
});

describe('fixtureAnnotations — the boot synchronous data path equals the async interpret() content', () => {
  it('returns deep-equal annotations to FixtureInterpreter.interpret() (the extract-method refactor does not drift)', async () => {
    // The boot threads the overlay SYNCHRONOUSLY via fixtureAnnotations(); the async interpret() now
    // delegates to it. Pin that the two sources stay byte-identical so a future edit to one cannot
    // silently diverge the browser path from the async seam.
    const sync = fixtureAnnotations();
    const viaInterpret = await new FixtureInterpreter().interpret([]);
    expect(sync).toEqual(viaInterpret);
    // And the dev/CI double's authored beats are present (the dispel + shaman, NO summon).
    expect(sync.map((a) => a.beatType).sort()).toEqual(['dispel', 'shaman']);
  });
});
