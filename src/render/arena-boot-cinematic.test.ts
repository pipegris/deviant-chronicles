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
import { foldBattleState } from '../model/battle-model';

// RED-PHASE acceptance test for Story 3.4 (Task 2 + Task 3 + Task 4) — the BOOT WIRING of the THUNDORR
// cinematic: the CLEAN RETURN (the headline AC1 proof — "returns cleanly to the arena state"), the
// cinematic-active guard (no new transition starts mid-cutaway), the DEV-ONLY preview hook, and no
// regression of Story 2.5's clean teardown. A NEW file (it does NOT edit the green Story 2.5 / 3.3 boot
// tests). It FAILS until startArena's ArenaHandle gains `previewSummonCinematic(): void` and the boot
// extends advanceIfPlaying with a cinematic-active guard + the clean-return snap (the handle member is
// part of the intended RED — the BootHandle cast below references it).
//
// CONTRACT this test pins (the minimal additive extension the story's Tasks 2/3 endorse):
//   ArenaHandle additionally exposes:
//     - previewSummonCinematic(): void   — the DEV-ONLY on-demand play over the CURRENT state.battleState
//       snapshot; the clean return restores that SAME snapshot via the SNAP path (adapter.render). It
//       does NOT inject a summon into the production overlay (the FixtureInterpreter stays dispel+shaman).
//     - isCinematicActive(): boolean     — render-side TRANSIENT state (the rafId precedent): true while
//       the cinematic plays, false at rest. NOT playback state (never serialized, never in the reducer).
//   advanceIfPlaying() while the cinematic is active starts NO new reducer transition (the cursor does
//   not advance mid-cutaway — Task 2 option A, suspend-advance-during-cinematic).
//
// R1 (the heart of AC1): "returns cleanly" means RESTORE/RESUME the reducer's existing BattleState, NOT
// recompute mechanics. The cinematic re-applies the snapshot it was GIVEN (already foldBattleState truth)
// via the SNAP path; the reducer state (cursor/status) never moves during the cinematic, so resume is
// trivially clean. NFR-1 ("no perceptible jank") is OPERATOR-verified (jsdom advances no tweens).
//
// Pipeline reuse: the same committed-fixture chain + recording-fake harness as
// arena-boot-behavior.test.ts L43-131 (copied verbatim).
import { startArena } from './arena-boot';
import type { PlaybackAction, PlaybackState } from '../model/playback';
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

// A recording fake capturing the SNAP path (render), the animated path (renderTransition), and the
// behavior path (renderBeatBehaviors, with the threaded view). It holds NO upstream reference (one-way,
// R5). It MODELS the scene's cinematic lifecycle (review F4/F5): previewSummonCinematic() arms the
// cinematic (mirroring the real adapter driving the scene) and isCinematicActive() reports it — so the
// boot polls the fake as the single source of truth and the resume path is exercisable. finishCinematic()
// drives the modelled scene to `done`, re-applying the captured snapshot via render() (the scene-level
// clean return) so `lastSnap()` reflects a GENUINE restore, not only the boot's own baseline render.
class RecordingCinematicAdapter implements RenderPort {
  readonly snaps: BattleState[] = [];
  readonly transitions: { prev: BattleState; next: BattleState; beats: Beat[] }[] = [];
  readonly behaviors: { prev: BattleState; next: BattleState; beats: Beat[]; view: AnnotatedView }[] = [];
  destroyCalls = 0;
  private cinematicActive = false;
  private capturedSnapshot: BattleState | null = null;

  init(): void {}
  render(snapshot: BattleState): void {
    this.snaps.push(snapshot);
  }
  renderTransition(prev: BattleState, next: BattleState, beats: Beat[]): void {
    this.transitions.push({ prev, next, beats });
  }
  renderBeatBehaviors(prev: BattleState, next: BattleState, beats: Beat[], view: AnnotatedView): void {
    this.behaviors.push({ prev, next, beats, view });
  }
  // Model the scene driving the cinematic: arm it + capture the snapshot the clean return will restore
  // (the real PhaserRenderAdapter hands a synthesized summon intent to the scene). [review F4/F5]
  previewSummonCinematic(snapshot: BattleState): void {
    this.cinematicActive = true;
    this.capturedSnapshot = snapshot;
  }
  isCinematicActive(): boolean {
    return this.cinematicActive;
  }
  destroy(): void {
    this.destroyCalls += 1;
  }

  // Drive the modelled scene cinematic to `done`: re-apply the captured snapshot via the SNAP path (the
  // scene-level clean return) and return to rest, so the boot's next held-frame poll resumes the forward
  // tick. The test calls this to exercise the resume (F4) + assert the genuine restore snap (F5).
  finishCinematic(): void {
    if (this.capturedSnapshot) this.render(this.capturedSnapshot);
    this.cinematicActive = false;
  }

  lastSnap(): BattleState | undefined {
    return this.snaps[this.snaps.length - 1];
  }
}

