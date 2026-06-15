import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleState, BattleTimeline, Beat } from '../schema/battle-timeline';
import type { BeatAnnotation } from '../schema/beat-annotation';
import type { AnnotatedView } from '../interpret/overlay';

// RED-PHASE ATDD acceptance tests for Story 4.3 (FR-11) — Always-on signature-beat teaching.
// These FAIL until src/portal/teaching.ts exports the PURE teaching planner `planTeaching` + the
// `TeachingOp` type, and src/portal/teaching-config.ts loads the validated `TEACHING` table (one
// plain-dev one-liner per BeatType) from src/config/teaching.json. The import error (the modules do
// not exist yet) is the intended RED — exactly the posture beat-behavior.test.ts / captions.test.ts
// held in their own red phases.
//
// `portal/teaching.ts` is the PLAIN-DEV sibling of scribe/captions.ts: a PURE module that maps a
// playback TRANSITION (prev/next BattleState + the advanced Beat[]) + the read-only Layer-1 overlay
// (AnnotatedView) to typed teaching ops, with ZERO Phaser (node env, no DOM). It makes NO truth claim
// of its own (R1) — it auto-surfaces a fixed lesson keyed to the signature beat the viewer sees.
//
// What the GATE proves here (per the story's gate-verifiable / operator-verified split):
//   AC1 — the RIGHT plain-dev one-liner auto-surfaces per beat type (dispel/shaman the root-cause /
//         assumption-then-verify / breakthrough-after-struggle lines) on the SAME transition the
//         signature beat fires — no viewer action, no toggle, no open(). Auto-DISMISS is encoded as a
//         finite per-op dwellMs (the render scene arms the wall-clock timer; jsdom advances no tweens).
//   AC2 — accuracy-to-event: each op carries the firing annotation's grounding eventRefs, every ref
//         resolves to a REAL overlay event (no dangling ref), AND at most one op per signature beat
//         per transition (no stacking — SM-C2 brevity). The authored max-length bound is pinned in the
//         unit suite (teaching.unit.test.ts).
//   R1 — planTeaching writes NO mechanics field and returns NO BattleState (data-level proof).
// It CANNOT prove the on-screen placement / legibility / dwell FEEL — jsdom does not advance Phaser
// timers/tweens (the documented arena-animation.test.ts gap). Those are OPERATOR-verified.
//
// Pipeline reuse (copied verbatim from beat-behavior.test.ts L51-83): read the COMMITTED ingest
// fixtures with fs IN THE TEST (tests are not Layer-0 modules, so this respects R2) and run the SAME
// parse -> normalize -> merge -> translate -> pace chain the golden snapshot pins, then fold the
// resulting BattleTimeline to drive REAL transitions through planTeaching — AND run the
// FixtureInterpreter over the same events -> annotations -> applyOverlay -> the read-only view.
import { planTeaching, type TeachingOp } from './teaching';
import { TEACHING } from './teaching-config';
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

// Copied verbatim from beat-behavior.test.ts so teaching maps the EXACT committed BattleTimeline.
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
// shaman @ u-0010#0, NO summon) applied side-by-side to the same events.
async function overlay(): Promise<AnnotatedView> {
  const events = runIngest();
  const annotations = await new FixtureInterpreter().interpret(events);
  return applyOverlay(events, annotations);
}

// ---- transition locators against the committed 10-beat timeline (the L1->L0 bridge) ----
//   Beat[0] scout   ['u-0001','u-0002#1','u-0002#2','u-0003#0'] -> carries the DISPEL anchor u-0002#1
//   Beat[7] scout   ['u-0010#0','u-0011#0']                     -> carries the SHAMAN anchor u-0010#0
//   Beat[9] melee   ['phase-...#result']                        -> the BREAKTHROUGH (last beat; discharge)
// dispel teaching fires on the dispel-tagged Beat[0] transition; shaman teaching fires on the
// breakthrough-DISCHARGE transition (isBreakthroughDischarge + hasShaman) — the death/swarm-clear
// moment AC1's worked example dramatizes — NOT on the shaman beat (Beat[7]) itself.
const DISPEL_BEAT_INDEX = 0;

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
// discharges to 0 — the SAME signal the Shaman death keys on (story Dev Notes #3 "shaman").
function dischargeTransition(tl: BattleTimeline) {
  return transitionAt(tl, tl.beats.length - 1);
}

