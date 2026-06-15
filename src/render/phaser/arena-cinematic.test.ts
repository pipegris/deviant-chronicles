// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
// Phaser 4.0.0's ESM build exposes ONLY named exports (no default) — a namespace import is the
// correct form (verified in arena-scene.test.ts against node_modules/phaser/dist/phaser.esm.js).
import * as Phaser from 'phaser';

// RED-PHASE acceptance test for Story 3.4 (Task 3 + Task 4) — the HEADLESS Phaser SMOKE for the
// THUNDORR-summon cinematic, the sibling of arena-behavior.test.ts (the Story 3.3 playBeatBehaviors
// smoke) and arena-animation.test.ts (the Story 2.4 playAnimations smoke). It FAILS until ArenaScene
// (a) STARTS the cinematic when it sees a `{ target:'eidolon', behavior:'summon' }` BeatBehaviorIntent
// in playBeatBehaviors, and (b) exposes the gate-provable introspection the smoke reads
// (`cinematicPhase()` mirroring lastPlayedIntents(); a synchronous `advanceCinematicToDone()` so the
// SEQUENCE + clean-return snap are reachable without a tween clock). The SUMMON_CINEMATIC_TOTAL_MS
// import (from ../summon-cinematic, which does not exist yet) is itself part of the intended RED.
//
// What this smoke proves (the gate-provable half — NOT pixels):
//   - playBeatBehaviors([... a `summon` intent ...]) RUNS without throwing under Phaser.HEADLESS and
//     ARMS the cinematic (cinematicPhase() leaves 'idle'),
//   - advanceCinematicToDone() drives the cinematic to phase 'done' (the SEQUENCE reaches the terminal),
//   - the create-once cast (forgemaiden/boss/minion) SURVIVES the cinematic run (additive, not a silent
//     skip — entityKinds introspection, reused from Story 2.3/3.3),
//   - a behavior list WITHOUT a summon intent does NOT arm the cinematic (the TRIGGER is summon-specific),
//   - the cinematic run is FAIL-CLOSED (an empty / unknown intent list never throws).
//
// VERIFICATION LIMITATION (recorded verbatim, the SAME documented gap as arena-animation.test.ts L23-28
// / arena-behavior.test.ts L29-31): jsdom lacks a real canvas/rAF and does NOT advance Phaser
// timers/tweens, so the SPECTACLE the cinematic plays (the time-freeze cutaway reading as a distinct
// full-scene set-piece, the colossal blow, the departure), AC2's first-time legibility, and the ~60fps
// frame pacing (NFR-1) are OPERATOR-verified by watching `pnpm dev?cinematic=summon`. This smoke proves
// the RUN (no throw) + the cast survival + reaching 'done' + the clean-return snap — the gate-provable
// SEQUENCE/TRIGGER, never the pixels. The pure summon-cinematic.test.ts (node) is the load-bearing
// sequence proof; this smoke is the runs-without-throwing-under-Phaser guard.
import { ArenaScene } from './arena-scene';
import type { BeatBehaviorIntent } from '../beat-behavior';
import { SUMMON_CINEMATIC_TOTAL_MS } from '../summon-cinematic';
import type { SummonCinematicPhase } from '../summon-cinematic';
import { initialBattleState } from '../../model/battle-model';

// The PRODUCTION summon trigger: the exact intent Story 3.3's planBeatBehaviors emits on a summon-tagged
// charged-gauge breakthrough (beat-behavior.ts L203-204). The cinematic ELEVATES the placeholder
// summon/decisive-blow tweens into the full-scene set-piece. durationMs values are plausible placeholders.
const SUMMON_INTENTS: BeatBehaviorIntent[] = [
  { target: 'eidolon', behavior: 'summon', durationMs: 800 },
  { target: 'eidolon', behavior: 'decisive-blow', durationMs: 600 },
];

