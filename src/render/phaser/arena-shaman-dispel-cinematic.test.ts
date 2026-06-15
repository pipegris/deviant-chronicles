// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
// Phaser 4.0.0's ESM build exposes ONLY named exports (no default) — a namespace import is the
// correct form (verified in arena-scene.test.ts against node_modules/phaser/dist/phaser.esm.js).
import * as Phaser from 'phaser';

// RED-PHASE acceptance test for Story 3.5 (Task 4 + Task 5) — the HEADLESS Phaser SMOKE for the
// Fallen-Shaman swarm-clear + Dispel shatter cinematics, the sibling of arena-cinematic.test.ts (the
// Story 3.4 summon smoke). A NEW file (it does NOT weaken the green Story 3.4 summon smoke — the
// existing arena-cinematic.test.ts stays summon-specific; this file covers the two NEW cinematics).
// It FAILS until ArenaScene (a) STARTS the shaman cinematic when it sees a `{ target:'shaman',
// behavior:'defeat' }` intent and the dispel cinematic when it sees a `{ target:'mirage',
// behavior:'shatter' }` intent in playBeatBehaviors, (b) GENERALIZES `cinematicPhase()` /
// `advanceCinematicToDone()` to the active machine (the tagged active-cinematic union, story Task 4),
// and (c) extends `resetCinematicAlpha` to the imp/shaman/mirage stand-ins (the F3 alpha-restore). The
// SHAMAN_CINEMATIC_TOTAL_MS / DISPEL_CINEMATIC_TOTAL_MS imports (from the not-yet-existing pure modules)
// are themselves part of the intended RED.
//
// What this smoke proves (the gate-provable half — NOT pixels):
//   - playBeatBehaviors([... a defeat/swarm-clear intent set ...]) RUNS without throwing under
//     Phaser.HEADLESS and ARMS the shaman cinematic (cinematicPhase() leaves 'idle'),
//   - the dispel shatter intents arm the dispel cinematic likewise,
//   - advanceCinematicToDone() drives WHICHEVER cinematic is active to 'done' (the generalized clamp),
//   - the create-once cast (forgemaiden/boss/minion) SURVIVES each cinematic run (additive, not a silent
//     skip — entityKinds introspection, reused from Story 2.3/3.3/3.4),
//   - an intent list WITHOUT a shaman-defeat / mirage-shatter intent does NOT arm the cinematic,
//   - each cinematic run is FAIL-CLOSED (an empty / unknown intent list never throws),
//   - the clean return RESTORES a faded stand-in's alpha (the Story 3.4 F3 lesson, now for the
//     shaman/mirage stand-ins).
//
// VERIFICATION LIMITATION (recorded verbatim, the SAME documented gap as arena-cinematic.test.ts L25-32
// / arena-animation.test.ts L23-28 / arena-behavior.test.ts L29-31): jsdom lacks a real canvas/rAF and
// does NOT advance Phaser timers/tweens, so the SPECTACLE (the Shaman swarm-clear reading as ONE
// simultaneous readable wave — AC1; the Dispel reading as a glass-shatter + record-scratch beat — AC2),
// the first-time legibility, the simultaneity-of-the-wave reading, the audible record-scratch (a
// deferred Epic-5 asset; v0.1 renders it VISUALLY), and the ~60fps frame pacing (NFR-1) are
// OPERATOR-verified by watching `pnpm dev` (and the ?cinematic=shaman / ?cinematic=dispel replays).
// This smoke proves the RUN (no throw) + the cast survival + reaching 'done' + the clean-return snap +
// the alpha restore — never the pixels. The pure shaman/dispel-cinematic.test.ts (node) are the
// load-bearing sequence proofs; this smoke is the runs-without-throwing-under-Phaser guard.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ArenaScene } from './arena-scene';
import { PhaserRenderAdapter } from './phaser-render-adapter';
import type { BeatBehaviorIntent } from '../beat-behavior';
import { SHAMAN_CINEMATIC_TOTAL_MS, FALL_MS } from '../shaman-cinematic';
import { DISPEL_CINEMATIC_TOTAL_MS, SHATTER_MS, SCRATCH_MS } from '../dispel-cinematic';
import { initialBattleState, foldBattleState } from '../../model/battle-model';
import type { BattleTimeline } from '../../schema/battle-timeline';
import { pace } from '../../pace/derive-beats';
import { translate } from '../../translate/translate';
import { parseTranscript } from '../../ingest/parse-transcript';
import { parseJournal } from '../../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../../ingest/normalize';
import { mergeStreams } from '../../ingest/merge';
import { applyOverlay } from '../../interpret/overlay';
import { fixtureAnnotations } from '../../interpret/fixture-interpreter';

