import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BeatAnnotation } from '../schema/beat-annotation';

// RED-PHASE acceptance tests for Story 4.4 (Task 2) — the PURE transparency-portal core
// (src/portal/portal.ts): the AC1 coverage surface (`getLegendEntries`) + the AC2 grounding resolver
// (`resolveGrounding`). These FAIL until portal.ts is authored and exports LEGEND_BEATS, LEGEND_ACTIONS,
// getLegendEntries, and resolveGrounding (the import below resolves to nothing and the module import
// ERRORs — the intended red). This is the GATE: the AC's gate-verifiable half (the layout/feel is
// operator-verified, never asserted here).
//
// These run under NODE (no DOM) — the portal core is phaser-free + pure. The grounding-resolution tests
// build the read-only AnnotatedView from the COMMITTED fixture (the SAME parse->normalize->merge chain
// the golden snapshot pins + the FixtureInterpreter's hand-authored annotations), so the dispel/shaman
// grounding resolves END-TO-END to real Layer-0 eventIds, exactly as it does at boot. A FABRICATED
// dangling-ref annotation proves the fail-loud policy (story Dev Notes #4). [story Task 2; AC1, AC2]
import {
  LEGEND_BEATS,
  LEGEND_ACTIONS,
  getLegendEntries,
  resolveGrounding,
  resolveActiveBeatGrounding,
} from './portal';
import type { LegendActionType } from './portal';
import { applyOverlay } from '../interpret/overlay';
import type { AnnotatedView } from '../interpret/overlay';
import { fixtureAnnotations } from '../interpret/fixture-interpreter';
// NOTE (dev-story, GREEN): the ATDD scaffold imported `pace`/`translate` here but never referenced
// them — the portal grounding tests resolve against the read-only AnnotatedView (events + annotations),
// not a paced BattleTimeline. Removed the two dead imports to satisfy strict tsc/eslint no-unused-vars.
// No assertion referenced them, so nothing is weakened. [story "fix the test WITH a documented justification"]
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';
import { BeatTypeSchema } from '../schema/beat-annotation';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'ingest', '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

// The committed-fixture ingest chain (copied verbatim from controls.test.ts / arena-boot-*.test.ts):
// the SAME events the boot folds AND builds the read-only overlay over. Tests are not Layer-0 modules,
// so reading fixtures with fs in the test respects R2.
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

// The committed read-only overlay (events side-by-side with the FixtureInterpreter's annotations) —
// the EXACT `view: AnnotatedView` arena-boot.ts builds at boot (applyOverlay(events, fixtureAnnotations())).
// dev-story (Story 5.5): AnnotatedView is now generic in its event element; annotate <NormalizedEvent>
// so resolveGrounding here returns the FULL events these Story 4.4 assertions read (toolName/eventType).
// This suite resolves over the full Layer-0 events (bake-time view); the abstracted-projection grounding
// is covered separately in abstracted-grounding.test.ts. No behavior changed — only the explicit type arg.
function committedView(): AnnotatedView<NormalizedEvent> {
  return applyOverlay(runIngest(), fixtureAnnotations());
}

function annotationOf(view: AnnotatedView, beatType: 'shaman' | 'dispel' | 'summon'): BeatAnnotation {
  const a = view.annotations.find((x) => x.beatType === beatType);
  if (!a) throw new Error(`no committed ${beatType} annotation in the fixture overlay`);
  return a;
}

// ---------------------------------------------------------------------------------------------------
// AC1 — Legend COVERAGE: the 3 beats + the 4 core actions, every required key present.
// ---------------------------------------------------------------------------------------------------

describe('Story 4.4 AC1 — the Legend COVERS the three beats and the four core actions', () => {
  it('LEGEND_BEATS is exactly the three signature BeatType members (shaman/dispel/summon)', () => {
    expect([...LEGEND_BEATS].sort()).toEqual(['dispel', 'shaman', 'summon']);
    // Each member is a real BeatType (the closed union the schema validates).
    for (const beat of LEGEND_BEATS) {
      expect(() => BeatTypeSchema.parse(beat)).not.toThrow();
    }
  });

  it('LEGEND_ACTIONS is exactly the four CORE actions the AC names (a SUBSET of ActionType)', () => {
    // strike/edit, spell/test, scout/read, Aether Storm/rate-limit -> melee | spell | scout | aetherStorm.
    // summon is a BEAT (covered above), counter/idle are NOT Legend action rows (story Dev Notes #3).
    expect([...LEGEND_ACTIONS].sort()).toEqual(['aetherStorm', 'melee', 'scout', 'spell']);
    const forbidden: string[] = ['summon', 'counter', 'idle'];
    for (const f of forbidden) {
      expect((LEGEND_ACTIONS as readonly string[]).includes(f)).toBe(false);
    }
  });

  it('getLegendEntries() returns one display-ready row per covered key, beats first then actions', () => {
    const entries = getLegendEntries();
    // 3 beats + 4 actions = 7 covered rows.
    expect(entries).toHaveLength(LEGEND_BEATS.length + LEGEND_ACTIONS.length);
    expect(entries).toHaveLength(7);

    // Every entry carries a kind/key and a NON-EMPTY fantasy<->real pair (the coverage proof: nothing
    // covered is blank). [story Task 2 "each { kind, key, fantasy, real }, non-empty"]
    for (const e of entries) {
      expect(e.kind === 'beat' || e.kind === 'action').toBe(true);
      expect(typeof e.fantasy).toBe('string');
      expect(e.fantasy.length).toBeGreaterThan(0);
      expect(typeof e.real).toBe('string');
      expect(e.real.length).toBeGreaterThan(0);
    }

    // EVERY required beat key is present as a beat entry...
    const beatKeys = entries.filter((e) => e.kind === 'beat').map((e) => e.key);
    expect([...beatKeys].sort()).toEqual([...LEGEND_BEATS].sort());
    // ...and EVERY required core-action key is present as an action entry.
    const actionKeys = entries.filter((e) => e.kind === 'action').map((e) => e.key);
    expect([...actionKeys].sort()).toEqual([...LEGEND_ACTIONS].sort());

    // Ordering: beats come BEFORE actions (the renderer + the gate iterate ONE canonical list).
    const firstActionIdx = entries.findIndex((e) => e.kind === 'action');
    const lastBeatIdx = entries.map((e) => e.kind).lastIndexOf('beat');
    expect(lastBeatIdx).toBeLessThan(firstActionIdx);
  });
});