const teaches = (ops: TeachingOp[], beatType: TeachingOp['beatType']) =>
  ops.filter((o) => o.beatType === beatType);

describe('Story 4.3 AC1 — the RIGHT plain-dev one-liner auto-surfaces per beat type (REAL fixture)', () => {
  it('the DISPEL-tagged beat (Beat[0], anchor u-0002#1) auto-surfaces exactly one teaching op carrying the dispel one-liner', async () => {
    // The L1->L0 bridge: the dispel annotation's anchor u-0002#1 lands in Beat[0]'s sourceEventIds, so
    // teaching fires on the transition crossing Beat[0] — the SAME transition the dispel caption /
    // mirage-shatter cinematic fire on (AC1 "when it fires"). No viewer action drives it — it is the
    // forward tick.
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = transitionAt(tl, DISPEL_BEAT_INDEX);
    expect(beats.some((b) => b.sourceEventIds.includes('u-0002#1'))).toBe(true); // guard the locator

    const ops = planTeaching(prev, next, beats, view);
    const dispelOps = teaches(ops, 'dispel');
    expect(dispelOps).toHaveLength(1);
    // The selected text is the dispel one-liner from the config table — SELECTED, not invented.
    expect(dispelOps[0]!.text).toBe(TEACHING.dispel);
    // No shaman/summon op surfaces on the dispel transition (the gauge is not discharged here).
    expect(teaches(ops, 'shaman')).toHaveLength(0);
    expect(teaches(ops, 'summon')).toHaveLength(0);
  });

  it('the SHAMAN root-cause line auto-surfaces on the breakthrough-discharge transition (the death moment), NOT on the resurrect loop', async () => {
    // AC1's worked example is the Shaman DEATH ("the whole bug class died at once") — the breakthrough
    // discharge (gauge >= dischargeThreshold going in, === 0 out) + a shaman-tagged annotation present.
    // That is the LAST beat (Beat[9]) on the committed fixture, where the lone counter's charge
    // discharges. Reuse MODEL_TUNING.insight.dischargeThreshold (config-as-data, NO hardcode).
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = dischargeTransition(tl);
    // Sanity: this IS the charged-gauge breakthrough discharge.
    expect(prev.insightGauge).toBeGreaterThanOrEqual(MODEL_TUNING.insight.dischargeThreshold);
    expect(next.insightGauge).toBe(0);

    const ops = planTeaching(prev, next, beats, view);
    const shamanOps = teaches(ops, 'shaman');
    expect(shamanOps).toHaveLength(1);
    expect(shamanOps[0]!.text).toBe(TEACHING.shaman);
  });

  it('the shaman line does NOT surface on a pre-breakthrough advancing transition while the root cause is still "alive"', async () => {
    // The resurrect-loop window: the shaman beat (Beat[7]) has been reached and the gauge is still
    // charged (pre-discharge). Teaching keys on the DEATH (breakthrough discharge), not the live loop,
    // so the transition advancing Beat[8] (cursor 8 -> 9, gauge still charged, victory not latched)
    // surfaces NO shaman teaching op — the lesson lands with the felt death moment, not before.
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = transitionAt(tl, 8);
    expect(prev.insightGauge).toBeGreaterThanOrEqual(MODEL_TUNING.insight.dischargeThreshold);
    expect(next.insightGauge).not.toBe(0); // not the discharge transition
    expect(prev.victory).toBe(false);

    expect(teaches(planTeaching(prev, next, beats, view), 'shaman')).toHaveLength(0);
  });
});