// The shape startArena must return (the Story 2.5/3.3 CONTRACT) EXTENDED with the Story 3.4 dev hook +
// the cinematic-active introspection. The two new members are part of the intended RED (the real
// ArenaHandle does not declare them yet).
type BootHandle = {
  adapter: RenderPort;
  controls: { root: HTMLElement; sync(): void; destroy(): void };
  dispatch: (action: PlaybackAction) => void;
  advanceIfPlaying: () => void;
  getState: () => PlaybackState;
  previewSummonCinematic: () => void;
  isCinematicActive: () => boolean;
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

function bootWithFake(
  adapter: RenderPort,
  onSignal?: (signal: BeatSignal) => void,
): BootHandle {
  return startArena('game-container', { createAdapter: () => adapter, onSignal }) as unknown as BootHandle;
}

describe('Story 3.4 AC1 — the dev preview hook plays the cinematic and CLEAN-RETURNS to the reducer snapshot', () => {
  it('previewSummonCinematic() restores the CURRENT state.battleState via the SNAP path (restore, not recompute)', () => {
    const adapter = new RecordingCinematicAdapter();
    booted = bootWithFake(adapter);

    // The dev preview plays over the current (t=0) snapshot; the clean return re-applies that SAME
    // snapshot. We drive the modelled scene cinematic to `done` (finishCinematic) so the SCENE-level
    // clean return runs — `lastSnap()` then reflects the captured snapshot the scene restored, NOT only
    // the boot's baseline render (review F5: the assertion now fails on a dropped clean-return snap).
    // The restored snapshot deep-equals the reducer's truth for the current cursor
    // (foldBattleState(timeline, cursor)) — proving RESTORE, not a recompute.
    const before = booted.getState();
    booted.previewSummonCinematic();
    adapter.finishCinematic();

    const expectedSnapshot = foldBattleState(timeline(), before.cursor);
    expect(adapter.lastSnap()).toEqual(expectedSnapshot);
    expect(adapter.lastSnap()).toEqual(before.battleState);
  });

  it('the reducer state (cursor + status) is UNCHANGED across the cinematic (paused-in-place, option A)', () => {
    const adapter = new RecordingCinematicAdapter();
    booted = bootWithFake(adapter);

    const before = booted.getState();
    booted.previewSummonCinematic();
    const after = booted.getState();

    // The cinematic owns only render-side wall-clock; it pushes NOTHING into the reducer (R5/AC1).
    expect(after.cursor).toBe(before.cursor);
    expect(after.status).toBe(before.status);
  });

  it('the dev preview does NOT inject a summon into the production overlay (FixtureInterpreter stays dispel + shaman)', () => {
    // CRITICAL story constraint: the dev preview plays the cinematic DIRECTLY; it does NOT add a summon
    // BeatAnnotation to the committed fixture path. Drive a forward tick so the boot's threaded overlay
    // is observable through a recorded behavior call, then assert that overlay carries ONLY dispel +
    // shaman (no summon) even after the preview ran.
    const adapter = new RecordingCinematicAdapter();
    booted = bootWithFake(adapter);

    booted.previewSummonCinematic();
    booted.dispatch({ type: 'play' });
    booted.advanceIfPlaying();

    expect(adapter.behaviors.length).toBeGreaterThan(0);
    const view = adapter.behaviors[0]!.view;
    expect(view.annotations.some((a) => a.beatType === 'dispel')).toBe(true);
    expect(view.annotations.some((a) => a.beatType === 'shaman')).toBe(true);
    expect(view.annotations.some((a) => a.beatType === 'summon')).toBe(false);
  });
});

describe('Story 3.4 AC1 — the cinematic-active guard: no new reducer transition starts mid-cutaway', () => {
  it('while the cinematic is active, advanceIfPlaying does NOT advance the cursor (suspend-advance, option A)', () => {
    const adapter = new RecordingCinematicAdapter();
    booted = bootWithFake(adapter);

    // Arm the cinematic via the dev hook, then PLAY and pump the loop. While the full-scene cutaway is
    // active the forward tick must be SUSPENDED — the cursor does not move (and no transition is animated).
    booted.previewSummonCinematic();
    expect(booted.isCinematicActive()).toBe(true);

    booted.dispatch({ type: 'play' });
    const cursorWhileActive = booted.getState().cursor;
    const transitionsBefore = adapter.transitions.length;
    booted.advanceIfPlaying();

    expect(booted.getState().cursor).toBe(cursorWhileActive);
    expect(adapter.transitions.length).toBe(transitionsBefore);
  });

  it('after the cinematic reaches done, advanceIfPlaying RESUMES the forward tick (the regression guard for F1)', () => {
    // Story Task 4 explicitly required "after done, advance resumes" — the proximate reason F1 (the boot
    // flag set-once-true, never cleared) shipped green. This drives the cinematic to `done` (the scene
    // returns to rest) and asserts the NEXT advanceIfPlaying advances the cursor again — without the F1
    // fix (poll the scene + clear the boot flag) this stays suspended forever and the cursor never moves.
    const adapter = new RecordingCinematicAdapter();
    booted = bootWithFake(adapter);

    booted.previewSummonCinematic();
    booted.dispatch({ type: 'play' });
    const cursorWhileActive = booted.getState().cursor;

    // The cutaway finishes (the scene's cinematic machine reaches `done` and returns to rest).
    adapter.finishCinematic();
    expect(adapter.isCinematicActive()).toBe(false);

    // The first post-`done` tick clears the boot's cached flag and resumes — the cursor advances again.
    booted.advanceIfPlaying();
    expect(booted.isCinematicActive()).toBe(false);
    expect(booted.getState().cursor).toBeGreaterThan(cursorWhileActive);
  });

  it('isCinematicActive() is false at rest (before any cinematic) — it is render-side transient state', () => {
    const adapter = new RecordingCinematicAdapter();
    booted = bootWithFake(adapter);
    expect(booted.isCinematicActive()).toBe(false);
  });
});

describe('Story 3.4 — extending the boot does NOT regress Story 2.5 clean teardown (F1)', () => {
  it('destroy() still tears down the adapter and detaches the control bar', () => {
    const adapter = new RecordingCinematicAdapter();
    const handle = bootWithFake(adapter);
    const root = handle.controls.root;

    handle.destroy();

    expect(adapter.destroyCalls).toBe(1);
    expect(host.contains(root)).toBe(false);
    booted = undefined; // already destroyed; do not double-destroy in afterEach
  });
});
