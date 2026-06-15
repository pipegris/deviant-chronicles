import { describe, expect, it } from 'vitest';
import type { ActionType } from '../schema/normalized-event';
import type { Beat, BattleTimeline, BattleState } from '../schema/battle-timeline';

type Enemy = BattleState['enemies'][number];

// RED-PHASE unit tests for Story 2.2 (Task 5) — narrow edge cases of the playback reducer:
// restart, seek clamping, tick-past-the-end, play/pause idempotence, setSpeed clamping,
// tick-honours-speed, and the empty timeline. FAIL until src/model/playback.ts exists (the
// import error is the intended red). These drive SYNTHETIC timelines (built directly from the
// committed schema shape) so the edges are exercised without depending on the fixture pacing —
// mirroring battle-model.unit.test.ts's timelineOf() pattern.
import { initialPlaybackState, createPlaybackReducer } from './playback';
import type { PlaybackAction } from './playback';
import { foldBattleState } from './battle-model';
import { MODEL_TUNING } from './model-tuning';

// A synthetic Beat (mechanics only — BeatSchema shape). orderKey/dwellMs/sourceEventIds are
// required by the type but irrelevant to cursor arithmetic; the reducer never reads them.
function beat(actionType: ActionType, weight: number): Beat {
  return {
    orderKey: { logicalClock: 0, streamId: 's', seqWithinStream: 0 },
    actionType,
    sourceEventIds: [],
    weight,
    dwellMs: 0,
  };
}

function timelineOf(beats: Beat[]): BattleTimeline {
  return { schemaVersion: 1, beats, totalDurationMs: 0 };
}

// A timeline whose cumulative melee damage is far more than enough to defeat the Boss, so the
// final fold is a victory (Boss hp 0). Many heavy strikes — the end snapshot is terminal.
// NOTE: each melee at weight 100 deals 100 damage (integrityDamagePerWeight = 1.0), so the Boss
// (hp 100) falls on the FIRST beat — every cursor 1..10 is the identical victory state. That makes
// it the right fixture for the terminal/victory edges, but a POOR oracle for snapshot-preservation
// (a corrupted snapshot field that happens to equal its victory value would be invisible). Use
// gradedTimeline() below whenever a transition must be proven not to disturb a NON-trivial snapshot.
function winnableTimeline(): BattleTimeline {
  return timelineOf(Array.from({ length: 10 }, () => beat('melee', 100)));
}

// A timeline that stays MID-battle the whole way (never victory) and drives every dynamic
// BattleState field through a non-trivial, NON-monotonic trajectory, so its snapshots are a
// strong oracle for "this transition disturbed the snapshot". Folded under MODEL_TUNING
// (integrityDamagePerWeight 1.0, resolveDrainPerWeight 1.0, chargePerStruggle 60,
// dischargeThreshold 50, boss/integrity 100), the per-cursor snapshot is:
//   c0: pi100 res100 g0   victory=false   (initial)
//   c1: pi 80 res100 g0   victory=false   (melee 20)
//   c2: pi 80 res 87 g60  victory=false   (counter: drains Resolve, CHARGES the gauge to 60)
//   c3: pi 70 res 87 g0   victory=false   (melee 10: a breakthrough — DISCHARGES the gauge to 0)
//   c4: pi 65 res 87 g0   victory=false   (melee 5)
//   c5: pi 60 res 87 g0   victory=false   (melee 5)
// Cursor 2 is the linchpin: a snapshot where problemIntegrity, resolve AND insightGauge are ALL
// distinct from their initial/terminal values — so a transition that silently corrupts any one of
// them (e.g. a pause that clears the gauge) cannot hide. CURSOR_CHARGED names it for the tests.
function gradedTimeline(): BattleTimeline {
  return timelineOf([
    beat('melee', 20),
    beat('counter', 13),
    beat('melee', 10),
    beat('melee', 5),
    beat('melee', 5),
  ]);
}
const CURSOR_CHARGED = 2; // the cursor at which gradedTimeline()'s gauge is charged (g=60)

