// summon-cinematic — the PURE, Phaser-free, node-testable THUNDORR-summon cinematic STATE MACHINE
// (FR-8, Story 3.4 Task 1), the sibling of animation-plan.ts / beat-behavior.ts. It encodes AC1's
// SEQUENCE — the time-freeze cutaway -> the colossal blow -> THUNDORR's departure -> the clean return
// (the terminal) — as an elapsedMs-threshold state machine. ZERO phaser; it is a presentation
// TIMELINE, not mechanics.
//
// WHY a pure machine SEPARABLE from the Phaser tweens (the load-bearing testability decision): a
// Phaser Timeline / tween chain advancing phases via onComplete is NOT unit-testable in jsdom (jsdom
// does not advance Phaser timers/tweens — the documented arena-animation.test.ts L23-28 limitation),
// so the SEQUENCE and the CLEAN RETURN (which fires on the terminal `done`) would be operator-only.
// Extracting the phase ORDERING + thresholds into a pure function makes the sequence + the terminal
// GATE-PROVABLE, exactly the posture animation-plan.ts (planAnimations) / beat-behavior.ts
// (planBeatBehaviors) hold. The Phaser consumer DRIVES its tweens FROM this machine's phase.
// [architecture.md#R1 L225-228; src/render/animation-plan.ts L13-19; src/render/beat-behavior.ts L8-24]
//
// PURE + R1-clean (the structural property): no Date.now / Math.random / performance.now / IO /
// module-mutable state — deterministic (same (state, delta) -> deep-equal next) and mutates NEITHER
// input. It imports NO schema/ / model/ / interpret/ (it is a self-contained timeline), reads NO
// BattleState, and returns ONLY SummonCinematicState. It does NOT compute the breakthrough's
// Problem-Integrity damage (that already landed in Layer-0, battle-model.ts) — it only sequences the
// DRAMATIZATION. R2's lint-enforced purity binds Layer-0 only; we keep this pure deliberately so it
// stays node-testable. [architecture.md#R1/#R2; src/render/beat-behavior.ts L16-24]

// The cinematic phases. String-literal union (project convention — NO numeric/native enum). The four
// active/terminal phases dramatize AC1's verbatim sequence: `cutaway` = the time-freeze cutaway,
// `blow` = the colossal blow, `depart` = THUNDORR's departure, `done` = returned (the terminal, where
// the clean return fires). `idle` is the pre-start resting phase. [epics.md#Story-3.4 AC1]
export type SummonCinematicPhase = 'idle' | 'cutaway' | 'blow' | 'depart' | 'done';

// The transient view state: the current phase + the cumulative elapsed ms since startSummon(). Plain
// `type`, NOT Zod — it is TRANSIENT in-memory state (consumed within playback, never serialized, never
// read from an untrusted source), the same call AnimationIntent / PlaybackState make. It carries NO
// mechanics field (no BattleState / problemIntegrity / resolve / insightGauge / hp) — the R1 data-level
// proof. [src/render/animation-plan.ts L50-65; src/model/playback.ts L37-42]
export type SummonCinematicState = { phase: SummonCinematicPhase; elapsedMs: number };

// Per-phase presentation durations (ms) — render-side timings, not battle tuning, so they live here
// (the animation-plan.ts const-durations precedent). Placeholder values; the operator retimes them.
// The three active dramatized phases are cutaway / blow / depart.
export const CUTAWAY_MS = 900;
export const BLOW_MS = 700;
export const DEPART_MS = 800;

// The total cinematic span = the sum of the four active-phase durations. Exported so the Phaser
// runner AND the tests share ONE source of truth (they never diverge). [summon-cinematic.test.ts L34-37]
export const SUMMON_CINEMATIC_TOTAL_MS = CUTAWAY_MS + BLOW_MS + DEPART_MS;

// initialSummonState — the resting frame { phase: 'idle', elapsedMs: 0 }. Fresh per call (no shared
// mutable state — the R2 posture).
export function initialSummonState(): SummonCinematicState {
  return { phase: 'idle', elapsedMs: 0 };
}

// startSummon — enter the first active phase { phase: 'cutaway', elapsedMs: 0 } (the time-freeze
// cutaway begins). Fresh per call.
export function startSummon(): SummonCinematicState {
  return { phase: 'cutaway', elapsedMs: 0 };
}

// phaseForElapsed — map a cumulative elapsed ms to the active phase by the documented thresholds:
//   elapsed < CUTAWAY_MS               -> cutaway
//   elapsed < CUTAWAY_MS + BLOW_MS     -> blow
//   elapsed < SUMMON_CINEMATIC_TOTAL_MS-> depart
//   elapsed >= SUMMON_CINEMATIC_TOTAL_MS -> done (clamp)
// Pure: a function of `elapsed` alone. Never returns `idle` — that is a pre-start phase, reached only
// by initialSummonState (advanceSummon from idle stays idle without entering the active sequence).
function phaseForElapsed(elapsed: number): SummonCinematicPhase {
  if (elapsed < CUTAWAY_MS) return 'cutaway';
  if (elapsed < CUTAWAY_MS + BLOW_MS) return 'blow';
  if (elapsed < SUMMON_CINEMATIC_TOTAL_MS) return 'depart';
  return 'done';
}

// advanceSummon — the pure transition. Accumulates `deltaMs` into elapsed and maps the cumulative
// elapsed to the phase. `idle` and `done` are ABSORBING:
//   - advancing from `idle` stays `idle` (you must startSummon() first to enter the active sequence),
//   - once `done`, further advances stay `done` (a clamp; an out-of-range elapsed -> done).
// Deterministic + mutates neither input (returns a fresh object). The SAME machine serves both the
// real-time rAF cadence (per-frame deltas) AND a synchronous test (one big delta jumps to `done`).
export function advanceSummon(state: SummonCinematicState, deltaMs: number): SummonCinematicState {
  // idle is absorbing for advance — the cinematic is armed but not playing; nothing accumulates.
  if (state.phase === 'idle') return { phase: 'idle', elapsedMs: state.elapsedMs };
  // done is absorbing — clamp; further advances do not move the phase (the terminal holds).
  if (state.phase === 'done') return { phase: 'done', elapsedMs: state.elapsedMs };
  const elapsedMs = state.elapsedMs + deltaMs;
  return { phase: phaseForElapsed(elapsedMs), elapsedMs };
}
