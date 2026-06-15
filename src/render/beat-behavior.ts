import type { BattleState, Beat } from '../schema/battle-timeline';
import type { BeatAnnotation, BeatType } from '../schema/beat-annotation';
import type { AnnotatedView } from '../interpret/overlay';
import type { BeatSignal } from '../interpret/beat-signal';
import { scribeCorrection } from '../interpret/beat-signal';
import { MODEL_TUNING } from '../model/model-tuning';

// beat-behavior — the PURE beat-behavior plan (FR-4), sibling to animation-plan.ts. It maps a
// playback TRANSITION (prev/next BattleState + the Beat[] that advanced the cursor) PLUS the
// read-only Layer-1 overlay (AnnotatedView) to behavior INTENTS (for the render scene) + cross-layer
// SIGNALS (for scribe/portal, FR-9). This is where the three signature beats DRIVE their battle
// behaviors — Fallen Shaman, Dispel, Eidolon Summon — expressed as plain data with ZERO phaser,
// unit-testable in node. The thin Phaser consumer (playBeatBehaviors) runs placeholder tweens; the
// polished cinematics are Stories 3.4/3.5. [story Task 2; Dev Notes "RECOMMENDED SHAPE"]
//
// PURE + R1-clean (the load-bearing property): no Date.now / Math.random / performance.now / IO /
// module-mutable state; deterministic (same inputs -> deep-equal output); mutates NEITHER input. It
// READS Layer-0 truth (next/prev.insightGauge — already computed by battle-model.ts) + Beat data
// (sourceEventIds) + the read-only overlay, and returns ONLY { intents, signals }. It NEVER returns
// or constructs a BattleState, NEVER writes a mechanics field (problemIntegrity/resolve/insightGauge/
// hp/weight/dwellMs), and imports BattleState/Beat as TYPES only — it imports NO Layer-0 mechanics
// value it could mutate. The bars ALREADY moved from Layer-0; this layer only DRAMATIZES them. This
// is the structural embodiment of R1 for this story. [architecture.md#R1 L225-228, #Anti-Patterns
// L296; src/render/animation-plan.ts L13-19]
//
// render/ importing interpret/ is ALLOWED: R1 forbids only Layer-0 dirs (ingest/translate/pace/model)
// importing interpret/; render/ is not a Layer-0 dir (eslint.config.ts L64-90). render -> model
// (MODEL_TUNING) is likewise allowed (render-model.ts L57-65 already reads it).

// The thing a behavior intent targets. The signature-beat cast: the Fallen Shaman + its symptom-imps,
// the Dispel's Mirage + the Hero (Forgemaiden) who recoils, the summoned Eidolon (THUNDORR), and the
// Boss. String-literal union (project convention — NO numeric enum); more targets arrive additively.
export type BeatBehaviorTarget = 'imp' | 'shaman' | 'mirage' | 'forgemaiden' | 'eidolon' | 'boss';

// The named behaviors v0.1 fires. String-literal union (NO numeric enum). The Shaman (resurrect loop /
// one-wave swarm-clear / defeat), the Dispel (mirage shatter / the Hero's resolve-stagger recoil cue /
// the real-situation reveal), and the Summon (eidolon summon / its decisive blow).
export type BeatBehaviorName =
  | 'resurrect'
  | 'swarm-clear'
  | 'defeat'
  | 'shatter'
  | 'resolve-stagger'
  | 'reveal'
  | 'summon'
  | 'decisive-blow';

// A single behavior intent: WHAT to dramatize (target) + HOW (behavior) + FOR HOW LONG (durationMs).
// Plain `type`, NOT Zod — TRANSIENT in-memory view state (consumed within playback, never serialized,
// never read from an untrusted source), the same call AnimationIntent makes. It carries NO mechanics
// field (no resolve/hp/gauge) — that is the R1 data-level proof. [story Dev Notes "Intent + signal
// shapes"; src/render/animation-plan.ts L50-65]
export type BeatBehaviorIntent = {
  target: BeatBehaviorTarget;
  behavior: BeatBehaviorName;
  durationMs: number;
};

// Presentation timings (ms) — render-side, not battle tuning, so they live here (the animation-plan.ts
// const-durations precedent). Plausible placeholder values; the polished cinematics retime in 3.4/3.5.
const RESURRECT_MS = 400;
const SWARM_CLEAR_MS = 600;
const DEFEAT_MS = 600;
const SHATTER_MS = 360;
const RESOLVE_STAGGER_MS = 320;
const REVEAL_MS = 400;
const SUMMON_MS = 800;
const DECISIVE_BLOW_MS = 600;

