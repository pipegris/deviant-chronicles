// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleState, BattleTimeline, Beat } from '../schema/battle-timeline';
import type { AnnotatedView } from '../interpret/overlay';
import type { CaptionOp } from '../scribe/captions';
import type { RenderPort } from './render-port';
import { ReplayBundleSchema, type ReplayBundle } from '../schema/replay-bundle';

// RED-PHASE acceptance test for Story 4.2 — AC2 (the gate-half of the victory-milestone display): the
// boot fires the one-way `renderSaga?` command EXACTLY ONCE at the `BattleState.victory` false->true
// edge on the forward tick, and NEVER on seek/restart (you cannot narrate a milestone across a jump).
// It imports `startArena` (which does not yet wire renderSaga) and a fake adapter implementing the
// not-yet-declared `RenderPort.renderSaga?` — so it ERRORS/FAILS now (RED: the wiring + the port
// method + the BootDeps saga seam do not exist); it turns GREEN when the dev (1) adds the optional
// `renderSaga?(saga: string): void` command to RenderPort, (2) fires it once at the victory edge in
// arena-boot.ts, and (3) threads the Saga string it has into that call. Mirrors the
// capturing-fake-adapter boot integration precedent in arena-boot-caption.test.ts (Story 4.1 F5).
//
// AC2 (verbatim, epics.md#Story-4.2): "Given the Replay at the victory milestone When it reaches the
// closing Then it displays the stored Saga with no runtime LLM call (offline-at-replay)."
//
// LOAD-BEARING DESIGN NOTE — the data-source seam (story Task 4 + Task 5 "match whatever Task 4
// resolves, and pin it"). On the dev/CI FIXTURE path there is NO ReplayBundle (bundle loading is
// Story 5.2), so the production Saga is `null` there. This test therefore pins AC2 in two layers:
//   (A) POSTURE-AGNOSTIC invariants that hold under EVERY valid Task 4 resolution (null OR a canned
//       dev Saga): renderSaga? NEVER fires on a seek, NEVER on a restart, NEVER while paused/pre-
//       victory, and fires AT MOST ONCE across a full play-through — and if it fires, ONLY at the
//       victory edge. These are pure AC2 acceptance content ("no narration across a jump"; "displayed
//       AT the victory milestone") and do not constrain the dev's null-vs-canned choice.
//   (B) The POSITIVE victory-edge firing, driven through an injected Saga string so it is pinned
//       deterministically without depending on the bundle-less fixture: when the boot is given a
//       non-null Saga via its BootDeps seam, renderSaga? fires EXACTLY ONCE, on the transition where
//       victory flips false->true, with THAT string. The injection rides `BootDeps` (the established
//       createAdapter/onSignal injection object) — the minimal idiomatic seam. If the dev instead
//       threads the Saga via a different mechanism (e.g. a handle.previewSaga() method, like the dev
//       cinematics), only this one positive test's injection line changes; the (A) invariants stand.
//   No LLM/SDK is on this path structurally: the boot imports scribe/saga.ts (the SDK-free reader),
//   never scribe/saga-author.ts. The fixture reaching victory at its completion beat is already a
//   committed fact (render-model.test.ts L108-122; animation-plan.test.ts L487-489).
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

const INJECTED_SAGA =
  'And the kingdom held its breath; and when the Curse was bound at last the Forgemaiden cried: ' +
  '"By hammer and hash, it is done!"';

