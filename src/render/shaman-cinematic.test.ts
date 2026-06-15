// RED-PHASE acceptance test for Story 3.5 (Task 1 + Task 5) — the PURE Fallen-Shaman swarm-clear
// cinematic STATE MACHINE, the bulk of AC1's gate-provable surface. NODE-env (no jsdom): the machine
// is Phaser-FREE by deliberate posture (the sibling of summon-cinematic.ts / animation-plan.ts /
// beat-behavior.ts), so it is unit-testable without a DOM. It FAILS until src/render/shaman-cinematic.ts
// exists and exports the contract below (the import currently resolves to nothing → RED).
//
// AC1 (verbatim): "Given the Shaman's defeat When rendered Then the simultaneous death of all its imps
// plays as one readable wave." The pure machine encodes the SEQUENCE (idle → fall → wave → settle →
// done) and the TERMINAL (`done`, which drives the clean return). The simultaneity-reading / spectacle /
// 60fps / first-time legibility are OPERATOR-verified (jsdom draws nothing, advances no tweens); this
// file proves the ordering + clamp + determinism + the R1 data shape (incl. NO per-imp-HP field — AC1
// "imps are presentation-only").
//
// The contract this test pins (the minimal pure surface the story's Task 1 mandates):
//   export type ShamanCinematicPhase = 'idle' | 'fall' | 'wave' | 'settle' | 'done';
//   export type ShamanCinematicState = { phase: ShamanCinematicPhase; elapsedMs: number };
//   export const FALL_MS / WAVE_MS / SETTLE_MS: number     (per-phase presentation durations)
//   export const SHAMAN_CINEMATIC_TOTAL_MS: number          (= FALL_MS + WAVE_MS + SETTLE_MS)
//   export function initialShamanState(): ShamanCinematicState   (= { phase: 'idle', elapsedMs: 0 })
//   export function startShaman(): ShamanCinematicState          (= { phase: 'fall', elapsedMs: 0 })
//   export function advanceShaman(state, deltaMs): ShamanCinematicState  (pure, deterministic, clamps)
//
// NOTE on phase NAMES: the story documents `idle → fall → wave → settle → done` as the resolved shape
// but EXPLICITLY allows the dev agent to rename on documented merits (e.g. `topple` for `fall`). This
// file pins the documented names; if the dev agent renames, this RED test is the place that contract is
// re-stated — update the literals to the chosen names AND keep the simultaneity of the single `wave`
// beat (it is ONE beat, never a stagger). The load-bearing invariants (sequence, clamp, determinism,
// R1-data, no-imp-HP) hold regardless of the names.
import { describe, expect, it } from 'vitest';
import {
  FALL_MS,
  WAVE_MS,
  SETTLE_MS,
  SHAMAN_CINEMATIC_TOTAL_MS,
  initialShamanState,
  startShaman,
  advanceShaman,
} from './shaman-cinematic';
import type { ShamanCinematicPhase, ShamanCinematicState } from './shaman-cinematic';

describe('Story 3.5 AC1 — the pure shaman cinematic state machine: phase durations + total', () => {
  it('SHAMAN_CINEMATIC_TOTAL_MS is the SUM of the three active-phase durations (one source of truth)', () => {
    // The runner AND the tests share ONE total so they never diverge (the summon-cinematic.ts
    // const-durations precedent). The three active dramatized phases are fall/wave/settle.
    expect(SHAMAN_CINEMATIC_TOTAL_MS).toBe(FALL_MS + WAVE_MS + SETTLE_MS);
  });

  it('each per-phase duration is a finite positive number (a real presentation timing)', () => {
    for (const ms of [FALL_MS, WAVE_MS, SETTLE_MS]) {
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeGreaterThan(0);
    }
  });
});

