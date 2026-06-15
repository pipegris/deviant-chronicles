import type { BattleState, BattleTimeline } from '../schema/battle-timeline';
import type { ModelTuning } from './model-tuning';
import { foldBattleState } from './battle-model';
import { MODEL_TUNING } from './model-tuning';

// playback — the small, PURE, typed playback reducer (FR-6, Layer 0). A (state, action) => state
// function that drives a playback CURSOR over a fixed BattleTimeline and emits the immutable
// BattleState snapshot the RenderPort (Story 2.3) consumes. This is the second half of the
// architecture's step (5) ("Battle Model + playback reducer") — it WRAPS Story 2.1's pure fold
// (foldBattleState) and re-derives the snapshot from the cursor on every move, so it adds NO
// bar/gauge/victory math of its own; its only "state math" is cursor arithmetic + clamping.
//
// NO HEAVY STORE (architecture decision, restated in AC2): no Redux/Pinia/XState, no
// subscribe/dispatch bus, no middleware, no selectors. A plain pure function + the explicit
// PlaybackAction union is the whole thing.
//
// PURE (R2): no Date.now / Math.random / performance.now / network / fs / module-level mutable
// state anywhere in this module. The reduce's only "memory" is the `state` argument threaded
// through — function-local working memory, NOT global mutable state (the same argument
// battle-model.ts L13-21 / translate.ts make). `speed` is a LOGICAL step multiplier (beats
// advanced per `tick`), NEVER wall-clock; the tick -> wall-clock mapping (requestAnimationFrame /
// dwellMs pacing) is Story 2.5's render loop, which lives in src/render/ (not a Layer-0 module),
// not here. Identical (timeline + action sequence) ALWAYS yields a byte-identical PlaybackState
// (AC2 determinism); there is no golden snapshot — the every-cursor SCRUB==PLAY equality and the
// run-twice byte-identical test are the determinism anchors.
//
// LAYER-0 ONLY (R1): imports only ../schema/* (types — schema/ is not an R1 zone), ./battle-model
// (Story 2.1's pure fold, same layer) and ./model-tuning (the config type/const, same layer). It
// imports NO src/interpret/ (lint-enforced via the ./src/model -> ./src/interpret zone), NO
// phaser (R5), NO @anthropic-ai/sdk (R4), NO state library. It reads NO beatType/annotation and
// re-reads NO raw JSONL (R3) — it consumes the in-memory BattleTimeline only.

// In-memory playback/UI state — NOT a cross-stage serialized artifact, so it gets a plain type,
// not a Zod schema (the project validates at boundaries only; internal hand-offs trust types).
// The BattleState it WRAPS is already Zod-validated by foldBattleState's closing parse, so the
// fail-closed boundary is inherited. `status` is a string-literal union (NO numeric/native enum).
export type PlaybackState = {
  status: 'playing' | 'paused';
  cursor: number;
  speed: number;
  battleState: BattleState;
};

