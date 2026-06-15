import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { GroundingPointer } from '../schema/beat-annotation';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';

// RED-PHASE acceptance test for Story 3.3 (Task 1 + Task 4) — the cross-layer SIGNAL TYPE
// `BeatSignal` that Layer-1 (interpret/) emits for OTHER layers (scribe/portal, FR-9) to consume,
// plus its tiny constructor `scribeCorrection` (story Task 1: "pure types + maybe a tiny
// constructor"). It imports those from the not-yet-authored `./beat-signal` — `scribeCorrection`
// is a RUNTIME value import that resolves to nothing now, so this file ERRORS at import time (the
// intended RED — the exact posture overlay.test.ts / animation-plan.test.ts held in their own red
// phase). [A type-only `import type { BeatSignal }` alone would be ERASED before runtime and pass
// vacuously, so the value import of `scribeCorrection` is the load-bearing runtime RED here.] Goes
// GREEN only when the dev authors src/interpret/beat-signal.ts (the BeatSignal union + the
// constructor). The test stays WITHIN interpret/ + schema/ (no render/ dependency) — the signal's
// home — honoring the "scribe/ + interpret never depend on render/" discipline (story Dev Notes).
//
// AC2 (verbatim, epics.md#Story-3.3): "Given a tagged Dispel ... Then ... a Scribe-correction
// signal is emitted (consumed by FR-9)." This pins the FR-9 contract from the PRODUCER side: a
// scribe-correction signal is constructable with the documented shape and its grounding.eventRefs
// resolve against the real fixture event ids (no dangling refs) — the Story 3.1 overlay-grounding
// assertion posture (overlay.test.ts L46-66). (The end-to-end "the Dispel transition emits exactly
// one such signal" is proven in beat-behavior.test.ts where the producer planBeatBehaviors lives.)
//
// WHY this type lives in interpret/ (NOT render/): the signal is a CROSS-LAYER output that BOTH the
// render behavior plan EMITS and scribe/captions.ts (Story 4.1) CONSUMES. Homing it in render/ would
// invert R5 ("nothing depends on render/"); interpret/ (L1) is "consumed by scribe/ + portal/ + the
// render overlay" — so both consumers depending on interpret/ is the documented, correct direction.
// [story Dev Notes "Where the signal type lives"]
//
// Pipeline reuse: the same committed-fixture chain as overlay.test.ts L30-40 (copied verbatim).
import { scribeCorrection, type BeatSignal } from './beat-signal';

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

describe('Story 3.3 AC2 — BeatSignal: the scribe-correction cross-layer signal is well-formed', () => {
  it('scribeCorrection builds a signal with the documented FR-9 shape { kind, beatType, cursor, grounding }', () => {
    // The v0.1 contract (story Dev Notes "Intent + signal shapes"): a discriminated union whose only
    // variant is { kind:'scribe-correction'; beatType:'dispel'; cursor:number; grounding:GroundingPointer }.
    // The constructor produces exactly that variant; annotating it `BeatSignal` is the producer-side
    // type proof (a different authored shape fails `pnpm typecheck`).
    const grounding: GroundingPointer = { eventRefs: ['u-0002#1', 'u-0002#2', 'u-0003#0'] };
    const signal: BeatSignal = scribeCorrection(1, grounding);

    expect(signal.kind).toBe('scribe-correction');
    expect(signal.beatType).toBe('dispel');
    expect(signal.cursor).toBe(1);
    expect(signal.grounding.eventRefs).toEqual(['u-0002#1', 'u-0002#2', 'u-0003#0']);
  });

  it('the union is discriminated by `kind` (a narrow on kind exposes the dispel correction fields)', () => {
    // Pin that `kind` is the discriminant — narrowing on it must expose beatType/cursor/grounding.
    // This keeps the union OPEN for future beat-fired signals appending with no consumer break, while
    // proving the v0.1 variant is reachable through the discriminant.
    const signal: BeatSignal = scribeCorrection(5, { eventRefs: ['u-0002#1'] });
    if (signal.kind === 'scribe-correction') {
      expect(signal.beatType).toBe('dispel');
      expect(typeof signal.cursor).toBe('number');
      expect(Array.isArray(signal.grounding.eventRefs)).toBe(true);
    } else {
      // No other variant exists in v0.1; reaching here would mean the discriminant did not narrow.
      throw new Error('scribe-correction did not narrow on `kind`');
    }
  });
});

describe('Story 3.3 AC2 — the signal grounding resolves to real fixture events (the FR-9 cross-out target)', () => {
  it("a Dispel signal's grounding.eventRefs all resolve to fixture event ids (no dangling refs)", () => {
    // FR-9 (Story 4.1) uses grounding to LOCATE + cross out the prior caption — so every ref must point
    // at a real Layer-0 event, exactly the overlay.test.ts L46-66 grounding-resolves proof. The Dispel's
    // grounding is the FixtureInterpreter's authored set for u-0002#1.
    const events = runIngest();
    const ids = new Set(events.map((e) => e.eventId));
    const signal = scribeCorrection(1, { eventRefs: ['u-0002#1', 'u-0002#2', 'u-0003#0'] });

    expect(signal.grounding.eventRefs.length).toBeGreaterThan(0);
    for (const ref of signal.grounding.eventRefs) {
      expect(ids.has(ref)).toBe(true);
    }
  });
});
