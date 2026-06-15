import type { BattleState, Beat } from '../schema/battle-timeline';
import type { BeatAnnotation, BeatType } from '../schema/beat-annotation';
import type { AnnotatedView } from '../interpret/overlay';
import { MODEL_TUNING } from '../model/model-tuning';
import { TEACHING } from './teaching-config';

// teaching — the PURE always-on teaching planner (FR-11, SM-1), the PLAIN-DEV sibling of
// scribe/captions.ts (the Tolkien voice) one layer over in portal/ (the transparency home). It maps a
// playback TRANSITION (prev/next BattleState + the Beat[] that advanced the cursor) PLUS the read-only
// Layer-1 overlay (AnnotatedView) to teaching OPS: ONE concise plain-dev one-liner per SIGNATURE beat
// firing in the transition, drawn from the templated table (config-as-data). It AUTO-surfaces the
// lesson on the SAME transition the viewer sees the beat — no toggle, no open(), no viewer action; the
// boot pushes the op on the forward tick. ZERO phaser (selection lives here; the on-screen DISPLAY +
// the wall-clock auto-dismiss live in render/phaser/arena-scene.ts). [story Task 2; Dev Notes #1-#5]
//
// WHY THIS MIRRORS beat-behavior.ts, NOT a new detection path (Dev Notes #2): the three signature beats
// are ALREADY detected by planBeatBehaviors via the L1->L0 bridge (a tagged BeatAnnotation.eventRef
// lands in some advanced Beat's sourceEventIds — the pace CONSERVATION invariant — looked up via
// view.byEventRef). planTeaching reuses that EXACT fold but emits a plain-dev one-liner per beatType
// instead of behavior intents. This guarantees teaching coincides with the beat the viewer sees (AC1's
// "when it fires") with zero new triggering machinery, no new beat tag, no new Layer-0 path.
//
// LAYER & PURITY DISCIPLINE (R1, the load-bearing property): teaching is a Layer-1-CONSUMER (reads the
// frozen read-only overlay) + Layer-0-READER (reads BattleState/Beat deltas) that writes NOTHING back
// into mechanics. It imports BattleState/Beat/BeatType/AnnotatedView as TYPES only and reads
// MODEL_TUNING.insight.dischargeThreshold as a config VALUE (the render-model.ts / beat-behavior.ts
// precedent — render/portal reading MODEL_TUNING is allowed). It returns ONLY TeachingOp[]; it NEVER
// constructs/returns a BattleState/Beat and NEVER writes a mechanics field (problemIntegrity / resolve
// / insightGauge / hp / weight). `dwellMs` is a PRESENTATION duration on the op (the same kind of field
// as BeatBehaviorIntent.durationMs), NOT a state mutation. `groundingRefs` is Layer-0 PROVENANCE (the
// accuracy proof), NOT a mechanics field. [architecture.md#R1 L225-228; beat-behavior.ts L16-28]
//
// PURE + deterministic (kept deliberately, even though portal/ is not lint-bound to purity — it stays
// pure to be replay-stable): no Date.now / Math.random / performance.now / IO / module-mutable state;
// the same inputs yield a deep-equal output; mutates NEITHER input.

// TeachingOp — the planner's output. Plain `type`, NOT Zod — TRANSIENT in-memory view state consumed
// within playback, never serialized, never read from an untrusted source (the SAME call CaptionOp /
// BeatBehaviorIntent / AnimationIntent make). It carries NO mechanics field — the R1 data-level proof.
// `groundingRefs` is the firing annotation's groundingPointer.eventRefs (the Layer-0 event(s) the beat
// dramatizes) — the accuracy proof that the line is keyed to a GROUNDED beat, not a fabricated claim.
// `dwellMs` is the render-side display duration the scene arms an auto-dismiss timer for. [story Task 2]
export type TeachingOp = {
  kind: 'teach';
  beatType: BeatType;
  text: string;
  cursor: number;
  dwellMs: number;
  groundingRefs: readonly string[];
};

