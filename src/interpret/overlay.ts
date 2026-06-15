import type { BeatAnnotation } from '../schema/beat-annotation';

// A read-only view pairing the per-event data with the Layer-1 annotations keyed to them, for
// consumption by scribe/portal/render. The annotations live ALONGSIDE the events, never folded into
// them — there is no event.annotation field and no HP/weight derived. That side-by-side shape is the
// structural embodiment of R1: no code path from the overlay into BattleState/Beat.weight. byEventRef
// indexes eventId -> annotations[] for O(1) portal lookup ("what beat dramatizes this event?").
//
// Story 5.5 (Dev Notes §6): the view is GENERIC over its event element, constrained only to the
// `{ eventId }` every consumer keys on. The browser boot now threads bundle.projectedEvents (payload-free
// ProjectedEvent[]) — so AnnotatedView<ProjectedEvent> carries the abstracted projection the portal
// grounds to (with even LESS surface than NormalizedEvent; R1 unchanged). The bake-time callers
// (overlay/behavior/caption tests) still pass full NormalizedEvent[] → AnnotatedView<NormalizedEvent>.
// The generic default is the minimal `{ eventId }` base so every bare `AnnotatedView` consumer accepts
// EITHER element type without a signature change — the lowest-churn seam (Dev Notes §6 "MINIMIZE churn").
export interface AnnotatedView<E extends { eventId: string } = { eventId: string }> {
  events: readonly E[];
  annotations: readonly BeatAnnotation[];
  byEventRef: ReadonlyMap<string, readonly BeatAnnotation[]>;
}

// Pure: builds a fresh byEventRef index and passes the inputs through by reference. MUST NOT mutate
// either input — the readonly types, the returned arrays, and the no-mutation test enforce read-only.
// Generic in E so it works for both the full Layer-0 events (bake-time) and the payload-free projection
// (replay-time); E is inferred from the events argument.
export function applyOverlay<E extends { eventId: string }>(
  events: readonly E[],
  annotations: readonly BeatAnnotation[],
): AnnotatedView<E> {
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
