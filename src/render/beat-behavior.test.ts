import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleState, BattleTimeline, Beat } from '../schema/battle-timeline';
import type { BeatAnnotation } from '../schema/beat-annotation';
import type { AnnotatedView } from '../interpret/overlay';

// RED-PHASE acceptance tests for Story 3.3 (Task 2 + Task 4) — the PURE beat-behavior plan
// `planBeatBehaviors(prev, next, beatsAdvanced, view) -> { intents, signals }`, the sibling of
// `planAnimations`. These FAIL until src/render/beat-behavior.ts exports `planBeatBehaviors`
// plus the `BeatBehaviorIntent` / `BeatBehaviorName` / `BeatBehaviorTarget` types AND
// src/interpret/beat-signal.ts exports `BeatSignal`. The import error is the intended RED
// (exactly the posture animation-plan.test.ts held in its own red phase). This is the BULK of
// the gate-provable surface for AC1/AC2/AC3 — the (transition + overlay) -> behavior-intent +
// signal DECISION logic, expressed as plain data, with ZERO Phaser (node env, no DOM).
//
// What the gate CAN prove here (per the story's "What the gate CAN prove vs OPERATOR-verified"):
// WHICH behavior intents + signals fire for a given (prev, next, beatsAdvanced, AnnotatedView)
// transition — the Shaman resurrect-loop vs one-wave-clear; the Dispel's shatter + resolve-stagger
// CUE + reveal + the emitted scribe-correction SIGNAL; the Summon gated on a charged gauge + a
// summon-tagged breakthrough; determinism; and the R1 data-level proof (no mechanics fields, no
// BattleState returned). It CANNOT prove the visual READING (imps visibly resurrect/die as a wave,
// the mirage visibly shatters, the blow reads as decisive, 60fps) — those are OPERATOR-verified by
// watching `pnpm dev`. The polished cinematics are Stories 3.4/3.5.
//
// Pipeline reuse (copied verbatim from animation-plan.test.ts L42-66): we read the COMMITTED ingest
// fixtures with fs IN THE TEST (tests are not Layer-0 modules, so this respects R2) and run the
// SAME parse -> normalize -> merge -> translate -> pace chain the golden snapshot pins, then fold
// the resulting BattleTimeline to drive REAL transitions through planBeatBehaviors — AND run the
// FixtureInterpreter over the same events -> annotations -> applyOverlay -> the read-only view.
// Hand-built data is used ONLY for the Summon POSITIVE branch (the committed FixtureInterpreter
// omits `summon` by design — Story 3.1 — so no summon-tagged beat exists in the real fixture; the
// same honest gap animation-plan.test.ts L68-75 documents for its unreachable positive branch).
import {
  planBeatBehaviors,
  type BeatBehaviorIntent,
} from './beat-behavior';
import { foldBattleState } from '../model/battle-model';
import { MODEL_TUNING } from '../model/model-tuning';
import { pace } from '../pace/derive-beats';
import { translate } from '../translate/translate';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';
import { applyOverlay } from '../interpret/overlay';
import { FixtureInterpreter } from '../interpret/fixture-interpreter';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'ingest', '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

// Copied verbatim from src/render/animation-plan.test.ts L52-62 so the behavior plan maps the EXACT
// committed BattleTimeline / BattleState the model tests fold.
function runIngest(): NormalizedEvent[] {
  const transcript = normalizeTranscript(
    parseTranscript(readFixture('sample-transcript.jsonl'), DEV_STREAM_ID),
    DEV_STREAM_ID,
  );
  const devMaxEpoch = Math.max(
    ...transcript.map((e) => Date.parse(e.timestamp)).filter((n) => !Number.isNaN(n)),
  );
  const journal = normalizeJournal(parseJournal(readFixture('sample-journal.jsonl')), devMaxEpoch + 1);
  return mergeStreams([transcript, journal]);
}

function timeline(): BattleTimeline {
  return pace(translate(runIngest()));
}

// The read-only overlay the boot threads in: the FixtureInterpreter's annotations (dispel @ u-0002#1,
// shaman @ u-0010#0, NO summon) applied side-by-side to the same events. async because BeatInterpreter
// is an async seam (Story 3.1) — the FixtureInterpreter resolves the fixed literals.
async function overlay(): Promise<AnnotatedView> {
  const events = runIngest();
  const annotations = await new FixtureInterpreter().interpret(events);
  return applyOverlay(events, annotations);
}

