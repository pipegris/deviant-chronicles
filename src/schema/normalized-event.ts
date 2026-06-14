import { z } from 'zod';

// The Layer-0 NormalizedEvent contract that gates everything downstream. Pure data
// contract: only `zod` is imported (R3 — no JSONL parsing here; that lives in ingest/).

// logicalClock / seqWithinStream are integers because orderKey is the total-ordering key
// merged across main + sub-agent streams via a stable sort. [architecture.md "Ordering"]
export const OrderKeySchema = z.object({
  logicalClock: z.number().int(),
  streamId: z.string(),
  seqWithinStream: z.number().int(),
});
export type OrderKey = z.infer<typeof OrderKeySchema>;

// String-literal union via z.enum (Zod 4 infers `'melee' | ...`, satisfying AC2). Members
// are the core translation verbs (Dev Notes "ActionType derivation"). The Mirage/solid
// distinction is deliberately a Beat-level modifier in 1.4, not its own member here, so
// this gating union need not be edited when 1.4 lands.
export const ActionTypeSchema = z.enum([
  'melee',
  'spell',
  'scout',
  'summon',
  'counter',
  'idle',
  'aetherStorm',
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

// Carries fidelity for BOTH consumers (architecture mandate): Pacer mechanics
// (exitCode/isError/retryCount/timing/orderKey) AND Interpreter signal
// (subtype/streamDepth/payload). Serialized fields use .nullable() (explicit null, not
// absent) per AC3 so the bundle JSON stays stable for the sha256 hash.
export const NormalizedEventSchema = z.object({
  orderKey: OrderKeySchema,
  eventId: z.string(),
  eventType: z.string(),
  toolName: z.string().nullable(),
  subtype: z.string().nullable(),
  timestamp: z.string(),
  streamDepth: z.number().int(),
  exitCode: z.number().int().nullable(),
  isError: z.boolean(),
  retryCount: z.number().int(),
  // Open record for v0.1 (Dev Notes "payload fidelity"): keeps the gating contract open
  // while ingest (1.3) decides which normalized fields to populate, avoiding a re-open of
  // this schema per new field.
  payload: z.record(z.string(), z.unknown()).nullable(),
});
export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;
