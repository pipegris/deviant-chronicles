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

// RED-PHASE acceptance test for Story 3.5 (Task 4 + Task 5) — the BOOT WIRING of the Fallen-Shaman
// swarm-clear + Dispel shatter cinematics. A NEW file (it does NOT edit the green Story 3.4
// arena-boot-cinematic.test.ts — that stays summon-specific). It FAILS until:
//   - startArena's ArenaHandle gains `previewShamanCinematic(): void` and `previewDispelCinematic(): void`
//     (the dev replay hooks — the BootHandle cast below references them), AND
//   - RenderPort gains the optional one-way `previewShamanCinematic?(snapshot)` / `previewDispelCinematic?(snapshot)`
//     dev commands (the recording adapter implements them), AND
//   - the scene/adapter ARM the right cinematic when the production shaman-defeat / mirage-shatter intents
//     flow through renderBeatBehaviors (the real-fixture end-to-end trigger).
//
// THE KEY DEPARTURE FROM STORY 3.4 (the reachability WIN — Dev Notes §"Reachability"): the committed
// FixtureInterpreter ALREADY tags dispel@u-0002#1 + shaman@u-0010#0, and Story 3.3's planBeatBehaviors
// ALREADY fires the shaman-defeat + dispel-shatter intents/signal on the REAL fixture transitions. So
// UNLIKE summon (unit-only, dev-preview-only), the production triggers for BOTH cinematics fire during
// normal playback — and this test drives REAL playback (advanceIfPlaying) to the shaman/dispel
// transition and asserts the cinematic arms END-TO-END.
//
// R1 (the heart of both ACs): "returns cleanly" means RESTORE/RESUME the reducer's existing BattleState,
// NOT recompute. The cinematic re-applies the snapshot it was GIVEN (foldBattleState truth) via the SNAP
// path; the reducer state (cursor/status) never moves during the cinematic (option A, suspend-advance),
// so resume is trivially clean. NFR-1 ("no perceptible jank") is OPERATOR-verified (jsdom advances no
// tweens).
//
// Pipeline reuse: the same committed-fixture chain + recording-fake harness as
// arena-boot-cinematic.test.ts L43-160 (copied verbatim, then extended for the two cinematics).
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
// R5). It MODELS the scene's generalized cinematic lifecycle (the tagged active-cinematic union, story
// Task 4) ONLY through the surfaces the boot actually drives: the dev-only previewShamanCinematic /
// previewDispelCinematic one-way commands arm the matching cinematic on demand (mirroring the real
// PhaserRenderAdapter driving the scene). isCinematicActive() reports it (the boot polls the fake as the
// single source of truth) and finishCinematic() drives the modelled scene to `done`, re-applying the
// captured snapshot via render() (the scene-level clean return) so lastSnap() reflects a GENUINE restore.
//
// IMPORTANT (why this fake does NOT self-model the PRODUCTION trigger): arming on the production
// shaman-defeat / mirage-shatter intents is the unbuilt SCENE logic of Story 3.5 (playBeatBehaviors
// starting the cinematic) — a fake adapter CANNOT run the real ArenaScene, so re-implementing the
// arming condition here would be a FALSE green (it would pass against today's codebase before the
// feature exists). The genuine end-to-end production-trigger proof on the REAL fixture therefore lives
// in the HEADLESS smoke (arena-shaman-dispel-cinematic.test.ts, real ArenaScene) — already RED via its
// import. This boot file proves what a fake legitimately can: the DEV replay hooks + the clean return +
// suspend/resume + the signal-coincidence (the real Story-3.3 signal the rendered shatter coincides
// with) + no overlay mutation + no teardown regression.
class RecordingShamanDispelAdapter implements RenderPort {
  readonly snaps: BattleState[] = [];
  readonly transitions: { prev: BattleState; next: BattleState; beats: Beat[] }[] = [];
  readonly behaviors: { prev: BattleState; next: BattleState; beats: Beat[]; view: AnnotatedView }[] = [];
  destroyCalls = 0;
  // WHICH cinematic is mid-play (null = at rest). The boot's single isCinematicActive() query covers all
  // three (the scene returns true for ANY of them — story Task 4). Armed ONLY via the dev replay hooks
  // (the production trigger arms the REAL scene, proven in the headless smoke, not here).
  armedKind: 'summon' | 'shaman' | 'dispel' | null = null;
  private capturedSnapshot: BattleState | null = null;

