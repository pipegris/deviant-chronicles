import type { BattleTimeline } from '../schema/battle-timeline';
import { createPlaybackReducer, initialPlaybackState } from '../model/playback';
import type { PlaybackAction, PlaybackState } from '../model/playback';
import type { RenderPort } from './render-port';
import { PhaserRenderAdapter } from './phaser/phaser-render-adapter';
import { createControls } from './controls';
import type { PlaybackControls } from './controls';
import { createLegendOverlay } from './legend-overlay';
import type { LegendGrounding, LegendOverlay } from './legend-overlay';
import { applyOverlay } from '../interpret/overlay';
import type { AnnotatedView } from '../interpret/overlay';
import type { BeatAnnotation } from '../schema/beat-annotation';
import { getLegendEntries, resolveAbstractedGrounding, LEGEND_BEATS } from '../portal/portal';
import { planBeatBehaviors } from './beat-behavior';
import type { BeatSignal } from '../interpret/beat-signal';
import { planCaptions, planCaptionCorrection } from '../scribe/captions';
import type { CaptionOp } from '../scribe/captions';
import { planTeaching } from '../portal/teaching';
import type { TeachingOp } from '../portal/teaching';
import { readSaga } from '../scribe/saga';
import { ReplayBundleSchema, type ReplayBundle, type ProjectedEvent } from '../schema/replay-bundle';
import defaultBundleJson from '../../public/bundles/story-10-1.json';

// arena-boot — wires the Story 2.2 playback reducer to the RenderPort adapter AND the Story 2.5
// on-screen CONTROLS. The boot OWNS the reducer state + adapter + controls (one-way: controls
// dispatch, the boot reduces/renders/syncs — nothing flows back upstream, AC1).
//
// Story 2.5 makes the rAF loop play/pause-DRIVEN: it advances ONLY while status==='playing' (the
// boot now starts PAUSED on the t=0 frame). seek/restart SNAP via render() (you cannot tween across
// a jump); the forward tick ANIMATES via renderTransition (the Story 2.4 split). The rAF wall-clock
// lives in render/ (NOT Layer-0); the reducer stays pure/time-free (speed is a LOGICAL multiplier).
//
// Story 5.2 — the boot now RUNS FROM A ReplayBundle (offline-at-replay, NFR-5): bootFromBundle folds
// the bundle's BAKED battleTimeline (no in-browser recompute), threads its frozen annotations as the
// read-only overlay, and reads its baked Saga — replacing the old inlined-fixture derivation entirely.
// main.ts fetch+Zod-validates the committed public/bundles/story-10-1.json via loadBundle then calls
// bootFromBundle; the boot itself touches NO Layer-0 ingest path and NO LLM/SDK (the bundle is the
// single source). startArena stays the drivable handle the heavily-tested boot suites use — it boots
// from the committed bundle (statically imported + Zod-validated lazily) so its drivable contract is
// unchanged, while staying tree-shakeable from prod (main.ts never calls it). [story Task 4; AC2]

// The committed fixture-derived bundle the legacy drivable handle (startArena) boots from. Parsed
// LAZILY on the first startArena call (memoized), NOT at module load: main.ts imports this module for
// loadBundle/bootFromBundle but NEVER calls startArena, so a lazy default keeps the static JSON import
// + its parse referenced ONLY inside startArena — both then tree-shake out of the production bundle
// (which fetches the bundle at runtime via loadBundle instead of inlining it). Validated fail-closed (a
// malformed committed artifact throws on the first startArena call, not at first tick).
let defaultBundleCache: ReplayBundle | undefined;
function defaultBundle(): ReplayBundle {
  defaultBundleCache ??= ReplayBundleSchema.parse(defaultBundleJson as unknown);
  return defaultBundleCache;
}

