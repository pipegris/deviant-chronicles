import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// RED-PHASE source-grep guard for Story 5.1 — Task 6 / AC3 (R4 + R5). It reads the not-yet-authored
// src/scrub/ sources, so it ERRORS now (RED — the files do not exist yet); turns GREEN when the dev
// authors them SDK-free + phaser-free. Mirrors src/scribe/r1-discipline.test.ts /
// src/interpret/r4-isolation.test.ts VERBATIM in shape.
//
// Why a source-grep is the REAL guard here (beyond lint): src/scrub/ has NO eslint import-zone (Dev
// Notes "Why a NEW src/scrub/ directory"). lint's GLOBAL anthropic + phaser bans also hold, but this
// grep is the explicit, dir-local pin that the scrub stays:
//   R4 — @anthropic-ai/sdk free: the scrub is pattern-based, NO LLM, NO network. The SDK never reaches
//        src/scrub/ (or scripts/scrub.ts), so scrub/ is browser-UNREACHABLE and tree-shaken from dist/.
//   R5 — phaser free: phaser stays confined to render/+game/; the scrub is a build-time privacy stage,
//        never a renderer.
const SCRUB = dirname(fileURLToPath(import.meta.url));

// The scrub core modules that MUST stay SDK-free AND phaser-free (the testable logic; scripts/scrub.ts
// is thin glue, out of vitest's src/**/*.test.ts include scope, proven SDK-free by the dist-grep).
const SCRUB_MODULES = ['scrub.ts', 'scrub-patterns.ts', 'gate.ts'];

describe('Story 5.1 (R4) — scrub/ core imports no @anthropic-ai/sdk (pattern-based, NO LLM)', () => {
  for (const file of SCRUB_MODULES) {
    it(`src/scrub/${file} contains zero references to @anthropic-ai/sdk`, () => {
      const source = readFileSync(join(SCRUB, file), 'utf8');
      expect(source).not.toContain('@anthropic-ai/sdk');
    });
  }
});

describe('Story 5.1 (R5) — scrub/ core imports no phaser (build-time stage, never a renderer)', () => {
  for (const file of SCRUB_MODULES) {
    it(`src/scrub/${file} contains zero references to phaser`, () => {
      const source = readFileSync(join(SCRUB, file), 'utf8');
      // Match the import specifier (the package), tolerant of single/double quotes — not an incidental
      // substring in a comment word. Both `from 'phaser'` and `import('phaser')` forms are caught.
      expect(source).not.toMatch(/['"]phaser['"]/);
    });
  }
});
