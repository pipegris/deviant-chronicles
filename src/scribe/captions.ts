import type { ActionType } from '../schema/normalized-event';
import type { BattleState, Beat } from '../schema/battle-timeline';
import type { BeatType } from '../schema/beat-annotation';
import type { AnnotatedView } from '../interpret/overlay';
import type { BeatSignal } from '../interpret/beat-signal';
import { CAPTIONS, type CaptionFamily } from './captions-config';

// captions — the PURE Layer-2 (Told) caption planner (FR-9), the sibling of render/animation-plan.ts
// and render/beat-behavior.ts. It maps a playback TRANSITION (prev/next BattleState + the Beat[] that
// advanced the cursor) PLUS the read-only Layer-1 overlay (AnnotatedView) to typed caption OPS: an
// `emit` per significant Battle Action (drawn from the templated table, config-as-data) and, on the
// Story-3.3 scribe-correction signal, a `correct` op that crosses out + rewrites a PRIOR caption (the
// honesty beat). ZERO phaser (selection lives in Layer 2; the on-screen DISPLAY lives in render/).
//
// LAYER-2 DISCIPLINE (R1, the load-bearing property): scribe/ makes NO truth claim of its own — it
// narrates Layer-1's frozen structure. It READS only the frozen read-only overlay (AnnotatedView) +
// Layer-0 Beat data (actionType / sourceEventIds) and returns ONLY CaptionOp[]. It NEVER constructs
// or returns a BattleState/Beat, NEVER writes a mechanics field (problemIntegrity/resolve/insightGauge
// /hp/weight/dwellMs), and imports BattleState/Beat as TYPES only. Layer-0 must not import scribe/ (a
// documented discipline — eslint has no scribe/ zone). [architecture.md#R1 L225-228, #"Layer 2" L36-38]
//
// PURE + deterministic (kept deliberately, the beat-behavior.ts posture): no Date.now / Math.random /
// performance.now / IO / module-mutable state; the same inputs yield a deep-equal output; mutates
// NEITHER input. Variant rotation is a function of POSITION (Option B — see "Deterministic rotation"),
// never RNG, so a replay is byte-stable. [architecture.md#"Determinism is thus scoped" L39-42]

// CaptionOp — the scribe's output, a discriminated union (string-literal `kind`, NO numeric enum).
// Plain `type`, NOT Zod — TRANSIENT in-memory view state consumed within playback, never serialized,
// never read from an untrusted source (the SAME call AnimationIntent / BeatBehaviorIntent / BeatSignal
// make). It carries NO mechanics field — the R1 data-level proof. [story Dev Notes "RECOMMENDED SHAPE"]
//
// `emit` carries `groundingRefs` (the firing beat's sourceEventIds = the Layer-0 events this caption
// dramatizes) so the Dispel correction can find the prior caption by INTERSECTING the signal's
// grounding with it (story Dev Notes "Caption id & correction targeting": "the emit op whose firing
// beat's sourceEventIds intersect the assumption portion of the grounding"). groundingRefs is Layer-0
// PROVENANCE (the same kind of data GroundingPointer carries), NOT a mechanics field — the only R1
// data-level rule is "no mechanics write," which this respects (no HP/weight/resolve/gauge). It is the
// minimal, principled extension of the story's emit sketch needed to make AC2's targeting resolvable
// from the op history alone (the handler is handed the emit history, not the beats).
export type CaptionOp =
  | {
      kind: 'emit';
      captionId: string;
      actionType: ActionType;
      text: string;
      cursor: number;
      groundingRefs: readonly string[];
    }
  | {
      kind: 'correct';
      targetCaptionId: string;
      struckText: string;
      newText: string;
      cursor: number;
    };

