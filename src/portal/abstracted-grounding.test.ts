import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BeatAnnotation } from '../schema/beat-annotation';

// RED-PHASE acceptance test for Story 5.5 — Task 4 / AC4: the transparency portal grounds a beat to
// the ABSTRACTED projection (tool + role + outcome + teaching concept), NOT raw events / file names.
//
// It imports the NOT-YET-AUTHORED `resolveAbstractedGrounding` (+ the AbstractedGrounding row type) from
// `./portal` and the NOT-YET-AUTHORED `projectEvents` from `../bundle/project-events`, so it ERRORS now
// (RED — module/symbol resolution fails). It turns GREEN when the dev (Task 4) adds
// `resolveAbstractedGrounding(annotation, view): readonly AbstractedGrounding[]` (where
// AbstractedGrounding = { tool: string|null, role: AbstractedRole, outcome: Outcome, concept: string })
// and re-types AnnotatedView.events to ProjectedEvent[].
//
// AC4 (verbatim): "...it shows the abstracted grounding (tool + role + outcome + teaching concept)
// resolved from the beat's groundingPointer, accurate to the real Event at the abstracted level, with
// NO raw transcript and NO file/symbol name shown..."
//
// These run under NODE (no DOM) — the portal core is phaser-free + pure. The view is built from the
// COMMITTED fixture (the SAME parse→normalize→merge chain the golden snapshot pins + the
// FixtureInterpreter's hand-authored annotations), PROJECTED to ProjectedEvent[], so dispel + shaman
// resolve END-TO-END on the real fixture (the committed tags: dispel@u-0002#1, shaman@u-0010#0).
import { resolveAbstractedGrounding, type AbstractedGrounding } from './portal';
import { applyOverlay } from '../interpret/overlay';
import type { AnnotatedView } from '../interpret/overlay';
import type { ProjectedEvent } from '../schema/replay-bundle';
import { fixtureAnnotations } from '../interpret/fixture-interpreter';
import { projectEvents } from '../bundle/project-events';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';
import { TEACHING } from './teaching-config';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'ingest', '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

// The committed-fixture ingest chain (the SAME the boot folds + builds the overlay over).
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

// The Story 5.5 overlay: events are the PROJECTED events (AnnotatedView.events is re-typed to
// ProjectedEvent[] — Dev Notes §6), paired with the committed FixtureInterpreter annotations. The
// projection preserves every eventId the annotations reference (§1), so grounding resolves by eventId.
function committedProjectedView(): AnnotatedView<ProjectedEvent> {
  const projected = projectEvents(runIngest());
  // dev-story (Task 4): applyOverlay is generic in its event element (Dev Notes §6), so it pairs the
  // ProjectedEvent[] side-by-side with annotations directly — inferring AnnotatedView<ProjectedEvent>.
  // The ATDD scaffold cast `projected as unknown as NormalizedEvent[]` (to feed the OLD signature) is
  // removed: it is now both unnecessary AND wrong — resolveAbstractedGrounding requires the view to carry
  // ProjectedEvent (the abstracted role/outcome live there). No assertion weakened; the view is sharper.
  return applyOverlay(projected, fixtureAnnotations());
}

function annotationOf(view: AnnotatedView, beatType: 'shaman' | 'dispel' | 'summon'): BeatAnnotation {
  const a = view.annotations.find((x) => x.beatType === beatType);
  if (!a) throw new Error(`no committed ${beatType} annotation in the fixture overlay`);
  return a;
}

// The exact set of fields an AbstractedGrounding row may carry — the abstracted level AC4 demands.
const ROW_KEYS = ['tool', 'role', 'outcome', 'concept'].sort();
const ROLE_TOKENS = new Set(['test', 'schema', 'migration', 'config', 'doc', 'source']);
const OUTCOMES = new Set(['success', 'isError']);

// ---------------------------------------------------------------------------------------------------
// AC4 — resolveAbstractedGrounding maps a beat's groundingPointer to {tool, role, outcome, concept}
// rows, IN ORDER, accurate to the projected events. Proven on the committed fixture for dispel + shaman.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC4 — resolveAbstractedGrounding grounds DISPEL to abstracted rows (committed fixture)', () => {
  it('resolves dispel`s eventRefs to rows IN ORDER, each {tool, role, outcome, concept}', () => {
    const view = committedProjectedView();
    const dispel = annotationOf(view, 'dispel');
    expect(dispel.groundingPointer.eventRefs).toEqual(['u-0002#1', 'u-0002#2', 'u-0003#0']);

    const rows = resolveAbstractedGrounding(dispel, view);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(Object.keys(row as object).sort()).toEqual(ROW_KEYS);
      expect(ROLE_TOKENS.has((row as AbstractedGrounding).role)).toBe(true);
      expect(OUTCOMES.has((row as AbstractedGrounding).outcome)).toBe(true);
    }

    // Accurate to the real Event at the ABSTRACTED level: u-0002#2 is the ground-truth Read on a SCHEMA
    // path → { tool: 'Read', role: 'schema', outcome: 'success' }. The verbatim path/name NEVER appears.
    const read = rows[1] as AbstractedGrounding;
    expect(read.tool).toBe('Read');
    expect(read.role).toBe('schema');
    expect(read.outcome).toBe('success');
  });

  it('the concept is the dispel teaching one-liner (reused from teaching.json — no invented copy)', () => {
    const view = committedProjectedView();
    const rows = resolveAbstractedGrounding(annotationOf(view, 'dispel'), view);
    // AC4's "teaching concept" REUSES the Story 4.3 teaching.json plain-dev one-liner for the beat
    // (Dev Notes §6 — do NOT invent new copy). Every row for the dispel beat carries the dispel concept.
    for (const row of rows) {
      expect((row as AbstractedGrounding).concept).toBe(TEACHING.dispel);
    }
  });
});

