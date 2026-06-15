import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleState, BattleTimeline, Beat } from '../schema/battle-timeline';
import type { RenderPort } from './render-port';

// RED-PHASE acceptance tests for Story 2.4 (Task 3 + Task 4) — the ANIMATED SEAM wiring, proven
// WITHOUT Phaser via a FAKE adapter. These FAIL until (a) src/render/animation-plan.ts exports
// `planAnimations` (the `import` resolves to nothing) and (b) the RenderPort gains the one-way
// `renderTransition(prev, next, beats): void` command (Option A) — the FakeRenderAdapter's
// `renderTransition` then satisfies `implements RenderPort` and records each transition.
//
// Covers AC1's one-way contract for the NEW animated path (the analogue of the Story 2.3
// render-port.test.ts one-way proof, extended to renderTransition): the seam computes
// beatsAdvanced render-side and hands the PURE planAnimations a (prev, next, beats) transition; the
// adapter only RECEIVES it (it holds no upstream reference). We assert:
//   - the recorded intents equal planAnimations(prev, next, beatsAdvanced) for each transition,
//   - renderTransition returns void (a COMMAND, not a query — nothing flows back upstream),
//   - the reducer / timeline / snapshots are NOT mutated by driving the adapter (one-way, R5).
// This proves the animated seam is one-way and renderer-agnostic with zero Phaser (node env).
//
// Pipeline reuse: same committed-fixture chain as render-port.test.ts L41-55 (copied verbatim).
import { planAnimations, type AnimationIntent } from './animation-plan';
import { foldBattleState } from '../model/battle-model';
import { createPlaybackReducer, initialPlaybackState } from '../model/playback';
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

// A recorded transition: the raw (prev, next, beats) args + the intents the adapter computed from
// them via the PURE planAnimations. The fake adapter cannot reach upstream — it only RECEIVES.
type RecordedTransition = {
  prev: BattleState;
  next: BattleState;
  beats: Beat[];
  intents: AnimationIntent[];
};

// The FAKE adapter extends the Story 2.3 one-way contract with the animated command. `implements
// RenderPort` only typechecks once RenderPort declares renderTransition (Option A) — that missing
// member is part of the intended RED. renderTransition forwards to the PURE planAnimations and
// records the result, exactly as the Phaser adapter will (which forwards to scene.playAnimations).
class FakeRenderAdapter implements RenderPort {
  readonly received: BattleState[] = [];
  readonly transitions: RecordedTransition[] = [];
  initCalls = 0;
  destroyCalls = 0;

  init(): void {
    this.initCalls += 1;
  }

  render(snapshot: BattleState): void {
    this.received.push(snapshot);
  }

  renderTransition(prev: BattleState, next: BattleState, beats: Beat[]): void {
    this.transitions.push({ prev, next, beats, intents: planAnimations(prev, next, beats) });
  }

  destroy(): void {
    this.destroyCalls += 1;
  }
}

describe('Story 2.4 AC1 — the animated seam (renderTransition) is a renderer-agnostic, one-way command', () => {
  it('renderTransition returns void — it is a COMMAND, not a query (no value flows back)', () => {
    const adapter: RenderPort = new FakeRenderAdapter();
    const tl = timeline();
    const result = adapter.renderTransition!(
      foldBattleState(tl, 0),
      foldBattleState(tl, 1),
      tl.beats.slice(0, 1),
    );
    expect(result).toBeUndefined();
  });

  it('driven by a REAL reducer walk, each recorded transition equals planAnimations(prev, next, beatsAdvanced)', () => {
    const tl = timeline();
    const reducer = createPlaybackReducer(tl);
    const adapter = new FakeRenderAdapter();
    adapter.init();

    // Pump the reducer like the boot's rAF loop (Task 3): render the t=0 frame (the snap path), then
    // tick to the end, calling renderTransition(prevState, nextState, beatsAdvanced) on each tick —
    // exactly the one-way data flow timeline -> reducer -> (BattleState, cursor) -> [boot computes
    // beatsAdvanced] -> renderTransition -> planAnimations -> intents.
    let state = initialPlaybackState(tl);
    adapter.render(state.battleState); // t=0 frame uses the snap path (no transition)
    for (let i = 0; i < tl.beats.length; i++) {
      const prev = state.battleState;
      const prevCursor = state.cursor;
      state = reducer(state, { type: 'tick' });
      const beatsAdvanced = tl.beats.slice(prevCursor, state.cursor);
      adapter.renderTransition(prev, state.battleState, beatsAdvanced);
    }

    // One transition per tick.
    expect(adapter.transitions).toHaveLength(tl.beats.length);
    for (const t of adapter.transitions) {
      // The intents the adapter computed are byte-identical to a fresh planAnimations over the same
      // (prev, next, beats) — the adapter received exactly the transition and ran the PURE layer.
      expect(t.intents).toEqual(planAnimations(t.prev, t.next, t.beats));
    }
  });

  it('the fixture walk produces the expected intent population end-to-end (5 forge-strikes, 1 cast, 1 stagger, 1 boss death)', () => {
    const tl = timeline();
    const reducer = createPlaybackReducer(tl);
    const adapter = new FakeRenderAdapter();

    let state = initialPlaybackState(tl);
    for (let i = 0; i < tl.beats.length; i++) {
      const prev = state.battleState;
      const prevCursor = state.cursor;
      state = reducer(state, { type: 'tick' });
      adapter.renderTransition(prev, state.battleState, tl.beats.slice(prevCursor, state.cursor));
    }

    const all = adapter.transitions.flatMap((t) => t.intents);
    const count = (target: AnimationIntent['target'], anim: AnimationIntent['anim']) =>
      all.filter((i) => i.target === target && i.anim === anim).length;

    expect(count('forgemaiden', 'forge-strike')).toBe(5);
    expect(count('forgemaiden', 'hammer-flurry')).toBe(0); // no multi-source melee in the committed fixture
    expect(count('forgemaiden', 'cast')).toBe(1);
    expect(count('forgemaiden', 'stagger')).toBe(1);
    expect(count('boss', 'death')).toBe(1);
  });

  it('the adapter cannot feed upstream — driving renderTransition does NOT mutate the reducer state, the snapshots, or the timeline', () => {
    const tl = timeline();
    const tlBefore = JSON.stringify(tl);
    const adapter = new FakeRenderAdapter();

    const state = initialPlaybackState(tl);
    const reducer = createPlaybackReducer(tl);
    const next = reducer(state, { type: 'tick' });

    const prevSnapBefore = JSON.stringify(state.battleState);
    const nextSnapBefore = JSON.stringify(next.battleState);
    const beats = tl.beats.slice(state.cursor, next.cursor);
    const beatsBefore = JSON.stringify(beats);

    adapter.renderTransition(state.battleState, next.battleState, beats);

    // renderTransition returns nothing and the adapter holds no upstream reference, so nothing it
    // could do can reach the snapshots / the beats / the timeline. Pin that immutability.
    expect(JSON.stringify(state.battleState)).toBe(prevSnapBefore);
    expect(JSON.stringify(next.battleState)).toBe(nextSnapBefore);
    expect(JSON.stringify(beats)).toBe(beatsBefore);
    expect(JSON.stringify(tl)).toBe(tlBefore);
  });
});