// Convenience: the intents matching target (+ optional behavior).
function intentsFor(
  intents: BeatBehaviorIntent[],
  target: BeatBehaviorIntent['target'],
  behavior?: BeatBehaviorIntent['behavior'],
) {
  return intents.filter((i) => i.target === target && (behavior === undefined || i.behavior === behavior));
}

// ---- transition locators against the committed 10-beat timeline (the L1->L0 bridge) ----
//
// The committed pace snapshot (pace.test.ts.snap) pins these positions, which the L1->L0 bridge
// (sourceEventIds ∩ view.byEventRef) keys off:
//   Beat[0]  scout   ['u-0001','u-0002#1','u-0002#2','u-0003#0'] -> carries the DISPEL anchor u-0002#1
//   Beat[6]  counter ['u-0009#0']                                -> the struggle that charges the gauge
//   Beat[7]  scout   ['u-0010#0','u-0011#0']                     -> carries the SHAMAN anchor u-0010#0
//   Beat[9]  melee   ['phase-dev-OPAQUEHASH-1#result']           -> the BREAKTHROUGH (last beat; discharge)
const DISPEL_BEAT_INDEX = 0;
const SHAMAN_BEAT_INDEX = 7;

// A single-beat forward transition advancing beats[index] (cursor index -> index+1), exactly the
// boot's `beatsAdvanced = timeline.beats.slice(prevCursor, cursor)` for a speed-1 tick.
function transitionAt(tl: BattleTimeline, index: number): {
  prev: BattleState;
  next: BattleState;
  beats: Beat[];
} {
  return {
    prev: foldBattleState(tl, index),
    next: foldBattleState(tl, index + 1),
    beats: tl.beats.slice(index, index + 1),
  };
}

// The breakthrough/discharge transition: the LAST beat, where the gauge (charged by the lone counter)
// discharges 0. battle-model.test.ts L170-186 pins "still charged the beat before, discharged ON the
// breakthrough beat" — so this is cursor (length-1) -> length.
function dischargeTransition(tl: BattleTimeline) {
  return transitionAt(tl, tl.beats.length - 1);
}

describe('Story 3.3 AC2 — Dispel: mirage-shatter + resolve-stagger CUE + reveal + scribe-correction SIGNAL (REAL fixture)', () => {
  it('the transition crossing the Dispel-tagged beat (Beat[0], anchor u-0002#1) emits all three intents AND exactly one scribe-correction signal', async () => {
    // The headline AC2 proof. The Dispel anchor u-0002#1 lives in Beat[0]; the L1->L0 bridge fires
    // the Dispel behavior on the transition whose beatsAdvanced carries that beat.
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = transitionAt(tl, DISPEL_BEAT_INDEX);
    // Guard the locator: the advanced beat genuinely carries the dispel anchor.
    expect(beats.some((b) => b.sourceEventIds.includes('u-0002#1'))).toBe(true);

    const { intents, signals } = planBeatBehaviors(prev, next, beats, view);

    // The three presentation intents (in the story's documented order: shatter -> stagger -> reveal).
    expect(intentsFor(intents, 'mirage', 'shatter')).toHaveLength(1);
    expect(intentsFor(intents, 'forgemaiden', 'resolve-stagger')).toHaveLength(1);
    expect(intentsFor(intents, 'mirage', 'reveal')).toHaveLength(1);

    // Exactly ONE scribe-correction signal carrying the Dispel's groundingPointer + the firing cursor —
    // the cross-layer output FR-9 (Story 4.1) consumes to cross out the prior caption.
    expect(signals).toHaveLength(1);
    expect(signals[0]).toEqual({
      kind: 'scribe-correction',
      beatType: 'dispel',
      cursor: next.cursor,
      grounding: { eventRefs: ['u-0002#1', 'u-0002#2', 'u-0003#0'] },
    });
  });

  it('the resolve-stagger is a PRESENTATION cue, NOT a Resolve mutation (no resolve value on the intent; prev/next Resolve unchanged by the call)', async () => {
    // The subtle R1 trap (story Dev Notes "the Dispel's Resolve stagger is a CUE"): the behavior emits
    // a recoil CUE but NEVER computes/mutates Resolve. The Dispel anchor lands in a SCOUT beat (Beat[0])
    // that Layer-0 drains NO Resolve, so the snapshots' resolve is unchanged across this transition —
    // and the intent carries no resolve field.
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = transitionAt(tl, DISPEL_BEAT_INDEX);
    expect(prev.resolve).toBe(next.resolve); // the scout beat drained no Resolve in Layer-0

    const { intents } = planBeatBehaviors(prev, next, beats, view);
    const stagger = intentsFor(intents, 'forgemaiden', 'resolve-stagger')[0];
    expect(stagger).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(stagger, 'resolve')).toBe(false);
  });

  it('a transition with NO Dispel-tagged beat (e.g. a melee strike beat) emits NO scribe-correction signal', async () => {
    // The fail-closed half: the signal fires ONLY where the dispel tag lands. Beat[1] is a plain melee
    // strike with no annotation, so no dispel intents and no signal.
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = transitionAt(tl, 1);
    expect(beats.some((b) => view.byEventRef.has(b.sourceEventIds[0]!))).toBe(false);

    const { intents, signals } = planBeatBehaviors(prev, next, beats, view);
    expect(signals).toHaveLength(0);
    expect(intentsFor(intents, 'mirage')).toHaveLength(0);
  });
});

