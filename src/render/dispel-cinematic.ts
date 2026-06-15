// dispel-cinematic — the PURE, Phaser-free, node-testable Dispel shatter cinematic STATE MACHINE
// (FR-8, Story 3.5 Task 2), the sibling of summon-cinematic.ts / shaman-cinematic.ts / beat-behavior.ts.
// It encodes AC2's SEQUENCE — the glass SHATTERS -> the record-SCRATCH jolt (the "stop the music, that's
// wrong" beat, coinciding with the Story-3.3 scribe-correction signal) -> the real situation is REVEALED
// -> the clean return (the terminal) — as an elapsedMs-threshold state machine. ZERO phaser; it is a
// presentation TIMELINE, not mechanics.
//
// WHY a pure machine SEPARABLE from the Phaser tweens (the load-bearing testability decision, inherited
// from Story 3.4): a Phaser tween chain advancing phases via onComplete is NOT unit-testable in jsdom
// (jsdom does not advance Phaser timers/tweens — the documented arena-animation.test.ts L23-28 gap), so
// the SEQUENCE and the CLEAN RETURN would be operator-only. Extracting the phase ORDERING + thresholds
// into a pure function makes the sequence + the terminal GATE-PROVABLE, exactly the posture
// summon-cinematic.ts / shaman-cinematic.ts hold. The Phaser consumer DRIVES its tweens FROM this
// machine's phase. [architecture.md#R1 L225-228; src/render/summon-cinematic.ts L7-22]
//
// PURE + R1-clean (the structural property): no Date.now / Math.random / performance.now / IO /
// module-mutable state — deterministic (same (state, delta) -> deep-equal next) and mutates NEITHER
// input. It imports NO schema/ / model/ / interpret/ (it is a self-contained timeline), reads NO
// BattleState, and returns ONLY DispelCinematicState. The Dispel's wasted-effort Resolve drain ALREADY
// lives in Layer-0 (Story 3.3: "the Dispel's Resolve stagger is a CUE, not a mechanic") — this machine
// dramatizes the recoil/reveal, it does NOT compute a Resolve delta. R2's lint-enforced purity binds
// Layer-0 only; we keep this pure deliberately so it stays node-testable.
// [architecture.md#R1/#R2; src/render/beat-behavior.ts L184; 3-3 story "Honest gaps"]
//
// RECORD-SCRATCH is VISUAL in v0.1 (the `scratch` phase): v0.1 has NO audio pipeline (the asset manifest
// is texture-only — placeholder-textures.ts), so the record-scratch is rendered as a visual jolt
// (freeze-frame / screen-shake / overlay flash) in the Phaser consumer; the audible scratch SOUND is a
// deferred Epic-5/Story-5.3 asset. The `scratch` PHASE is the seam a future audio asset plays on entry
// with NO structural change here — this machine pulls no audio loader / AudioContext (CLAUDE.md "Nothing
// speculative"; no runtime network browser-reachable). [story Dev Notes "Record-scratch: visual-first"]

// The cinematic phases. String-literal union (project convention — NO numeric/native enum). The three
// active phases dramatize AC2's beat: `shatter` = the glass-SHATTER (the Mirage breaks), `scratch` = the
// record-SCRATCH jolt (the moment the Scribe correction lands — the Story-3.3 scribe-correction signal
// fired on this SAME transition; FR-9/Story 4.1 crosses out the caption, NOT here), `reveal` = the real
// situation behind the dispelled illusion is revealed, `done` = returned (the terminal, where the clean
// return fires). `idle` is the pre-start resting phase. The shatter + scratch read as one coincident
// "glass-shatter + record-scratch beat" (AC2) but stay distinct phases so the scratch jolt is its own
// legible moment coincident with the correction. [epics.md#Story-3.5 AC2]
export type DispelCinematicPhase = 'idle' | 'shatter' | 'scratch' | 'reveal' | 'done';

// The transient view state: the current phase + the cumulative elapsed ms since startDispel(). Plain
// `type`, NOT Zod — it is TRANSIENT in-memory state (consumed within playback, never serialized, never
// read from an untrusted source), the same call SummonCinematicState / ShamanCinematicState make. It
// carries NO mechanics field (no BattleState / problemIntegrity / resolve / insightGauge / hp) — the R1
// data-level proof. [src/render/summon-cinematic.ts L30-35]
export type DispelCinematicState = { phase: DispelCinematicPhase; elapsedMs: number };

// Per-phase presentation durations (ms) — render-side timings, not battle tuning, so they live here
// (the summon-cinematic.ts const-durations precedent). Placeholder values; the operator retimes them.
// The three active dramatized phases are shatter / scratch / reveal.
export const SHATTER_MS = 400;
export const SCRATCH_MS = 350;
export const REVEAL_MS = 500;

// The total cinematic span = the sum of the three active-phase durations. Exported so the Phaser
// runner AND the tests share ONE source of truth (they never diverge). [dispel-cinematic.test.ts]
export const DISPEL_CINEMATIC_TOTAL_MS = SHATTER_MS + SCRATCH_MS + REVEAL_MS;

// initialDispelState — the resting frame { phase: 'idle', elapsedMs: 0 }. Fresh per call (no shared
// mutable state — the R2 posture).
export function initialDispelState(): DispelCinematicState {
  return { phase: 'idle', elapsedMs: 0 };
}

// startDispel — enter the first active phase { phase: 'shatter', elapsedMs: 0 } (the glass shatters).
// Fresh per call.
export function startDispel(): DispelCinematicState {
  return { phase: 'shatter', elapsedMs: 0 };
}

// phaseForElapsed — map a cumulative elapsed ms to the active phase by the documented thresholds:
//   elapsed < SHATTER_MS                 -> shatter
//   elapsed < SHATTER_MS + SCRATCH_MS    -> scratch
//   elapsed < DISPEL_CINEMATIC_TOTAL_MS  -> reveal
//   elapsed >= DISPEL_CINEMATIC_TOTAL_MS -> done (clamp)
// Pure: a function of `elapsed` alone. Never returns `idle` — that is a pre-start phase, reached only by
// initialDispelState (advanceDispel from idle stays idle without entering the active sequence).
function phaseForElapsed(elapsed: number): DispelCinematicPhase {
  if (elapsed < SHATTER_MS) return 'shatter';
  if (elapsed < SHATTER_MS + SCRATCH_MS) return 'scratch';
  if (elapsed < DISPEL_CINEMATIC_TOTAL_MS) return 'reveal';
  return 'done';
}

// advanceDispel — the pure transition. Accumulates `deltaMs` into elapsed and maps the cumulative
// elapsed to the phase. `idle` and `done` are ABSORBING:
//   - advancing from `idle` stays `idle` (you must startDispel() first to enter the active sequence),
//   - once `done`, further advances stay `done` (a clamp; an out-of-range elapsed -> done).
// Deterministic + mutates neither input (returns a fresh object). The SAME machine serves both the
// real-time rAF cadence (per-frame deltas) AND a synchronous test (one big delta jumps to `done`).
export function advanceDispel(state: DispelCinematicState, deltaMs: number): DispelCinematicState {
  // idle is absorbing for advance — the cinematic is armed but not playing; nothing accumulates.
  if (state.phase === 'idle') return { phase: 'idle', elapsedMs: state.elapsedMs };
  // done is absorbing — clamp; further advances do not move the phase (the terminal holds).
  if (state.phase === 'done') return { phase: 'done', elapsedMs: state.elapsedMs };
  const elapsedMs = state.elapsedMs + deltaMs;
  return { phase: phaseForElapsed(elapsedMs), elapsedMs };
}
