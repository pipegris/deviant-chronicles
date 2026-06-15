import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// RED-PHASE source-grep guard for Story 4.1 — the Layer-2 (Told) discipline that lint ALLOWS but the
// story FORBIDS. It reads the not-yet-authored scribe/ sources, so it ERRORS now (RED — the files do
// not exist yet); turns GREEN when the dev authors them SDK-free + phaser-free. Mirrors
// interpret/r4-isolation.test.ts (the SDK-free core guard) verbatim in shape.
//
// The two subtleties this guard pins (both beyond what lint catches):
//   R4 — eslint.config.ts L94-100 RE-ALLOWS @anthropic-ai/sdk inside src/scribe/ (it is an offline LLM
//        zone). But Story 4.1's captions are TEMPLATED (config-as-data, NO LLM, NO network — the ONE
//        LLM call is the closing Saga, Story 4.2). Importing the SDK here would defeat the "no LLM"
//        point AND make scribe/ — which IS browser-reachable via render -> scribe(type) + the boot
//        pipeline — drag the SDK toward the bundle. So the source-grep is the REAL guard here, not lint.
//   R5 — phaser stays confined to render/+game/ (lint-banned in scribe/). The caption SELECTION/TEXT
//        lives in scribe/ (no phaser); only the DISPLAY lives in render/phaser/. This grep is the
//        belt-and-suspenders re-statement of the lint zone for the new module.
const SCRIBE = dirname(fileURLToPath(import.meta.url));

// The Layer-2 narration core — the modules that MUST stay SDK-free AND phaser-free.
// Story 4.2 adds `saga.ts` (the SDK-free browser-reachable Saga READER) to this guard: it ships in
// the bundle, so it must import no SDK + no phaser, exactly like the caption core. It is the READER
// only — do NOT add `saga-author.ts` here: that module is SUPPOSED to import @anthropic-ai/sdk
// (R4-allowed in scribe/, browser-UNREACHABLE, tree-shaken). The primary R4 proof for the author is
// the dist-grep + the browser-entry never importing it. [story Task 5 "add 'saga.ts' to SCRIBE_MODULES"]
const SCRIBE_MODULES = ['captions.ts', 'captions-config.ts', 'saga.ts'];

describe('Story 4.1 (R4) — scribe/ caption core imports no @anthropic-ai/sdk (templated, no LLM)', () => {
  for (const file of SCRIBE_MODULES) {
    it(`src/scribe/${file} contains zero references to @anthropic-ai/sdk`, () => {
      const source = readFileSync(join(SCRIBE, file), 'utf8');
      expect(source).not.toContain('@anthropic-ai/sdk');
    });
  }
});

describe('Story 4.1 (R5) — scribe/ caption core imports no phaser (selection lives in Layer 2, display in render/)', () => {
  for (const file of SCRIBE_MODULES) {
    it(`src/scribe/${file} contains zero references to phaser`, () => {
      const source = readFileSync(join(SCRIBE, file), 'utf8');
      // Match the import specifier (the package), tolerant of single/double quotes — not an incidental
      // substring in a comment word. Both `from 'phaser'` and `import('phaser')` forms are caught.
      expect(source).not.toMatch(/['"]phaser['"]/);
    });
  }
});
