// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
// Phaser 4.0.0's ESM build exposes ONLY named exports (no default) — a namespace import is the
// correct form (verified in arena-scene.test.ts against node_modules/phaser/dist/phaser.esm.js).
import * as Phaser from 'phaser';

// RED-PHASE acceptance test for Story 4.3 (Task 3 + Task 5) — the HEADLESS Phaser SMOKE for the
// always-on teaching banner, the sibling of arena-cinematic.test.ts. It FAILS until ArenaScene exposes
// `renderTeaching(ops: TeachingOp[])` (the create-once teaching band + the delayedCall auto-dismiss
// arm), the PhaserRenderAdapter forwards `renderTeaching` to the scene, and src/portal/teaching.ts
// exports the `TeachingOp` type (the import of which is itself part of the intended RED).
//
// What this smoke proves (the gate-provable half — NOT pixels):
//   - renderTeaching([... a `teach` op ...]) RUNS without throwing under Phaser.HEADLESS (the band is
//     created once in create(), mutated in place, and the dismiss timer armed),
//   - renderTeaching([]) is a fail-closed no-op (an empty op list never throws),
//   - a SECOND teach op replaces the first cleanly (the latest beat's line shows; no throw).
//
// VERIFICATION LIMITATION (recorded verbatim, the SAME documented gap as arena-cinematic.test.ts L25-32):
// jsdom lacks a real canvas/rAF and does NOT advance Phaser timers/tweens, so the on-screen PLACEMENT
// (the band not covering the spectacle / not colliding with the Tolkien caption band), the LEGIBILITY of
// the plain-dev line, and the auto-dismiss TIMING FEEL are OPERATOR-verified by watching `pnpm dev`. The
// delayedCall fires on the Scene clock which jsdom never advances, so this smoke proves the RUN (no throw)
// + the band create-once, never the dismiss firing. The pure teaching.test.ts (node) is the load-bearing
// data proof (the op carries a finite dwellMs); this smoke is the runs-without-throwing-under-Phaser guard.
import { ArenaScene } from './arena-scene';
import { PhaserRenderAdapter } from './phaser-render-adapter';
import type { TeachingOp } from '../../portal/teaching';

// A well-formed teach op (the shape planTeaching emits): a fixed plain-dev line + a finite dwell + the
// Layer-0 grounding provenance. The scene sets the band text + arms a delayedCall(dwellMs, hide).
const TEACH_OP: TeachingOp = {
  kind: 'teach',
  beatType: 'shaman',
  text: 'The whole bug class died at once — that\'s fixing the root cause, not the symptoms.',
  cursor: 9,
  dwellMs: 4000,
  groundingRefs: ['u-0009#0', 'u-0010#0'],
};

const TEACH_OP_2: TeachingOp = {
  kind: 'teach',
  beatType: 'dispel',
  text: 'The agent assumed, then read the code to check — and dropped the wrong assumption.',
  cursor: 1,
  dwellMs: 4000,
  groundingRefs: ['u-0002#1'],
};

// Boot a HEADLESS game and resolve once the Arena scene's create() has run (copied verbatim from
// arena-cinematic.test.ts L66-86 — the proven boot pattern; audio.noAudio + banner:false keep Phaser
// from probing browser APIs jsdom lacks). An EMPTY manifest forces the texture-missing placeholder path.
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
let adapter: PhaserRenderAdapter | undefined;

afterEach(() => {
  activeGame?.destroy(true);
  activeGame = undefined;
  adapter?.destroy();
  adapter = undefined;
  document.getElementById('game-container')?.remove();
});

describe('Story 4.3 — ArenaScene.renderTeaching runs under Phaser.HEADLESS without throwing', () => {
  it('renderTeaching([... a teach op ...]) does NOT throw (the band is set + the auto-dismiss timer armed)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    expect(() => scene.renderTeaching([TEACH_OP])).not.toThrow();
  });

  it('renderTeaching([]) is a fail-closed no-op (empty op list never throws)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    expect(() => scene.renderTeaching([])).not.toThrow();
  });

  it('a SECOND teach op replaces the first cleanly (latest beat line shows; no throw)', async () => {
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    scene.renderTeaching([TEACH_OP]);
    expect(() => scene.renderTeaching([TEACH_OP_2])).not.toThrow();
  });

  it('a MULTI-op transition arms ONE auto-dismiss for the LAST op, not one per op (last-op-wins, review F3)', async () => {
    // planTeaching can emit >1 op in one transition (a breakthrough co-firing dispel + summon — proven
    // valid in teaching.unit.test.ts). The single shared band can only show one line, so renderTeaching
    // must display the LAST op and arm exactly ONE dismiss timer for it — NOT iterate every op
    // (set-then-overwrite the earlier line for ~0ms and arm-then-cancel a timer per op). Spy on the Scene
    // clock: the old per-op loop called delayedCall once PER op (2x here, churning the first); the fix
    // calls it ONCE, with the LAST op's dwell. RED on the loop, GREEN on last-op-wins. (Internal access
    // mirrors the arena-shaman-dispel-cinematic.test.ts `scene as unknown as {...}` posture.)
    const { game, scene } = await bootArena({ manifest: {} });
    activeGame = game;
    const internals = scene as unknown as {
      time: { delayedCall: (ms: number, cb: () => void) => unknown };
      teachingText: { text: string; visible: boolean } | null;
    };
    const delayedCall = vi.spyOn(internals.time, 'delayedCall');
    scene.renderTeaching([TEACH_OP, TEACH_OP_2]);
    expect(delayedCall).toHaveBeenCalledTimes(1); // ONE timer armed, not one per op
    expect(delayedCall.mock.calls[0]![0]).toBe(TEACH_OP_2.dwellMs); // armed for the LAST op
    expect(internals.teachingText?.text).toBe(TEACH_OP_2.text); // the band shows the LAST op
    expect(internals.teachingText?.visible).toBe(true);
  });
});

describe('Story 4.3 — PhaserRenderAdapter.renderTeaching forwards to the scene without throwing', () => {
  it('the adapter implements renderTeaching and forwarding it before init() warns-not-throws (the ready-guard precedent)', () => {
    // The adapter forwards renderTeaching to the scene guarded on this.ready (the renderCaptions
    // precedent). Called before the scene boots, it must NOT throw (a safe no-op / warn) — exactly the
    // backward-compatible one-way command posture.
    const div = document.createElement('div');
    div.id = 'game-container';
    document.body.appendChild(div);
    adapter = new PhaserRenderAdapter('game-container', undefined, Phaser.HEADLESS);
    expect(() => adapter!.renderTeaching([TEACH_OP])).not.toThrow();
  });
});
