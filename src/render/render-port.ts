import type { BattleState } from '../schema/battle-timeline';

// render-port — the ONE-WAY RenderPort interface (FR-7, R5): the swap seam. It imports BattleState
// as a TYPE and imports NO phaser, so it is renderer-agnostic — swapping Phaser for another engine
// implements this SAME interface and nothing upstream changes. [architecture.md#R5 L239-241]
//
// THE ONE-WAY CONTRACT (load-bearing — AC1): `render(snapshot)` is a COMMAND, not a query — it
// returns void and the adapter pushes NOTHING back upstream (no event to the reducer, no callback
// that moves the cursor). Data flows strictly playback-reducer -> RenderPort, never back. The
// adapter only ever RECEIVES snapshots; it holds no reference that could reach the reducer/timeline.
// [epics.md#Story-2.3 AC1 L282; architecture.md#Communication Patterns L272-273]
export interface RenderPort {
  // Async-allowed so a concrete renderer that must await a boot can; the Phaser adapter's is sync.
  init(): void | Promise<void>;
  render(snapshot: BattleState): void;
  destroy(): void;
}
