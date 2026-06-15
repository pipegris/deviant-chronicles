import { describe, expect, it } from 'vitest';
import type { BattleState, Beat } from '../schema/battle-timeline';
import type { BeatAnnotation } from '../schema/beat-annotation';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { AnnotatedView } from '../interpret/overlay';
import { applyOverlay } from '../interpret/overlay';
import { scribeCorrection } from '../interpret/beat-signal';
import { planCaptions, planCaptionCorrection, type CaptionOp } from './captions';
import { CAPTIONS, CaptionsTableSchema } from './captions-config';
import rawCaptions from '../config/captions.json';

// RED-PHASE focused UNIT tests beyond the ATDD acceptance suite (captions.test.ts, which drives the
// REAL committed fixture for AC1/AC2/SM-C2). These pin the contracts the real-fixture ATDD leaves
// unproven because the thin slice never co-locates them:
//   (1) the `summon` caption family (the committed FixtureInterpreter OMITS summon by design — no
//       sub-agent-spawn event in the thin slice — so no summon-tagged beat exists in the real fixture);
//   (2) a FUSED multi-beat transition (speed>=2): one caption per captionable beat in the slice,
//       idle still skipped;
//   (3) a correction when the prior caption is N beats BACK in the history (not the most recent emit);
//   (4) the aetherStorm family (an environmental hazard family the thin fixture never tags).
// Hand-built data is used deliberately for the unreachable cases — exactly the beat-behavior.unit.test.ts
// posture for its unreachable co-occurrence branch.

const DEV_STREAM_ID = 'aecfc998031eb0576';

// A minimal Beat with the given actionType + source-event ids. Mirrors beat-behavior.unit.test.ts.
function beat(actionType: Beat['actionType'], sourceEventIds: string[], weight = 16): Beat {
  return {
    orderKey: { logicalClock: 0, streamId: DEV_STREAM_ID, seqWithinStream: 0 },
    actionType,
    sourceEventIds,
    weight,
    dwellMs: weight * 120,
  };
}

// A hand-built snapshot; override only the fields a transition needs. Mirrors beat-behavior.unit.test.ts.
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

function viewWithEvents(eventIds: string[], annotations: BeatAnnotation[]): AnnotatedView {
  return applyOverlay(eventIds.map((id, i) => ev(id, i)), annotations);
}

const emits = (ops: CaptionOp[]): Extract<CaptionOp, { kind: 'emit' }>[] =>
  ops.filter((o): o is Extract<CaptionOp, { kind: 'emit' }> => o.kind === 'emit');

describe('captions — the summon family (unreachable in the committed fixture)', () => {
  it('a summon-tagged beat is captioned from the "summon" family, not the bare actionType family', () => {
    // The FixtureInterpreter omits summon, so the summon caption family is unit-proven with a hand-built
    // summon annotation spliced into a hand-built overlay (the beat-behavior.unit.test.ts posture).
    const view = viewWithEvents(['e-summon'], [annotation('e-summon', 'summon', ['e-summon'])]);
    const ops = emits(planCaptions(snap(), snap({ cursor: 1 }), [beat('melee', ['e-summon'])], view));
    expect(ops).toHaveLength(1);
    expect(CAPTIONS.summon).toContain(ops[0]!.text);
    // The bare actionType here is `melee`, but the summon TAG must win.
    expect(CAPTIONS.melee).not.toContain(ops[0]!.text);
  });
});

describe('captions — an environmental aetherStorm family', () => {
  it('an aetherStorm beat is captioned from the "aetherStorm" family', () => {
    // aetherStorm is a closed-union ActionType the thin fixture never produces; its family must exist
    // in the table and be selected for an aetherStorm beat (the environmental hazard caption).
    const view = applyOverlay([], []);
    const ops = emits(planCaptions(snap(), snap({ cursor: 1 }), [beat('aetherStorm', ['e-storm'])], view));
    expect(ops).toHaveLength(1);
    expect(ops[0]!.actionType).toBe('aetherStorm');
    expect(CAPTIONS.aetherStorm).toContain(ops[0]!.text);
  });
});

