// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BattleState, Beat } from '../schema/battle-timeline';
import type { AnnotatedView } from '../interpret/overlay';
import type { RenderPort } from './render-port';
import { ReplayBundleSchema, type ReplayBundle } from '../schema/replay-bundle';

// RED-PHASE acceptance test for Story 5.2 — Task 4 (AC2: offline-at-replay): the browser boot LOADS
// the committed bundle and the Replay runs FROM the bundle, replacing the `?raw` fixture derivation.
//
// It imports the NOT-YET-AUTHORED `loadBundle` + `bootFromBundle` from ./arena-boot (today only
// `startArena` is exported), so it ERRORS now (RED — those named exports do not exist); it turns GREEN
// when the dev (Task 4):
//   - adds `loadBundle(url='/bundles/story-10-1.json'): Promise<ReplayBundle>` that fetches the bundle,
//       awaits res.json(), and ReplayBundleSchema.parse(...) — Zod-validate at the boundary (fail LOUD
//       on a malformed/missing bundle; build-time-strict / replay-forgiving line);
//   - introduces `bootFromBundle(bundle, parent, deps): ArenaHandle` — the bundle-driven core that takes
//       timeline = bundle.battleTimeline (NO in-browser recompute), events = bundle.normalizedEvents,
//       annotations = bundle.annotations (replacing fixtureAnnotations()), saga = readSaga(bundle)
//       (replacing the ?raw deriveTimeline chain). The boot stays SYNCHRONOUS given a bundle.
//
// AC2 (verbatim, epics.md#Story-5.2): "Given the produced bundle When the browser loads it Then the
// Replay runs fully client-side with no external service (offline-at-replay)..."
//
// Mirrors the capturing-fake-adapter boot integration precedent in arena-boot-saga.test.ts: a headless
// boot smoke that builds an ArenaHandle from an IN-MEMORY ReplayBundle via bootFromBundle + a fake
// adapter, advances, and proves it renders from the BUNDLE (not from ?raw). No Phaser, no fetch in the
// boot itself (the async fetch lives in main.ts + loadBundle); deterministic.
import { startArena, loadBundle, bootFromBundle } from './arena-boot';
import type { PlaybackAction, PlaybackState } from '../model/playback';

// ── A small but mechanically-real in-memory ReplayBundle ─────────────────────────────────────────────
// Built via the REAL ReplayBundleSchema.parse so the test exercises the genuine schema seam (the
// arena-boot-saga.test.ts makeBundle precedent). A 2-beat baked timeline whose beats reference shipped
// eventIds so the boot can fold + advance over the BUNDLE'S timeline (no recompute). victory latches at
// the final beat so the boot's victory/saga wiring can light up from the bundle's baked saga.
const EVENT_A = {
  orderKey: { logicalClock: 0, streamId: 'main', seqWithinStream: 0 },
  eventId: 'evt-a',
  eventType: 'tool_use',
  toolName: 'Edit',
  subtype: null,
  timestamp: '2026-06-14T15:00:00.000Z',
  streamDepth: 0,
  exitCode: 0,
  isError: false,
  retryCount: 0,
  payload: { filePath: 'src/main.ts' },
};
const EVENT_B = {
  ...EVENT_A,
  orderKey: { logicalClock: 1, streamId: 'main', seqWithinStream: 1 },
  eventId: 'evt-b',
};

const BAKED_SAGA = 'By hammer and hash, it is done!';