// A MINIMAL valid ReplayBundle carrying a baked Saga, built via the REAL ReplayBundleSchema.parse so
// the test exercises the genuine schema seam (same minimal-skeleton choice as saga.test.ts). This
// drives the Story-5.2 production path the boot resolves via readSaga(deps.bundle) — distinct from the
// resolved-string deps.saga override the other positive tests inject (which BYPASSES readSaga). Pinning
// the bundle path proves the boot actually threads readSaga(bundle) -> renderSaga at the victory edge.
function makeBundle(saga: string | null): ReplayBundle {
  return ReplayBundleSchema.parse({
    schemaVersion: 1,
    // dev-story re-point (Story 5.5): the bundle ships `projectedEvents` (payload-free); empty is legal.
    projectedEvents: [],
    annotations: [],
    battleTimeline: { schemaVersion: 1, beats: [], totalDurationMs: 0 },
    tuningConfig: {},
    saga,
    assetManifest: {},
    annotationHash: 'mock-hash',
  });
}

// A capturing fake adapter that records every renderSaga(saga) call (the Saga string + the victory
// flag of the snapshot at the moment of the call, so the test can prove it fired on the victory edge).
// It implements the rest of RenderPort as no-ops (one-way, R5 — it holds no upstream reference). It
// additionally captures a victory-edge witness by recording the LAST snapshot it saw via render/
// renderTransition, so a renderSaga call can be correlated to whether victory had just flipped true.
// `renderSaga` is the OPTIONAL additive command this story introduces; implementing it concretely on
// the fake is exactly what the boot's `adapter.renderSaga?.(...)` guard will forward to.
interface SagaCall {
  saga: string;
  victoryAtCall: boolean;
}

class RecordingSagaAdapter implements RenderPort {
  readonly sagaCalls: SagaCall[] = [];
  lastVictory = false;
  initCalls = 0;
  destroyCalls = 0;

  init(): void {
    this.initCalls += 1;
  }
  render(snapshot: BattleState): void {
    this.lastVictory = snapshot.victory;
  }
  renderTransition(_prev: BattleState, next: BattleState, _beats: Beat[]): void {
    void _prev;
    void _beats;
    this.lastVictory = next.victory;
  }
  renderBeatBehaviors(_prev: BattleState, next: BattleState, _beats: Beat[], _view: AnnotatedView): void {
    void _prev;
    void _beats;
    void _view;
    this.lastVictory = next.victory;
  }
  renderCaptions(_ops: CaptionOp[]): void {
    void _ops;
  }
  // The Story 4.2 command under test. Records the Saga and whether victory is latched at call time.
  renderSaga(saga: string): void {
    this.sagaCalls.push({ saga, victoryAtCall: this.lastVictory });
  }
  destroy(): void {
    this.destroyCalls += 1;
  }
}

