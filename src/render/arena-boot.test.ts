// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleState, BattleTimeline, Beat } from '../schema/battle-timeline';
import type { RenderPort } from './render-port';

// RED-PHASE acceptance tests for Story 2.5 (Task 4) — the INTEGRATION glue: the rAF loop becomes
// play/pause-driven (it ticks ONLY while status==='playing') and the seek/scrub handler SNAPS via
// render() while the forward tick ANIMATES via renderTransition() (honoring the Story 2.4 split).
// These FAIL until arena-boot.ts is refactored to expose a testable seam (see CONTRACT below) and
// the loop is gated on status — today `startArena` returns only the PhaserRenderAdapter and pumps
// `tick` UNCONDITIONALLY, so the destructured `{ controls, dispatch, advanceIfPlaying }` are
// undefined and these assertions throw (the intended red).
//
// WHY drive the seam, not the clock: jsdom DOES define requestAnimationFrame, so startArena() starts
// a genuinely live (250ms-throttled, self-rescheduling) loop in every boot test — but its per-frame
// cadence is not a reliable wall-clock to assert "ticks only while playing" against. So we assert the
// GATE condition by driving the EXTRACTED per-step seam (advanceIfPlaying) directly (Dev Notes
// "Making the boot testable" — extract advanceIfPlaying + inject the adapter). Because that live loop
// would otherwise survive teardown, destroy() MUST cancelAnimationFrame it (the teardown test below
// proves clean teardown; afterEach destroys every boot). The rAF WRAPPER itself stays a thin
// operator-verified shell over advanceIfPlaying.
//
// CONTRACT this test pins (the minimal, backward-compatible refactor the story's Dev Notes endorse):
//   startArena(parent?: string, deps?: { createAdapter?: (parent: string) => RenderPort })
//     => {
//       adapter: RenderPort;                 // the (injected, or real Phaser) RenderPort
//       controls: { root: HTMLElement; sync(): void; destroy(): void };
//       dispatch: (action: PlaybackAction) => void;   // reduces + SNAP-renders seek/restart + syncs
//       advanceIfPlaying: () => void;        // one loop step: ticks + renderTransition IFF playing
//       getState: () => PlaybackState;       // the live boot state (closure)
//       destroy(): void;
//     }
//   `startArena('game-container')` (no deps) MUST still work for main.ts (deps optional w/ defaults).
//
// Pipeline reuse: the same committed-fixture chain as render-port.test.ts L41-55 (copied verbatim),
// so the boot folds the EXACT committed BattleTimeline and foldBattleState is the scrub==play oracle.
import { startArena } from './arena-boot';
import { initialPlaybackState } from '../model/playback';
import type { PlaybackAction, PlaybackState } from '../model/playback';
import { foldBattleState } from '../model/battle-model';
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

function timeline(): BattleTimeline {
  return pace(translate(runIngest()));
}

// A FakeRenderAdapter that RECORDS which path each command took — the render-port.test.ts fake,
// EXTENDED to record renderTransition (Story 2.5 needs to prove seek SNAPS via render() and a
// forward tick ANIMATES via renderTransition()). It holds NO upstream reference (one-way, R5).
class RecordingRenderAdapter implements RenderPort {
  readonly snaps: BattleState[] = []; // render(snapshot) — the SNAP path (seek/scrub, t=0)
  readonly transitions: { prev: BattleState; next: BattleState; beats: Beat[] }[] = []; // animate
  initCalls = 0;
  destroyCalls = 0;

  init(): void {
    this.initCalls += 1;
  }

  render(snapshot: BattleState): void {
    this.snaps.push(snapshot);
  }

  renderTransition(prev: BattleState, next: BattleState, beats: Beat[]): void {
    this.transitions.push({ prev, next, beats });
  }

  destroy(): void {
    this.destroyCalls += 1;
  }
}

// The shape startArena must return for the boot to be drivable headlessly (the CONTRACT above).
type BootHandle = {
  adapter: RenderPort;
  controls: { root: HTMLElement; sync(): void; destroy(): void };
  dispatch: (action: PlaybackAction) => void;
  advanceIfPlaying: () => void;
  getState: () => PlaybackState;
  destroy(): void;
};

// jsdom host: the boot mounts the canvas host (#game-container) + the control bar; create the host
// before each test and tear the boot + host down after (the phaser-render-adapter.test.ts pattern).
let host: HTMLElement;
let booted: BootHandle | undefined;

beforeEach(() => {
  // index.html mounts #app > #game-container; provide both so the boot can append controls into #app.
  const app = document.createElement('div');
  app.id = 'app';
  const gameContainer = document.createElement('div');
  gameContainer.id = 'game-container';
  app.appendChild(gameContainer);
  document.body.appendChild(app);
  host = app;
});

afterEach(() => {
  booted?.destroy();
  booted = undefined;
  host.remove();
  vi.restoreAllMocks();
});