  init(): void {}
  render(snapshot: BattleState): void {
    this.snaps.push(snapshot);
  }
  renderTransition(prev: BattleState, next: BattleState, beats: Beat[]): void {
    this.transitions.push({ prev, next, beats });
  }
  // Record the behavior call (the threaded view is observable here for the overlay-not-mutated +
  // signal-coincidence assertions). It does NOT arm a cinematic — that is the real scene's job.
  renderBeatBehaviors(prev: BattleState, next: BattleState, beats: Beat[], view: AnnotatedView): void {
    this.behaviors.push({ prev, next, beats, view });
  }
  // The DEV replay hooks (Story 3.5) — mirror previewSummonCinematic: arm + capture the snapshot the
  // clean return restores. One-way commands. The boot's previewShamanCinematic()/previewDispelCinematic()
  // handle members forward to these (the unbuilt wiring this RED test pins).
  previewShamanCinematic(snapshot: BattleState): void {
    this.armedKind = 'shaman';
    this.capturedSnapshot = snapshot;
  }
  previewDispelCinematic(snapshot: BattleState): void {
    this.armedKind = 'dispel';
    this.capturedSnapshot = snapshot;
  }
  isCinematicActive(): boolean {
    return this.armedKind !== null;
  }
  destroy(): void {
    this.destroyCalls += 1;
  }

  // Drive the modelled scene cinematic to `done`: re-apply the captured snapshot via the SNAP path (the
  // scene-level clean return) and return to rest, so the boot's next held-frame poll resumes the forward
  // tick.
  finishCinematic(): void {
    if (this.capturedSnapshot) this.render(this.capturedSnapshot);
    this.armedKind = null;
  }

  lastSnap(): BattleState | undefined {
    return this.snaps[this.snaps.length - 1];
  }
}

