import { z } from 'zod';
import { ActionTypeSchema, OrderKeySchema } from './normalized-event';

// Intra-layer import of OrderKeySchema/ActionTypeSchema from ./normalized-event is allowed
// (the R1 import zones target ingest/translate/pace/model, not schema/).

// A Beat is the Pacer's paced unit. It carries mechanics ONLY — actionType, the source
// events it collapses (sourceEventIds, which double as the Layer-0 grounding the portal
// references), and pacing weight/dwell. Interpretation (beatType/confidence) is kept off
// the Beat and lives in Layer-1 BeatAnnotation so mechanics never see interpretation (R1).
export const BeatSchema = z.object({
  orderKey: OrderKeySchema,
  actionType: ActionTypeSchema,
  sourceEventIds: z.array(z.string()),
  weight: z.number(),
  dwellMs: z.number(),
});
export type Beat = z.infer<typeof BeatSchema>;

// schemaVersion is a z.literal(1) so a bumped artifact fails closed rather than parsing
// under an old reader.
export const BattleTimelineSchema = z.object({
  schemaVersion: z.literal(1),
  beats: z.array(BeatSchema),
  totalDurationMs: z.number(),
});
export type BattleTimeline = z.infer<typeof BattleTimelineSchema>;

// The immutable playback snapshot the model emits (Story 2.2) and the RenderPort consumes
// (2.3). Enemy shape is intentionally thin here — full enemy modeling is Epic 2.
const EnemySchema = z.object({
  id: z.string(),
  type: z.string(),
  hp: z.number(),
});

export const BattleStateSchema = z.object({
  problemIntegrity: z.number(),
  resolve: z.number(),
  insightGauge: z.number(),
  enemies: z.array(EnemySchema),
  cursor: z.number().int(),
  victory: z.boolean(),
});
export type BattleState = z.infer<typeof BattleStateSchema>;
