import { z } from 'zod';
import rawTeaching from '../config/teaching.json';

// The portal/-local teaching-table config schema + the bundled, validated table (Story 4.3, FR-11).
// The always-on TEACHING lesson lives ENTIRELY in src/config/teaching.json (config-as-data, NFR-4) —
// this module only describes + validates its shape; teaching.ts reads the one-liner generically and
// contains NO teaching string literal. Mirrors scribe/captions-config.ts and model/model-tuning.ts
// VERBATIM in structure. [story Task 1; Dev Notes "Content = config-as-data"; architecture.md#config]
//
// PURE (kept deliberately, the captions-config.ts / model-tuning.ts posture): the `import rawTeaching
// from '...json'` line is a STATIC, Vite-bundled import, not runtime IO — there is no fs read and no
// clock. portal/ is browser-reachable (the boot threads planTeaching), so it stays SDK-free +
// phaser-free; the source-grep r1-discipline.test.ts is the real R4/R5 guard, since portal/ has NO
// eslint zone (lint's global anthropic + phaser bans also hold). Validating at module load fails
// closed (a malformed committed file throws on import rather than silently mis-teaching). The only LLM
// calls in the whole project are the offline Interpreter (3.2) + the offline Saga author (4.2) — there
// is NO LLM here; teaching is templated config-as-data. [architecture.md#R4 L236-238]

// SM-C2 brevity bound (the gate-checkable max length): the authored one-liner must be SHORT enough not
// to bury the spectacle. ONE constant referenced by BOTH the schema floor below AND the unit test
// (teaching.unit.test.ts), so there is a single source of truth for the brevity gate. [story Task 1;
// prd.md#SM-C2 "Caption density should not bury the action"]
export const TEACHING_MAX_LEN = 140;

// A single plain-dev one-liner: a non-empty string bounded by the SM-C2 brevity floor. UNLIKE the
// rotating caption VARIANTS (an array), teaching is a FIXED lesson per beat — ONE string, no rotation
// (SM-1 wants the lesson stable, "infinite tellings, one story"). [story Task 1; Dev Notes #5]
const OneLinerSchema = z.string().min(1).max(TEACHING_MAX_LEN);

// The table is keyed EXHAUSTIVELY by the three BeatType members (schema/beat-annotation.ts: shaman |
// dispel | summon). An exhaustive z.object(...).strict() (NOT z.record) is chosen so a MISSING key
// (e.g. forgetting `summon`) fails LOUD at import — z.record would accept a partial map — and .strict()
// rejects a TYPO'd key (e.g. `shamn`), exactly the CaptionsTableSchema / ModelTuningSchema fail-closed
// posture. [story Task 1; Dev Notes "Config-as-data pattern"]
export const TeachingTableSchema = z
  .object({
    // A future shape change bumps this so an old reader reading a new artifact fails closed.
    $schemaVersion: z.literal(1),
    shaman: OneLinerSchema,
    dispel: OneLinerSchema,
    summon: OneLinerSchema,
  })
  .strict();

export type TeachingTable = z.infer<typeof TeachingTableSchema>;

// Parsed + validated at module load (fail-closed). teaching.ts reads TEACHING[beatType] generically.
export const TEACHING: TeachingTable = TeachingTableSchema.parse(rawTeaching);