// The committed-fixture chain (verbatim from phaser-render-adapter.test.ts L23-44) — the REAL fixture
// the golden snapshot folds. The H1 production-path proof drives the REAL adapter's renderBeatBehaviors
// over the REAL shaman/dispel transitions, so the arm-snapshot is the foldBattleState truth production
// threads — NOT a hand-built one.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ingest', '__fixtures__');
const PROD_STREAM_ID = 'aecfc998031eb0576';
function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}
function prodChain(): { timeline: BattleTimeline; view: ReturnType<typeof applyOverlay> } {
  const transcript = normalizeTranscript(
    parseTranscript(readFixture('sample-transcript.jsonl'), PROD_STREAM_ID),
    PROD_STREAM_ID,
  );
  const devMaxEpoch = Math.max(
    ...transcript.map((e) => Date.parse(e.timestamp)).filter((n) => !Number.isNaN(n)),
  );
  const journal = normalizeJournal(parseJournal(readFixture('sample-journal.jsonl')), devMaxEpoch + 1);
  const events = mergeStreams([transcript, journal]);
  return { timeline: pace(translate(events)), view: applyOverlay(events, fixtureAnnotations()) };
}
async function waitForReady(adapter: PhaserRenderAdapter, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!adapter.isReady()) {
    if (Date.now() - start > timeoutMs) throw new Error('adapter did not become ready');
    await new Promise((r) => setTimeout(r, 5));
  }
}

// The PRODUCTION shaman trigger: the exact intents Story 3.3's planBeatBehaviors emits on the
// breakthrough discharge (beat-behavior.ts L166-167) — the imps swarm-clear + the Shaman is defeated.
// The cinematic ELEVATES those placeholder fadeOuts into the full-scene simultaneous wave.
const SHAMAN_INTENTS: BeatBehaviorIntent[] = [
  { target: 'imp', behavior: 'swarm-clear', durationMs: 600 },
  { target: 'shaman', behavior: 'defeat', durationMs: 600 },
];

// The PRODUCTION dispel trigger: the exact intents Story 3.3's planBeatBehaviors emits on a
// dispel-tagged beat (beat-behavior.ts L187-189) — the mirage shatters, the Hero recoils, the truth is
// revealed. The cinematic ELEVATES those into the glass-shatter + record-scratch + reveal set-piece.
const DISPEL_INTENTS: BeatBehaviorIntent[] = [
  { target: 'mirage', behavior: 'shatter', durationMs: 360 },
  { target: 'forgemaiden', behavior: 'resolve-stagger', durationMs: 320 },
  { target: 'mirage', behavior: 'reveal', durationMs: 400 },
];

// A neutral behavior list with NEITHER a shaman-defeat NOR a mirage-shatter intent — must NOT arm
// either cinematic (a lone resurrect loop, the Shaman-still-live placeholder).
const NEUTRAL_INTENTS: BeatBehaviorIntent[] = [
  { target: 'imp', behavior: 'resurrect', durationMs: 400 },
];

