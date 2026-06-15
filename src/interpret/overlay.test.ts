import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type BeatAnnotation } from '../schema/beat-annotation';
import { type NormalizedEvent } from '../schema/normalized-event';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';

// RED-PHASE acceptance test for Story 3.1 — AC2: the READ-ONLY overlay. It imports the
// not-yet-authored `./overlay` (applyOverlay + AnnotatedView) and `./fixture-interpreter`,
// so it ERRORS now (RED); turns GREEN when the dev authors them.
//
// AC2 (verbatim, epics.md#Story-3.1): "Given the annotations When they are consumed Then
// they apply as a READ-ONLY overlay — they never feed HP/pacing math, and no Layer-0 module
// imports interpret/ (R1) And every BeatAnnotation carries a groundingPointer resolving back
// to the Layer-0 event(s) it dramatizes."
import { applyOverlay } from './overlay';
import { FixtureInterpreter } from './fixture-interpreter';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'ingest', '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

function runIngest(): NormalizedEvent[] {
  const transcript = normalizeTranscript(
    parseTranscript(readFixture('sample-transcript.jsonl'), DEV_STREAM_ID),
    DEV_STREAM_ID,
  );
  const devMaxEpoch = Math.max(
    ...transcript.map((e) => Date.parse(e.timestamp)).filter((n) => !Number.isNaN(n)),
  );
  const journal = normalizeJournal(parseJournal(readFixture('sample-journal.jsonl')), devMaxEpoch + 1);
  return mergeStreams([transcript, journal]);
}

async function fixtureAnnotations(): Promise<BeatAnnotation[]> {
  return new FixtureInterpreter().interpret(runIngest());
}

describe('Story 3.1 / AC2 — every groundingPointer resolves to a real fixture eventId (no dangling refs)', () => {
  it('resolves every eventRef AND every groundingPointer.eventRefs entry to one of the 14 fixture events', async () => {
    // The headline AC2 proof: "every BeatAnnotation carries a groundingPointer resolving back
    // to the Layer-0 event(s) it dramatizes." Build the id set from the real ingest output and
    // assert no annotation points outside it.
    const events = runIngest();
    const ids = new Set(events.map((e) => e.eventId));
    const annotations = await fixtureAnnotations();
    expect(annotations.length).toBeGreaterThan(0);
    for (const a of annotations) {
      expect(ids.has(a.eventRef)).toBe(true);
      // The anchor is always part of what the beat dramatizes — guards against a future
      // edit that drops the anchor out of its own grounding set (which would still resolve
      // but break the eventRef⊆groundingPointer.eventRefs invariant the portal relies on).
      expect(a.groundingPointer.eventRefs).toContain(a.eventRef);
      expect(a.groundingPointer.eventRefs.length).toBeGreaterThan(0);
      for (const ref of a.groundingPointer.eventRefs) {
        expect(ids.has(ref)).toBe(true);
      }
    }
  });

  it('dramatizes the Layer-0 event(s) — at least one beat grounds to MORE than its anchor', async () => {
    // AC2 reads "resolving back to the Layer-0 event(s) it dramatizes" — the plural is
    // load-bearing: a Dispel spans an assumption PLUS its ground-truth Read. The resolution
    // loop above would pass even if every grounding collapsed to the single trivially-resolving
    // anchor, so pin that the multi-event dramatization the fixture authors actually survives.
    const annotations = await fixtureAnnotations();
    const multiEvent = annotations.filter((a) => a.groundingPointer.eventRefs.length > 1);
    expect(multiEvent.length).toBeGreaterThan(0);
  });
});

describe('Story 3.1 / AC2 — applyOverlay is read-only (does NOT mutate its inputs)', () => {
  it('leaves both input arrays structurally unchanged after the call', async () => {
    // The verbatim ingest.test.ts L127-138 no-mutation proof pattern, applied to the overlay:
    // snapshot the inputs, call, assert the serialized inputs are byte-identical.
    const events = runIngest();
    const annotations = await fixtureAnnotations();
    const snapshotBefore = JSON.stringify([events, annotations]);
    applyOverlay(events, annotations);
    expect(JSON.stringify([events, annotations])).toBe(snapshotBefore);
  });

  it('passes the L0 events and L1 annotations through unchanged (side-by-side, not rewritten)', async () => {
    const events = runIngest();
    const annotations = await fixtureAnnotations();
    const view = applyOverlay(events, annotations);
    // Deep-equal pass-through: the view exposes the same events/annotations, not denormalized
    // or folded copies.
    expect(view.events).toEqual(events);
    expect(view.annotations).toEqual(annotations);
  });
});

describe('Story 3.1 / AC2 — the view indexes annotations by their anchor eventRef', () => {
  it('maps u-0002#1 -> the Dispel and u-0010#0 -> the Shaman', async () => {
    const events = runIngest();
    const annotations = await fixtureAnnotations();
    const view = applyOverlay(events, annotations);

    const atDispel = view.byEventRef.get('u-0002#1') ?? [];
    expect(atDispel.some((a: BeatAnnotation) => a.beatType === 'dispel')).toBe(true);

    const atShaman = view.byEventRef.get('u-0010#0') ?? [];
    expect(atShaman.some((a: BeatAnnotation) => a.beatType === 'shaman')).toBe(true);
  });

  it('returns nothing for an un-annotated event id (e.g. u-0001)', async () => {
    const events = runIngest();
    const annotations = await fixtureAnnotations();
    const view = applyOverlay(events, annotations);
    // Pin the actual contract: a key only exists when an annotation anchors to it, so an
    // un-annotated id is absent (undefined). The previous `undefined || length===0`
    // disjunction passed for two different contracts and hid which one the code implements.
    expect(view.byEventRef.get('u-0001')).toBeUndefined();
  });
});

describe('Story 3.1 / AC2 — the overlay never folds interpretation into mechanics (R1 at the data level)', () => {
  // The overlay carries NormalizedEvent[] + BeatAnnotation[] SIDE-BY-SIDE — neither type
  // carries HP/pacing — so no BattleState/Beat mechanics field may appear in the view's own
  // structure (its top-level keys) nor on any annotation. (architecture.md#Anti-Patterns L296:
  // "Using a BeatAnnotation to add/subtract HP or change pacing weight (breaks R1)".)
  const MECHANICS_KEYS = [
    'problemIntegrity',
    'resolve',
    'insightGauge',
    'hp',
    'weight',
    'dwellMs',
    'victory',
    'cursor',
    'enemies',
  ];

  it('exposes only the read-only view surface (events, annotations, byEventRef) — no mechanics keys', async () => {
    const events = runIngest();
    const annotations = await fixtureAnnotations();
    const view = applyOverlay(events, annotations);
    const viewKeys = Object.keys(view);
    for (const mech of MECHANICS_KEYS) {
      expect(viewKeys).not.toContain(mech);
    }
    // The view is the side-by-side shape, nothing more.
    expect(viewKeys.sort()).toEqual(['annotations', 'byEventRef', 'events']);
  });

  it('carries no mechanics field on any annotation (annotations stay pure Layer-1)', async () => {
    const view = applyOverlay(runIngest(), await fixtureAnnotations());
    for (const a of view.annotations) {
      for (const mech of MECHANICS_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(a, mech)).toBe(false);
      }
    }
  });

  it('does not fold an annotation onto any Layer-0 event (no event.annotation / event.beatType)', async () => {
    const view = applyOverlay(runIngest(), await fixtureAnnotations());
    for (const e of view.events) {
      expect(Object.prototype.hasOwnProperty.call(e, 'annotation')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(e, 'beatType')).toBe(false);
    }
  });
});
