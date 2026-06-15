// shaman-cinematic — the PURE, Phaser-free, node-testable Fallen-Shaman swarm-clear cinematic STATE
// MACHINE (FR-8, Story 3.5 Task 1), the sibling of summon-cinematic.ts / animation-plan.ts /
// beat-behavior.ts. It encodes AC1's SEQUENCE — the Shaman (root cause) falls -> ALL its symptom-imps
// die SIMULTANEOUSLY in ONE readable wave -> the dust settles -> the clean return (the terminal) — as
// an elapsedMs-threshold state machine. ZERO phaser; it is a presentation TIMELINE, not mechanics.
//
// WHY a pure machine SEPARABLE from the Phaser tweens (the load-bearing testability decision, inherited
// from Story 3.4): a Phaser Timeline / tween chain advancing phases via onComplete is NOT unit-testable
// in jsdom (jsdom does not advance Phaser timers/tweens — the documented arena-animation.test.ts
// L23-28 limitation), so the SEQUENCE and the CLEAN RETURN (which fires on the terminal `done`) would be
// operator-only. Extracting the phase ORDERING + thresholds into a pure function makes the sequence +
// the terminal GATE-PROVABLE, exactly the posture summon-cinematic.ts / animation-plan.ts
// (planAnimations) / beat-behavior.ts (planBeatBehaviors) hold. The Phaser consumer DRIVES its tweens
// FROM this machine's phase. [architecture.md#R1 L225-228; src/render/summon-cinematic.ts L7-22]
//
// PURE + R1-clean (the structural property): no Date.now / Math.random / performance.now / IO /
// module-mutable state — deterministic (same (state, delta) -> deep-equal next) and mutates NEITHER
// input. It imports NO schema/ / model/ / interpret/ (it is a self-contained timeline), reads NO
// BattleState, and returns ONLY ShamanCinematicState. It does NOT compute the breakthrough's
// Problem-Integrity damage / gauge discharge (those already landed in Layer-0, battle-model.ts) — it
// only sequences the DRAMATIZATION. It models NO per-imp HP / imp count (AC1: "imps are
// presentation-only"); the simultaneous wave is a render concern, never a modeled number. R2's
// lint-enforced purity binds Layer-0 only; we keep this pure deliberately so it stays node-testable.
// [architecture.md#R1/#R2; src/render/beat-behavior.ts L16-24; 3-3 story "imps are presentation-only"]

// The cinematic phases. String-literal union (project convention — NO numeric/native enum). The three
// active phases dramatize AC1's beat: `fall` = the Shaman (ROOT CAUSE) falls, `wave` = ALL symptom-imps
// die SIMULTANEOUSLY in ONE readable wave (the headline AC1 moment — "root cause vs symptom" felt; it is
// ONE beat, NEVER a stagger), `settle` = the dust clears / the arena settles, `done` = returned (the
// terminal, where the clean return fires). `idle` is the pre-start resting phase. [epics.md#Story-3.5 AC1]
export type ShamanCinematicPhase = 'idle' | 'fall' | 'wave' | 'settle' | 'done';

// The transient view state: the current phase + the cumulative elapsed ms since startShaman(). Plain
// `type`, NOT Zod — it is TRANSIENT in-memory state (consumed within playback, never serialized, never
// read from an untrusted source), the same call SummonCinematicState / AnimationIntent / PlaybackState
// make. It carries NO mechanics field (no BattleState / problemIntegrity / resolve / insightGauge / hp)
// AND NO per-imp count / minion HP — the R1 data-level proof (AC1 imps-are-presentation-only).
// [src/render/summon-cinematic.ts L30-35]
export type ShamanCinematicState = { phase: ShamanCinematicPhase; elapsedMs: number };

// Per-phase presentation durations (ms) — render-side timings, not battle tuning, so they live here
// (the summon-cinematic.ts const-durations precedent). Placeholder values; the operator retimes them.
// The three active dramatized phases are fall / wave / settle.
export const FALL_MS = 700;
export const WAVE_MS = 600;
export const SETTLE_MS = 500;

// The total cinematic span = the sum of the three active-phase durations. Exported so the Phaser
// runner AND the tests share ONE source of truth (they never diverge). [shaman-cinematic.test.ts]
export const SHAMAN_CINEMATIC_TOTAL_MS = FALL_MS + WAVE_MS + SETTLE_MS;

// initialShamanState — the resting frame { phase: 'idle', elapsedMs: 0 }. Fresh per call (no shared
// mutable state — the R2 posture).
export function initialShamanState(): ShamanCinematicState {
  return { phase: 'idle', elapsedMs: 0 };
}

// startShaman — enter the first active phase { phase: 'fall', elapsedMs: 0 } (the Shaman/root-cause
// begins to fall). Fresh per call.
export function startShaman(): ShamanCinematicState {
  return { phase: 'fall', elapsedMs: 0 };
}

// phaseForElapsed — map a cumulative elapsed ms to the active phase by the documented thresholds:
//   elapsed < FALL_MS                    -> fall
//   elapsed < FALL_MS + WAVE_MS          -> wave
//   elapsed < SHAMAN_CINEMATIC_TOTAL_MS  -> settle
//   elapsed >= SHAMAN_CINEMATIC_TOTAL_MS -> done (clamp)
// Pure: a function of `elapsed` alone. Never returns `idle` — that is a pre-start phase, reached only by
// initialShamanState (advanceShaman from idle stays idle without entering the active sequence).
function phaseForElapsed(elapsed: number): ShamanCinematicPhase {
  if (elapsed < FALL_MS) return 'fall';
  if (elapsed < FALL_MS + WAVE_MS) return 'wave';
  if (elapsed < SHAMAN_CINEMATIC_TOTAL_MS) return 'settle';
  return 'done';
}

// advanceShaman — the pure transition. Accumulates `deltaMs` into elapsed and maps the cumulative
// elapsed to the phase. `idle` and `done` are ABSORBING:
//   - advancing from `idle` stays `idle` (you must startShaman() first to enter the active sequence),
//   - once `done`, further advances stay `done` (a clamp; an out-of-range elapsed -> done).
// Deterministic + mutates neither input (returns a fresh object). The SAME machine serves both the
// real-time rAF cadence (per-frame deltas) AND a synchronous test (one big delta jumps to `done`).
export function advanceShaman(state: ShamanCinematicState, deltaMs: number): ShamanCinematicState {
  // idle is absorbing for advance — the cinematic is armed but not playing; nothing accumulates.
  if (state.phase === 'idle') return { phase: 'idle', elapsedMs: state.elapsedMs };
  // done is absorbing — clamp; further advances do not move the phase (the terminal holds).
  if (state.phase === 'done') return { phase: 'done', elapsedMs: state.elapsedMs };
  const elapsedMs = state.elapsedMs + deltaMs;
  return { phase: phaseForElapsed(elapsedMs), elapsedMs };
}
