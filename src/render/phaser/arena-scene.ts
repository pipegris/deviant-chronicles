// Phaser 4.0.0's ESM build exposes only NAMED exports (no default), so a namespace import is the
// correct form to reach Phaser.Scene / Phaser.GameObjects (a `import Phaser from 'phaser'` default
// resolves to undefined under this bundler — verified). The template scenes use named imports too.
import * as Phaser from 'phaser';
import type { BattleState } from '../../schema/battle-timeline';
import type { EntityKind, RenderEntity } from '../render-model';
import { toRenderModel } from '../render-model';
import { initialBattleState } from '../../model/battle-model';
import {
  DEFAULT_ASSET_MANIFEST,
  generatePlaceholderTextures,
  placeholderSpec,
} from './placeholder-textures';

// arena-scene — the Phaser arena scene (key 'Arena'). A THIN consumer of the PURE RenderModel: it
// creates the placeholder cast (Forgemaiden, Boss, >=1 Minion) ONCE in create(), then mutates those
// display objects in place on applySnapshot() — it does NOT recreate game objects per frame. Reading
// a fraction off the immutable snapshot and setting a bar width feeds NOTHING upstream (one-way, AC1).
// Updating Phaser display objects in place is the renderer's internal mutable state and is allowed —
// R2 purity binds Layer-0 only, NOT render/. The scene reads ONLY the RenderModel (no beatType /
// annotation — that is Layer 1, Epic 3; no raw JSONL — R3). [story Task 4; architecture.md#R2/R5]

const BAR_WIDTH = 80;
const BAR_HEIGHT = 8;
const BAR_BG = 0x222222;
const BAR_FILL = 0x66bb6a;
const GAUGE_WIDTH = 300;
const GAUGE_HEIGHT = 16;
const GAUGE_BG = 0x222222;
const GAUGE_FILL = 0xffd54f;

// A health bar = a background rect + a fill rect whose width tracks the entity's hpFraction. Tracking
// `fraction` on the object lets the headless smoke assert the update without inspecting pixels.
type HealthBar = {
  bg: Phaser.GameObjects.Rectangle;
  fill: Phaser.GameObjects.Rectangle;
  fraction: number;
};

// A created entity: its sprite/rectangle display object plus an optional health bar. Minions get no
// bar in v0.1 (AC2's minimum is Forgemaiden + Boss bars). Keyed by id in the scene's entities map.
type SceneEntity = {
  kind: EntityKind;
  display: Phaser.GameObjects.GameObject;
  bar: HealthBar | null;
};

export class ArenaScene extends Phaser.Scene {
  // The asset manifest (logical kind -> texture key). Defaults to the placeholder manifest; the boot
  // can pass ReplayBundle.assetManifest later. Set via init() data or the constructor default.
  private manifest: Record<string, string> = DEFAULT_ASSET_MANIFEST;
  private readonly entities = new Map<string, SceneEntity>();
  private insightGauge: HealthBar | null = null;

  constructor() {
    super('Arena');
  }

  // Phaser passes scene-start data here; allow an optional manifest override (the boot/adapter may
  // hand in ReplayBundle.assetManifest). Falls back to the default placeholder manifest.
  init(data?: { manifest?: Record<string, string> }): void {
    if (data?.manifest) this.manifest = data.manifest;
  }

  create(): void {
    generatePlaceholderTextures(this, this.manifest);

    // Build the initial cast from the t=0 model (full bars). Forgemaiden + Boss get health bars; the
    // minion gets a display object only. create-ONCE — applySnapshot mutates these in place. The t=0
    // snapshot comes from initialBattleState() (the canonical Layer-0 t=0, config-driven) so the seed
    // tracks model-tuning instead of an inlined literal. render -> model import is allowed.
    const initial = toRenderModel(initialBattleState());
    for (const entity of initial.entities) {
      const display = this.createDisplay(entity);
      const bar = entity.kind === 'minion' ? null : this.createHealthBar(entity);
      this.entities.set(entity.id, { kind: entity.kind, display, bar });
    }

    // The Insight Gauge widget (scene-global): a labelled bar near the bottom-center of the stage.
    this.insightGauge = this.createGauge(initial.insightGauge);
  }