// ---------------------------------------------------------------------------------------------------
// AC2 — Grounding resolution (fantasy -> real), accurate to the real Event, no dangling, fail-loud.
// ---------------------------------------------------------------------------------------------------

describe('Story 4.4 AC2 — resolveGrounding maps a beat to the real Layer-0 Event(s) it dramatizes', () => {
  it('the DISPEL annotation resolves to the real events u-0002#1, u-0002#2, u-0003#0 IN ORDER', () => {
    const view = committedView();
    const dispel = annotationOf(view, 'dispel');
    // The committed dispel grounds the assumption/text + the ground-truth Read pair.
    expect(dispel.groundingPointer.eventRefs).toEqual(['u-0002#1', 'u-0002#2', 'u-0003#0']);

    const resolved = resolveGrounding(dispel, view);
    expect(resolved.map((e) => e.eventId)).toEqual(['u-0002#1', 'u-0002#2', 'u-0003#0']);
    // Accurate to the REAL Event: u-0002#2 is the ground-truth Read (toolName 'Read'); the resolved
    // event is the SAME Layer-0 truth, not a fabricated claim (AC2 "every explanation accurate").
    const read = resolved.find((e) => e.eventId === 'u-0002#2');
    expect(read?.toolName).toBe('Read');
    expect(read?.eventType).toBe('tool_use');
  });

  it('the SHAMAN annotation resolves to its real root-cause events u-0009#0, u-0010#0 IN ORDER', () => {
    const view = committedView();
    const shaman = annotationOf(view, 'shaman');
    expect(shaman.groundingPointer.eventRefs).toEqual(['u-0009#0', 'u-0010#0']);

    const resolved = resolveGrounding(shaman, view);
    expect(resolved.map((e) => e.eventId)).toEqual(['u-0009#0', 'u-0010#0']);
    // The diagnostic re-read is the real Read tool_use at u-0010#0 (accurate to the real Event).
    const reread = resolved.find((e) => e.eventId === 'u-0010#0');
    expect(reread?.toolName).toBe('Read');
  });

  it('the resolved events are the SAME object identities the overlay carries (read side-by-side, not rebuilt)', () => {
    const view = committedView();
    const dispel = annotationOf(view, 'dispel');
    const resolved = resolveGrounding(dispel, view);
    for (const e of resolved) {
      const fromView = view.events.find((x) => x.eventId === e.eventId);
      expect(e).toBe(fromView); // referential identity: resolver READS the overlay, returns Layer-0 truth
    }
  });

  it('a FABRICATED dangling ref FAILS LOUD (throws) — a corrupt-overlay programmer error, never a silent drop', () => {
    const view = committedView();
    // A hand-built annotation whose grounding points at an eventId NOT in the overlay. Story 3.1/3.2
    // already enforce "no dangling groundingPointer.eventRef" as a build-time invariant, so a dangling
    // ref at portal-resolve time is corruption — fail loud (story Dev Notes #4), do NOT silent-skip.
    const dangling: BeatAnnotation = {
      eventRef: 'u-0002#1',
      beatType: 'dispel',
      confidence: 0.8,
      interpreterVersion: 'fixture-v1',
      sourceHash: 'fixture',
      groundingPointer: { eventRefs: ['u-0002#1', 'does-not-exist#0'] },
    };
    expect(() => resolveGrounding(dangling, view)).toThrow();
  });
});