describe('Story 3.3 AC1 — Fallen Shaman: resurrect-loop while live, one-wave-clear on the breakthrough (REAL fixture)', () => {
  it('while the Shaman beat has been reached and the root cause is unresolved, an advancing transition emits an imp/resurrect intent', async () => {
    // AC1 first clause: "defeated symptom-imps visibly resurrect while the Shaman lives." The Shaman
    // anchor u-0010#0 is in Beat[7]; once it is reached, advancing transitions BEFORE the breakthrough
    // discharge emit a resurrect loop intent. Beat[8] (the idle, cursor 7->8 is the shaman beat itself;
    // 8->9 advances the idle) is such an advancing transition while the gauge is still charged (not yet
    // discharged). We take the transition advancing Beat[8] (cursor 8 -> 9): the shaman beat (7) has
    // been reached, and the breakthrough (Beat[9], cursor 9->10) has NOT happened yet.
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = transitionAt(tl, 8);
    // The Shaman beat has already been crossed (prev.cursor is past Beat[7]) and the breakthrough has
    // not fired (gauge still charged, victory not latched).
    expect(prev.cursor).toBeGreaterThan(SHAMAN_BEAT_INDEX);
    expect(prev.insightGauge).toBeGreaterThanOrEqual(MODEL_TUNING.insight.dischargeThreshold);
    expect(prev.victory).toBe(false);

    const { intents } = planBeatBehaviors(prev, next, beats, view);
    expect(intentsFor(intents, 'imp', 'resurrect')).toHaveLength(1);
    // Not yet the wave clear — the Shaman is still "alive" (root cause unresolved).
    expect(intentsFor(intents, 'imp', 'swarm-clear')).toHaveLength(0);
    expect(intentsFor(intents, 'shaman', 'defeat')).toHaveLength(0);
  });

  it('on the breakthrough/discharge transition the Shaman is defeated: exactly one imp/swarm-clear AND one shaman/defeat (and NO resurrect)', async () => {
    // AC1 second clause: "when the Shaman is defeated all its imps die in one wave." The root cause
    // "falls" when the fix lands = the discharge transition (prev.insightGauge >= dischargeThreshold &&
    // next.insightGauge === 0), the SAME Layer-0 signal the Summon keys on (story Dev Notes "Shaman
    // live/defeated model"). All purely from the two snapshots — imps stay presentation-only.
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = dischargeTransition(tl);
    // Sanity: this IS the discharge transition.
    expect(prev.insightGauge).toBeGreaterThanOrEqual(MODEL_TUNING.insight.dischargeThreshold);
    expect(next.insightGauge).toBe(0);

    const { intents } = planBeatBehaviors(prev, next, beats, view);
    expect(intentsFor(intents, 'imp', 'swarm-clear')).toHaveLength(1);
    expect(intentsFor(intents, 'shaman', 'defeat')).toHaveLength(1);
    // The wave clear is the death, not another resurrect.
    expect(intentsFor(intents, 'imp', 'resurrect')).toHaveLength(0);
  });

  it('no per-minion HP is invented: no imp intent (nor any behavior intent) carries an hp field, and the plan returns no BattleState', async () => {
    // AC1 + the honest gap "imps have NO per-minion HP in v0.1 BattleState". The resurrect/swarm-clear
    // are a PRESENTATION loop keyed on the Shaman's live-vs-defeated status, NOT per-imp HP. Pin that
    // no intent fabricates an hp count and the plan never folds a BattleState.
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = dischargeTransition(tl);
    const result = planBeatBehaviors(prev, next, beats, view);
    for (const intent of result.intents) {
      expect(Object.prototype.hasOwnProperty.call(intent, 'hp')).toBe(false);
    }
    // The return object has ONLY { intents, signals } — never a BattleState (the R1 structural proof).
    expect(Object.keys(result).sort()).toEqual(['intents', 'signals']);
  });
});