// loadBundle — fetch the committed bundle JSON and Zod-validate it at the boundary (build-time-strict:
// a malformed/missing/old bundle is a HARD boot error, NOT a silent fallback — the inlined-fixture
// path it replaced is gone). This is the offline-at-replay seam (NFR-5): a static same-origin fetch of a
// committed JSON, no external service, no LLM. main.ts awaits it BEFORE bootFromBundle. [story Task 4]
export async function loadBundle(url = '/bundles/story-10-1.json'): Promise<ReplayBundle> {
  const res = await fetch(url);
  // Guard res.ok BEFORE res.json(): on a Story-5.4 static SPA-fallback host a missing bundle returns
  // 200 + index.html, so res.json() would throw a confusing 'Unexpected token <' rather than name the
  // real HTTP failure. A missing bundle is a HARD boot error (build-time-strict line). [review F2]
  if (!res.ok) {
    throw new Error(`loadBundle: HTTP ${res.status} fetching ${url}`);
  }
  const json: unknown = await res.json();
  return ReplayBundleSchema.parse(json);
}

// An optional adapter FACTORY (not a ready instance, so the boot keeps its construct-from-parent-id
// ownership) lets a test inject a FakeRenderAdapter without booting Phaser; defaults to the real one.
// onSignal (Story 3.3) is the boot-owned SINK for the cross-layer BeatSignals the behavior plan emits
// (the Dispel's scribe-correction signal): the boot routes each emitted signal here so Story 4.1
// (FR-9) can subscribe to drive the caption rewrite. For THIS story a collecting/no-op sink suffices
// (the signal TYPE + emission is what AC2 requires). One-way: the sink only RECEIVES (R5/AC1).
export type BootDeps = {
  createAdapter?: (parent: string) => RenderPort;
  onSignal?: (signal: BeatSignal) => void;
  // The Saga seams (Story 4.2/5.2). The boot shows the pre-generated closing Saga at the victory
  // milestone, sourced from the SDK-free reader (readSaga) — never the SDK-touching author. `saga` is
  // the resolved-string OVERRIDE (a test injection / the dev-preview hook); it takes precedence on BOTH
  // entry points so a panel can be exercised without a full bundle. `bundle` is the legacy startArena
  // Saga-source seam (readSaga(deps.bundle)); bootFromBundle takes the bundle positionally and reads its
  // baked Saga directly, so `deps.bundle` is unused there. [story Task 4]
  saga?: string | null;
  bundle?: ReplayBundle;
};

// The drivable boot handle: the live state/adapter/controls plus the two seams the headless test
// drives directly (the rAF wrapper is a thin shell over advanceIfPlaying; the gate — advance iff
// playing — is what the unit test asserts).
export type ArenaHandle = {
  adapter: RenderPort;
  controls: PlaybackControls;
  dispatch: (action: PlaybackAction) => void;
  advanceIfPlaying: () => void;
  getState: () => PlaybackState;
  // Story 3.4: the DEV-ONLY preview hook (the testable surface) — plays the THUNDORR cinematic on
  // demand over the CURRENT state.battleState snapshot and clean-returns to it via the SNAP path. The
  // committed FixtureInterpreter omits `summon` by design, so the PRODUCTION trigger never fires in the
  // dev fixture; this lets the operator WATCH the cinematic now WITHOUT injecting a fake summon into the
  // production overlay. main.ts calls it behind import.meta.env.DEV (?cinematic=summon) — tree-shaken
  // from the prod build. [story Task 3]
  previewSummonCinematic: () => void;
  // Story 3.5: the DEV-ONLY replay hooks for the shaman swarm-clear / dispel shatter cinematics. UNLIKE
  // summon (omitted from the committed fixture, so its dev preview is the ONLY way to see it), BOTH of
  // these DO fire on the committed fixture during normal playback — so these hooks are an operator
  // REPLAY-ON-DEMAND convenience (re-watch a set-piece without scrubbing to the exact beat), NOT the only
  // path. Each plays its cinematic over the CURRENT state.battleState and clean-returns to it via the
  // SNAP path. main.ts calls them behind import.meta.env.DEV (?cinematic=shaman / ?cinematic=dispel) —
  // tree-shaken from the prod build. They inject NO fake annotation into the production overlay. [story Task 4]
  previewShamanCinematic: () => void;
  previewDispelCinematic: () => void;
  // True while the cinematic plays — render-side TRANSIENT state (the rafId precedent), NOT playback
  // state (never serialized, never in the reducer). advanceIfPlaying reads it to SUSPEND the forward
  // tick mid-cutaway (Task 2 option A: paused-in-place, so resume is trivially clean). [story Task 2]
  isCinematicActive: () => boolean;
  // Story 4.4 — the ON-DEMAND Legend / transparency portal (FR-11, UJ-2): a thin handle to drive the
  // viewer-opened fantasy<->real overlay. CRITICAL (Dev Notes #5): open/close/toggle mutate ONLY the
  // overlay's OWN visibility — they hold NO dispatch edge to the reducer, NEVER pause/seek/restart,
  // NEVER set cinematicActive. So driving them leaves the PlaybackState (cursor/status/speed) AND the
  // BattleState untouched and the status-gated rAF loop ticking unchanged — the non-interruption gate
  // (arena-boot-legend.test.ts) pins this. The overlay is OUTSIDE the playback data path entirely.
  legend: { open: () => void; close: () => void; toggle: () => void; isOpen: () => boolean };
  destroy: () => void;
};

