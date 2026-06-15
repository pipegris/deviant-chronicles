// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
// Phaser 4.0.0's ESM build exposes ONLY named exports (no default) — a namespace import is the
// correct form (verified in arena-scene.test.ts against node_modules/phaser/dist/phaser.esm.js).
import * as Phaser from 'phaser';

// RED-PHASE acceptance test for Story 2.4 (Task 2 + Task 4) — the HEADLESS Phaser BOOT SMOKE for
// the ANIMATION path. This FAILS until (a) src/render/animation-plan.ts exports `AnimationIntent`
// (the import resolves to nothing) and (b) ArenaScene gains `playAnimations(intents)` + the
// introspection the smoke reads. It boots the SAME Phaser.HEADLESS Arena the Story 2.3 smoke boots
// (proven pattern, copied), then calls scene.playAnimations([...a representative intent list...])
// and asserts it did NOT throw and RAN.
//
// What the smoke proves (NOT pixels — HEADLESS draws nothing; "reads as a flurry" / "60fps" /
// "defiance" / "distinct overlay" are the VISUAL reading, OPERATOR-verified by watching `pnpm dev`):
//   - playAnimations([forge-strike, hammer-flurry, cast, stagger, rise, hit, death, aether-storm,
//     bar-tween, gauge-tween]) runs without throwing under Phaser.HEADLESS (the create-once cast +
//     the tween manager survive a full representative intent list),
//   - the scene records that it ran (introspection counter / last-intents), so the smoke asserts the
//     animated path was exercised, not silently skipped.
//   - applySnapshot (the Story 2.3 SNAP path for t=0 + seeks) STILL works alongside playAnimations.
//
// VERIFICATION LIMITATION (recorded honestly, per the story's Task 4 fallback clause): jsdom lacks a
// real canvas/rAF, and Phaser 4's tween manager may probe a browser API jsdom does not provide. The
// repo's vitest.setup.canvas2d.ts installs a 2D-context stub for exactly this boot. If a genuine
// jsdom/Phaser tween gap proves to block playAnimations, this becomes operator-verified — it is NOT
// to be weakened to a no-op. The NODE-env tests (animation-plan.test.ts, animation-transition.test.ts)
// are the load-bearing gate-provable surface; this smoke is the runs-without-throwing guard.
import { ArenaScene } from './arena-scene';
import { initialBattleState } from '../../model/battle-model';
import type { AnimationIntent } from '../animation-plan';

// A representative intent list spanning EVERY AnimName the Phaser layer must run (Task 2): the
// Forgemaiden action anims, the enemy hit/death, the environment overlay, and the bar/gauge tweens.
// from/to are [0,1] fractions for the tweens; repeat is the multi-strike count for the flurry.
const REPRESENTATIVE_INTENTS: AnimationIntent[] = [
  { target: 'forgemaiden', anim: 'forge-strike', durationMs: 300, from: null, to: null, repeat: null },
  { target: 'forgemaiden', anim: 'hammer-flurry', durationMs: 120, from: null, to: null, repeat: 3 },
  { target: 'forgemaiden', anim: 'cast', durationMs: 300, from: null, to: null, repeat: null },
  { target: 'forgemaiden', anim: 'stagger', durationMs: 300, from: null, to: null, repeat: null },
  { target: 'forgemaiden', anim: 'rise', durationMs: 300, from: null, to: null, repeat: null },
  { target: 'boss', anim: 'hit', durationMs: 200, from: null, to: null, repeat: null },
  { target: 'boss', anim: 'death', durationMs: 400, from: null, to: null, repeat: null },
  { target: 'environment', anim: 'aether-storm', durationMs: 500, from: null, to: null, repeat: null },
  { target: 'problemIntegrityBar', anim: 'bar-tween', durationMs: 300, from: 0.8, to: 0.64, repeat: null },
  { target: 'resolveBar', anim: 'bar-tween', durationMs: 300, from: 1, to: 0.87, repeat: null },
  { target: 'insightGauge', anim: 'gauge-tween', durationMs: 300, from: 0, to: 0.6, repeat: null },
];

// Boot a HEADLESS game and resolve once the Arena scene's create() has run (copied verbatim from
// arena-scene.test.ts L75-96 — the proven boot pattern; audio.noAudio + banner:false keep Phaser
// from probing browser APIs jsdom lacks).
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
          // Start the Arena with optional init data (a manifest override). An EMPTY manifest forces
          // the texture-missing fallback in createDisplay -> placeholder Rectangles (which have a
          // fillColor tint() can act on), so the R5 tint-restore path is actually exercised here (with
          // the default manifest the textures bake to Images, where tint() is a no-op). Default (no
          // initData) reproduces the Story 2.3 boot exactly.
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

