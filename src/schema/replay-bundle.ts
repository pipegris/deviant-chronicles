import { z } from 'zod';
import { BattleTimelineSchema } from './battle-timeline';
import { BeatAnnotationSchema } from './beat-annotation';
import { OrderKeySchema } from './normalized-event';
import { ScrubApprovalSchema } from '../scrub/approval';

// Loose placeholder for the versioned translation/pacing config. Its real JSON schema
// lands in 1.4/1.5; typed open here (deliberate forward-reference, not an omission) so the
// bundle compiles today and is narrowed when those stories land.
export const TuningConfigSchema = z.record(z.string(), z.unknown());
export type TuningConfig = z.infer<typeof TuningConfigSchema>;

// Story 5.2 / Task 1 — the scrub/approval provenance block the Story 5.1 gate forward-referenced
// (gate.ts L17-19, the TuningConfigSchema precedent). It embeds the gate verdict's provenance into the
// shippable artifact: the two content addresses that prove the public events were scrubbed + the
// operator's ScrubApproval marker (reused verbatim from the crypto-free src/scrub/approval leaf — NOT
// gate.ts, so this browser-reachable schema never pulls gate.ts's node:crypto into the bundle), so an
// auditor can re-verify. No R1/R4/R5 boundary crossed (scrub is SDK-free + phaser-free; schema/ is the
// leaf everyone consumes). Key order is FIXED so the block round-trips byte-for-byte (a hash is taken
// over those bytes).
export const ScrubProvenanceSchema = z.object({
  scrubHash: z.string().min(1),
  reportHash: z.string().min(1),
  patternSetVersion: z.string().min(1),
  approval: ScrubApprovalSchema,
});
export type ScrubProvenance = z.infer<typeof ScrubProvenanceSchema>;

// Story 5.5 (AC1/AC3) — the PAYLOAD-FREE, NAME-FREE per-event projection the PUBLIC bundle ships in
// place of the full normalizedEvents (the prior leak vector: payloads up to ~28KB/event AND raw file
// paths/names). OutcomeSchema + AbstractedRoleSchema are CLOSED string-literal unions (no numeric enum).
// AbstractedRole mirrors the union in bundle/classify-role.ts — one conceptual source of truth, asserted
// on both sides (Dev Notes §2). [story Task 2]
export const OutcomeSchema = z.enum(['success', 'isError']);
export type Outcome = z.infer<typeof OutcomeSchema>;

export const AbstractedRoleSchema = z.enum(['test', 'schema', 'migration', 'config', 'doc', 'source']);

// .strict() is load-bearing (AC2): it makes "no per-event payload/content field" a PARSE-TIME guarantee,
// not just a test — a ProjectedEvent carrying a leaked `payload`/`content`/`timestamp`/etc. fails closed
// at the boundary. The opaque identity keeps BOTH orderKey (the AC's named opaque id) and eventId (the
// opaque string every timeline/annotation ref + the freeze guard + the portal lookup keys on; Dev Notes §1).
export const ProjectedEventSchema = z
  .object({
    orderKey: OrderKeySchema,
    eventId: z.string(),
    eventType: z.string(),
    toolName: z.string().nullable(),
    outcome: OutcomeSchema,
    role: AbstractedRoleSchema,
  })
  .strict();
export type ProjectedEvent = z.infer<typeof ProjectedEventSchema>;

export const ReplayBundleSchema = z.object({
  schemaVersion: z.literal(1),
  // Story 5.5 (AC1) — the public bundle carries the PAYLOAD-FREE projection, NOT the full events. The
  // field is RENAMED (not just retyped) so no consumer can accidentally expect a payload that no longer
  // exists, and the absence becomes structural. Stays schemaVersion: 1 — a v0.1 pre-ship refinement with
  // no external reader of the old shape; the only consumers are in-repo and are all updated in this story
  // (Dev Notes §2). A version bump would buy nothing (no old reader to keep compatible).
  projectedEvents: z.array(ProjectedEventSchema),
  annotations: z.array(BeatAnnotationSchema),
  // The paced timeline is BAKED into the bundle (Dev Notes "ReplayBundle composition"):
  // determinism is then literal — the shipped artifact carries the exact golden timeline,
  // with no in-browser recompute drift.
  battleTimeline: BattleTimelineSchema,
  tuningConfig: TuningConfigSchema,
  // The pre-generated closing prose; null when not yet authored (AC3: explicit null).
  saga: z.string().nullable(),
  // Logical asset name → path; the Phaser loader is fed by this. Kept minimal — full
  // manifest shape is decided when the render/final-art stories land.
  assetManifest: z.record(z.string(), z.string()),
  // sha256(normalizedEvents + interpreterVersion + promptVersion) — makes the frozen
  // annotation set content-addressed.
  annotationHash: z.string(),
  // Story 5.2 / Task 1 — the scrub/approval provenance (Decision §1). NULLABLE + OPTIONAL: an
  // additive backward-compatible field keeps schemaVersion: 1 valid. `null` is the explicit
  // "no scrub provenance" value (explicit-null convention); optional so the prior Story 1.2
  // fixtures that omit the key entirely still parse unchanged (the existing replay-bundle.test.ts
  // round-trip). A populated bundle records WHY its public events are publishable.
  scrub: ScrubProvenanceSchema.nullable().optional(),
})
  // .strict() mirrors the per-event ProjectedEventSchema rationale (Dev Notes §2): make the envelope a
  // PARSE-TIME guarantee, not just a construction convention. assembleBundle is the sole composition point
  // and only adds the named fields, so a regression that re-introduced a top-level `normalizedEvents` (the
  // old leak vector) would otherwise be SILENTLY STRIPPED by Zod; strict rejects it LOUD at the boundary
  // (Review F2 — defense-in-depth for NFR-3, the privacy guardrail).
  .strict();
export type ReplayBundle = z.infer<typeof ReplayBundleSchema>;
