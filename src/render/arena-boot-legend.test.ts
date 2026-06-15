// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BattleState, Beat } from '../schema/battle-timeline';
import type { AnnotatedView } from '../interpret/overlay';
import type { RenderPort } from './render-port';

// RED-PHASE acceptance tests for Story 4.4 (Task 4) — the AC1 NON-INTERRUPTION GATE: open/close the
// Legend overlay does NOT mutate playback. This is the story's load-bearing gate proof ("assert the
// BattleState/cursor are unchanged across open/close"). These FAIL until arena-boot.ts mounts the
// Legend overlay and adds a `legend` handle ({ open, close, toggle, isOpen }) to the returned
// ArenaHandle — until then `booted.legend` is undefined and `booted.legend.open()` throws a TypeError
// (the intended red), alongside the missing src/render/legend-overlay.ts the boot will import.
//
// The two postures this guard pins (story Dev Notes #5 — the most consequential decision):
//   1. open->close is INVISIBLE to the reducer: snapshot the reducer PlaybackState (status/cursor/speed)
//      AND the BattleState before, open() then close(), assert DEEP-EQUAL after — and isCinematicActive()
//      stayed false (the portal must NOT reuse the Story 3.4 cinematic-suspend path, which WOULD interrupt).
//   2. the converse positive: ticking the loop still ADVANCES while the overlay is open (open does not
//      freeze playback — the rAF loop keeps ticking; the portal holds no dispatch edge to pause it).
// It reuses the SAME jsdom boot harness + afterEach destroy contract as arena-boot-teaching.test.ts
// (the live rAF loop must still be cancelled on destroy — Story 2.5's F1 fix must not regress).
//
import { startArena } from './arena-boot';
import type { PlaybackAction, PlaybackState } from '../model/playback';

// NOTE (dev-story, GREEN): the ATDD scaffold copied the full committed-fixture ingest chain (runIngest /
// readFixture / the timeline() helper + the ingest/pace/translate + node:fs imports) verbatim from
// arena-boot-teaching.test.ts, but THIS test never used it — startArena derives its OWN timeline
// internally and these tests only drive the returned handle (open/close + advanceIfPlaying) and read
// getState(). Removed the entire dead chain to satisfy strict tsc/eslint no-unused-vars; no assertion
// referenced it, so nothing is weakened. [story "fix the test WITH a documented justification"]

// A recording fake that COUNTS the render commands the boot drives, so the test can prove open/close
// triggers NONE of them (no SNAP render, no transition) — the portal pushes nothing into the render
// data path either. Implements RenderPort as no-ops (one-way, R5 — it holds no upstream reference).
class CountingRenderAdapter implements RenderPort {
  renderCalls = 0;
  transitionCalls = 0;
  initCalls = 0;
  destroyCalls = 0;

  init(): void {
    this.initCalls += 1;
  }
  render(_snapshot: BattleState): void {
    void _snapshot;
    this.renderCalls += 1;
  }
  renderTransition(_prev: BattleState, _next: BattleState, _beats: Beat[]): void {
    void _prev;
    void _next;
    void _beats;
    this.transitionCalls += 1;
  }
  renderBeatBehaviors(_prev: BattleState, _next: BattleState, _beats: Beat[], _view: AnnotatedView): void {
    void _prev;
    void _next;
    void _beats;
    void _view;
  }
  destroy(): void {
    this.destroyCalls += 1;
  }
}

// The boot handle, EXTENDED with the Story 4.4 `legend` member the boot now returns. `legend` is a thin
// handle the test (and main.ts) drive: { open, close, toggle, isOpen }. Accessing it at runtime before
// the boot provides it yields undefined -> `.open()` throws (the intended red).
type LegendControl = {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
};

type LegendBootHandle = {
  adapter: RenderPort;
  controls: { root: HTMLElement; sync(): void; destroy(): void };
  dispatch: (action: PlaybackAction) => void;
  advanceIfPlaying: () => void;
  getState: () => PlaybackState;
  isCinematicActive: () => boolean;
  legend: LegendControl;
  destroy(): void;
};

let host: HTMLElement;
let booted: LegendBootHandle | undefined;

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

function bootWithFake(adapter: RenderPort): LegendBootHandle {
  return startArena('game-container', { createAdapter: () => adapter }) as unknown as LegendBootHandle;
}