// annotationsFiringInBeats — the L1->L0 bridge. A BeatAnnotation.eventRef is an eventId; a Beat carries
// the eventIds it collapsed in sourceEventIds (the pace CONSERVATION invariant: every eventId lands in
// exactly one beat). So a tagged annotation FIRES on the transition where some advanced beat's
// sourceEventIds contains its anchor eventRef — looked up via view.byEventRef (eventId -> annotations).
// Content-addressed off the READ-ONLY overlay: reads no HP, writes nothing. Returns the (beat,
// annotation) pairs firing in this transition, in a stable order (beats in advance order, then the
// annotations byEventRef returns for each matched id). [story Task 2 "The L1->L0 bridge";
// src/pace/pace.test.ts L135-146 (CONSERVATION); src/interpret/overlay.ts L23-32 (byEventRef)]
function annotationsFiringInBeats(
  beatsAdvanced: Beat[],
  view: AnnotatedView,
): { beat: Beat; annotation: BeatAnnotation }[] {
  const firing: { beat: Beat; annotation: BeatAnnotation }[] = [];
  for (const beat of beatsAdvanced) {
    for (const eventId of beat.sourceEventIds) {
      const annotations = view.byEventRef.get(eventId);
      if (!annotations) continue;
      for (const annotation of annotations) {
        firing.push({ beat, annotation });
      }
    }
  }
  return firing;
}

// isBreakthroughDischarge — the Layer-0 "breakthrough" signal, derivable PURELY from the two snapshots:
// the Insight Gauge was charged at/above dischargeThreshold going in and discharged to 0 on this
// transition (the decisive integrity strike landing while charged — battle-model.ts L77-90). This is
// the SAME transition the Shaman's one-wave-clear and the Summon both key on ("the fix landed"). Reads
// dischargeThreshold from MODEL_TUNING (config-as-data, NFR-4 — NO hardcoded 50) so a retune flows
// through with no behavior-code change. [story Dev Notes "Shaman live/defeated model", "The Summon
// reads the gauge"; src/render/render-model.ts L57-65 (the MODEL_TUNING read precedent in render/)]
function isBreakthroughDischarge(prev: BattleState, next: BattleState): boolean {
  return prev.insightGauge >= MODEL_TUNING.insight.dischargeThreshold && next.insightGauge === 0;
}

// anchorReached — has playback CROSSED a beatType-tagged annotation's anchor event by this transition?
// The Dev Notes "Shaman live/defeated model" (L132) require the resurrect loop to fire "while the Shaman
// beat has been REACHED" — a true anchor-crossing check, NOT the gauge proxy (F1 fix). Pure: an
// annotation's anchor eventRef is an eventId and view.events is the full ordered list consumed in that
// order (the pace CONSERVATION invariant), so the anchor is reached iff its index <= the FRONTIER event
// index (the last source event of the last advanced beat — the event reached as of next.cursor).
function anchorReached(view: AnnotatedView, beatsAdvanced: Beat[], beatType: BeatType): boolean {
  const tagged = view.annotations.find((a) => a.beatType === beatType);
  if (!tagged) return false;
  const anchorIndex = view.events.findIndex((e) => e.eventId === tagged.eventRef);
  if (anchorIndex === -1) return false;
  const lastBeat = beatsAdvanced[beatsAdvanced.length - 1];
  if (!lastBeat || lastBeat.sourceEventIds.length === 0) return false;
  const frontierId = lastBeat.sourceEventIds[lastBeat.sourceEventIds.length - 1];
  const frontierIndex = view.events.findIndex((e) => e.eventId === frontierId);
  return frontierIndex !== -1 && anchorIndex <= frontierIndex;
}

