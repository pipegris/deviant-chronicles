// Namespace import: Phaser 4's ESM build has no default export (verified) — `import Phaser` would be
// undefined. This is the ONLY file (besides the scene/textures) that touches Phaser.Game config.
import * as Phaser from 'phaser';
import type { BattleState, Beat } from '../../schema/battle-timeline';
import type { RenderPort } from '../render-port';
import { planAnimations } from '../animation-plan';
import { ArenaScene } from './arena-scene';
import { DEFAULT_ASSET_MANIFEST } from './placeholder-textures';

// phaser-render-adapter — the Phaser implementation of the one-way RenderPort (AC1). It owns a
// Phaser.Game running the ArenaScene and is the SWAP POINT: a future PixiJS adapter would implement
// this SAME RenderPort and nothing upstream would change (R5). Its public surface speaks ONLY
// BattleState + void (the RenderPort shape) — NO Phaser type leaks out, so callers never couple to
// Phaser. [architecture.md#Frontend Architecture L196-197; #R5 L239-241]

export class PhaserRenderAdapter implements RenderPort {
  private game: Phaser.Game | null = null;
  private readonly parent: string;
  private readonly manifest: Record<string, string>;
  // The renderer type passed to Phaser.Game. Defaults to Phaser.AUTO (Canvas/WebGL in the browser).
  // A test can inject Phaser.HEADLESS (=3, a plain number) to boot the adapter under jsdom without a
  // GPU/canvas — this is a numeric Phaser config value, NOT a Phaser TYPE on the public RenderPort
  // surface (the init/render/destroy methods still speak only BattleState + void, AC1 intact).
  private readonly rendererType: number;
  // The latest snapshot handed to render() before the scene's create() has run. Phaser boots
  // asynchronously (it waits on the Texture Manager READY), so a render() that arrives during boot is
  // buffered and flushed once the Arena scene exists — the snapshot is never dropped, never queued
  // beyond the latest (only the most recent frame matters for a snapshot renderer).
  private pending: BattleState | null = null;
  private ready = false;

  constructor(
    parent: string = 'game-container',
    manifest: Record<string, string> = DEFAULT_ASSET_MANIFEST,
    rendererType: number = Phaser.AUTO,
  ) {
    this.parent = parent;
    this.manifest = manifest;
    this.rendererType = rendererType;
  }

  // Boot the Phaser game with the Arena scene. The scene receives the manifest via its init() data.
  // Once the scene's create() has run (CREATE event) we flush any snapshot buffered during boot.
  init(): void {
    if (this.game) return; // idempotent — already booted
    this.game = new Phaser.Game({
      type: this.rendererType,
      width: 1024,
      height: 768,
      parent: this.parent,
      backgroundColor: '#1a1a2e',
      scene: ArenaScene,
      banner: false,
      callbacks: {
        postBoot: (game) => {
          const scene = game.scene.getScene('Arena') as ArenaScene;
          // Phaser emits GameEvents.READY (which runs the SceneManager bootQueue -> the Arena scene's
          // init/create) BEFORE it calls postBoot (game.esm: texturesReady emits READY then start() ->
          // postBoot). So by here the scene's create() has usually ALREADY run (status RUNNING) and a
          // one-shot CREATE listener attached now would NEVER fire -> ready would stick false and every
          // render() would buffer forever (playback never reaches the arena). Detect the already-created
          // case via scene.isActive and mark ready immediately; otherwise fall back to the CREATE event
          // for any path where create() is still deferred.
          if (game.scene.isActive('Arena')) {
            this.markReadyAndFlush(scene);
          } else {
            scene.events.once(Phaser.Scenes.Events.CREATE, () => this.markReadyAndFlush(scene));
          }
        },
      },
    });
    // Hand the manifest to the auto-started Arena scene (Phaser starts a single configured scene).
    this.game.scene.start('Arena', { manifest: this.manifest });
  }

  // The one-way command: draw the immutable snapshot. Forwarded to the live ArenaScene.applySnapshot;
  // if the scene is not yet created (still booting), buffer the latest snapshot for the postBoot flush.
  // Returns void — nothing flows back upstream (AC1).
  render(snapshot: BattleState): void {
    // render() before init(): the game never boots, so a buffered snapshot would be flushed by NO
    // callback and silently dropped (the RenderPort contract permits render-any-time, so this is a
    // real fail-silent path, not dead code). No-op with a warning instead — init() must precede render.
    if (!this.game) {
      console.warn('PhaserRenderAdapter.render() called before init(); snapshot ignored. Call init() first.');
      return;
    }
    const scene = this.ready ? (this.game.scene.getScene('Arena') as ArenaScene | undefined) : undefined;
    if (scene) {
      this.applyTo(scene, snapshot);
    } else {
      this.pending = snapshot; // still booting — the postBoot CREATE handler flushes the latest snapshot
    }
  }

  // The one-way ANIMATED command (Story 2.4): run the TRANSITION prev->next. Computes the intent
  // list via the PURE planAnimations (zero Phaser in that layer) and forwards it to the live scene's
  // playAnimations. If the scene is still booting, buffer the `next` snapshot for the snap-flush —
  // animations are PRESENTATION (the static state for `next` is the truth); snapping the latest
  // state during boot is the correct fail-closed behavior (never drop the state, never queue motion
  // that would play stale once boot finishes). Returns void — nothing flows back upstream (AC1).
  renderTransition(prev: BattleState, next: BattleState, beats: Beat[]): void {
    if (!this.game) {
      console.warn('PhaserRenderAdapter.renderTransition() called before init(); transition ignored. Call init() first.');
      return;
    }
    const scene = this.ready ? (this.game.scene.getScene('Arena') as ArenaScene | undefined) : undefined;
    if (scene) {
      // Compute intents render-side (pure) and run them; the next snapshot is implied by the tweens.
      scene.playAnimations(planAnimations(prev, next, beats));
    } else {
      this.pending = next; // still booting — the postBoot flush snaps the latest state (no motion)
    }
  }

  destroy(): void {
    this.game?.destroy(true);
    this.game = null;
    this.ready = false;
    this.pending = null;
  }

  private applyTo(scene: ArenaScene, snapshot: BattleState): void {
    scene.applySnapshot(snapshot);
  }

  // Mark the scene ready and flush the latest snapshot buffered during boot (if any). Called once the
  // Arena scene's create() has run — either already (isActive at postBoot) or via the CREATE fallback.
  private markReadyAndFlush(scene: ArenaScene): void {
    this.ready = true;
    if (this.pending) {
      this.applyTo(scene, this.pending);
      this.pending = null;
    }
  }

  // ---- test introspection (NOT part of the RenderPort surface) — lets the adapter test assert the
  // single-create / pending-flush / idempotency behavior under Phaser.HEADLESS. These return only
  // a boolean / a render/-internal ArenaScene, so no Phaser TYPE crosses the one-way seam to an
  // upstream caller (callers hold the RenderPort interface, which is unchanged). [F2 coverage] ----

  // True once the Arena scene's create() has run (the postBoot CREATE flush fired).
  isReady(): boolean {
    return this.ready;
  }

  // The live Arena scene once booted (null before CREATE) — the test reads its tracked bar fraction.
  sceneForTest(): ArenaScene | null {
    return this.ready ? (this.game?.scene.getScene('Arena') as ArenaScene) : null;
  }
}
