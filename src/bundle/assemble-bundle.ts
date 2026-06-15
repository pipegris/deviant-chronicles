import { createHash } from 'node:crypto';
import type { BattleTimeline } from '../schema/battle-timeline';
import type { BeatAnnotation } from '../schema/beat-annotation';
import { ReplayBundleSchema, type ReplayBundle } from '../schema/replay-bundle';
import { canonicalJSON, freezeAnnotations } from '../interpret/freeze';
import { isPublishable, reportHash, type ScrubApproval } from '../scrub/gate';
import type { ScrubResult } from '../scrub/scrub';

// Story 5.2 / Task 2 — the PURE ReplayBundle assembler: the gate + freeze + compose + validate core
// the thin scripts/build-bundle.ts orchestrator calls. It takes ALREADY-ingested + scrubbed inputs
// (the script owns ingest/scrub/pace/interpret/saga IO; the assembler owns assembly) and returns a
// Zod-valid ReplayBundle, or throws fail-closed when the publish gate blocks.
//
// PURE: no fs, no argv, no clock/RNG/network — `node:crypto` (via canonicalJSON, reused from
// interpret/freeze.ts) only. SDK-FREE + phaser-free so it is browser-cleanable determinism core (the
// R4 dist-grep + the source-grep test pin it). Same inputs → byte-identical bundle → identical
// annotationHash AND bundleHash (AC2 determinism is literal — the timeline is baked, not recomputed).
// [story Task 2; architecture.md#Format L264-266 ONE canonical serializer; #R2/#R4]

// The assembler input (Decision §2): the script resolves these (ingest/scrub/pace/interpret/saga) and
// hands them in. `approval` is the operator's ScrubApproval marker (null when absent → the gate blocks).
export interface AssembleBundleInput {
  scrubResult: ScrubResult;
  approval: ScrubApproval | null;
  annotations: BeatAnnotation[];
  interpreterVersion: string;
  promptVersion: string;
  battleTimeline: BattleTimeline;
  tuningConfig: Record<string, unknown>;
  saga: string | null;
  assetManifest: Record<string, string>;
}

/**
 * Assemble a Zod-valid ReplayBundle from already-ingested + scrubbed inputs, running the Story 5.1
 * publish gate FIRST (fail-closed). The public `normalizedEvents` are the SCRUBBED events — never the
 * raw session — so the shipped artifact carries no un-redacted secrets.
 *
 * Throws LOUD (with the gate `reasons`) when `isPublishable({ scrubResult, approval })` returns
 * `!ok` — the assembler REFUSES to build a publishable bundle from an unscrubbed/unreviewed session
 * (the gate wiring AC2/Story-5.1 mandate). The reasons carry no secret value (the gate's no-leak
 * invariant), so the thrown message is safe to print. Also throws when `freezeAnnotations` finds a
 * dangling grounding ref (a hallucinated eventRef), and when the composed value fails the schema at
 * the boundary (assemble-then-parse, fail loud on any drift). PURE — clock/RNG/network/fs-free.
 */
export function assembleBundle(input: AssembleBundleInput): ReplayBundle {
  const { scrubResult, approval } = input;

  // The publish gate, FIRST (fail-closed). A BLOCK throws with the gate reasons so the failure is
  // diagnosable; the gate references hashes/ids only, never a secret value (the no-leak posture).
  const decision = isPublishable({ scrubResult, approval });
  if (!decision.ok) {
    throw new Error(
      `assembleBundle: refusing to assemble a publishable bundle — publish gate blocked:\n  - ${decision.reasons.join(
        '\n  - ',
      )}`,
    );
  }

  // The PUBLIC events are the SCRUBBED ones (the whole point of the gate). The baked timeline the
  // script computed is paced from these SAME events, so the bundle is internally consistent (§4).
  const normalizedEvents = scrubResult.scrubbedEvents;

  // Freeze the interpretation: re-validate, reject dangling grounding refs, content-address. The
  // gate passing means `approval` is a non-null, matching marker here.
  const frozen = freezeAnnotations({
    normalizedEvents,
    annotations: input.annotations,
    interpreterVersion: input.interpreterVersion,
    promptVersion: input.promptVersion,
  });

  // review F3: enforce internal consistency at the SOLE composition point. The baked timeline's beat
  // sourceEventIds are the Layer-0 grounding the portal resolves onto the SHIPPED normalizedEvents
  // (Decision §4); mirror freezeAnnotations' dangling-ref guard so an alternate caller handing in a
  // timeline NOT paced from the shipped events fails LOUD rather than composing a silently-inconsistent
  // bundle (battleTimeline is otherwise only schema-shape-validated, never checked against the events).
  const eventIds = new Set(normalizedEvents.map((e) => e.eventId));
  for (const beat of input.battleTimeline.beats) {
    for (const ref of beat.sourceEventIds) {
      if (!eventIds.has(ref)) {
        throw new Error(
          `assembleBundle: battleTimeline beat sourceEventId '${ref}' does not resolve to any normalizedEvents eventId (timeline not paced from the shipped events).`,
        );
      }
    }
  }

  // The scrub provenance block (Task 1 field): the two content addresses + the operator marker. The
  // reportHash uses the SAME canonical formula the gate compares against (gate.ts reportHash), so the
  // embedded address matches what an auditor recomputes.
  const bundle = {
    schemaVersion: 1 as const,
    normalizedEvents,
    annotations: [...frozen.annotations],
    battleTimeline: input.battleTimeline,
    tuningConfig: input.tuningConfig,
    saga: input.saga,
    assetManifest: input.assetManifest,
    annotationHash: frozen.annotationHash,
    scrub: {
      scrubHash: scrubResult.scrubHash,
      reportHash: reportHash(scrubResult.report),
      patternSetVersion: scrubResult.report.patternSetVersion,
      approval,
    },
  };

  // Validate at the boundary: assemble, then parse — fail loud on any drift between what we composed
  // and what the schema accepts (a typo'd field / a shape regression is caught here, not shipped).
  return ReplayBundleSchema.parse(bundle);
}

/**
 * The whole-bundle content address: `bundleHash = sha256(canonicalJSON(bundle))` (Decision §3),
 * REUSING `canonicalJSON` from interpret/freeze.ts (the ONE canonical serializer). Distinct from the
 * embedded `annotationHash`, which (per freeze.ts F2) is a RUN-IDENTITY key over the interpretation
 * INPUTS only — `bundleHash` covers the ENTIRE assembled artifact (events + annotations + timeline +
 * tuning + saga + assets + scrub provenance). It is the AC2 "same bundle hashes" determinism anchor.
 *
 * NOT stored inside the bundle (that would be self-referential); the script computes/prints it and
 * the tests assert it. Returns a 64-char lowercase hex digest. PURE.
 */
export function bundleHash(bundle: ReplayBundle): string {
  return createHash('sha256').update(canonicalJSON(bundle)).digest('hex');
}
