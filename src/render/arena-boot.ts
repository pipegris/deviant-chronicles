import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleTimeline } from '../schema/battle-timeline';
import { createPlaybackReducer, initialPlaybackState } from '../model/playback';
import type { PlaybackState } from '../model/playback';
import { pace } from '../pace/derive-beats';
import { translate } from '../translate/translate';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';
import { PhaserRenderAdapter } from './phaser/phaser-render-adapter';

// arena-boot — wires the Story 2.2 playback reducer to the Phaser RenderPort adapter and proves
// playback CAN drive the arena. The data flow is strictly  timeline -> playback reducer ->
// BattleState -> RenderPort(Phaser)  (architecture's Data Flow), with NO upstream feedback (AC1).
//
// SCOPE: this is the MINIMAL drive — it renders the t=0 snapshot and pumps `tick` on a wall-clock
// rAF loop so the bars/gauge visibly move. The on-screen play/pause/scrub/speed CONTROLS are Story
// 2.5 and are NOT built here. The rAF wall-clock legitimately lives in render/ (NOT a Layer-0
// module). [epics.md#Story-2.5; story Task 6]
//
// v0.1 derives the BattleTimeline from the COMMITTED ingest fixtures via the same parse -> normalize
// -> merge -> translate -> pace chain the model tests fold — there is no committed ReplayBundle yet
// (public/bundles/ is empty; bundle-building is Epic 5). The bundle-load path drops in cleanly later
// (the reducer's input is a BattleTimeline either way). Importing ingest/translate/pace from render/
// is allowed — R1 only forbids Layer-0 importing interpret/; nothing forbids render -> Layer-0.
// [src/model/battle-model.test.ts L41-57; architecture.md#Data Flow L400]

// Fixtures inlined via Vite's ?raw so the browser bundle carries them as strings (no fs in the
// browser). These are the SAME committed fixtures the golden snapshot / model tests use.
import sampleTranscript from '../ingest/__fixtures__/sample-transcript.jsonl?raw';
import sampleJournal from '../ingest/__fixtures__/sample-journal.jsonl?raw';

// The dev-stream id for the sample fixtures (the same constant the ingest/model tests use).
const DEV_STREAM_ID = 'aecfc998031eb0576';

// Replicate the test pipeline exactly so the arena folds the identical committed BattleTimeline.
function deriveTimeline(): BattleTimeline {
  const transcript = normalizeTranscript(parseTranscript(sampleTranscript, DEV_STREAM_ID), DEV_STREAM_ID);
  const devMaxEpoch = Math.max(
    ...transcript.map((e) => Date.parse(e.timestamp)).filter((n) => !Number.isNaN(n)),
  );
  const journal = normalizeJournal(parseJournal(sampleJournal), devMaxEpoch + 1);
  const events: NormalizedEvent[] = mergeStreams([transcript, journal]);
  return pace(translate(events));
}

// startArena — boot the Phaser arena, render the t=0 frame, then pump `tick` on a rAF loop so the
// snapshot playback visibly drives the bars/gauge. Returns the adapter so a caller (or a future
// controls UI) can drive/destroy it. The reducer is the canonical pure (state, action) => state.
export function startArena(parent = 'game-container'): PhaserRenderAdapter {
  const timeline = deriveTimeline();
  const reducer = createPlaybackReducer(timeline);
  let state: PlaybackState = initialPlaybackState(timeline);

  const adapter = new PhaserRenderAdapter(parent);
  adapter.init();
  adapter.render(state.battleState); // show t=0

  // Wall-clock drive (render-side, NOT Layer-0): advance ~4 ticks/sec while frames remain, rendering
  // state.battleState after each tick — the one-way data flow reducer -> RenderPort. Stops at the end
  // (the held victory frame). This is the MINIMAL proof that playback drives the arena, not the 2.5
  // controls loop. Guarded for environments without requestAnimationFrame (e.g. SSR/test).
  if (typeof requestAnimationFrame === 'function') {
    const stepMs = 250;
    let lastStep = 0;
    const loop = (now: number): void => {
      if (now - lastStep >= stepMs) {
        lastStep = now;
        if (state.cursor < timeline.beats.length) {
          state = reducer(state, { type: 'tick' });
          adapter.render(state.battleState);
        }
      }
      if (state.cursor < timeline.beats.length) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  return adapter;
}
