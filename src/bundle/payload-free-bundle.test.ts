import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleTimeline } from '../schema/battle-timeline';
import type { BeatAnnotation } from '../schema/beat-annotation';
import { scrubSession, type ScrubResult } from '../scrub/scrub';
import { reportHash, type ScrubApproval } from '../scrub/gate';
import { assembleBundle, type AssembleBundleInput } from './assemble-bundle';

// RED-PHASE acceptance test for Story 5.5 — Task 3 / AC1 + AC2 + AC5: the assembler ships the
// payload-free PROJECTION, not the full events.
//
// It asserts the POST-Story-5.5 bundle shape: `assembleBundle(...)` returns a bundle whose per-event
// array is `projectedEvents` (NOT `normalizedEvents`), every entry is the five-key payload-free
// projection, and the serialized bundle contains NONE of the fixture's raw content NOR its raw file
// path/name (grep-absent). It FAILS now (RED) because today's assembler composes `normalizedEvents`
// with full payloads (verified: assemble-bundle.ts L62/L92-107). It turns GREEN when the dev (Task 3)
// computes `projectedEvents = projectEvents(scrubResult.scrubbedEvents)` and ships THAT.
//
// AC1: per-event data is the minimal payload-free projection; AC2: byte-level absence proof (no
// per-event content field + bounded per-event size + the serialized bundle .not.toContain's the raw
// content strings AND raw paths/names); AC5: the bake reads full events but ships only the projection.
//
// Runs under NODE — the assembler is pure + SDK-free + phaser-free.

// ── Fixture: a Zod-valid NormalizedEvent[] planting BOTH a secret-shaped value AND a real file
// path/name + raw content (the leak surface Story 5.5 removes). Every value is OBVIOUSLY synthetic. ──
const PLANTED = {
  secret: 'sk-FAKE0000000000000000000000', // a secret the SCRUB removes (Story 5.1 posture)
  filePath: '/work/project/src/schema/SuperSecretInternalName.ts', // a raw PATH Story 5.5 removes
  fileName: 'SuperSecretInternalName.ts', // its raw NAME
  fileContent: 'export const ThisIsTheVerbatimSourceBody = 42;', // raw tool-output content
  command: 'pnpm run secret-internal-build', // a raw command body
} as const;

function orderKey(seq: number): NormalizedEvent['orderKey'] {
  return { logicalClock: seq, streamId: 'main', seqWithinStream: seq };
}

const PLANTED_PATH_EVENTS: NormalizedEvent[] = [
  {
    orderKey: orderKey(0),
    eventId: 'evt-read',
    eventType: 'tool_use',
    toolName: 'Read',
    subtype: null,
    timestamp: '2026-06-14T15:00:00.000Z',
    streamDepth: 0,
    exitCode: null,
    isError: false,
    retryCount: 0,
    payload: { input: { file_path: PLANTED.filePath } },
  },
  {
    orderKey: orderKey(1),
    eventId: 'evt-result',
    eventType: 'tool_result',
    toolName: null,
    subtype: null,
    timestamp: '2026-06-14T15:00:01.000Z',
    streamDepth: 0,
    exitCode: null,
    isError: false,
    retryCount: 0,
    payload: { content: PLANTED.fileContent },
  },
  {
    orderKey: orderKey(2),
    eventId: 'evt-edit',
    eventType: 'tool_use',
    toolName: 'Edit',
    subtype: null,
    timestamp: '2026-06-14T15:00:02.000Z',
    streamDepth: 0,
    exitCode: null,
    isError: false,
    retryCount: 0,
    payload: {
      input: { file_path: PLANTED.filePath, old_string: '41', new_string: '42' },
      secretLeaf: PLANTED.secret,
    },
  },
  {
    orderKey: orderKey(3),
    eventId: 'evt-bash',
    eventType: 'tool_use',
    toolName: 'Bash',
    subtype: null,
    timestamp: '2026-06-14T15:00:03.000Z',
    streamDepth: 0,
    exitCode: null,
    isError: true,
    retryCount: 0,
    payload: { input: { command: PLANTED.command } },
  },
];

const scrubResultOf = (): ScrubResult => scrubSession(PLANTED_PATH_EVENTS);

function validApproval(result: ScrubResult): ScrubApproval {
  return {
    $markerVersion: 1,
    scrubHash: result.scrubHash,
    reportHash: reportHash(result.report),
    approvedBy: 'operator@example.invalid',
    approvedAt: '2026-06-14T16:00:00.000Z',
  };
}

// Annotations grounded in the scrubbed fixture's REAL eventIds (scrubbing leaves eventId untouched);
// the projection preserves those ids (Dev Notes §1) so freeze + the F3 guard + grounding stay consistent.
function annotationsFor(): BeatAnnotation[] {
  return [
    {
      eventRef: 'evt-read',
      beatType: 'dispel',
      confidence: 0.8,
      interpreterVersion: 'fixture-v1',
      sourceHash: 'fixture',
      groundingPointer: { eventRefs: ['evt-read', 'evt-result'] },
    },
  ];
}