// A behavior list with NO cinematic-arming intent — must NOT arm the summon cinematic (or any other).
// DEV-STORY JUSTIFIED CHANGE (Story 3.5): this fixture was ORIGINALLY a Dispel sequence
// ({mirage,shatter}+{forgemaiden,resolve-stagger}+{mirage,reveal}) under the premise "a Dispel sequence
// does NOT arm the (summon) cinematic" — TRUE in Story 3.4 (no dispel cinematic existed). Story 3.5 adds
// the Dispel shatter cinematic, which CORRECTLY arms on the {mirage,shatter} intent, so that exact list
// now (rightly) yields cinematicPhase()==='shatter'. The test's true purpose — the summon trigger is
// summon-SPECIFIC, an unrelated behavior list leaves the cinematic at rest — is preserved by using a
// genuinely non-arming list (a lone resurrect loop, the same NEUTRAL list the Story-3.5 smoke uses). The
// dispel/shaman arming is proven in arena-shaman-dispel-cinematic.test.ts. This does not weaken the 3.4
// trigger proof; it corrects a fixture made stale by the new (correct) dispel trigger. [story Task 4
// "isCinematicActive() becomes 'any of three'"; orchestrator "fix the test WITH a documented justification"]
const NON_SUMMON_INTENTS: BeatBehaviorIntent[] = [
  { target: 'imp', behavior: 'resurrect', durationMs: 400 },
];

// Boot a HEADLESS game and resolve once the Arena scene's create() has run (copied verbatim from
// arena-behavior.test.ts L54-74 — the proven boot pattern; audio.noAudio + banner:false keep Phaser
// from probing browser APIs jsdom lacks). An EMPTY manifest forces the texture-missing fallback in
// createDisplay → placeholder Rectangles, exercising the cutaway-overlay / tint paths the cinematic hits.
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

describe('Story 3.4 AC1 — headless Phaser smoke: a summon intent ARMS + RUNS the cinematic to done (no throw)', () => {
  it('SUMMON_CINEMATIC_TOTAL_MS is exported and positive (the runner + smoke share the pure machine total)', () => {
    expect(Number.isFinite(SUMMON_CINEMATIC_TOTAL_MS)).toBe(true);
    expect(SUMMON_CINEMATIC_TOTAL_MS).toBeGreaterThan(0);
  });

  it('playBeatBehaviors([... a summon intent ...]) does NOT throw under Phaser.HEADLESS', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    expect(() => scene.playBeatBehaviors(SUMMON_INTENTS)).not.toThrow();
  });

  it('seeing the summon intent ARMS the cinematic (cinematicPhase() leaves idle)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    // Before any intent the cinematic is at rest.
    expect(scene.cinematicPhase()).toBe('idle' satisfies SummonCinematicPhase);
    scene.playBeatBehaviors(SUMMON_INTENTS);
    // After the summon intent the cinematic has STARTED (entered the first active phase, cutaway).
    expect(scene.cinematicPhase()).not.toBe('idle');
  });

  it('advanceCinematicToDone() drives the cinematic to phase done (the SEQUENCE reaches the terminal)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    scene.playBeatBehaviors(SUMMON_INTENTS);
    // A synchronous advance-to-done the smoke can call (jsdom never fires a tween onComplete, so the
    // cinematic must NOT depend on one to reach 'done' — the story's documented advance requirement).
    expect(() => scene.advanceCinematicToDone()).not.toThrow();
    expect(scene.cinematicPhase()).toBe('done' satisfies SummonCinematicPhase);
  });

  it('reaching done FIRES the CLEAN RETURN — it re-applies the CAPTURED snapshot via the SNAP path (R1: restore, not recompute)', async () => {
    // The headline AC1 proof at the SCENE level: "returns cleanly to the arena state". Reaching `done`
    // must re-apply the BattleState the scene was last GIVEN (its captured foldBattleState truth), NOT
    // merely flip the phase. Without this assertion a regression that dropped the `done`-phase
    // applySnapshot call (or never captured a snapshot) still passes the phase===done check — the clean
    // return would be silently lost. (Indeed: this test caught that the headless smoke never exercised
    // the snap at all, because create() builds the cast directly and only adapter.render→applySnapshot
    // captures the snapshot; in production the boot ALWAYS renders the t=0 snapshot before a summon can
    // arm the cinematic, so we mirror that here by snapping the t=0 snapshot first — exactly the boot's
    // `adapter.render(state.battleState)` at L111 of arena-boot.ts.) [story Task 2/3/4; AC1]
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    // Mirror the boot's t=0 render: the scene CAPTURES the reducer snapshot it is handed (the same
    // foldBattleState truth the clean return restores). This is the real production precondition — a
    // summon intent only arrives AFTER the arena has rendered at least the t=0 frame.
    const captured = initialBattleState();
    scene.applySnapshot(captured);

    scene.playBeatBehaviors(SUMMON_INTENTS);

    // Spy only AFTER arming so we observe the clean-return snap specifically (not the seed snap above).
    const snapSpy = vi.spyOn(scene, 'applySnapshot');
    scene.advanceCinematicToDone();

    // The clean return ran: the SNAP path was invoked exactly once on `done`, re-applying the SAME
    // captured BattleState by VALUE (restore, never recompute — it is the snapshot the scene was given).
    expect(snapSpy).toHaveBeenCalledTimes(1);
    expect(snapSpy.mock.calls[0]![0]).toEqual(captured);
  });

  it('the clean return RESTORES the boss stand-in alpha after the depart fade (not left invisible)', async () => {
    // The `depart` phase fades the boss to alpha 0 with NO yoyo ("it leaves"), and applySnapshot only
    // restores position/bars — never alpha. So WITHOUT the F3 fix the boss is left invisible after a
    // real cinematic. jsdom advances no tweens (alpha would stay 1), so we FORCE alpha 0 to simulate the
    // completed depart fade, then assert reaching `done` restores it to the resting 1. [review F3; AC1]
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    scene.applySnapshot(initialBattleState()); // capture the snapshot the clean return will restore
    scene.playBeatBehaviors(SUMMON_INTENTS);

    // Simulate the depart fade having driven the stand-in to fully transparent (the tween never runs in
    // jsdom). Reaching `done` must reset this — else the operator sees an invisible boss post-cinematic.
    const boss = scene as unknown as { displayOf(t: 'boss'): { alpha?: number } | null };
    const display = boss.displayOf('boss');
    if (display) display.alpha = 0;
    expect(scene.bossAlpha()).toBe(0);

    scene.advanceCinematicToDone();
    expect(scene.bossAlpha()).toBe(1);
  });

  it('the cinematic run is ADDITIVE — the Story 2.3 cast survives (exercised, not silently skipped)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    scene.playBeatBehaviors(SUMMON_INTENTS);
    scene.advanceCinematicToDone();
    const kinds = scene.entityKinds();
    expect(kinds).toContain('forgemaiden');
    expect(kinds).toContain('boss');
    expect(kinds.filter((k) => k === 'minion').length).toBeGreaterThanOrEqual(1);
  });
});

