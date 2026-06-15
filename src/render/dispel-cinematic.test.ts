// RED-PHASE acceptance test for Story 3.5 (Task 2 + Task 5) — the PURE Dispel shatter cinematic STATE
// MACHINE, the bulk of AC2's gate-provable surface. NODE-env (no jsdom): the machine is Phaser-FREE by
// deliberate posture (the sibling of summon-cinematic.ts / shaman-cinematic.ts / beat-behavior.ts), so
// it is unit-testable without a DOM. It FAILS until src/render/dispel-cinematic.ts exists and exports
// the contract below (the import currently resolves to nothing → RED).
//
// AC2 (verbatim): "Given a Dispel When rendered Then it shows a glass-shatter + record-scratch beat and
// a visible Scribe correction (paired with FR-9) And both beats are legible to a first-time viewer
// without prior explanation." The pure machine encodes the SEQUENCE (idle → shatter → scratch → reveal
// → done) and the TERMINAL (`done`, which drives the clean return). The glass-shatter/record-scratch
// READING, the first-time legibility, and 60fps are OPERATOR-verified (jsdom draws nothing, advances no
// tweens; the audible scratch is a deferred Epic-5 asset). This file proves the ordering + clamp +
// determinism + the R1 data shape. The COINCIDENCE of the shatter with the scribe-correction signal is
// proven in arena-boot-shaman-dispel.test.ts (the boot wiring), not here.
//
// The contract this test pins (the minimal pure surface the story's Task 2 mandates):
//   export type DispelCinematicPhase = 'idle' | 'shatter' | 'scratch' | 'reveal' | 'done';
//   export type DispelCinematicState = { phase: DispelCinematicPhase; elapsedMs: number };
//   export const SHATTER_MS / SCRATCH_MS / REVEAL_MS: number  (per-phase presentation durations)
//   export const DISPEL_CINEMATIC_TOTAL_MS: number             (= SHATTER_MS + SCRATCH_MS + REVEAL_MS)
//   export function initialDispelState(): DispelCinematicState   (= { phase: 'idle', elapsedMs: 0 })
//   export function startDispel(): DispelCinematicState          (= { phase: 'shatter', elapsedMs: 0 })
//   export function advanceDispel(state, deltaMs): DispelCinematicState  (pure, deterministic, clamps)
//
// NOTE on phase NAMES: the story documents `idle → shatter → scratch → reveal → done` but EXPLICITLY
// allows the dev agent to collapse shatter+scratch into ONE phase if that reads as a single coincident
// "glass-shatter + record-scratch beat" (AC2 phrases them as one beat) — recording the rationale,
// keeping BOTH the glass-break read AND the record-scratch jolt present and coincident with the
// correction signal. This file pins the documented 3-active-phase shape; if the dev agent collapses to
// 2 active phases, this RED test is the place that contract is re-stated — update the phase literals +
// the threshold walk to the chosen shape. The load-bearing invariants (sequence, clamp, determinism,
// R1-data) hold regardless.
import { describe, expect, it } from 'vitest';
import {
  SHATTER_MS,
  SCRATCH_MS,
  REVEAL_MS,
  DISPEL_CINEMATIC_TOTAL_MS,
  initialDispelState,
  startDispel,
  advanceDispel,
} from './dispel-cinematic';
import type { DispelCinematicPhase, DispelCinematicState } from './dispel-cinematic';

describe('Story 3.5 AC2 — the pure dispel cinematic state machine: phase durations + total', () => {
  it('DISPEL_CINEMATIC_TOTAL_MS is the SUM of the three active-phase durations (one source of truth)', () => {
    expect(DISPEL_CINEMATIC_TOTAL_MS).toBe(SHATTER_MS + SCRATCH_MS + REVEAL_MS);
  });

  it('each per-phase duration is a finite positive number (a real presentation timing)', () => {
    for (const ms of [SHATTER_MS, SCRATCH_MS, REVEAL_MS]) {
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeGreaterThan(0);
    }
  });
});

describe('Story 3.5 AC2 — initial + start states (the resting phase and the first active phase)', () => {
  it('initialDispelState() is the resting frame { phase: idle, elapsedMs: 0 }', () => {
    expect(initialDispelState()).toEqual({ phase: 'idle', elapsedMs: 0 });
  });

  it('startDispel() enters the first active phase { phase: shatter, elapsedMs: 0 } (the glass shatters)', () => {
    expect(startDispel()).toEqual({ phase: 'shatter', elapsedMs: 0 });
  });

  it('initialDispelState() / startDispel() return FRESH objects per call (no shared mutable state — R2 posture)', () => {
    expect(initialDispelState()).not.toBe(initialDispelState());
    expect(startDispel()).not.toBe(startDispel());
  });
});

