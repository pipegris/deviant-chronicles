import { z } from 'zod';
import { ActionTypeSchema } from '../schema/normalized-event';
import rawWeights from '../config/pacing-weights.json';
import rawWindow from '../config/window-config.json';

// The pace/-local pacing config schemas + the bundled, validated config. The metaphor's
// RHYTHM lives ENTIRELY in src/config/pacing-weights.json + window-config.json
// (config-as-data, NFR-4) — these modules only describe and validate their shape;
// score-event.ts / window-events.ts / derive-beats.ts read the values generically and
// contain NO numeric tuning literal.
//
// PURE (R2): the `import raw... from '...json'` lines are STATIC, Vite-bundled imports, not
// runtime IO — there is no fs read and no clock, exactly like translation-rules.ts is
// config-as-data without IO. Validating at module load fails closed (a malformed committed
// file throws on import rather than silently mis-pacing).

// The significance weights, keyed by EVERY ActionType member and validated EXHAUSTIVE via a
// Zod record over the frozen union (Zod 4: z.record(ActionTypeSchema, z.number())). A missing
// actionType weight throws at import rather than silently falling back to a code constant —
// an unmapped weight is exactly the "hardcoded pacing constant" NFR-4 forbids. The record also
// rejects unknown keys, so a typo'd actionType fails closed too.
const WeightsMapSchema = z.record(ActionTypeSchema, z.number());

// The dramatic, non-actionType score bumps (additive knobs scoreEvent reads — never hardcoded).
// Keys are optional so an in-memory test config may pass {} (the modifiers contribute 0 when
// absent); the committed file supplies all four. .strict() rejects a typo'd modifier name.
const ModifiersSchema = z
  .object({
    mirageStrike: z.number().optional(),
    solidStrike: z.number().optional(),
    bossDamage: z.number().optional(),
    resolveDrain: z.number().optional(),
  })
  .strict();

// The dwell budget: dwellMs = beat.weight * dwellMsPerWeightUnit. This single lever maps a
// Beat's final weight to its on-screen dwell, makes "significant beats out-dwell trivial ones"
// a CONFIG fact, and makes the ~2-4 min full-session target tunable (scaling it scales the
// whole timeline with ZERO pace/ code change).
const DwellSchema = z
  .object({
    dwellMsPerWeightUnit: z.number(),
  })
  .strict();

export const PacingWeightsSchema = z
  .object({
    // A future shape change bumps this so an old reader reading a new shape fails closed.
    $schemaVersion: z.literal(1),
    weights: WeightsMapSchema,
    modifiers: ModifiersSchema,
    dwell: DwellSchema,
  })
  .strict();

export type PacingWeights = z.infer<typeof PacingWeightsSchema>;

export const WindowConfigSchema = z
  .object({
    $schemaVersion: z.literal(1),
    // The weight at/below which an action is "trivial" and montageable; strictly above it the
    // action is significant and always stays its own discrete window.
    montageThresholdWeight: z.number(),
    // The minimum run length before a trivial run collapses (a single trivial action is NOT a
    // montage; a run of N >= minRunToCollapse is). FR-12 collapses "bursts" — a burst is a run.
    minRunToCollapse: z.number(),
  })
  .strict();

export type WindowConfig = z.infer<typeof WindowConfigSchema>;

// Parsed + validated at module load. Each pure pace function accepts its config as a default
// param so a test can pass a DIFFERENT in-memory config (proving NFR-4 — tuning is a JSON-only
// change) without mutating these committed files. Mirrors translate(events, rules = RULES).
export const PACING_WEIGHTS: PacingWeights = PacingWeightsSchema.parse(rawWeights);
export const WINDOW_CONFIG: WindowConfig = WindowConfigSchema.parse(rawWindow);
