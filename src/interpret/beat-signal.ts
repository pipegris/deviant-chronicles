import type { BeatType, GroundingPointer } from '../schema/beat-annotation';

// beat-signal — the cross-layer SIGNAL type the Layer-1 beat layer emits for OTHER layers
// (scribe/portal) to consume. A BeatSignal is interpretation-provenance data ("a tagged beat
// fired + its grounding"), so it lives in interpret/ (Layer 1), NOT render/: BOTH the render
// behavior plan (which EMITS it) AND scribe/captions.ts (Story 4.1, which CONSUMES it) reference
// it, and interpret/ is documented as "consumed by scribe/ + portal/ + the render overlay, never
// by Layer 0" (architecture L386). Homing it in render/ and having scribe/ import it would invert
// R5's "nothing depends on render/" principle — a discipline beyond lint (R5's lint only forbids
// the phaser PACKAGE outside render/+game/), which is exactly why the boundary is decided here.
// [story Dev Notes "Where the signal type lives"; architecture.md#R5 L239-241, #Architectural
// Boundaries L386]
//
// Plain `type` (NOT Zod): it is TRANSIENT in-memory view state — consumed within playback, never
// serialized nor read from an untrusted source — the same call AnimationIntent / PlaybackState make.

// The discriminated union of beat-fired cross-layer signals. v0.1 authors EXACTLY the one variant
// an AC requires (AC2's "a Scribe-correction signal is emitted (consumed by FR-9)"). The `kind`
// discriminant keeps the union OPEN so future beat-fired signals append with no consumer break —
// but no AC consumes a shaman/summon signal in v0.1 (those are INTENTS, not cross-layer signals),
// so none is speculatively added (simplicity-first). [story Task 1; CLAUDE.md "Minimum code that
// solves the stated problem. Nothing speculative."]
export type BeatSignal = {
  kind: 'scribe-correction';
  // Narrowed to the literal 'dispel' (a subtype of BeatType): the scribe-correction signal is
  // emitted only by a Dispel. Sourced from BeatType so the relationship to the beat tag is explicit.
  beatType: Extract<BeatType, 'dispel'>;
  // The playback cursor at which the Dispel fired — Story 4.1 (FR-9) uses it to locate the prior
  // caption to cross out.
  cursor: number;
  // The Dispel's full grounding set (the assumption Event + its ground-truth Read) — FR-9 crosses
  // out + rewrites the caption these events dramatize.
  grounding: GroundingPointer;
};

// scribeCorrection — the tiny constructor for the Dispel's self-correction signal (AC2). Annotating
// the call site's result `BeatSignal` is the producer-side type proof that the authored shape matches
// the FR-9 contract. Pure: no clock/RNG/IO. [story Task 1 "pure types + maybe a tiny constructor"]
export function scribeCorrection(cursor: number, grounding: GroundingPointer): BeatSignal {
  return { kind: 'scribe-correction', beatType: 'dispel', cursor, grounding };
}
