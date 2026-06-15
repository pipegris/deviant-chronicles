import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleTimeline } from '../schema/battle-timeline';

// RED-PHASE acceptance tests for Story 2.2 (Task 4) — the pure, deterministic playback
// reducer that drives a CURSOR over the committed BattleTimeline and emits immutable
// BattleState snapshots. These FAIL until src/model/playback.ts exports
// initialPlaybackState + createPlaybackReducer (the import error is the intended red, exactly
// like battle-model.test.ts was in its own red phase). The assertions encode the REAL ACs:
// SCRUB==PLAY every-cursor equivalence, immutable snapshots, the snapshot invariant,
// run-twice determinism, and the "small typed function, no heavy store" guard.
//
// Pipeline reuse (Dev Notes "The fixture-reading test pattern — copy VERBATIM"): we read the
// COMMITTED ingest fixtures with fs IN THE TEST (tests are not Layer-0 modules, so this respects
// R2) and run the SAME parse -> normalize -> merge -> translate -> pace chain the committed
// golden snapshot pins, then drive the resulting BattleTimeline through the reducer. We do NOT
// re-implement ingest/translate/pace — we import and call them. We REUSE Story 2.1's
// foldBattleState verbatim as the oracle the reducer's snapshots must match.
import { initialPlaybackState, createPlaybackReducer } from './playback';
import type { PlaybackState, PlaybackAction } from './playback';
import { foldBattleState } from './battle-model';
import { pace } from '../pace/derive-beats';
import { translate } from '../translate/translate';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'ingest', '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

// Copied verbatim from src/model/battle-model.test.ts L41-51 (which copied it from pace.test.ts)
// so playback drives the EXACT committed BattleTimeline — including the devMaxEpoch+1 journal
// anchor that orders the orchestrator stream after the dev stream.
function runIngest(): NormalizedEvent[] {
  const transcript = normalizeTranscript(
    parseTranscript(readFixture('sample-transcript.jsonl'), DEV_STREAM_ID),
    DEV_STREAM_ID,
  );
  const devMaxEpoch = Math.max(
    ...transcript.map((e) => Date.parse(e.timestamp)).filter((n) => !Number.isNaN(n)),
  );
  const journal = normalizeJournal(parseJournal(readFixture('sample-journal.jsonl')), devMaxEpoch + 1);
  return mergeStreams([transcript, journal]);
}

// The BattleTimeline the reducer drives: the SAME object pace.test.ts snapshots. Built per-test
// (a fresh object) so the no-mutation assertions cannot be polluted across tests.
function timeline(): BattleTimeline {
  return pace(translate(runIngest()));
}

// Drive N sequential ticks from a fresh paused initial state at speed 1 — "playing to cursor N".
// This is the PLAY half of SCRUB==PLAY; the reducer's only cursor motion is through `tick`/`seek`.
function playToCursor(tl: BattleTimeline, n: number): PlaybackState {
  const reducer = createPlaybackReducer(tl);
  let state = initialPlaybackState(tl);
  for (let i = 0; i < n; i++) state = reducer(state, { type: 'tick' });
  return state;
}

describe('Story 2.2 — fixture sanity (DERIVED from the committed golden timeline, not hardcoded)', () => {
  it('the timeline the reducer drives is the committed 10-beat fixture', () => {
    const tl = timeline();
    expect(tl.beats.length).toBe(10);
  });

  it('initialPlaybackState is PAUSED at cursor 0, speed 1, snapshot = the initial BattleState', () => {
    const tl = timeline();
    const s = initialPlaybackState(tl);
    expect(s.status).toBe('paused');
    expect(s.cursor).toBe(0);
    expect(s.speed).toBe(1);
    // The t=0 snapshot is foldBattleState(tl, 0) = the initial battle state (full bars, not victory).
    expect(s.battleState).toEqual(foldBattleState(tl, 0));
    expect(s.battleState.victory).toBe(false);
  });

  it('initialPlaybackState is FRESH per call (no shared mutable state, R2)', () => {
    const tl = timeline();
    const a = initialPlaybackState(tl);
    const b = initialPlaybackState(tl);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.battleState).not.toBe(b.battleState); // independent snapshot objects
  });
});

describe('Story 2.2 AC1 — SCRUB==PLAY: seek(N) yields the same state as playing to N (the headline)', () => {
  it('for EVERY cursor N in 0..beats.length, seek(N).battleState deep-equals N ticks deep-equals fold(tl, N)', () => {
    const tl = timeline();
    const reducer = createPlaybackReducer(tl);
    const initial = initialPlaybackState(tl);
    for (let n = 0; n <= tl.beats.length; n++) {
      const seeked = reducer(initial, { type: 'seek', cursor: n });
      const played = playToCursor(tl, n);
      // The reducer's snapshot for a seek and for N sequential ticks must be identical (no path
      // dependence — both re-derive via foldBattleState), and both must equal the pure fold oracle.
      expect(seeked.battleState).toEqual(played.battleState);
      expect(seeked.battleState).toEqual(foldBattleState(tl, n));
      // The playback cursor lands exactly at N (clamped) for both routes.
      expect(seeked.cursor).toBe(n);
      expect(played.cursor).toBe(n);
    }
  });
});

