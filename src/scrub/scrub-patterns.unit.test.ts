import { describe, expect, it } from 'vitest';

// RED-PHASE acceptance test for Story 5.1 — Task 1 / AC3 (config-as-data, NFR-4). It imports the
// not-yet-authored `./scrub-patterns` (ScrubPatternsSchema, SCRUB_PATTERNS, ScrubCategory), so it
// ERRORS now (RED — module resolution fails); turns GREEN when the dev authors
// src/config/scrub-patterns.json + src/scrub/scrub-patterns.ts.
//
// Mirrors src/portal/teaching-config.unit.test.ts VERBATIM in shape: a valid in-memory config parses;
// a missing key, a typo'd key (.strict), a bad regex, an over-broad empty pattern, an unknown category,
// and a bumped $schemaVersion each FAIL CLOSED at parse. These are build-time invariants: a malformed
// committed scrub-patterns.json throws on import rather than silently shipping a hole in the privacy
// guardrail. [story Task 1; Dev Notes "Config-as-data"; the teaching-config.unit.test.ts precedent]
import { ScrubPatternsSchema, SCRUB_PATTERNS } from './scrub-patterns';

// A valid in-memory pattern set — the baseline each failure mutates. One entry per the ScrubCategory
// string-literal union the story fixes: secret | token | credential | pii-email | home-path | db-role.
function validPatterns(): Record<string, unknown> {
  return {
    $schemaVersion: 1,
    patterns: [
      { id: 'api-key', category: 'token', pattern: 'sk-[A-Za-z0-9]{20,}', description: 'API key' },
      { id: 'bearer', category: 'token', pattern: 'Bearer\\s+[A-Za-z0-9._-]+', description: 'Bearer header' },
      { id: 'password', category: 'credential', pattern: 'password=\\S+', description: 'inline credential' },
      { id: 'email', category: 'pii-email', pattern: '[^\\s@]+@[^\\s@]+\\.[^\\s@]+', description: 'PII email' },
      { id: 'home-path', category: 'home-path', pattern: '/home/[^/\\s]+', description: 'absolute home path' },
      { id: 'db-role', category: 'db-role', pattern: 'app_rw', description: 'DB role allowlist entry' },
    ],
  };
}

describe('Story 5.1 Task 1 — SCRUB_PATTERNS is the validated, committed config (loaded at import)', () => {
  it('the committed config parses against ScrubPatternsSchema (validated at module load)', () => {
    expect(() => ScrubPatternsSchema.parse(SCRUB_PATTERNS)).not.toThrow();
  });

  it('carries $schemaVersion 1 and a non-empty ordered pattern list', () => {
    expect(SCRUB_PATTERNS.$schemaVersion).toBe(1);
    expect(Array.isArray(SCRUB_PATTERNS.patterns)).toBe(true);
    expect(SCRUB_PATTERNS.patterns.length).toBeGreaterThan(0);
  });

  it('covers every required ScrubCategory at least once (the privacy guardrail is complete)', () => {
    const categories = new Set(SCRUB_PATTERNS.patterns.map((p) => p.category));
    for (const required of ['token', 'credential', 'pii-email', 'home-path', 'db-role'] as const) {
      expect(categories.has(required)).toBe(true);
    }
  });
});

describe('Story 5.1 Task 1 — ScrubPatternsSchema fails CLOSED (.strict, fail-loud at build time)', () => {
  it('a valid in-memory pattern set parses', () => {
    expect(() => ScrubPatternsSchema.parse(validPatterns())).not.toThrow();
  });

  it('a MISSING required field (pattern.category) is rejected', () => {
    const bad = validPatterns();
    delete (bad.patterns as Array<Record<string, unknown>>)[0].category;
    expect(() => ScrubPatternsSchema.parse(bad)).toThrow();
  });

  it('an unknown/typo`d top-level key is rejected (.strict — no silent extra key)', () => {
    expect(() => ScrubPatternsSchema.parse({ ...validPatterns(), patternz: [] })).toThrow();
  });

  it('an unknown ScrubCategory value is rejected (string-literal union, not free string)', () => {
    const bad = validPatterns();
    (bad.patterns as Array<Record<string, unknown>>)[0].category = 'totally-unknown-category';
    expect(() => ScrubPatternsSchema.parse(bad)).toThrow();
  });

  it('a bumped $schemaVersion (2) is rejected — an old reader will not parse a new artifact', () => {
    expect(() => ScrubPatternsSchema.parse({ ...validPatterns(), $schemaVersion: 2 })).toThrow();
  });
});

describe('Story 5.1 Task 1 — a bad/over-broad pattern string fails LOUD at load (compiles to RegExp)', () => {
  it('a pattern that is not a valid RegExp throws at load (validated/compiled in scrub-patterns.ts)', () => {
    const bad = validPatterns();
    // An unterminated group — `new RegExp('(')` throws SyntaxError. The loader must compile each
    // pattern at load so a broken regex fails LOUD on import, not silently at scrub time.
    (bad.patterns as Array<Record<string, unknown>>)[0].pattern = '(';
    expect(() => ScrubPatternsSchema.parse(bad)).toThrow();
  });

  it('an empty pattern string is rejected (an over-broad/empty matcher would redact everything)', () => {
    const bad = validPatterns();
    (bad.patterns as Array<Record<string, unknown>>)[0].pattern = '';
    expect(() => ScrubPatternsSchema.parse(bad)).toThrow();
  });
});
