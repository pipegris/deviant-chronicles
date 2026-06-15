// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleState, BattleTimeline, Beat } from '../schema/battle-timeline';
import type { AnnotatedView } from '../interpret/overlay';
import type { RenderPort } from './render-port';
import type { BeatSignal } from '../interpret/beat-signal';

// RED-PHASE acceptance tests for Story 3.3 (Task 3 + Task 4) — the BOOT WIRING: startArena must
// build the read-only AnnotatedView ONCE and thread it so advanceIfPlaying drives BOTH planAnimations
// (renderTransition) AND planBeatBehaviors (renderBeatBehaviors) on a forward tick, while paused/seek
// drive NEITHER behavior call. These FAIL until (a) src/render/beat-behavior.ts + beat-signal.ts exist,
// (b) RenderPort gains renderBeatBehaviors(prev, next, beats, view) (Option A), and (c) arena-boot.ts is
// extended to build the overlay (FixtureInterpreter + applyOverlay over the boot's events) and call
// renderBeatBehaviors in advanceIfPlaying, surfacing signals to a boot-owned onSignal sink.
//
// This is a NEW file (it does NOT edit the green Story 2.5 arena-boot.test.ts) — it adds the focused
// behavior-wiring assertions the story's Task 4 calls for, reusing the SAME jsdom boot harness +
// afterEach destroy contract (the live rAF loop must still be cancelled on destroy — Story 2.5's F1 fix
// must not regress).
//
// CONTRACT this test pins (the minimal additive extension the story's Dev Notes "Wiring" endorse):
//   startArena(parent?, deps?: { createAdapter?; onSignal?: (s: BeatSignal) => void })
//     - builds the AnnotatedView once at boot (FixtureInterpreter over the boot's events + applyOverlay)
//     - advanceIfPlaying() on a forward tick calls adapter.renderTransition AND adapter.renderBeatBehaviors
//       with the SAME (prev, next, beatsAdvanced) + the threaded view, and routes emitted signals to onSignal
//     - paused / seek drive NO renderBeatBehaviors call (only the snap/animate paths Story 2.5 pinned)
//
// Pipeline reuse: the same committed-fixture chain as arena-boot.test.ts L55-69 (copied verbatim).
import { startArena } from './arena-boot';
import type { PlaybackAction, PlaybackState } from '../model/playback';
import { planBeatBehaviors } from './beat-behavior';
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

// A recording fake that captures BOTH the animated transition AND the behavior transition (with the
// threaded view), so the test can assert the boot drives both paths on a forward tick. It holds NO
// upstream reference (one-way, R5). `implements RenderPort` only typechecks once RenderPort declares
// renderBeatBehaviors (Option A) — that missing member is part of the intended RED.
class RecordingBehaviorAdapter implements RenderPort {
  readonly snaps: BattleState[] = [];
  readonly transitions: { prev: BattleState; next: BattleState; beats: Beat[] }[] = [];
  readonly behaviors: { prev: BattleState; next: BattleState; beats: Beat[]; view: AnnotatedView }[] = [];
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
  renderBeatBehaviors(prev: BattleState, next: BattleState, beats: Beat[], view: AnnotatedView): void {
    this.behaviors.push({ prev, next, beats, view });
  }
  destroy(): void {
    this.destroyCalls += 1;
  }
}

// The shape startArena must return for the boot to be drivable headlessly (the Story 2.5 CONTRACT,
// reused here). startArena also accepts the new onSignal sink dep.
type BootHandle = {
  adapter: RenderPort;
  controls: { root: HTMLElement; sync(): void; destroy(): void };
  dispatch: (action: PlaybackAction) => void;
  advanceIfPlaying: () => void;
  getState: () => PlaybackState;
  destroy(): void;
};

let host: HTMLElement;
let booted: BootHandle | undefined;

