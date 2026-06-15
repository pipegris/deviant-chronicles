import { z } from 'zod';
import rawTuning from '../config/model-tuning.json';

// The model/-local battle-tuning config schema + the bundled, validated config. The Battle
// Model's MAGNITUDES live ENTIRELY in src/config/model-tuning.json (config-as-data, NFR-4) —
// this module only describes and validates their shape; battle-model.ts reads the values
// generically and contains NO numeric tuning literal. Mirrors pacing-config.ts verbatim.
//
// PURE (R2): the `import rawTuning from '...json'` line is a STATIC, Vite-bundled import, not
// runtime IO — there is no fs read and no clock, exactly like pacing-config.ts / translation-
// rules.ts are config-as-data without IO. Validating at module load fails closed (a malformed
// committed file throws on import rather than silently mis-tuning the battle).

// Each sub-block is .strict() so a typo'd key (e.g. `chargePerStrugle`) fails closed at build
// time rather than silently dropping a tuning lever.
const InitialSchema = z
  .object({
    problemIntegrity: z.number(),
    resolve: z.number(),
  })
  .strict();

const InsightSchema = z
  .object({
    // The gauge ceiling: charges clamp to [0, maxGauge].
    maxGauge: z.number(),
    // Flat charge added per struggle (counter) beat — "charge per struggle".
    chargePerStruggle: z.number(),
    // The gauge level at/above which the next integrity strike reads as a breakthrough and
    // discharges the gauge to 0 (the Layer-0 stand-in detector — see battle-model.ts).
    dischargeThreshold: z.number(),
  })
  .strict();

// The Boss enemy seeded at t=0. `hp` IS the top-level problemIntegrity (the same quantity);
// `type` is a renderer-facing sprite label, not load-bearing for state math.
const BossSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    hp: z.number(),
  })
  .strict();

// The per-effect SCALARS the metaphor verbs multiply by beat.weight (the per-beat magnitude
// the Pacer already tiered). A future tune flows through with ZERO battle-model.ts change.
const EffectsSchema = z
  .object({
    integrityDamagePerWeight: z.number(),
    resolveDrainPerWeight: z.number(),
  })
  .strict();

export const ModelTuningSchema = z
  .object({
    // A future shape change bumps this so an old reader reading a new shape fails closed.
    $schemaVersion: z.literal(1),
    initial: InitialSchema,
    insight: InsightSchema,
    boss: BossSchema,
    effects: EffectsSchema,
  })
  .strict();

export type ModelTuning = z.infer<typeof ModelTuningSchema>;

// Parsed + validated at module load. battle-model.ts's pure functions accept this config as a
// default param so a test can pass a DIFFERENT in-memory config (proving NFR-4 — tuning is a
// JSON-only change) without mutating the committed file. Mirrors pace(actions, weights = ...).
export const MODEL_TUNING: ModelTuning = ModelTuningSchema.parse(rawTuning);