describe('Story 4.3 AC2 — accuracy-to-event: every op is grounded in a REAL overlay event (REAL fixture)', () => {
  it('the dispel op carries the firing annotation grounding eventRefs and EVERY ref resolves to a real overlay event (no dangling ref)', async () => {
    // The structural accuracy proof: the op is keyed to a grounded beat, not a fabricated claim. The
    // dispel annotation's groundingPointer.eventRefs are ['u-0002#1','u-0002#2','u-0003#0'] (the
    // assumption + ground-truth Read). Each ref must resolve to a real NormalizedEvent in the overlay.
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = transitionAt(tl, DISPEL_BEAT_INDEX);

    const op = teaches(planTeaching(prev, next, beats, view), 'dispel')[0]!;
    expect(op.groundingRefs.length).toBeGreaterThan(0);
    const realEventIds = new Set(view.events.map((e) => e.eventId));
    for (const ref of op.groundingRefs) {
      expect(realEventIds.has(ref)).toBe(true); // no dangling ref — keyed to a real Layer-0 event
    }
    // The grounding is the dispel annotation's full dramatized set (the accuracy provenance).
    expect([...op.groundingRefs]).toEqual(['u-0002#1', 'u-0002#2', 'u-0003#0']);
  });

  it('the shaman op carries its annotation grounding and every ref resolves to a real overlay event', async () => {
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = dischargeTransition(tl);

    const op = teaches(planTeaching(prev, next, beats, view), 'shaman')[0]!;
    const realEventIds = new Set(view.events.map((e) => e.eventId));
    expect(op.groundingRefs.length).toBeGreaterThan(0);
    for (const ref of op.groundingRefs) {
      expect(realEventIds.has(ref)).toBe(true);
    }
    // The shaman annotation's grounding is the root-cause pair ['u-0009#0','u-0010#0'].
    expect([...op.groundingRefs]).toEqual(['u-0009#0', 'u-0010#0']);
  });

  it('every emitted teaching op across the WHOLE fixture carries a finite positive dwellMs (auto-dismiss is encoded as data)', async () => {
    // Auto-DISMISS proof at the data level: each op carries a finite render-side display duration the
    // scene arms a timer for. jsdom advances no Phaser timer (the dismiss FEEL is operator-verified),
    // but the op must CARRY a finite positive dwell so the scene has a duration to arm.
    const tl = timeline();
    const view = await overlay();
    for (let cursor = 0; cursor < tl.beats.length; cursor++) {
      const ops = planTeaching(
        foldBattleState(tl, cursor),
        foldBattleState(tl, cursor + 1),
        tl.beats.slice(cursor, cursor + 1),
        view,
      );
      for (const op of ops) {
        expect(Number.isFinite(op.dwellMs)).toBe(true);
        expect(op.dwellMs).toBeGreaterThan(0);
      }
    }
  });

  it('at most one teaching op per beat type per transition across the whole fixture (no stacking — SM-C2 brevity)', async () => {
    // SM-C2: teaching must not bury the spectacle. Even if a beat were tagged twice, teaching dedupes
    // by beatType so a single transition surfaces at most one op per signature beat type.
    const tl = timeline();
    const view = await overlay();
    for (let cursor = 0; cursor < tl.beats.length; cursor++) {
      const ops = planTeaching(
        foldBattleState(tl, cursor),
        foldBattleState(tl, cursor + 1),
        tl.beats.slice(cursor, cursor + 1),
        view,
      );
      const counts = new Map<string, number>();
      for (const op of ops) counts.set(op.beatType, (counts.get(op.beatType) ?? 0) + 1);
      for (const n of counts.values()) expect(n).toBeLessThanOrEqual(1);
    }
  });
});