describe('captions — a FUSED multi-beat transition (speed>=2 slice)', () => {
  it('emits one caption per captionable beat in the advanced slice, skipping idle', () => {
    // A single forward tick at speed>=2 advances multiple beats at once (the boot's beatsAdvanced =
    // slice(prevCursor, cursor)). The selector must caption EACH captionable beat in the slice and
    // skip the idle one — proving the throttle is per-beat, not per-transition.
    const view = applyOverlay([], []);
    const slice = [beat('melee', ['e-1']), beat('idle', ['e-2']), beat('spell', ['e-3'])];
    const ops = emits(planCaptions(snap(), snap({ cursor: 3 }), slice, view));
    expect(ops.map((o) => o.actionType)).toEqual(['melee', 'spell']); // idle dropped, order preserved
  });

  it('an EMPTY advanced slice (a held frame, prev.cursor === next.cursor) emits no caption ops', () => {
    const view = applyOverlay([], []);
    expect(planCaptions(snap(), snap(), [], view)).toEqual([]);
  });
});

describe('captions — correction targets the right prior caption when it is N beats back', () => {
  it('resolves a `correct` op against an EARLIER emit in the history, not merely the most recent', () => {
    // The real fixture's Dispel is Beat[0] (the prior caption is the immediately-preceding emit). This
    // unit covers the harder case: the assumption caption is several emits back when the Dispel fires,
    // so the handler must resolve targeting via the signal's grounding/cursor, not "the last emit."
    //
    // Build a history where the GROUNDED assumption caption (id derived from the assumption event) is
    // followed by two unrelated emits before the correction fires. The handler must still cross out the
    // assumption caption, not the trailing melee.
    const view = viewWithEvents(
      ['e-assume', 'e-mid', 'e-late', 'e-truth'],
      [annotation('e-assume', 'dispel', ['e-assume', 'e-truth'])],
    );

    // Replay three single-beat transitions to build the running history: the assumption (dispel-tagged),
    // then two plain emits after it.
    const history: Extract<CaptionOp, { kind: 'emit' }>[] = [];
    history.push(...emits(planCaptions(snap(), snap({ cursor: 1 }), [beat('scout', ['e-assume'])], view)));
    history.push(...emits(planCaptions(snap({ cursor: 1 }), snap({ cursor: 2 }), [beat('melee', ['e-mid'])], view)));
    history.push(...emits(planCaptions(snap({ cursor: 2 }), snap({ cursor: 3 }), [beat('melee', ['e-late'])], view)));
    expect(history.length).toBeGreaterThanOrEqual(3);

    // The Dispel fires later (cursor 4) carrying the assumption grounding.
    const signal = scribeCorrection(4, { eventRefs: ['e-assume', 'e-truth'] });
    const op = planCaptionCorrection(signal, history);
    expect(op).not.toBeNull();
    expect(op!.kind).toBe('correct');

    // The crossed-out caption is the ASSUMPTION caption (the dispel-grounded one, NOT a trailing melee).
    const target = history.find((h) => h.captionId === op!.targetCaptionId)!;
    expect(target).toBeDefined();
    expect(op!.struckText).toBe(target.text);
    // It is NOT one of the two trailing melee captions (targeting is grounding-driven, not recency).
    const trailingMelee = history.filter((h) => h.actionType === 'melee').map((h) => h.captionId);
    expect(trailingMelee).not.toContain(op!.targetCaptionId);
  });

  it('returns null (no correction) when the history has no caption matching the signal grounding', () => {
    // A correction signal whose grounded events were never captioned (e.g. an idle-only region) has
    // nothing to cross out — the handler resolves to no op rather than fabricating a target.
    const history: Extract<CaptionOp, { kind: 'emit' }>[] = emits(
      planCaptions(snap(), snap({ cursor: 1 }), [beat('melee', ['e-unrelated'])], applyOverlay([], [])),
    );
    const signal = scribeCorrection(9, { eventRefs: ['e-never-captioned'] });
    expect(planCaptionCorrection(signal, history)).toBeNull();
  });

  it('strikes the ASSUMPTION caption, NOT a later separate ground-truth-Read caption (review F2)', () => {
    // The thin committed fixture FUSES the assumption + the ground-truth Read into one Beat[0], masking
    // a latent mis-target: a richer session emits a SEPARATE later caption for the ground-truth-Read beat
    // too. Both that later Read caption and the assumption caption intersect the FULL grounding
    // (assumption events + Read), so matching the full set would strike the MORE-RECENT Read caption
    // instead of the assumption. The handler must intersect only the ASSUMPTION PORTION (the grounding
    // MINUS its trailing Read ref) so the EARLIER assumption caption is the one crossed out. This is the
    // regression guard for the F2 hardening — it would FAIL against the pre-fix full-grounding match.
    const view = viewWithEvents(
      ['e-assume', 'e-mid', 'e-read'],
      [annotation('e-assume', 'dispel', ['e-assume', 'e-read'])],
    );

    // History: the assumption caption (the one to strike), an unrelated emit, THEN a separate caption
    // that dramatizes the ground-truth Read event itself (the trailing grounding ref) — more recent.
    const history: Extract<CaptionOp, { kind: 'emit' }>[] = [];
    history.push(...emits(planCaptions(snap(), snap({ cursor: 1 }), [beat('scout', ['e-assume'])], view)));
    history.push(...emits(planCaptions(snap({ cursor: 1 }), snap({ cursor: 2 }), [beat('melee', ['e-mid'])], view)));
    history.push(...emits(planCaptions(snap({ cursor: 2 }), snap({ cursor: 3 }), [beat('scout', ['e-read'])], view)));

    const assumptionCaption = history.find((h) => h.groundingRefs.includes('e-assume'))!;
    const readCaption = history.find((h) => h.groundingRefs.includes('e-read'))!;
    // Sanity: the Read caption is genuinely a SEPARATE, more-recent emit (the masking the fixture hides).
    expect(readCaption.captionId).not.toBe(assumptionCaption.captionId);
    expect(history.indexOf(readCaption)).toBeGreaterThan(history.indexOf(assumptionCaption));

    // The Dispel fires carrying the full grounding [assumption, ground-truth Read].
    const signal = scribeCorrection(4, { eventRefs: ['e-assume', 'e-read'] });
    const op = planCaptionCorrection(signal, history);
    expect(op).not.toBeNull();
    // The struck caption is the ASSUMPTION caption, NOT the later ground-truth-Read caption.
    expect(op!.targetCaptionId).toBe(assumptionCaption.captionId);
    expect(op!.targetCaptionId).not.toBe(readCaption.captionId);
    expect(op!.struckText).toBe(assumptionCaption.text);
  });
});

