import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BeatAnnotation } from '../schema/beat-annotation';
import { applyOverlay } from './overlay';

// Focused GREEN-phase unit tests for the overlay's index-building branches in isolation
// (synthetic annotations — NOT the FixtureInterpreter's fixed pair, which the ATDD
// overlay.test.ts already covers). These exercise the byEventRef paths the acceptance test
// cannot reach with exactly two distinct-ref annotations: an empty input, and >1 annotation
// sharing one eventRef (the `existing.push` branch).

function annotation(eventRef: string, beatType: BeatAnnotation['beatType']): BeatAnnotation {
  return {
    eventRef,
    beatType,
    confidence: 0.5,
    interpreterVersion: 'unit',
    sourceHash: 'unit',
    groundingPointer: { eventRefs: [eventRef] },
  };
}

describe('applyOverlay — byEventRef index construction', () => {
  it('returns an empty index when there are no annotations', () => {
    const view = applyOverlay([], []);
    expect(view.byEventRef.size).toBe(0);
    expect(view.annotations).toEqual([]);
    expect(view.events).toEqual([]);
  });

  it('groups multiple annotations that share one eventRef under that key', () => {
    // The fixture authors one annotation per anchor, so the multi-annotation-per-event branch
    // is only reachable here. The map value is the FULL list, preserving input order.
    const a = annotation('e-1', 'dispel');
    const b = annotation('e-1', 'shaman');
    const c = annotation('e-2', 'summon');
    const view = applyOverlay([], [a, b, c]);

    expect(view.byEventRef.get('e-1')).toEqual([a, b]);
    expect(view.byEventRef.get('e-2')).toEqual([c]);
    expect(view.byEventRef.size).toBe(2);
  });

  it('returns undefined for an eventRef that no annotation anchors to', () => {
    const view = applyOverlay([], [annotation('e-1', 'dispel')]);
    expect(view.byEventRef.get('absent')).toBeUndefined();
  });

  it('passes the SAME events array reference through (no copy, no rewrite)', () => {
    // The overlay is a view, not a transform: Layer-0 events pass through untouched.
    const events: NormalizedEvent[] = [];
    const view = applyOverlay(events, []);
    expect(view.events).toBe(events);
  });
});
