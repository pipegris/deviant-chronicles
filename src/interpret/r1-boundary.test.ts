import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// RED-PHASE acceptance test for Story 3.1 — AC2 (the R1 clause): "no Layer-0 module imports
// interpret/ (R1, enforced by lint)". Lint (eslint.config.ts L64-90) is the PRIMARY guard;
// this is the belt-and-suspenders regression test the story asks for — a fast, self-
// documenting grep that fails even if someone later weakens the lint config.
//
// This file imports no production module, so it executes at RED. It encodes the standing
// invariant directly: the four Layer-0 dirs must contain ZERO imports of `interpret/`.

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const LAYER0_DIRS = ['ingest', 'translate', 'pace', 'model'];

function tsFilesUnder(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // A Layer-0 dir that does not yet exist trivially contains no interpret/ import.
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsFilesUnder(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      // R1 governs Layer-0 MODULES, not their co-located tests (tests may legitimately
      // import FixtureInterpreter to drive a fixture). Skip *.test.ts so a future Layer-0
      // integration test cannot trip a false R1 failure here.
      out.push(full);
    }
  }
  return out;
}

// Matches `from '.../interpret'`, `from '.../interpret/...'`, dynamic `import('.../interpret...')`,
// and the bare ESM side-effect form `import '.../interpret...'` (which has no `from`).
const INTERPRET_IMPORT = /(?:from\s+|import\(\s*|import\s+)['"][^'"]*\binterpret(?:\/[^'"]*)?['"]/;

describe('Story 3.1 / AC2 (R1) — no Layer-0 module imports the Layer-1 interpret/ overlay', () => {
  for (const layer of LAYER0_DIRS) {
    it(`src/${layer}/**/*.ts contains zero imports of interpret/`, () => {
      const files = tsFilesUnder(join(SRC, layer));
      const offenders = files.filter((f) => INTERPRET_IMPORT.test(readFileSync(f, 'utf8')));
      expect(offenders).toEqual([]);
    });
  }
});