describe('Story 2.2 — restart resets POSITION (cursor 0, paused) but PRESERVES speed', () => {
  it('from a mid/end cursor, restart -> cursor 0, paused, snapshot = fold(tl, 0), speed preserved', () => {
    const tl = winnableTimeline();
    const reducer = createPlaybackReducer(tl);
    // Set speed to 3, play, advance into the timeline, then restart.
    let state = initialPlaybackState(tl);
    state = reducer(state, { type: 'setSpeed', speed: 3 });
    state = reducer(state, { type: 'play' });
    state = reducer(state, { type: 'tick' }); // cursor 3
    state = reducer(state, { type: 'tick' }); // cursor 6
    expect(state.cursor).toBeGreaterThan(0);

    const restarted = reducer(state, { type: 'restart' });
    expect(restarted.cursor).toBe(0);
    expect(restarted.status).toBe('paused');
    expect(restarted.battleState).toEqual(foldBattleState(tl, 0)); // = initial battle state
    expect(restarted.speed).toBe(3); // the speed knob is NOT reset by restart
  });
});

describe('Story 2.2 — seek clamping ([0, beats.length]) is idempotent at the boundaries', () => {
  it('seek(-5) clamps to cursor 0 (the initial snapshot)', () => {
    const tl = winnableTimeline();
    const reducer = createPlaybackReducer(tl);
    const s = reducer(initialPlaybackState(tl), { type: 'seek', cursor: -5 });
    expect(s.cursor).toBe(0);
    expect(s.battleState).toEqual(foldBattleState(tl, 0));
  });

  it('seek past the end clamps to beats.length and equals seek(beats.length) (the terminal state)', () => {
    const tl = winnableTimeline();
    const reducer = createPlaybackReducer(tl);
    const end = reducer(initialPlaybackState(tl), { type: 'seek', cursor: tl.beats.length });
    const over = reducer(initialPlaybackState(tl), { type: 'seek', cursor: tl.beats.length + 99 });
    expect(over.cursor).toBe(tl.beats.length);
    expect(over.battleState).toEqual(end.battleState);
    expect(over.battleState).toEqual(foldBattleState(tl, tl.beats.length));
  });

  it('seek preserves status and speed (scrubbing while playing keeps playing)', () => {
    const tl = winnableTimeline();
    const reducer = createPlaybackReducer(tl);
    let state = initialPlaybackState(tl);
    state = reducer(state, { type: 'setSpeed', speed: 2 });
    state = reducer(state, { type: 'play' });
    const seeked = reducer(state, { type: 'seek', cursor: 5 });
    expect(seeked.status).toBe('playing');
    expect(seeked.speed).toBe(2);
    expect(seeked.cursor).toBe(5);
  });
});