// bootFromBundle — the bundle-driven boot core (Story 5.2, Decision §7). Folds the bundle's BAKED
// battleTimeline (no in-browser recompute), threads its frozen annotations as the read-only overlay,
// and reads its baked Saga (offline-at-replay). The boot stays SYNCHRONOUS given a bundle — the async
// fetch lives in main.ts (loadBundle) BEFORE this. Saga precedence: an explicit resolved-string
// `deps.saga` (a test injection / dev-preview hook) wins; else readSaga(bundle) (the bundle's baked
// prose, null when unauthored). This is the production path main.ts drives with the fetched bundle.
// [story Task 4; AC2]
export function bootFromBundle(
  bundle: ReplayBundle,
  parent = 'game-container',
  deps: BootDeps = {},
): ArenaHandle {
  const saga: string | null = deps.saga !== undefined ? deps.saga : readSaga(bundle);
  return bootCore(
    {
      timeline: bundle.battleTimeline,
      events: bundle.projectedEvents,
      annotations: bundle.annotations,
      saga,
    },
    parent,
    deps,
  );
}

// startArena — the drivable boot handle the heavily-tested boot suites drive (arena-boot.test.ts et
// al.). It boots from the committed DEFAULT_BUNDLE (the fixture-derived artifact, statically imported
// + Zod-validated once) so its timeline/events/overlay are the committed-fixture content the suites
// assert against. Saga precedence preserves the PRE-5.2 legacy semantics EXACTLY: an explicit
// `deps.saga` wins, else `readSaga(deps.bundle)` when a bundle is injected (the Story-4.2 Saga-source
// seam), else null (the panel stays dormant — NOT the default bundle's placeholder Saga). main.ts uses
// bootFromBundle (the fetched bundle), not startArena, so startArena + DEFAULT_BUNDLE tree-shake from
// prod. `startArena('game-container')` (no deps) still works (deps optional). [story Task 4; Decision §7]
export function startArena(parent = 'game-container', deps: BootDeps = {}): ArenaHandle {
  const bundle = defaultBundle();
  const saga: string | null =
    deps.saga !== undefined ? deps.saga : deps.bundle ? readSaga(deps.bundle) : null;
  return bootCore(
    {
      timeline: bundle.battleTimeline,
      events: bundle.projectedEvents,
      annotations: bundle.annotations,
      saga,
    },
    parent,
    deps,
  );
}