// The signature-beat annotation families that OVERRIDE the bare actionType (the L1->L0 bridge). When a
// beat carries one of these in the overlay, the signature template family WINS over the actionType
// family (a dispel-tagged `scout` beat is captioned from `dispel`, not `scout`). Every BeatType is a
// CaptionFamily key, so the override target always exists in the validated table.
const SIGNATURE_FAMILIES: readonly BeatType[] = ['dispel', 'shaman', 'summon'];

// captionFamilyForBeat — the family this beat is captioned from, or null when it is NOT captionable.
// `idle` (the fail-closed neutral "no rule matched" beat) yields null: captioning it would be narrating
// nothing (SM-C2 — do not bury the action). A signature-beat annotation firing on the beat overrides
// the bare actionType. PURE: reads only the read-only overlay (byEventRef) + the Beat's own ids.
function captionFamilyForBeat(beat: Beat, view: AnnotatedView): CaptionFamily | null {
  for (const eventId of beat.sourceEventIds) {
    const annotations = view.byEventRef.get(eventId);
    if (!annotations) continue;
    for (const annotation of annotations) {
      if (SIGNATURE_FAMILIES.includes(annotation.beatType)) return annotation.beatType;
    }
  }
  if (beat.actionType === 'idle') return null;
  return beat.actionType;
}

// Deterministic rotation WITHOUT a hidden counter (AC1; story Dev Notes "Deterministic rotation without
// a hidden counter", Option B). The selector is per-transition + PURE, so it cannot hold a mutable
// "times I've said melee" counter. The occurrence index is therefore derived from POSITION: the firing
// beat's anchor (its first sourceEventId) indexed into the ordered view.events list (the pace
// CONSERVATION invariant gives every eventId exactly one position). Fully positional => trivially
// replay-stable (no history threading, no RNG).
//
// SCOPE OF THE "repeats don't read identically" GUARANTEE — ADJACENCY-ONLY, not per-family (review F3):
// the index is the ABSOLUTE event position, not a per-family count. Two same-family beats whose anchors
// sit at adjacent event indices map to CONSECUTIVE integers, which are never congruent mod N (N >= 2),
// so back-to-back repeats land on different variants — the AC1 case (the fixture's melee Beats 1-4 ->
// indices 4..7 -> 4 distinct variants). But a same-family pair separated by a MULTI-EVENT beat is shifted
// by >1, so it CAN collide: the fixture's breakthrough melee Beat[9] (anchor index 13 -> mod4=1) reads
// byte-identical to Beat[2] (index 5 -> mod4=1). That is NON-ADJACENT (8 beats apart), so AC1 ("repeats
// don't read IDENTICALLY" = consecutive repeats differ) is not violated, but it is NOT a per-family
// guarantee. A true per-family counter would need Dev Notes Option A (thread the prior-emit count from
// the boot history) — incompatible with the committed ATDD harness, which threads no history into the
// selector — so it is intentionally deferred; the unit suite pins this non-adjacent collision as KNOWN
// behavior. A beat whose anchor is absent from view.events (a hand-built overlay with no events) falls
// back to index 0 — a stable default; such a transition only captions one beat per family, so it is moot.
function occurrenceIndex(beat: Beat, view: AnnotatedView): number {
  const anchor = beat.sourceEventIds[0];
  if (anchor === undefined) return 0;
  const idx = view.events.findIndex((e) => e.eventId === anchor);
  return idx === -1 ? 0 : idx;
}

// selectVariant — the pure variant pick: variants[occurrenceIndex % variants.length]. The table
// guarantees >=1 variant per family (schema .min(1)); the authored table supplies >=2 so the rotation
// actually varies. A non-positive length is impossible past the schema, but the modulo is guarded by
// the schema floor, so this never divides by zero.
function selectVariant(family: CaptionFamily, index: number): string {
  const variants = CAPTIONS[family];
  return variants[index % variants.length]!;
}

