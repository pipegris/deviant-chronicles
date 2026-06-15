import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SHATTER_MS,
  SCRATCH_MS,
  REVEAL_MS,
  DISPEL_CINEMATIC_TOTAL_MS,
  advanceDispel,
  startDispel,
} from './dispel-cinematic';
import type { DispelCinematicPhase } from './dispel-cinematic';

// RED-PHASE unit tests for Story 3.5 ON TOP of the ATDD acceptance suite (dispel-cinematic.test.ts).
// They pin the R1/R2/R4/R5 STRUCTURAL posture of the new pure module via a fast source-grep (the
// summon-cinematic.unit.test.ts convention) — lint is the primary R4/R5 guard, this is the
// belt-and-suspenders regression that fails even if the lint config is later weakened — plus a couple
// of threshold-edge cases. Notably, this grep also pins the story's "record-scratch is VISUAL in v0.1,
// the audio is deferred" scope decision: the pure machine must NOT pull an audio loader / AudioContext
// (CLAUDE.md "Nothing speculative"; no runtime network browser-reachable). FAILS until
// src/render/dispel-cinematic.ts exists (the intended RED). [story Task 2 + Task 5]

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const DISPEL_CINEMATIC_SRC = readFileSync(join(THIS_DIR, 'dispel-cinematic.ts'), 'utf8');

function executableCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('Story 3.5 — dispel-cinematic.ts is a SELF-CONTAINED pure timeline (R1/R4/R5 structural posture)', () => {
  const code = executableCode(DISPEL_CINEMATIC_SRC);

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

  it('pulls NO audio loader / AudioContext / <audio> (the record-scratch is VISUAL in v0.1; audio is a deferred asset)', () => {
    // story Dev Notes "Record-scratch: visual-first; audio deferred": do NOT add an ad-hoc audio loader
    // here (no runtime network browser-reachable; CLAUDE.md "Nothing speculative"). The `scratch` phase
    // is the play-on-entry SEAM a future Epic-5 audio asset fills with no structural change.
    expect(/AudioContext|new\s+Audio\b|<audio|\.play\(\)\s*;?\s*\/\/\s*sound/i.test(code)).toBe(false);
  });

  it('imports NO Layer-0 / schema / interpret module (it is a self-contained timeline, not mechanics)', () => {
    expect(/from\s+['"][^'"]*\/(schema|model|interpret|ingest|translate|pace)\b/.test(code)).toBe(false);
  });

  it('never ASSIGNS a BattleState / mechanics field (R1 data-level — it writes only { phase, elapsedMs })', () => {
    // The Dispel's Resolve drain lives in Layer-0; the cinematic computes NO Resolve delta.
    for (const key of ['problemIntegrity', 'resolve', 'insightGauge', 'battleState', 'victory']) {
      expect(new RegExp(`${key}\\s*[:=]`).test(code)).toBe(false);
    }
  });
});

describe('Story 3.5 — advanceDispel threshold edges (the per-phase boundaries are half-open lower-inclusive)', () => {
  it('elapsed exactly at a phase boundary enters the NEXT phase (thresholds are `< boundary`)', () => {
    const start = startDispel();
    expect(advanceDispel(start, SHATTER_MS).phase).toBe('scratch' satisfies DispelCinematicPhase);
    expect(advanceDispel(start, SHATTER_MS + SCRATCH_MS).phase).toBe('reveal' satisfies DispelCinematicPhase);
    expect(advanceDispel(start, DISPEL_CINEMATIC_TOTAL_MS).phase).toBe('done' satisfies DispelCinematicPhase);
  });

  it('a zero-delta advance holds the current phase (no time passes, no transition)', () => {
    const start = startDispel();
    expect(advanceDispel(start, 0)).toEqual({ phase: 'shatter', elapsedMs: 0 });
  });

  it('REVEAL_MS is part of the total (the three active durations all contribute)', () => {
    expect(DISPEL_CINEMATIC_TOTAL_MS).toBeGreaterThanOrEqual(SHATTER_MS + SCRATCH_MS + REVEAL_MS);
  });
});
