// Phaser 4.0.0's ESM build exposes only NAMED exports (no default), so a namespace import is the
// correct form to reach Phaser.Scene / Phaser.GameObjects (a `import Phaser from 'phaser'` default
// resolves to undefined under this bundler — verified). The template scenes use named imports too.
import * as Phaser from 'phaser';
import type { BattleState } from '../../schema/battle-timeline';
import type { EntityKind, RenderEntity } from '../render-model';
import type { AnimationIntent } from '../animation-plan';
import type { BeatBehaviorIntent } from '../beat-behavior';
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
// baseColor is the entity's TRUE resting fill color captured once at create time (null for an Image,
// which has no fillColor). tint() restores to THIS, not the live fillColor, so overlapping staggers
// can't capture an already-tinted color and leave the entity stuck red. [review R5]
type SceneEntity = {
  kind: EntityKind;
  display: Phaser.GameObjects.GameObject;
  bar: HealthBar | null;
  baseColor: number | null;
};

export class ArenaScene extends Phaser.Scene {
  // The asset manifest (logical kind -> texture key). Defaults to the placeholder manifest; the boot
  // can pass ReplayBundle.assetManifest later. Set via init() data or the constructor default.
  private manifest: Record<string, string> = DEFAULT_ASSET_MANIFEST;
  private readonly entities = new Map<string, SceneEntity>();
  private insightGauge: HealthBar | null = null;
  // The last intent list playAnimations() ran — the headless smoke reads this (mirroring Story 2.3's
  // entityKinds()/bossBarFraction() introspection) to assert the animated path was exercised, not
  // silently skipped. No pixels are inspected; HEADLESS draws nothing.
  private lastPlayed: AnimationIntent[] = [];

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
      // Capture the TRUE resting fill color once (a Rectangle has fillColor; an Image does not -> null)
      // so tint() always restores to this, never to a possibly-already-tinted live color. [review R5]
      const fillColor = (display as unknown as { fillColor?: number }).fillColor;
      this.entities.set(entity.id, {
        kind: entity.kind,
        display,
        bar,
        baseColor: fillColor != null ? fillColor : null,
      });
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
    // The held-victory frame: applySnapshot SNAPS to the static state (used for seek/scrub). The
    // death/victory MOTION is the animated path's job (playAnimations runs a Boss death tween from
    // the defeating transition). The snap path stays purely static — you cannot tween across a jump.
  }

  // playAnimations — the NEW animated path (Story 2.4) the adapter's renderTransition forwards. Runs
  // a Phaser tween / sprite-anim per intent on the placeholder display objects. Forward playback
  // animates via this; seek/scrub still SNAPS via applySnapshot (you cannot tween across a jump, so
  // the snap path stays). Additive to the Story 2.3 surface — applySnapshot is untouched. Never
  // throws on a well-formed intent list; an unknown anim/target is a safe no-op (fail-closed). With
  // PLACEHOLDER art these are tweens/tints on the placeholder rects (real sprite-sheet frames arrive
  // with final art, Story 5.3); this story builds the animation STATE MACHINE + the runner.
  playAnimations(intents: AnimationIntent[]): void {
    // Copy the caller's array (intents are immutable plain data everywhere else; a later caller
    // mutation must not retroactively change lastPlayedIntents()). [review R4]
    this.lastPlayed = [...intents];
    for (const intent of intents) {
      this.runIntent(intent);
    }
  }

  // playBeatBehaviors — the BEHAVIOR path (Story 3.3) the adapter's renderBeatBehaviors forwards (a
  // sibling to playAnimations). Runs a PLACEHOLDER tween/tint per BeatBehaviorIntent on the existing
  // cast — the polished full-scene cinematics (THUNDORR cutaway, glass-break+record-scratch shatter,
  // simultaneous-imp-death wave) are Stories 3.4/3.5, NOT built here. Never throws on a well-formed
  // intent list; an unknown behavior/target is a safe no-op (fail-closed, exactly runIntent's posture).
  // [story Task 3 "PLACEHOLDER on the existing cast"]
  playBeatBehaviors(intents: BeatBehaviorIntent[]): void {
    for (const intent of intents) {
      this.runBehavior(intent);
    }
  }

  // ---- smoke-test introspection (no pixels) — let the headless boot assert the cast/bars/gauge ----

  // The intent list the last playAnimations() ran (the animated-path analogue of bossBarFraction()).
  lastPlayedIntents(): AnimationIntent[] {
    return this.lastPlayed;
  }

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

  // The tracked fraction of an arbitrary bar/gauge target — lets the smoke assert tweenBar SEEDED the
  // fraction from the intent's `from` synchronously (R6) without inspecting pixels or stepping the
  // tween clock (jsdom does not advance Phaser timers/tweens — a documented operator-verified gap).
  barFraction(target: AnimationIntent['target']): number {
    return this.barFor(target)?.fraction ?? 0;
  }

  // The Forgemaiden's cached base fill color and its live fill color — lets the smoke assert tint()
  // restores to the IMMUTABLE captured base, not a moving live color, so overlapping staggers can't
  // strand it tinted (R5). (The timer-based restore itself is operator-verified — jsdom does not fire
  // delayedCall — so the regression guard pins the immutable restore TARGET instead.)
  forgemaidenBaseColor(): number | null {
    return [...this.entities.values()].find((e) => e.kind === 'forgemaiden')?.baseColor ?? null;
  }

  forgemaidenFillColor(): number | null {
    const display = [...this.entities.values()].find((e) => e.kind === 'forgemaiden')?.display as
      | { fillColor?: number }
      | undefined;
    return display?.fillColor != null ? display.fillColor : null;
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

  // ---- the intent runner (Story 2.4): one tween/sprite-anim per AnimationIntent ----

  // Run a single intent on the placeholder display objects. A target/anim with no created object (a
  // minion cue, or a future anim) is a safe no-op — never throws (fail-closed). Tweens drive
  // Phaser's tween manager (render-side wall-clock — the existing rAF-loop precedent; feeds NOTHING
  // upstream, R5). With placeholder rects these are positional lunges / tints / width tweens.
  private runIntent(intent: AnimationIntent): void {
    switch (intent.anim) {
      case 'forge-strike':
        this.lunge('forgemaiden', intent.durationMs, 1);
        return;
      case 'hammer-flurry':
        // A burst of quick sub-lunges: repeat the short lunge `repeat` times (the multi-strike).
        // The shorter per-strike duration (from the intent) reads as visibly faster than a single
        // forge-strike — the "Hammer Flurry" (the visual reading is operator-verified).
        this.lunge('forgemaiden', intent.durationMs, Math.max(1, intent.repeat ?? 1));
        return;
      case 'cast':
        this.flash('forgemaiden', intent.durationMs);
        return;
      case 'stagger':
        // The recoil/failure read: a backward knockback + a red tint. The struggle, not defeat.
        this.lunge('forgemaiden', intent.durationMs, 1, -1);
        this.tint('forgemaiden', 0xff5555, intent.durationMs);
        return;
      case 'rise':
        // The get-back-up: a forward recovery lunge (defiance — struggle turns to power as the gauge
        // charges; the gauge-tween intent animates the charge alongside this).
        this.lunge('forgemaiden', intent.durationMs, 1);
        return;
      case 'hit':
        this.flash(intent.target, intent.durationMs);
        return;
      case 'death':
        this.fadeOut(intent.target, intent.durationMs);
        return;
      case 'aether-storm':
        this.environmentOverlay(intent.durationMs);
        return;
      case 'bar-tween':
      case 'gauge-tween':
        if (intent.to != null) this.tweenBar(intent.target, intent.from ?? null, intent.to, intent.durationMs);
        return;
      case 'idle':
        // The held/resting pose — no motion to run for the placeholder rect.
        return;
      default:
        return;
    }
  }

  // ---- the behavior runner (Story 3.3): one placeholder tween/tint per BeatBehaviorIntent ----

  // Run a single behavior intent on the PLACEHOLDER cast. The signature-beat targets (imp/shaman/
  // mirage/eidolon) have no dedicated display object in v0.1, so they reuse the existing cast as a
  // placeholder via behaviorTarget(): imp -> minion, shaman/eidolon/boss -> boss, mirage -> minion,
  // forgemaiden -> forgemaiden. A target with no resolved object is a safe no-op (the lunge/flash/
  // fadeOut helpers already guard a null display), so an unknown behavior/target never throws
  // (fail-closed). The polished cinematics are Stories 3.4/3.5. [story Task 3]
  private runBehavior(intent: BeatBehaviorIntent): void {
    const target = this.behaviorTarget(intent.target);
    switch (intent.behavior) {
      case 'resurrect':
        // A symptom-imp rises again (placeholder fade/flash on the minion).
        this.flash(target, intent.durationMs);
        return;
      case 'swarm-clear':
        // All imps die in one wave (placeholder fade-out on the minion stand-in).
        this.fadeOut(target, intent.durationMs);
        return;
      case 'defeat':
        // The Shaman (root cause) falls (placeholder fade-out on the boss stand-in).
        this.fadeOut(target, intent.durationMs);
        return;
      case 'shatter':
        // The Mirage shatters (placeholder quick tint+lunge on the stand-in).
        this.lunge(target, intent.durationMs, 1);
        this.tint(target, 0x88ccff, intent.durationMs);
        return;
      case 'resolve-stagger':
        // The Hero's self-inflicted recoil CUE — reuse the existing stagger recoil (backward lunge +
        // red tint). A PRESENTATION cue only; NO Resolve mutation (R1 — the bar moved from Layer-0).
        this.lunge(target, intent.durationMs, 1, -1);
        this.tint(target, 0xff5555, intent.durationMs);
        return;
      case 'reveal':
        // The real situation is revealed (placeholder flash on the stand-in).
        this.flash(target, intent.durationMs);
        return;
      case 'summon':
        // The Eidolon (THUNDORR) is summoned (placeholder flash on the boss stand-in).
        this.flash(target, intent.durationMs);
        return;
      case 'decisive-blow':
        // The decisive blow dramatizing the breakthrough's integrity damage (placeholder lunge).
        this.lunge(target, intent.durationMs, 1);
        return;
      default:
        return;
    }
  }

  // Map a BeatBehaviorIntent target to an existing-cast AnimTarget the placeholder helpers understand.
  // The signature-beat creatures have no v0.1 display object; they reuse the placeholder cast until the
  // 3.4/3.5 cinematics add dedicated objects. An unmapped target resolves to a kind the helpers no-op on.
  private behaviorTarget(target: BeatBehaviorIntent['target']): AnimationIntent['target'] {
    switch (target) {
      case 'forgemaiden':
        return 'forgemaiden';
      case 'shaman':
      case 'eidolon':
      case 'boss':
        return 'boss';
      case 'imp':
      case 'mirage':
        return 'minion';
      default:
        return 'minion';
    }
  }

  // The transformable shape Image/Rectangle both mix in (Components.Transform). The narrow is the
  // same cast positionDisplay uses — Phaser's GameObject base type omits x/y which the concrete
  // Image/Rectangle have.
  private displayOf(target: AnimationIntent['target']): { x: number; y: number; alpha?: number } | null {
    // Map an intent target to a created entity. Bar/gauge/environment targets have no entity object.
    const kind: EntityKind | null =
      target === 'forgemaiden' ? 'forgemaiden' : target === 'boss' ? 'boss' : target === 'minion' ? 'minion' : null;
    if (!kind) return null;
    const entity = [...this.entities.values()].find((e) => e.kind === kind);
    return entity ? (entity.display as unknown as { x: number; y: number; alpha?: number }) : null;
  }

  // A quick positional lunge (the strike motion): tween x forward (dir * 24px) and back via yoyo,
  // repeating `count-1` extra times (so a flurry fires `count` quick strikes). Guarded — if the
  // tween manager is unavailable (defensive) the call is a no-op rather than a throw.
  private lunge(target: AnimationIntent['target'], durationMs: number, count: number, dir = 1): void {
    const display = this.displayOf(target);
    if (!display) return;
    const baseX = display.x;
    this.tweens?.add({
      targets: display,
      x: baseX + dir * 24,
      duration: Math.max(1, durationMs / 2),
      yoyo: true,
      repeat: count - 1,
      onComplete: () => {
        display.x = baseX; // settle back to the resting position
      },
    });
  }

  // A brief alpha flash (cast pose / enemy hit): dip alpha and restore via yoyo.
  private flash(target: AnimationIntent['target'], durationMs: number): void {
    const display = this.displayOf(target);
    if (!display) return;
    this.tweens?.add({
      targets: display,
      alpha: 0.4,
      duration: Math.max(1, durationMs / 2),
      yoyo: true,
    });
  }

  // A transient tint on the display object (stagger recoil). Rectangles/Images expose setFillStyle/
  // setTint differently; we set it best-effort and clear after the duration — guarded so an object
  // lacking the method is a no-op. Restores to the entity's cached baseColor (captured at create
  // time), NOT the live fillColor — so a second overlapping stagger can't capture an already-red
  // color and leave the entity stuck tinted. [review R5]
  private tint(target: AnimationIntent['target'], color: number, durationMs: number): void {
    const entity = [...this.entities.values()].find(
      (e) => e.kind === (target === 'forgemaiden' ? 'forgemaiden' : target === 'boss' ? 'boss' : 'minion'),
    );
    if (!entity || entity.baseColor == null) return;
    const display = entity.display as unknown as { setFillStyle?: (c: number) => void };
    if (display.setFillStyle) {
      const baseColor = entity.baseColor;
      display.setFillStyle(color);
      this.time?.delayedCall(durationMs, () => {
        display.setFillStyle?.(baseColor);
      });
    }
  }

  // The Boss death: fade the display object to alpha 0 (a topple/fade). No yoyo — it stays faded.
  private fadeOut(target: AnimationIntent['target'], durationMs: number): void {
    const display = this.displayOf(target);
    if (!display) return;
    this.tweens?.add({ targets: display, alpha: 0, duration: Math.max(1, durationMs) });
  }

  // The Aether Storm: a distinct full-screen environmental overlay (a tint rect that fades in and
  // out). Created lazily on first use and reused. Drawn behind nothing in particular — it is the
  // scene-global environmental visual (AC3). Guarded for the headless env (add.rectangle exists).
  private environmentOverlay(durationMs: number): void {
    const overlay = this.add?.rectangle(512, 384, 1024, 768, 0x4422aa, 0.0);
    if (!overlay) return;
    this.tweens?.add({
      targets: overlay,
      alpha: 0.35,
      duration: Math.max(1, durationMs / 2),
      yoyo: true,
      onComplete: () => overlay.destroy(),
    });
  }

  // Tween a bar/gauge fill width from `fromFraction` to `toFraction` (* fullWidth) (Story 2.3
  // SNAPPED; this ANIMATES). The pure layer carries an explicit `from`; we SEED the fill width (and
  // tracked `.fraction`) from it before tweening so the tween starts at the intended fraction (not a
  // possibly-stale current width), and update `.fraction` on every step via onUpdate so introspection
  // tracks the LIVE value rather than lagging until onComplete. A null `from` (older callers) keeps
  // the live width as the start. [review R6]
  private tweenBar(
    target: AnimationIntent['target'],
    fromFraction: number | null,
    toFraction: number,
    durationMs: number,
  ): void {
    const bar = this.barFor(target);
    if (!bar) return;
    const fullWidth = bar === this.insightGauge ? GAUGE_WIDTH : BAR_WIDTH;
    if (fromFraction != null) {
      bar.fill.width = fullWidth * fromFraction;
      bar.fraction = fromFraction;
    }
    this.tweens?.add({
      targets: bar.fill,
      width: fullWidth * toFraction,
      duration: Math.max(1, durationMs),
      onUpdate: () => {
        bar.fraction = bar.fill.width / fullWidth;
      },
      onComplete: () => {
        bar.fraction = toFraction;
      },
    });
  }

  // Resolve a bar/gauge intent target to the tracked HealthBar: resolveBar -> the Forgemaiden's bar
  // (her health bar IS Resolve, render-model.ts), problemIntegrityBar -> the Boss bar, insightGauge
  // -> the gauge widget. Returns null for a target with no bar (a creature target).
  private barFor(target: AnimationIntent['target']): HealthBar | null {
    if (target === 'insightGauge') return this.insightGauge;
    const kind: EntityKind | null =
      target === 'resolveBar' ? 'forgemaiden' : target === 'problemIntegrityBar' ? 'boss' : null;
    if (!kind) return null;
    const entity = [...this.entities.values()].find((e) => e.kind === kind);
    return entity?.bar ?? null;
  }
}
