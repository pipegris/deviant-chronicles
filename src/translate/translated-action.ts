import { z } from 'zod';
import {
  ActionTypeSchema,
  OrderKeySchema,
} from '../schema/normalized-event';

// The translate/-LOCAL output contract (NOT a src/schema/ entry): an intermediate Layer-0
// hand-off consumed only by the next stage (pace/, 1.5), so per architecture.md#Format
// Patterns it trusts types rather than re-opening the gating contract. Importing schema/
// TYPES from translate/ is allowed (schema/ is not an R1 layer zone).
export const TranslatedActionSchema = z.object({
  // Reuse the committed union verbatim — do NOT redefine it.
  actionType: ActionTypeSchema,
  sourceEventId: z.string(),
  orderKey: OrderKeySchema,
  target: z.string().nullable(),
  // Mirage/solid is a FLAG, deliberately NOT an ActionType member (the 1.2 decision):
  // true = unscouted strike (Mirage), false = scouted/solid, null = not a strike (N/A).
  isMirage: z.boolean().nullable(),
  resolveDelta: z.number(),
  problemIntegrityDelta: z.number(),
  // true ONLY for the environmental hazard, so the Pacer treats it as a pause, not a hit.
  isAetherStorm: z.boolean(),
});

export type TranslatedAction = z.infer<typeof TranslatedActionSchema>;
