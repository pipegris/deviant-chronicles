import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';

// RED-PHASE acceptance test for Story 5.5 — Task 2 / AC1 + AC5: the PURE payload-free projector.
//
// It imports the NOT-YET-AUTHORED `./project-events` (projectEvents), so it ERRORS now (RED — module
// resolution fails). It turns GREEN when the dev (Task 2) authors src/bundle/project-events.ts with:
//   - export function projectEvents(events: NormalizedEvent[]): ProjectedEvent[] — PURE/deterministic.
//       For each scrubbed NormalizedEvent it emits ONLY the minimal payload-free projection:
//         { orderKey, eventId, eventType, toolName, outcome: isError ? 'isError' : 'success',
//           role: classifyRole(resolveTargetPath(event)) }
//       It reads the target path ONLY to classify, then DISCARDS it; it carries NO payload/content forward.
//
// AC1 (verbatim): "...the per-event data is a MINIMAL PAYLOAD-FREE projection keeping only
// {opaque id (orderKey), eventType, toolName, outcome(success/isError), abstracted role}; AND no raw
// payload..., no raw file path, no file name, and no symbol name appears anywhere..."
//
// These run under NODE (no DOM) — the projector is pure + SDK-free + phaser-free.
import { projectEvents } from './project-events';

// ── Fixture: a small NormalizedEvent[] mirroring the committed bundle's leak surface (story §0). ────
// It carries the EXACT raw-content + raw-path/name strings the byte-absence proof (AC1/AC2) must show
// are ABSENT from the projection. Distinctive synthetic-but-realistic values so .not.toContain is sharp.
const RAW = {
  promptText: 'Kickoff: implement the ingest pipeline for Story 10.1.',
  schemaContent: 'export const NormalizedEventSchema = ...',
  schemaPath: '/work/project/src/schema/normalized-event.ts',
  schemaName: 'normalized-event.ts',
  parserPath: '/work/project/src/ingest/parse-transcript.ts',
  parserName: 'parse-transcript.ts',
  bashCommand: 'pnpm vitest run',
  failOutput: 'FAIL src/ingest/parse-transcript.test.ts',
} as const;

function orderKey(seq: number): NormalizedEvent['orderKey'] {
  return { logicalClock: seq, streamId: 'main', seqWithinStream: seq };
}

// A representative spread: a path-less prompt; a path-less assistant text; a Read tool_use carrying a
// SCHEMA file path (→ role 'schema'); a tool_result carrying raw file content; an Edit tool_use on a
// SOURCE path (→ role 'source'); a failed Bash tool_result (→ outcome 'isError'); a Write on a source
// path. Covers every projected field + the role/outcome derivations + the path-less 'source' fallback.
const FIXTURE_EVENTS: NormalizedEvent[] = [
  {
    orderKey: orderKey(0),
    eventId: 'u-0001',
    eventType: 'prompt',
    toolName: null,
    subtype: null,
    timestamp: '2026-06-14T15:56:48.752Z',
    streamDepth: 0,
    exitCode: null,
    isError: false,
    retryCount: 0,
    payload: { text: RAW.promptText },
  },
  {
    orderKey: orderKey(1),
    eventId: 'u-0002#1',
    eventType: 'text',
    toolName: null,
    subtype: null,
    timestamp: '2026-06-14T15:57:01.100Z',
    streamDepth: 0,
    exitCode: null,
    isError: false,
    retryCount: 0,
    payload: { text: 'I will start by reading the schema then editing the parser.' },
  },
  {
    orderKey: orderKey(2),
    eventId: 'u-0002#2',
    eventType: 'tool_use',
    toolName: 'Read',
    subtype: null,
    timestamp: '2026-06-14T15:57:01.100Z',
    streamDepth: 0,
    exitCode: null,
    isError: false,
    retryCount: 0,
    payload: { input: { file_path: RAW.schemaPath } },
  },
  {
    orderKey: orderKey(3),
    eventId: 'u-0003#0',
    eventType: 'tool_result',
    toolName: null,
    subtype: null,
    timestamp: '2026-06-14T15:57:03.500Z',
    streamDepth: 0,
    exitCode: null,
    isError: false,
    retryCount: 0,
    payload: { content: RAW.schemaContent },
  },
  {
    orderKey: orderKey(4),
    eventId: 'u-0004#0',
    eventType: 'tool_use',
    toolName: 'Write',
    subtype: null,
    timestamp: '2026-06-14T15:58:10.000Z',
    streamDepth: 0,
    exitCode: null,
    isError: false,
    retryCount: 0,
    payload: { input: { file_path: RAW.parserPath, content: 'export function parseTranscript() {}' } },
  },
  {
    orderKey: orderKey(5),
    eventId: 'u-0008#0',
    eventType: 'tool_use',
    toolName: 'Bash',
    subtype: null,
    timestamp: '2026-06-14T16:05:00.000Z',
    streamDepth: 0,
    exitCode: null,
    isError: false,
    retryCount: 0,
    payload: { input: { command: RAW.bashCommand, description: 'Run the test suite' } },
  },
  {
    orderKey: orderKey(6),
    eventId: 'u-0009#0',
    eventType: 'tool_result',
    toolName: null,
    subtype: null,
    timestamp: '2026-06-14T16:05:09.300Z',
    streamDepth: 0,
    exitCode: null,
    isError: true,
    retryCount: 0,
    payload: { content: RAW.failOutput },
  },
];