  // applySnapshot — the one-way command the adapter's render() forwards. Compute the RenderModel from
  // the immutable snapshot and UPDATE the existing display objects/bars/gauge in place. Never throws
  // on a well-formed snapshot; never recreates objects. [story Task 4]
  applySnapshot(snapshot: BattleState): void {
    const model = toRenderModel(snapshot);
    for (const entity of model.entities) {
      const sceneEntity = this.entities.get(entity.id);
      if (!sceneEntity) continue; // an entity not created at boot (shouldn't happen for v0.1's fixed cast)
      this.positionDisplay(sceneEntity.display, entity);
      if (sceneEntity.bar) this.updateBar(sceneEntity.bar, entity.x, entity.y, entity.hpFraction);
    }
    if (this.insightGauge) this.setBarFraction(this.insightGauge, model.insightGauge);
    // model.victory is intentionally not drawn yet — the held-victory frame is Story 2.4.
  }

  // ---- smoke-test introspection (no pixels) — let the headless boot assert the cast/bars/gauge ----

  entityKinds(): EntityKind[] {
    return [...this.entities.values()].map((e) => e.kind);
  }

  hasHealthBar(kind: EntityKind): boolean {
    return [...this.entities.values()].some((e) => e.kind === kind && e.bar !== null);
  }

  hasInsightGauge(): boolean {
    return this.insightGauge !== null;
  }

  // The Boss bar's tracked fraction (1 at t=0, 0 on the defeating snapshot) — the smoke asserts this
  // updates after applySnapshot without inspecting pixels.
  bossBarFraction(): number {
    const boss = [...this.entities.values()].find((e) => e.kind === 'boss');
    return boss?.bar ? boss.bar.fraction : 0;
  }

  // ---- internals ----

  // Create the entity's display object: a sprite when the manifest texture baked successfully,
  // otherwise a colored Rectangle (the headless/jsdom fallback). Either way a game object exists, so
  // the cast is created and the smoke passes; the Rectangle matches the placeholder's color/size.
  private createDisplay(entity: RenderEntity): Phaser.GameObjects.GameObject {
    const key = this.manifest[entity.kind];
    if (key && this.textures.exists(key)) {
      return this.add.image(entity.x, entity.y, key);
    }
    const spec = placeholderSpec(entity.kind);
    return this.add.rectangle(entity.x, entity.y, spec.width, spec.height, spec.color);
  }

  private positionDisplay(display: Phaser.GameObjects.GameObject, entity: RenderEntity): void {
    // Image and Rectangle both mix in Components.Transform (x/y). Narrow to the transform shape.
    const transformable = display as unknown as { x: number; y: number };
    transformable.x = entity.x;
    transformable.y = entity.y;
  }

  // A health bar above the entity: a dark background rect + a green fill rect, both origin-left so the
  // fill shrinks from the right as hp drops. The fill width = fraction * BAR_WIDTH.
  private createHealthBar(entity: RenderEntity): HealthBar {
    const barX = entity.x - BAR_WIDTH / 2;
    const barY = entity.y - 70;
    const bg = this.add.rectangle(barX, barY, BAR_WIDTH, BAR_HEIGHT, BAR_BG).setOrigin(0, 0.5);
    const fill = this.add
      .rectangle(barX, barY, BAR_WIDTH * entity.hpFraction, BAR_HEIGHT, BAR_FILL)
      .setOrigin(0, 0.5);
    return { bg, fill, fraction: entity.hpFraction };
  }

  private updateBar(bar: HealthBar, x: number, y: number, fraction: number): void {
    const barX = x - BAR_WIDTH / 2;
    const barY = y - 70;
    bar.bg.setPosition(barX, barY);
    bar.fill.setPosition(barX, barY);
    this.setBarFraction(bar, fraction);
  }

  // The Insight Gauge widget: a labelled bar near bottom-center. Same bg+fill rect construction as a
  // health bar but full-width and amber, so it reads as the distinct gauge (not a health bar).
  private createGauge(fraction: number): HealthBar {
    const x = (1024 - GAUGE_WIDTH) / 2;
    const y = 720;
    const bg = this.add.rectangle(x, y, GAUGE_WIDTH, GAUGE_HEIGHT, GAUGE_BG).setOrigin(0, 0.5);
    const fill = this.add
      .rectangle(x, y, GAUGE_WIDTH * fraction, GAUGE_HEIGHT, GAUGE_FILL)
      .setOrigin(0, 0.5);
    this.add.text(x, y - 22, 'Insight Gauge', { fontSize: '14px', color: '#ffffff' });
    return { bg, fill, fraction };
  }

  // Set a bar/gauge fill width from a [0,1] fraction and record it (the smoke reads `.fraction`).
  private setBarFraction(bar: HealthBar, fraction: number): void {
    const fullWidth = bar === this.insightGauge ? GAUGE_WIDTH : BAR_WIDTH;
    bar.fill.width = fullWidth * fraction;
    bar.fraction = fraction;
  }
}
