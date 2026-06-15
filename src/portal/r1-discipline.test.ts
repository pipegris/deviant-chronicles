import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// RED-PHASE source-grep guard for Story 4.3 — the portal/ discipline that lint does NOT enforce (portal/
// has NO eslint zone) but the story FORBIDS. It reads the not-yet-authored portal/ teaching sources, so
// it ERRORS now (RED — the files do not exist yet); it turns GREEN once the dev authors them SDK-free +
// phaser-free. Mirrors scribe/r1-discipline.test.ts (the SCRIBE_MODULES greps) verbatim in shape.
//
// Why a source-grep is the REAL guard here (both beyond what lint catches):
//   R4 — eslint.config.ts confines @anthropic-ai/sdk to scripts/ + src/interpret/ + src/scribe/. portal/
//        is NOT an R4-re-allowed zone, so lint already bans the SDK there; BUT teaching is TEMPLATED
//        config-as-data (NO LLM, NO network — the only LLM calls are the offline Interpreter [3.2] + the
//        offline Saga author [4.2]). portal/ IS browser-reachable (the boot threads it), so a stray SDK
//        import would drag the SDK toward the bundle. The grep is belt-and-suspenders: `grep -ril
//        anthropic dist/` must stay NOTHING.
//   R5 — phaser is confined to render/ + game/. The teaching SELECTION/TEXT lives in portal/ (no phaser);
//        only the DISPLAY lives in render/phaser/. portal/ is lint-banned from importing phaser; this
//        grep re-states it for the new module.
const PORTAL = dirname(fileURLToPath(import.meta.url));

// The browser-reachable portal core — the modules that MUST stay SDK-free AND phaser-free. Story 4.4
// (RED) adds the on-demand Legend's `portal.ts` (the coverage + grounding-resolver core) and
// `legend-config.ts` (the config-as-data loader) to this grep — they are NOT authored yet, so the
// readFileSync below ERRORs on them now (the intended red) and turns green once the dev authors them
// SDK-free + phaser-free. [story Task 2 "Extend r1-discipline.test.ts"; Dev Notes #8]
const PORTAL_MODULES = ['teaching.ts', 'teaching-config.ts', 'portal.ts', 'legend-config.ts'];

describe('Story 4.3 (R4) — portal/ teaching core imports no @anthropic-ai/sdk (templated, no LLM)', () => {
  for (const file of PORTAL_MODULES) {
    it(`src/portal/${file} contains zero references to @anthropic-ai/sdk`, () => {
      const source = readFileSync(join(PORTAL, file), 'utf8');
      expect(source).not.toContain('@anthropic-ai/sdk');
    });
  }
});

describe('Story 4.3 (R5) — portal/ teaching core imports no phaser (selection lives in portal, display in render/)', () => {
  for (const file of PORTAL_MODULES) {
    it(`src/portal/${file} contains zero references to phaser`, () => {
      const source = readFileSync(join(PORTAL, file), 'utf8');
      // Match the import specifier (the package), tolerant of single/double quotes — not an incidental
      // substring in a comment word. Both `from 'phaser'` and `import('phaser')` forms are caught.
      expect(source).not.toMatch(/['"]phaser['"]/);
    });
  }
});

describe('Story 4.3 (R1, data-level) — teaching.ts constructs no BattleState and writes no mechanics field', () => {
  it('src/portal/teaching.ts never assigns a Layer-0 mechanics field on its output (problemIntegrity/resolve/insightGauge/hp/weight)', () => {
    // The R1 data-level proof at the source level: teaching.ts returns ONLY TeachingOp[] (carrying NO
    // mechanics field — dwellMs is a PRESENTATION duration, like BeatBehaviorIntent.durationMs, so it is
    // allowed). It must not write a mechanics key onto its op (e.g. `problemIntegrity:` / `resolve:`).
    // This grep is a coarse belt-and-suspenders companion to the runtime hasOwnProperty checks in
    // teaching.test.ts — a regression that started folding state would likely introduce one of these.
    const source = readFileSync(join(PORTAL, 'teaching.ts'), 'utf8');
    for (const mech of ['problemIntegrity:', 'insightGauge:', 'enemies:']) {
      expect(source).not.toContain(mech);
    }
  });
});

describe('Story 4.4 (R1, data-level) — portal.ts writes no mechanics field (the grounding resolver returns Layer-0 truth)', () => {
  it('src/portal/portal.ts never assigns a Layer-0 mechanics field (problemIntegrity/insightGauge/enemies)', () => {
    // The R1 data-level proof at the source level: resolveGrounding READS the read-only overlay and
    // returns readonly NormalizedEvent[] — it constructs/returns NO BattleState/Beat and writes NO
    // mechanics field onto its output. A regression that started folding state would likely introduce
    // one of these assignments. Mirrors the teaching.ts no-mechanics block above. RED until portal.ts
    // exists (this readFileSync ERRORs now). [story Task 2; Dev Notes #4 "the R1 data-level proof"]
    const source = readFileSync(join(PORTAL, 'portal.ts'), 'utf8');
    for (const mech of ['problemIntegrity:', 'insightGauge:', 'enemies:']) {
      expect(source).not.toContain(mech);
    }
  });
});