// Boot with the recording fake injected — no Phaser, fast, deterministic.
function bootWithFake(adapter: RenderPort): BootHandle {
  return startArena('game-container', { createAdapter: () => adapter }) as unknown as BootHandle;
}

describe('Story 2.5 AC1 — the rAF loop ticks ONLY while status==="playing" (the headline)', () => {
  it('boots PAUSED at the t=0 frame — a step while paused advances NOTHING', () => {
    const adapter = new RecordingRenderAdapter();
    booted = bootWithFake(adapter);

    // initialPlaybackState is paused at cursor 0 (Dev Notes "Boot now starts PAUSED").
    expect(booted.getState().status).toBe('paused');
    expect(booted.getState().cursor).toBe(0);

    // A loop step while paused is a no-op: the cursor does not move and no transition is animated.
    booted.advanceIfPlaying();
    expect(booted.getState().cursor).toBe(0);
    expect(adapter.transitions).toHaveLength(0);
  });

  it('after dispatching {type:"play"} a step advances the cursor by state.speed and animates it', () => {
    const adapter = new RecordingRenderAdapter();
    booted = bootWithFake(adapter);

    booted.dispatch({ type: 'play' });
    expect(booted.getState().status).toBe('playing');

    const before = booted.getState().cursor;
    booted.advanceIfPlaying();
    // speed defaults to 1, so one step advances exactly one beat...
    expect(booted.getState().cursor).toBe(before + 1);
    // ...and the forward step took the ANIMATED path (renderTransition), NOT a snap.
    expect(adapter.transitions).toHaveLength(1);
    expect(adapter.transitions[0]!.beats).toHaveLength(1);
  });

  it('speed flows through the loop: at speed 2 a step advances 2 beats (a fused 2-beat transition)', () => {
    const adapter = new RecordingRenderAdapter();
    booted = bootWithFake(adapter);

    booted.dispatch({ type: 'setSpeed', speed: 2 });
    booted.dispatch({ type: 'play' });

    const before = booted.getState().cursor;
    booted.advanceIfPlaying();
    expect(booted.getState().cursor).toBe(before + 2);
    // The boot's beatsAdvanced slice spans prev..next, so a speed-2 tick animates a 2-beat transition.
    expect(adapter.transitions).toHaveLength(1);
    expect(adapter.transitions[0]!.beats).toHaveLength(2);
  });
});

describe('Story 2.5 AC2 — seek SNAPS via render(); forward tick ANIMATES via renderTransition()', () => {
  it('a dispatched seek renders via the SNAP path (render) and NOT renderTransition', () => {
    const adapter = new RecordingRenderAdapter();
    booted = bootWithFake(adapter);

    const snapsBefore = adapter.snaps.length; // the boot renders the t=0 frame on init (a snap)
    const transitionsBefore = adapter.transitions.length;

    booted.dispatch({ type: 'seek', cursor: 4 });

    // You cannot tween across a jump: a seek must SNAP (render), never animate (renderTransition).
    expect(adapter.snaps.length).toBe(snapsBefore + 1);
    expect(adapter.transitions.length).toBe(transitionsBefore);
  });

  it('a forward tick (while playing) renders via the ANIMATED path (renderTransition), not a snap', () => {
    const adapter = new RecordingRenderAdapter();
    booted = bootWithFake(adapter);

    booted.dispatch({ type: 'play' });
    const snapsBefore = adapter.snaps.length;

    booted.advanceIfPlaying();

    expect(adapter.transitions.length).toBe(1);
    expect(adapter.snaps.length).toBe(snapsBefore); // the forward step did NOT snap
  });

  it('scrub==play through the boot: a dispatched seek(N) snaps exactly foldBattleState(tl, N)', () => {
    const tl = timeline();
    expect(tl.beats.length).toBeGreaterThan(4); // guard: the committed 10-beat fixture
    const adapter = new RecordingRenderAdapter();
    booted = bootWithFake(adapter);

    for (const n of [1, 4, 7, tl.beats.length]) {
      booted.dispatch({ type: 'seek', cursor: n });
      const snapped = adapter.snaps[adapter.snaps.length - 1]!;
      // The boot reduces seek(N) and SNAP-renders state.battleState; by Story 2.2's path-independence
      // that snapshot is exactly the fold oracle — the boot-level SCRUB==PLAY.
      expect(booted.getState().cursor).toBe(n);
      expect(snapped).toEqual(foldBattleState(tl, n));
    }
  });
});