describe('Story 3.4 AC1 — the TRIGGER is summon-specific (a non-arming behavior list does NOT arm the cinematic)', () => {
  it('a behavior list with NO cinematic-arming intent leaves the cinematic at idle', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    scene.playBeatBehaviors(NON_SUMMON_INTENTS);
    expect(scene.cinematicPhase()).toBe('idle' satisfies SummonCinematicPhase);
  });

  it('a decisive-blow intent ALONE (no summon) does NOT arm the cinematic (the trigger keys on summon, not its companion)', async () => {
    // The production trigger emits summon + decisive-blow TOGETHER; decisive-blow is only SUBSUMED when
    // hasSummon. A decisive-blow WITHOUT a summon (a near-miss / a future plan that emits it alone) must
    // fall through to its placeholder lunge and leave the cinematic at rest — fail-closed-to-default on
    // the summon-adjacent intent. A happy-path smoke that only ever sends summon+decisive-blow together
    // would not catch a regression that armed the full-scene cinematic on decisive-blow alone. [AC1]
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    scene.playBeatBehaviors([{ target: 'eidolon', behavior: 'decisive-blow', durationMs: 600 }]);
    expect(scene.cinematicPhase()).toBe('idle' satisfies SummonCinematicPhase);
  });

  it('an EMPTY intent list is a safe no-op (a held frame never arms the cinematic, never throws)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    expect(() => scene.playBeatBehaviors([])).not.toThrow();
    expect(scene.cinematicPhase()).toBe('idle' satisfies SummonCinematicPhase);
  });

  it('an UNKNOWN behavior/target is a safe no-op (fail-closed — never throws)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    const unknown = { target: 'not-a-real-target', behavior: 'not-a-real-behavior', durationMs: 100 } as unknown as BeatBehaviorIntent;
    expect(() => scene.playBeatBehaviors([unknown])).not.toThrow();
  });
});
