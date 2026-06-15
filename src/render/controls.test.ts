// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleTimeline } from '../schema/battle-timeline';

// RED-PHASE acceptance tests for Story 2.5 (Task 4) — the on-screen playback CONTROLS
// (`src/render/controls.ts`, FR-6) wired to the Story 2.2 pure reducer cursor. These FAIL until
// `createControls` is exported from ./controls (the `import { createControls }` resolves to
// nothing and the module import errors — the intended red, exactly like controls' sibling render
// tests were in their own red phase).
//
// SCOPE — the GATE-PROVABLE surface (story AC §"What the gate CAN prove"): the control->ACTION
// WIRING. Under jsdom we build the control bar, dispatch real DOM events (click / input), and
// assert the EXACT PlaybackAction fired and (for scrub==play) that driving the controls through
// the REAL reducer yields foldBattleState(timeline, cursor) at every scrubbed position. The visual
// LAYOUT / feel is OPERATOR-verified (`pnpm dev`) and is deliberately NOT asserted here.
//
// Pipeline reuse (Dev Notes "Reuse the committed-fixture pipeline"): the scrub==play test reads the
// COMMITTED ingest fixtures with fs IN THE TEST (tests are not Layer-0 modules, so this respects R2)
// and runs the SAME parse -> normalize -> merge -> translate -> pace chain the golden snapshot pins,
// then drives the resulting BattleTimeline through the controls' dispatch into the real reducer.
// foldBattleState is reused VERBATIM as the oracle (Story 2.1 / 2.2), copied from playback.test.ts.
import { createControls } from './controls';
import type { PlaybackControls } from './controls';
import { createPlaybackReducer, initialPlaybackState } from '../model/playback';
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

// Copied verbatim from src/model/playback.test.ts L42-58 so the controls drive the EXACT committed
// BattleTimeline the golden snapshot pins.
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

// A minimal hand-built PlaybackState for the wiring tests (no real reducer needed when we only
// assert the dispatched action). `battleState` is taken from a real fold so the type is satisfied
// without re-deriving it by hand.
function fakeState(tl: BattleTimeline, over: Partial<PlaybackState> = {}): PlaybackState {
  return {
    status: 'paused',
    cursor: 0,
    speed: 1,
    battleState: foldBattleState(tl, over.cursor ?? 0),
    ...over,
  };
}

// jsdom host: a fresh detached parent per test (the story's `phaser-render-adapter.test.ts` L60-71
// pattern). The controls mount INTO `parent`; we clean both controls and host in afterEach.
let parent: HTMLElement;
let controls: PlaybackControls | undefined;

beforeEach(() => {
  parent = document.createElement('div');
  document.body.appendChild(parent);
});

afterEach(() => {
  controls?.destroy();
  controls = undefined;
  parent.remove();
  vi.restoreAllMocks();
});

// Locate a control inside the bar by its visible text or input type. The controls module owns the
// exact DOM shape (buttons + a range slider + a discrete speed control); these queries find them by
// ROLE/intent, not by a brittle id, so the dev has latitude in markup as long as the controls exist.
// Collect the control bar's <button>s as a properly-typed array. (A plain spread over the
// NodeListOf<HTMLButtonElement> keeps the element type under this strict TS config, where
// Array.from over a DOM collection widens to unknown[].)
function allButtons(root: HTMLElement): HTMLButtonElement[] {
  const out: HTMLButtonElement[] = [];
  root.querySelectorAll<HTMLButtonElement>('button').forEach((b) => out.push(b));
  return out;
}

function buttonByLabel(root: HTMLElement, label: RegExp): HTMLButtonElement {
  const btn = allButtons(root).find((b) => label.test((b.textContent ?? '').trim()));
  if (!btn) throw new Error(`no <button> matching ${label} in control bar`);
  return btn;
}

function rangeSlider(root: HTMLElement): HTMLInputElement {
  const slider = root.querySelector('input[type="range"]');
  if (!slider) throw new Error('no <input type="range"> scrubber in control bar');
  return slider as HTMLInputElement;
}