describe('Story 2.2 AC1 — immutable snapshots: every transition returns a NEW state, mutates nothing', () => {
  it('each transition returns a object !== the input state', () => {
    const tl = timeline();
    const reducer = createPlaybackReducer(tl);
    const s0 = initialPlaybackState(tl);
    const actions: PlaybackAction[] = [
      { type: 'play' },
      { type: 'pause' },
      { type: 'setSpeed', speed: 2 },
      { type: 'tick' },
      { type: 'seek', cursor: 4 },
      { type: 'restart' },
    ];
    for (const action of actions) {
      const next = reducer(s0, action);
      expect(next).not.toBe(s0);
    }
  });

  it('a transition never mutates the input state object', () => {
    const tl = timeline();
    const reducer = createPlaybackReducer(tl);
    const s0 = initialPlaybackState(tl);
    const before = JSON.stringify(s0);
    reducer(s0, { type: 'seek', cursor: 5 });
    reducer(s0, { type: 'tick' });
    reducer(s0, { type: 'setSpeed', speed: 3 });
    reducer(s0, { type: 'restart' });
    expect(JSON.stringify(s0)).toBe(before);
  });

  it('a full play-through + seeks never mutates the closed-over timeline', () => {
    const tl = timeline();
    const before = JSON.stringify(tl);
    const reducer = createPlaybackReducer(tl);
    let state = initialPlaybackState(tl);
    state = reducer(state, { type: 'play' });
    for (let i = 0; i <= tl.beats.length + 2; i++) state = reducer(state, { type: 'tick' });
    state = reducer(state, { type: 'seek', cursor: 3 });
    state = reducer(state, { type: 'seek', cursor: 7 });
    const final = reducer(state, { type: 'restart' });
    expect(JSON.stringify(tl)).toBe(before);
    // Sanity: the walk really did exercise the reducer (restart landed back at cursor 0).
    expect(final.cursor).toBe(0);
  });
});

describe('Story 2.2 AC1 — the snapshot invariant: battleState is ALWAYS foldBattleState(tl, cursor)', () => {
  it('across a representative walk (play to end, seeks, restart) the snapshot tracks the cursor', () => {
    const tl = timeline();
    const reducer = createPlaybackReducer(tl);
    let state = initialPlaybackState(tl);

    const assertInvariant = (s: PlaybackState) => {
      // The emitted snapshot is consistent with the cursor (path-independent by construction)...
      expect(s.battleState).toEqual(foldBattleState(tl, s.cursor));
      // ...and the BattleState carries its own cursor, kept in lockstep (inherited from Story 2.1).
      expect(s.battleState.cursor).toBe(s.cursor);
    };

    assertInvariant(state);
    state = reducer(state, { type: 'play' });
    for (let i = 0; i < tl.beats.length; i++) {
      state = reducer(state, { type: 'tick' });
      assertInvariant(state);
    }
    state = reducer(state, { type: 'seek', cursor: 2 });
    assertInvariant(state);
    state = reducer(state, { type: 'seek', cursor: 9 });
    assertInvariant(state);
    // The cursor-STATIONARY transitions (pause/play/setSpeed) must ALSO leave the snapshot equal
    // to fold(tl, cursor) — they change only status/speed. Exercise them HERE, at cursor 9, where
    // the fixture's Insight Gauge is charged (g=60) and Resolve is drained — so a transition that
    // silently disturbed the snapshot (e.g. clearing the gauge on pause) would break the invariant.
    state = reducer(state, { type: 'pause' });
    assertInvariant(state);
    state = reducer(state, { type: 'setSpeed', speed: 3 });
    assertInvariant(state);
    state = reducer(state, { type: 'play' });
    assertInvariant(state);
    state = reducer(state, { type: 'restart' });
    assertInvariant(state);
  });
});

describe('Story 2.2 AC2 — determinism: the same action sequence twice yields byte-identical state', () => {
  it('two fresh runs of [setSpeed 2, play, tick, tick, seek 4, restart, tick] are JSON-identical', () => {
    const tl = timeline();
    const sequence: PlaybackAction[] = [
      { type: 'setSpeed', speed: 2 },
      { type: 'play' },
      { type: 'tick' },
      { type: 'tick' },
      { type: 'seek', cursor: 4 },
      { type: 'restart' },
      { type: 'tick' },
    ];

    const run = (): PlaybackState => {
      const reducer = createPlaybackReducer(tl);
      let state = initialPlaybackState(tl);
      for (const action of sequence) state = reducer(state, action);
      return state;
    };

    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});

describe('Story 2.2 AC2 — a small typed function, no heavy store (no Redux/Pinia/XState)', () => {
  it('createPlaybackReducer returns a plain 2-arg function', () => {
    const reducer = createPlaybackReducer(timeline());
    expect(typeof reducer).toBe('function');
    expect(reducer.length).toBe(2); // (state, action) => state
  });

  it('no state-management library is a project dependency (the no-heavy-store constraint)', () => {
    // The AC bans Redux/Pinia/XState. The structural guard: none appears in package.json deps —
    // so the reducer cannot be a thin wrapper over a heavy store. Read the committed manifest.
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const banned of ['redux', '@reduxjs/toolkit', 'pinia', 'xstate', '@xstate/react', 'zustand', 'mobx']) {
      expect(allDeps).not.toHaveProperty(banned);
    }
  });
});