// planCaptions — the PURE entry point (mirrors planAnimations / planBeatBehaviors). Maps a playback
// TRANSITION + the read-only overlay to the `emit` CaptionOp[]. One emit per CAPTIONABLE advanced beat
// (idle skipped), in advance order. An empty beatsAdvanced (a held frame, prev.cursor === next.cursor)
// emits []. The SM-C2 throttle is INHERITED: the Pacer already collapsed trivial bursts into single
// Beats, so "one caption per advanced captionable beat" already means "one caption per SIGNIFICANT
// unit" (a Hammer-Flurry is ONE beat -> ONE caption, not one per collapsed edit). The Dispel CORRECTION
// is NOT emitted here — it rides the signal path (planCaptionCorrection); this path only EMITS.
// PURE + deterministic + mutates neither input. [story Task 2; Dev Notes "SM-C2", "RECOMMENDED SHAPE"]
//
// `prev` is unused by the current selection logic (the family + rotation derive from the beat + overlay
// + next.cursor), but is kept in the signature to MIRROR animation-plan.ts / beat-behavior.ts exactly
// (the same (prev, next, beatsAdvanced, view) transition shape) so the boot threads it uniformly and a
// future selection rule that reads a prev->next delta needs no signature change. [story Dev Notes "RECOMMENDED SHAPE"]
export function planCaptions(
  prev: BattleState,
  next: BattleState,
  beatsAdvanced: Beat[],
  view: AnnotatedView,
): CaptionOp[] {
  void prev; // kept for the mirrored transition signature; the selector reads next.cursor + the beat/overlay
  const ops: CaptionOp[] = [];
  for (const beat of beatsAdvanced) {
    const family = captionFamilyForBeat(beat, view);
    if (family === null) continue; // idle / non-captionable -> no emit (SM-C2)
    const index = occurrenceIndex(beat, view);
    const anchor = beat.sourceEventIds[0] ?? 'na';
    ops.push({
      kind: 'emit',
      // captionId: human-readable + replay-stable. `${firstSourceEventId}#${occurrenceIndex}` per the
      // story's recommended scheme; unique by the pace CONSERVATION invariant (each eventId lands in
      // exactly one beat) + the positional index. The correction resolves its target via groundingRefs,
      // not by parsing this id. [story Dev Notes "Caption id & correction targeting"]
      captionId: `${anchor}#${index}`,
      actionType: beat.actionType,
      text: selectVariant(family, index),
      cursor: next.cursor,
      groundingRefs: beat.sourceEventIds,
    });
  }
  return ops;
}