describe('Story 3.5 AC2 — the SEQUENCE: shatter → scratch → reveal → done, IN ORDER, never skipped/reordered', () => {
  // The documented thresholds (per the story's Task 2): cumulative elapsed
  //   < SHATTER_MS                 → shatter
  //   < SHATTER_MS + SCRATCH_MS    → scratch
  //   < DISPEL_CINEMATIC_TOTAL_MS  → reveal
  //   >= DISPEL_CINEMATIC_TOTAL_MS → done

  it('inside the shatter window the phase is shatter; crossing SHATTER_MS advances to scratch', () => {
    const start = startDispel();
    expect(start.phase).toBe('shatter');
    const justBeforeScratch = advanceDispel(start, SHATTER_MS - 1);
    expect(justBeforeScratch.phase).toBe('shatter');
    const intoScratch = advanceDispel(start, SHATTER_MS);
    expect(intoScratch.phase).toBe('scratch');
  });

  it('crossing SHATTER_MS + SCRATCH_MS advances from scratch to reveal', () => {
    const start = startDispel();
    const justBeforeReveal = advanceDispel(start, SHATTER_MS + SCRATCH_MS - 1);
    expect(justBeforeReveal.phase).toBe('scratch');
    const intoReveal = advanceDispel(start, SHATTER_MS + SCRATCH_MS);
    expect(intoReveal.phase).toBe('reveal');
  });

  it('reaching DISPEL_CINEMATIC_TOTAL_MS advances from reveal to done (the terminal — clean return fires here)', () => {
    const start = startDispel();
    const justBeforeDone = advanceDispel(start, DISPEL_CINEMATIC_TOTAL_MS - 1);
    expect(justBeforeDone.phase).toBe('reveal');
    const intoDone = advanceDispel(start, DISPEL_CINEMATIC_TOTAL_MS);
    expect(intoDone.phase).toBe('done');
  });

  it('advancing one sub-phase delta at a time walks shatter → scratch → reveal → done IN ORDER (no skip, no reorder)', () => {
    let s = startDispel();
    const visited: DispelCinematicPhase[] = [s.phase];
    const step = 1; // 1ms frames — the finest cadence; guarantees we observe every boundary
    for (let elapsed = 0; elapsed < DISPEL_CINEMATIC_TOTAL_MS + 5; elapsed += step) {
      s = advanceDispel(s, step);
      if (s.phase !== visited[visited.length - 1]) visited.push(s.phase);
    }
    expect(visited).toEqual(['shatter', 'scratch', 'reveal', 'done']);
  });

  it('accumulates elapsedMs across calls (advance is incremental, not absolute)', () => {
    const start = startDispel();
    const once = advanceDispel(start, 10);
    const twice = advanceDispel(once, 15);
    expect(twice.elapsedMs).toBe(25);
  });
});

describe('Story 3.5 AC2 — clamp + absorbing phases (idle and done)', () => {
  it('advanceDispel from idle STAYS idle (you must startDispel first — idle is absorbing for advance)', () => {
    const idle = initialDispelState();
    const advanced = advanceDispel(idle, DISPEL_CINEMATIC_TOTAL_MS * 4);
    expect(advanced.phase).toBe('idle');
  });

  it('a single huge delta clamps STRAIGHT to done (out-of-range elapsed → done)', () => {
    const start = startDispel();
    const clamped = advanceDispel(start, DISPEL_CINEMATIC_TOTAL_MS * 1000);
    expect(clamped.phase).toBe('done');
  });

  it('advancing PAST done STAYS done (done is absorbing — further advances clamp)', () => {
    const done = advanceDispel(startDispel(), DISPEL_CINEMATIC_TOTAL_MS);
    expect(done.phase).toBe('done');
    const stillDone = advanceDispel(done, DISPEL_CINEMATIC_TOTAL_MS);
    expect(stillDone.phase).toBe('done');
  });
});

describe('Story 3.5 AC2 — determinism + no input mutation (the pure-layer guarantee)', () => {
  it('advanceDispel(s, d) called twice on the SAME inputs yields deep-equal results (deterministic)', () => {
    const s = startDispel();
    expect(advanceDispel(s, SHATTER_MS + 5)).toEqual(advanceDispel(s, SHATTER_MS + 5));
  });

  it('advanceDispel does NOT mutate its input state (snapshot identity preserved)', () => {
    const s = startDispel();
    const before = JSON.stringify(s);
    advanceDispel(s, SHATTER_MS + SCRATCH_MS + 5);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('no Date.now / Math.random dependency: phase is a pure function of (state, elapsed) across repeated runs', () => {
    const trace = (): DispelCinematicPhase[] => {
      let s = startDispel();
      const out: DispelCinematicPhase[] = [];
      for (let i = 0; i < 6; i++) {
        s = advanceDispel(s, DISPEL_CINEMATIC_TOTAL_MS / 4);
        out.push(s.phase);
      }
      return out;
    };
    expect(trace()).toEqual(trace());
  });
});

describe('Story 3.5 AC2 — R1 at the DATA level: the cinematic state carries NO mechanics (it is a presentation timeline)', () => {
  // The Dispel's wasted-effort Resolve drain ALREADY lives in Layer-0 (Story 3.3 "the Dispel's Resolve
  // stagger is a CUE, not a mechanic"); the cinematic dramatizes the recoil/reveal, it does NOT compute
  // a Resolve delta. Structural proof: the state object has ONLY { phase, elapsedMs } and none of the
  // BattleState mechanics keys.
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

  function assertNoMechanics(s: DispelCinematicState): void {
    expect(Object.keys(s).sort()).toEqual(['elapsedMs', 'phase']);
    for (const key of FORBIDDEN_MECHANICS_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(s, key)).toBe(false);
    }
  }

  it('initialDispelState / startDispel carry only { phase, elapsedMs } (no BattleState / mechanics field)', () => {
    assertNoMechanics(initialDispelState());
    assertNoMechanics(startDispel());
  });

  it('every advanced state carries only { phase, elapsedMs } (no mechanics leaks in across the walk)', () => {
    let s = startDispel();
    for (let i = 0; i < 5; i++) {
      s = advanceDispel(s, DISPEL_CINEMATIC_TOTAL_MS / 4);
      assertNoMechanics(s);
    }
  });
});
