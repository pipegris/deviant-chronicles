import type { BattleState, Beat } from '../schema/battle-timeline';
import type { AnnotatedView } from '../interpret/overlay';

// render-port — the ONE-WAY RenderPort interface (FR-7, R5): the swap seam. It imports BattleState
// (and Beat) as a TYPE and imports NO phaser, so it is renderer-agnostic — swapping Phaser for
// another engine implements this SAME interface and nothing upstream changes. [architecture.md#R5 L239-241]
//
// THE ONE-WAY CONTRACT (load-bearing — AC1): `render(snapshot)` and `renderTransition(prev, next,
// beats)` are COMMANDS, not queries — they return void and the adapter pushes NOTHING back upstream
// (no event to the reducer, no callback that moves the cursor). Data flows strictly
// playback-reducer -> RenderPort, never back. The adapter only ever RECEIVES snapshots/transitions;
// it holds no reference that could reach the reducer/timeline.
// [epics.md#Story-2.3 AC1 L282; architecture.md#Communication Patterns L272-273]
export interface RenderPort {
  // Async-allowed so a concrete renderer that must await a boot can; the Phaser adapter's is sync.
  init(): void | Promise<void>;
  // The SNAP path: draw the static state for a cursor (the t=0 frame + seek/scrub). Story 2.3.
  render(snapshot: BattleState): void;
  // The ANIMATED path (Story 2.4): draw the TRANSITION prev->next driven by the Beat(s) that
  // advanced the cursor between them. The boot computes beatsAdvanced (timeline.beats.slice) and
  // passes the already-sliced Beat[], so the adapter speaks only BattleState + Beat[] (no upstream
  // reach — it never imports the timeline / pace / translate / ingest). `Beat` is a type-only import
  // (no Phaser leak), keeping the interface renderer-agnostic and one-way. A future PixiJS adapter
  // implements this SAME method. [story Dev Notes "RenderPort: extend or not" — Option A]
  renderTransition(prev: BattleState, next: BattleState, beats: Beat[]): void;
  // The BEHAVIOR path (Story 3.3): drive the signature-beat behaviors for the transition prev->next,
  // reading the read-only Layer-1 overlay (AnnotatedView) the boot threads in. Like renderTransition
  // it is a one-way COMMAND — it returns void, the adapter pushes NOTHING back upstream, and the
  // emitted cross-layer signals go to a boot-owned sink (not back through this seam). `AnnotatedView`
  // is a type-only import (render -> interpret is allowed; no Phaser leak), keeping the interface
  // renderer-agnostic and one-way. A future engine adapter implements this SAME method.
  //
  // OPTIONAL (`?`) so the additive RenderPort extension stays BACKWARD-COMPATIBLE: a pre-3.3 adapter
  // (e.g. the Story 2.5 fake) that predates this command still satisfies RenderPort, and the boot
  // guards the call (`adapter.renderBeatBehaviors?.(...)`). The real PhaserRenderAdapter implements it
  // concretely. [story Task 3 "Option A"; architecture.md#R5 L239-241]
  renderBeatBehaviors?(prev: BattleState, next: BattleState, beats: Beat[], view: AnnotatedView): void;
  destroy(): void;
}
