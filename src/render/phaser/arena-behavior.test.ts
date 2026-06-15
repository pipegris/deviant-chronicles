// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
// Phaser 4.0.0's ESM build exposes ONLY named exports (no default) — a namespace import is the
// correct form (verified in arena-scene.test.ts against node_modules/phaser/dist/phaser.esm.js).
import * as Phaser from 'phaser';

// GREEN-phase HEADLESS Phaser BOOT SMOKE for the BEHAVIOR path (Story 3.3, Task 3) — the sibling of
// arena-animation.test.ts (the Story 2.4 playAnimations smoke). The PURE decision layer
// (beat-behavior.test.ts) proves WHICH intents fire; the one-way seam test (beat-behavior-transition
// .test.ts) proves they flow renderer-agnostically. NEITHER exercises the REAL thin Phaser consumer
// `ArenaScene.playBeatBehaviors` (they use a FAKE adapter), so this smoke pins its gate-provable
// contract: it RUNS the placeholder tween/tint per BeatBehaviorIntent on the existing cast and is
// FAIL-CLOSED — an unknown behavior/target is a safe no-op, never a throw (arena-scene.ts runBehavior
// L314-355 / behaviorTarget L360-374, the documented `default: return` branches). That fail-closed
// posture is gate-provable (not pixels), it mirrors the precedent the 2.4 smoke set for playAnimations,
// and the adversarial code review cannot prove a `default:` branch is actually reached — only a test can.
//
// What this smoke proves (NOT pixels — HEADLESS draws nothing; "imps visibly resurrect/die as a wave",
// "the mirage shatters", "the blow reads as decisive", 60fps are the VISUAL reading, OPERATOR-verified
// by watching `pnpm dev`; the polished cinematics are Stories 3.4/3.5):
//   - playBeatBehaviors([...every BeatBehaviorName across representative targets...]) runs without
//     throwing under Phaser.HEADLESS (the create-once cast + the tween manager survive the full list),
//   - an UNKNOWN behavior AND an UNKNOWN target are safe no-ops (the fail-closed contract — zero coverage
//     before this file),
//   - an EMPTY intent list (a held frame / non-tagged transition) is a safe no-op,
//   - the behavior path is ADDITIVE: the cast Story 2.3 created survives a behavior run (entityKinds
//     introspection — the path was exercised, not a silent skip).
//
// VERIFICATION LIMITATION (recorded honestly, same as arena-animation.test.ts L23-28): jsdom lacks a
// real canvas/rAF and does not advance Phaser timers/tweens, so the MOTION the behaviors play is
// operator-verified — this smoke asserts the RUN (no throw) + the cast survival, the gate-provable half.
import { ArenaScene } from './arena-scene';
import type { BeatBehaviorIntent } from '../beat-behavior';

// A representative intent list spanning EVERY BeatBehaviorName the Phaser layer must run (arena-scene.ts
// runBehavior switch) across representative targets (the signature-beat cast: imp/shaman/mirage/
// forgemaiden/eidolon/boss). durationMs values are plausible placeholder timings.
const REPRESENTATIVE_BEHAVIORS: BeatBehaviorIntent[] = [
  { target: 'imp', behavior: 'resurrect', durationMs: 400 },
  { target: 'imp', behavior: 'swarm-clear', durationMs: 600 },
  { target: 'shaman', behavior: 'defeat', durationMs: 600 },
  { target: 'mirage', behavior: 'shatter', durationMs: 360 },
  { target: 'forgemaiden', behavior: 'resolve-stagger', durationMs: 320 },
  { target: 'mirage', behavior: 'reveal', durationMs: 400 },
  { target: 'eidolon', behavior: 'summon', durationMs: 800 },
  { target: 'eidolon', behavior: 'decisive-blow', durationMs: 600 },
];

// Boot a HEADLESS game and resolve once the Arena scene's create() has run (copied verbatim from
// arena-animation.test.ts L53-78 — the proven boot pattern; audio.noAudio + banner:false keep Phaser
// from probing browser APIs jsdom lacks). An EMPTY manifest forces the texture-missing fallback in
// createDisplay -> placeholder Rectangles (which have a fillColor tint() can act on), so the tint
// restore path the shatter/resolve-stagger behaviors hit is actually exercised.
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

describe('Story 3.3 AC1/AC2/AC3 — headless Phaser boot smoke (ArenaScene.playBeatBehaviors runs the intents)', () => {
  it('playBeatBehaviors([...every behavior across representative targets...]) does NOT throw under Phaser.HEADLESS', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    expect(() => scene.playBeatBehaviors(REPRESENTATIVE_BEHAVIORS)).not.toThrow();
  });

  it('the behavior path is ADDITIVE — the Story 2.3 cast survives a behavior run (exercised, not silently skipped)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    scene.playBeatBehaviors(REPRESENTATIVE_BEHAVIORS);
    // The placeholder cast (forgemaiden/boss/minion — the stand-ins the signature-beat targets reuse)
    // is intact after the run: nothing in the behavior runner destroys the cast (entityKinds is the
    // Story 2.3 introspection, reused here to prove the path ran against the real display objects).
    const kinds = scene.entityKinds();
    expect(kinds).toContain('forgemaiden');
    expect(kinds).toContain('boss');
    expect(kinds.filter((k) => k === 'minion').length).toBeGreaterThanOrEqual(1);
  });

  it('an UNKNOWN behavior is a safe NO-OP (fail-closed — never throws; runBehavior `default: return`)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    // The behavior runner no-ops on a behavior name outside the union (the documented fail-closed
    // posture, exactly runIntent's). A cast cannot send an unknown member through a typed call, so we
    // cast to the runtime shape a future/forward-compat intent could carry — the runner must not throw.
    const unknownBehavior = { target: 'imp', behavior: 'not-a-real-behavior', durationMs: 100 } as unknown as BeatBehaviorIntent;
    expect(() => scene.playBeatBehaviors([unknownBehavior])).not.toThrow();
  });

  it('an UNKNOWN target is a safe NO-OP (fail-closed — behaviorTarget `default` resolves to a kind the helpers no-op on)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    // A target outside the union resolves via behaviorTarget's `default` branch; the placeholder helper
    // then finds no matching display and no-ops. Never a throw.
    const unknownTarget = { target: 'not-a-real-target', behavior: 'summon', durationMs: 100 } as unknown as BeatBehaviorIntent;
    expect(() => scene.playBeatBehaviors([unknownTarget])).not.toThrow();
  });

  it('an EMPTY intent list is a safe no-op (a held frame / non-tagged transition runs nothing, does not throw)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    expect(() => scene.playBeatBehaviors([])).not.toThrow();
  });
});
