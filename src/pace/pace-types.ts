import type { ActionType, OrderKey } from '../schema/normalized-event';
import type { TranslatedAction } from '../translate/translated-action';

// pace/-LOCAL intermediates (NOT src/schema/ entries): schema/ holds the SHARED, versioned,
// cross-stage CONTRACTS; ScoredAction/EventWindow are consumed only inside this stage, so per
// architecture.md "internal stage-to-stage hand-offs trust types" they are plain TS types with
// no Zod re-validation. The ONLY schema/ type Pace EMITS is Beat/BattleTimeline.

// A TranslatedAction plus the significance weight scoreEvent assigned it.
export type ScoredAction = TranslatedAction & { weight: number };

// One paced unit before it becomes a Beat: either a DISCRETE window wrapping a single
// significant action, or a MONTAGE window collapsing a run of N trivial actions. Montage-vs-
// discrete is encoded ONLY by sourceEventIds cardinality + weight — never a label (R1).
export interface EventWindow {
  // The representative orderKey: the FIRST collapsed action's key (preserves total order).
  orderKey: OrderKey;
  // The representative actionType: the most-significant actionType in the collapsed run.
  actionType: ActionType;
  // The ordered ids this window collapses (1 for discrete, N for a montage).
  sourceEventIds: string[];
  // The aggregated weight (discrete: the action's weight; montage: capped at the threshold).
  weight: number;
}