describe('Story 4.4 AC2 — resolveGrounding is PURE: deterministic + mutates no input (R1/R2)', () => {
  it('calling twice on the same inputs yields deep-equal output (determinism)', () => {
    const view = committedView();
    const dispel = annotationOf(view, 'dispel');
    expect(resolveGrounding(dispel, view)).toEqual(resolveGrounding(dispel, view));
  });

  it('does not mutate the annotation or the read-only view (no fold into mechanics)', () => {
    const view = committedView();
    const dispel = annotationOf(view, 'dispel');

    const annotationBefore = structuredClone(dispel);
    const eventsLenBefore = view.events.length;
    const annotationsLenBefore = view.annotations.length;
    const eventsSnapshot = structuredClone([...view.events]);

    resolveGrounding(dispel, view);

    expect(dispel).toEqual(annotationBefore); // the input annotation is untouched
    expect(view.events.length).toBe(eventsLenBefore); // the overlay is untouched
    expect(view.annotations.length).toBe(annotationsLenBefore);
    expect([...view.events]).toEqual(eventsSnapshot); // no event was mutated in place
  });

  it('the resolved events carry NO injected mechanics field (the R1 data-level proof)', () => {
    // resolveGrounding returns Layer-0 NormalizedEvents read side-by-side; it must NOT decorate them
    // with a BattleState mechanics key (problemIntegrity/resolve/insightGauge/hp/weight). The returned
    // events have exactly the NormalizedEvent shape — none of those keys exist on them.
    const view = committedView();
    const resolved = resolveGrounding(annotationOf(view, 'shaman'), view);
    for (const e of resolved) {
      const rec = e as unknown as Record<string, unknown>;
      for (const mech of ['problemIntegrity', 'resolve', 'insightGauge', 'hp', 'weight']) {
        expect(Object.prototype.hasOwnProperty.call(rec, mech)).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// AC2 (summon symmetry, UNIT-only) — the committed FixtureInterpreter OMITS summon by design (the
// 3.3/3.4 honest gap). A hand-built summon annotation over the same real events proves the resolver's
// SHAPE for summon without injecting a false grounding into the production overlay. [story testing
// standards "a hand-built annotation covers the summon grounding shape"; Dev Notes #3]
// ---------------------------------------------------------------------------------------------------

describe('Story 4.4 AC2 — resolveGrounding handles a hand-built summon annotation (symmetry, unit-only)', () => {
  it('resolves a fabricated summon grounding to the matching real events in order', () => {
    const view = committedView();
    const summon: BeatAnnotation = {
      eventRef: 'u-0008#0',
      beatType: 'summon',
      confidence: 0.6,
      interpreterVersion: 'hand-built',
      sourceHash: 'unit',
      // All refs DO exist in the committed overlay (so this is a valid, non-dangling grounding).
      groundingPointer: { eventRefs: ['u-0008#0', 'u-0009#0'] },
    };
    const resolved = resolveGrounding(summon, view);
    expect(resolved.map((e) => e.eventId)).toEqual(['u-0008#0', 'u-0009#0']);
  });
});

// ---------------------------------------------------------------------------------------------------
// AC2 (the active-beat convenience) — resolveActiveBeatGrounding: pick a beatType's annotation from the
// read-only overlay and resolve it, or null when the overlay carries none of that beat. This is the
// renderer's "active beat -> real event(s)" feed (the boot wires it per cursor); it is a PUBLIC export
// of the pure core with a fail-closed null branch that was previously untested. [story Task 2, AC2]
// TEST-REVIEW (Story 4.4 test-quality pass): added — resolveActiveBeatGrounding had zero direct tests.
// ---------------------------------------------------------------------------------------------------

describe('Story 4.4 AC2 — resolveActiveBeatGrounding selects a beat`s annotation and resolves it (or null)', () => {
  it('resolves a PRESENT beat (dispel) to the same real events resolveGrounding gives for its annotation', () => {
    const view = committedView();
    const resolved = resolveActiveBeatGrounding(view, 'dispel');
    expect(resolved).not.toBeNull();
    expect(resolved!.map((e) => e.eventId)).toEqual(['u-0002#1', 'u-0002#2', 'u-0003#0']);
    // It is exactly resolveGrounding over the picked annotation (the convenience adds no divergent logic).
    const dispel = annotationOf(view, 'dispel');
    expect(resolved).toEqual(resolveGrounding(dispel, view));
  });

  it('returns NULL for a beat the committed overlay omits (summon — the 3.3/3.4 honest gap, fail-closed)', () => {
    // summon has NO annotation in the FixtureInterpreter by design, so the accessor returns null rather
    // than fabricating a grounding — the fail-closed-to-default branch the renderer relies on to hide the
    // reveal section. (Contrast resolveGrounding's fail-LOUD on a dangling ref: a MISSING beat is a normal
    // "nothing to reveal" condition; a dangling ref inside a present beat is overlay corruption.)
    const view = committedView();
    expect(resolveActiveBeatGrounding(view, 'summon')).toBeNull();
  });
});

// Compile-time anchor: LegendActionType is the exported closed union of the four core actions. A value
// outside it would not assign. (Keeps the type exported + used so the renderer/coverage list agree.)
const _actionTypeAnchor: readonly LegendActionType[] = ['melee', 'spell', 'scout', 'aetherStorm'];
void _actionTypeAnchor;
