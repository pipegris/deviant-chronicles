// RED-PHASE acceptance test for Story 3.4 (Task 1 + Task 4) — the PURE THUNDORR-summon cinematic
// STATE MACHINE, the bulk of AC1's gate-provable surface. This is a NODE-env test (no jsdom): the
// machine is Phaser-FREE by deliberate posture (the sibling of animation-plan.ts / beat-behavior.ts),
// so it is unit-testable without a DOM. It FAILS until src/render/summon-cinematic.ts exists and
// exports the contract below (the import currently resolves to nothing → RED).
//
// AC1 (verbatim): "Given a triggered Eidolon Summon When the cinematic plays Then it is a distinct
// full-scene set-piece (time-freeze cutaway → colossal blow → departure) that returns cleanly to the
// arena state." The pure machine encodes the SEQUENCE (idle → cutaway → blow → depart → done) and the
// TERMINAL (`done`, which drives the clean return). The spectacle/legibility/60fps are OPERATOR-verified
// (jsdom draws nothing); this file proves the ordering + clamp + determinism + the R1 data shape.
//
// The contract this test pins (the minimal pure surface the story's Task 1 mandates):
//   export type SummonCinematicPhase = 'idle' | 'cutaway' | 'blow' | 'depart' | 'done';
//   export type SummonCinematicState = { phase: SummonCinematicPhase; elapsedMs: number };
//   export const CUTAWAY_MS / BLOW_MS / DEPART_MS: number  (per-phase presentation durations)
//   export const SUMMON_CINEMATIC_TOTAL_MS: number          (= CUTAWAY_MS + BLOW_MS + DEPART_MS)
//   export function initialSummonState(): SummonCinematicState   (= { phase: 'idle', elapsedMs: 0 })
//   export function startSummon(): SummonCinematicState          (= { phase: 'cutaway', elapsedMs: 0 })
//   export function advanceSummon(state, deltaMs): SummonCinematicState  (pure, deterministic, clamps)
import { describe, expect, it } from 'vitest';
import {
  CUTAWAY_MS,
  BLOW_MS,
  DEPART_MS,
  SUMMON_CINEMATIC_TOTAL_MS,
  initialSummonState,
  startSummon,
  advanceSummon,
} from './summon-cinematic';
import type { SummonCinematicPhase, SummonCinematicState } from './summon-cinematic';

describe('Story 3.4 AC1 — the pure summon cinematic state machine: phase durations + total', () => {
  it('SUMMON_CINEMATIC_TOTAL_MS is the SUM of the four active-phase durations (one source of truth)', () => {
    // The runner AND the tests share ONE total so they never diverge (the animation-plan.ts
    // const-durations precedent). The three active dramatized phases are cutaway/blow/depart.
    expect(SUMMON_CINEMATIC_TOTAL_MS).toBe(CUTAWAY_MS + BLOW_MS + DEPART_MS);
  });

  it('each per-phase duration is a finite positive number (a real presentation timing)', () => {
    for (const ms of [CUTAWAY_MS, BLOW_MS, DEPART_MS]) {
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeGreaterThan(0);
    }
  });
});

describe('Story 3.4 AC1 — initial + start states (the resting phase and the first active phase)', () => {
  it('initialSummonState() is the resting frame { phase: idle, elapsedMs: 0 }', () => {
    expect(initialSummonState()).toEqual({ phase: 'idle', elapsedMs: 0 });
  });

  it('startSummon() enters the first active phase { phase: cutaway, elapsedMs: 0 } (the time-freeze cutaway)', () => {
    expect(startSummon()).toEqual({ phase: 'cutaway', elapsedMs: 0 });
  });

  it('initialSummonState() / startSummon() return FRESH objects per call (no shared mutable state — R2 posture)', () => {
    expect(initialSummonState()).not.toBe(initialSummonState());
    expect(startSummon()).not.toBe(startSummon());
  });
});