describe('Story 2.5 — the boot owns state+adapter; mounts controls; tears down cleanly', () => {
  it('renders the t=0 frame on boot and mounts a control bar into the page', () => {
    const tl = timeline();
    const adapter = new RecordingRenderAdapter();
    booted = bootWithFake(adapter);

    // init() was called and the t=0 frame was snapped (foldBattleState(tl, 0)).
    expect(adapter.initCalls).toBe(1);
    expect(adapter.snaps.length).toBeGreaterThanOrEqual(1);
    expect(adapter.snaps[0]).toEqual(foldBattleState(tl, 0));

    // The controls are mounted and present (a play button is reachable in the mounted root).
    expect(booted.controls.root.querySelector('button')).not.toBeNull();
    expect(host.contains(booted.controls.root)).toBe(true);
  });

  it('the dispatch seam reduces real reducer state — restart returns to cursor 0', () => {
    const adapter = new RecordingRenderAdapter();
    booted = bootWithFake(adapter);

    booted.dispatch({ type: 'play' });
    booted.advanceIfPlaying();
    booted.advanceIfPlaying();
    expect(booted.getState().cursor).toBeGreaterThan(0);

    booted.dispatch({ type: 'restart' });
    // restart resets the cursor to 0 (and pauses); the initial-state cursor is the proof.
    expect(booted.getState().cursor).toBe(initialPlaybackState(timeline()).cursor);
    expect(booted.getState().cursor).toBe(0);
    expect(booted.getState().status).toBe('paused');
  });

  it('destroy() tears down the adapter and detaches the control bar', () => {
    const adapter = new RecordingRenderAdapter();
    const handle = bootWithFake(adapter);
    const root = handle.controls.root;

    handle.destroy();

    expect(adapter.destroyCalls).toBe(1);
    expect(host.contains(root)).toBe(false);
    booted = undefined; // already destroyed; do not double-destroy in afterEach
  });

  // F1 regression: jsdom DEFINES rAF, so startArena() starts a genuinely live, self-rescheduling loop.
  // Before the fix nothing captured the rafId, so destroy() left that loop alive — it kept firing
  // advanceIfPlaying() forever (a resource leak; a use-after-destroy renderTransition() while playing).
  // The browser only stops a loop when its in-flight frame is cancelled, so the teardown contract is:
  // destroy() MUST call cancelAnimationFrame on the frame currently in flight. We stub rAF to hand out
  // observable ids (and to NOT auto-run the loop) and assert destroy() cancels the live one. Without the
  // fix cancelAnimationFrame is never called and this fails.
  it('destroy() cancels the in-flight rAF frame (the loop does not leak past teardown)', () => {
    let liveId = 0; // the id rAF most recently handed the boot (what its `let rafId` holds)
    const rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((): number => {
        liveId += 1; // a fresh schedule; never invoke the callback (the loop must not auto-run here)
        return liveId;
      });
    const cancelled: number[] = [];
    const cafSpy = vi
      .spyOn(globalThis, 'cancelAnimationFrame')
      .mockImplementation((id: number): void => {
        cancelled.push(id);
      });

    const adapter = new RecordingRenderAdapter();
    const handle = bootWithFake(adapter); // schedules the first frame via the stub
    handle.dispatch({ type: 'play' }); // playing → an uncancelled frame WOULD advance + animate
    expect(liveId).toBeGreaterThan(0); // a frame is genuinely in flight

    handle.destroy();

    // destroy() cancelled the EXACT frame the boot was holding. With the leak present cancelAnimationFrame
    // is never called, so `cancelled` is empty and this assertion fails — pinning the fix.
    expect(cancelled).toContain(liveId);

    rafSpy.mockRestore();
    cafSpy.mockRestore();
    booted = undefined; // already destroyed; do not double-destroy in afterEach
  });
});

// ---- dev-story UNIT test (on top of the ATDD above): the cursor-STATIONARY actions must NOT
// re-render — only seek/restart (which move the cursor) snap. A spurious snap on play/pause/setSpeed
// would draw the unchanged frame and defeat the animate-forward path. ----

describe('Story 2.5 unit — play/pause/setSpeed are cursor-stationary: they snap NOTHING, only sync', () => {
  it('dispatching play, pause, then setSpeed adds zero render() snaps and zero renderTransition()s', () => {
    const adapter = new RecordingRenderAdapter();
    booted = bootWithFake(adapter);

    const snapsBefore = adapter.snaps.length; // the t=0 boot snap
    const transitionsBefore = adapter.transitions.length;

    booted.dispatch({ type: 'play' });
    booted.dispatch({ type: 'pause' });
    booted.dispatch({ type: 'setSpeed', speed: 2 });

    // None of these move the cursor, so the rendered frame is unchanged — re-rendering would be wasted
    // work (and a snap on play would clobber the animate-forward path). Only the slider/UI sync runs.
    expect(adapter.snaps.length).toBe(snapsBefore);
    expect(adapter.transitions.length).toBe(transitionsBefore);
    // But the state DID change (speed is now 2) — proving the dispatch reduced, it just did not render.
    expect(booted.getState().speed).toBe(2);
  });
});