describe('Story 5.5 AC4 — resolveAbstractedGrounding grounds SHAMAN to abstracted rows (committed fixture)', () => {
  it('resolves shaman`s eventRefs (u-0009#0, u-0010#0) to abstracted rows in order', () => {
    const view = committedProjectedView();
    const shaman = annotationOf(view, 'shaman');
    expect(shaman.groundingPointer.eventRefs).toEqual(['u-0009#0', 'u-0010#0']);

    const rows = resolveAbstractedGrounding(shaman, view);
    expect(rows).toHaveLength(2);

    // u-0009#0 is the FAILED tool_result → outcome 'isError' (a path-less result → role 'source', tool null).
    const failResult = rows[0] as AbstractedGrounding;
    expect(failResult.outcome).toBe('isError');
    expect(failResult.tool).toBeNull();
    // u-0010#0 is the diagnostic re-read Read tool_use → { tool: 'Read', outcome: 'success' }.
    const reread = rows[1] as AbstractedGrounding;
    expect(reread.tool).toBe('Read');
    expect(reread.outcome).toBe('success');

    for (const row of rows) {
      expect((row as AbstractedGrounding).concept).toBe(TEACHING.shaman);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// AC4 — the abstracted rows leak NO file/symbol name and NO raw transcript content.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC4 — the abstracted grounding rows carry NO file/symbol name, NO raw content', () => {
  it('the serialized rows contain none of the fixture raw paths/names/content', () => {
    const view = committedProjectedView();
    const rows = [
      ...resolveAbstractedGrounding(annotationOf(view, 'dispel'), view),
      ...resolveAbstractedGrounding(annotationOf(view, 'shaman'), view),
    ];
    const serialized = JSON.stringify(rows);
    const mustBeAbsent: readonly string[] = [
      '/work/project/src/schema/normalized-event.ts',
      'normalized-event.ts',
      '/work/project/src/ingest/normalize.ts',
      'normalize.ts',
      'parse-transcript.ts',
      'export const NormalizedEventSchema',
      'Kickoff: implement the ingest pipeline',
      '/work/project',
    ];
    for (const needle of mustBeAbsent) {
      expect(serialized).not.toContain(needle);
    }
  });

  it('every row has EXACTLY the abstracted fields {tool, role, outcome, concept} — nothing path-shaped', () => {
    const view = committedProjectedView();
    const rows = resolveAbstractedGrounding(annotationOf(view, 'dispel'), view);
    for (const row of rows) {
      expect(Object.keys(row as object).sort()).toEqual(ROW_KEYS);
      // tool is a tool NAME (e.g. 'Read') or null — never a file path.
      const tool = (row as AbstractedGrounding).tool;
      if (tool !== null) expect(tool).not.toContain('/');
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// AC4 — fail LOUD on a dangling ref (the existing frozen-overlay invariant policy; do NOT silent-skip).
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC4 — resolveAbstractedGrounding FAILS LOUD on a fabricated dangling ref', () => {
  it('throws when a groundingPointer.eventRef resolves to no projected event', () => {
    const view = committedProjectedView();
    const dangling: BeatAnnotation = {
      eventRef: 'u-0002#1',
      beatType: 'dispel',
      confidence: 0.8,
      interpreterVersion: 'fixture-v1',
      sourceHash: 'fixture',
      groundingPointer: { eventRefs: ['u-0002#1', 'does-not-exist#0'] },
    };
    expect(() => resolveAbstractedGrounding(dangling, view)).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------
// AC4 (R1/R2) — PURE: deterministic + mutates no input.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC4 — resolveAbstractedGrounding is PURE (deterministic + no input mutation)', () => {
  it('calling twice on the same inputs yields deep-equal rows (determinism)', () => {
    const view = committedProjectedView();
    const dispel = annotationOf(view, 'dispel');
    expect(resolveAbstractedGrounding(dispel, view)).toEqual(
      resolveAbstractedGrounding(dispel, view),
    );
  });

  it('does not mutate the annotation or the read-only view', () => {
    const view = committedProjectedView();
    const dispel = annotationOf(view, 'dispel');
    const annotationBefore = structuredClone(dispel);
    const eventsBefore = structuredClone([...view.events]);
    resolveAbstractedGrounding(dispel, view);
    expect(dispel).toEqual(annotationBefore);
    expect([...view.events]).toEqual(eventsBefore);
  });
});