// planBeatBehaviors — the PURE entry point. Maps a playback TRANSITION + the read-only overlay to
// { intents, signals }. An empty beatsAdvanced (a tick crossing no beat boundary, prev.cursor ===
// next.cursor) or a transition with no relevant beat emits { intents: [], signals: [] } (the held
// frame — no behavior). PURE + deterministic + mutates neither input.
//
// EMISSION ORDER (stable + documented — the determinism the tests pin): (1) Shaman intents (resurrect
// while live, OR swarm-clear + defeat on the breakthrough), then (2) Dispel intents (shatter ->
// resolve-stagger -> reveal) + the scribe-correction signal, then (3) Summon intents (summon ->
// decisive-blow). The same (transition, overlay) always yields a byte-identical result.
export function planBeatBehaviors(
  prev: BattleState,
  next: BattleState,
  beatsAdvanced: Beat[],
  view: AnnotatedView,
): { intents: BeatBehaviorIntent[]; signals: BeatSignal[] } {
  const intents: BeatBehaviorIntent[] = [];
  const signals: BeatSignal[] = [];

  // No beat advanced -> the held frame. Nothing dramatizes. (Defensive even though beatsAdvanced is
  // empty exactly when prev.cursor === next.cursor.)
  if (beatsAdvanced.length === 0) {
    return { intents, signals };
  }

  const firing = annotationsFiringInBeats(beatsAdvanced, view);
  const breakthrough = isBreakthroughDischarge(prev, next);
  // Does this session even HAVE a Shaman? (the dev/CI FixtureInterpreter tags one; a session without
  // one fires no Shaman behavior). Derived purely from the read-only overlay.
  const hasShaman = view.annotations.some((a) => a.beatType === 'shaman');

  // (1) BEHAVIOR 1 — Fallen Shaman (AC1). The Shaman dramatizes the ROOT CAUSE; the imps are the
  // recurring symptoms. The root cause is "alive" from when the Shaman beat is REACHED until the
  // breakthrough lands (the charged gauge discharging = "the fix landed" — Story 4.3's "the whole bug
  // class died at once"). The live window therefore requires TWO purely-derived conditions: the Shaman
  // anchor has been crossed (anchorReached — F1: a true anchor-crossing check, not a gauge proxy, so a
  // session whose gauge charges BEFORE a later shaman beat does not fire resurrect prematurely) AND the
  // gauge is still charged (pre-discharge). Imps are PRESENTATION-ONLY (no per-minion HP in
  // BattleState) — the plan emits a resurrect / swarm-clear INTENT, never an imp count. [story Dev
  // Notes "Shaman live/defeated model" L132]
  if (hasShaman) {
    if (breakthrough) {
      // The fix landed: all imps die in ONE wave and the Shaman (root cause) falls.
      intents.push({ target: 'imp', behavior: 'swarm-clear', durationMs: SWARM_CLEAR_MS });
      intents.push({ target: 'shaman', behavior: 'defeat', durationMs: DEFEAT_MS });
    } else if (
      anchorReached(view, beatsAdvanced, 'shaman') &&
      prev.insightGauge >= MODEL_TUNING.insight.dischargeThreshold
    ) {
      // Still live (Shaman beat reached, charged, pre-breakthrough): defeated symptom-imps visibly
      // resurrect (a loop). The loop count/identity is a render concern, not modeled here.
      intents.push({ target: 'imp', behavior: 'resurrect', durationMs: RESURRECT_MS });
    }
  }

  // (2) BEHAVIOR 2 — Dispel (AC2). On a dispel-tagged beat firing in this transition: the Mirage
  // shatters, the Hero takes a self-inflicted resolve-stagger PRESENTATION cue (the visual recoil —
  // NOT a Resolve mutation; the actual wasted-effort Resolve change already lives in the Layer-0
  // stream, R1), the real situation is revealed, AND a scribe-correction SIGNAL is emitted (the KEY
  // cross-layer output FR-9 consumes to cross out a prior caption). The signal carries the Dispel's
  // FULL groundingPointer + the firing cursor so the Scribe can locate the caption. We do NOT compute
  // or return any Resolve delta. [story Dev Notes "the Dispel's Resolve stagger is a CUE"; AC2]
  for (const { annotation } of firing) {
    if (annotation.beatType !== 'dispel') continue;
    intents.push({ target: 'mirage', behavior: 'shatter', durationMs: SHATTER_MS });
    intents.push({ target: 'forgemaiden', behavior: 'resolve-stagger', durationMs: RESOLVE_STAGGER_MS });
    intents.push({ target: 'mirage', behavior: 'reveal', durationMs: REVEAL_MS });
    signals.push(scribeCorrection(next.cursor, annotation.groundingPointer));
  }

  // (3) BEHAVIOR 3 — Eidolon Summon / THUNDORR (AC3). Fires only when a summon-tagged breakthrough
  // beat fires in THIS transition AND the Layer-0 Insight Gauge is charged at the breakthrough (the
  // discharge transition). The summon TAG gates the cinematic (a charged-gauge discharge the
  // interpreter did NOT tag `summon` is just the Layer-0 discharge, no THUNDORR); the gauge condition
  // is READ from Layer-0 (the gauge was charged BY Layer-0 on the struggle — this layer only reads it
  // and dramatizes the blow). The actual Problem-Integrity damage is the Layer-0 strike. [story Dev
  // Notes "The Summon reads the gauge; it does NOT charge it"; AC3]
  if (breakthrough) {
    const summonFires = firing.some(({ annotation }) => annotation.beatType === 'summon');
    if (summonFires) {
      intents.push({ target: 'eidolon', behavior: 'summon', durationMs: SUMMON_MS });
      intents.push({ target: 'eidolon', behavior: 'decisive-blow', durationMs: DECISIVE_BLOW_MS });
    }
  }

  return { intents, signals };
}
