import { z } from 'zod';
import { ActionTypeSchema } from '../schema/normalized-event';
import rawRules from '../config/translation-rules.json';

// The translate/-local rules schema + the bundled, validated ruleset. The metaphor lives
// ENTIRELY in src/config/translation-rules.json (config-as-data, NFR-4) — this module only
// describes and validates its shape; translate.ts interprets the rules generically.
//
// PURE (R2): the `import rawRules from '...json'` is a STATIC, Vite-bundled import, not
// runtime IO — there is no fs read and no clock, exactly like allowlist.ts is config-as-data
// without IO. Validating at module load fails closed (a malformed committed file throws on
// import rather than silently mis-translating).

// A declarative MATCH -> EMIT pair. Every match field is optional; the engine treats present
// fields as an AND and absent fields as wildcards. Unknown keys are rejected (.strict) so a
// typo in the committed JSON fails closed instead of being silently ignored.
const RuleMatchSchema = z
  .object({
    eventType: z.string().optional(),
    // toolName is an ARRAY (set membership) so ["Read","Grep","Glob"] is ONE rule — adding a
    // tool is a JSON edit, never an engine change.
    toolName: z.array(z.string()).optional(),
    // A STRING compiled to RegExp inside translate.ts (matched against payload.input.command).
    commandPattern: z.string().optional(),
    // A STRING compiled to RegExp, matched against the stringified payload.content of a
    // tool_result. This is how an environmental hazard (a 529/overload/rate-limit) is detected
    // on the REAL channel: ingest stamps no hazard subtype, so the only signal a 529 carries is
    // its error text (AC3 / SM-C1). Data-driven — widening the hazard vocabulary is a JSON edit.
    contentPattern: z.string().optional(),
    isError: z.boolean().optional(),
    subtypeIn: z.array(z.string()).optional(),
    // Holds ONLY when the event's stream currently has an OPEN strike (a melee/spell tool_use
    // whose outcome has not yet resolved). Makes the spell channel load-bearing (a spell's
    // outcome lands only because the spell opened the strike) and stops a scout's own result
    // from damaging the Boss. The engine, not the JSON, tracks open strikes per stream.
    resolvesStrike: z.boolean().optional(),
  })
  .strict();

const RuleEmitSchema = z
  .object({
    actionType: ActionTypeSchema,
    resolveDelta: z.number().optional(),
    problemIntegrityDelta: z.number().optional(),
    isAetherStorm: z.boolean().optional(),
    // Marks a STRIKE subject to the scout-before-strike check; the engine (not the JSON)
    // computes the final isMirage boolean.
    isMirageCandidate: z.boolean().optional(),
    // Marks a tool_use that OPENS resolvable work on its stream (a melee or a spell channel).
    // The engine records an open strike on the stream; the next tool_result resolves it (a
    // pass lands -> Boss damage via resolvesStrike; a fail backfires -> counter). A scout
    // (Read/Grep/Glob) does NOT open a strike, so its own result never damages the Boss.
    opensStrike: z.boolean().optional(),
  })
  .strict();

const RuleSchema = z
  .object({
    id: z.string(),
    match: RuleMatchSchema,
    emit: RuleEmitSchema,
  })
  .strict();

// The fail-closed-to-default action emitted when NO rule matches (AC4). Lives in DATA.
const DefaultActionSchema = z
  .object({
    actionType: ActionTypeSchema,
    resolveDelta: z.number(),
    problemIntegrityDelta: z.number(),
  })
  .strict();

export const TranslationRulesSchema = z
  .object({
    // A future shape change bumps this so an old engine reading a new shape fails closed.
    $schemaVersion: z.literal(1),
    // ORDERED: array order IS the first-match-wins priority list.
    rules: z.array(RuleSchema),
    default: DefaultActionSchema,
  })
  .strict();

export type TranslationRules = z.infer<typeof TranslationRulesSchema>;
export type TranslationRule = z.infer<typeof RuleSchema>;

// Parsed + validated at module load. translate.ts accepts this as a default param so a test
// can pass a DIFFERENT in-memory ruleset (proving NFR-4) without mutating this committed file.
export const RULES: TranslationRules = TranslationRulesSchema.parse(rawRules);