// A baked timeline whose beat sourceEventIds reference the shipped eventIds (the F3/§5 guard checks the
// timeline against the SHIPPED projection — re-pointed in Task 3; the projection preserves the ids).
function timelineFor(): BattleTimeline {
  return {
    schemaVersion: 1,
    beats: [
      {
        orderKey: orderKey(0),
        actionType: 'scout',
        sourceEventIds: ['evt-read'],
        weight: 2,
        dwellMs: 240,
      },
      {
        orderKey: orderKey(2),
        actionType: 'melee',
        sourceEventIds: ['evt-edit'],
        weight: 20,
        dwellMs: 2400,
      },
    ],
    totalDurationMs: 2640,
  };
}

function inputFor(overrides: Partial<AssembleBundleInput> = {}): AssembleBundleInput {
  const scrubResult = overrides.scrubResult ?? scrubResultOf();
  return {
    scrubResult,
    approval: 'approval' in overrides ? overrides.approval! : validApproval(scrubResult),
    annotations: overrides.annotations ?? annotationsFor(),
    interpreterVersion: overrides.interpreterVersion ?? 'fixture-v1',
    promptVersion: overrides.promptVersion ?? 'prompt-v1',
    battleTimeline: overrides.battleTimeline ?? timelineFor(),
    tuningConfig: overrides.tuningConfig ?? { someRule: 'value' },
    saga: 'saga' in overrides ? overrides.saga! : 'placeholder saga',
    assetManifest: overrides.assetManifest ?? { hero: 'assets/hero.png' },
  };
}

const PROJECTED_KEYS = ['orderKey', 'eventId', 'eventType', 'toolName', 'outcome', 'role'].sort();

// ---------------------------------------------------------------------------------------------------
// AC1 / AC5 — the assembled bundle ships `projectedEvents` (the projection), NOT `normalizedEvents`.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC1 — the assembled bundle ships projectedEvents (payload-free), not normalizedEvents', () => {
  it('the bundle has a `projectedEvents` array and NO `normalizedEvents` key', () => {
    const bundle = assembleBundle(inputFor()) as unknown as Record<string, unknown>;
    expect(Array.isArray(bundle.projectedEvents)).toBe(true);
    expect((bundle.projectedEvents as unknown[]).length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(bundle, 'normalizedEvents')).toBe(false);
  });

  it('every projectedEvents entry is the five-key payload-free projection (no payload/content)', () => {
    const bundle = assembleBundle(inputFor()) as unknown as {
      projectedEvents: ReadonlyArray<Record<string, unknown>>;
    };
    for (const p of bundle.projectedEvents) {
      expect(Object.keys(p).sort()).toEqual(PROJECTED_KEYS);
      expect(Object.prototype.hasOwnProperty.call(p, 'payload')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(p, 'content')).toBe(false);
    }
  });

  it('projects the scrubbed events: the eventIds are preserved and outcome/role are present', () => {
    const bundle = assembleBundle(inputFor()) as unknown as {
      projectedEvents: ReadonlyArray<{ eventId: string; outcome: string; role: string }>;
    };
    expect(bundle.projectedEvents.map((p) => p.eventId)).toEqual(
      PLANTED_PATH_EVENTS.map((e) => e.eventId),
    );
    // The failed Bash (evt-bash) is the one 'isError' row; the schema-path Read/Edit classify as 'schema'.
    const byId = new Map(bundle.projectedEvents.map((p) => [p.eventId, p]));
    expect(byId.get('evt-bash')!.outcome).toBe('isError');
    expect(byId.get('evt-read')!.role).toBe('schema');
    expect(byId.get('evt-edit')!.role).toBe('schema');
  });
});

// ---------------------------------------------------------------------------------------------------
// AC2 — BYTE-LEVEL ABSENCE PROOF: the serialized bundle contains NONE of the planted raw content
// strings AND none of the raw file paths/names; per-event projected size is bounded small.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC2 — the serialized bundle is grep-absent of raw content AND raw paths/names', () => {
  it('contains no planted secret, no raw file path, no raw file name, no raw content, no command body', () => {
    const serialized = JSON.stringify(assembleBundle(inputFor()));
    const mustBeAbsent: readonly string[] = [
      PLANTED.secret, // the scrub removes this (Story 5.1)
      PLANTED.filePath, // Story 5.5 removes the raw PATH...
      PLANTED.fileName, // ...and the raw NAME
      PLANTED.fileContent, // and the raw tool-output content
      PLANTED.command, // and the raw command body
      '/work/project', // any path fragment
    ];
    for (const needle of mustBeAbsent) {
      expect(serialized).not.toContain(needle);
    }
  });

  it('each projected event serializes under a small byte cap (≤ 400 bytes/event — bounded small)', () => {
    // AC2: "per-event size is bounded small." A payload-free projection is a handful of short fields;
    // 400 bytes/event is a generous-but-defensible ceiling that a full-payload event (up to ~28KB) blows.
    const bundle = assembleBundle(inputFor()) as unknown as {
      projectedEvents: ReadonlyArray<unknown>;
    };
    for (const p of bundle.projectedEvents) {
      const bytes = Buffer.byteLength(JSON.stringify(p), 'utf8');
      expect(bytes).toBeLessThanOrEqual(400);
    }
  });

  it('NO projected event carries a `payload` field anywhere in the serialized bundle events', () => {
    // Structural AC2 check distinct from the string-grep: the events array carries no payload field.
    const bundle = assembleBundle(inputFor()) as unknown as {
      projectedEvents: ReadonlyArray<Record<string, unknown>>;
    };
    const eventsJson = JSON.stringify(bundle.projectedEvents);
    expect(eventsJson).not.toContain('"payload"');
  });
});