describe('Story 3.4 AC1 — the SEQUENCE: cutaway → blow → depart → done, IN ORDER, never skipped/reordered', () => {
  // Walk the machine by sub-phase deltas and assert the phase at elapsed JUST-BELOW and JUST-ABOVE each
  // documented threshold. The thresholds (per the story's Task 1): cumulative elapsed
  //   < CUTAWAY_MS                 → cutaway
  //   < CUTAWAY_MS + BLOW_MS       → blow
  //   < SUMMON_CINEMATIC_TOTAL_MS  → depart
  //   >= SUMMON_CINEMATIC_TOTAL_MS → done
  // Driving by cumulative elapsedMs (not an integer step index) lets the SAME machine serve both the
  // real-time rAF cadence (per-frame deltas) AND a synchronous test (one big delta jumps to done).

  it('inside the cutaway window the phase is cutaway; crossing CUTAWAY_MS advances to blow', () => {
    const start = startSummon();
    expect(start.phase).toBe('cutaway');
    // Just before the cutaway→blow boundary: still cutaway.
    const justBeforeBlow = advanceSummon(start, CUTAWAY_MS - 1);
    expect(justBeforeBlow.phase).toBe('cutaway');
    // Crossing into the blow window: blow.
    const intoBlow = advanceSummon(start, CUTAWAY_MS);
    expect(intoBlow.phase).toBe('blow');
  });

  it('crossing CUTAWAY_MS + BLOW_MS advances from blow to depart', () => {
    const start = startSummon();
    const justBeforeDepart = advanceSummon(start, CUTAWAY_MS + BLOW_MS - 1);
    expect(justBeforeDepart.phase).toBe('blow');
    const intoDepart = advanceSummon(start, CUTAWAY_MS + BLOW_MS);
    expect(intoDepart.phase).toBe('depart');
  });

  it('reaching SUMMON_CINEMATIC_TOTAL_MS advances from depart to done (the terminal — clean return fires here)', () => {
    const start = startSummon();
    const justBeforeDone = advanceSummon(start, SUMMON_CINEMATIC_TOTAL_MS - 1);
    expect(justBeforeDone.phase).toBe('depart');
    const intoDone = advanceSummon(start, SUMMON_CINEMATIC_TOTAL_MS);
    expect(intoDone.phase).toBe('done');
  });

  it('advancing one sub-phase delta at a time walks cutaway → blow → depart → done IN ORDER (no skip, no reorder)', () => {
    // Accumulate small forward deltas and record the ordered DISTINCT phases visited. The machine must
    // visit every phase in canonical order and never regress to an earlier phase.
    let s = startSummon();
    const visited: SummonCinematicPhase[] = [s.phase];
    const step = 1; // 1ms frames — the finest cadence; guarantees we observe every boundary
    for (let elapsed = 0; elapsed < SUMMON_CINEMATIC_TOTAL_MS + 5; elapsed += step) {
      s = advanceSummon(s, step);
      if (s.phase !== visited[visited.length - 1]) visited.push(s.phase);
    }
    // The DISTINCT phase sequence is exactly the canonical forward order — no phase skipped, none repeated
    // out of order (no backward transition).
    expect(visited).toEqual(['cutaway', 'blow', 'depart', 'done']);
  });

  it('accumulates elapsedMs across calls (advance is incremental, not absolute)', () => {
    const start = startSummon();
    const once = advanceSummon(start, 10);
    const twice = advanceSummon(once, 15);
    expect(twice.elapsedMs).toBe(25);
  });
});

describe('Story 3.4 AC1 — clamp + absorbing phases (idle and done)', () => {
  it('advanceSummon from idle STAYS idle (you must startSummon first — idle is absorbing for advance)', () => {
    const idle = initialSummonState();
    const advanced = advanceSummon(idle, SUMMON_CINEMATIC_TOTAL_MS * 4);
    expect(advanced.phase).toBe('idle');
  });

  it('a single huge delta clamps STRAIGHT to done (out-of-range elapsed → done)', () => {
    const start = startSummon();
    const clamped = advanceSummon(start, SUMMON_CINEMATIC_TOTAL_MS * 1000);
    expect(clamped.phase).toBe('done');
  });

  it('advancing PAST done STAYS done (done is absorbing — further advances clamp)', () => {
    const done = advanceSummon(startSummon(), SUMMON_CINEMATIC_TOTAL_MS);
    expect(done.phase).toBe('done');
    const stillDone = advanceSummon(done, SUMMON_CINEMATIC_TOTAL_MS);
    expect(stillDone.phase).toBe('done');
  });
});

describe('Story 3.4 AC1 — determinism + no input mutation (the pure-layer guarantee)', () => {
  it('advanceSummon(s, d) called twice on the SAME inputs yields deep-equal results (deterministic)', () => {
    const s = startSummon();
    expect(advanceSummon(s, CUTAWAY_MS + 5)).toEqual(advanceSummon(s, CUTAWAY_MS + 5));
  });

  it('advanceSummon does NOT mutate its input state (snapshot identity preserved)', () => {
    const s = startSummon();
    const before = JSON.stringify(s);
    advanceSummon(s, CUTAWAY_MS + BLOW_MS + 5);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('no Date.now / Math.random dependency: phase is a pure function of (state, elapsed) across repeated runs', () => {
    // Re-run the entire walk twice and assert byte-identical phase traces — a poison nondeterministic
    // source (clock/RNG) would make these diverge.
    const trace = (): SummonCinematicPhase[] => {
      let s = startSummon();
      const out: SummonCinematicPhase[] = [];
      for (let i = 0; i < 6; i++) {
        s = advanceSummon(s, SUMMON_CINEMATIC_TOTAL_MS / 4);
        out.push(s.phase);
      }
      return out;
    };
    expect(trace()).toEqual(trace());
  });
});

describe('Story 3.4 AC1 — R1 at the DATA level: the cinematic state carries NO mechanics (it is a presentation timeline)', () => {
  // The cinematic NEVER constructs/holds a BattleState or a mechanics field — it only sequences the
  // DRAMATIZATION (the bars already moved in Layer-0). Structural proof: the state object has ONLY
  // { phase, elapsedMs } and none of the BattleState mechanics keys. Mirrors beat-behavior.test.ts's
  // R1 data-level assertions.
  const FORBIDDEN_MECHANICS_KEYS = [
    'problemIntegrity',
    'resolve',
    'insightGauge',
    'hp',
    'enemies',
    'victory',
    'cursor',
    'battleState',
  ];

  function assertNoMechanics(s: SummonCinematicState): void {
    expect(Object.keys(s).sort()).toEqual(['elapsedMs', 'phase']);
    for (const key of FORBIDDEN_MECHANICS_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(s, key)).toBe(false);
    }
  }

  it('initialSummonState / startSummon carry only { phase, elapsedMs } (no BattleState / mechanics field)', () => {
    assertNoMechanics(initialSummonState());
    assertNoMechanics(startSummon());
  });

  it('every advanced state carries only { phase, elapsedMs } (no mechanics leaks in across the walk)', () => {
    let s = startSummon();
    for (let i = 0; i < 5; i++) {
      s = advanceSummon(s, SUMMON_CINEMATIC_TOTAL_MS / 4);
      assertNoMechanics(s);
    }
  });
});