describe('Story 2.5 AC1 — play / pause / restart buttons dispatch the exact reducer action', () => {
  it('clicking PLAY dispatches exactly {type:"play"}', () => {
    const tl = timeline();
    const dispatch = vi.fn<(a: PlaybackAction) => void>();
    controls = createControls({ parent, beatCount: tl.beats.length, dispatch, getState: () => fakeState(tl) });

    buttonByLabel(controls.root, /play/i).click();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'play' });
  });

  it('clicking PAUSE dispatches exactly {type:"pause"}', () => {
    const tl = timeline();
    const dispatch = vi.fn<(a: PlaybackAction) => void>();
    // getState reports 'playing' so a single play/pause toggle (if used) shows its PAUSE affordance.
    controls = createControls({
      parent,
      beatCount: tl.beats.length,
      dispatch,
      getState: () => fakeState(tl, { status: 'playing' }),
    });
    controls.sync();

    buttonByLabel(controls.root, /pause/i).click();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'pause' });
  });

  it('clicking RESTART dispatches exactly {type:"restart"}', () => {
    const tl = timeline();
    const dispatch = vi.fn<(a: PlaybackAction) => void>();
    controls = createControls({ parent, beatCount: tl.beats.length, dispatch, getState: () => fakeState(tl) });

    buttonByLabel(controls.root, /restart|reset/i).click();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'restart' });
  });
});