// The minimal discriminated union covering FR-6's v0.1 control set (play / pause / restart /
// scrub(=seek) / speed) plus `tick` (the engine primitive: advance by one logical step, scaled
// by `speed`) that the Story 2.5 real-time loop pumps. `seek` is the imperative verb the
// scrubber control dispatches. No other actions (simplicity-first / YAGNI).
export type PlaybackAction =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'restart' }
  | { type: 'seek'; cursor: number }
  | { type: 'tick' }
  | { type: 'setSpeed'; speed: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// `speed` is an INTEGER >= 1 number of beats advanced per `tick` (a logical step multiplier).
// Flooring + max(1, ...) keeps it a whole number of beats that always moves forward (speed 0 would
// freeze playback even while "playing"; negative has no v0.1 meaning). A non-finite input
// (NaN/Infinity — e.g. Number("") from an empty slider field) fails CLOSED to the neutral speed 1
// rather than OPEN to a poison value: NaN floors to NaN, then every tick folds NaN beats and
// JSON.stringify(NaN)==='null' would silently break AC2 byte-identity. Speed is a runtime UI
// choice (not battle tuning), so it needs no Zod/config key — this is its only validation.
function clampSpeed(speed: number): number {
  return Number.isFinite(speed) ? Math.max(1, Math.floor(speed)) : 1;
}

// The t=0 PlaybackState: PAUSED at cursor 0 with speed 1 (the neutral logical multiplier). The
// snapshot is foldBattleState(timeline, 0) = the initial BattleState (full bars, gauge 0, Boss at
// full hp, victory: false). FRESH per call (no shared mutable state — R2); parallels
// initialBattleState. The reducer needs no "init" action — the initial state is constructed here.
export function initialPlaybackState(
  timeline: BattleTimeline,
  tuning: ModelTuning = MODEL_TUNING,
): PlaybackState {
  return {
    status: 'paused',
    cursor: 0,
    speed: 1,
    battleState: foldBattleState(timeline, 0, tuning),
  };
}

// A FACTORY that closes over the (fixed-for-this-session) timeline + tuning and returns the pure
// (state, action) => state reducer — the canonical reducer shape the architecture mandates and
// that Story 2.5's controls hold and call without re-passing the timeline each dispatch. Closing
// over tuning (default MODEL_TUNING) lets a test build a reducer over an in-memory tuning variant
// (NFR-4 tunability) — the same default-param idiom pace()/foldBattleState() use.
export function createPlaybackReducer(
  timeline: BattleTimeline,
  tuning: ModelTuning = MODEL_TUNING,
): (state: PlaybackState, action: PlaybackAction) => PlaybackState {
  // The shared cursor-mover: the ONE place that clamps the cursor and the ONE place that emits a
  // snapshot. EVERY cursor-changing branch (restart, seek, tick) routes through here, so no branch
  // can forget to re-derive battleState (the bug that would break SCRUB==PLAY). The snapshot is
  // ALWAYS foldBattleState(timeline, clamped) — never a step of the previous snapshot — so
  // path-independence is inherited from Story 2.1's pure fold by construction. foldBattleState
  // also clamps internally and never indexes out of range; clamping `cursor` here too keeps the
  // PlaybackState cursor the truthful clamped value in lockstep with battleState.cursor.
  function withCursor(state: PlaybackState, nextCursor: number): PlaybackState {
    // The cursor is an INTEGER beat index, so floor before clamping: a fractional seek (the Story
    // 2.5 scrubber slider can dispatch seek(2.5)) must land on a whole beat, or state.cursor=2.5
    // while foldBattleState folds 3 beats (its loop runs `for i < 2.5`) — silently breaking the
    // load-bearing state.cursor === battleState.cursor integer invariant. A non-finite seek
    // (NaN/Infinity from a malformed UI input) fails CLOSED to 0 rather than poisoning cursor with
    // a value that JSON.stringify renders as 'null' (AC2 byte-identity).
    const floored = Number.isFinite(nextCursor) ? Math.floor(nextCursor) : 0;
    const cursor = clamp(floored, 0, timeline.beats.length);
    return { ...state, cursor, battleState: foldBattleState(timeline, cursor, tuning) };
  }

  // The pure reducer. Every branch returns a FRESH PlaybackState (never mutates `state`,
  // `state.battleState`, or the closed-over `timeline`). The default is the fail-closed-to-default
  // safety net (with the exhaustive union it is unreachable for known actions, but it keeps an
  // unknown/future action a no-op rather than a throw).
  return function reducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
    switch (action.type) {
      // Sets status only; does NOT move the cursor or auto-advance (advancing is `tick`'s job).
      // Idempotent. "Play at the end" simply sets playing — the next `tick` is a clamped no-op
      // (the viewer sees the held victory frame); NOT an error, NOT an auto-restart.
      case 'play':
        return { ...state, status: 'playing' };

      case 'pause':
        return { ...state, status: 'paused' };

      // Resets POSITION to 0 and pauses (replay semantics: restart to the start, then choose to
      // play). `speed` is PRESERVED — a viewer who set 2x and restarts almost certainly still
      // wants 2x; resetting the speed knob would be a surprising side effect.
      case 'restart':
        return withCursor({ ...state, status: 'paused' }, 0);

      // The SCRUB action: jump to an arbitrary cursor (clamped). `status` and `speed` are PRESERVED
      // (scrubbing while playing keeps playing). SCRUB==PLAY: seek(N) yields exactly the snapshot of
      // N sequential ticks because both re-derive via foldBattleState.
      case 'seek':
        return withCursor(state, action.cursor);

      // The engine primitive: advance the cursor by `state.speed` logical beats. Status-AGNOSTIC by
      // design — gating advancement on `playing` is the CALLER's responsibility (Story 2.5 pumps
      // `tick` only while playing); keeping `tick` a pure "advance by speed" primitive keeps the
      // reducer minimal and the property tests simple. At/past the end the clamp pins the cursor at
      // beats.length (the held victory snapshot) and repeated ticks are no-ops.
      case 'tick':
        return withCursor(state, state.cursor + state.speed);

      case 'setSpeed':
        return { ...state, speed: clampSpeed(action.speed) };

      default:
        return state;
    }
  };
}