function makeBundle(overrides: Partial<ReplayBundle> = {}): ReplayBundle {
  return ReplayBundleSchema.parse({
    schemaVersion: 1,
    normalizedEvents: [EVENT_A, EVENT_B],
    annotations: [
      {
        eventRef: 'evt-a',
        beatType: 'dispel',
        confidence: 0.8,
        interpreterVersion: 'fixture-v1',
        sourceHash: 'fixture',
        groundingPointer: { eventRefs: ['evt-a'] },
      },
    ],
    // A 2-beat baked timeline. The FIRST beat is a small spell (victory stays false), the SECOND is a
    // decisive integrity strike with weight >= initial.problemIntegrity (100, model-tuning.json) so the
    // boss falls AT the final beat — driving the BattleState.victory false->true edge the boot's saga
    // wiring fires on. This keeps the victory-milestone assertion REACHABLE under foldBattleState (the
    // model defeats the boss when problemIntegrity*integrityDamagePerWeight reaches 0). [battle-model.ts L82-90]
    battleTimeline: {
      schemaVersion: 1,
      beats: [
        {
          orderKey: { logicalClock: 0, streamId: 'main', seqWithinStream: 0 },
          actionType: 'spell',
          sourceEventIds: ['evt-a'],
          weight: 2,
          dwellMs: 800,
        },
        {
          orderKey: { logicalClock: 1, streamId: 'main', seqWithinStream: 1 },
          actionType: 'melee',
          sourceEventIds: ['evt-b'],
          weight: 100,
          dwellMs: 400,
        },
      ],
      totalDurationMs: 1200,
    },
    tuningConfig: { pacingWeights: { $schemaVersion: 1 } },
    saga: BAKED_SAGA,
    assetManifest: { hero: 'assets/hero.png' },
    annotationHash: 'a'.repeat(64),
    scrub: null,
    ...overrides,
  });
}

// A capturing fake adapter recording snaps / transitions / saga (the arena-boot.test.ts
// RecordingRenderAdapter + arena-boot-saga.test.ts renderSaga capture, merged). One-way (R5) — no
// upstream reference. The bundle-driven boot must drive THIS via render/renderTransition.
class RecordingRenderAdapter implements RenderPort {
  readonly snaps: BattleState[] = [];
  readonly transitions: { prev: BattleState; next: BattleState; beats: Beat[] }[] = [];
  readonly sagaCalls: string[] = [];
  readonly behaviorViews: AnnotatedView[] = [];
  initCalls = 0;
  destroyCalls = 0;

  init(): void {
    this.initCalls += 1;
  }
  render(snapshot: BattleState): void {
    this.snaps.push(snapshot);
  }
  renderTransition(prev: BattleState, next: BattleState, beats: Beat[]): void {
    this.transitions.push({ prev, next, beats });
  }
  renderBeatBehaviors(_prev: BattleState, _next: BattleState, _beats: Beat[], view: AnnotatedView): void {
    void _prev;
    void _next;
    void _beats;
    this.behaviorViews.push(view);
  }
  renderSaga(saga: string): void {
    this.sagaCalls.push(saga);
  }
  destroy(): void {
    this.destroyCalls += 1;
  }
}

// The drivable handle shape the headless test drives (the arena-boot.test.ts BootHandle contract).
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

// Boot the bundle-driven core with the fake adapter injected. Signature per Decision §7:
// bootFromBundle(bundle, parent, deps). Cast through unknown so this RED scaffold transpiles before the
// export exists (the arena-boot-saga.test.ts cast precedent).
function bootBundleWithFake(bundle: ReplayBundle, adapter: RenderPort): BootHandle {
  return bootFromBundle(bundle, 'game-container', {
    createAdapter: () => adapter,
  } as never) as unknown as BootHandle;
}

