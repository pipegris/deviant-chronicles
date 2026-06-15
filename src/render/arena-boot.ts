import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleTimeline } from '../schema/battle-timeline';
import { createPlaybackReducer, initialPlaybackState } from '../model/playback';
import type { PlaybackAction, PlaybackState } from '../model/playback';
import { pace } from '../pace/derive-beats';
import { translate } from '../translate/translate';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';
import type { RenderPort } from './render-port';
import { PhaserRenderAdapter } from './phaser/phaser-render-adapter';
import { createControls } from './controls';
import type { PlaybackControls } from './controls';

// arena-boot — wires the Story 2.2 playback reducer to the RenderPort adapter AND the Story 2.5
// on-screen CONTROLS. The boot OWNS the reducer state + adapter + controls (one-way: controls
// dispatch, the boot reduces/renders/syncs — nothing flows back upstream, AC1).
//
// Story 2.5 makes the rAF loop play/pause-DRIVEN: it advances ONLY while status==='playing' (the
// boot now starts PAUSED on the t=0 frame). seek/restart SNAP via render() (you cannot tween across
// a jump); the forward tick ANIMATES via renderTransition (the Story 2.4 split). The rAF wall-clock
// lives in render/ (NOT Layer-0); the reducer stays pure/time-free (speed is a LOGICAL multiplier).
//
// Importing ingest/translate/pace from render/ is allowed — R1 only forbids Layer-0 importing
// interpret/; nothing forbids render -> Layer-0. Fixtures are inlined via Vite ?raw (no fs in the
// browser) and are the SAME committed fixtures the golden snapshot folds.
import sampleTranscript from '../ingest/__fixtures__/sample-transcript.jsonl?raw';
import sampleJournal from '../ingest/__fixtures__/sample-journal.jsonl?raw';

const DEV_STREAM_ID = 'aecfc998031eb0576';

function deriveTimeline(): BattleTimeline {
  const transcript = normalizeTranscript(parseTranscript(sampleTranscript, DEV_STREAM_ID), DEV_STREAM_ID);
  const devMaxEpoch = Math.max(
    ...transcript.map((e) => Date.parse(e.timestamp)).filter((n) => !Number.isNaN(n)),
  );
  const journal = normalizeJournal(parseJournal(sampleJournal), devMaxEpoch + 1);
  const events: NormalizedEvent[] = mergeStreams([transcript, journal]);
  return pace(translate(events));
}

// An optional adapter FACTORY (not a ready instance, so the boot keeps its construct-from-parent-id
// ownership) lets a test inject a FakeRenderAdapter without booting Phaser; defaults to the real one.
export type BootDeps = {
  createAdapter?: (parent: string) => RenderPort;
};

// The drivable boot handle: the live state/adapter/controls plus the two seams the headless test
// drives directly (the rAF wrapper is a thin shell over advanceIfPlaying; the gate — advance iff
// playing — is what the unit test asserts).
export type ArenaHandle = {
  adapter: RenderPort;
  controls: PlaybackControls;
  dispatch: (action: PlaybackAction) => void;
  advanceIfPlaying: () => void;
  getState: () => PlaybackState;
  destroy: () => void;
};

// startArena — boot the arena, render the t=0 frame PAUSED, mount the controls, and start the
// status-gated rAF loop. `startArena('game-container')` (no deps) still works for main.ts (deps
// optional with defaults). Returns the drivable handle.
export function startArena(parent = 'game-container', deps: BootDeps = {}): ArenaHandle {
  const timeline = deriveTimeline();
  const reducer = createPlaybackReducer(timeline);
  let state: PlaybackState = initialPlaybackState(timeline);

  const adapter = deps.createAdapter ? deps.createAdapter(parent) : new PhaserRenderAdapter(parent);
  adapter.init();
  adapter.render(state.battleState); // show t=0 (a SNAP)

  // The dispatch seam the controls hold: reduce the action into the live `state`, render cursor-JUMPS
  // via the SNAP path (you cannot tween across a jump), then reflect the new status/cursor/speed into
  // the UI. play/pause/setSpeed do not move the cursor, so they need no re-render — only a sync. The
  // forward `tick` render is NOT here; it stays in the rAF loop (the ANIMATED path, below).
  const dispatch = (action: PlaybackAction): void => {
    state = reducer(state, action);
    if (action.type === 'seek' || action.type === 'restart') {
      adapter.render(state.battleState);
    }
    controls.sync();
  };

  // One loop step, gated on status: advance the cursor by `state.speed` and ANIMATE the transition
  // ONLY while playing. The beatsAdvanced slice spans prev.cursor..next.cursor, so it is multi-beat-
  // safe — a speed>=2 tick animates a fused multi-beat transition with no special-casing. Paused (or
  // at the end, where tick is a clamped no-op) advances nothing and renders nothing.
  const advanceIfPlaying = (): void => {
    if (state.status !== 'playing') return;
    const prev = state.battleState;
    const prevCursor = state.cursor;
    state = reducer(state, { type: 'tick' });
    if (state.cursor === prevCursor) return; // at the end: a clamped no-op, no transition to animate
    const beatsAdvanced = timeline.beats.slice(prevCursor, state.cursor);
    adapter.renderTransition(prev, state.battleState, beatsAdvanced);
    controls.sync();
  };

  // Mount the controls into #app (a sibling below #game-container — the idiomatic media-player
  // layout), falling back to document.body. `getState` is a CLOSURE over the live `state` so the
  // controls always read the current value (dispatch/advance reassign it). speeds [1, 2] = normal/fast.
  const mountHost = (typeof document !== 'undefined' && document.getElementById('app')) || document.body;
  const controls = createControls({
    parent: mountHost,
    beatCount: timeline.beats.length,
    dispatch,
    getState: () => state,
    speeds: [1, 2],
  });

  // Wall-clock drive (render-side, NOT Layer-0): a fixed ~4 steps/sec cadence calls advanceIfPlaying,
  // which is itself the status gate. The loop keeps re-scheduling so a PAUSED arena resumes instantly
  // on PLAY (the callback runs but advances nothing while paused). We CAPTURE the rafId on every
  // schedule so destroy() can cancel the live frame — jsdom DOES define rAF, so this loop genuinely
  // runs (throttled) in the boot test too, and an uncancelled one would survive teardown. Guarded for
  // environments without requestAnimationFrame (the loop simply never starts there).
  let rafId: number | null = null;
  if (typeof requestAnimationFrame === 'function') {
    const stepMs = 250;
    let lastStep = 0;
    const loop = (now: number): void => {
      if (now - lastStep >= stepMs) {
        lastStep = now;
        advanceIfPlaying();
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }

  // destroy() CANCELS the rAF loop FIRST (so no scheduled callback fires advanceIfPlaying() on the
  // torn-down adapter), then tears down controls + adapter. Cancel is guarded for environments
  // without cancelAnimationFrame, and rafId is nulled so a double-destroy is a safe no-op.
  const destroy = (): void => {
    if (rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    controls.destroy();
    adapter.destroy();
  };

  return { adapter, controls, dispatch, advanceIfPlaying, getState: () => state, destroy };
}
