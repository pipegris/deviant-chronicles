import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleTimeline } from '../schema/battle-timeline';
import { createPlaybackReducer, initialPlaybackState } from '../model/playback';
import type { PlaybackAction, PlaybackState } from '../model/playback';
import { pace } from '../pace/derive-beats';
import { translate } from '../translate/translate';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';
import type { RenderPort } from './render-port';
import { PhaserRenderAdapter } from './phaser/phaser-render-adapter';
import { createControls } from './controls';
import type { PlaybackControls } from './controls';
import { fixtureAnnotations } from '../interpret/fixture-interpreter';
import { applyOverlay } from '../interpret/overlay';
import type { AnnotatedView } from '../interpret/overlay';
import { planBeatBehaviors } from './beat-behavior';
import type { BeatSignal } from '../interpret/beat-signal';

// arena-boot — wires the Story 2.2 playback reducer to the RenderPort adapter AND the Story 2.5
// on-screen CONTROLS. The boot OWNS the reducer state + adapter + controls (one-way: controls
// dispatch, the boot reduces/renders/syncs — nothing flows back upstream, AC1).
//
// Story 2.5 makes the rAF loop play/pause-DRIVEN: it advances ONLY while status==='playing' (the
// boot now starts PAUSED on the t=0 frame). seek/restart SNAP via render() (you cannot tween across
// a jump); the forward tick ANIMATES via renderTransition (the Story 2.4 split). The rAF wall-clock
// lives in render/ (NOT Layer-0); the reducer stays pure/time-free (speed is a LOGICAL multiplier).
//
// Importing ingest/translate/pace from render/ is allowed — R1 only forbids Layer-0 importing
// interpret/; nothing forbids render -> Layer-0. Fixtures are inlined via Vite ?raw (no fs in the
// browser) and are the SAME committed fixtures the golden snapshot folds.
import sampleTranscript from '../ingest/__fixtures__/sample-transcript.jsonl?raw';
import sampleJournal from '../ingest/__fixtures__/sample-journal.jsonl?raw';

const DEV_STREAM_ID = 'aecfc998031eb0576';

// deriveTimeline now also returns the merged `events` (Story 3.3): the boot needs them BOTH to fold
// the timeline AND to build the read-only Layer-1 overlay over the SAME events. (Story 2.x discarded
// the events after pace; we now capture them.)
function deriveTimeline(): { timeline: BattleTimeline; events: NormalizedEvent[] } {
  const transcript = normalizeTranscript(parseTranscript(sampleTranscript, DEV_STREAM_ID), DEV_STREAM_ID);
  const devMaxEpoch = Math.max(
    ...transcript.map((e) => Date.parse(e.timestamp)).filter((n) => !Number.isNaN(n)),
  );
  const journal = normalizeJournal(parseJournal(sampleJournal), devMaxEpoch + 1);
  const events: NormalizedEvent[] = mergeStreams([transcript, journal]);
  return { timeline: pace(translate(events)), events };
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
  destroy: () => void;
};

// startArena — boot the arena, render the t=0 frame PAUSED, mount the controls, and start the
// status-gated rAF loop. `startArena('game-container')` (no deps) still works for main.ts (deps
// optional with defaults). Returns the drivable handle.
export function startArena(parent = 'game-container', deps: BootDeps = {}): ArenaHandle {
  const { timeline, events } = deriveTimeline();
  const reducer = createPlaybackReducer(timeline);
  let state: PlaybackState = initialPlaybackState(timeline);

  // Build the read-only Layer-1 overlay ONCE at boot (Story 3.3) and thread it into every behavior
  // call. fixtureAnnotations() is the FixtureInterpreter's SYNCHRONOUS data path (the dev/CI double —
  // SDK-FREE, so this NEW browser-reachable edge into interpret/ stays R4-clean; the real
  // ClaudeInterpreter is scripts-only and must NOT be browser-reached). Synchronous so the fully-built
  // `view` exists BEFORE the first tick — the headless boot test drives advanceIfPlaying synchronously
  // and needs the real annotations on tick 1; the async BeatInterpreter seam stays intact for the LLM
  // impl. applyOverlay pairs the annotations side-by-side with the SAME events deriveTimeline folded
  // (R1: the overlay is read-only, never feeding mechanics). [story Task 3 "build the AnnotatedView
  // ONCE"; architecture.md#R4 L236-238]
  const view: AnnotatedView = applyOverlay(events, fixtureAnnotations());

  // The boot-owned signal sink (Story 3.3): a no-op if no consumer is wired (this story); Story 4.1
  // (FR-9) injects a collecting sink to drive the caption rewrite. The behavior plan's emitted signals
  // are routed here, never back upstream (one-way, R5/AC1).
  const onSignal = deps.onSignal ?? ((): void => {});

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
    const { signals } = planBeatBehaviors(prev, state.battleState, beatsAdvanced, view);
    for (const signal of signals) onSignal(signal);
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
    destroy,
  };
}