describe('Story 2.2 — seek FLOORS a fractional cursor to a whole beat (the integer-index invariant)', () => {
  // F1 (review follow-up): the Story 2.5 scrubber slider can dispatch a fractional seek, e.g.
  // seek(2.5). cursor is an INTEGER beat index, so it must floor to 2. Without flooring,
  // state.cursor would be 2.5 while foldBattleState folds 3 beats (its loop runs `for i < 2.5`),
  // yielding battleState.cursor=3 — breaking the load-bearing state.cursor === battleState.cursor
  // invariant. gradedTimeline is the oracle: fold(tl,2) (gauge charged) genuinely DIFFERS from
  // fold(tl,3) (discharged), so a wrong floor/ceil is observable in the SNAPSHOT, not just the int.
  it('seek(2.5) -> cursor 2 (floored, not 2.5, not ceil 3) and snapshot == fold(tl, 2)', () => {
    const tl = gradedTimeline();
    const reducer = createPlaybackReducer(tl);
    const seeked = reducer(initialPlaybackState(tl), { type: 'seek', cursor: 2.5 });
    expect(seeked.cursor).toBe(2);
    // The load-bearing invariant: the playback cursor equals the snapshot's own folded cursor.
    expect(seeked.battleState.cursor).toBe(seeked.cursor);
    // And the snapshot is the 2-beat fold (NOT the 3-beat fold a non-floored 2.5 would produce).
    expect(seeked.battleState).toEqual(foldBattleState(tl, 2));
    expect(seeked.battleState).not.toEqual(foldBattleState(tl, 3));
  });

  it('the seek(2.5) cursor is an integer and JSON-round-trips (no fractional poison)', () => {
    const tl = gradedTimeline();
    const reducer = createPlaybackReducer(tl);
    const seeked = reducer(initialPlaybackState(tl), { type: 'seek', cursor: 2.5 });
    expect(Number.isInteger(seeked.cursor)).toBe(true);
    expect(JSON.parse(JSON.stringify(seeked)).cursor).toBe(2);
  });

  // F2 (review follow-up): a non-finite seek (NaN/Infinity from a malformed UI input) must fail
  // CLOSED to cursor 0 rather than poison cursor with NaN. clamp(NaN, 0, len) === NaN (Min/Max
  // propagate NaN), so the unguarded path would fold NaN beats (the initial frame, since `i < NaN`
  // never runs) while leaving cursor=NaN — and JSON.stringify(NaN)==='null' silently breaks AC2.
  it('seek(NaN) -> cursor 0 (fail-closed) with a finite, JSON-round-trippable state', () => {
    const tl = gradedTimeline();
    const reducer = createPlaybackReducer(tl);
    // Start from a non-zero, charged cursor so a fail-closed-to-0 is a real, observable move.
    const charged = reducer(initialPlaybackState(tl), { type: 'seek', cursor: CURSOR_CHARGED });
    const seeked = reducer(charged, { type: 'seek', cursor: NaN });
    expect(seeked.cursor).toBe(0);
    expect(Number.isFinite(seeked.cursor)).toBe(true);
    expect(seeked.battleState).toEqual(foldBattleState(tl, 0)); // the initial frame, not poison
    expect(seeked.battleState.cursor).toBe(0); // invariant intact
    expect(JSON.parse(JSON.stringify(seeked)).cursor).toBe(0); // no NaN -> 'null' degradation
  });

  it('seek(Infinity) fails closed to cursor 0 (non-finite), staying a finite integer', () => {
    const tl = gradedTimeline();
    const reducer = createPlaybackReducer(tl);
    // Infinity is non-finite, so withCursor coerces it to 0 (the same fail-closed path as NaN) —
    // NOT to beats.length. The point of the guard is that the cursor is ALWAYS a finite integer;
    // a malformed UI input never produces an Infinity cursor (which JSON would render as 'null').
    const charged = reducer(initialPlaybackState(tl), { type: 'seek', cursor: CURSOR_CHARGED });
    const seeked = reducer(charged, { type: 'seek', cursor: Infinity });
    expect(Number.isFinite(seeked.cursor)).toBe(true);
    expect(seeked.cursor).toBe(0);
    expect(seeked.battleState).toEqual(foldBattleState(tl, 0));
  });
});

describe('Story 2.2 — tick past the end clamps and holds the victory snapshot (no overshoot)', () => {
  it('a tick with speed > 1 near the end clamps the cursor to beats.length (does not overshoot)', () => {
    const tl = winnableTimeline(); // 10 beats
    const reducer = createPlaybackReducer(tl);
    // Seek to one short of the end, then tick at speed 3 — would land at 11 if unclamped.
    let state = reducer(initialPlaybackState(tl), { type: 'seek', cursor: tl.beats.length - 1 });
    state = reducer(state, { type: 'setSpeed', speed: 3 });
    const ticked = reducer(state, { type: 'tick' });
    expect(ticked.cursor).toBe(tl.beats.length); // pinned at the end, not 12
  });

  it('a further tick at the end is a no-op (cursor + snapshot unchanged)', () => {
    const tl = winnableTimeline();
    const reducer = createPlaybackReducer(tl);
    const atEnd = reducer(initialPlaybackState(tl), { type: 'seek', cursor: tl.beats.length });
    const stillEnd = reducer(atEnd, { type: 'tick' });
    expect(stillEnd.cursor).toBe(tl.beats.length);
    expect(stillEnd.battleState).toEqual(atEnd.battleState);
  });

  it('the end snapshot is the victory state (victory true, Boss hp 0) — inherited from Story 2.1', () => {
    const tl = winnableTimeline();
    const reducer = createPlaybackReducer(tl);
    const atEnd = reducer(initialPlaybackState(tl), { type: 'seek', cursor: tl.beats.length });
    expect(atEnd.battleState.victory).toBe(true);
    const boss = atEnd.battleState.enemies.find((e: Enemy) => e.id === MODEL_TUNING.boss.id);
    expect(boss?.hp).toBe(0);
  });
});

