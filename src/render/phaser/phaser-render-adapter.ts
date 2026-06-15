// Namespace import: Phaser 4's ESM build has no default export (verified) — `import Phaser` would be
// undefined. This is the ONLY file (besides the scene/textures) that touches Phaser.Game config.
import * as Phaser from 'phaser';
import type { BattleState, Beat } from '../../schema/battle-timeline';
import type { AnnotatedView } from '../../interpret/overlay';
import type { CaptionOp } from '../../scribe/captions';
import type { RenderPort } from '../render-port';
import { planAnimations } from '../animation-plan';
import { planBeatBehaviors } from '../beat-behavior';
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

  // The one-way BEHAVIOR command (Story 3.3): drive the signature-beat behaviors for prev->next reading
  // the read-only overlay. Computes the behavior INTENTS via the PURE planBeatBehaviors (zero Phaser in
  // that layer) and forwards them to the live scene's playBeatBehaviors (placeholder tweens; the 3.4/3.5
  // cinematics are deferred). The emitted SIGNALS are owned by the boot's sink (the boot recomputes them
  // from the same transition), so this command runs only the visual intents — nothing flows back
  // upstream (one-way, R5/AC1). If the scene is still booting, the behavior is dropped (the static `next`
  // snapshot is the truth; the boot snaps it via the pending flush) — never queue stale motion. Returns
  // void. [story Task 3]
  renderBeatBehaviors(prev: BattleState, next: BattleState, beats: Beat[], view: AnnotatedView): void {
    if (!this.game) {
      console.warn('PhaserRenderAdapter.renderBeatBehaviors() called before init(); behavior ignored. Call init() first.');
      return;
    }
    const scene = this.ready ? (this.game.scene.getScene('Arena') as ArenaScene | undefined) : undefined;
    if (scene) {
      // Thread `next` as the arm-snapshot so a cinematic that arms on this forward transition pins the
      // foldBattleState truth for the armed cursor as its clean-return snapshot — NOT the stale t=0 frame
      // (the forward tick never calls applySnapshot). [review H1]
      scene.playBeatBehaviors(planBeatBehaviors(prev, next, beats, view).intents, next);
    }
    // else: still booting — drop the behavior (presentation only; the next snapshot is snapped via the
    // existing pending flush). No buffering of motion that would play stale once boot finishes.
  }

  // The DEV-ONLY preview command (Story 3.4): drive the live scene's THUNDORR cinematic on demand so
  // the operator can watch it (main.ts gates this behind import.meta.env.DEV via ?cinematic=summon).
  // It plays the cinematic DIRECTLY by handing the scene a synthesized summon BeatBehaviorIntent — it
  // does NOT touch the read-only overlay / FixtureInterpreter (no fake `summon` annotation enters the
  // production path; the scene's playBeatBehaviors elevates the intent into the set-piece). The
  // snapshot the clean return restores is already captured by the scene (its last applySnapshot); the
  // boot also re-applies it via render() as the clean-return baseline. A no-op if the scene is still
  // booting (never throws). One-way — nothing flows back upstream (R5/AC1). [story Task 3]
  previewSummonCinematic(_snapshot: BattleState): void {
    void _snapshot; // the scene restores its own captured snapshot on `done`; the boot snaps the baseline
    const scene = this.ready ? (this.game?.scene.getScene('Arena') as ArenaScene | undefined) : undefined;
    if (scene) {
      scene.playBeatBehaviors([{ target: 'eidolon', behavior: 'summon', durationMs: 0 }]);
    }
  }

  // The DEV-ONLY preview commands (Story 3.5): drive the live scene's shaman swarm-clear / dispel
  // shatter cinematic on demand so the operator can RE-WATCH each set-piece without scrubbing to the
  // exact beat (UNLIKE 3.4's summon, these DO fire on the committed fixture during normal playback — so
  // these hooks are a replay-on-demand convenience, not the only path). main.ts gates them behind
  // import.meta.env.DEV via ?cinematic=shaman / ?cinematic=dispel (tree-shaken from prod). Each plays
  // the cinematic DIRECTLY by handing the scene the SAME production trigger intent — it does NOT touch
  // the read-only overlay / FixtureInterpreter (no fake annotation enters the production path). The
  // snapshot the clean return restores is already captured by the scene (its last applySnapshot); the
  // boot also re-applies it via render() as the clean-return baseline. A no-op if the scene is still
  // booting (never throws). One-way — nothing flows back upstream (R5/AC1). [story Task 4 §"dev-preview"]
  previewShamanCinematic(_snapshot: BattleState): void {
    void _snapshot; // the scene restores its own captured snapshot on `done`; the boot snaps the baseline
    const scene = this.ready ? (this.game?.scene.getScene('Arena') as ArenaScene | undefined) : undefined;
    if (scene) {
      scene.playBeatBehaviors([{ target: 'shaman', behavior: 'defeat', durationMs: 0 }]);
    }
  }

  previewDispelCinematic(_snapshot: BattleState): void {
    void _snapshot; // the scene restores its own captured snapshot on `done`; the boot snaps the baseline
    const scene = this.ready ? (this.game?.scene.getScene('Arena') as ArenaScene | undefined) : undefined;
    if (scene) {
      scene.playBeatBehaviors([{ target: 'mirage', behavior: 'shatter', durationMs: 0 }]);
    }
  }

  // The CAPTION command (Story 4.1, FR-9): draw the Scribe's caption ops on the live scene's caption
  // band. Forwarded to ArenaScene.renderCaptions (an `emit` shows an in-register caption; a `correct`
  // crosses out + rewrites the targeted prior caption — the Dispel honesty beat, coinciding with the
  // shatter cinematic's record-scratch). The caption SELECTION/text was decided in Layer 2 (scribe/
  // captions.ts); this only DISPLAYS it. A no-op if the scene is still booting (never throws). One-way
  // — nothing flows back upstream (R5/AC1). [story Task 5]
  renderCaptions(ops: CaptionOp[]): void {
    const scene = this.ready ? (this.game?.scene.getScene('Arena') as ArenaScene | undefined) : undefined;
    if (scene) scene.renderCaptions(ops);
    // else: still booting — captions are PRESENTATION; drop them (no upstream effect, the next snapshot
    // is the truth). Never buffer stale narration that would play out of sync once boot finishes.
  }

  // The read-only cinematic QUERY (Story 3.4 fix F1/F2): false before boot. The boot polls this so the
  // scene's cinematic machine is the single source of truth for the suspend-guard — letting the boot
  // resume the forward tick when the cutaway reaches `done`. [review F1/F2]
  isCinematicActive(): boolean {
    const scene = this.ready ? (this.game?.scene.getScene('Arena') as ArenaScene | undefined) : undefined;
    return scene ? scene.isCinematicActive() : false;
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