// planCaptionCorrection — the PURE Dispel self-correction handler (AC2, the honesty beat). Given the
// Story-3.3 scribe-correction BeatSignal (carrying the Dispel's firing cursor + its full grounding =
// the assumption events + the ground-truth Read) and the running EMIT history, it produces the
// `correct` op that crosses out + rewrites the PRIOR caption that NARRATED the assumption — or null
// when no prior caption matches (nothing to cross out; the handler never fabricates a target).
//
// TARGETING RULE (deterministic, grounding-driven — NOT mere recency): among the emits fired by the
// Dispel's cursor (cursor <= signal.cursor; the assumption caption and the Dispel share the firing
// transition on the committed fixture, so the bound is inclusive), pick the MOST RECENT (last in history
// order) whose groundingRefs intersect the ASSUMPTION PORTION of the signal's grounding. The `newText`
// is a `dispel`-family rewrite chosen to DIFFER from the struck text (a REWRITE, not an echo); the
// handler is PURE (reads only the signal + emit history; no BattleState/Beat, no mechanics write).
//
// WHY THE ASSUMPTION PORTION, NOT THE FULL GROUNDING (review F2): a Dispel's grounding is ORDERED
// "[...assumption events, ground-truth Read]" — the trailing ref is the ground-truth Read (epics.md
// L383, prd.md L145). The caption to cross out narrated the ASSUMPTION, never the Read (the Read is when
// the Mirage breaks, not the mistaken line). Matching the FULL grounding would also catch an emit that
// dramatized ONLY the Read — on a richer session with a SEPARATE later ground-truth-Read caption, that
// later emit would be struck instead of the assumption. So we intersect against the grounding MINUS its
// trailing Read ref. Beat[0] (fused, groundingRefs incl u-0002#1/#2) still intersects the assumption
// portion {u-0002#1,u-0002#2}, so the gate stays green and the mis-target is removed.
//
// FIXTURE-SHAPE LIMITATION (review F1, deferred to the rich-fixture story): the thin FixtureInterpreter
// FUSES the assumption events AND the ground-truth Read into one dispel-tagged Beat[0], so the only
// prior caption is itself a `dispel` line — the cross-out rewrites a (correct) dispel line with a
// synonym, not a mistaken assumption with a correction. A richer real session (Story 10.1 — a separate
// assumption beat narrated from its bare actionType) gives a distinct non-dispel caption to strike, and
// the assumption-portion intersection above resolves it. Narrative correctness on the rich fixture needs
// the interpreter/fixture (Epic 5), out of Story 4.1's "consume the seam" scope; the gate-verifiable
// correction LOGIC (right prior id, struck+rewrite text, firing cursor) is proven here.
export function planCaptionCorrection(
  signal: BeatSignal,
  history: ReadonlyArray<Extract<CaptionOp, { kind: 'emit' }>>,
): Extract<CaptionOp, { kind: 'correct' }> | null {
  // The assumption portion = the grounding MINUS its trailing ground-truth-Read ref (the Dispel's
  // grounding is "[...assumption events, ground-truth Read]"). A single-ref grounding (degenerate — no
  // distinct assumption) falls back to the whole set so a malformed/atomic Dispel still resolves rather
  // than silently matching nothing. [review F2; Dev Notes "the events BEFORE the ground-truth Read"]
  const refs = signal.grounding.eventRefs;
  const assumptionRefs = new Set(refs.length > 1 ? refs.slice(0, -1) : refs);
  let target: Extract<CaptionOp, { kind: 'emit' }> | null = null;
  for (const op of history) {
    if (op.cursor > signal.cursor) continue; // not yet fired by the Dispel's cursor
    if (op.groundingRefs.some((ref) => assumptionRefs.has(ref))) {
      target = op; // keep the latest assumption-grounding-matching emit (most recent wins)
    }
  }
  if (target === null) return null;

  const struckText = target.text;
  // The rewrite is a `dispel`-family variant that DIFFERS from the struck text. Pick deterministically
  // by the target's own occurrence index (parsed back off its captionId) so the same fold yields the
  // same rewrite; if that lands on the struck text (possible only if the struck caption itself came
  // from the dispel family), step to the next variant. The table has >=2 dispel variants, so a
  // distinct one always exists.
  const dispelVariants = CAPTIONS.dispel;
  const seed = parseOccurrenceIndex(target.captionId);
  let newText = dispelVariants[seed % dispelVariants.length]!;
  if (newText === struckText) {
    newText = dispelVariants[(seed + 1) % dispelVariants.length]!;
  }

  return {
    kind: 'correct',
    targetCaptionId: target.captionId,
    struckText,
    newText,
    // Ride the Dispel's firing cursor so the render layer lands the cross-out on the SAME transition as
    // the shatter cinematic's record-scratch (Story 3.5 dispel-cinematic `scratch` phase). [story Task 3]
    cursor: signal.cursor,
  };
}

// Parse the occurrence index back off a captionId (`${anchor}#${index}`) — the trailing integer after
// the final '#'. Used only to seed the rewrite-variant pick deterministically. Anchors can themselves
// contain '#' (e.g. `u-0002#1`), so we read the LAST '#'-segment. Falls back to 0 on a malformed id.
function parseOccurrenceIndex(captionId: string): number {
  const tail = captionId.slice(captionId.lastIndexOf('#') + 1);
  const n = Number.parseInt(tail, 10);
  return Number.isFinite(n) ? n : 0;
}