// Boot a HEADLESS game and resolve once the Arena scene's create() has run (copied verbatim from
// arena-cinematic.test.ts L58-78 — the proven boot pattern; audio.noAudio + banner:false keep Phaser
// from probing browser APIs jsdom lacks). An EMPTY manifest forces the texture-missing fallback in
// createDisplay → placeholder Rectangles, exercising the overlay / tint / fade paths the cinematics hit.
function bootArena(initData?: { manifest?: Record<string, string> }): Promise<{ game: Phaser.Game; scene: ArenaScene }> {
  return new Promise((resolve, reject) => {
    const game = new Phaser.Game({
      type: Phaser.HEADLESS,
      width: 1024,
      height: 768,
      banner: false,
      audio: { noAudio: true },
      callbacks: {
        postBoot: () => {
          game.scene.add('Arena', ArenaScene, true, initData);
          game.events.once(Phaser.Core.Events.POST_STEP, () => {
            const scene = game.scene.getScene('Arena') as ArenaScene;
            if (scene) resolve({ game, scene });
            else reject(new Error('Arena scene was not registered'));
          });
        },
      },
    });
  });
}

let activeGame: Phaser.Game | undefined;

afterEach(() => {
  activeGame?.destroy(true);
  activeGame = undefined;
});

describe('Story 3.5 AC1 — headless smoke: the shaman defeat intents ARM + RUN the swarm-clear cinematic (no throw)', () => {
  it('SHAMAN_CINEMATIC_TOTAL_MS is exported and positive (the runner + smoke share the pure machine total)', () => {
    expect(Number.isFinite(SHAMAN_CINEMATIC_TOTAL_MS)).toBe(true);
    expect(SHAMAN_CINEMATIC_TOTAL_MS).toBeGreaterThan(0);
  });

  it('playBeatBehaviors([... a shaman defeat intent set ...]) does NOT throw under Phaser.HEADLESS', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    expect(() => scene.playBeatBehaviors(SHAMAN_INTENTS)).not.toThrow();
  });

  it('seeing the shaman defeat intent ARMS the SHAMAN cinematic specifically (first active phase = fall, not the dispel/summon machine)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    expect(scene.cinematicPhase()).toBe('idle');
    scene.playBeatBehaviors(SHAMAN_INTENTS);
    // The generalized active cinematic has STARTED — and it is the SHAMAN machine, NOT the dispel/summon
    // one. cinematicPhase() is the only window into which cinematic armed; the three machines have
    // DISTINCT first-active phases (shaman→fall, dispel→shatter, summon→cutaway — startShaman/startDispel/
    // startSummon), so pinning the exact phase proves the trigger ROUTED to the shaman machine. A weaker
    // `not.toBe('idle')` assertion would pass even if the shaman intent miswired to startDispelCinematic()
    // (a "passes for the wrong reason" gap on the AC1 trigger). [test-review: pin the trigger routing]
    expect(scene.cinematicPhase()).toBe('fall');
  });

  it('advanceCinematicToDone() drives the active shaman cinematic to phase done (the SEQUENCE reaches the terminal)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    scene.playBeatBehaviors(SHAMAN_INTENTS);
    // A synchronous advance-to-done the smoke can call (jsdom never fires a tween onComplete, so the
    // cinematic must NOT depend on one to reach 'done'). The generalized clamp advances WHICHEVER
    // machine is active.
    expect(() => scene.advanceCinematicToDone()).not.toThrow();
    expect(scene.cinematicPhase()).toBe('done');
  });

  it('reaching done FIRES the CLEAN RETURN — it re-applies the CAPTURED snapshot via the SNAP path (R1: restore, not recompute)', async () => {
    // The headline AC1 proof at the SCENE level: post-cinematic the arena shows the correct BattleState.
    // Mirror the boot's t=0 render (the scene captures the reducer snapshot it is handed), then arm +
    // drive to done and assert the SNAP path re-applied that SAME captured BattleState by value.
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    const captured = initialBattleState();
    scene.applySnapshot(captured);

    scene.playBeatBehaviors(SHAMAN_INTENTS);

    const snapSpy = vi.spyOn(scene, 'applySnapshot');
    scene.advanceCinematicToDone();

    expect(snapSpy).toHaveBeenCalledTimes(1);
    expect(snapSpy.mock.calls[0]![0]).toEqual(captured);
  });

  it('the clean return RESTORES the shaman stand-in alpha after the fall/wave fade (not left invisible — the F3 lesson)', async () => {
    // The shaman `fall`/`wave` phases fade stand-ins toward alpha 0, and applySnapshot only restores
    // position/bars — never alpha. So WITHOUT the F3 fix (resetCinematicAlpha extended to the
    // shaman/imp stand-ins) the boss/shaman stand-in is left invisible after a real cinematic. jsdom
    // advances no tweens (alpha would stay 1), so we FORCE alpha 0 to simulate the completed fade, then
    // assert reaching `done` restores it to the resting 1. [review F3; AC1]
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    scene.applySnapshot(initialBattleState());
    scene.playBeatBehaviors(SHAMAN_INTENTS);

    // The shaman/root-cause is rendered on the boss stand-in (Dev Notes "the boss stand-in topples").
    const handle = scene as unknown as { displayOf(t: 'boss'): { alpha?: number } | null };
    const display = handle.displayOf('boss');
    if (display) display.alpha = 0;
    expect(scene.bossAlpha()).toBe(0);

    scene.advanceCinematicToDone();
    expect(scene.bossAlpha()).toBe(1);
  });

  it('the cinematic run is ADDITIVE — the Story 2.3 cast survives (exercised, not silently skipped)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    scene.playBeatBehaviors(SHAMAN_INTENTS);
    scene.advanceCinematicToDone();
    const kinds = scene.entityKinds();
    expect(kinds).toContain('forgemaiden');
    expect(kinds).toContain('boss');
    expect(kinds.filter((k) => k === 'minion').length).toBeGreaterThanOrEqual(1);
  });
});

