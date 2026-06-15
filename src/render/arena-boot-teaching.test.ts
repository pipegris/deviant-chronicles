// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleState, BattleTimeline, Beat } from '../schema/battle-timeline';
import type { AnnotatedView } from '../interpret/overlay';
import type { RenderPort } from './render-port';
import type { TeachingOp } from '../portal/teaching';

// RED-PHASE acceptance tests for Story 4.3 (Task 4) — the BOOT TEACHING-WIRING integration guard. The
// pure planner (planTeaching) is unit/ATDD-tested in portal/, but the LOAD-BEARING boot orchestration —
// auto-surfacing the teaching op on the FORWARD tick with no viewer action — is pinned here. These FAIL
// until (a) src/portal/teaching.ts exists, (b) RenderPort gains the optional renderTeaching?(ops) command,
// and (c) arena-boot.ts is extended to call planTeaching + adapter.renderTeaching?.(...) in the SAME
// forward-tick block that already runs planCaptions / planBeatBehaviors. The `implements RenderPort` on
// the fake only typechecks once renderTeaching? is declared (Option-A additive) — that missing member is
// part of the intended RED, alongside the missing TeachingOp import.
//
// The two postures this guard pins (AC1 "auto-surface with no viewer action" + the no-jump rule):
//   1. forward-tick auto-surface: a forward tick crossing the dispel/shaman signature beat drives
//      adapter.renderTeaching with the RIGHT op(s) — there is NO open()/toggle/click on this path.
//   2. seek/restart SNAP-no-teaching: a cursor JUMP draws via the SNAP path and surfaces NO teaching op
//      (you cannot auto-surface a lesson across a jump — the caption/behavior posture).
// It does NOT edit the green Story 4.1 arena-boot-caption.test.ts; it adds the focused teaching-wiring
// assertions, reusing the SAME jsdom boot harness + afterEach destroy contract (the live rAF loop must
// still be cancelled on destroy — Story 2.5's F1 fix must not regress).
//
// Pipeline reuse: the same committed-fixture chain as arena-boot-caption.test.ts (copied verbatim).
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

// A recording fake that FLATTENS every renderTeaching(ops) call into one ordered op stream, so the test
// can assert which teaching ops auto-surfaced across the playback. Implements the rest of RenderPort as
// no-ops (one-way, R5 — it holds no upstream reference). renderTeaching is OPTIONAL on RenderPort;
// implementing it concretely is exactly what the boot's `adapter.renderTeaching?.(...)` guard forwards to.
class RecordingTeachingAdapter implements RenderPort {
  readonly teachingOps: TeachingOp[] = [];
  initCalls = 0;
  destroyCalls = 0;

  init(): void {
    this.initCalls += 1;
  }
  render(_snapshot: BattleState): void {
    void _snapshot;
  }
  renderTransition(_prev: BattleState, _next: BattleState, _beats: Beat[]): void {
    void _prev;
    void _next;
    void _beats;
  }
  renderBeatBehaviors(_prev: BattleState, _next: BattleState, _beats: Beat[], _view: AnnotatedView): void {
    void _prev;
    void _next;
    void _beats;
    void _view;
  }
  renderTeaching(ops: TeachingOp[]): void {
    this.teachingOps.push(...ops);
  }
  destroy(): void {
    this.destroyCalls += 1;
  }
}

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

function bootWithFake(adapter: RenderPort): BootHandle {
  return startArena('game-container', { createAdapter: () => adapter }) as unknown as BootHandle;
}

describe('Story 4.3 AC1 — the boot AUTO-SURFACES teaching on the forward tick (no viewer action)', () => {
  it('the first forward tick (crossing the Dispel Beat[0]) drives renderTeaching with exactly one dispel op', async () => {
    // The Dispel is Beat[0] on the committed fixture: a single forward tick (cursor 0 -> 1) auto-surfaces
    // the dispel teaching op — no open()/toggle/click, just the tick. This is AC1's "when it fires ...
    // with no viewer action".
    const adapter = new RecordingTeachingAdapter();
    booted = bootWithFake(adapter);

    booted.dispatch({ type: 'play' });
    booted.advanceIfPlaying(); // the first forward transition crosses Beat[0] (the Dispel)

    const dispelOps = adapter.teachingOps.filter((o) => o.beatType === 'dispel');
    expect(dispelOps).toHaveLength(1);
    const { TEACHING } = await import('../portal/teaching-config');
    expect(dispelOps[0]!.text).toBe(TEACHING.dispel);
  });

  it('playing to the end auto-surfaces BOTH the dispel and the shaman teaching op (the two beats live on the committed fixture)', async () => {
    // The committed fixture tags dispel @ u-0002#1 and shaman @ u-0010#0 (NO summon), so during normal
    // playback the operator sees two of three beats teach. The shaman line auto-surfaces on the
    // breakthrough-discharge transition (the death). Drive to the end and assert both landed exactly once.
    const adapter = new RecordingTeachingAdapter();
    booted = bootWithFake(adapter);

    booted.dispatch({ type: 'play' });
    const tl = timeline();
    for (let i = 0; i <= tl.beats.length; i++) booted.advanceIfPlaying();

    const { TEACHING } = await import('../portal/teaching-config');
    const dispelOps = adapter.teachingOps.filter((o) => o.beatType === 'dispel');
    const shamanOps = adapter.teachingOps.filter((o) => o.beatType === 'shaman');
    expect(dispelOps).toHaveLength(1);
    expect(shamanOps).toHaveLength(1);
    expect(dispelOps[0]!.text).toBe(TEACHING.dispel);
    expect(shamanOps[0]!.text).toBe(TEACHING.shaman);
    // summon is dormant-in-fixture (the documented 3.4 honest gap) — it does NOT auto-surface live.
    expect(adapter.teachingOps.filter((o) => o.beatType === 'summon')).toHaveLength(0);
    // Every auto-surfaced op carries a finite positive dwell (the scene's auto-dismiss duration).
    for (const op of adapter.teachingOps) {
      expect(Number.isFinite(op.dwellMs)).toBe(true);
      expect(op.dwellMs).toBeGreaterThan(0);
    }
  });
});

describe('Story 4.3 AC1 — seek/restart SNAP and surface NO teaching op (no auto-surface across a jump)', () => {
  it('a dispatched seek drives NO teaching op', () => {
    const adapter = new RecordingTeachingAdapter();
    booted = bootWithFake(adapter);

    booted.dispatch({ type: 'seek', cursor: 5 });
    expect(adapter.teachingOps).toHaveLength(0);
  });

  it('a restart after playback drives NO teaching op on the restart itself', () => {
    const adapter = new RecordingTeachingAdapter();
    booted = bootWithFake(adapter);

    // Play forward past the Dispel (which DOES auto-surface), then restart and confirm the restart adds
    // no teaching op (the SNAP path does not narrate).
    booted.dispatch({ type: 'play' });
    booted.advanceIfPlaying();
    const afterPlay = adapter.teachingOps.length;
    expect(afterPlay).toBeGreaterThan(0);

    booted.dispatch({ type: 'restart' });
    expect(adapter.teachingOps.length).toBe(afterPlay); // restart SNAPped; no new teaching op
  });

  it('a step while PAUSED drives NO teaching op (the held frame surfaces nothing)', () => {
    const adapter = new RecordingTeachingAdapter();
    booted = bootWithFake(adapter);

    // Boots paused at t=0 (Story 2.5). A loop step while paused advances nothing and surfaces no teaching.
    expect(booted.getState().status).toBe('paused');
    booted.advanceIfPlaying();
    expect(adapter.teachingOps).toHaveLength(0);
  });
});