// The shared boot core: render the t=0 frame PAUSED, mount the controls + Legend overlay, and start
// the status-gated rAF loop, driving every transition's behavior/caption/teaching/saga paths. It takes
// ALREADY-RESOLVED inputs (the baked timeline, the events, the frozen annotations, the resolved Saga)
// so the two entry points (bootFromBundle = the loaded bundle; startArena = the committed default)
// share ONE wiring body and differ only in how those inputs are sourced. [story Task 4]
function bootCore(
  source: {
    timeline: BattleTimeline;
    // Story 5.5: the bundle now carries the payload-free projection; the overlay/grounding consume it.
    events: readonly ProjectedEvent[];
    annotations: readonly BeatAnnotation[];
    saga: string | null;
  },
  parent: string,
  deps: BootDeps,
): ArenaHandle {
  const { timeline } = source;
  const reducer = createPlaybackReducer(timeline);
  let state: PlaybackState = initialPlaybackState(timeline);

  // Build the read-only Layer-1 overlay ONCE at boot (Story 3.3) and thread it into every behavior
  // call. The annotations are the bundle's FROZEN set (Story 5.2 — formerly fixtureAnnotations()
  // directly; for the committed dev bundle they are identical content, since the fixture annotations
  // were frozen INTO the bundle). applyOverlay pairs them side-by-side with the SAME events the bundle
  // baked the timeline from (R1: the overlay is read-only, never feeding mechanics). The overlay is
  // built SYNCHRONOUSLY so the fully-built `view` exists BEFORE the first tick — the headless boot test
  // drives advanceIfPlaying synchronously and needs the annotations on tick 1. [story Task 4; #R4]
  const view: AnnotatedView<ProjectedEvent> = applyOverlay(
    [...source.events],
    [...source.annotations],
  );

  // The boot-owned signal sink (Story 3.3): a no-op if no consumer is wired. Story 4.1 (FR-9) now
  // wires it: an injected sink (if any) still RECEIVES every signal (the Story-3.3 contract is
  // preserved), and ADDITIONALLY the boot drives the caption rewrite from the scribe-correction signal
  // (below). One-way: the sink only RECEIVES; nothing flows back upstream (R5/AC1).
  const injectedSink = deps.onSignal ?? ((): void => {});

  // Story 4.1 — the boot-owned caption HISTORY: the `emit` ops planCaptions has produced so far, in
  // fold order. Render-side TRANSIENT state (the cinematicActive/rafId precedent) — never in the
  // reducer, never serialized. The Dispel correction handler resolves its target against this running
  // history (the assumption caption to cross out is a PRIOR emit). seek/restart SNAP and do NOT emit
  // captions (you cannot narrate across a jump — same posture as the behavior path), so the history
  // grows ONLY on the forward tick. [story Task 4]
  const captionHistory: Extract<CaptionOp, { kind: 'emit' }>[] = [];

  // Story 4.2/5.2 — the closing Saga string, resolved by the caller (bootFromBundle = readSaga(bundle)
  // with a deps.saga override; startArena = the legacy deps.saga/deps.bundle/null precedence). readSaga
  // is the only Saga source either path touches — the browser path stays offline-at-replay (no LLM/SDK;
  // saga-author.ts is never imported here). [story Task 4]
  const saga: string | null = source.saga;
  // The boot-owned `sagaShown` guard: render-side TRANSIENT state (the captionHistory/cinematicActive
  // precedent) — never in the reducer, never serialized. Latches true when the Saga is shown at the
  // victory edge so a re-render / a later clamped tick does not re-narrate the milestone. It is
  // ONCE-PER-SESSION by design and is deliberately NOT reset on restart (mirroring captionHistory,
  // which also never resets): the closing Saga is the milestone's one-time elegiac payoff, not a
  // per-replay cue, so a play→victory→restart→replay does not re-fire it. [story Task 4; review F2]
  let sagaShown = false;

  // onSignal — the boot's signal handler (Story 4.1). Forward every signal to the injected sink, THEN,
  // for a scribe-correction signal (the Dispel honesty beat), resolve the `correct` op against the
  // running caption history and hand it to the render adapter to draw the cross-out -> rewrite. The
  // correction rides the SIGNAL path, distinct from the per-transition planCaptions EMIT path. A signal
  // with no matching prior caption yields no op (planCaptionCorrection returns null) — nothing to draw.
  // [story Task 3 "the signal handler CORRECTS", Task 4]
  const onSignal = (signal: BeatSignal): void => {
    injectedSink(signal);
    if (signal.kind === 'scribe-correction') {
      const correction = planCaptionCorrection(signal, captionHistory);
      if (correction) adapter.renderCaptions?.([correction]);
    }
  };

  const adapter = deps.createAdapter ? deps.createAdapter(parent) : new PhaserRenderAdapter(parent);
  adapter.init();
  adapter.render(state.battleState); // show t=0 (a SNAP)

  // Story 3.4 — the boot-owned cinematic-active flag. Render-side TRANSIENT state (the rafId
  // precedent): true while the THUNDORR cinematic plays, false at rest. NOT playback state — it never
  // serializes and never touches the reducer (one-way, R5/AC1). advanceIfPlaying suspends the forward
  // tick while this is true (Task 2 option A) so no new transition starts mid-cutaway; the reducer
  // state (cursor/status) never moves, so resume is trivially clean. [story Task 2]
  //
  // The SCENE's cinematic machine is the single source of truth (review F1/F2): the flag is the boot's
  // cached mirror of adapter.isCinematicActive(). It is SET when the scene arms a cinematic (the dev
  // hook, or a real summon intent on the forward tick) and CLEARED on the held-frame tick once the
  // scene reports rest (the cutaway reached `done`) — so playback resumes. sceneCinematicActive()
  // reads the adapter when it reports (the real Phaser path) and falls back to the cached flag for a
  // pre-3.4 fake that does not. [review F1/F2]
  let cinematicActive = false;
  const sceneCinematicActive = (): boolean => adapter.isCinematicActive?.() ?? cinematicActive;
  const isCinematicActive = (): boolean => cinematicActive;

  // The dispatch seam the controls hold: reduce the action into the live `state`, render cursor-JUMPS
  // via the SNAP path (you cannot tween across a jump), then reflect the new status/cursor/speed into
  // the UI. play/pause/setSpeed do not move the cursor, so they need no re-render — only a sync. The
  // forward `tick` render is NOT here; it stays in the rAF loop (the ANIMATED path, below).
  const dispatch = (action: PlaybackAction): void => {
    state = reducer(state, action);
    if (action.type === 'seek' || action.type === 'restart') {
      adapter.render(state.battleState);
    }
    controls.sync();
  };

  // Story 3.4 — the DEV-ONLY preview hook. Plays the THUNDORR cinematic on demand over the CURRENT
  // state.battleState snapshot so the operator can WATCH it now (the committed FixtureInterpreter omits
  // `summon`, so the PRODUCTION trigger never fires in the dev fixture). It (1) marks the cinematic
  // active (the advanceIfPlaying guard then suspends the forward tick), (2) re-applies the CURRENT
  // snapshot via the SNAP path (the clean return baseline — RESTORE the reducer's foldBattleState
  // truth, never recompute, R1; restoring the current snapshot is a visual no-op but pins the
  // clean-return contract), and (3) drives the real scene's cinematic via the optional one-way
  // previewSummonCinematic command (a no-op on a fake adapter). It does NOT inject a `summon` into the
  // production overlay — the FixtureInterpreter stays dispel+shaman; the cinematic is played DIRECTLY.
  // [story Task 3; story Dev Notes §"Dev-only preview trigger"]
  const previewSummonCinematic = (): void => {
    cinematicActive = true;
    adapter.render(state.battleState); // clean-return baseline: restore the reducer's snapshot (R1)
    adapter.previewSummonCinematic?.(state.battleState);
  };

  // Story 3.5 — the DEV-ONLY replay hooks for the shaman/dispel cinematics. SAME shape as
  // previewSummonCinematic (the guard + clean-return baseline are REUSED unchanged): mark the cinematic
  // active (advanceIfPlaying then suspends the forward tick), re-apply the CURRENT snapshot via the SNAP
  // path (the clean-return baseline — RESTORE the reducer's foldBattleState truth, never recompute, R1),
  // and drive the real scene's cinematic via the optional one-way command (a no-op on a fake adapter
  // lacking it). They do NOT inject a fake annotation into the production overlay — the cinematic is
  // played DIRECTLY over the current snapshot. [story Task 4 §"dev-preview"; Dev Notes §"Dev-only preview"]
  const previewShamanCinematic = (): void => {
    cinematicActive = true;
    adapter.render(state.battleState);
    adapter.previewShamanCinematic?.(state.battleState);
  };

  const previewDispelCinematic = (): void => {
    cinematicActive = true;
    adapter.render(state.battleState);
    adapter.previewDispelCinematic?.(state.battleState);
  };

  // One loop step, gated on status: advance the cursor by `state.speed` and ANIMATE the transition
  // ONLY while playing. The beatsAdvanced slice spans prev.cursor..next.cursor, so it is multi-beat-
  // safe — a speed>=2 tick animates a fused multi-beat transition with no special-casing. Paused (or
  // at the end, where tick is a clamped no-op) advances nothing and renders nothing.
  const advanceIfPlaying = (): void => {
    if (state.status !== 'playing') return;
    // Story 3.4 — suspend the forward tick while the full-scene cinematic plays (Task 2 option A): no
    // new reducer transition starts mid-cutaway, so the reducer state stays UNTOUCHED (paused-in-place)
    // and resume needs no recompute. We still RE-RENDER the held frame's behaviors over the unchanged
    // state (a held-frame command, beatsAdvanced=[]) so the read-only overlay keeps flowing to the
    // scene — the cinematic owns only render-side wall-clock, never the reducer. [story Task 2]
    //
    // Resume (review F1): the scene's cinematic machine reaches `done` on its own cadence (Scene.update
    // each frame / advanceCinematicToDone), so each held-frame tick we POLL it and clear the boot flag
    // once it returns to rest — then fall through to the normal forward tick. Without this the flag was
    // set-once and never cleared, permanently suspending playback after the dev preview (the only
    // reachable cinematic path). [review F1]
    if (cinematicActive) {
      if (!sceneCinematicActive()) {
        cinematicActive = false; // the scene returned to rest — resume the forward tick this same step
      } else {
        adapter.renderBeatBehaviors?.(state.battleState, state.battleState, [], view);
        return;
      }
    }
    const prev = state.battleState;
    const prevCursor = state.cursor;
    state = reducer(state, { type: 'tick' });
    if (state.cursor === prevCursor) return; // at the end: a clamped no-op, no transition to animate
    const beatsAdvanced = timeline.beats.slice(prevCursor, state.cursor);
    adapter.renderTransition(prev, state.battleState, beatsAdvanced);
    // The BEHAVIOR path (Story 3.3) rides the SAME forward transition: drive the signature-beat
    // behaviors via the one-way command (the adapter runs the intents on the scene), then route the
    // emitted cross-layer signals to the boot-owned sink. The signals are recomputed via the PURE
    // planBeatBehaviors (cheap + deterministic) because the visual command owns the intents while the
    // boot owns the signal sink — the same (prev, next, beats, view) yields the same signals. Only the
    // forward tick drives this; seek/restart SNAP (you cannot dramatize across a jump) and never reach
    // here. [story Task 3 "hand the resulting intents to playBeatBehaviors; signals to a boot-owned sink"]
    adapter.renderBeatBehaviors?.(prev, state.battleState, beatsAdvanced, view);
    // A real summon intent in this transition ARMS the scene's cinematic (arena-scene.playBeatBehaviors
    // starts it). Reflect that into the boot flag so the NEXT tick suspends the forward advance (Task 2
    // option A) for the production path too — without this the reducer would keep ticking "behind" the
    // cutaway (the latent production-path bug). The dev hook arms the flag directly; this covers the
    // real trigger. [review F2]
    if (sceneCinematicActive()) cinematicActive = true;
    // The CAPTION path (Story 4.1, FR-9) rides the SAME forward transition: the PURE planCaptions emits
    // one `emit` op per captionable advanced beat (idle skipped, SM-C2 throttle). Append them to the
    // boot-owned history (so a later Dispel correction can target a prior caption) and hand them to the
    // adapter to draw. This runs BEFORE routing the signals so the Dispel beat's OWN caption is in the
    // history before the same transition's scribe-correction signal resolves its target (the assumption
    // caption the Dispel crosses out is emitted on this very transition). Only the forward tick drives
    // this; seek/restart SNAP (no narration across a jump) and never reach here. [story Task 4]
    const captionOps = planCaptions(prev, state.battleState, beatsAdvanced, view);
    const emits = captionOps.filter((o): o is Extract<CaptionOp, { kind: 'emit' }> => o.kind === 'emit');
    captionHistory.push(...emits);
    if (captionOps.length > 0) adapter.renderCaptions?.(captionOps);
    // The TEACHING path (Story 4.3, FR-11) rides the SAME forward transition: the PURE planTeaching
    // emits at most one plain-dev one-liner op per signature beatType firing in this transition (dispel
    // on the dispel-tagged beat, shaman on the breakthrough-discharge death; summon is dormant-in-
    // fixture). Hand any ops to the adapter to AUTO-surface the lesson with NO viewer action — there is
    // no toggle/click/open() on this path, the boot pushes the op on the tick (AC1). UNLIKE captions,
    // teaching needs NO boot-owned history (it is stateless per-transition — the lesson is fixed, never
    // corrected). Only the forward tick drives this; seek/restart SNAP via render() (you cannot
    // auto-surface a lesson across a jump) and never reach here; the held-frame tick passes an empty
    // beatsAdvanced so planTeaching returns [] (nothing to surface). [story Task 4]
    const teachingOps: TeachingOp[] = planTeaching(prev, state.battleState, beatsAdvanced, view);
    if (teachingOps.length > 0) adapter.renderTeaching?.(teachingOps);
    const { signals } = planBeatBehaviors(prev, state.battleState, beatsAdvanced, view);
    for (const signal of signals) onSignal(signal);
    // The SAGA path (Story 4.2, FR-10): at the victory MILESTONE, hand the pre-generated closing Saga
    // to the adapter ONCE. The trigger is the BattleState.victory latch flipping false->true on THIS
    // forward transition (battle-model.ts latches victory = victory || problemIntegrity <= 0 — sticky/
    // idempotent once true). The sagaShown guard makes it fire at most once (a later clamped tick after
    // victory does not re-narrate). Only the forward tick reaches here; seek/restart SNAP and never fire
    // it — you cannot narrate a milestone across a jump (the caption-path posture). A null Saga (the
    // bundle-less fixture path) means nothing to show — guard on it so the panel simply stays dormant.
    // [story Task 4; src/model/battle-model.ts L89-90 the victory latch]
    if (!sagaShown && prev.victory === false && state.battleState.victory === true && saga !== null) {
      sagaShown = true;
      adapter.renderSaga?.(saga);
    }
    controls.sync();
  };

  // Mount the controls into #app (a sibling below #game-container — the idiomatic media-player
  // layout), falling back to document.body. `getState` is a CLOSURE over the live `state` so the
  // controls always read the current value (dispatch/advance reassign it). speeds [1, 2] = normal/fast.
  const mountHost = (typeof document !== 'undefined' && document.getElementById('app')) || document.body;
  const controls = createControls({
    parent: mountHost,
    beatCount: timeline.beats.length,
    dispatch,
    getState: () => state,
    speeds: [1, 2],
  });

  // Story 4.4 / 5.5 — the active-beat GROUNDING accessor for the Legend overlay. PURE + READ-ONLY: it
  // reads the live cursor + the frozen read-only `view` and resolves (via portal.resolveAbstractedGrounding)
  // the ABSTRACTED grounding rows (tool + role + outcome + concept — Story 5.5/AC4, no raw event/name) the
  // CURRENT active beat dramatizes. "Active beat" = the
  // grounded signature annotation the cursor has most-recently reached: for each LEGEND_BEATS type with
  // an annotation in the overlay, find the beat index whose sourceEventIds carries its anchor eventRef
  // (the same L1->L0 bridge the behaviors/teaching use), keep those at/before the cursor, and pick the
  // latest. Returns null when no grounded beat has been reached yet (or for summon, omitted from the
  // committed fixture). It pushes NOTHING upstream — the overlay only DISPLAYS what it returns. [Task 4]
  const beatIndexOfAnchor = (anchorEventRef: string): number =>
    timeline.beats.findIndex((b) => b.sourceEventIds.includes(anchorEventRef));
  const getActiveGrounding = (): LegendGrounding | null => {
    let best: { beatKey: string; cursorIndex: number; rows: LegendGrounding['rows'] } | null = null;
    for (const beatType of LEGEND_BEATS) {
      const annotation = view.annotations.find((a) => a.beatType === beatType);
      if (!annotation) continue;
      const idx = beatIndexOfAnchor(annotation.eventRef);
      if (idx < 0 || idx >= state.cursor) continue; // not reached yet (cursor is the NEXT beat to play)
      if (!best || idx > best.cursorIndex) {
        // Story 5.5 (AC4): surface the ABSTRACTED grounding rows (tool + role + outcome + concept), NOT
        // bare eventIds — resolved from the payload-free projection the view carries. No name can leak.
        best = {
          beatKey: beatType,
          cursorIndex: idx,
          rows: resolveAbstractedGrounding(annotation, view),
        };
      }
    }
    return best ? { beatKey: best.beatKey, rows: best.rows } : null;
  };

  // Mount the Legend overlay ADDITIVELY alongside the controls (the createControls precedent), handing
  // it the PURE getLegendEntries() content feed + the read-only grounding accessor. The overlay is the
  // on-demand transparency portal's DISPLAY; the boot OWNS its lifecycle (created here, torn down in
  // destroy()). It is OUTSIDE the playback data path — it dispatches nothing, so the rAF loop is
  // unaffected by open/close (Dev Notes #5). [story Task 4]
  const legendOverlay: LegendOverlay = createLegendOverlay({
    parent: mountHost,
    entries: getLegendEntries(),
    getActiveGrounding,
  });

  // Wall-clock drive (render-side, NOT Layer-0): a fixed ~4 steps/sec cadence calls advanceIfPlaying,
  // which is itself the status gate. The loop keeps re-scheduling so a PAUSED arena resumes instantly
  // on PLAY (the callback runs but advances nothing while paused). We CAPTURE the rafId on every
  // schedule so destroy() can cancel the live frame — jsdom DOES define rAF, so this loop genuinely
  // runs (throttled) in the boot test too, and an uncancelled one would survive teardown. Guarded for
  // environments without requestAnimationFrame (the loop simply never starts there).
  let rafId: number | null = null;
  if (typeof requestAnimationFrame === 'function') {
    const stepMs = 250;
    let lastStep = 0;
    const loop = (now: number): void => {
      if (now - lastStep >= stepMs) {
        lastStep = now;
        advanceIfPlaying();
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }

  // destroy() CANCELS the rAF loop FIRST (so no scheduled callback fires advanceIfPlaying() on the
  // torn-down adapter), then tears down controls + adapter. Cancel is guarded for environments
  // without cancelAnimationFrame, and rafId is nulled so a double-destroy is a safe no-op.
  const destroy = (): void => {
    if (rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    controls.destroy();
    legendOverlay.destroy(); // Story 4.4: tear down the Legend overlay alongside controls (no leaked overlay on re-boot)
    adapter.destroy();
  };

  return {
    adapter,
    controls,
    dispatch,
    advanceIfPlaying,
    getState: () => state,
    previewSummonCinematic,
    previewShamanCinematic,
    previewDispelCinematic,
    isCinematicActive,
    // Story 4.4 — the thin Legend handle: drive open/close/toggle/isOpen from a test (and main.ts). The
    // overlay holds no dispatch edge, so these never touch the reducer/cursor/BattleState (Dev Notes #5).
    legend: {
      open: () => legendOverlay.open(),
      close: () => legendOverlay.close(),
      toggle: () => legendOverlay.toggle(),
      isOpen: () => legendOverlay.isOpen(),
    },
    destroy,
  };
}