describe('Story 3.5 AC2 — headless smoke: the dispel shatter intents ARM + RUN the shatter cinematic (no throw)', () => {
  it('DISPEL_CINEMATIC_TOTAL_MS is exported and positive (the runner + smoke share the pure machine total)', () => {
    expect(Number.isFinite(DISPEL_CINEMATIC_TOTAL_MS)).toBe(true);
    expect(DISPEL_CINEMATIC_TOTAL_MS).toBeGreaterThan(0);
  });

  it('playBeatBehaviors([... a mirage shatter intent set ...]) does NOT throw under Phaser.HEADLESS', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    expect(() => scene.playBeatBehaviors(DISPEL_INTENTS)).not.toThrow();
  });

  it('seeing the mirage shatter intent ARMS the DISPEL cinematic specifically (first active phase = shatter, not the shaman/summon machine)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    expect(scene.cinematicPhase()).toBe('idle');
    scene.playBeatBehaviors(DISPEL_INTENTS);
    // The DISPEL machine armed, NOT the shaman/summon one. The dispel machine's first active phase is
    // 'shatter' (startDispel) — distinct from shaman's 'fall' and summon's 'cutaway' — so this pins that
    // the mirage-shatter trigger ROUTED to the dispel machine. A weaker `not.toBe('idle')` would pass even
    // if the shatter intent miswired to startShamanCinematic() (a "passes for the wrong reason" gap on the
    // AC2 trigger). [test-review: pin the trigger routing]
    expect(scene.cinematicPhase()).toBe('shatter');
  });

  it('advanceCinematicToDone() drives the active dispel cinematic to phase done (the SEQUENCE reaches the terminal)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    scene.playBeatBehaviors(DISPEL_INTENTS);
    expect(() => scene.advanceCinematicToDone()).not.toThrow();
    expect(scene.cinematicPhase()).toBe('done');
  });

  it('reaching done FIRES the CLEAN RETURN — it re-applies the CAPTURED snapshot via the SNAP path (R1: restore, not recompute)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    const captured = initialBattleState();
    scene.applySnapshot(captured);

    scene.playBeatBehaviors(DISPEL_INTENTS);

    const snapSpy = vi.spyOn(scene, 'applySnapshot');
    scene.advanceCinematicToDone();

    expect(snapSpy).toHaveBeenCalledTimes(1);
    expect(snapSpy.mock.calls[0]![0]).toEqual(captured);
  });

  it('the clean return RESTORES the mirage stand-in alpha after the shatter fade (not left invisible — the F3 lesson)', async () => {
    // The dispel `shatter` phase fades/tints the mirage (minion) stand-in; applySnapshot does not
    // restore alpha. resetCinematicAlpha must be extended to the mirage/minion stand-in so the operator
    // does not see an invisible minion post-cinematic. Force alpha 0, assert `done` restores 1. [F3; AC2]
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    scene.applySnapshot(initialBattleState());
    scene.playBeatBehaviors(DISPEL_INTENTS);

    // The mirage is rendered on the minion stand-in (Dev Notes "the minion stand-in shatters"). The
    // smoke reads its alpha via the same displayOf introspection the 3.4 boss-alpha guard uses.
    const handle = scene as unknown as { displayOf(t: 'minion'): { alpha?: number } | null };
    const display = handle.displayOf('minion');
    if (display) {
      display.alpha = 0;
      expect(display.alpha).toBe(0);
      scene.advanceCinematicToDone();
      expect(display.alpha).toBe(1);
    } else {
      // Fail-closed shape note: if the minion has no display in this jsdom shape, the clean return must
      // still reach `done` without throwing (the smoke never asserts pixels).
      scene.advanceCinematicToDone();
      expect(scene.cinematicPhase()).toBe('done');
    }
  });

  it('the cinematic run is ADDITIVE — the Story 2.3 cast survives (exercised, not silently skipped)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    scene.playBeatBehaviors(DISPEL_INTENTS);
    scene.advanceCinematicToDone();
    const kinds = scene.entityKinds();
    expect(kinds).toContain('forgemaiden');
    expect(kinds).toContain('boss');
    expect(kinds.filter((k) => k === 'minion').length).toBeGreaterThanOrEqual(1);
  });

  it('entering the REVEAL phase RESTORES the minion alpha to 1 first (the reveal beat reads, not a faded flash — review L1)', async () => {
    // L1: the `shatter` phase fades the minion toward alpha 0 (no yoyo). WITHOUT resetting first, the
    // reveal `flash` would yoyo 0->0.4->0 and the truth-reveal beat would be near-invisible. jsdom
    // advances no tweens, so we FORCE alpha 0 to simulate the completed shatter fade, then advance into
    // `reveal` and assert the phase entry reset the stand-in to the visible resting alpha 1.
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    scene.applySnapshot(initialBattleState());
    scene.playBeatBehaviors(DISPEL_INTENTS);

    const handle = scene as unknown as {
      displayOf(t: 'minion'): { alpha?: number } | null;
      update(time: number, delta: number): void;
    };
    const display = handle.displayOf('minion');
    if (display) {
      display.alpha = 0; // simulate the completed shatter fade (jsdom advances no tweens)
      // Advance into the reveal phase (past shatter + scratch).
      handle.update(0, SHATTER_MS + SCRATCH_MS + 1);
      expect(scene.cinematicPhase()).toBe('reveal');
      expect(display.alpha).toBe(1); // the reveal beat starts from a VISIBLE stand-in (L1 fix)
    } else {
      // Fail-closed shape note: no minion display in this jsdom shape — advancing must still not throw.
      handle.update(0, SHATTER_MS + SCRATCH_MS + 1);
      expect(scene.cinematicPhase()).toBe('reveal');
    }
  });
});

