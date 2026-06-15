import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// RED-PHASE acceptance test for Story 3.2 — AC1 (the R4 clause), the lightweight regression guard.
// It reads the not-yet-authored `freeze.ts` + `eval.ts` sources, so it ERRORS now (RED — the files
// do not exist yet); turns GREEN when the dev authors them SDK-free.
//
// R4 (architecture.md L236-238): @anthropic-ai/sdk is offline/build-time only and MUST NOT be
// browser-reachable. The PRIMARY proof is `grep -ril anthropic dist/` finding NOTHING after
// `pnpm build` (Task 7). This is the belt-and-suspenders source-grep the story asks for: the SDK
// is confined to claude-interpreter.ts + scripts/, so the determinism/eval core MUST stay SDK-free.
//
// CRITICAL: this does NOT grep claude-interpreter.ts — that file is SUPPOSED to import the SDK
// (interpret/ is an R4-re-allowed lint zone). Grepping it would be wrong (Dev Notes "the ONE
// subtlety: lint does NOT flag claude-interpreter.ts").
const INTERPRET = dirname(fileURLToPath(import.meta.url));

// The SDK-free determinism/eval core — the modules that MUST NOT import the LLM SDK.
const SDK_FREE_MODULES = ['freeze.ts', 'eval.ts'];

describe('Story 3.2 / AC1 (R4) — the SDK-free interpret/ core imports no @anthropic-ai/sdk', () => {
  for (const file of SDK_FREE_MODULES) {
    it(`src/interpret/${file} contains zero references to @anthropic-ai/sdk`, () => {
      const source = readFileSync(join(INTERPRET, file), 'utf8');
      expect(source).not.toContain('@anthropic-ai/sdk');
    });
  }
});