describe('Story 2.2 — play/pause are idempotent and change ONLY status', () => {
  it('play then play == single play; pause then pause == single pause', () => {
    const tl = winnableTimeline();
    const reducer = createPlaybackReducer(tl);
    const s0 = initialPlaybackState(tl);

    const playOnce = reducer(s0, { type: 'play' });
    const playTwice = reducer(playOnce, { type: 'play' });
    expect(JSON.stringify(playTwice)).toBe(JSON.stringify(playOnce));

    const pauseOnce = reducer(playOnce, { type: 'pause' });
    const pauseTwice = reducer(pauseOnce, { type: 'pause' });
    expect(JSON.stringify(pauseTwice)).toBe(JSON.stringify(pauseOnce));
  });

  it('play/pause leave cursor, speed and snapshot byte-identical (only status flips)', () => {
    const tl = winnableTimeline();
    const reducer = createPlaybackReducer(tl);
    let state = initialPlaybackState(tl);
    state = reducer(state, { type: 'setSpeed', speed: 2 });
    state = reducer(state, { type: 'seek', cursor: 4 });

    const played = reducer(state, { type: 'play' });
    expect(played.status).toBe('playing');
    expect(played.cursor).toBe(state.cursor);
    expect(played.speed).toBe(state.speed);
    expect(JSON.stringify(played.battleState)).toBe(JSON.stringify(state.battleState));

    const paused = reducer(played, { type: 'pause' });
    expect(paused.status).toBe('paused');
    expect(paused.cursor).toBe(state.cursor);
    expect(paused.speed).toBe(state.speed);
    expect(JSON.stringify(paused.battleState)).toBe(JSON.stringify(state.battleState));
  });

  // The test above runs over winnableTimeline, whose snapshot at cursor 4 is the terminal victory
  // state (pi 0, res 100, gauge 0) — so a play/pause that CORRUPTED a snapshot field to its
  // victory value would slip through. This test re-proves the same status-only property at a
  // cursor where every dynamic field is non-trivial (gradedTimeline cursor 2: pi 80, res 87,
  // gauge 60), so a snapshot side-effect on play/pause (e.g. clearing the Insight Gauge) is
  // forced to fail. It also pins the snapshot against the pure fold oracle, not just self-equality.
  it('play/pause do NOT disturb a non-trivial snapshot (charged gauge, drained resolve)', () => {
    const tl = gradedTimeline();
    const reducer = createPlaybackReducer(tl);
    const charged = reducer(initialPlaybackState(tl), { type: 'seek', cursor: CURSOR_CHARGED });
    // Precondition: the seeked snapshot really is the rich, charged state (guards the fixture).
    expect(charged.battleState).toEqual(foldBattleState(tl, CURSOR_CHARGED));
    expect(charged.battleState.insightGauge).toBeGreaterThan(0);
    expect(charged.battleState.resolve).toBeLessThan(foldBattleState(tl, 0).resolve);
    expect(charged.battleState.victory).toBe(false);

    const played = reducer(charged, { type: 'play' });
    expect(played.status).toBe('playing');
    expect(played.cursor).toBe(CURSOR_CHARGED);
    expect(played.battleState).toEqual(foldBattleState(tl, CURSOR_CHARGED)); // snapshot untouched

    const paused = reducer(played, { type: 'pause' });
    expect(paused.status).toBe('paused');
    expect(paused.cursor).toBe(CURSOR_CHARGED);
    expect(paused.battleState).toEqual(foldBattleState(tl, CURSOR_CHARGED)); // still untouched
  });
});