describe('captions-config — the .strict() fail-closed schema (the loud build-time guard, NFR-4)', () => {
  // Task 1 + Dev Notes "Config-as-data pattern" make a LOAD-BEARING claim: a typo'd / missing key, a
  // bumped $schemaVersion, or an empty/blank variant must fail LOUD at import (an exhaustive
  // z.object(...).strict() over a closed key set, mirroring WeightsMapSchema / ModelTuningSchema).
  // The ATDD suite only proves the COMMITTED table parses; these pin the NEGATIVE branches (the
  // fail-closed behaviour the whole "config-as-data, never silently mis-narrate" posture rests on).
  // We re-parse MUTATED clones of the real artifact, so the committed file is never touched.
  const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(rawCaptions));

  it('parses the real committed captions.json (the green baseline)', () => {
    expect(() => CaptionsTableSchema.parse(rawCaptions)).not.toThrow();
  });

  it('REJECTS an unknown key (.strict() — a typo like `meele` cannot slip in silently)', () => {
    expect(() => CaptionsTableSchema.parse({ ...clone(), meele: ['oops'] })).toThrow();
  });

  it('REJECTS a MISSING required family key (z.object is exhaustive — forgetting `counter` fails closed)', () => {
    const missing = clone();
    delete missing.counter;
    expect(() => CaptionsTableSchema.parse(missing)).toThrow();
  });

  it('REJECTS a bumped $schemaVersion (z.literal(1) — an old reader fails closed on a new artifact)', () => {
    expect(() => CaptionsTableSchema.parse({ ...clone(), $schemaVersion: 2 })).toThrow();
  });

  it('REJECTS an empty variant array (.min(1) — a family must offer at least one caption)', () => {
    const empty = clone();
    empty.melee = [];
    expect(() => CaptionsTableSchema.parse(empty)).toThrow();
  });

  it('REJECTS a blank-string variant (z.string().min(1) — no empty caption text)', () => {
    const blank = clone();
    blank.melee = [''];
    expect(() => CaptionsTableSchema.parse(blank)).toThrow();
  });
});
