import { z } from 'zod';
import rawScrubPatterns from '../config/scrub-patterns.json';

// The scrub/-local deny-pattern config schema + the bundled, validated pattern set (Story 5.1, the
// PRIVACY GUARDRAIL). The redaction deny-pattern SET lives ENTIRELY in src/config/scrub-patterns.json
// (config-as-data, NFR-4) — this module only describes + validates its shape and compiles each pattern
// string to a RegExp; scrub.ts reads the compiled patterns generically and contains NO pattern literal.
// Mirrors src/scribe/captions-config.ts / src/model/model-tuning.ts / src/portal/teaching-config.ts
// VERBATIM in structure. [story Task 1; Dev Notes "Config-as-data"; architecture.md#config L254-258]
//
// PURE (the captions-config.ts / model-tuning.ts posture): the `import rawScrubPatterns from '...json'`
// line is a STATIC, bundled import, not runtime IO — there is no fs read and no clock. src/scrub/ is
// SDK-free + phaser-free (the r4-isolation.test.ts source-grep is the real R4/R5 guard, since src/scrub/
// has NO eslint zone; lint's global anthropic + phaser bans also hold). Validating + COMPILING each
// pattern at module load fails CLOSED: a malformed committed scrub-patterns.json (a bad regex, an empty
// matcher, a typo'd key, a bumped $schemaVersion) throws on import rather than silently shipping a hole
// in the privacy guardrail. [architecture.md#R4 L236-238]

// The closed set of redaction categories — a string-literal union (project convention; NO numeric enum).
// The redaction token carries this category for auditability, never the matched text. z.enum rejects an
// unknown/typo'd category at parse (a free z.string() would silently accept a hole). [story Task 1/2]
export const SCRUB_CATEGORIES = [
  'secret',
  'token',
  'credential',
  'pii-email',
  'home-path',
  'db-role',
] as const;
export const ScrubCategorySchema = z.enum(SCRUB_CATEGORIES);
export type ScrubCategory = z.infer<typeof ScrubCategorySchema>;

// One deny pattern: an id (for traceability), its category, the regex SOURCE string, optional extra
// regex flags, and a human description. .strict() rejects a typo'd field (e.g. `patern`). `pattern` is
// .min(1) so an empty/over-broad matcher (which would redact everything) fails LOUD at parse, and a
// .superRefine compiles it so a broken regex (e.g. an unterminated group `(`) fails LOUD at load too.
const ScrubPatternEntrySchema = z
  .object({
    id: z.string().min(1),
    category: ScrubCategorySchema,
    // The regex SOURCE (a string in config-as-data — a JSON file cannot carry a RegExp). .min(1) blocks
    // the empty/everything-matcher; the compile refinement below blocks a syntactically broken source.
    pattern: z.string().min(1),
    // Optional extra flags appended to the always-on 'g' (global) compile. Constrained to the valid
    // flag letters so a typo fails closed; 'g' is added unconditionally in compileScrubPatterns.
    flags: z
      .string()
      .regex(/^[dgimsuvy]*$/, 'flags must be a subset of d,g,i,m,s,u,v,y')
      .optional(),
    description: z.string().min(1),
  })
  .strict()
  // Compile the pattern at PARSE so a broken regex fails LOUD on import, not silently at scrub time. The
  // error references the pattern id ONLY — never echoes a value (the report/error no-leak posture). The
  // global 'g' flag is included so the compile here matches how compileScrubPatterns builds the live regex.
  .superRefine((entry, ctx) => {
    try {
      new RegExp(entry.pattern, withGlobal(entry.flags));
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `scrub pattern '${entry.id}' is not a valid RegExp`,
        path: ['pattern'],
      });
    }
  });

export const ScrubPatternsSchema = z
  .object({
    // A future shape change bumps this so an old reader reading a new artifact fails closed.
    $schemaVersion: z.literal(1),
    // Ordered list — patterns apply in array order (determinism: order-stable scrubbing). .min(1) so an
    // empty deny set (a privacy hole) fails closed.
    patterns: z.array(ScrubPatternEntrySchema).min(1),
  })
  .strict();

export type ScrubPatterns = z.infer<typeof ScrubPatternsSchema>;
export type ScrubPatternEntry = z.infer<typeof ScrubPatternEntrySchema>;

// A compiled deny pattern: the validated metadata PLUS the live RegExp scrub.ts applies. The regex is
// compiled ONCE here at load (the determinism-footgun guard in Dev Notes "RegExp caution") — scrub.ts
// builds a FRESH RegExp per leaf (or relies on String.replace, stateless w.r.t. the call) rather than
// reusing a stateful /g lastIndex across leaves.
export interface CompiledScrubPattern {
  id: string;
  category: ScrubCategory;
  source: string;
  flags: string;
  regex: RegExp;
}

// Always compile with the global 'g' flag (every match on a leaf is redacted, not just the first) plus
// any configured extra flags, de-duplicated. Pure string assembly — no clock/RNG/IO.
function withGlobal(flags: string | undefined): string {
  const letters = new Set<string>(['g']);
  for (const f of flags ?? '') {
    letters.add(f);
  }
  return [...letters].join('');
}

// Derive the compiled deny set from a validated ScrubPatterns. Re-validates (parse) so any caller that
// passes a hand-built config (a test) gets the same fail-closed guarantees as the committed file. PURE.
export function compileScrubPatterns(patterns: ScrubPatterns): CompiledScrubPattern[] {
  const validated = ScrubPatternsSchema.parse(patterns);
  return validated.patterns.map((entry) => {
    const flags = withGlobal(entry.flags);
    return {
      id: entry.id,
      category: entry.category,
      source: entry.pattern,
      flags,
      // The schema's compile refinement already proved this source+flags compiles.
      regex: new RegExp(entry.pattern, flags),
    };
  });
}

// Parsed + validated at module load (fail-closed). scrub.ts reads the compiled set generically and
// accepts it as a default param so a test can pass a DIFFERENT in-memory config (proving NFR-4 — the
// deny set is a JSON-only change) without mutating the committed file. Mirrors MODEL_TUNING / CAPTIONS.
export const SCRUB_PATTERNS: ScrubPatterns = ScrubPatternsSchema.parse(rawScrubPatterns);
export const COMPILED_SCRUB_PATTERNS: CompiledScrubPattern[] = compileScrubPatterns(SCRUB_PATTERNS);