describe('Story 5.2 / AC2 — loadBundle Zod-validates at the boundary (build-time-strict, fail LOUD)', () => {
  it('resolves a ReplayBundle when fetch returns a schema-valid bundle JSON', async () => {
    const bundle = makeBundle();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => JSON.parse(JSON.stringify(bundle)),
    } as unknown as Response);

    const loaded = await loadBundle('/bundles/story-10-1.json');
    expect(loaded.schemaVersion).toBe(1);
    expect(loaded.normalizedEvents).toHaveLength(2);
    expect(loaded.saga).toBe(BAKED_SAGA);
    expect(fetchSpy).toHaveBeenCalledWith('/bundles/story-10-1.json');
  });

  it('fetches the committed bundle path by DEFAULT when called with no argument (the main.ts production call)', () => {
    // main.ts calls `loadBundle()` with NO argument, relying on the `url = '/bundles/story-10-1.json'`
    // default — the committed artifact's same-origin path. The other cases pass the URL explicitly, so
    // they would NOT catch a regression in the default value (e.g. a typo'd path or a stale bundle name);
    // this pins the default the production entry actually depends on. Assert the fetched URL, not the
    // resolved bundle (the parse path is covered above). [src/main.ts L22 `loadBundle()`; arena-boot.ts L59]
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => JSON.parse(JSON.stringify(makeBundle())),
    } as unknown as Response);

    void loadBundle();
    expect(fetchSpy).toHaveBeenCalledWith('/bundles/story-10-1.json');
  });

  it('REJECTS (throws) a malformed bundle — a missing/old bundle is a hard boot error, not a fallback', async () => {
    // The build-time-strict line: loadBundle fails LOUD on a malformed bundle (NOT a silent fallback to
    // the removed ?raw path). A bundle missing the baked battleTimeline must reject via ReplayBundleSchema.
    const malformed = { schemaVersion: 1, normalizedEvents: [], annotations: [] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => malformed,
    } as unknown as Response);

    await expect(loadBundle('/bundles/story-10-1.json')).rejects.toThrow();
  });

  it('REJECTS with a clear HTTP error when the fetch is not ok (res.ok === false), before res.json()', async () => {
    // review F2: a missing bundle on a static SPA-fallback host returns 200 + index.html, so relying on
    // res.json() to throw yields a confusing 'Unexpected token <'. The res.ok guard surfaces the real
    // HTTP status instead. json() must NOT be reached on the not-ok path (the guard short-circuits it).
    const jsonSpy = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: jsonSpy,
    } as unknown as Response);

    await expect(loadBundle('/bundles/story-10-1.json')).rejects.toThrow(/HTTP 404/);
    expect(jsonSpy).not.toHaveBeenCalled();
  });
});

