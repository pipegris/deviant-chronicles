import type { BattleState, Beat } from '../schema/battle-timeline';

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
  destroy(): void;
}