describe('Story 2.2 — setSpeed clamps to an integer >= 1 and leaves cursor/snapshot unchanged', () => {
  it('setSpeed(0) -> 1, setSpeed(-3) -> 1, setSpeed(2.7) -> 2 (floored)', () => {
    const tl = winnableTimeline();
    const reducer = createPlaybackReducer(tl);
    const s0 = initialPlaybackState(tl);
    expect(reducer(s0, { type: 'setSpeed', speed: 0 }).speed).toBe(1);
    expect(reducer(s0, { type: 'setSpeed', speed: -3 }).speed).toBe(1);
    expect(reducer(s0, { type: 'setSpeed', speed: 2.7 }).speed).toBe(2);
  });

  it('setSpeed leaves cursor and snapshot unchanged', () => {
    const tl = winnableTimeline();
    const reducer = createPlaybackReducer(tl);
    const state = reducer(initialPlaybackState(tl), { type: 'seek', cursor: 3 });
    const sped = reducer(state, { type: 'setSpeed', speed: 4 });
    expect(sped.cursor).toBe(state.cursor);
    expect(JSON.stringify(sped.battleState)).toBe(JSON.stringify(state.battleState));
  });

  // F2 (review follow-up): a non-finite speed (NaN/Infinity — reachable via the Story 2.5 slider's
  // Number("")/parseFloat of an empty field) must fail CLOSED to the neutral speed 1, NOT poison
  // `speed` with NaN. Math.max(1, Math.floor(NaN)) === NaN, so the unguarded clamp would set
  // speed=NaN; the next tick would fold NaN beats and JSON.stringify(NaN)==='null' would silently
  // break AC2 byte-identity. setSpeed must keep the state a finite, JSON-round-trippable value.
  it('setSpeed(NaN) -> 1 and setSpeed(Infinity) -> stays finite (fail-closed, not a poison value)', () => {
    const tl = gradedTimeline();
    const reducer = createPlaybackReducer(tl);
    const charged = reducer(initialPlaybackState(tl), { type: 'seek', cursor: CURSOR_CHARGED });

    const nan = reducer(charged, { type: 'setSpeed', speed: NaN });
    expect(nan.speed).toBe(1); // neutral, not NaN
    expect(Number.isFinite(nan.speed)).toBe(true);
    // The state stays JSON-finite (no NaN -> 'null' degradation): round-trips without poison.
    expect(JSON.parse(JSON.stringify(nan)).speed).toBe(1);
    // setSpeed touches ONLY speed — the charged snapshot is untouched (a NaN must not corrupt it).
    expect(nan.battleState).toEqual(foldBattleState(tl, CURSOR_CHARGED));

    // A subsequent tick after a NaN-speed must still advance by a finite, sane stride (not NaN).
    const tickedAfterNaN = reducer(nan, { type: 'tick' });
    expect(Number.isFinite(tickedAfterNaN.cursor)).toBe(true);
    expect(tickedAfterNaN.cursor).toBe(CURSOR_CHARGED + 1); // advanced by the clamped speed 1

    // Infinity also fails closed to a finite speed (Math.floor(Infinity) is Infinity, not finite).
    const inf = reducer(charged, { type: 'setSpeed', speed: Infinity });
    expect(Number.isFinite(inf.speed)).toBe(true);
    expect(inf.speed).toBe(1);
  });
});

describe('Story 2.2 — tick honours speed (a pure step multiplier)', () => {
  it('with speed 2, one tick from cursor 0 lands cursor 2 with snapshot == fold(tl, 2) == two speed-1 ticks', () => {
    const tl = winnableTimeline();
    const reducer = createPlaybackReducer(tl);

    // One tick at speed 2.
    let fast = initialPlaybackState(tl);
    fast = reducer(fast, { type: 'setSpeed', speed: 2 });
    fast = reducer(fast, { type: 'tick' });
    expect(fast.cursor).toBe(2);
    expect(fast.battleState).toEqual(foldBattleState(tl, 2));

    // Two ticks at the default speed 1 — must reach the SAME snapshot.
    let slow = initialPlaybackState(tl);
    slow = reducer(slow, { type: 'tick' });
    slow = reducer(slow, { type: 'tick' });
    expect(slow.cursor).toBe(2);
    expect(fast.battleState).toEqual(slow.battleState);
  });

  // Over winnableTimeline the snapshots at cursors 1 and 2 are byte-identical (the Boss dies on
  // beat 1, so every cursor >= 1 is the same victory state). That makes the equalities above
  // pass on the CURSOR number alone — the snapshot at 2 equals the snapshot at 1, so a "tick that
  // advances the cursor but folds the wrong number of beats" could be masked. Re-prove the speed
  // multiplier over gradedTimeline, where fold(tl,1) and fold(tl,2) genuinely DIFFER (cursor 2
  // charges the gauge), so the speed-2 snapshot is pinned to the 2-beat fold specifically.
  it('with speed 2 the landed SNAPSHOT is the 2-beat fold, distinct from the 1-beat fold (graded)', () => {
    const tl = gradedTimeline();
    const reducer = createPlaybackReducer(tl);

    let fast = initialPlaybackState(tl);
    fast = reducer(fast, { type: 'setSpeed', speed: 2 });
    fast = reducer(fast, { type: 'tick' });
    expect(fast.cursor).toBe(2);
    expect(fast.battleState).toEqual(foldBattleState(tl, 2));
    // The discriminating assertion: cursor 1 and cursor 2 snapshots are NOT the same here, so
    // landing on the 2-beat fold (not the 1-beat fold) is a real, observed distinction.
    expect(foldBattleState(tl, 2)).not.toEqual(foldBattleState(tl, 1));
    expect(fast.battleState).not.toEqual(foldBattleState(tl, 1));
  });
});