describe('Story 3.5 H1 — production clean return restores foldBattleState(armedCursor), NOT the stale t=0 frame', () => {
  // The end-to-end H1 regression guard a fake adapter CANNOT fake (it needs the REAL ArenaScene driven
  // through the REAL PhaserRenderAdapter on the REAL fixture). The bug: cinematicSnapshot is written
  // ONLY in applySnapshot, but the forward tick arms cinematics via renderTransition→playAnimations +
  // renderBeatBehaviors→playBeatBehaviors — NEITHER calls applySnapshot — so it stayed pinned at the
  // boot's t=0 frame and the shaman clean return (armed at the FINAL cursor) snapped the arena back to
  // full health right after the swarm-clear. The fix threads the transition's `next` as the arm-snapshot
  // (adapter L130-135). Here we drive the production seam and assert the re-applied snapshot is the
  // ARMED cursor's foldBattleState truth, distinct from t=0. [review H1]
  it('renderBeatBehaviors over the REAL shaman transition pins the armed-cursor snapshot, not t=0', async () => {
    const adapter = new PhaserRenderAdapter('game-container', {}, Phaser.HEADLESS);
    adapter.init();
    await waitForReady(adapter);
    const scene = adapter.sceneForTest()!;

    const { timeline, view } = prodChain();
    // The shaman defeat fires on the FINAL forward transition (probe-confirmed: the breakthrough
    // discharge at the last cursor — the worst case for the stale-t=0 bug).
    const armedCursor = timeline.beats.length;
    const prev = foldBattleState(timeline, armedCursor - 1);
    const next = foldBattleState(timeline, armedCursor);

    // Boot rendered t=0 (the only applySnapshot on the production path before arming). Sanity: the armed
    // cursor's truth genuinely DIVERGES from t=0, so a stale restore would be operator-visible.
    expect(next).not.toEqual(initialBattleState());

    // Drive the REAL production seam (NOT a dev hook, NOT a manual applySnapshot(next)) — this threads
    // `next` as the arm-snapshot exactly as the boot's forward tick does.
    adapter.renderBeatBehaviors(prev, next, timeline.beats.slice(armedCursor - 1, armedCursor), view);
    expect(scene.cinematicPhase()).toBe('fall'); // the shaman cinematic armed on the production intent

    const snapSpy = vi.spyOn(scene, 'applySnapshot');
    scene.advanceCinematicToDone();

    // The clean return re-applied the ARMED cursor's foldBattleState truth — NOT the stale t=0 frame.
    expect(snapSpy).toHaveBeenCalledTimes(1);
    expect(snapSpy.mock.calls[0]![0]).toEqual(next);
    expect(snapSpy.mock.calls[0]![0]).not.toEqual(initialBattleState());

    adapter.destroy();
  });

  it('renderBeatBehaviors over the REAL dispel transition pins the armed-cursor snapshot (cosmetic divergence, same mechanism)', async () => {
    const adapter = new PhaserRenderAdapter('game-container', {}, Phaser.HEADLESS);
    adapter.init();
    await waitForReady(adapter);
    const scene = adapter.sceneForTest()!;

    const { timeline, view } = prodChain();
    // The dispel shatter fires on the FIRST forward transition (probe-confirmed: Beat[0], cursor 0->1).
    const armedCursor = 1;
    const prev = foldBattleState(timeline, armedCursor - 1);
    const next = foldBattleState(timeline, armedCursor);

    adapter.renderBeatBehaviors(prev, next, timeline.beats.slice(armedCursor - 1, armedCursor), view);
    expect(scene.cinematicPhase()).toBe('shatter'); // the dispel cinematic armed on the production intent

    const snapSpy = vi.spyOn(scene, 'applySnapshot');
    scene.advanceCinematicToDone();

    expect(snapSpy).toHaveBeenCalledTimes(1);
    expect(snapSpy.mock.calls[0]![0]).toEqual(next);

    adapter.destroy();
  });
});