// Per-beatType auto-dismiss dwell (ms) — render-side presentation timing, NOT battle tuning, so it
// lives here (the beat-behavior.ts / animation-plan.ts const-durations posture; time lives render/
// portal-side, never in the pure Layer-0 model). ~4s reads long enough to absorb a one-liner, short
// enough not to linger (SM-C2); the exact value is operator-tuned (jsdom advances no timers). The same
// value across the three keeps it simple per the story; the map leaves room to retune one independently.
// [story Task 2 "dwellMs"; Dev Notes #4]
const DWELL_MS: Record<BeatType, number> = {
  shaman: 4000,
  dispel: 4000,
  summon: 4000,
};

// annotationsFiringInBeats — the L1->L0 bridge, REUSED verbatim from beat-behavior.ts (Dev Notes #2: do
// NOT reinvent the fold). A BeatAnnotation.eventRef is an eventId; a Beat carries the eventIds it
// collapsed in sourceEventIds (the pace CONSERVATION invariant). So a tagged annotation FIRES on the
// transition where some advanced beat's sourceEventIds contains its anchor eventRef — looked up via
// view.byEventRef. Returns the firing annotations in a stable order (beats in advance order, then the
// annotations byEventRef returns for each matched id). Reads the READ-ONLY overlay only.
function annotationsFiringInBeats(beatsAdvanced: Beat[], view: AnnotatedView): BeatAnnotation[] {
  const firing: BeatAnnotation[] = [];
  for (const beat of beatsAdvanced) {
    for (const eventId of beat.sourceEventIds) {
      const annotations = view.byEventRef.get(eventId);
      if (!annotations) continue;
      for (const annotation of annotations) firing.push(annotation);
    }
  }
  return firing;
}

// isBreakthroughDischarge — the Layer-0 "breakthrough" signal, REUSED verbatim from beat-behavior.ts:
// the Insight Gauge was charged at/above dischargeThreshold going in and discharged to 0 on this
// transition (the decisive integrity strike landing while charged). This is the SAME transition the
// Shaman DEATH ("the whole bug class died at once" — AC1's worked example) and the Summon both key on.
// Reads dischargeThreshold from MODEL_TUNING (config-as-data, NFR-4 — NO hardcode) so a retune flows
// through with no teaching-code change. [Dev Notes #3; beat-behavior.ts L102-104]
function isBreakthroughDischarge(prev: BattleState, next: BattleState): boolean {
  return prev.insightGauge >= MODEL_TUNING.insight.dischargeThreshold && next.insightGauge === 0;
}

// teachOp — build the op for a beatType from its firing annotation, carrying the authored one-liner
// (SELECTED from the table, never invented) + the annotation's full grounding (the accuracy provenance)
// + the per-beatType dwell. Centralizes the construction so every branch emits the identical shape.
function teachOp(beatType: BeatType, cursor: number, annotation: BeatAnnotation): TeachingOp {
  return {
    kind: 'teach',
    beatType,
    text: TEACHING[beatType],
    cursor,
    dwellMs: DWELL_MS[beatType],
    groundingRefs: annotation.groundingPointer.eventRefs,
  };
}