describe('Story 5.2 / AC2 — the Replay runs FROM the bundle (bootFromBundle headless smoke)', () => {
  it('renders the t=0 frame from the bundle and folds the BUNDLE\'S baked timeline (no recompute)', () => {
    const bundle = makeBundle();
    const adapter = new RecordingRenderAdapter();
    booted = bootBundleWithFake(bundle, adapter);

    // init + a t=0 snap happened, and the boot starts PAUSED at cursor 0 (the startArena posture).
    expect(adapter.initCalls).toBe(1);
    expect(adapter.snaps.length).toBeGreaterThanOrEqual(1);
    expect(booted.getState().cursor).toBe(0);
    expect(booted.getState().status).toBe('paused');
  });

  it('advances over the bundle\'s baked beats: a forward tick animates a transition from the bundle timeline', () => {
    const bundle = makeBundle();
    const adapter = new RecordingRenderAdapter();
    booted = bootBundleWithFake(bundle, adapter);

    booted.dispatch({ type: 'play' });
    booted.advanceIfPlaying();

    // The cursor advanced and the forward step took the ANIMATED path with a beat sliced from the
    // BUNDLE'S baked timeline — proving the Replay runs from the bundle, not a ?raw re-derivation.
    expect(booted.getState().cursor).toBe(1);
    expect(adapter.transitions).toHaveLength(1);
    expect(adapter.transitions[0]!.beats).toHaveLength(1);
    expect(adapter.transitions[0]!.beats[0]!.sourceEventIds).toEqual(['evt-a']);
  });

  it('builds the overlay from bundle.annotations (the FROZEN set), not fixtureAnnotations()', () => {
    const bundle = makeBundle();
    const adapter = new RecordingRenderAdapter();
    booted = bootBundleWithFake(bundle, adapter);

    booted.dispatch({ type: 'play' });
    booted.advanceIfPlaying();

    // The read-only overlay the boot threads into the behavior path must carry the bundle's annotations.
    expect(adapter.behaviorViews.length).toBeGreaterThan(0);
    const view = adapter.behaviorViews[0]!;
    expect(view.annotations.some((a) => a.beatType === 'dispel' && a.eventRef === 'evt-a')).toBe(true);
  });

  it('surfaces the bundle\'s baked Saga at the victory milestone (offline-at-replay, from the bundle)', () => {
    const bundle = makeBundle();
    const adapter = new RecordingRenderAdapter();
    booted = bootBundleWithFake(bundle, adapter);

    // Drive the whole bundle timeline to its end (victory latches at the final beat).
    booted.dispatch({ type: 'play' });
    for (let i = 0; i <= bundle.battleTimeline.beats.length + 1; i++) booted.advanceIfPlaying();

    expect(booted.getState().battleState.victory).toBe(true);
    // The Saga shown is the BUNDLE'S baked string (read via readSaga(bundle)) — no LLM, no fetch.
    expect(adapter.sagaCalls).toContain(BAKED_SAGA);
  });

  it('stays DORMANT at victory when the loaded bundle carries a null (unauthored) Saga (fail-closed-to-default)', () => {
    // The AC2 negative branch ON THE bootFromBundle PRODUCTION PATH: before the operator's real bake the
    // committed bundle may carry `saga: null` (Story 1.2 explicit-null when unauthored). readSaga(bundle)
    // returns null and the boot guards on `saga !== null`, so the victory milestone has nothing to show —
    // the panel stays dormant; it is NOT an error and NOT a renderSaga?(null) call. The positive test
    // above (and the existing arena-boot-saga.test.ts dormant cases) only reach this via startArena's
    // deps.bundle seam; this pins it through bootFromBundle's OWN readSaga(bundle) resolution (arena-boot.ts
    // L135) — dropping the `saga !== null` guard there would forward null to the adapter with no test to
    // catch it. Drives ALL THE WAY TO VICTORY with a null Saga and proves zero fires.
    const bundle = makeBundle({ saga: null });
    const adapter = new RecordingRenderAdapter();
    booted = bootBundleWithFake(bundle, adapter);

    booted.dispatch({ type: 'play' });
    for (let i = 0; i <= bundle.battleTimeline.beats.length + 1; i++) booted.advanceIfPlaying();

    expect(booted.getState().battleState.victory).toBe(true); // victory DID latch...
    expect(adapter.sagaCalls).toHaveLength(0); // ...yet renderSaga? never fired (dormant, not null)
  });
});

describe('Story 5.2 / AC2 — the production boot no longer derives from ?raw (the source is the bundle)', () => {
  it('arena-boot.ts removes the ?raw fixture imports + deriveTimeline (the bundle is the single source)', async () => {
    // AC2 mandates "replacing the ?raw fixture derivation". After Task 4 the production boot folds the
    // bundle's baked timeline — it no longer imports the raw fixtures or runs deriveTimeline(). A
    // source-grep guard (tests are not Layer-0 — the fs read is fine; mirrors arena-boot-saga.test.ts).
    // RED now: arena-boot.ts STILL imports `?raw` + defines deriveTimeline, so these fail.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'arena-boot.ts'),
      'utf8',
    );
    expect(source).not.toContain('?raw');
    expect(source).not.toContain('deriveTimeline');
    // And it gains the bundle-driven core export.
    expect(source).toMatch(/export\s+function\s+bootFromBundle/);
  });

  it('startArena remains exported as the drivable handle (the refactor preserves the contract)', () => {
    // The heavily-tested drivable contract (arena-boot.test.ts) must survive the refactor.
    expect(typeof startArena).toBe('function');
  });
});
