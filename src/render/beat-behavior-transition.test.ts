import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleState, BattleTimeline, Beat } from '../schema/battle-timeline';
import type { AnnotatedView } from '../interpret/overlay';
import type { RenderPort } from './render-port';
import type { BeatSignal } from '../interpret/beat-signal';

// RED-PHASE acceptance tests for Story 3.3 (Task 3 + Task 4) — the ONE-WAY behavior SEAM wiring,
// proven WITHOUT Phaser via a FAKE consumer. These FAIL until (a) src/render/beat-behavior.ts
// exports `planBeatBehaviors`, (b) src/interpret/beat-signal.ts exports `BeatSignal`, and (c) the
// RenderPort gains the one-way `renderBeatBehaviors(prev, next, beats, view): void` command
// (Option A — the same extension Story 2.4 made for renderTransition). The FakeBehaviorAdapter's
// `renderBeatBehaviors` then satisfies `implements RenderPort` and records each transition; that
// missing member is part of the intended RED.
//
// Covers AC1's one-way contract for the behavior path (the analogue of animation-transition.test.ts,
// extended to renderBeatBehaviors): the seam hands the PURE planBeatBehaviors a
// (prev, next, beats, view) transition; the consumer only RECEIVES it (it holds no upstream
// reference). We assert:
//   - the recorded { intents, signals } equal planBeatBehaviors(prev, next, beats, view) per transition,
//   - renderBeatBehaviors returns void (a COMMAND, not a query — nothing flows back upstream),
//   - the reducer / timeline / snapshots / overlay are NOT mutated by driving the consumer (R5/AC1).
// This proves the behavior seam is one-way and renderer-agnostic with zero Phaser (node env).
//
// Pipeline reuse: same committed-fixture chain as animation-transition.test.ts L35-56 (copied verbatim).
import { planBeatBehaviors, type BeatBehaviorIntent } from './beat-behavior';
import { foldBattleState } from '../model/battle-model';
import { createPlaybackReducer, initialPlaybackState } from '../model/playback';
import { pace } from '../pace/derive-beats';
import { translate } from '../translate/translate';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';
import { applyOverlay } from '../interpret/overlay';
import { FixtureInterpreter } from '../interpret/fixture-interpreter';

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

async function overlay(): Promise<AnnotatedView> {
  const events = runIngest();
  const annotations = await new FixtureInterpreter().interpret(events);
  return applyOverlay(events, annotations);
}

// A recorded behavior transition: the raw (prev, next, beats, view) args + the { intents, signals }
// the consumer computed from them via the PURE planBeatBehaviors. The fake cannot reach upstream — it
// only RECEIVES.
type RecordedBehavior = {
  prev: BattleState;
  next: BattleState;
  beats: Beat[];
  view: AnnotatedView;
  intents: BeatBehaviorIntent[];
  signals: BeatSignal[];
};

// The FAKE consumer extends the one-way RenderPort with the behavior command. `implements RenderPort`
// only typechecks once RenderPort declares renderBeatBehaviors (Option A) — that missing member is part
// of the intended RED. renderTransition/render/init/destroy are no-op stubs (this fake only exercises
// the behavior seam). renderBeatBehaviors forwards to the PURE planBeatBehaviors and records the result,
// exactly as the Phaser adapter will (which forwards intents to scene.playBeatBehaviors + signals to the
// boot-owned sink).
class FakeBehaviorAdapter implements RenderPort {
  readonly behaviors: RecordedBehavior[] = [];

  init(): void {}
  render(): void {}
  renderTransition(): void {}
  destroy(): void {}

  renderBeatBehaviors(prev: BattleState, next: BattleState, beats: Beat[], view: AnnotatedView): void {
    const { intents, signals } = planBeatBehaviors(prev, next, beats, view);
    this.behaviors.push({ prev, next, beats, view, intents, signals });
  }
}