describe('Story 3.5 M1 — first-armed-wins: a re-delivered trigger while active is a no-op (no overwrite, no orphaned swarm)', () => {
  // The documented contract (Dev Notes §"Scene cinematic state": "the first-armed wins, the second is a
  // no-op while active"). Before the M1 guard the arm block ran unconditionally, so a re-delivered
  // trigger mid-play overwrote activeCinematic (reset to the new machine's first phase) and orphaned the
  // prior impSwarm rects. [review M1]
  it('a SECOND shaman trigger while the shaman cinematic is mid-wave does NOT reset it or orphan the swarm', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    scene.applySnapshot(initialBattleState());

    // Arm + advance into `wave` (past FALL_MS) so we are mid-cinematic with a live impSwarm spawned.
    scene.playBeatBehaviors(SHAMAN_INTENTS);
    (scene as unknown as { update(t: number, d: number): void }).update(0, FALL_MS + 1);
    const phaseAfterFirst = scene.cinematicPhase();
    expect(phaseAfterFirst).not.toBe('idle');
    expect(phaseAfterFirst).not.toBe('fall'); // it advanced past the first phase
    const swarmBefore = (scene as unknown as { impSwarm: unknown[] }).impSwarm.length;

    // A SECOND shaman trigger arrives — it must NOT re-arm (which would snap the phase back to 'fall'
    // and orphan the swarmBefore rects).
    scene.playBeatBehaviors(SHAMAN_INTENTS);
    expect(scene.cinematicPhase()).toBe(phaseAfterFirst); // unchanged — the second trigger was a no-op
    const swarmAfter = (scene as unknown as { impSwarm: unknown[] }).impSwarm.length;
    expect(swarmAfter).toBe(swarmBefore); // no orphaned/duplicated swarm

    scene.advanceCinematicToDone();
    expect(scene.cinematicPhase()).toBe('done');
  });

  it('a DISPEL trigger while the shaman cinematic is active does NOT hijack to the dispel machine (first-armed wins)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    scene.applySnapshot(initialBattleState());

    scene.playBeatBehaviors(SHAMAN_INTENTS);
    expect(scene.cinematicPhase()).toBe('fall'); // the shaman machine armed

    // A dispel trigger mid-shaman must be ignored — the shaman machine stays active (not 'shatter').
    scene.playBeatBehaviors(DISPEL_INTENTS);
    expect(scene.cinematicPhase()).toBe('fall');

    scene.advanceCinematicToDone();
    expect(scene.cinematicPhase()).toBe('done');
  });
});