describe('Story 4.4 AC1 — open/close the Legend does NOT mutate playback (the non-interruption gate)', () => {
  it('a PAUSED arena: PlaybackState + BattleState are DEEP-EQUAL before vs after open()->close()', () => {
    const adapter = new CountingRenderAdapter();
    booted = bootWithFake(adapter);

    // Boots PAUSED at t=0 (Story 2.5).
    expect(booted.getState().status).toBe('paused');
    const before = structuredClone(booted.getState());
    const rendersBefore = adapter.renderCalls;
    const transitionsBefore = adapter.transitionCalls;

    booted.legend.open();
    booted.legend.close();

    const after = booted.getState();
    // cursor / status / speed AND the BattleState are unchanged — the portal holds no dispatch edge to
    // the reducer, so this is true BY CONSTRUCTION; the gate PINS it so a future stray dispatch fails RED.
    expect(after).toEqual(before);
    expect(after.status).toBe(before.status);
    expect(after.cursor).toBe(before.cursor);
    expect(after.speed).toBe(before.speed);
    expect(after.battleState).toEqual(before.battleState);

    // open/close drove NO render command either (it touches only its own visibility, not the render path)...
    expect(adapter.renderCalls).toBe(rendersBefore);
    expect(adapter.transitionCalls).toBe(transitionsBefore);
    // ...and it did NOT set the Story 3.4 cinematic-suspend flag (that path WOULD interrupt — Dev Notes #5).
    expect(booted.isCinematicActive()).toBe(false);
  });

  it('a PLAYING, mid-playback arena: open()->close() leaves cursor/status/speed/BattleState untouched', () => {
    const adapter = new CountingRenderAdapter();
    booted = bootWithFake(adapter);

    // Advance a few beats so the cursor + BattleState are non-trivial, then open/close while playing.
    booted.dispatch({ type: 'play' });
    booted.advanceIfPlaying();
    booted.advanceIfPlaying();
    expect(booted.getState().status).toBe('playing');
    expect(booted.getState().cursor).toBeGreaterThan(0);

    const before = structuredClone(booted.getState());

    booted.legend.open();
    booted.legend.close();

    const after = booted.getState();
    expect(after).toEqual(before); // cursor/status/speed + battleState all unchanged across open->close
    expect(booted.isCinematicActive()).toBe(false);
  });

  it('the overlay never dispatches: an open() with no close() also leaves the reducer state put', () => {
    const adapter = new CountingRenderAdapter();
    booted = bootWithFake(adapter);

    const before = structuredClone(booted.getState());
    booted.legend.open(); // open and LEAVE it open
    const afterOpen = booted.getState();
    expect(afterOpen).toEqual(before); // opening alone moved nothing (no pause/seek/restart dispatched)
    expect(booted.legend.isOpen()).toBe(true);
  });
});

describe('Story 4.4 AC1 — the converse positive: playback keeps ADVANCING while the Legend is open', () => {
  it('with the overlay OPEN, ticking the loop still advances the cursor (open does not freeze playback)', () => {
    const adapter = new CountingRenderAdapter();
    booted = bootWithFake(adapter);

    booted.dispatch({ type: 'play' });
    booted.legend.open();
    expect(booted.legend.isOpen()).toBe(true);

    const cursorBefore = booted.getState().cursor;
    booted.advanceIfPlaying(); // the rAF loop keeps ticking while the overlay is open
    const cursorAfter = booted.getState().cursor;

    // The forward tick advanced exactly as it would with the overlay closed — the portal is invisible to
    // the status-gated rAF loop (it never set cinematicActive, never paused). [story Dev Notes #5]
    expect(cursorAfter).toBeGreaterThan(cursorBefore);
    expect(booted.legend.isOpen()).toBe(true); // still open; advancing playback did not close it
  });

  it('opening the Legend while PAUSED does not start playback (it is not a play affordance)', () => {
    const adapter = new CountingRenderAdapter();
    booted = bootWithFake(adapter);

    expect(booted.getState().status).toBe('paused');
    booted.legend.open();
    booted.advanceIfPlaying(); // still paused -> a no-op; opening the portal did not auto-play

    expect(booted.getState().status).toBe('paused');
    expect(booted.getState().cursor).toBe(0);
  });
});