describe('Story 3.3 AC3 — Eidolon Summon / THUNDORR: fires on a summon-tagged breakthrough WHEN the gauge is charged (UNIT branch)', () => {
  // The committed FixtureInterpreter OMITS `summon` by design (Story 3.1 — no sub-agent-spawn event in
  // the thin slice), so no summon-tagged beat exists in the real fixture. The Summon POSITIVE branch is
  // therefore UNIT-proven with a HAND-BUILT `summon` annotation on the breakthrough beat's anchor event
  // spliced into a hand-built AnnotatedView — exactly how animation-plan.test.ts L68-75 unit-proved its
  // unreachable positive branch (the hand-built multi-source melee for Hammer-Flurry). Documented as a gap.

  // A hand-built summon annotation anchored on the breakthrough beat's FIRST source event id. Grounding
  // is the anchor itself (a summon dramatizes the decisive strike). All ids resolve to real fixture events.
  function summonAnnotation(anchor: string): BeatAnnotation {
    return {
      eventRef: anchor,
      beatType: 'summon',
      confidence: 0.9,
      interpreterVersion: 'unit-test-v1',
      sourceHash: 'unit',
      groundingPointer: { eventRefs: [anchor] },
    };
  }

  // Splice a single hand-built annotation into a fresh AnnotatedView (the same side-by-side shape
  // applyOverlay builds: events + annotations + the byEventRef index).
  function viewWith(events: NormalizedEvent[], annotation: BeatAnnotation): AnnotatedView {
    return applyOverlay([...events], [annotation]);
  }

  it('fires eidolon/summon + eidolon/decisive-blow on the discharge transition when a summon-tagged breakthrough is charged', async () => {
    const tl = timeline();
    const events = runIngest();
    const { prev, next, beats } = dischargeTransition(tl);
    // The breakthrough beat's anchor event id (its first collapsed source event).
    const anchor = beats[0]!.sourceEventIds[0]!;
    expect(anchor).toBe('phase-dev-OPAQUEHASH-1#result'); // the journal completion = the breakthrough
    const view = viewWith(events, summonAnnotation(anchor));

    // Sanity: this IS the charged-gauge breakthrough (the discharge transition).
    expect(prev.insightGauge).toBeGreaterThanOrEqual(MODEL_TUNING.insight.dischargeThreshold);
    expect(next.insightGauge).toBe(0);

    const { intents } = planBeatBehaviors(prev, next, beats, view);
    expect(intentsFor(intents, 'eidolon', 'summon')).toHaveLength(1);
    expect(intentsFor(intents, 'eidolon', 'decisive-blow')).toHaveLength(1);
  });

  it('fires NOTHING for the eidolon on a NON-breakthrough transition even with a summon tag (gauge not charged -> no discharge)', async () => {
    // AC3's gate is the CHARGED gauge: a summon tag on a transition that is NOT the charged-gauge
    // breakthrough must not summon THUNDORR. Beat[1] is a plain melee strike with the gauge at 0
    // (charged only by the later counter), so prev.insightGauge < dischargeThreshold -> no discharge.
    const tl = timeline();
    const events = runIngest();
    const { prev, next, beats } = transitionAt(tl, 1);
    const anchor = beats[0]!.sourceEventIds[0]!;
    const view = viewWith(events, summonAnnotation(anchor));
    expect(prev.insightGauge).toBeLessThan(MODEL_TUNING.insight.dischargeThreshold); // gauge not charged

    const { intents } = planBeatBehaviors(prev, next, beats, view);
    expect(intentsFor(intents, 'eidolon')).toHaveLength(0);
  });

  it('reads dischargeThreshold from MODEL_TUNING (config-as-data, NFR-4): a charged-gauge breakthrough WITHOUT a summon tag does NOT summon THUNDORR', async () => {
    // The summon TAG gates the cinematic — a charged-gauge discharge that the interpreter did NOT tag
    // `summon` is just the Layer-0 discharge, no THUNDORR (story Dev Notes "The Summon reads the gauge").
    // Use the REAL fixture overlay (which has no summon) on the real discharge transition: the gauge is
    // charged but there is no summon tag, so no eidolon intents.
    const tl = timeline();
    const view = await overlay(); // FixtureInterpreter: dispel + shaman, NO summon
    const { prev, next, beats } = dischargeTransition(tl);
    expect(prev.insightGauge).toBeGreaterThanOrEqual(MODEL_TUNING.insight.dischargeThreshold);
    expect(next.insightGauge).toBe(0);

    const { intents } = planBeatBehaviors(prev, next, beats, view);
    expect(intentsFor(intents, 'eidolon')).toHaveLength(0);
  });
});

