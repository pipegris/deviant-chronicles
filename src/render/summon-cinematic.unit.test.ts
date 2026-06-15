import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CUTAWAY_MS,
  BLOW_MS,
  DEPART_MS,
  SUMMON_CINEMATIC_TOTAL_MS,
  advanceSummon,
  startSummon,
} from './summon-cinematic';
import type { SummonCinematicPhase } from './summon-cinematic';

// Unit tests for Story 3.4 ON TOP of the ATDD acceptance suite (summon-cinematic.test.ts). They pin
// the R1/R2/R4/R5 STRUCTURAL posture of the new pure module via a fast source-grep (the
// r1-boundary.test.ts convention) — lint is the primary R4/R5 guard, this is the belt-and-suspenders
// regression that fails even if the lint config is later weakened — plus a couple of threshold-edge
// cases the acceptance file does not exhaust. [story Task 4 "Determinism / R1 greps"]

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const SUMMON_CINEMATIC_SRC = readFileSync(join(THIS_DIR, 'summon-cinematic.ts'), 'utf8');

// Strip line + block comments so the greps test EXECUTABLE code, not the module's own prose (the
// header documents R1/R2 etc. by name, which would otherwise self-trip the grep — the same fix the
// 3.2 claude-interpreter no-network grep needed).
function executableCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('Story 3.4 — summon-cinematic.ts is a SELF-CONTAINED pure timeline (R1/R4/R5 structural posture)', () => {
  const code = executableCode(SUMMON_CINEMATIC_SRC);

  it('imports NO phaser (R5 — the pure machine is Phaser-free; the consumer in render/phaser/ holds Phaser)', () => {
    expect(/from\s+['"]phaser['"]/.test(code)).toBe(false);
    expect(/import\s+\*\s+as\s+Phaser/.test(code)).toBe(false);
  });

  it('imports NO @anthropic-ai/sdk (R4 — the cinematic is SDK-free, so it never enters the browser bundle)', () => {
    expect(/@anthropic-ai\/sdk/.test(code)).toBe(false);
    expect(/\banthropic\b/i.test(code)).toBe(false);
  });

  it('has NO nondeterminism source (R2 posture — no Date.now / Math.random / performance.now / IO)', () => {
    expect(/Date\.now/.test(code)).toBe(false);
    expect(/Math\.random/.test(code)).toBe(false);
    expect(/performance\.now/.test(code)).toBe(false);
    expect(/readFileSync|require\(|fetch\(/.test(code)).toBe(false);
  });

  it('imports NO Layer-0 / schema / interpret module (it is a self-contained timeline, not mechanics)', () => {
    // It needs none of schema/ model/ interpret/ — the R1 import-light proof (it carries no mechanics).
    expect(/from\s+['"][^'"]*\/(schema|model|interpret|ingest|translate|pace)\b/.test(code)).toBe(false);
  });

  it('never ASSIGNS a BattleState / mechanics field (R1 data-level — it writes only { phase, elapsedMs })', () => {
    // No assignment to a mechanics key anywhere in the module (the state object carries none).
    for (const key of ['problemIntegrity', 'resolve', 'insightGauge', 'battleState', 'victory']) {
      expect(new RegExp(`${key}\\s*[:=]`).test(code)).toBe(false);
    }
  });
});

describe('Story 3.4 — advanceSummon threshold edges (the per-phase boundaries are half-open lower-inclusive)', () => {
  it('elapsed exactly at a phase boundary enters the NEXT phase (thresholds are `< boundary`)', () => {
    const start = startSummon();
    // At exactly CUTAWAY_MS the cutaway window has ended -> blow (the `< CUTAWAY_MS` rule).
    expect(advanceSummon(start, CUTAWAY_MS).phase).toBe('blow' satisfies SummonCinematicPhase);
    // At exactly CUTAWAY_MS + BLOW_MS the blow window has ended -> depart.
    expect(advanceSummon(start, CUTAWAY_MS + BLOW_MS).phase).toBe('depart' satisfies SummonCinematicPhase);
    // At exactly the total the depart window has ended -> done.
    expect(advanceSummon(start, SUMMON_CINEMATIC_TOTAL_MS).phase).toBe('done' satisfies SummonCinematicPhase);
  });

  it('a zero-delta advance holds the current phase (no time passes, no transition)', () => {
    const start = startSummon();
    expect(advanceSummon(start, 0)).toEqual({ phase: 'cutaway', elapsedMs: 0 });
  });

  it('DEPART_MS is part of the total (the three active durations all contribute)', () => {
    expect(SUMMON_CINEMATIC_TOTAL_MS).toBeGreaterThanOrEqual(CUTAWAY_MS + BLOW_MS + DEPART_MS);
  });
});