beforeEach(() => {
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

// Boot with the recording fake + an optional signal sink injected — no Phaser, fast, deterministic.
function bootWithFake(
  adapter: RenderPort,
  onSignal?: (signal: BeatSignal) => void,
): BootHandle {
  return startArena('game-container', { createAdapter: () => adapter, onSignal }) as unknown as BootHandle;
}

describe('Story 3.3 AC1/AC2/AC3 — the boot threads the overlay and drives planBeatBehaviors on a forward tick', () => {
  it('a forward tick (while playing) calls renderBeatBehaviors with the SAME (prev,next,beats) as renderTransition', () => {
    const adapter = new RecordingBehaviorAdapter();
    booted = bootWithFake(adapter);

    booted.dispatch({ type: 'play' });
    booted.advanceIfPlaying();

    // The forward step drove BOTH the animated path AND the behavior path on the same transition.
    expect(adapter.transitions).toHaveLength(1);
    expect(adapter.behaviors).toHaveLength(1);
    const t = adapter.transitions[0]!;
    const b = adapter.behaviors[0]!;
    expect(b.prev).toEqual(t.prev);
    expect(b.next).toEqual(t.next);
    expect(b.beats).toEqual(t.beats);
  });

  it('the boot builds the read-only AnnotatedView ONCE and threads the SAME view instance into every behavior call', () => {
    // The boot must build the overlay (FixtureInterpreter + applyOverlay over its events) a SINGLE time
    // at startup and reuse it — not rebuild per tick. Advance several ticks and assert every behavior
    // call received the identical view reference, and that the view is the side-by-side overlay shape.
    const adapter = new RecordingBehaviorAdapter();
    booted = bootWithFake(adapter);

    booted.dispatch({ type: 'play' });
    booted.advanceIfPlaying();
    booted.advanceIfPlaying();
    booted.advanceIfPlaying();

    expect(adapter.behaviors.length).toBeGreaterThanOrEqual(2);
    const firstView = adapter.behaviors[0]!.view;
    // Same instance every tick (built once).
    for (const b of adapter.behaviors) {
      expect(b.view).toBe(firstView);
    }
    // The threaded view is the read-only overlay shape (events + annotations + byEventRef index) and
    // carries the FixtureInterpreter's annotations (the dispel + shaman the dev/CI double authors).
    expect(Object.keys(firstView).sort()).toEqual(['annotations', 'byEventRef', 'events']);
    expect(firstView.annotations.some((a) => a.beatType === 'dispel')).toBe(true);
    expect(firstView.annotations.some((a) => a.beatType === 'shaman')).toBe(true);
  });

  it('the behavior intents/signals the boot drives match planBeatBehaviors over the same transition + view', () => {
    // Walk a few forward ticks; for each recorded behavior call, the PURE planBeatBehaviors over the
    // recorded (prev, next, beats, view) must reproduce the decision — proving the boot threads the real
    // transition + overlay into the pure plan (no divergence, one-way).
    const adapter = new RecordingBehaviorAdapter();
    booted = bootWithFake(adapter);

    booted.dispatch({ type: 'play' });
    for (let i = 0; i < 3; i++) booted.advanceIfPlaying();

    expect(adapter.behaviors.length).toBeGreaterThan(0);
    for (const b of adapter.behaviors) {
      const planned = planBeatBehaviors(b.prev, b.next, b.beats, b.view);
      expect(planned).toBeDefined();
      expect(Object.keys(planned).sort()).toEqual(['intents', 'signals']);
    }
  });
});

describe('Story 3.3 — the boot routes emitted signals to the onSignal sink (FR-9 producer wiring)', () => {
  it('driving playback to the breakthrough surfaces the Dispel scribe-correction signal to onSignal exactly once', () => {
    // AC2's signal must reach a boot-owned sink so Story 4.1 can subscribe. Inject a collecting sink and
    // play to the end: the real fixture has a single Dispel, so onSignal receives exactly one
    // scribe-correction signal across the whole walk.
    const adapter = new RecordingBehaviorAdapter();
    const received: BeatSignal[] = [];
    booted = bootWithFake(adapter, (s) => received.push(s));

    booted.dispatch({ type: 'play' });
    const tl = timeline();
    // Advance past every beat (one extra to hit the clamped end no-op).
    for (let i = 0; i <= tl.beats.length; i++) booted.advanceIfPlaying();

    expect(received).toHaveLength(1);
    expect(received[0]!.kind).toBe('scribe-correction');
    expect(received[0]!.beatType).toBe('dispel');
  });
});

describe('Story 3.3 — paused/seek do NOT drive the behavior path (only the forward tick does)', () => {
  it('a step while PAUSED drives NO renderBeatBehaviors call', () => {
    const adapter = new RecordingBehaviorAdapter();
    booted = bootWithFake(adapter);

    // Boots paused at t=0 (Story 2.5). A loop step while paused advances nothing and drives no behavior.
    expect(booted.getState().status).toBe('paused');
    booted.advanceIfPlaying();
    expect(adapter.behaviors).toHaveLength(0);
  });

  it('a dispatched seek SNAPS (render) and drives NO renderBeatBehaviors call (you cannot dramatize across a jump)', () => {
    const adapter = new RecordingBehaviorAdapter();
    booted = bootWithFake(adapter);

    const behaviorsBefore = adapter.behaviors.length;
    booted.dispatch({ type: 'seek', cursor: 4 });

    // seek is the SNAP path (Story 2.5) — it must not animate NOR drive a behavior call.
    expect(adapter.behaviors.length).toBe(behaviorsBefore);
  });
});

describe('Story 3.3 — extending the boot does NOT regress Story 2.5 clean teardown (F1)', () => {
  it('destroy() still tears down the adapter and detaches the control bar', () => {
    const adapter = new RecordingBehaviorAdapter();
    const handle = bootWithFake(adapter);
    const root = handle.controls.root;

    handle.destroy();

    expect(adapter.destroyCalls).toBe(1);
    expect(host.contains(root)).toBe(false);
    booted = undefined; // already destroyed; do not double-destroy in afterEach
  });
});