describe('Story 2.5 AC1 — the speed control dispatches setSpeed with the logical multiplier', () => {
  it('selecting "fast" dispatches {type:"setSpeed", speed:2}; "normal" dispatches speed:1', () => {
    const tl = timeline();
    const dispatch = vi.fn<(a: PlaybackAction) => void>();
    controls = createControls({
      parent,
      beatCount: tl.beats.length,
      dispatch,
      getState: () => fakeState(tl),
      speeds: [1, 2],
    });

    // The speed control is a DISCRETE control (a <select> over the speeds, or toggle buttons) — NOT
    // a free-text field. Drive whichever shape the controls render: a <select> gets its value set +
    // a change/input event; toggle <button>s get clicked by their "2x"/"1x" label.
    const select = controls.root.querySelector('select');
    if (select) {
      select.value = '2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      expect(dispatch).toHaveBeenLastCalledWith({ type: 'setSpeed', speed: 2 });

      select.value = '1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      expect(dispatch).toHaveBeenLastCalledWith({ type: 'setSpeed', speed: 1 });
    } else {
      buttonByLabel(controls.root, /2\s*[x×]|fast/i).click();
      expect(dispatch).toHaveBeenLastCalledWith({ type: 'setSpeed', speed: 2 });

      buttonByLabel(controls.root, /1\s*[x×]|normal/i).click();
      expect(dispatch).toHaveBeenLastCalledWith({ type: 'setSpeed', speed: 1 });
    }
  });

  it('offers AT LEAST normal(1) and fast(2) speed options', () => {
    const tl = timeline();
    const dispatch = vi.fn<(a: PlaybackAction) => void>();
    controls = createControls({
      parent,
      beatCount: tl.beats.length,
      dispatch,
      getState: () => fakeState(tl),
      speeds: [1, 2],
    });

    // Whatever the shape, both a normal and a fast affordance must be reachable: either two <option>s
    // or two toggle buttons. Assert the speed control surfaces >= 2 discrete choices.
    const select = controls.root.querySelector<HTMLSelectElement>('select');
    if (select) {
      const values: number[] = [];
      for (let i = 0; i < select.options.length; i++) values.push(Number(select.options[i]!.value));
      expect(values).toEqual(expect.arrayContaining([1, 2]));
    } else {
      const speedButtons = allButtons(controls.root).filter((b) =>
        /1\s*[x×]|2\s*[x×]|normal|fast/i.test((b.textContent ?? '').trim()),
      );
      expect(speedButtons.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('Story 2.5 AC2 — the scrubber is a native range slider that dispatches seek(value)', () => {
  it('the slider is min=0, max=beatCount (reaches the held-victory frame), step=1', () => {
    const tl = timeline();
    const dispatch = vi.fn<(a: PlaybackAction) => void>();
    controls = createControls({ parent, beatCount: tl.beats.length, dispatch, getState: () => fakeState(tl) });

    const slider = rangeSlider(controls.root);
    expect(slider.min).toBe('0');
    // max === beats.length (NOT beats.length-1) so the far-right reaches foldBattleState(tl, len).
    expect(Number(slider.max)).toBe(tl.beats.length);
    expect(slider.step).toBe('1');
  });

  it('dragging the slider to value N dispatches {type:"seek", cursor:N}', () => {
    const tl = timeline();
    const dispatch = vi.fn<(a: PlaybackAction) => void>();
    controls = createControls({ parent, beatCount: tl.beats.length, dispatch, getState: () => fakeState(tl) });

    const slider = rangeSlider(controls.root);
    // In jsdom a range value is a string; setting .value + dispatching `input` IS the headless
    // equivalent of a drag (input fires continuously during a real drag).
    slider.value = '4';
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    expect(dispatch).toHaveBeenLastCalledWith({ type: 'seek', cursor: 4 });
  });
});

describe('Story 2.5 AC2 — scrub==play through the REAL reducer (the headline integration proof)', () => {
  it('for several scrub positions N, the control-driven reducer state equals foldBattleState(tl, N)', () => {
    const tl = timeline();
    expect(tl.beats.length).toBeGreaterThan(4); // guard: the fixture is the 10-beat committed timeline

    const reducer = createPlaybackReducer(tl);
    let state = initialPlaybackState(tl);
    // The boot's real dispatch shape: apply the action to the live state. The controls READ getState()
    // (a closure over `state`) and DISPATCH actions — exactly the runtime seam, minus the renderer.
    const dispatch = (action: PlaybackAction): void => {
      state = reducer(state, action);
    };
    controls = createControls({ parent, beatCount: tl.beats.length, dispatch, getState: () => state });

    const slider = rangeSlider(controls.root);
    // Walk the slider across the full cursor domain, including the inclusive far-right (beats.length).
    for (const n of [0, 1, 4, 7, tl.beats.length]) {
      slider.value = String(n);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      // AC2: "drag to any point -> the Arena renders the correct state for that position". The control
      // wiring + the reducer together yield exactly the path-independent fold oracle — the controls do
      // NO state math; correctness is Story 2.2's seek==fold invariant exercised through the real UI.
      expect(state.cursor).toBe(n);
      expect(state.battleState).toEqual(foldBattleState(tl, n));
    }
  });

  it('an out-of-range scrub fails CLOSED through the wiring: seek(>max) lands on fold(beats.length)', () => {
    const tl = timeline();
    const reducer = createPlaybackReducer(tl);
    let state = initialPlaybackState(tl);
    const dispatch = (action: PlaybackAction): void => {
      state = reducer(state, action);
    };
    controls = createControls({ parent, beatCount: tl.beats.length, dispatch, getState: () => state });

    // AC2 is "drag to ANY point". The in-range walk above never forces the reducer's CLAMP through the
    // control path. Drive the slider PAST max (a value a non-range caller — or a future markup change —
    // could emit) and assert the wiring + reducer still produce the correct, in-range fold: the cursor
    // pins at beats.length (the held-victory frame) and the snapshot equals fold(tl, beats.length).
    // This proves the controls do NO state math and inherit the reducer's fail-closed clamp end-to-end,
    // rather than passing an out-of-range cursor straight through to a bad snapshot.
    const slider = rangeSlider(controls.root);
    slider.value = String(tl.beats.length + 5);
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    expect(state.cursor).toBe(tl.beats.length);
    expect(state.battleState).toEqual(foldBattleState(tl, tl.beats.length));
  });
});

describe('Story 2.5 — sync() reflects state into the UI as a ONE-WAY read-back (no feedback loop)', () => {
  it('after the cursor moves (tick/restart), sync() moves the slider .value to state.cursor', () => {
    const tl = timeline();
    const dispatch = vi.fn<(a: PlaybackAction) => void>();
    let cursor = 0;
    controls = createControls({
      parent,
      beatCount: tl.beats.length,
      dispatch,
      getState: () => fakeState(tl, { cursor }),
    });
    controls.sync();
    expect(rangeSlider(controls.root).value).toBe('0');

    // Simulate the cursor advancing (as a forward tick / restart would move it) then re-syncing.
    cursor = 3;
    controls.sync();
    expect(rangeSlider(controls.root).value).toBe('3');
  });

  it('sync() writes the DOM only — it NEVER dispatches (a programmatic .value set fires no input)', () => {
    const tl = timeline();
    const dispatch = vi.fn<(a: PlaybackAction) => void>();
    let status: PlaybackState['status'] = 'paused';
    controls = createControls({
      parent,
      beatCount: tl.beats.length,
      dispatch,
      getState: () => fakeState(tl, { status, cursor: 2 }),
    });

    status = 'playing';
    controls.sync(); // reflect the new status + cursor into the UI

    // The read-back is a UI reflection of the reducer's OUTPUT, not an upstream edge: sync must not
    // loop back into dispatch (setting slider.value in code does not fire `input` — DOM spec).
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('sync() reflects status into the play/pause affordance (the "behave predictably" read-back)', () => {
    const tl = timeline();
    const dispatch = vi.fn<(a: PlaybackAction) => void>();
    let status: PlaybackState['status'] = 'paused';
    controls = createControls({
      parent,
      beatCount: tl.beats.length,
      dispatch,
      getState: () => fakeState(tl, { status }),
    });

    // sync() does TWO reflections (controls.ts: slider.value AND the play/pause enabled-state). The
    // slider half is pinned above; this pins the status half so a dev cannot silently drop the
    // play/pause reflection (AC1 "behave predictably" = the UI tracks the reducer's status). Without
    // this assertion, deleting the `playButton.disabled = playing` lines passes every other test.
    const playButton = buttonByLabel(controls.root, /play/i);
    const pauseButton = buttonByLabel(controls.root, /pause/i);

    // PAUSED (construction already synced once): Play is the live affordance, Pause is inert.
    expect(playButton.disabled).toBe(false);
    expect(pauseButton.disabled).toBe(true);

    // Flip to PLAYING and re-sync: the affordance must invert (Pause now live, Play inert).
    status = 'playing';
    controls.sync();
    expect(playButton.disabled).toBe(true);
    expect(pauseButton.disabled).toBe(false);
  });
});

describe('Story 2.5 — destroy() removes the control bar (no leaked listeners / duplicate bars)', () => {
  it('after destroy() the controls are detached from parent and a click does nothing', () => {
    const tl = timeline();
    const dispatch = vi.fn<(a: PlaybackAction) => void>();
    const c = createControls({ parent, beatCount: tl.beats.length, dispatch, getState: () => fakeState(tl) });
    const playButton = buttonByLabel(c.root, /play/i);

    c.destroy();

    // The root is detached from the mount host (a re-boot will not stack duplicate control bars)...
    expect(parent.contains(c.root)).toBe(false);
    expect(parent.querySelector('button')).toBeNull();
    // ...and the listeners are gone: a click on the now-orphan button does not dispatch.
    playButton.click();
    expect(dispatch).not.toHaveBeenCalled();
    // destroy already ran; null the afterEach handle so it is not torn down twice.
    controls = undefined;
  });
});

// ---- dev-story UNIT tests (on top of the ATDD acceptance surface above): the controls.ts edge
// cases the Dev Notes call out but the acceptance tests do not pin directly. ----

describe('Story 2.5 unit — the speed control hands the reducer a NUMBER (its clamp does the rest)', () => {
  it('dispatches setSpeed with a numeric (not string) speed — guards the Number() conversion', () => {
    const tl = timeline();
    const dispatch = vi.fn<(a: PlaybackAction) => void>();
    controls = createControls({
      parent,
      beatCount: tl.beats.length,
      dispatch,
      getState: () => fakeState(tl),
      speeds: [1, 2],
    });

    const select = controls.root.querySelector<HTMLSelectElement>('select');
    if (!select) throw new Error('expected a <select> speed control');
    select.value = '2';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    const action = dispatch.mock.calls[dispatch.mock.calls.length - 1]?.[0];
    // The control passes a raw Number; the reducer's clampSpeed (floor + max(1,...) + finiteness) is
    // the ONLY validation. A string '2' would FAIL clampSpeed's Number.isFinite guard (Number.isFinite
    // rejects non-numbers) and fall back to 1 — so it is the control's Number() conversion that
    // preserves the chosen speed; this asserts that conversion happens (the payload is a real number).
    expect(action).toEqual({ type: 'setSpeed', speed: 2 });
    expect(typeof (action as { speed: number }).speed).toBe('number');
  });

  it('honors a custom speeds[] option (a later story can add [1,2,4] with no code change)', () => {
    const tl = timeline();
    const dispatch = vi.fn<(a: PlaybackAction) => void>();
    controls = createControls({
      parent,
      beatCount: tl.beats.length,
      dispatch,
      getState: () => fakeState(tl),
      speeds: [1, 2, 4],
    });

    const select = controls.root.querySelector<HTMLSelectElement>('select');
    if (!select) throw new Error('expected a <select> speed control');
    const values: number[] = [];
    for (let i = 0; i < select.options.length; i++) values.push(Number(select.options[i]!.value));
    expect(values).toEqual([1, 2, 4]);
  });
});

describe('Story 2.5 unit — sync() on construction + idempotent teardown', () => {
  it('reflects a non-zero starting cursor into the slider at build time (construction calls sync)', () => {
    const tl = timeline();
    const dispatch = vi.fn<(a: PlaybackAction) => void>();
    // getState reports cursor 5 BEFORE any sync() call — the slider must already show it.
    controls = createControls({
      parent,
      beatCount: tl.beats.length,
      dispatch,
      getState: () => fakeState(tl, { cursor: 5 }),
    });
    expect(rangeSlider(controls.root).value).toBe('5');
  });

  it('destroy() is idempotent — calling it twice does not throw (double-teardown safety)', () => {
    const tl = timeline();
    const dispatch = vi.fn<(a: PlaybackAction) => void>();
    const c = createControls({ parent, beatCount: tl.beats.length, dispatch, getState: () => fakeState(tl) });

    c.destroy();
    expect(() => c.destroy()).not.toThrow();
    controls = undefined; // already torn down; do not double-destroy in afterEach
  });
});
