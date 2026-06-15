import type { NormalizedEvent } from '../schema/normalized-event';
import type { BeatAnnotation } from '../schema/beat-annotation';

// A read-only view pairing Layer-0 events with the Layer-1 annotations keyed to them, for
// consumption by scribe/portal/render. The annotations live ALONGSIDE the events, never
// folded into them — there is no event.annotation field and no HP/weight derived. That
// side-by-side shape is the structural embodiment of R1: no code path from the overlay into
// BattleState/Beat.weight. byEventRef indexes eventId -> annotations[] for O(1) portal lookup
// ("what beat dramatizes this event?").
export interface AnnotatedView {
  events: readonly NormalizedEvent[];
  annotations: readonly BeatAnnotation[];
  byEventRef: ReadonlyMap<string, readonly BeatAnnotation[]>;
}

// Pure: builds a fresh byEventRef index and passes the inputs through by reference. MUST NOT
// mutate either input (the events are already-frozen Layer-0 truth) — the readonly types,
// the returned arrays, and the no-mutation test enforce read-only.
export function applyOverlay(
  events: NormalizedEvent[],
  annotations: BeatAnnotation[],
): AnnotatedView {
  const byEventRef = new Map<string, BeatAnnotation[]>();
  for (const annotation of annotations) {
    const existing = byEventRef.get(annotation.eventRef);
    if (existing) {
      existing.push(annotation);
    } else {
      byEventRef.set(annotation.eventRef, [annotation]);
    }
  }
  return { events, annotations, byEventRef };
}
