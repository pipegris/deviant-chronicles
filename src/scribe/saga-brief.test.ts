import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProjectedEvent } from '../schema/replay-bundle';
import type { BeatAnnotation } from '../schema/beat-annotation';
import { TEACHING } from '../portal/teaching-config';

// RED-PHASE acceptance test for Story 5.8 (AC1, AC3) — the PURE, name-free Saga brief builder.
// It imports the not-yet-authored `./saga-brief` (buildSagaBrief + SagaBrief types), so it ERRORS now
// (RED — module resolution fails); it turns GREEN when the dev authors src/scribe/saga-brief.ts as a
// pure, deterministic builder over ONLY the name-free public surface (projectedEvents + frozen beats +
// teaching). DO NOT add production code to make this pass here — this is the red half of red-green.
//
// The load-bearing line (Story 5.5 hard line, now pushed to Layer 2 / Told): the Saga is authored over
// the SAME name-free data the public bundle already ships, so the brief can leak NOTHING the bundle does
// not already safely expose. These assertions encode AC1 (name-free input, deterministic, no mutation)
// and AC3 (the brief is a provably name-free SUBSET of the public surface).
import { buildSagaBrief } from './saga-brief';

// --- Fixtures: a representative public surface whose SOURCE fields are deliberately constructed so that
// IF the builder ever pulled from payload/snippet/path (it structurally cannot — ProjectedEvent and
// BeatAnnotation have no such field), a real identifier would leak. The brief must be name-free anyway.
//
// The representative real-identifier set (from the Story 5.7 real-bake leak, story §0): if ANY of these
// reaches the serialized brief, the Saga can absorb it and cross the operator hard line.
const REAL_IDENTIFIERS = [
  'Vibranto',
  'auth_tokens',
  'users',
  'SaveProfileSheet',
  'RecoverView',
  'LogMailer',
  'identity-client',
  'PUBLIC_BASE_URL',
  'FK-23503',
  'migration 0045',
  'Drizzle',
  'Hono',
  'zod',
  'expires_at',
  'COALESCE',
  'magic-link',
];

// Path / payload markers that must NEVER appear in the serialized brief.
const PATH_MARKERS = ['snippet', '/', '\\', '.ts', '.json', 'src/'];

function makeProjectedEvents(): ProjectedEvent[] {
  // The fields ProjectedEvent actually carries are ALL name-free by construction (Story 5.5):
  // eventType / toolName (abstract tool or null) / outcome (success|isError) / role (coarse token) +
  // the opaque identity (orderKey, eventId). The brief KEEPS only {eventType, toolName, role, outcome};
  // it DROPS orderKey + eventId. To make the name-free serialized proof LOAD-BEARING (not a tautology
  // over clean fixtures), we PLANT real-identifier-shaped strings into the DROPPED fields (eventId +
  // streamId): if buildSagaBrief ever regressed to spread/carry those fields, the leak would survive the
  // JSON.stringify and the .not.toContain assertions below would FAIL. (Object literals bypass Zod, which
  // is exactly the construction the builder must withstand.)
  return [
    {
      orderKey: { logicalClock: 1, streamId: 'auth_tokens', seqWithinStream: 0 },
      eventId: 'Vibranto/src/SaveProfileSheet.ts',
      eventType: 'tool_use',
      toolName: 'Bash',
      outcome: 'success',
      role: 'migration',
    },
    {
      orderKey: { logicalClock: 2, streamId: 'users', seqWithinStream: 1 },
      eventId: 'migration 0045',
      eventType: 'tool_result',
      toolName: null,
      outcome: 'isError',
      role: 'schema',
    },
    {
      orderKey: { logicalClock: 3, streamId: 'PUBLIC_BASE_URL', seqWithinStream: 2 },
      eventId: 'identity-client/RecoverView.json',
      eventType: 'tool_use',
      toolName: 'Edit',
      outcome: 'success',
      role: 'source',
    },
  ];
}

function makeAnnotations(): BeatAnnotation[] {
  // The frozen beats: only enums + opaque ids + hashes. The brief must keep ONLY {beatType, confidence}.
  // The opaque-id / hash fields below are the ones AC1/§2 say the brief DROPS — they carry no narrative
  // arc and (eventRef/sourceHash) are opaque content addresses the Saga grounds nothing on. As with the
  // events, the DROPPED fields are PLANTED with real-identifier-shaped strings so the name-free proof is
  // load-bearing: a builder that carried eventRef/sourceHash/interpreterVersion/groundingPointer would
  // leak them into the serialized brief and fail the .not.toContain assertions below.
  return [
    {
      eventRef: 'FK-23503',
      beatType: 'shaman',
      confidence: 0.92,
      interpreterVersion: 'Drizzle',
      sourceHash: 'expires_at',
      groundingPointer: { eventRefs: ['LogMailer', 'COALESCE'] },
    },
    {
      eventRef: 'Hono',
      beatType: 'summon',
      confidence: 0.81,
      interpreterVersion: 'zod',
      sourceHash: 'magic-link',
      groundingPointer: { eventRefs: ['src/identity-client'] },
    },
  ];
}

