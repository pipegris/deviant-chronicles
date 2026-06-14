import { z } from 'zod';
import { BattleTimelineSchema } from './battle-timeline';
import { BeatAnnotationSchema } from './beat-annotation';
import { NormalizedEventSchema } from './normalized-event';

// Loose placeholder for the versioned translation/pacing config. Its real JSON schema
// lands in 1.4/1.5; typed open here (deliberate forward-reference, not an omission) so the
// bundle compiles today and is narrowed when those stories land.
export const TuningConfigSchema = z.record(z.string(), z.unknown());
export type TuningConfig = z.infer<typeof TuningConfigSchema>;

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
});
export type ReplayBundle = z.infer<typeof ReplayBundleSchema>;
