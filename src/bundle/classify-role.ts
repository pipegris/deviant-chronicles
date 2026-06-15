// Story 5.5 / Task 1 (AC3) — the PURE, name-discarding abstracted-role classifier. The projector reads
// a tool_use's target path at BAKE time, hands it HERE, and ships ONLY the coarse role token returned;
// the path is read as a LOCAL string to test patterns and then DISCARDED. This no-echo invariant is the
// load-bearing privacy proof: a real file path/name never leaves this function. Pure pattern matching —
// NO LLM/semantic mapping (AC3). Rule home kept INLINE (not config-as-data): six FIXED rules whose
// FIRST-match precedence is load-bearing logic, not operator-tunable data (Dev Notes §3). [story Task 1]

// The six coarse role tokens (string-literal union — no numeric enum). The Zod mirror
// (AbstractedRoleSchema, schema/replay-bundle.ts) enumerates the same six, so a drift fails a test on
// either side (Dev Notes §2).
export type AbstractedRole = 'test' | 'schema' | 'migration' | 'config' | 'doc' | 'source';

// Ordered rules — FIRST match wins (the precedence IS the spec): a path can match several patterns
// (e.g. `src/schema/foo.test.ts` is both schema/ and *.test.*), so test > schema > migration > config >
// doc > source. Each regex is anchored to a segment/extension boundary so an incidental substring (e.g.
// a dir named `schematic/`) does not mis-fire, and none CAPTURE any portion of the path. [Dev Notes §3]
const RULES: ReadonlyArray<{ readonly match: RegExp; readonly role: AbstractedRole }> = [
  { match: /(^|\/)__tests__\//, role: 'test' },
  { match: /\.(test|spec)\.[^/]+$/, role: 'test' },
  { match: /\.schema\.[^/]+$/, role: 'schema' },
  { match: /(^|\/)schema(s)?\//, role: 'schema' },
  { match: /\.migration\.[^/]+$/, role: 'migration' },
  { match: /(^|\/)migrations?\//, role: 'migration' },
  { match: /\.(json|ya?ml|toml)$/, role: 'config' },
  { match: /\.config\.[^/]+$/, role: 'config' },
  { match: /(^|\/)config\//, role: 'config' },
  // Known dotted-config basenames: a DOT after the prefix is REQUIRED (and package.json matched EXACTLY)
  // so source files that merely START with the prefix (packageResolver.ts, vite-plugin-custom.ts) fall
  // through to 'source'. The earlier [^/]*$ form over-matched, shipping a WRONG coarse role to the viewer
  // (Review F1, AC4 accuracy). [Dev Notes §3]
  { match: /(^|\/)(tsconfig|eslint|vite|jest)\.[^/]+$/, role: 'config' },
  { match: /(^|\/)package\.json$/, role: 'config' },
  { match: /\.(md|mdx|txt)$/, role: 'doc' },
  // everything else (including null / no-target) falls through to 'source' below.
];

/**
 * Map a path PATTERN to a coarse role token, returning ONLY the token (AC3 — the no-echo invariant).
 * PURE + deterministic. `null` (a path-less prompt/text/tool_result event) maps to the catch-all
 * `'source'`. The path is read as a local string solely to test the ordered rules and is never returned,
 * embedded, or logged — only the role token ships.
 */
export function classifyRole(path: string | null): AbstractedRole {
  if (path === null) return 'source';
  // Normalize a LOCAL copy for matching only (backslashes → forward slashes; lower-case), then discard.
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  for (const rule of RULES) {
    if (rule.match.test(normalized)) return rule.role;
  }
  return 'source';
}
