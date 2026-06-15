import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleState, BattleTimeline } from '../schema/battle-timeline';
import type { RenderPort } from './render-port';

// RED-PHASE acceptance tests for Story 2.3 (Task 1 + Task 7) — the ONE-WAY RenderPort contract,
// proven WITHOUT Phaser via a FakeRenderAdapter. These FAIL until src/render/render-port.ts
// exports the `RenderPort` interface (the `import type { RenderPort }` resolves to nothing, and
// the FakeRenderAdapter's `implements RenderPort` fails to typecheck / the module import errors).
//
// Covers AC1 verbatim: "it consumes immutable snapshots through render/render-port.ts and never
// feeds state back upstream (one-way)". The fake adapter records every snapshot handed to it; we
// drive it from a REAL Story 2.2 playback reducer walk (play to end + a seek) and assert:
//   - every recorded snapshot equals foldBattleState(tl, cursor) at that cursor (the adapter
//     receives exactly the immutable snapshots the reducer derives),
//   - render() returns void (a COMMAND, not a query — no value flows back upstream),
//   - the reducer/timeline are NOT mutated by the adapter (it cannot reach upstream; it only
//     RECEIVES snapshots).
// This proves the seam is genuinely one-way and renderer-agnostic with zero Phaser (node env).
//
// Pipeline reuse: same committed-fixture chain as battle-model.test.ts L41-57 (copied verbatim).
import { initialBattleState, foldBattleState } from '../model/battle-model';
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

// A renderer-agnostic FAKE adapter: implements the SAME RenderPort the Phaser adapter will, but
// instead of drawing it RECORDS every snapshot. This is the "a fake/headless adapter implements it
// in tests" the story names — the contract is provable with no Phaser. It can ONLY receive
// snapshots; it holds NO reference to the reducer/timeline, so it structurally cannot feed back.
class FakeRenderAdapter implements RenderPort {
  readonly received: BattleState[] = [];
  initCalls = 0;
  destroyCalls = 0;

  init(): void {
    this.initCalls += 1;
  }

  render(snapshot: BattleState): void {
    this.received.push(snapshot);
  }

  // The RenderPort gained the one-way renderTransition (Story 2.4, Option A). This Story 2.3 fake
  // only exercises the SNAP path; a parameterless () => void is assignable to the interface's
  // (prev, next, beats) => void, so it satisfies `implements RenderPort` without recording anything.
  // (The Story 2.4 animated seam is proven in animation-transition.test.ts.)
  renderTransition(): void {}

  destroy(): void {
    this.destroyCalls += 1;
  }
}

describe('Story 2.3 AC1 — the RenderPort is a renderer-agnostic, one-way command sink', () => {
  it('a fake adapter implementing RenderPort records every snapshot it is handed', () => {
    const adapter = new FakeRenderAdapter();
    adapter.init();
    adapter.render(initialBattleState());
    adapter.destroy();
    expect(adapter.initCalls).toBe(1);
    expect(adapter.received).toHaveLength(1);
    expect(adapter.destroyCalls).toBe(1);
  });

  it('render(snapshot) returns void — it is a COMMAND, not a query (no value flows back)', () => {
    const adapter: RenderPort = new FakeRenderAdapter();
    const result = adapter.render(initialBattleState());
    expect(result).toBeUndefined();
  });

  it('driven by a REAL reducer walk to the end, every received snapshot equals foldBattleState(tl, cursor)', () => {
    const tl = timeline();
    const reducer = createPlaybackReducer(tl);
    const adapter = new FakeRenderAdapter();
    adapter.init();

    // Pump the reducer like the (Story 2.5) loop will: render the t=0 frame, then tick to the end,
    // rendering state.battleState after each tick — exactly the one-way data flow
    // playback-reducer -> RenderPort.
    let state = initialPlaybackState(tl);
    adapter.render(state.battleState);
    for (let i = 0; i < tl.beats.length; i++) {
      state = reducer(state, { type: 'tick' });
      adapter.render(state.battleState);
    }

    // Every recorded snapshot must be byte-identical to the pure fold at its cursor — the adapter
    // received exactly the immutable snapshots, never a mutated or self-derived one.
    expect(adapter.received).toHaveLength(tl.beats.length + 1);
    adapter.received.forEach((snapshot, cursor) => {
      expect(JSON.stringify(snapshot)).toBe(JSON.stringify(foldBattleState(tl, cursor)));
    });
  });

  it('a seek (scrub) handed to the adapter renders exactly the fold at the seeked cursor (SCRUB == PLAY)', () => {
    const tl = timeline();
    const reducer = createPlaybackReducer(tl);
    const adapter = new FakeRenderAdapter();

    // Guard the intent: cursor 4 must be STRICTLY inside the timeline so this proves a MID-timeline
    // scrub (== play). Without this, a future fixture with < 4 beats would silently clamp seek(4) to
    // the end and the test would still pass — but it would no longer test what its name claims.
    expect(tl.beats.length).toBeGreaterThan(4);

    const seeked = reducer(initialPlaybackState(tl), { type: 'seek', cursor: 4 });
    adapter.render(seeked.battleState);

    // The seek landed on cursor 4 exactly (not clamped) — pin it so the equality below is meaningful.
    expect(seeked.cursor).toBe(4);
    expect(adapter.received).toHaveLength(1);
    expect(JSON.stringify(adapter.received[0])).toBe(JSON.stringify(foldBattleState(tl, 4)));
  });

  it('the adapter cannot feed upstream — driving it does NOT mutate the reducer state, the snapshot, or the timeline', () => {
    const tl = timeline();
    const tlBefore = JSON.stringify(tl);
    const adapter = new FakeRenderAdapter();

    const state = initialPlaybackState(tl);
    const stateBefore = JSON.stringify(state);
    const snapshotBefore = JSON.stringify(state.battleState);

    adapter.render(state.battleState);

    // The render call returns nothing and the adapter holds no upstream reference, so nothing it
    // could do can reach the reducer's state / the snapshot / the timeline. Pin that immutability.
    expect(JSON.stringify(state)).toBe(stateBefore);
    expect(JSON.stringify(state.battleState)).toBe(snapshotBefore);
    expect(JSON.stringify(tl)).toBe(tlBefore);
  });
});
