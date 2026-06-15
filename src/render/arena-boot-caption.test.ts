// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleState, BattleTimeline, Beat } from '../schema/battle-timeline';
import type { AnnotatedView } from '../interpret/overlay';
import type { RenderPort } from './render-port';
import type { CaptionOp } from '../scribe/captions';

// Story 4.1 (review F5) — the BOOT CAPTION-WIRING integration guard. The pure planners (planCaptions /
// planCaptionCorrection) are unit/ATDD-tested in scribe/, but the LOAD-BEARING boot orchestration was
// only ever exercised by a throwaway jsdom test the Dev Agent Record says was deleted. This NEW file
// pins that orchestration so a future reorder cannot silently break AC2 with all other gates green:
//   1. emit-BEFORE-signal ordering: planCaptions appends the Dispel beat's OWN emit to the boot-owned
//      captionHistory BEFORE the same transition's scribe-correction signal is routed, so
//      planCaptionCorrection can resolve its target (the prior emit). The captured op stream must show
//      every emit precede the single `correct` op, and that `correct` op must target a real prior emit.
//   2. seek/restart SNAP-no-caption: a cursor JUMP draws via the SNAP path and emits NO caption ops
//      (you cannot narrate across a jump — the same posture the behavior path holds).
// It does NOT edit the green Story 3.3 arena-boot-behavior.test.ts; it adds the focused caption-wiring
// assertions, reusing the SAME jsdom boot harness + afterEach destroy contract (the live rAF loop must
// still be cancelled on destroy — Story 2.5's F1 fix must not regress).
//
// Pipeline reuse: the same committed-fixture chain as arena-boot-behavior.test.ts (copied verbatim).
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

// A recording fake that FLATTENS every renderCaptions(ops) call into one ordered op stream, so the test
// can assert the relative order of emits vs the correction across the WHOLE playback. Implements the
// rest of RenderPort as no-ops (one-way, R5 — it holds no upstream reference). renderCaptions is OPTIONAL
// on RenderPort; implementing it concretely is exactly what the boot's `adapter.renderCaptions?.(...)`
// guard forwards to.
class RecordingCaptionAdapter implements RenderPort {
  readonly captionOps: CaptionOp[] = [];
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
  renderCaptions(ops: CaptionOp[]): void {
    this.captionOps.push(...ops);
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

const isEmit = (op: CaptionOp): op is Extract<CaptionOp, { kind: 'emit' }> => op.kind === 'emit';
const isCorrect = (op: CaptionOp): op is Extract<CaptionOp, { kind: 'correct' }> => op.kind === 'correct';

describe('Story 4.1 (F5) — the boot drives captions on the forward tick: emit-before-signal ordering', () => {
  it('playing to the end emits captions THEN exactly one correct op whose target is a prior emit', () => {
    const adapter = new RecordingCaptionAdapter();
    booted = bootWithFake(adapter);

    booted.dispatch({ type: 'play' });
    const tl = timeline();
    // Advance past every beat (one extra to hit the clamped end no-op).
    for (let i = 0; i <= tl.beats.length; i++) booted.advanceIfPlaying();

    const emits = adapter.captionOps.filter(isEmit);
    const corrections = adapter.captionOps.filter(isCorrect);

    // The fixture captions every non-idle beat and has a SINGLE Dispel -> exactly one correction.
    expect(emits.length).toBeGreaterThan(0);
    expect(corrections).toHaveLength(1);

    // The correction targets a caption that was actually EMITTED earlier (a real prior emit id) — the
    // proof that captionHistory contained the Dispel beat's own emit before the signal resolved.
    const correction = corrections[0]!;
    const emittedIds = new Set(emits.map((e) => e.captionId));
    expect(emittedIds.has(correction.targetCaptionId)).toBe(true);

    // Ordering: the correction op appears AFTER its target emit in the captured stream (emit-then-route).
    const correctionIdx = adapter.captionOps.findIndex(isCorrect);
    const targetEmitIdx = adapter.captionOps.findIndex(
      (op) => isEmit(op) && op.captionId === correction.targetCaptionId,
    );
    expect(targetEmitIdx).toBeGreaterThanOrEqual(0);
    expect(targetEmitIdx).toBeLessThan(correctionIdx);

    // And the struck text is the targeted prior caption's own text (a real cross-out, not a fabrication).
    const targetEmit = emits.find((e) => e.captionId === correction.targetCaptionId)!;
    expect(correction.struckText).toBe(targetEmit.text);
  });

  it('the boot routes the correction on the SAME transition that emits the Dispel beat caption', () => {
    // The Dispel is Beat[0] on the committed fixture: a single forward tick (cursor 0 -> 1) must produce
    // BOTH the Dispel beat's emit AND its correction. Drive exactly one tick and assert both landed.
    const adapter = new RecordingCaptionAdapter();
    booted = bootWithFake(adapter);

    booted.dispatch({ type: 'play' });
    booted.advanceIfPlaying(); // the first forward transition crosses Beat[0] (the Dispel)

    expect(adapter.captionOps.some(isEmit)).toBe(true);
    expect(adapter.captionOps.filter(isCorrect)).toHaveLength(1);
    // The emit precedes the correction within this single transition's ops.
    expect(adapter.captionOps.findIndex(isEmit)).toBeLessThan(adapter.captionOps.findIndex(isCorrect));
  });
});

describe('Story 4.1 (F5) — seek/restart SNAP and emit NO caption ops (no narration across a jump)', () => {
  it('a dispatched seek drives NO caption ops', () => {
    const adapter = new RecordingCaptionAdapter();
    booted = bootWithFake(adapter);

    booted.dispatch({ type: 'seek', cursor: 5 });
    expect(adapter.captionOps).toHaveLength(0);
  });

  it('a restart after playback drives NO caption ops on the restart itself', () => {
    const adapter = new RecordingCaptionAdapter();
    booted = bootWithFake(adapter);

    // Play forward a few ticks (which DO emit), then restart and confirm the restart adds no caption op.
    booted.dispatch({ type: 'play' });
    booted.advanceIfPlaying();
    booted.advanceIfPlaying();
    const afterPlay = adapter.captionOps.length;
    expect(afterPlay).toBeGreaterThan(0);

    booted.dispatch({ type: 'restart' });
    expect(adapter.captionOps.length).toBe(afterPlay); // restart SNAPped; no new caption op
  });

  it('a step while PAUSED drives NO caption ops', () => {
    const adapter = new RecordingCaptionAdapter();
    booted = bootWithFake(adapter);

    // Boots paused at t=0 (Story 2.5). A loop step while paused advances nothing and emits no caption.
    expect(booted.getState().status).toBe('paused');
    booted.advanceIfPlaying();
    expect(adapter.captionOps).toHaveLength(0);
  });
});