// The five keys AC1 enumerates PLUS the opaque identity. Dev Notes §1 RESOLVED the projection keeps BOTH
// `orderKey` (the AC's named opaque id) AND `eventId` (the opaque string every ref + the freeze guard +
// the portal lookup uses). So the projected key set is exactly these — and NOTHING else (no payload).
const EXPECTED_KEYS = ['orderKey', 'eventId', 'eventType', 'toolName', 'outcome', 'role'].sort();

// Keys that are the LEAK surface (or carry no public value) — they MUST NOT appear on a projected event.
const FORBIDDEN_KEYS = ['payload', 'subtype', 'timestamp', 'streamDepth', 'exitCode', 'isError', 'retryCount'];

// ---------------------------------------------------------------------------------------------------
// AC1 — each projected event is the MINIMAL payload-free projection: EXACTLY the documented key set.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC1 — projectEvents emits EXACTLY the payload-free key set per event', () => {
  it('every projected event has exactly {orderKey, eventId, eventType, toolName, outcome, role} — no more', () => {
    const projected = projectEvents(FIXTURE_EVENTS);
    expect(projected).toHaveLength(FIXTURE_EVENTS.length);
    for (const p of projected) {
      expect(Object.keys(p as object).sort()).toEqual(EXPECTED_KEYS);
    }
  });

  it('NO projected event carries a payload/content or any other NormalizedEvent leak field', () => {
    const projected = projectEvents(FIXTURE_EVENTS);
    for (const p of projected) {
      const rec = p as unknown as Record<string, unknown>;
      for (const forbidden of FORBIDDEN_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(rec, forbidden)).toBe(false);
      }
    }
  });

  it('preserves the opaque identity (eventId + orderKey) of every input event, in order', () => {
    const projected = projectEvents(FIXTURE_EVENTS) as ReadonlyArray<{
      eventId: string;
      orderKey: unknown;
    }>;
    expect(projected.map((p) => p.eventId)).toEqual(FIXTURE_EVENTS.map((e) => e.eventId));
    expect(projected.map((p) => p.orderKey)).toEqual(FIXTURE_EVENTS.map((e) => e.orderKey));
  });

  it('carries the eventType + toolName through unchanged (the abstracted structure the showcase teaches)', () => {
    const projected = projectEvents(FIXTURE_EVENTS) as ReadonlyArray<{
      eventType: string;
      toolName: string | null;
    }>;
    expect(projected.map((p) => p.eventType)).toEqual(FIXTURE_EVENTS.map((e) => e.eventType));
    expect(projected.map((p) => p.toolName)).toEqual(FIXTURE_EVENTS.map((e) => e.toolName));
  });
});