describe('Story 4.3 AC1 — the SUMMON branch (UNIT-proven; the committed fixture omits summon by design)', () => {
  // The committed FixtureInterpreter OMITS `summon` (no sub-agent-spawn event in the thin slice), so
  // the summon teaching branch is UNIT-proven with a HAND-BUILT `summon` annotation spliced onto the
  // breakthrough beat's anchor — exactly how beat-behavior.test.ts L243-300 unit-proves its unreachable
  // summon branch. This is the documented 3.3/3.4 honest gap; it fires end-to-end with no code change
  // once a real summon-tagged annotation ships (Epic 5).

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

  function viewWith(events: NormalizedEvent[], annotation: BeatAnnotation): AnnotatedView {
    return applyOverlay([...events], [annotation]);
  }

  it('a summon-tagged breakthrough auto-surfaces exactly one summon teaching op carrying the breakthrough-after-struggle line', async () => {
    const tl = timeline();
    const events = runIngest();
    const { prev, next, beats } = dischargeTransition(tl);
    const anchor = beats[0]!.sourceEventIds[0]!;
    const view = viewWith(events, summonAnnotation(anchor));
    // Sanity: this IS the charged-gauge breakthrough discharge.
    expect(prev.insightGauge).toBeGreaterThanOrEqual(MODEL_TUNING.insight.dischargeThreshold);
    expect(next.insightGauge).toBe(0);

    const ops = planTeaching(prev, next, beats, view);
    const summonOps = teaches(ops, 'summon');
    expect(summonOps).toHaveLength(1);
    expect(summonOps[0]!.text).toBe(TEACHING.summon);
    expect([...summonOps[0]!.groundingRefs]).toEqual([anchor]);
  });

  it('a summon tag on a NON-breakthrough transition (gauge not charged) auto-surfaces NO summon teaching op', async () => {
    // The summon teaching gate is the charged-gauge breakthrough (same as the cinematic): a summon tag
    // on a plain melee strike with the gauge at 0 must not teach summon.
    const tl = timeline();
    const events = runIngest();
    const { prev, next, beats } = transitionAt(tl, 1);
    const anchor = beats[0]!.sourceEventIds[0]!;
    const view = viewWith(events, summonAnnotation(anchor));
    expect(prev.insightGauge).toBeLessThan(MODEL_TUNING.insight.dischargeThreshold);

    expect(teaches(planTeaching(prev, next, beats, view), 'summon')).toHaveLength(0);
  });
});

describe('Story 4.3 — planTeaching is PURE + R1-clean at the data level (REAL fixture)', () => {
  it('two calls on the same transition + overlay deep-equal (deterministic, no hidden RNG/clock)', async () => {
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = transitionAt(tl, DISPEL_BEAT_INDEX);
    expect(planTeaching(prev, next, beats, view)).toEqual(planTeaching(prev, next, beats, view));
  });

  it('does NOT mutate prev / next / beatsAdvanced / view (stringify before/after is identical)', async () => {
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = dischargeTransition(tl);
    const before = JSON.stringify([prev, next, beats, view.events, view.annotations]);
    planTeaching(prev, next, beats, view);
    const after = JSON.stringify([prev, next, beats, view.events, view.annotations]);
    expect(after).toBe(before);
  });

  it('R1 at the data level: no emitted teaching op carries a mechanics field and planTeaching returns ONLY an array (never a BattleState)', async () => {
    // portal/teaching.ts makes NO mechanics write: planTeaching returns ONLY TeachingOp[] (an array,
    // never a BattleState/Beat), and no op carries a Layer-0 mechanics key. dwellMs is a PRESENTATION
    // duration (like BeatBehaviorIntent.durationMs), NOT a state mutation, so it is allowed on the op
    // and intentionally excluded from the forbidden-key set. groundingRefs is Layer-0 PROVENANCE (the
    // accuracy proof), not a mechanics field. architecture.md#R1 / #Anti-Patterns.
    const MECHANICS_KEYS = ['problemIntegrity', 'resolve', 'insightGauge', 'hp', 'weight', 'victory', 'enemies'];
    const tl = timeline();
    const view = await overlay();
    for (let cursor = 0; cursor < tl.beats.length; cursor++) {
      const ops = planTeaching(
        foldBattleState(tl, cursor),
        foldBattleState(tl, cursor + 1),
        tl.beats.slice(cursor, cursor + 1),
        view,
      );
      expect(Array.isArray(ops)).toBe(true);
      for (const op of ops) {
        for (const mech of MECHANICS_KEYS) {
          expect(Object.prototype.hasOwnProperty.call(op, mech)).toBe(false);
        }
      }
    }
  });
});
