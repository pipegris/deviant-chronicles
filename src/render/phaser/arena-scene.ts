// Phaser 4.0.0's ESM build exposes only NAMED exports (no default), so a namespace import is the
// correct form to reach Phaser.Scene / Phaser.GameObjects (a `import Phaser from 'phaser'` default
// resolves to undefined under this bundler — verified). The template scenes use named imports too.
import * as Phaser from 'phaser';
import type { BattleState } from '../../schema/battle-timeline';
import type { EntityKind, RenderEntity } from '../render-model';
import type { AnimationIntent } from '../animation-plan';
import type { BeatBehaviorIntent } from '../beat-behavior';
import type { CaptionOp } from '../../scribe/captions';
import { toRenderModel } from '../render-model';
import { initialBattleState } from '../../model/battle-model';
import {
  advanceSummon,
  startSummon,
  CUTAWAY_MS,
  BLOW_MS,
  DEPART_MS,
  SUMMON_CINEMATIC_TOTAL_MS,
} from '../summon-cinematic';
import type { SummonCinematicPhase, SummonCinematicState } from '../summon-cinematic';
import {
  advanceShaman,
  startShaman,
  FALL_MS,
  WAVE_MS,
  SETTLE_MS,
  SHAMAN_CINEMATIC_TOTAL_MS,
} from '../shaman-cinematic';
import type { ShamanCinematicPhase, ShamanCinematicState } from '../shaman-cinematic';
import {
  advanceDispel,
  startDispel,
  SHATTER_MS,
  SCRATCH_MS,
  REVEAL_MS,
  DISPEL_CINEMATIC_TOTAL_MS,
} from '../dispel-cinematic';
import type { DispelCinematicPhase, DispelCinematicState } from '../dispel-cinematic';
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

  // ---- the signature cinematics (Story 3.4 summon + Story 3.5 shaman/dispel) ----
  // The ACTIVE cinematic, tagged by kind (null = at rest). The scene multiplexes the THREE independent
  // pure machines (summon-cinematic / shaman-cinematic / dispel-cinematic) through this ONE consumer
  // slot: only ONE plays at a time (on the committed fixture the shaman defeat and the dispel shatter
  // fall on DIFFERENT transitions, so they never co-arm; if a future bundle put two on one transition
  // the first-armed wins — a documented, acceptable v0.1 simplification, NOT a cinematic queue). The
  // scene DRIVES each Phaser set-piece FROM its machine's phase; the sequence + the terminal `done`
  // (where the clean return fires) are gate-provable off the pure machines. Render-side transient state
  // — never serialized, never pushed upstream (R5/AC1). [story Task 4 §"Scene cinematic state"]
  private activeCinematic:
    | { kind: 'summon'; state: SummonCinematicState }
    | { kind: 'shaman'; state: ShamanCinematicState }
    | { kind: 'dispel'; state: DispelCinematicState }
    | null = null;
  // The snapshot the clean return re-applies on `done`. The cinematic CAPTURES the last BattleState
  // the scene was given (already foldBattleState(timeline, cursor) truth) and RESTORES it via the SNAP
  // path (applySnapshot) — it NEVER recomputes mechanics (R1: restore, don't recompute). [story Task 2]
  private cinematicSnapshot: BattleState | null = null;
  // The transient imp swarm (Story 3.5 AC1): the Rectangles spawned at the shaman `wave` entry and faded
  // on ONE simultaneous tween, destroyed on the tween complete / the clean return. Render-side transient
  // state — not modeled mechanics (NO per-imp HP; AC1 imps-are-presentation-only). [story Task 4]
  private impSwarm: Phaser.GameObjects.Rectangle[] = [];

  // ---- the live caption band (Story 4.1, FR-9) ----
  // The Scribe's narration band: ONE Text object near the top of the stage showing the LATEST caption
  // (the caption SELECTION/text is decided in Layer 2 scribe/captions.ts; the scene only DISPLAYS it).
  // A second Text holds the rewrite line during a Dispel correction, and a strikethrough Rectangle is
  // drawn over the struck caption (the honesty beat). Render-side transient state — never serialized,
  // never pushed upstream (R5/AC1). All null until create() builds them. [story Task 5]
  private captionText: Phaser.GameObjects.Text | null = null;
  private captionStrike: Phaser.GameObjects.Rectangle | null = null;
  private captionRewrite: Phaser.GameObjects.Text | null = null;
  // The text of the LATEST emitted caption (what the band currently shows) and the captionId->text map
  // so a `correct` op can recover the struck text for the prior caption it targets even if it is not
  // the one currently on the band. [story Task 5]
  private currentCaptionText = '';
  private readonly captionTextById = new Map<string, string>();

  // ---- the closing Saga victory panel (Story 4.2, FR-10) ----
  // The lush closing Saga shown at the victory milestone: ONE centered, multi-line Text panel (the
  // prose comes from Layer 2 scribe/saga.ts; the scene only DISPLAYS it). Created hidden in create();
  // renderSaga sets its text + reveals it. Render-side transient state — never serialized, never pushed
  // upstream (R5/AC1). The on-screen legibility/typography is the operator-verified visual (jsdom
  // advances no Phaser tweens). [story Task 5]
  private sagaPanel: Phaser.GameObjects.Text | null = null;

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

    // The caption band (Story 4.1): a centered Text near the top of the stage for the Scribe's live
    // narration, an (initially hidden) rewrite Text just below it for the Dispel correction, and an
    // (initially hidden) strikethrough Rectangle drawn over the struck caption. create-ONCE; their
    // text/visibility mutate in place on renderCaptions. The `add.text` precedent is the gauge label
    // (createGauge). [story Task 5]
    this.captionText = this.add
      .text(512, 40, '', { fontSize: '20px', color: '#f5e8c8', align: 'center', wordWrap: { width: 900 } })
      .setOrigin(0.5, 0);
    this.captionStrike = this.add.rectangle(512, 50, 0, 2, 0xff5555).setOrigin(0.5, 0.5).setVisible(false);
    this.captionRewrite = this.add
      .text(512, 78, '', { fontSize: '20px', color: '#ffd54f', align: 'center', wordWrap: { width: 900 } })
      .setOrigin(0.5, 0)
      .setVisible(false);

    // The closing Saga victory panel (Story 4.2): a centered, multi-line lush-prose Text near the
    // middle of the stage, hidden until the victory milestone fires renderSaga. create-ONCE; its text
    // and visibility mutate in place. The `add.text` precedent is the caption band + the gauge label.
    // [story Task 5]
    this.sagaPanel = this.add
      .text(512, 384, '', {
        fontSize: '22px',
        color: '#f5e8c8',
        align: 'center',
        fontStyle: 'italic',
        wordWrap: { width: 760 },
        backgroundColor: '#0d0d1acc',
        padding: { x: 24, y: 20 },
      })
      .setOrigin(0.5, 0.5)
      .setDepth(1000)
      .setVisible(false);
  }

  // applySnapshot — the one-way command the adapter's render() forwards. Compute the RenderModel from
  // the immutable snapshot and UPDATE the existing display objects/bars/gauge in place. Never throws
  // on a well-formed snapshot; never recreates objects. [story Task 4]
  applySnapshot(snapshot: BattleState): void {
    // Capture the latest snapshot the scene was given — it is the reducer's foldBattleState truth for
    // the current cursor. The cinematic's clean return RE-APPLIES this on `done` (R1: restore, not
    // recompute). The boot calls applySnapshot (via adapter.render) for t=0 + every seek/scrub, so by
    // the time a summon intent arms the cinematic this holds the correct BattleState. [story Task 2]
    this.cinematicSnapshot = snapshot;
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
  playBeatBehaviors(intents: BeatBehaviorIntent[], armSnapshot?: BattleState): void {
    // The cinematic ELEVATION (Story 3.4 summon + Story 3.5 shaman/dispel): a signature-beat intent
    // STARTS its full-scene cinematic instead of running the placeholder cues. The triggers ride the
    // EXISTING renderBeatBehaviors seam (NO new production RenderPort method) — they key on the Story-3.3
    // behavior intents planBeatBehaviors ALREADY emits:
    //   - summon: { target:'eidolon', behavior:'summon' } (Story 3.4) — omitted from the committed fixture.
    //   - shaman: { target:'shaman', behavior:'defeat' } (+ { target:'imp', behavior:'swarm-clear' }) on
    //     the breakthrough discharge (beat-behavior.ts L166-167) — DOES fire on the committed fixture.
    //   - dispel: { target:'mirage', behavior:'shatter' } (+ resolve-stagger + reveal) on a dispel-tagged
    //     beat (beat-behavior.ts L187-189) — DOES fire on the committed fixture.
    // An intent list with NONE of these leaves the cinematic at rest (the trigger is intent-specific).
    // Only one cinematic arms per call; the shaman defeat and the dispel shatter never co-occur in one
    // committed-fixture transition (Dev Notes §"Scene cinematic state"). [story Task 4 §"Triggers"]
    //
    // FIRST-ARMED-WINS (review M1): the arm is GUARDED by !isCinematicActive() so a re-delivered trigger
    // while a cinematic is mid-play is a NO-OP — it does NOT overwrite the active machine (which would
    // reset it to its first phase + orphan the impSwarm). This enforces the documented contract (Dev
    // Notes §"Scene cinematic state": "the first-armed wins, the second is a no-op while active").
    //
    // CLEAN-RETURN SNAPSHOT CAPTURE (review H1): the production forward tick arms a cinematic via
    // renderTransition→playAnimations + renderBeatBehaviors→playBeatBehaviors — NEITHER calls
    // applySnapshot, so cinematicSnapshot would stay pinned at the boot's t=0 frame. Since the shaman
    // cinematic arms at the FINAL cursor, the clean return would then snap the arena back to the
    // full-health t=0 state right after the swarm-clear (AC1 "returns cleanly" violated). So the adapter
    // threads `armSnapshot` = the transition's `next` (foldBattleState truth for the armed cursor) and we
    // pin it at ARM time. The dev hooks pass NO armSnapshot — the boot re-applies the CURRENT snapshot
    // via adapter.render() right before, so the already-captured snapshot is the correct frame. [review H1]
    const hasSummon = intents.some((i) => i.target === 'eidolon' && i.behavior === 'summon');
    const hasShaman = intents.some((i) => i.target === 'shaman' && i.behavior === 'defeat');
    const hasDispel = intents.some((i) => i.target === 'mirage' && i.behavior === 'shatter');
    if (!this.isCinematicActive()) {
      if (hasSummon) {
        this.startSummonCinematic(armSnapshot);
      } else if (hasShaman) {
        this.startShamanCinematic(armSnapshot);
      } else if (hasDispel) {
        this.startDispelCinematic(armSnapshot);
      }
    }
    for (const intent of intents) {
      // When a cinematic is armed, the intents its set-piece SUBSUMES are skipped (the cinematic phases
      // own those visuals); any other intents in the list still run their placeholder cues.
      if (this.isSubsumed(intent, { hasSummon, hasShaman, hasDispel })) continue;
      this.runBehavior(intent);
    }
  }

  // Decide whether a behavior intent is SUBSUMED by an armed cinematic (the set-piece owns its visuals,
  // mirroring the Story-3.4 summon subsumed-skip). Summon subsumes summon/decisive-blow (the cutaway +
  // blow); shaman subsumes the swarm-clear + defeat (the fall + wave own the imp wave); dispel subsumes
  // the shatter + resolve-stagger + reveal (the shatter/scratch/reveal phases). [story Task 4]
  private isSubsumed(
    intent: BeatBehaviorIntent,
    armed: { hasSummon: boolean; hasShaman: boolean; hasDispel: boolean },
  ): boolean {
    if (armed.hasSummon && intent.target === 'eidolon' && (intent.behavior === 'summon' || intent.behavior === 'decisive-blow')) {
      return true;
    }
    if (armed.hasShaman && ((intent.target === 'shaman' && intent.behavior === 'defeat') || (intent.target === 'imp' && intent.behavior === 'swarm-clear'))) {
      return true;
    }
    if (
      armed.hasDispel &&
      ((intent.target === 'mirage' && (intent.behavior === 'shatter' || intent.behavior === 'reveal')) ||
        (intent.target === 'forgemaiden' && intent.behavior === 'resolve-stagger'))
    ) {
      return true;
    }
    return false;
  }

  // renderCaptions — the CAPTION path (Story 4.1, FR-9) the adapter's renderCaptions forwards (a sibling
  // to playAnimations / playBeatBehaviors). For each op in order: an `emit` shows its in-register text on
  // the caption band (and records it by id, clearing any prior correction overlay); a `correct` crosses
  // out the targeted prior caption's text (a strikethrough rule sized to the struck text) and shows the
  // rewrite line beneath it — the Dispel honesty beat, landing on the same transition as the shatter
  // cinematic's record-scratch. With placeholder styling these are Text swaps + a Rectangle rule; the
  // strikethrough -> rewrite ANIMATION feel is operator-verified (jsdom advances no tweens). Never throws
  // on a well-formed op (fail-closed: a missing band / unresolved target is a safe no-op). [story Task 5]
  renderCaptions(ops: CaptionOp[]): void {
    for (const op of ops) {
      if (op.kind === 'emit') {
        this.currentCaptionText = op.text;
        this.captionTextById.set(op.captionId, op.text);
        this.captionText?.setText(op.text);
        // A fresh emit clears any lingering correction overlay from a previous Dispel.
        this.captionStrike?.setVisible(false);
        this.captionRewrite?.setText('').setVisible(false);
      } else {
        // A `correct` op: cross out the struck text and show the rewrite. The struck text comes on the op
        // (the prior caption's own text); fall back to the band's current text if absent (defensive).
        //
        // OPERATOR-VERIFIED VISUAL EDGE (review F7, NOT gate-caught): the cross-out rewrites the SINGLE
        // shared caption band back to the struck text before striking it. On the committed fixture the
        // Dispel emit + its correction share Beat[0]'s transition, so the band already shows the struck
        // text and there is no visible snap. But on the N-back path (a correction whose target is several
        // captions back — the scribe/captions.unit.test.ts case) the band currently shows a LATER caption,
        // so this setText snaps it back to the older struck line then strikes it — a visual jump. jsdom
        // advances no tweens, so this is operator-only. IF it reads wrong during `pnpm dev`, the fix is to
        // render the strikethrough as an OVERLAY tied to the target caption's id/position rather than
        // rewriting the shared band Text; deferred until the operator confirms (the real fixture masks it).
        const struck = op.struckText || this.captionTextById.get(op.targetCaptionId) || this.currentCaptionText;
        this.captionText?.setText(struck);
        if (this.captionText && this.captionStrike) {
          // Size the strikethrough rule to the struck caption's rendered width, centered on its line.
          this.captionStrike.width = Math.max(0, this.captionText.width);
          this.captionStrike.setPosition(this.captionText.x, this.captionText.y + this.captionText.height / 2);
          this.captionStrike.setVisible(true);
        }
        this.captionRewrite?.setText(op.newText).setVisible(true);
        this.currentCaptionText = op.newText;
      }
    }
  }

  // renderSaga — the SAGA path (Story 4.2, FR-10) the adapter's renderSaga forwards: reveal the lush
  // closing Saga on the victory panel. The boot fires it ONCE at the victory milestone (the prose was
  // read in Layer 2 by scribe/saga.ts; this only DISPLAYS it). Sets the panel text and makes it
  // visible. Never throws on a well-formed string (fail-closed: a missing panel is a safe no-op). The
  // scroll/typography feel is operator-verified (jsdom advances no tweens). [story Task 5]
  renderSaga(saga: string): void {
    this.sagaPanel?.setText(saga).setVisible(true);
  }

  // ---- the cinematic runners (Story 3.4 summon + Story 3.5 shaman/dispel): DRIVEN set-pieces ----

  // Arm + enter a cinematic at its first active phase and play that phase's set-piece. Each phase
  // ADVANCES off the render-side cadence (the scene's update() ticks the active machine each frame) OR
  // a synchronous advanceCinematicToDone() — NOT a tween onComplete (jsdom never fires it, so the smoke
  // could not reach `done`). FAIL-CLOSED: the overlay/flash helpers no-op on a missing display.
  // Each start ARMS the cinematic and, when given an arm-snapshot (the production forward-tick path),
  // pins it as the snapshot the `done` clean return restores (review H1; see playBeatBehaviors). A
  // missing arm-snapshot (the dev hooks) leaves the previously-captured snapshot in place.
  private startSummonCinematic(armSnapshot?: BattleState): void {
    if (armSnapshot) this.cinematicSnapshot = armSnapshot;
    this.activeCinematic = { kind: 'summon', state: startSummon() };
    this.playSummonPhaseVisual(this.activeCinematic.state.phase);
  }

  private startShamanCinematic(armSnapshot?: BattleState): void {
    if (armSnapshot) this.cinematicSnapshot = armSnapshot;
    this.activeCinematic = { kind: 'shaman', state: startShaman() };
    this.playShamanPhaseVisual(this.activeCinematic.state.phase);
  }

  private startDispelCinematic(armSnapshot?: BattleState): void {
    if (armSnapshot) this.cinematicSnapshot = armSnapshot;
    this.activeCinematic = { kind: 'dispel', state: startDispel() };
    this.playDispelPhaseVisual(this.activeCinematic.state.phase);
  }

  // Phaser's per-frame hook (render-side wall-clock — the same cadence the rAF boot loop owns). While a
  // cinematic is active, advance WHICHEVER machine is active by the frame delta and, on a phase CHANGE,
  // play that phase's visual; on reaching `done`, fire the clean return. jsdom does not call update()
  // (no real game loop), so the smoke drives the sequence via advanceCinematicToDone() instead — both
  // paths reach the SAME terminal + clean-return snap. [story Task 4 "drive the phase from the cadence"]
  override update(_time: number, deltaMs: number): void {
    void _time; // Phaser's update(time, delta) hook; we advance off `delta` only (codebase convention)
    this.advanceActiveCinematic(deltaMs);
  }

  // Drive the active cinematic straight to `done` synchronously (the headless smoke's hook — jsdom
  // advances no tweens/timers, so the gate reaches the terminal + the clean-return snap this way). A
  // single total-span delta clamps the active machine to `done`; the phase visual fires the clean
  // return. A no-op if no cinematic is active. Never throws (fail-closed). [story Task 4]
  advanceCinematicToDone(): void {
    const active = this.activeCinematic;
    if (!active || !this.isCinematicActive()) return;
    switch (active.kind) {
      case 'summon':
        this.advanceActiveCinematic(SUMMON_CINEMATIC_TOTAL_MS);
        return;
      case 'shaman':
        this.advanceActiveCinematic(SHAMAN_CINEMATIC_TOTAL_MS);
        return;
      case 'dispel':
        this.advanceActiveCinematic(DISPEL_CINEMATIC_TOTAL_MS);
        return;
      default:
        return;
    }
  }

  // Advance whichever machine is active by `deltaMs`, playing the new phase's visual on a phase change.
  // The shared transition step both update() (per-frame) and advanceCinematicToDone() (clamp) call, so
  // the per-machine advanceX + the matching phase visual stay in lock-step. A no-op when at rest.
  private advanceActiveCinematic(deltaMs: number): void {
    const active = this.activeCinematic;
    if (!active || !this.isCinematicActive()) return;
    switch (active.kind) {
      case 'summon': {
        const before = active.state.phase;
        active.state = advanceSummon(active.state, deltaMs);
        if (active.state.phase !== before) this.playSummonPhaseVisual(active.state.phase);
        return;
      }
      case 'shaman': {
        const before = active.state.phase;
        active.state = advanceShaman(active.state, deltaMs);
        if (active.state.phase !== before) this.playShamanPhaseVisual(active.state.phase);
        return;
      }
      case 'dispel': {
        const before = active.state.phase;
        active.state = advanceDispel(active.state, deltaMs);
        if (active.state.phase !== before) this.playDispelPhaseVisual(active.state.phase);
        return;
      }
      default:
        return;
    }
  }

  // The current cinematic phase — the smoke reads this to assert the cinematic armed + reached `done`
  // without inspecting pixels. Returns the active machine's phase, or 'idle' at rest. The union of the
  // three phase types reduces to the shared literals the smoke checks ('idle' / not-'idle' / 'done').
  cinematicPhase(): SummonCinematicPhase | ShamanCinematicPhase | DispelCinematicPhase {
    return this.activeCinematic?.state.phase ?? 'idle';
  }

  // True while ANY of the three cinematics is mid-play (a non-resting, non-terminal phase). The boot's
  // advanceIfPlaying reads the analogous flag to SUSPEND the forward tick — extending this to "any of
  // the three" keeps the boot guard UNCHANGED in shape (it polls this single query). [story Task 4]
  isCinematicActive(): boolean {
    const phase = this.activeCinematic?.state.phase;
    return phase != null && phase !== 'idle' && phase !== 'done';
  }

  // The clean return shared by all three cinematics: KILL any lingering fade on the faded stand-ins and
  // reset their alpha to the resting 1, THEN re-apply the captured reducer snapshot via the SNAP path
  // (restore the foldBattleState truth — never recompute, R1) so the arena shows the correct BattleState
  // for the cursor. applySnapshot restores position/bars but NOT alpha (review F3), so the alpha reset
  // must precede it. Fail-closed: a no-op on a missing display / snapshot. [story Task 3 §"Clean return"]
  private cleanReturn(...fadedTargets: AnimationIntent['target'][]): void {
    for (const target of fadedTargets) this.resetCinematicAlpha(target);
    if (this.cinematicSnapshot) this.applySnapshot(this.cinematicSnapshot);
  }

  // ---- the THUNDORR-summon set-piece (Story 3.4): PLACEHOLDER art (real art is Story 5.3) ----
  // cutaway = a full-screen freeze overlay; blow = a flash + lunge on the boss stand-in; depart = a
  // fade-out (the colossus leaves); done = the CLEAN RETURN. FAIL-CLOSED throughout.
  private playSummonPhaseVisual(phase: SummonCinematicPhase): void {
    switch (phase) {
      case 'cutaway':
        this.environmentOverlay(CUTAWAY_MS);
        return;
      case 'blow':
        this.flash('boss', BLOW_MS);
        this.lunge('boss', BLOW_MS, 1);
        return;
      case 'depart':
        this.fadeOut('boss', DEPART_MS);
        return;
      case 'done':
        // CLEAN RETURN: `depart` faded the boss stand-in to alpha 0; restore it before re-snapping (F3).
        this.cleanReturn('boss');
        return;
      default:
        return;
    }
  }

  // ---- the Fallen-Shaman swarm-clear set-piece (Story 3.5, AC1): PLACEHOLDER art ----
  // fall = the Shaman (ROOT CAUSE, on the boss stand-in) topples (fadeOut down); wave = ALL symptom-imps
  // die SIMULTANEOUSLY in ONE readable wave (the headline AC1 moment); settle = the dust clears (a brief
  // overlay breath so the wave reads); done = the CLEAN RETURN (restore the boss + imp-zone alpha, then
  // re-snap). The wave's SIMULTANEITY is load-bearing — it is ONE beat, NOT a stagger. FAIL-CLOSED.
  private playShamanPhaseVisual(phase: ShamanCinematicPhase): void {
    switch (phase) {
      case 'fall':
        // The root cause falls: the boss stand-in topples (a down-lunge + a fade).
        this.lunge('boss', FALL_MS, 1, -1);
        this.fadeOut('boss', FALL_MS);
        return;
      case 'wave':
        // The headline AC1 visual: spawn the transient imp swarm around the minion zone and fade ALL of
        // them on ONE simultaneous tween so they vanish together — the operator sees the whole symptom
        // class clear in one beat (NOT a stagger). The minion stand-in fades in the same beat.
        this.playImpWave(WAVE_MS);
        this.fadeOut('minion', WAVE_MS);
        return;
      case 'settle':
        // The dust settles: a brief environmental breath so the wave reads before playback resumes.
        this.environmentOverlay(SETTLE_MS);
        return;
      case 'done':
        // CLEAN RETURN: `fall`/`wave` faded the boss + minion stand-ins; restore both alphas, destroy any
        // surviving transient imps, then re-snap (F3 lesson, extended to the shaman/imp stand-ins).
        this.destroyImpSwarm();
        this.cleanReturn('boss', 'minion');
        return;
      default:
        return;
    }
  }

  // ---- the Dispel shatter set-piece (Story 3.5, AC2): PLACEHOLDER art ----
  // shatter = the glass-SHATTER (a sharp tint + a burst lunge on the mirage/minion stand-in); scratch =
  // the record-SCRATCH jolt (a hard full-screen overlay flash — the VISUAL scratch per Task 2; the
  // audible scratch is a deferred Epic-5 asset; coincides with the Story-3.3 scribe-correction signal);
  // reveal = the real situation revealed (a flash on the stand-in); done = the CLEAN RETURN. FAIL-CLOSED.
  private playDispelPhaseVisual(phase: DispelCinematicPhase): void {
    switch (phase) {
      case 'shatter':
        // The Mirage (false assumption made real) breaks: an elevated tint + burst on the minion stand-in.
        this.lunge('minion', SHATTER_MS, 1);
        this.tint('minion', 0x88ccff, SHATTER_MS);
        this.fadeOut('minion', SHATTER_MS);
        return;
      case 'scratch':
        // The record-SCRATCH jolt — the visual "stop the music, that's wrong" beat (a hard freeze-flash).
        this.environmentOverlay(SCRATCH_MS);
        return;
      case 'reveal':
        // The truth behind the dispelled illusion is revealed. The `shatter` fadeOut drove the minion
        // stand-in toward alpha 0 (no yoyo), so a flash here would yoyo 0->0.4->0 and the reveal beat
        // would not read. RESTORE the stand-in to a visible alpha 1 FIRST (kill the lingering fadeOut),
        // then flash — so the revealed stand-in is actually visible. [review L1]
        this.resetCinematicAlpha('minion');
        this.flash('minion', REVEAL_MS);
        return;
      case 'done':
        // CLEAN RETURN: `shatter` faded the minion stand-in; restore its alpha before re-snapping (F3).
        this.cleanReturn('minion');
        return;
      default:
        return;
    }
  }

  // Reset a cinematic's faded stand-in to the resting alpha on the clean return (review F3). A no-yoyo
  // fadeOut tweens alpha->0, so on `done` we must KILL that still-running tween (else it keeps driving
  // alpha back to 0 after we restore) and set alpha to 1. Guarded for the headless env
  // (tweens?.killTweensOf is absent in some jsdom shapes) and a missing display — a safe no-op, never
  // throws (the fail-closed runner posture). [review F3]
  private resetCinematicAlpha(target: AnimationIntent['target']): void {
    const display = this.displayOf(target);
    if (!display) return;
    this.tweens?.killTweensOf?.(display);
    display.alpha = 1;
  }

  // The simultaneous imp-swarm wave (AC1): spawn N small transient imp Rectangles around the minion zone
  // and fade them ALL on ONE tween (identical duration, started together) so they vanish SIMULTANEOUSLY
  // — the operator literally sees the swarm clear in ONE readable wave (NOT a stagger). PLACEHOLDER art
  // (transient rects, swappable for real imp sprites in Story 5.3); NO per-imp HP, NO modeled imp count
  // in the pure machine (the count is purely a render concern here). Fail-closed: a no-op if the minion
  // stand-in or add/tween manager is unavailable (HEADLESS shapes). [story Dev Notes §"Shaman `wave`"]
  private playImpWave(durationMs: number): void {
    const anchor = this.displayOf('minion');
    if (!anchor) return;
    const count = 6;
    const spread = 120;
    for (let i = 0; i < count; i++) {
      const offsetX = (i - (count - 1) / 2) * (spread / count);
      const offsetY = ((i % 2) - 0.5) * 30;
      const imp = this.add?.rectangle(anchor.x + offsetX, anchor.y + offsetY, 14, 14, 0xcc4444);
      if (!imp) continue;
      this.impSwarm.push(imp);
    }
    // ALL imps fade on ONE tween (a single targets array, one duration) so they clear together.
    if (this.impSwarm.length > 0) {
      this.tweens?.add({
        targets: this.impSwarm,
        alpha: 0,
        duration: Math.max(1, durationMs),
        onComplete: () => this.destroyImpSwarm(),
      });
    }
  }

  // Destroy any surviving transient imp rects (the clean return + the wave tween's onComplete both call
  // this; idempotent — the array is cleared after). Fail-closed on a missing destroy(). [story Task 4]
  private destroyImpSwarm(): void {
    for (const imp of this.impSwarm) {
      (imp as unknown as { destroy?: () => void }).destroy?.();
    }
    this.impSwarm = [];
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

  // The Boss stand-in's live alpha — the smoke asserts the cinematic clean return RESTORES it to 1 after
  // the `depart` fade drove it to 0 (jsdom advances no tweens, so the test forces alpha 0 first). [F3]
  bossAlpha(): number {
    const display = this.displayOf('boss');
    return display?.alpha ?? 1;
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