// ---------------------------------------------------------------------------------------------------
// AC1 — outcome = per-event isError ('isError' | 'success'); role = the coarse classifyRole token.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC1 — outcome mirrors per-event isError; role is the coarse classified token', () => {
  it('outcome is "isError" exactly when the event isError, else "success"', () => {
    const projected = projectEvents(FIXTURE_EVENTS) as ReadonlyArray<{ outcome: string }>;
    projected.forEach((p, i) => {
      expect(p.outcome).toBe(FIXTURE_EVENTS[i]!.isError ? 'isError' : 'success');
    });
    // The failed Bash tool_result (u-0009#0) is the one 'isError' row.
    const fail = projected[FIXTURE_EVENTS.findIndex((e) => e.eventId === 'u-0009#0')]!;
    expect(fail.outcome).toBe('isError');
  });

  it('role is the coarse classified token: a schema path → "schema", a source path → "source"', () => {
    const projected = projectEvents(FIXTURE_EVENTS) as ReadonlyArray<{ eventId: string; role: string }>;
    const roleOf = (id: string) => projected.find((p) => p.eventId === id)!.role;
    // u-0002#2 reads /work/project/src/schema/normalized-event.ts → schema
    expect(roleOf('u-0002#2')).toBe('schema');
    // u-0004#0 writes /work/project/src/ingest/parse-transcript.ts → source
    expect(roleOf('u-0004#0')).toBe('source');
    // path-less events (prompt/text/bash-command/tool_result) → the 'source' fallback
    expect(roleOf('u-0001')).toBe('source');
    expect(roleOf('u-0002#1')).toBe('source');
    expect(roleOf('u-0008#0')).toBe('source');
    expect(roleOf('u-0009#0')).toBe('source');
  });

  it('every role is one of the six coarse tokens (no path-derived value)', () => {
    const tokens = new Set(['test', 'schema', 'migration', 'config', 'doc', 'source']);
    for (const p of projectEvents(FIXTURE_EVENTS) as ReadonlyArray<{ role: string }>) {
      expect(tokens.has(p.role)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// AC1 / AC5 — THE LOAD-BEARING NO-LEAK PROOF: serialize the projection and assert it carries NONE of
// the fixture's raw content, raw file paths, OR raw file names (the Story 5.1 .not.toContain posture).
// This is the privacy guardrail: the public projection exposes the abstracted STRUCTURE only.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC1 — the serialized projection leaks NO raw content, path, or file name', () => {
  it('the projected events contain none of the fixture raw content/path/name strings (grep-absent)', () => {
    const serialized = JSON.stringify(projectEvents(FIXTURE_EVENTS));
    const mustBeAbsent: readonly string[] = [
      RAW.promptText,
      RAW.schemaContent,
      RAW.schemaPath,
      RAW.schemaName,
      RAW.parserPath,
      RAW.parserName,
      RAW.bashCommand,
      RAW.failOutput,
      // bare path fragments that should also never appear
      '/work/project',
      'file_path',
      'command',
      'content',
    ];
    for (const needle of mustBeAbsent) {
      expect(serialized).not.toContain(needle);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// AC5 (R2) — projectEvents is PURE: deterministic + does not mutate its input.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 — projectEvents is PURE (deterministic + no input mutation)', () => {
  it('calling twice on the same input yields a deep-equal projection (determinism)', () => {
    expect(projectEvents(FIXTURE_EVENTS)).toEqual(projectEvents(FIXTURE_EVENTS));
  });

  it('does not mutate the input events (the scrubbed Layer-0 truth is read-only)', () => {
    const before = structuredClone(FIXTURE_EVENTS);
    projectEvents(FIXTURE_EVENTS);
    expect(FIXTURE_EVENTS).toEqual(before);
  });
});
