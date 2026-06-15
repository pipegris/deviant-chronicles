import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FALL_MS,
  WAVE_MS,
  SETTLE_MS,
  SHAMAN_CINEMATIC_TOTAL_MS,
  advanceShaman,
  startShaman,
} from './shaman-cinematic';
import type { ShamanCinematicPhase } from './shaman-cinematic';

// RED-PHASE unit tests for Story 3.5 ON TOP of the ATDD acceptance suite (shaman-cinematic.test.ts).
// They pin the R1/R2/R4/R5 STRUCTURAL posture of the new pure module via a fast source-grep (the
// summon-cinematic.unit.test.ts / r1-boundary.test.ts convention) — lint is the primary R4/R5 guard,
// this is the belt-and-suspenders regression that fails even if the lint config is later weakened —
// plus a couple of threshold-edge cases the acceptance file does not exhaust. FAILS until
// src/render/shaman-cinematic.ts exists (readFileSync throws on a missing file, and the named imports
// resolve to nothing — the intended RED). [story Task 5 "R1/R4/R5/R2-posture source greps"]

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const SHAMAN_CINEMATIC_SRC = readFileSync(join(THIS_DIR, 'shaman-cinematic.ts'), 'utf8');

// Strip line + block comments so the greps test EXECUTABLE code, not the module's own prose (the
// header documents R1/R2 etc. by name, which would otherwise self-trip the grep — the same fix the
// summon-cinematic.unit.test.ts header documents).
function executableCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('Story 3.5 — shaman-cinematic.ts is a SELF-CONTAINED pure timeline (R1/R4/R5 structural posture)', () => {
  const code = executableCode(SHAMAN_CINEMATIC_SRC);

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
    expect(/from\s+['"][^'"]*\/(schema|model|interpret|ingest|translate|pace)\b/.test(code)).toBe(false);
  });

  it('never ASSIGNS a BattleState / mechanics / per-imp field (R1 data-level — it writes only { phase, elapsedMs })', () => {
    // No assignment to a mechanics or per-imp key anywhere in the module (the state object carries none).
    // AC1 "imps are presentation-only": the pure machine must not model an imp count / minion HP.
    for (const key of ['problemIntegrity', 'resolve', 'insightGauge', 'battleState', 'victory', 'impCount', 'minionHp']) {
      expect(new RegExp(`${key}\\s*[:=]`).test(code)).toBe(false);
    }
  });
});

describe('Story 3.5 — advanceShaman threshold edges (the per-phase boundaries are half-open lower-inclusive)', () => {
  it('elapsed exactly at a phase boundary enters the NEXT phase (thresholds are `< boundary`)', () => {
    const start = startShaman();
    expect(advanceShaman(start, FALL_MS).phase).toBe('wave' satisfies ShamanCinematicPhase);
    expect(advanceShaman(start, FALL_MS + WAVE_MS).phase).toBe('settle' satisfies ShamanCinematicPhase);
    expect(advanceShaman(start, SHAMAN_CINEMATIC_TOTAL_MS).phase).toBe('done' satisfies ShamanCinematicPhase);
  });

  it('a zero-delta advance holds the current phase (no time passes, no transition)', () => {
    const start = startShaman();
    expect(advanceShaman(start, 0)).toEqual({ phase: 'fall', elapsedMs: 0 });
  });

  it('SETTLE_MS is part of the total (the three active durations all contribute)', () => {
    expect(SHAMAN_CINEMATIC_TOTAL_MS).toBeGreaterThanOrEqual(FALL_MS + WAVE_MS + SETTLE_MS);
  });
});