type BootHandle = {
  adapter: RenderPort;
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

// Boot with the capturing fake. `saga` is threaded via the BootDeps injection object (the established
// createAdapter/onSignal seam). It is cast through `Record<string, unknown>` so this RED test
// transpiles before BootDeps declares the field — at runtime the boot ignores an unknown dep until the
// dev wires it (then this drives the positive victory-edge assertion). [design note (B) above]
// `bundle` rides the SAME injection object and drives the Story-5.2 production path: the boot resolves
// its Saga via readSaga(deps.bundle) (the resolved-string `saga` takes precedence when both are set).
function bootWithFake(
  adapter: RenderPort,
  saga?: string | null,
  bundle?: ReplayBundle,
): BootHandle {
  const deps: Record<string, unknown> = { createAdapter: () => adapter };
  if (saga !== undefined) deps.saga = saga;
  if (bundle !== undefined) deps.bundle = bundle;
  return startArena('game-container', deps as never) as unknown as BootHandle;
}

// Drive the boot through the WHOLE committed fixture to the victory completion beat.
function playToEnd(handle: BootHandle): void {
  handle.dispatch({ type: 'play' });
  const tl = timeline();
  for (let i = 0; i <= tl.beats.length; i++) handle.advanceIfPlaying();
}

describe('Story 4.2 / AC2 — the boot fires renderSaga? exactly once at the victory edge (injected Saga)', () => {
  it('calls renderSaga exactly ONCE across a full play-through to victory', () => {
    const adapter = new RecordingSagaAdapter();
    booted = bootWithFake(adapter, INJECTED_SAGA);
    playToEnd(booted);
    expect(adapter.sagaCalls).toHaveLength(1);
  });

  it('passes the injected Saga STRING (the reader output the boot threads), not the bundle', () => {
    const adapter = new RecordingSagaAdapter();
    booted = bootWithFake(adapter, INJECTED_SAGA);
    playToEnd(booted);
    expect(adapter.sagaCalls[0]?.saga).toBe(INJECTED_SAGA);
  });

  it('fires on the transition where victory has latched true (the victory milestone, not a pre-victory tick)', () => {
    const adapter = new RecordingSagaAdapter();
    booted = bootWithFake(adapter, INJECTED_SAGA);
    playToEnd(booted);
    // The single call must occur once victory is latched — proving it lands AT the milestone edge.
    expect(adapter.sagaCalls).toHaveLength(1);
    expect(adapter.sagaCalls[0]?.victoryAtCall).toBe(true);
    // And the boot's terminal state is indeed victory (the fixture reaches it at the completion beat).
    expect(booted.getState().battleState.victory).toBe(true);
  });

  it('does NOT re-fire on a later tick after victory (the boot-owned sagaShown guard is sticky)', () => {
    const adapter = new RecordingSagaAdapter();
    booted = bootWithFake(adapter, INJECTED_SAGA);
    playToEnd(booted);
    const afterVictory = adapter.sagaCalls.length;
    // A few more clamped no-op ticks at the end must not re-narrate the milestone.
    booted.advanceIfPlaying();
    booted.advanceIfPlaying();
    expect(adapter.sagaCalls.length).toBe(afterVictory);
    expect(adapter.sagaCalls).toHaveLength(1);
  });

  it('does NOT fire at the victory edge when the resolved Saga is null (fail-closed-to-default — panel stays dormant)', () => {
    // The bundle-less dev/CI fixture path resolves the Saga to `null`; the boot guards on `saga !== null`
    // so the victory milestone has nothing to show — the panel stays dormant, NOT an error / NOT a
    // renderSaga?(null) call. This pins the negative AC2 branch the other positive tests (which inject a
    // non-null Saga) cannot reach: it plays ALL THE WAY TO VICTORY with NO Saga and proves zero fires
    // even though `battleState.victory` latches true. Without this, dropping the `saga !== null` guard in
    // arena-boot.ts would forward `null` to the adapter and no test would catch it. [arena-boot.ts L301]
    const adapter = new RecordingSagaAdapter();
    booted = bootWithFake(adapter); // no saga, no bundle -> resolved Saga is null
    playToEnd(booted);
    expect(booted.getState().battleState.victory).toBe(true); // victory IS reached
    expect(adapter.sagaCalls).toHaveLength(0); // ...yet renderSaga? never fired (dormant, not null)
  });
});

describe('Story 4.2 / AC2 — the boot threads readSaga(bundle) -> renderSaga at the victory edge (the Story-5.2 production seam)', () => {
  // The other positive tests inject the resolved string via `deps.saga`, which the boot prefers and which
  // BYPASSES the reader. This block drives the ACTUAL production path: a loaded `deps.bundle` whose baked
  // `saga` the boot must surface via readSaga(bundle) and fire at victory. This is the load-bearing
  // wiring that lights up the real victory panel when Story 5.2 loads the bundle — proving the reader is
  // genuinely threaded (not merely imported to satisfy the source-grep), and that a regression in the
  // boot's `deps.bundle ? readSaga(deps.bundle) : null` resolution would be caught. [arena-boot.ts L148]
  const BAKED_SAGA =
    'In the elder days the build was slow, yet the Forgemaiden bound the curse and the realm was made whole; ' +
    'and she cried: "By hammer and hash, it is done!"';

  it('reads the baked Saga FROM the bundle (via readSaga) and fires it exactly once at the victory edge', () => {
    const adapter = new RecordingSagaAdapter();
    booted = bootWithFake(adapter, undefined, makeBundle(BAKED_SAGA));
    playToEnd(booted);
    expect(adapter.sagaCalls).toHaveLength(1);
    expect(adapter.sagaCalls[0]?.saga).toBe(BAKED_SAGA); // the bundle's baked string, surfaced by readSaga
    expect(adapter.sagaCalls[0]?.victoryAtCall).toBe(true);
  });

  it('does NOT fire when the loaded bundle carries a null (unauthored) Saga (fail-closed-to-default)', () => {
    // The Story-5.2 path with a not-yet-authored bundle: readSaga(bundle) returns null -> the same
    // dormant posture as the bundle-less fixture path. Plays to victory and proves zero fires.
    const adapter = new RecordingSagaAdapter();
    booted = bootWithFake(adapter, undefined, makeBundle(null));
    playToEnd(booted);
    expect(booted.getState().battleState.victory).toBe(true);
    expect(adapter.sagaCalls).toHaveLength(0);
  });
});

describe('Story 4.2 / AC2 — renderSaga? never fires on a jump (no narration across seek/restart)', () => {
  it('a dispatched seek (even to the end) drives NO renderSaga call (SNAP path, not the milestone)', () => {
    const adapter = new RecordingSagaAdapter();
    booted = bootWithFake(adapter, INJECTED_SAGA);
    const tl = timeline();
    booted.dispatch({ type: 'seek', cursor: tl.beats.length });
    // Seeking to the victory frame SNAPS the static state; it must NOT fire the milestone narration —
    // you cannot narrate a milestone you jumped across (the caption-path posture, arena-boot.ts).
    expect(adapter.sagaCalls).toHaveLength(0);
  });

  it('a restart after a full play-through drives NO renderSaga on the restart itself', () => {
    const adapter = new RecordingSagaAdapter();
    booted = bootWithFake(adapter, INJECTED_SAGA);
    playToEnd(booted);
    const afterPlay = adapter.sagaCalls.length;
    booted.dispatch({ type: 'restart' });
    expect(adapter.sagaCalls.length).toBe(afterPlay); // restart SNAPped to t=0; no new milestone call
  });

  it('a step while PAUSED at t=0 drives NO renderSaga (pre-victory, nothing advanced)', () => {
    const adapter = new RecordingSagaAdapter();
    booted = bootWithFake(adapter, INJECTED_SAGA);
    expect(booted.getState().status).toBe('paused');
    booted.advanceIfPlaying();
    expect(adapter.sagaCalls).toHaveLength(0);
  });
});

describe('Story 4.2 / AC2 — no LLM/SDK on the browser path (offline-at-replay, structural)', () => {
  // The boot's Saga source is the SDK-FREE reader scribe/saga.ts — NEVER scribe/saga-author.ts (the
  // SDK-touching authoring module). This source-grep over arena-boot.ts is the structural regression
  // guard that the victory-display wiring stays offline-at-replay. (The primary R4 proof is the
  // dist-grep in Task 6; this pins the boot specifically.) RED now: arena-boot.ts imports neither yet
  // — it currently references no saga module, so the positive "imports saga.ts" assertion fails until
  // the dev wires the reader in. Tests are not Layer-0 modules, so the fs read is fine.
  const bootSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'arena-boot.ts'),
    'utf8',
  );

  it('arena-boot.ts does NOT import the SDK-touching saga-author module', () => {
    expect(bootSource).not.toMatch(/from\s+['"]\.\.\/scribe\/saga-author['"]/);
    expect(bootSource).not.toContain('@anthropic-ai/sdk');
  });

  it('arena-boot.ts reads the Saga via the SDK-free reader scribe/saga.ts (readSaga)', () => {
    // The boot must source the Saga from the pure reader (so the browser path is offline-at-replay).
    expect(bootSource).toMatch(/from\s+['"]\.\.\/scribe\/saga['"]/);
  });
});