describe('Story 2.2 — empty timeline: cursor stays 0, snapshot stays initial, no throw', () => {
  it('initialPlaybackState over an empty timeline is at cursor 0', () => {
    const tl = timelineOf([]);
    const s = initialPlaybackState(tl);
    expect(s.cursor).toBe(0);
    expect(s.battleState).toEqual(foldBattleState(tl, 0));
  });

  it('play then tick keeps cursor 0 (clamp to [0,0]) and the snapshot stays the initial state', () => {
    const tl = timelineOf([]);
    const reducer = createPlaybackReducer(tl);
    let state = initialPlaybackState(tl);
    expect(() => {
      state = reducer(state, { type: 'play' });
      state = reducer(state, { type: 'tick' });
      state = reducer(state, { type: 'tick' });
    }).not.toThrow();
    expect(state.cursor).toBe(0);
    expect(state.battleState).toEqual(foldBattleState(tl, 0));
  });
});

// --- dev-story unit tests (on top of the ATDD scaffold) — pin behaviours the story Dev Notes
// document but the ATDD suite did not yet assert: play-at-end is a held victory frame (NOT an
// error/auto-restart), an unknown action is a fail-closed no-op, and createPlaybackReducer's
// closed-over tuning param flows through (NFR-4). ---

describe('Story 2.2 — play at the end is a held victory frame (not an error, not an auto-restart)', () => {
  it('play at the end sets playing without moving the cursor; the next tick is a clamped no-op', () => {
    const tl = winnableTimeline();
    const reducer = createPlaybackReducer(tl);
    const atEnd = reducer(initialPlaybackState(tl), { type: 'seek', cursor: tl.beats.length });

    const playedAtEnd = reducer(atEnd, { type: 'play' });
    expect(playedAtEnd.status).toBe('playing');
    expect(playedAtEnd.cursor).toBe(tl.beats.length); // play does NOT auto-restart to 0
    expect(playedAtEnd.battleState).toEqual(atEnd.battleState);

    const tickedAtEnd = reducer(playedAtEnd, { type: 'tick' });
    expect(tickedAtEnd.cursor).toBe(tl.beats.length); // held victory frame, no overshoot
    expect(tickedAtEnd.battleState).toEqual(atEnd.battleState);
    expect(tickedAtEnd.battleState.victory).toBe(true);
  });
});

describe('Story 2.2 — unknown action is a fail-closed no-op (never throws)', () => {
  it('an action whose type is not in the union returns the same state object', () => {
    const tl = winnableTimeline();
    const reducer = createPlaybackReducer(tl);
    const state = reducer(initialPlaybackState(tl), { type: 'seek', cursor: 3 });
    // A future/unknown action descriptor — the discriminated union does not include it; the
    // reducer's default branch must treat it as a no-op (architecture: fail-closed-to-default).
    const unknown = { type: 'fastForwardToVictory' } as unknown as PlaybackAction;
    const next = reducer(state, unknown);
    expect(next).toBe(state); // identical reference (no fresh state built for a no-op default)
  });
});

describe('Story 2.2 — createPlaybackReducer threads its closed-over tuning (NFR-4 tunability)', () => {
  it('a reducer built with an in-memory tuning variant emits snapshots folded under THAT tuning', () => {
    const tl = winnableTimeline();
    // A weaker strike scalar so the SAME 10x melee timeline no longer fully defeats the Boss —
    // proving the reducer's snapshots come from foldBattleState under the closed-over tuning, not
    // the committed MODEL_TUNING. (No committed config is touched — the variant is in-memory.)
    const weakTuning = {
      ...MODEL_TUNING,
      effects: { ...MODEL_TUNING.effects, integrityDamagePerWeight: 0.001 },
    };
    const reducer = createPlaybackReducer(tl, weakTuning);
    const atEnd = reducer(initialPlaybackState(tl, weakTuning), { type: 'seek', cursor: tl.beats.length });
    // Snapshot must equal the fold under the SAME variant tuning (and differ from the default).
    expect(atEnd.battleState).toEqual(foldBattleState(tl, tl.beats.length, weakTuning));
    expect(atEnd.battleState.victory).toBe(false); // not defeated under the weakened scalar
    expect(atEnd.battleState).not.toEqual(foldBattleState(tl, tl.beats.length));
  });
});
