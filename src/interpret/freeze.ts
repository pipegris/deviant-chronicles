import { createHash } from 'node:crypto';
import type { NormalizedEvent } from '../schema/normalized-event';
import { BeatAnnotationSchema, type BeatAnnotation } from '../schema/beat-annotation';

// Story 3.2 / AC2 — the PURE freeze + content-address core of the Layer-1 interpretation.
//
// This is the SDK-FREE, browser-cleanable determinism core: only `node:crypto` and the
// schema contract are imported (claude-interpreter.ts + scripts/ are the only SDK-touching
// modules). It is PURE — no clock, no RNG, no network — so the content address is stable.
// [architecture.md#Data Architecture L170-172; #Format Patterns L264-266; R4 L236-238]

/**
 * Deterministic JSON serialization with recursively-sorted object keys, so a sha256 over
 * the output is stable regardless of property INSERTION order. Arrays preserve their order
 * (order is meaningful for events/annotations); only object keys are sorted.
 *
 * PURE: no clock/RNG/IO. This is the canonical-JSON serializer the architecture mandates
 * ("SHA-256 over canonical JSON (stable key order)"). The repo has no existing helper.
 *
 * Inputs MUST be JSON-safe (no `undefined`). On the Zod-validated path this always holds
 * (schemas use `.nullable()` — explicit null, never undefined). To keep the content address
 * trustworthy for any future non-Zod caller, `undefined` fails LOUD here (F4) rather than
 * silently collapsing to absent (object) / `null` (array) — a content-address footgun.
 */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

// Recursively rebuild the value with object keys sorted; arrays keep order. Returns a
// structure JSON.stringify serializes deterministically. Primitives pass through unchanged.
function canonicalize(value: unknown): unknown {
  // Fail loud on undefined: JSON.stringify would otherwise drop it (object) or coerce it to
  // null (array), so two structurally-different inputs could hash identically. [F4]
  if (value === undefined) {
    throw new Error('canonicalJSON: encountered `undefined` (inputs must be JSON-safe).');
  }
  if (Array.isArray(value)) {
    return value.map((v) => canonicalize(v));
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * The content address of an interpretation run:
 * `annotationHash = sha256(canonicalJSON({ normalizedEvents, interpreterVersion, promptVersion }))`.
 *
 * The hash is over the INPUTS to the interpretation (the events + the two versions) — NOT
 * the produced annotations (the events+versions are the content address; the annotations are
 * the OUTPUT keyed by it). Identical inputs → identical hash; a changed event / version → a
 * different hash. Returns a 64-char lowercase hex digest.
 * [architecture.md#Data Architecture L170-172; replay-bundle.ts L26-28]
 *
 * IMPORTANT (F2): this is a RUN-IDENTITY key, NOT an annotation-INTEGRITY hash. It identifies
 * "which interpretation run produced this" (same events+versions → same id) but, by AC2's
 * formula, it does NOT cover the produced annotations — swapping the annotation payload leaves
 * the hash unchanged. Story 5.2 must NOT treat annotationHash as proof the annotations are
 * untampered; per-annotation provenance (interpreterVersion + the interpreter-derived sourceHash,
 * stamped in claude-interpreter.ts) is the annotation-level authenticity signal.
 */
export function annotationHash(args: {
  normalizedEvents: NormalizedEvent[];
  interpreterVersion: string;
  promptVersion: string;
}): string {
  const canonical = canonicalJSON({
    normalizedEvents: args.normalizedEvents,
    interpreterVersion: args.interpreterVersion,
    promptVersion: args.promptVersion,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * The frozen, content-addressed annotation slice that Story 5.2 folds into the full
 * ReplayBundle: the annotations PLUS their content address and the versions that produced
 * them. It deliberately does NOT carry `normalizedEvents` (those live at the ReplayBundle top
 * level and are the hash INPUT, not duplicated here).
 */
export interface FrozenAnnotations {
  annotations: readonly BeatAnnotation[];
  annotationHash: string;
  interpreterVersion: string;
  promptVersion: string;
}

/**
 * Freeze a produced annotation set: re-validate each annotation at the freeze boundary
 * (the durable-commit belt-and-suspenders — the interpreter already validated on emission,
 * but freezing is the point of no return), verify every grounding ref resolves to a real
 * event, compute the content address over the events+versions, and return the bundle-ready slice.
 *
 * Freezing is the point of no return, so a DANGLING grounding ref (an eventRef or
 * groundingPointer.eventRefs[j] not present in normalizedEvents — e.g. a hallucinated ref at a
 * real bake) fails LOUD here rather than being frozen + hashed silently (F5).
 *
 * PURE: no clock/RNG/network; `node:crypto` only (via annotationHash). The full ReplayBundle
 * assembly (events + frozen annotations + tuning + saga + assets) is Story 5.2 — NOT here.
 * [src/schema/replay-bundle.ts L12-29; epics.md#Story-5.2]
 */
export function freezeAnnotations(args: {
  normalizedEvents: NormalizedEvent[];
  annotations: BeatAnnotation[];
  interpreterVersion: string;
  promptVersion: string;
}): FrozenAnnotations {
  const annotations = args.annotations.map((a) => BeatAnnotationSchema.parse(a));
  const eventIds = new Set(args.normalizedEvents.map((e) => e.eventId));
  for (const a of annotations) {
    for (const ref of [a.eventRef, ...a.groundingPointer.eventRefs]) {
      if (!eventIds.has(ref)) {
        throw new Error(
          `freezeAnnotations: grounding ref '${ref}' does not resolve to any normalizedEvents eventId (dangling ref).`,
        );
      }
    }
  }
  return {
    annotations,
    annotationHash: annotationHash({
      normalizedEvents: args.normalizedEvents,
      interpreterVersion: args.interpreterVersion,
      promptVersion: args.promptVersion,
    }),
    interpreterVersion: args.interpreterVersion,
    promptVersion: args.promptVersion,
  };
}