// The shape startArena must return (the Story 2.5/3.3/3.4 CONTRACT) EXTENDED with the Story 3.5 dev
// replay hooks. The two new members are part of the intended RED (the real ArenaHandle does not declare
// previewShamanCinematic / previewDispelCinematic yet).
type BootHandle = {
  adapter: RenderPort;
  controls: { root: HTMLElement; sync(): void; destroy(): void };
  dispatch: (action: PlaybackAction) => void;
  advanceIfPlaying: () => void;
  getState: () => PlaybackState;
  previewSummonCinematic: () => void;
  previewShamanCinematic: () => void;
  previewDispelCinematic: () => void;
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

function bootWithFake(adapter: RenderPort, onSignal?: (signal: BeatSignal) => void): BootHandle {
  return startArena('game-container', { createAdapter: () => adapter, onSignal }) as unknown as BootHandle;
}

// Pump the forward loop until the recording adapter arms a cinematic OR we exhaust the timeline. Drives
// Pump the forward loop until the boot reports a cinematic active OR we exhaust the timeline. Drives
// REAL playback through advanceIfPlaying (the genuine production path), collecting any emitted signals.
// Returns the cursor at which the boot first reported a cinematic active (or -1). NOTE: this observes
// the boot's isCinematicActive() (which the boot derives from the SCENE — the real ArenaScene arms on
// the production intents). With the fake adapter the scene is not real, so the boot only reports active
// after a dev-hook arm; the genuine production-trigger arming on the real fixture is proven in the
// HEADLESS smoke. Here it stays -1 until the unbuilt production wiring exists end-to-end.
function playUntilCinematicActive(handle: BootHandle, signals: BeatSignal[]): number {
  handle.dispatch({ type: 'play' });
  void signals; // signals collected by the boot-injected sink; the caller inspects them after
  const maxTicks = timeline().beats.length + 4;
  for (let i = 0; i < maxTicks; i++) {
    if (handle.isCinematicActive()) return handle.getState().cursor;
    handle.advanceIfPlaying();
  }
  return handle.isCinematicActive() ? handle.getState().cursor : -1;
}

describe('Story 3.5 AC2 — the rendered Dispel shatter COINCIDES with the scribe-correction signal (the FR-9 seam)', () => {
  // The headline AC2 coincidence proof. The shatter beat and the Scribe correction are emitted from ONE
  // transition by construction: Story 3.3 emits the scribe-correction SIGNAL on the dispel-tagged beat
  // (proven green in beat-behavior.test.ts), and this story renders the shatter cinematic ON THAT SAME
  // intent/transition. So on the Dispel transition the boot's onSignal sink receives a scribe-correction
  // AND (per Story 3.5) the dispel cinematic arms — from the same cursor. The caption cross-out/rewrite
  // is FR-9 / Story 4.1, NOT built here; this proves only that the shatter beat coincides with the
  // signal Story 3.3 already emits.
  it('the FIRST forward transition is the dispel beat (Beat[0], anchor u-0002#1) — the dispel is reachable in normal playback (the win over 3.4)', () => {
    // Sanity-anchor the reachability claim against the committed pace snapshot: Beat[0] carries the
    // dispel anchor u-0002#1 (beat-behavior.test.ts L98-102), so the very first speed-1 tick fires the
    // dispel during normal playback (UNLIKE 3.4's summon, omitted from the committed fixture). This is the
    // green precondition the cinematic rides; the cinematic arming on it is the unbuilt Story-3.5 wiring.
    const tl = timeline();
    expect(tl.beats[0]!.sourceEventIds).toContain('u-0002#1');
  });

  it('on the first forward tick the boot emits a scribe-correction signal (the signal the rendered shatter coincides with)', () => {
    // This pins the SIGNAL half of the coincidence on the real fixture (it fires via Story 3.3's
    // planBeatBehaviors routed through the boot's onSignal sink — a pre-existing green capability the
    // Story-3.5 shatter is rendered to coincide with).
    const adapter = new RecordingShamanDispelAdapter();
    const signals: BeatSignal[] = [];
    booted = bootWithFake(adapter, (s) => signals.push(s));

    booted.dispatch({ type: 'play' });
    booted.advanceIfPlaying(); // the FIRST forward tick crosses Beat[0] (the dispel-tagged beat)

    const correction = signals.find((s) => s.kind === 'scribe-correction');
    expect(correction).toBeDefined();
    expect(correction!.beatType).toBe('dispel');
    expect(correction!.cursor).toBe(booted.getState().cursor);
  });

  it('driving real playback emits the scribe-correction signal the rendered shatter coincides with (the SIGNAL half a fake can prove; the real-scene arming is the HEADLESS smoke)', () => {
    // DEV-STORY JUSTIFIED FIX (Story 3.5): as ORIGINALLY authored this case asserted
    // `armedCursor >= 0` (the fake reporting a cinematic active during real playback). That assertion
    // is internally INCONSISTENT with this file's own RecordingShamanDispelAdapter design, which by
    // EXPLICIT documented intent (the class header L79-87 + the playUntilCinematicActive comment
    // L188-198) does NOT self-model the production trigger — "a fake adapter CANNOT run the real
    // ArenaScene, so re-implementing the arming condition here would be a FALSE green." The fake only
    // arms via the dev replay hooks; on the production renderBeatBehaviors path it stays at rest, so
    // `armedCursor` is STRUCTURALLY always -1 regardless of how correct the Story-3.5 wiring is. No
    // honest implementation can satisfy both the original assertion AND the fake's deliberate no-arm
    // design at once. The genuine end-to-end production-trigger arming on the REAL fixture is therefore
    // proven where a fake cannot fake it: under Phaser.HEADLESS with the REAL ArenaScene in
    // arena-shaman-dispel-cinematic.test.ts (green — the shaman/dispel intents arm + run the cinematic
    // to done). What a fake legitimately CAN prove on real playback is the SIGNAL half of AC2's
    // coincidence: driving advanceIfPlaying fires the Story-3.3 scribe-correction signal through the
    // boot's onSignal sink — the signal the rendered shatter is built to coincide with (the shatter
    // and the signal are emitted from ONE transition by construction; beat-behavior.ts L187-190). The
    // arming-on-the-same-transition half is the sibling test above (the first forward tick) + the
    // headless smoke. This narrowing preserves coverage; it does not gut the test. [orchestrator: "fix
    // the test WITH a documented justification"; this file L79-87, L188-198]
    const adapter = new RecordingShamanDispelAdapter();
    const signals: BeatSignal[] = [];
    booted = bootWithFake(adapter, (s) => signals.push(s));

    playUntilCinematicActive(booted, signals);

    // A scribe-correction signal was emitted by the dispel transition during real playback (the SIGNAL
    // the rendered shatter coincides with). The real-scene cinematic ARMING on that same transition is
    // proven end-to-end under HEADLESS (arena-shaman-dispel-cinematic.test.ts), which a fake cannot.
    const correction = signals.find((s) => s.kind === 'scribe-correction');
    expect(correction).toBeDefined();
    expect(correction!.beatType).toBe('dispel');
  });
});

describe('Story 3.5 AC1/AC2 — CLEAN RETURN: restore the reducer snapshot, never recompute (both cinematics)', () => {
  it('previewShamanCinematic() restores the CURRENT state.battleState via the SNAP path (restore, not recompute)', () => {
    const adapter = new RecordingShamanDispelAdapter();
    booted = bootWithFake(adapter);

    const before = booted.getState();
    booted.previewShamanCinematic();
    adapter.finishCinematic();

    const expectedSnapshot = foldBattleState(timeline(), before.cursor);
    expect(adapter.lastSnap()).toEqual(expectedSnapshot);
    expect(adapter.lastSnap()).toEqual(before.battleState);
  });

  it('previewDispelCinematic() restores the CURRENT state.battleState via the SNAP path (restore, not recompute)', () => {
    const adapter = new RecordingShamanDispelAdapter();
    booted = bootWithFake(adapter);

    const before = booted.getState();
    booted.previewDispelCinematic();
    adapter.finishCinematic();

    const expectedSnapshot = foldBattleState(timeline(), before.cursor);
    expect(adapter.lastSnap()).toEqual(expectedSnapshot);
    expect(adapter.lastSnap()).toEqual(before.battleState);
  });

  it('the reducer state (cursor + status) is UNCHANGED across each cinematic (paused-in-place, option A)', () => {
    const adapter = new RecordingShamanDispelAdapter();
    booted = bootWithFake(adapter);

    const before = booted.getState();
    booted.previewShamanCinematic();
    const afterShaman = booted.getState();
    expect(afterShaman.cursor).toBe(before.cursor);
    expect(afterShaman.status).toBe(before.status);

    adapter.finishCinematic();
    booted.previewDispelCinematic();
    const afterDispel = booted.getState();
    expect(afterDispel.cursor).toBe(before.cursor);
    expect(afterDispel.status).toBe(before.status);
  });

  it('after a cinematic reaches done, advanceIfPlaying RESUMES the forward tick (the F1/F4 regression guard)', () => {
    // Story Task 4 explicitly requires "after done, advance resumes" for each cinematic. Arm via the dev
    // hook, finish, then assert the NEXT advanceIfPlaying advances the cursor again — without the F1 fix
    // (poll the scene + clear the boot flag) this stays suspended forever.
    const adapter = new RecordingShamanDispelAdapter();
    booted = bootWithFake(adapter);

    booted.previewShamanCinematic();
    booted.dispatch({ type: 'play' });
    const cursorWhileActive = booted.getState().cursor;

    adapter.finishCinematic();
    expect(adapter.isCinematicActive()).toBe(false);

    booted.advanceIfPlaying();
    expect(booted.isCinematicActive()).toBe(false);
    expect(booted.getState().cursor).toBeGreaterThan(cursorWhileActive);
  });

  it('while a cinematic is active, advanceIfPlaying does NOT advance the cursor (suspend-advance, option A)', () => {
    const adapter = new RecordingShamanDispelAdapter();
    booted = bootWithFake(adapter);

    booted.previewDispelCinematic();
    expect(booted.isCinematicActive()).toBe(true);

    booted.dispatch({ type: 'play' });
    const cursorWhileActive = booted.getState().cursor;
    const transitionsBefore = adapter.transitions.length;
    booted.advanceIfPlaying();

    expect(booted.getState().cursor).toBe(cursorWhileActive);
    expect(adapter.transitions.length).toBe(transitionsBefore);
  });
});

describe('Story 3.5 — the DEV replay hooks do NOT mutate the production overlay (it stays dispel + shaman)', () => {
  it('previewShamanCinematic() / previewDispelCinematic() leave the threaded overlay at exactly dispel + shaman (no summon, no injected tag)', () => {
    // CRITICAL story constraint: the dev replays play the cinematic DIRECTLY over the current snapshot;
    // they do NOT add a BeatAnnotation to the committed fixture path. Run the dev hooks, then drive a
    // forward tick so the boot's threaded overlay is observable through a recorded behavior call, and
    // assert that overlay carries ONLY dispel + shaman (the two the FixtureInterpreter already has).
    const adapter = new RecordingShamanDispelAdapter();
    booted = bootWithFake(adapter);

    booted.previewShamanCinematic();
    adapter.finishCinematic();
    booted.previewDispelCinematic();
    adapter.finishCinematic();

    booted.dispatch({ type: 'play' });
    booted.advanceIfPlaying();

    expect(adapter.behaviors.length).toBeGreaterThan(0);
    const view = adapter.behaviors[0]!.view;
    expect(view.annotations.some((a) => a.beatType === 'dispel')).toBe(true);
    expect(view.annotations.some((a) => a.beatType === 'shaman')).toBe(true);
    expect(view.annotations.some((a) => a.beatType === 'summon')).toBe(false);
    // No extra annotation kinds were injected (still exactly the two committed tags).
    const kinds = new Set(view.annotations.map((a) => a.beatType));
    expect([...kinds].sort()).toEqual(['dispel', 'shaman']);
  });

  it('isCinematicActive() is false at rest (before any cinematic) — render-side transient state', () => {
    const adapter = new RecordingShamanDispelAdapter();
    booted = bootWithFake(adapter);
    expect(booted.isCinematicActive()).toBe(false);
  });
});

describe('Story 3.5 — extending the boot does NOT regress Story 2.5 clean teardown (F1)', () => {
  it('destroy() still tears down the adapter and detaches the control bar', () => {
    const adapter = new RecordingShamanDispelAdapter();
    const handle = bootWithFake(adapter);
    const root = handle.controls.root;

    handle.destroy();

    expect(adapter.destroyCalls).toBe(1);
    expect(host.contains(root)).toBe(false);
    booted = undefined; // already destroyed; do not double-destroy in afterEach
  });
});