describe('Story 3.5 AC1 — initial + start states (the resting phase and the first active phase)', () => {
  it('initialShamanState() is the resting frame { phase: idle, elapsedMs: 0 }', () => {
    expect(initialShamanState()).toEqual({ phase: 'idle', elapsedMs: 0 });
  });

  it('startShaman() enters the first active phase { phase: fall, elapsedMs: 0 } (the Shaman/root-cause falls)', () => {
    expect(startShaman()).toEqual({ phase: 'fall', elapsedMs: 0 });
  });

  it('initialShamanState() / startShaman() return FRESH objects per call (no shared mutable state — R2 posture)', () => {
    expect(initialShamanState()).not.toBe(initialShamanState());
    expect(startShaman()).not.toBe(startShaman());
  });
});

describe('Story 3.5 AC1 — the SEQUENCE: fall → wave → settle → done, IN ORDER, never skipped/reordered', () => {
  // Walk the machine by sub-phase deltas and assert the phase at elapsed JUST-BELOW and JUST-ABOVE each
  // documented threshold. The thresholds (per the story's Task 1): cumulative elapsed
  //   < FALL_MS                    → fall
  //   < FALL_MS + WAVE_MS          → wave
  //   < SHAMAN_CINEMATIC_TOTAL_MS  → settle
  //   >= SHAMAN_CINEMATIC_TOTAL_MS → done
  // Driving by cumulative elapsedMs (not an integer step index) lets the SAME machine serve both the
  // real-time rAF cadence (per-frame deltas) AND a synchronous test (one big delta jumps to done).

  it('inside the fall window the phase is fall; crossing FALL_MS advances to wave', () => {
    const start = startShaman();
    expect(start.phase).toBe('fall');
    const justBeforeWave = advanceShaman(start, FALL_MS - 1);
    expect(justBeforeWave.phase).toBe('fall');
    const intoWave = advanceShaman(start, FALL_MS);
    expect(intoWave.phase).toBe('wave');
  });

  it('crossing FALL_MS + WAVE_MS advances from wave to settle', () => {
    const start = startShaman();
    const justBeforeSettle = advanceShaman(start, FALL_MS + WAVE_MS - 1);
    expect(justBeforeSettle.phase).toBe('wave');
    const intoSettle = advanceShaman(start, FALL_MS + WAVE_MS);
    expect(intoSettle.phase).toBe('settle');
  });

  it('reaching SHAMAN_CINEMATIC_TOTAL_MS advances from settle to done (the terminal — clean return fires here)', () => {
    const start = startShaman();
    const justBeforeDone = advanceShaman(start, SHAMAN_CINEMATIC_TOTAL_MS - 1);
    expect(justBeforeDone.phase).toBe('settle');
    const intoDone = advanceShaman(start, SHAMAN_CINEMATIC_TOTAL_MS);
    expect(intoDone.phase).toBe('done');
  });

  it('advancing one sub-phase delta at a time walks fall → wave → settle → done IN ORDER (no skip, no reorder)', () => {
    // Accumulate small forward deltas and record the ordered DISTINCT phases visited. The `wave` phase
    // (the headline AC1 simultaneous-imp-death beat) is ONE entry in this trace — a single beat, not a
    // stagger — exactly the simultaneity the story makes load-bearing.
    let s = startShaman();
    const visited: ShamanCinematicPhase[] = [s.phase];
    const step = 1; // 1ms frames — the finest cadence; guarantees we observe every boundary
    for (let elapsed = 0; elapsed < SHAMAN_CINEMATIC_TOTAL_MS + 5; elapsed += step) {
      s = advanceShaman(s, step);
      if (s.phase !== visited[visited.length - 1]) visited.push(s.phase);
    }
    expect(visited).toEqual(['fall', 'wave', 'settle', 'done']);
  });

  it('accumulates elapsedMs across calls (advance is incremental, not absolute)', () => {
    const start = startShaman();
    const once = advanceShaman(start, 10);
    const twice = advanceShaman(once, 15);
    expect(twice.elapsedMs).toBe(25);
  });
});

