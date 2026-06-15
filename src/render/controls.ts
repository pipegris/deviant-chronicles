import type { PlaybackAction, PlaybackState } from '../model/playback';

// controls — the on-screen playback CONTROLS (FR-6): an HTML DOM overlay (play/pause/restart +
// speed select + range scrubber) wired to Story 2.2's pure reducer cursor. It DISPATCHES
// PlaybackActions; it NEVER computes battle state — the reducer owns all derivation (the render-side
// analogue of R1's "render reads Layer-0 output, never recomputes mechanics").
//
// WHY an HTML overlay (not Phaser DOM): it imports NO phaser, so it stays renderer-agnostic (a
// PixiJS swap leaves it untouched) and R5 is satisfied with nothing to confine; native controls are
// accessible + testable under jsdom without booting Phaser. It imports only the PlaybackAction/
// PlaybackState TYPES from ../model/playback (render -> model is allowed; a type import adds no
// Layer-0 runtime coupling — R1/R4 hold).

export type ControlOptions = {
  parent: HTMLElement;
  beatCount: number;
  dispatch: (action: PlaybackAction) => void;
  getState: () => PlaybackState;
  speeds?: number[];
};

export type PlaybackControls = {
  root: HTMLElement;
  sync(): void;
  destroy(): void;
};

const DEFAULT_SPEEDS = [1, 2];

export function createControls(opts: ControlOptions): PlaybackControls {
  const { parent, beatCount, dispatch, getState } = opts;
  const speeds = opts.speeds ?? DEFAULT_SPEEDS;

  const root = document.createElement('div');
  root.className = 'playback-controls';

  // All listeners are bound to one AbortController.signal so destroy() can remove them ALL at once
  // (abort()), not merely detach the DOM — a retained button reference must stop dispatching after
  // teardown, so a re-boot leaks no live listeners.
  const ac = new AbortController();
  const { signal } = ac;

  // play / pause / restart (AC1): three <button>s, each dispatching exactly the reducer's verb. The
  // reducer owns the semantics (restart resets cursor->0 + pauses, PRESERVING speed) — not re-done here.
  const playButton = document.createElement('button');
  playButton.type = 'button';
  playButton.textContent = 'Play';
  playButton.addEventListener('click', () => dispatch({ type: 'play' }), { signal });

  const pauseButton = document.createElement('button');
  pauseButton.type = 'button';
  pauseButton.textContent = 'Pause';
  pauseButton.addEventListener('click', () => dispatch({ type: 'pause' }), { signal });

  const restartButton = document.createElement('button');
  restartButton.type = 'button';
  restartButton.textContent = 'Restart';
  restartButton.addEventListener('click', () => dispatch({ type: 'restart' }), { signal });

  // The scrub control (AC2): a native range slider whose value IS the cursor (a beat index). On
  // `input` (fires continuously DURING a drag) it dispatches a trivial slider-value -> seek(cursor)
  // map; correctness is Story 2.2's path-independent seek==fold invariant, NOT any math here.
  // max=beatCount (NOT beatCount-1) so the far-right reaches the held-victory frame the reducer pins
  // at cursor==beats.length; step=1 so the slider only ever emits whole beats (no fractional seek).
  const scrubber = document.createElement('input');
  scrubber.type = 'range';
  scrubber.min = '0';
  scrubber.max = String(beatCount);
  scrubber.step = '1';
  scrubber.value = String(getState().cursor);
  scrubber.addEventListener(
    'input',
    () => dispatch({ type: 'seek', cursor: Number(scrubber.value) }),
    { signal },
  );

  // The speed control (AC1, "at least normal/fast"): a discrete <select> over `speeds` (default
  // [1, 2]). The value is the LOGICAL beats-per-tick multiplier (at speed M one `tick` advances M
  // beats). The reducer's clampSpeed floors + max(1,...) + finiteness-guards it, so a raw Number is safe.
  const speedSelect = document.createElement('select');
  for (const speed of speeds) {
    const option = document.createElement('option');
    option.value = String(speed);
    option.textContent = `${speed}x`;
    speedSelect.appendChild(option);
  }
  speedSelect.value = String(getState().speed);
  speedSelect.addEventListener(
    'change',
    () => dispatch({ type: 'setSpeed', speed: Number(speedSelect.value) }),
    { signal },
  );

  root.append(playButton, pauseButton, restartButton, scrubber, speedSelect);
  parent.appendChild(root);

  // sync — reflect the reducer's OUTPUT into the UI (slider thumb tracks the live cursor; play/pause
  // enabled-state tracks status). Dispatch-free: a programmatic `.value`/`disabled` set does NOT fire
  // `input`/`change` (DOM spec), so this read-back is a one-way reflection, never a feedback edge.
  function sync(): void {
    const state = getState();
    scrubber.value = String(state.cursor);
    speedSelect.value = String(state.speed);
    const playing = state.status === 'playing';
    playButton.disabled = playing;
    pauseButton.disabled = !playing;
  }

  sync();

  function destroy(): void {
    ac.abort(); // remove all listeners…
    root.remove(); // …and detach the DOM
  }

  return { root, sync, destroy };
}
