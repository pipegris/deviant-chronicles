import { z } from 'zod';
import { BattleTimelineSchema } from './battle-timeline';
import { BeatAnnotationSchema } from './beat-annotation';
import { NormalizedEventSchema } from './normalized-event';
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

export const ReplayBundleSchema = z.object({
  schemaVersion: z.literal(1),
  normalizedEvents: z.array(NormalizedEventSchema),
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
});
export type ReplayBundle = z.infer<typeof ReplayBundleSchema>;