describe('Story 5.8 / AC1 — buildSagaBrief is built from ONLY the name-free public surface', () => {
  it('keeps EXACTLY {eventType, toolName, role, outcome} per event (a field-restriction of ProjectedEvent)', () => {
    const projectedEvents = makeProjectedEvents();
    const brief = buildSagaBrief({ projectedEvents, annotations: makeAnnotations(), teaching: TEACHING });
    expect(brief.events).toHaveLength(projectedEvents.length);
    for (const ev of brief.events) {
      // DROPS orderKey/eventId (§2) — the Saga grounds nothing on them.
      expect(new Set(Object.keys(ev))).toEqual(new Set(['eventType', 'toolName', 'role', 'outcome']));
    }
    // Order preserved + values carried through verbatim.
    expect(brief.events.map((e) => e.eventType)).toEqual(projectedEvents.map((e) => e.eventType));
    expect(brief.events.map((e) => e.toolName)).toEqual(projectedEvents.map((e) => e.toolName));
    expect(brief.events.map((e) => e.outcome)).toEqual(projectedEvents.map((e) => e.outcome));
    expect(brief.events.map((e) => e.role)).toEqual(projectedEvents.map((e) => e.role));
  });

  it('keeps EXACTLY {beatType, confidence} per beat (a field-restriction of BeatAnnotation), order preserved', () => {
    const annotations = makeAnnotations();
    const brief = buildSagaBrief({
      projectedEvents: makeProjectedEvents(),
      annotations,
      teaching: TEACHING,
    });
    expect(brief.beats).toHaveLength(annotations.length);
    for (const beat of brief.beats) {
      // DROPS eventRef/groundingPointer/sourceHash/interpreterVersion (§2).
      expect(new Set(Object.keys(beat))).toEqual(new Set(['beatType', 'confidence']));
    }
    expect(brief.beats.map((b) => b.beatType)).toEqual(annotations.map((a) => a.beatType));
    expect(brief.beats.map((b) => b.confidence)).toEqual(annotations.map((a) => a.confidence));
  });

  it('passes the validated TeachingTable through verbatim (the safe narrative material)', () => {
    const brief = buildSagaBrief({
      projectedEvents: makeProjectedEvents(),
      annotations: makeAnnotations(),
      teaching: TEACHING,
    });
    expect(brief.teaching).toEqual(TEACHING);
  });

  it('is PURE/deterministic — same input yields a deep-equal brief on a second call', () => {
    const projectedEvents = makeProjectedEvents();
    const annotations = makeAnnotations();
    const a = buildSagaBrief({ projectedEvents, annotations, teaching: TEACHING });
    const b = buildSagaBrief({ projectedEvents, annotations, teaching: TEACHING });
    expect(a).toEqual(b);
  });

  it('does NOT mutate its inputs (deep-snapshot in, deep-equal after)', () => {
    const projectedEvents = makeProjectedEvents();
    const annotations = makeAnnotations();
    const projectedSnapshot = structuredClone(projectedEvents);
    const annotationsSnapshot = structuredClone(annotations);
    const teachingSnapshot = structuredClone(TEACHING);
    buildSagaBrief({ projectedEvents, annotations, teaching: TEACHING });
    expect(projectedEvents).toEqual(projectedSnapshot);
    expect(annotations).toEqual(annotationsSnapshot);
    expect(TEACHING).toEqual(teachingSnapshot);
  });
});