describe('Story 3.3 — planBeatBehaviors is PURE (deterministic, no input mutation) + R1-clean at the data level', () => {
  it('an EMPTY beatsAdvanced (a tick crossing no beat boundary / held frame) emits { intents: [], signals: [] }', async () => {
    const tl = timeline();
    const view = await overlay();
    const prev = foldBattleState(tl, 3);
    // prev.cursor === next.cursor: no beat advanced. The held frame emits nothing.
    const result = planBeatBehaviors(prev, prev, [], view);
    expect(result.intents).toEqual([]);
    expect(result.signals).toEqual([]);
  });

  it('two calls on the same inputs deep-equal (same transition + overlay -> byte-identical intents/signals)', async () => {
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = transitionAt(tl, DISPEL_BEAT_INDEX);
    const first = planBeatBehaviors(prev, next, beats, view);
    const second = planBeatBehaviors(prev, next, beats, view);
    expect(first).toEqual(second);
  });

  it('does NOT mutate prev / next / beatsAdvanced / view (stringify before/after is identical)', async () => {
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = dischargeTransition(tl);
    const before = JSON.stringify([prev, next, beats, view.events, view.annotations]);
    planBeatBehaviors(prev, next, beats, view);
    const after = JSON.stringify([prev, next, beats, view.events, view.annotations]);
    expect(after).toBe(before);
  });

  it('R1 at the data level: NO intent carries a mechanics field (problemIntegrity/resolve/insightGauge/hp/weight/dwellMs) and the plan returns only { intents, signals }', async () => {
    // The structural embodiment of R1: this layer DRAMATIZES Layer-0 deltas but never writes mechanics.
    // Walk every transition in the real timeline, plan it, and assert no emitted intent carries a
    // mechanics key (and the return is never a BattleState). architecture.md#Anti-Patterns L296.
    const MECHANICS_KEYS = ['problemIntegrity', 'resolve', 'insightGauge', 'hp', 'weight', 'dwellMs', 'victory', 'cursor', 'enemies'];
    const tl = timeline();
    const view = await overlay();
    for (let cursor = 0; cursor < tl.beats.length; cursor++) {
      const result = planBeatBehaviors(
        foldBattleState(tl, cursor),
        foldBattleState(tl, cursor + 1),
        tl.beats.slice(cursor, cursor + 1),
        view,
      );
      expect(Object.keys(result).sort()).toEqual(['intents', 'signals']);
      for (const intent of result.intents) {
        for (const mech of MECHANICS_KEYS) {
          expect(Object.prototype.hasOwnProperty.call(intent, mech)).toBe(false);
        }
      }
    }
  });
});