describe('Story 4.4 AC2 — opening the Legend REVEALS the active beat`s real Layer-0 event(s) (the reveal seam, fantasy -> real)', () => {
  // TEST-REVIEW (Story 4.4 test-quality pass): AC2 is "the portal resolves the beat's groundingPointer to
  // show the real Event(s)". The boot's `getActiveGrounding` accessor (cursor -> active grounded beat ->
  // resolveGrounding -> real eventIds, fed to the overlay's grounding section) is the PRODUCTION reveal
  // seam — yet it had NO test: portal.test.ts proves `resolveGrounding` in isolation and legend-overlay's
  // own suite stubs the grounding, but nothing exercised the live cursor -> active-beat selection ->
  // resolved real eventIds -> DOM panel through the REAL wiring. A regression in beatIndexOfAnchor, the
  // `idx >= cursor` boundary, or the latest-wins pick would pass every prior gate. These pin it end-to-end
  // on the committed fixture (dispel = beat 0 / grounds u-0002#1,u-0002#2,u-0003#0; shaman = beat 7 /
  // grounds u-0009#0,u-0010#0 — the SAME real Layer-0 truth the FixtureInterpreter authored). The overlay
  // mounts into #app, so we read its rendered grounding via the live DOM (jsdom). [story Task 4, AC2]
  function groundingText(): string {
    const el = document.querySelector<HTMLElement>('.legend-grounding');
    if (!el) throw new Error('the boot must mount the Legend overlay (with a grounding section) into #app');
    // Read only when visible — a hidden section carries no reveal.
    return el.hidden ? '' : (el.textContent ?? '');
  }

  it('after reaching the Dispel beat, opening the Legend shows the dispel`s real eventIds', () => {
    const adapter = new CountingRenderAdapter();
    booted = bootWithFake(adapter);

    booted.dispatch({ type: 'play' });
    booted.advanceIfPlaying(); // cross Beat[0] (the Dispel) — the cursor advances past it

    booted.legend.open();
    const text = groundingText();
    // Accurate to the real Event (AC2): the dispel grounds the assumption text + the ground-truth Read pair.
    expect(text).toContain('dispel');
    expect(text).toContain('u-0002#1');
    expect(text).toContain('u-0002#2');
    expect(text).toContain('u-0003#0');
  });

  it('before ANY grounded beat is reached (cursor=0, paused), the grounding section stays hidden (fail-closed)', () => {
    const adapter = new CountingRenderAdapter();
    booted = bootWithFake(adapter);

    // Boots PAUSED at cursor 0 — no beat reached yet, so the accessor returns null and the panel must not
    // assert a reveal it has not earned (the fail-closed branch through the real boot wiring).
    expect(booted.getState().cursor).toBe(0);
    booted.legend.open();
    expect(groundingText()).toBe('');
  });

  it('once the Shaman beat is reached, the reveal switches to the LATEST grounded beat (shaman`s real events)', () => {
    const adapter = new CountingRenderAdapter();
    booted = bootWithFake(adapter);

    // Advance to the end so BOTH dispel (beat 0) and shaman (beat 7) are behind the cursor; the accessor
    // picks the LATEST grounded beat (shaman), proving the latest-wins selection over the live cursor.
    booted.dispatch({ type: 'play' });
    for (let i = 0; i < 40; i++) booted.advanceIfPlaying();

    booted.legend.open();
    const text = groundingText();
    expect(text).toContain('shaman');
    expect(text).toContain('u-0009#0');
    expect(text).toContain('u-0010#0');
    // It is the shaman reveal now, not the stale dispel one (latest grounded beat wins).
    expect(text).not.toContain('u-0002#1');
  });
});

describe('Story 4.4 — the boot OWNS the overlay lifecycle (created at boot, torn down in destroy())', () => {
  it('destroy() tears down the overlay alongside controls/adapter (no leaked overlay on re-boot)', () => {
    const adapter = new CountingRenderAdapter();
    const handle = bootWithFake(adapter);

    // The legend handle exists at boot (mounted additively, the createControls precedent).
    expect(typeof handle.legend.open).toBe('function');

    handle.destroy();
    // The adapter was torn down (the boot owns the lifecycle); a duplicate teardown must be safe.
    expect(adapter.destroyCalls).toBeGreaterThan(0);
    expect(() => handle.destroy()).not.toThrow();
    // already torn down via the local handle; do not double-destroy in afterEach
    booted = undefined;
  });
});