describe('Story 5.8 / AC1+AC3 — the serialized brief is provably name-free (the load-bearing proof)', () => {
  it('the events/beats portion of the brief contains NO snippet field and NO path markers', () => {
    // F5 — scope the path-marker proof to the events + beats portions, NOT the teaching one-liners.
    // teaching.json is operator-editable safe authored prose; a future one-liner with a legitimate '/'
    // (a date, "and/or") must NOT break this leak proof. The events/beats are where a path/snippet leak
    // would actually surface (they derive from session data), so that is the surface this proof guards;
    // the teaching one-liners' own safety is asserted separately (they flow through verbatim, below).
    const brief = buildSagaBrief({
      projectedEvents: makeProjectedEvents(),
      annotations: makeAnnotations(),
      teaching: TEACHING,
    });
    const serializedEventsBeats = JSON.stringify({ events: brief.events, beats: brief.beats });
    for (const marker of PATH_MARKERS) {
      expect(serializedEventsBeats).not.toContain(marker);
    }
  });

  it('JSON.stringify(brief) contains NONE of the representative real-identifier set', () => {
    const serialized = JSON.stringify(
      buildSagaBrief({
        projectedEvents: makeProjectedEvents(),
        annotations: makeAnnotations(),
        teaching: TEACHING,
      }),
    );
    for (const id of REAL_IDENTIFIERS) {
      expect(serialized).not.toContain(id);
    }
  });

  it('F1 — neutralizes an mcp__*/custom toolName so the product/integration identifier never reaches the brief', () => {
    // An MCP/custom tool name (e.g. mcp__clickup__create_task) carries a real product identifier and is
    // NOT matched by any scrub pattern — it would flow verbatim into the brief if not neutralized. A
    // built-in toolName (an abstract verb) must pass through unchanged.
    const projectedEvents: ProjectedEvent[] = [
      {
        orderKey: { logicalClock: 1, streamId: 's', seqWithinStream: 0 },
        eventId: 'e1',
        eventType: 'tool_use',
        toolName: 'mcp__clickup__create_task',
        outcome: 'success',
        role: 'source',
      },
      {
        orderKey: { logicalClock: 2, streamId: 's', seqWithinStream: 1 },
        eventId: 'e2',
        eventType: 'tool_use',
        toolName: 'Bash', // a built-in — must survive
        outcome: 'success',
        role: 'source',
      },
    ];
    const brief = buildSagaBrief({ projectedEvents, annotations: [], teaching: TEACHING });
    expect(brief.events[0].toolName).toBe('tool');
    expect(brief.events[1].toolName).toBe('Bash');
    const serialized = JSON.stringify(brief);
    expect(serialized).not.toContain('mcp__');
    expect(serialized).not.toContain('clickup');
  });

  it('the teaching one-liners DO flow through (proving the safe narrative material is present)', () => {
    const serialized = JSON.stringify(
      buildSagaBrief({
        projectedEvents: makeProjectedEvents(),
        annotations: makeAnnotations(),
        teaching: TEACHING,
      }),
    );
    expect(serialized).toContain(TEACHING.shaman);
    expect(serialized).toContain(TEACHING.dispel);
    expect(serialized).toContain(TEACHING.summon);
  });
});

describe('Story 5.8 / AC3 — the brief is a SUBSET/derivative of the public bundle surface', () => {
  it('every event key is a field of ProjectedEvent (already-public); none traceable to payload/snippet/path', () => {
    const projectedEvents = makeProjectedEvents();
    const brief = buildSagaBrief({ projectedEvents, annotations: makeAnnotations(), teaching: TEACHING });
    const publicEventKeys = new Set(Object.keys(projectedEvents[0]));
    for (const ev of brief.events) {
      for (const key of Object.keys(ev)) {
        expect(publicEventKeys.has(key)).toBe(true);
      }
    }
  });

  it('every beat key is a field of BeatAnnotation (already-public)', () => {
    const annotations = makeAnnotations();
    const brief = buildSagaBrief({
      projectedEvents: makeProjectedEvents(),
      annotations,
      teaching: TEACHING,
    });
    const publicBeatKeys = new Set(Object.keys(annotations[0]));
    for (const beat of brief.beats) {
      for (const key of Object.keys(beat)) {
        expect(publicBeatKeys.has(key)).toBe(true);
      }
    }
  });

  it('the top-level brief carries ONLY events/beats/teaching (+ optional arc) — no extra leak vector', () => {
    const brief = buildSagaBrief({
      projectedEvents: makeProjectedEvents(),
      annotations: makeAnnotations(),
      teaching: TEACHING,
    });
    const allowed = new Set(['events', 'beats', 'teaching', 'arc']);
    for (const key of Object.keys(brief)) {
      expect(allowed.has(key)).toBe(true);
    }
    // events/beats/teaching are mandatory; arc is optional (§3 default-omit).
    expect(brief).toHaveProperty('events');
    expect(brief).toHaveProperty('beats');
    expect(brief).toHaveProperty('teaching');
  });
});

describe('Story 5.8 (R4/R5) — saga-brief.ts source is SDK-free + phaser-free', () => {
  // saga-brief.ts is a bake-input builder (browser-UNREACHABLE, like saga-author.ts) so it is NOT added
  // to r1-discipline.test.ts's SCRIBE_MODULES browser-reader list; its SDK/phaser-freedom is asserted
  // HERE instead (story Task 1, R-boundary note). It must import only schema/ types + the validated
  // TEACHING value + (optionally) bundle/project-events — never @anthropic-ai/sdk, never phaser.
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'saga-brief.ts'),
    'utf8',
  );

  it('src/scribe/saga-brief.ts contains zero references to @anthropic-ai/sdk', () => {
    expect(source).not.toContain('@anthropic-ai/sdk');
  });

  it('src/scribe/saga-brief.ts imports no phaser', () => {
    expect(source).not.toMatch(/['"]phaser['"]/);
  });
});