describe('Story 3.5 — the TRIGGERS are intent-specific + FAIL-CLOSED (no spurious arming, no throw)', () => {
  it('a NEUTRAL behavior list (a lone resurrect loop) does NOT arm any cinematic', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    scene.playBeatBehaviors(NEUTRAL_INTENTS);
    expect(scene.cinematicPhase()).toBe('idle');
  });

  it('a resolve-stagger intent ALONE (no mirage shatter) does NOT arm the dispel cinematic (the trigger keys on shatter)', async () => {
    // The production trigger emits shatter + resolve-stagger + reveal TOGETHER; resolve-stagger is only
    // SUBSUMED when the shatter armed the cinematic. A resolve-stagger WITHOUT a shatter must fall
    // through to its placeholder cue and leave the cinematic at rest — fail-closed-to-default. [AC2]
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    scene.playBeatBehaviors([{ target: 'forgemaiden', behavior: 'resolve-stagger', durationMs: 320 }]);
    expect(scene.cinematicPhase()).toBe('idle');
  });

  it('an EMPTY intent list is a safe no-op (a held frame never arms a cinematic, never throws)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    expect(() => scene.playBeatBehaviors([])).not.toThrow();
    expect(scene.cinematicPhase()).toBe('idle');
  });

  it('an UNKNOWN behavior/target is a safe no-op (fail-closed — never throws)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    const unknown = { target: 'not-a-real-target', behavior: 'not-a-real-behavior', durationMs: 100 } as unknown as BeatBehaviorIntent;
    expect(() => scene.playBeatBehaviors([unknown])).not.toThrow();
  });
});