describe('Story 3.3 AC1 — the behavior seam (renderBeatBehaviors) is a renderer-agnostic, one-way command', () => {
  it('renderBeatBehaviors returns void — it is a COMMAND, not a query (no value flows back)', async () => {
    const adapter: RenderPort = new FakeBehaviorAdapter();
    const tl = timeline();
    const view = await overlay();
    const result = adapter.renderBeatBehaviors!(
      foldBattleState(tl, 0),
      foldBattleState(tl, 1),
      tl.beats.slice(0, 1),
      view,
    );
    expect(result).toBeUndefined();
  });

  it('driven by a REAL reducer walk, each recorded { intents, signals } equals planBeatBehaviors(prev, next, beatsAdvanced, view)', async () => {
    const tl = timeline();
    const view = await overlay();
    const reducer = createPlaybackReducer(tl);
    const adapter = new FakeBehaviorAdapter();

    // Pump the reducer like the boot's rAF loop (Task 3): tick to the end, calling
    // renderBeatBehaviors(prev, next, beatsAdvanced, view) on each forward tick — exactly the one-way
    // data flow timeline -> reducer -> (BattleState, cursor) -> [boot computes beatsAdvanced] ->
    // renderBeatBehaviors -> planBeatBehaviors -> { intents, signals }.
    let state = initialPlaybackState(tl);
    for (let i = 0; i < tl.beats.length; i++) {
      const prev = state.battleState;
      const prevCursor = state.cursor;
      state = reducer(state, { type: 'tick' });
      const beatsAdvanced = tl.beats.slice(prevCursor, state.cursor);
      adapter.renderBeatBehaviors(prev, state.battleState, beatsAdvanced, view);
    }

    // One behavior call per tick.
    expect(adapter.behaviors).toHaveLength(tl.beats.length);
    for (const b of adapter.behaviors) {
      // What the consumer computed is byte-identical to a fresh planBeatBehaviors over the same
      // (prev, next, beats, view) — it received exactly the transition and ran the PURE layer.
      expect({ intents: b.intents, signals: b.signals }).toEqual(
        planBeatBehaviors(b.prev, b.next, b.beats, b.view),
      );
    }
  });

  it('the fixture walk surfaces exactly ONE scribe-correction signal end-to-end (the Dispel), proving the seam carries signals one-way', async () => {
    // AC2's signal is the cross-layer output; the seam must surface it to the boot-owned sink. Drive the
    // whole timeline and collect every signal the consumer recorded — the real fixture has a single
    // Dispel, so exactly one scribe-correction signal flows across the seam.
    const tl = timeline();
    const view = await overlay();
    const reducer = createPlaybackReducer(tl);
    const adapter = new FakeBehaviorAdapter();

    let state = initialPlaybackState(tl);
    for (let i = 0; i < tl.beats.length; i++) {
      const prev = state.battleState;
      const prevCursor = state.cursor;
      state = reducer(state, { type: 'tick' });
      adapter.renderBeatBehaviors(prev, state.battleState, tl.beats.slice(prevCursor, state.cursor), view);
    }

    const signals = adapter.behaviors.flatMap((b) => b.signals);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.kind).toBe('scribe-correction');
    expect(signals[0]!.beatType).toBe('dispel');
  });

  it('the consumer cannot feed upstream — driving renderBeatBehaviors does NOT mutate the reducer state, the snapshots, the timeline, or the overlay', async () => {
    const tl = timeline();
    const view = await overlay();
    const tlBefore = JSON.stringify(tl);
    const viewBefore = JSON.stringify([view.events, view.annotations]);
    const adapter = new FakeBehaviorAdapter();

    const state = initialPlaybackState(tl);
    const reducer = createPlaybackReducer(tl);
    const next = reducer(state, { type: 'tick' });

    const prevSnapBefore = JSON.stringify(state.battleState);
    const nextSnapBefore = JSON.stringify(next.battleState);
    const beats = tl.beats.slice(state.cursor, next.cursor);
    const beatsBefore = JSON.stringify(beats);

    adapter.renderBeatBehaviors(state.battleState, next.battleState, beats, view);

    // renderBeatBehaviors returns nothing and the consumer holds no upstream reference, so nothing it
    // could do can reach the snapshots / beats / timeline / overlay. Pin that immutability (R5/AC1).
    expect(JSON.stringify(state.battleState)).toBe(prevSnapBefore);
    expect(JSON.stringify(next.battleState)).toBe(nextSnapBefore);
    expect(JSON.stringify(beats)).toBe(beatsBefore);
    expect(JSON.stringify(tl)).toBe(tlBefore);
    expect(JSON.stringify([view.events, view.annotations])).toBe(viewBefore);
  });
});