describe('Story 2.4 AC1/AC2/AC3 — headless Phaser boot smoke (ArenaScene.playAnimations runs the intents)', () => {
  it('playAnimations([...representative intents...]) does NOT throw under Phaser.HEADLESS', async () => {
    const { game, scene } = await bootArena();
    activeGame = game;
    expect(() => scene.playAnimations(REPRESENTATIVE_INTENTS)).not.toThrow();
  });

  it('playAnimations RAN — the scene records the intents it played (introspection, no pixels)', async () => {
    const { game, scene } = await bootArena();
    activeGame = game;
    scene.playAnimations(REPRESENTATIVE_INTENTS);
    // The scene exposes the last-played intent list (mirroring Story 2.3's entityKinds/bossBarFraction
    // introspection) so the smoke can assert the animated path was exercised, not silently skipped.
    expect(scene.lastPlayedIntents()).toEqual(REPRESENTATIVE_INTENTS);
  });

  it('an EMPTY intent list is a safe no-op (a held frame runs nothing, does not throw)', async () => {
    const { game, scene } = await bootArena();
    activeGame = game;
    expect(() => scene.playAnimations([])).not.toThrow();
    expect(scene.lastPlayedIntents()).toEqual([]);
  });

  it('applySnapshot (the Story 2.3 SNAP path for seeks) STILL works alongside playAnimations', async () => {
    const { game, scene } = await bootArena();
    activeGame = game;
    // The animated path is ADDITIVE — the snap path Story 2.3 built must remain intact (forward
    // playback animates; seek/scrub snaps). Run a bar-tween, then SNAP via applySnapshot, and assert
    // BOTH paths coexist without throwing. We do NOT assert a specific post-tween fill fraction (the
    // tween's interpolation under HEADLESS is an implementation detail / motion the gate cannot see);
    // we assert the SNAP authoritatively sets the tracked fraction (the Story 2.3 contract: a seek
    // snaps to the correct static state regardless of any in-flight tween).
    expect(() =>
      scene.playAnimations([
        { target: 'problemIntegrityBar', anim: 'bar-tween', durationMs: 300, from: 1, to: 0.5, repeat: null },
      ]),
    ).not.toThrow();
    // applySnapshot still snaps the Boss bar correctly (the t=0 model = full integrity), proving the
    // snap path is intact and authoritative after an animated call.
    expect(() => scene.applySnapshot(initialBattleState())).not.toThrow();
    expect(scene.bossBarFraction()).toBe(1);
  });

  it('a bar-tween SEEDS the tracked fraction from the intent.from synchronously (R6 — from no longer dropped)', async () => {
    // R6: tweenBar used to ignore the intent's explicit `from` and tween from the fill's CURRENT
    // width, updating .fraction only onComplete. The fix seeds the fill width + tracked fraction from
    // `from` BEFORE tweening (synchronous), so introspection reflects `from` immediately rather than
    // the stale prior value (1.0 at t=0). The tween's interpolation itself is operator-verified (jsdom
    // does not advance Phaser tweens); the SEED is synchronous and gate-provable.
    const { game, scene } = await bootArena();
    activeGame = game;
    // t=0 the Boss bar (problemIntegrityBar) is full (fraction 1). A tween whose `from` is 0.5 must
    // immediately move the tracked fraction to 0.5 (the seed) — proving the explicit `from` is used.
    scene.playAnimations([
      { target: 'problemIntegrityBar', anim: 'bar-tween', durationMs: 300, from: 0.5, to: 0.9, repeat: null },
    ]);
    expect(scene.barFraction('problemIntegrityBar')).toBeCloseTo(0.5, 10);
  });

  it('overlapping staggers do NOT corrupt the Forgemaiden restore target — tint caches the base color once (R5)', async () => {
    // R5: tint() used to read `original = display.fillColor` at tint-time and restore to it. A second
    // stagger firing before the first restored would capture the ALREADY-RED color as "original" and
    // restore to red, stranding the Forgemaiden tinted. The fix caches the TRUE base color once at
    // create time and always restores to that. We boot with an EMPTY manifest so the Forgemaiden is a
    // placeholder Rectangle (tint() acts on fillColor; with the default manifest it bakes to an Image
    // where tint() is a no-op). The timer-based RESTORE itself is operator-verified (jsdom does not
    // fire delayedCall — verified), so this pins the regression's ROOT: the restore TARGET (the cached
    // base) is immutable across overlapping staggers — it never becomes the live tinted color.
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    const base = scene.forgemaidenBaseColor();
    expect(base).not.toBeNull(); // the placeholder Rectangle's fillColor, captured once at create time

    // First stagger: the tint applies (the live fill is now the red tint, no longer the base).
    scene.playAnimations([{ target: 'forgemaiden', anim: 'stagger', durationMs: 320, from: null, to: null, repeat: null }]);
    expect(scene.forgemaidenFillColor()).not.toBe(base);
    // Second OVERLAPPING stagger (before the first's delayedCall restore could run). The OLD code
    // would now capture the red live color as the new "original"; the fix ignores the live color.
    scene.playAnimations([{ target: 'forgemaiden', anim: 'stagger', durationMs: 320, from: null, to: null, repeat: null }]);

    // The cached base the restores will use is STILL the original — the overlapping stagger did NOT
    // capture the tinted color as the new restore target (the exact R5 corruption that stranded it red).
    expect(scene.forgemaidenBaseColor()).toBe(base);
  });
});