describe('Story 3.5 AC1 — clamp + absorbing phases (idle and done)', () => {
  it('advanceShaman from idle STAYS idle (you must startShaman first — idle is absorbing for advance)', () => {
    const idle = initialShamanState();
    const advanced = advanceShaman(idle, SHAMAN_CINEMATIC_TOTAL_MS * 4);
    expect(advanced.phase).toBe('idle');
  });

  it('a single huge delta clamps STRAIGHT to done (out-of-range elapsed → done)', () => {
    const start = startShaman();
    const clamped = advanceShaman(start, SHAMAN_CINEMATIC_TOTAL_MS * 1000);
    expect(clamped.phase).toBe('done');
  });

  it('advancing PAST done STAYS done (done is absorbing — further advances clamp)', () => {
    const done = advanceShaman(startShaman(), SHAMAN_CINEMATIC_TOTAL_MS);
    expect(done.phase).toBe('done');
    const stillDone = advanceShaman(done, SHAMAN_CINEMATIC_TOTAL_MS);
    expect(stillDone.phase).toBe('done');
  });
});

describe('Story 3.5 AC1 — determinism + no input mutation (the pure-layer guarantee)', () => {
  it('advanceShaman(s, d) called twice on the SAME inputs yields deep-equal results (deterministic)', () => {
    const s = startShaman();
    expect(advanceShaman(s, FALL_MS + 5)).toEqual(advanceShaman(s, FALL_MS + 5));
  });

  it('advanceShaman does NOT mutate its input state (snapshot identity preserved)', () => {
    const s = startShaman();
    const before = JSON.stringify(s);
    advanceShaman(s, FALL_MS + WAVE_MS + 5);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('no Date.now / Math.random dependency: phase is a pure function of (state, elapsed) across repeated runs', () => {
    const trace = (): ShamanCinematicPhase[] => {
      let s = startShaman();
      const out: ShamanCinematicPhase[] = [];
      for (let i = 0; i < 6; i++) {
        s = advanceShaman(s, SHAMAN_CINEMATIC_TOTAL_MS / 4);
        out.push(s.phase);
      }
      return out;
    };
    expect(trace()).toEqual(trace());
  });
});

describe('Story 3.5 AC1 — R1 at the DATA level: the cinematic state carries NO mechanics + NO per-imp HP', () => {
  // The cinematic NEVER constructs/holds a BattleState or a mechanics field — it only sequences the
  // DRAMATIZATION (the breakthrough integrity damage already landed in Layer-0). Structural proof: the
  // state object has ONLY { phase, elapsedMs } and none of the BattleState mechanics keys. ADDITIONALLY
  // (AC1 "imps are presentation-only, no per-minion HP"): the state carries NO imp count / minion-HP
  // field — the simultaneous wave is a render concern, never a modeled per-imp number.
  const FORBIDDEN_MECHANICS_KEYS = [
    'problemIntegrity',
    'resolve',
    'insightGauge',
    'hp',
    'enemies',
    'victory',
    'cursor',
    'battleState',
    // AC1 imps-are-presentation-only: no per-imp / minion count or HP leaks into the pure machine.
    'impCount',
    'imps',
    'minionHp',
    'minionCount',
  ];

  function assertNoMechanics(s: ShamanCinematicState): void {
    expect(Object.keys(s).sort()).toEqual(['elapsedMs', 'phase']);
    for (const key of FORBIDDEN_MECHANICS_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(s, key)).toBe(false);
    }
  }

  it('initialShamanState / startShaman carry only { phase, elapsedMs } (no BattleState / mechanics / imp-HP field)', () => {
    assertNoMechanics(initialShamanState());
    assertNoMechanics(startShaman());
  });

  it('every advanced state carries only { phase, elapsedMs } (no mechanics / imp-count leaks across the walk)', () => {
    let s = startShaman();
    for (let i = 0; i < 5; i++) {
      s = advanceShaman(s, SHAMAN_CINEMATIC_TOTAL_MS / 4);
      assertNoMechanics(s);
    }
  });
});
