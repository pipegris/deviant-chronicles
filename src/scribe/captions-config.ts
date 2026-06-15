import { z } from 'zod';
import rawCaptions from '../config/captions.json';

// The scribe/-local caption-table config schema + the bundled, validated table (Story 4.1, FR-9).
// The Scribe's VOICE lives ENTIRELY in src/config/captions.json (config-as-data, NFR-4) — this
// module only describes + validates its shape; captions.ts reads the variants generically and
// contains NO caption string literal. Mirrors pacing-config.ts / model-tuning.ts VERBATIM in
// structure. [story Dev Notes "Config-as-data pattern"; architecture.md#"Layer 2 — TOLD"]
//
// PURE (kept deliberately, the animation-plan.ts / beat-behavior.ts posture): the `import rawCaptions
// from '...json'` line is a STATIC, Vite-bundled import, not runtime IO — there is no fs read and no
// clock. R2's lint-enforced purity binds Layer-0 only, but scribe/ is browser-reachable, so it stays
// pure (and SDK-free + phaser-free; the source-grep r1-discipline.test.ts is the real guard, since
// lint ALLOWS the Anthropic SDK in scribe/ but these captions are TEMPLATED — the one LLM call is the
// closing Saga, Story 4.2). Validating at module load fails closed (a malformed committed file throws
// on import rather than silently mis-narrating). [architecture.md#R4 L236-238; #LLM Integration L189-191]

// A caption FAMILY is an array of 2+ in-register variant strings (the rotation pool). .min(1) is the
// hard floor the schema enforces; the AUTHORED table supplies >=2 per family so the deterministic
// rotation can give repeats a different variant (AC1 "repeats don't read identically").
const VariantsSchema = z.array(z.string().min(1)).min(1);

// The table is keyed EXHAUSTIVELY by every ActionType union member (schema/normalized-event.ts:
// melee | spell | scout | summon | counter | idle | aetherStorm) PLUS the two signature-beat keys the
// bare actionType cannot express (dispel | shaman). `summon` doubles as BOTH an ActionType and a
// signature beat, so it needs only ONE key. An exhaustive z.object(...).strict() (NOT z.record) is
// chosen so a MISSING key (e.g. forgetting `counter`) fails LOUD at import — z.record would accept a
// partial map — and .strict() rejects a TYPO'd key (e.g. `meele`), exactly the WeightsMapSchema /
// ModelTuningSchema fail-closed posture. [story Task 1; Dev Notes "Config-as-data pattern"]
export const CaptionsTableSchema = z
  .object({
    // A future shape change bumps this so an old reader reading a new artifact fails closed.
    $schemaVersion: z.literal(1),
    melee: VariantsSchema,
    spell: VariantsSchema,
    scout: VariantsSchema,
    summon: VariantsSchema,
    counter: VariantsSchema,
    // `idle` is a SCHEMA-COMPLETENESS placeholder, NEVER displayed (review F6): the table is keyed
    // EXHAUSTIVELY by every ActionType so a missing/typo'd key fails loud at import, but captions.ts'
    // captionFamilyForBeat returns null for an idle beat (SM-C2 — captioning the fail-closed neutral
    // "no rule matched" beat would be narrating nothing), so selectVariant is never called with 'idle'
    // and its authored variants never render. The key stays for exhaustiveness/symmetry (a JSON comment
    // is impossible — the file is JSON.parse'd by both the loader and resolveJsonModule), documented here.
    idle: VariantsSchema,
    aetherStorm: VariantsSchema,
    dispel: VariantsSchema,
    shaman: VariantsSchema,
  })
  .strict();

export type CaptionsTable = z.infer<typeof CaptionsTableSchema>;

// The set of caption FAMILY keys the selector resolves against (every key except the version tag).
// A string-literal union (project convention — NO numeric enum); it is the closed domain captions.ts
// keys the table by. dispel/shaman/summon are the signature-beat families; the rest are ActionTypes.
export type CaptionFamily =
  | 'melee'
  | 'spell'
  | 'scout'
  | 'summon'
  | 'counter'
  | 'idle'
  | 'aetherStorm'
  | 'dispel'
  | 'shaman';

// Parsed + validated at module load (fail-closed). The selector reads CAPTIONS[family] generically.
export const CAPTIONS: CaptionsTable = CaptionsTableSchema.parse(rawCaptions);