// planTeaching — the PURE entry point, MIRRORING planCaptions / planBeatBehaviors signature exactly (so
// the boot threads it uniformly). Maps a playback TRANSITION + the read-only overlay to TeachingOp[].
// Emits at most ONE op per DISTINCT signature beatType firing in this transition (dedupe by beatType so
// a beat tagged twice does not stack — SM-C2 brevity). An empty beatsAdvanced (a held frame, prev.cursor
// === next.cursor) or a transition with no signature beat firing emits []. PURE + deterministic +
// mutates neither input.
//
// PER-BEATTYPE TRIGGER CONDITIONS (parity with the cinematics/behaviors, so the lesson lands with the
// spectacle — Dev Notes #3, mirroring planBeatBehaviors):
//   dispel — fires when a `dispel`-tagged beat fires in this transition (same condition as the Story 4.1
//            dispel caption / Story 3.3 mirage-shatter / Story 3.5 dispel cinematic). On the committed
//            fixture this is dispel@u-0002#1, fused into Beat[0].
//   shaman — fires on the BREAKTHROUGH DISCHARGE transition (the swarm-clear / death moment — AC1's
//            worked example is the Shaman DEATH), NOT on the resurrect loop: isBreakthroughDischarge AND
//            a `shaman`-tagged annotation present (hasShaman). On the committed fixture this is
//            shaman@u-0010#0, firing on the LAST beat where the lone counter's charge discharges. The
//            shaman line is keyed to the shaman annotation's grounding (the root-cause pair), so it
//            surfaces on the death transition even though the shaman ANCHOR beat (Beat[7]) advanced
//            earlier — the lesson lands on the felt death moment SM-1 tests.
//   summon — fires on a SUMMON-tagged breakthrough (same gate as the Story 3.3 eidolon-summon intent /
//            Story 3.4 cinematic): isBreakthroughDischarge AND a `summon`-tagged annotation firing in
//            this transition. The committed FixtureInterpreter OMITS `summon` by design (the 3.1/3.3
//            thin slice), so this branch is UNIT-proven on hand-built data (the established 3.3/3.4
//            honest-gap precedent), not on the dev fixture. It fires end-to-end with no code change once
//            a real summon-tagged annotation ships (Epic 5).
//
// `prev` participates in selection only via isBreakthroughDischarge (the gauge-going-in read), mirroring
// the (prev, next, beatsAdvanced, view) transition signature so the boot threads it uniformly.
export function planTeaching(
  prev: BattleState,
  next: BattleState,
  beatsAdvanced: Beat[],
  view: AnnotatedView,
): TeachingOp[] {
  const ops: TeachingOp[] = [];

  // No beat advanced -> the held frame. Nothing teaches. (Defensive even though beatsAdvanced is empty
  // exactly when prev.cursor === next.cursor — the boot's held-frame tick passes [].)
  if (beatsAdvanced.length === 0) return ops;

  const firing = annotationsFiringInBeats(beatsAdvanced, view);
  const breakthrough = isBreakthroughDischarge(prev, next);
  // Tracks which signature beatTypes have already emitted this transition (dedupe -> at most one op per
  // beatType, SM-C2). A Set keeps the membership check O(1); insertion order does not matter (the union
  // below appends in a fixed order).
  const taught = new Set<BeatType>();

  // (1) DISPEL — on a dispel-tagged beat firing in this transition. The op carries the dispel
  // annotation's full grounding (assumption events + the ground-truth Read) as the accuracy provenance.
  for (const annotation of firing) {
    if (annotation.beatType !== 'dispel' || taught.has('dispel')) continue;
    ops.push(teachOp('dispel', next.cursor, annotation));
    taught.add('dispel');
  }

  // (2) SHAMAN — on the breakthrough discharge (the death), keyed to the shaman annotation present in
  // the read-only overlay. UNLIKE dispel, the shaman teaching does NOT key on the shaman beat FIRING in
  // this transition (that beat — the root cause appearing — advanced earlier); it keys on the death
  // (isBreakthroughDischarge + a shaman annotation in the overlay), so the lesson lands on "the whole
  // bug class died at once". The grounding comes from the shaman annotation (the root-cause events it
  // dramatizes), found in the overlay. [Dev Notes #3 "shaman"]
  if (breakthrough && !taught.has('shaman')) {
    const shamanAnnotation = view.annotations.find((a) => a.beatType === 'shaman');
    if (shamanAnnotation) {
      ops.push(teachOp('shaman', next.cursor, shamanAnnotation));
      taught.add('shaman');
    }
  }

  // (3) SUMMON — on a summon-tagged breakthrough (the gauge discharged AND a summon annotation firing in
  // THIS transition). The summon TAG gates the lesson (a charged-gauge discharge the interpreter did NOT
  // tag `summon` is just the Layer-0 discharge — that is the Shaman death, handled above). UNIT-proven
  // only (the fixture omits summon by design — the documented 3.3/3.4 honest gap).
  if (breakthrough) {
    for (const annotation of firing) {
      if (annotation.beatType !== 'summon' || taught.has('summon')) continue;
      ops.push(teachOp('summon', next.cursor, annotation));
      taught.add('summon');
    }
  }

  return ops;
}
