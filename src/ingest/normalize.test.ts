import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NormalizedEventSchema, type NormalizedEvent } from '../schema/normalized-event';

// RED-PHASE acceptance test for Story 1.3 — Task 4: src/ingest/normalize.ts (PURE raw
// records -> NormalizedEvent[], per stream). Encodes:
//   AC1 — every emitted object validates against NormalizedEventSchema AND no raw key
//         leaks past ingest/ (R3): the normalized objects are camelCase NormalizedEvents,
//         never the raw snake_case shape.
//   AC3 — the documented allowlist EXCLUDES thinking + attachment, KEEPS tool_use /
//         tool_result / text / the string-content kickoff, and the journal keeps the
//         started+result lifecycle while folding the opaque `key` into payload (not a
//         leaked top-level field).
// The normalize module does not exist yet, so the import fails to resolve and these tests
// ERROR (RED).
//
// IMPORTANT: the no-leak assertions run against the PRODUCTION FUNCTION OUTPUT, not against
// a NormalizedEventSchema.parse(rawObject) — Zod 4 strips unknown keys on parse, so a
// schema round-trip would mask a buggy normalizer that passed raw objects through. The real
// R3 guarantee is that normalize RETURNS clean objects, so we inspect Object.keys() of the
// returned events directly.
import { parseTranscript } from './parse-transcript';
import { parseJournal } from './parse-journal';
import type { RawJournalRecord } from './parse-journal';
import { normalizeTranscript, normalizeJournal } from './normalize';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

function transcriptEvents(): NormalizedEvent[] {
  return normalizeTranscript(
    parseTranscript(readFixture('sample-transcript.jsonl'), DEV_STREAM_ID),
    DEV_STREAM_ID,
  );
}

function journalEvents(): NormalizedEvent[] {
  return normalizeJournal(parseJournal(readFixture('sample-journal.jsonl')));
}

// The exact key set of the 1.2 NormalizedEvent contract. The normalize output keys must be
// a subset of this set — any extra key is a raw-shape leak (R3).
const ALLOWED_EVENT_KEYS = new Set([
  'orderKey',
  'eventId',
  'eventType',
  'toolName',
  'subtype',
  'timestamp',
  'streamDepth',
  'exitCode',
  'isError',
  'retryCount',
  'payload',
]);

// Raw keys that MUST NEVER appear on a NormalizedEvent (R3 / AC1).
const FORBIDDEN_RAW_KEYS = [
  'is_error',
  'tool_use_id',
  'parentUuid',
  'uuid',
  'isSidechain',
  'sessionId',
  'gitBranch',
  'cwd',
  'agentId',
  'message',
];

// The raw camelCase/snake_case keys whose presence ANYWHERE in the emitted object (top
// level OR nested inside payload) would mean a raw record leaked past ingest/ (R3). The
// top-level `forbidden in event` check below cannot see a `tool_use_id` folded into
// payload, so this set is checked recursively to match the R3 guarantee's actual scope.
const FORBIDDEN_RAW_KEYS_ANYWHERE = ['is_error', 'tool_use_id', 'parentUuid', 'isSidechain'];

function collectKeysDeep(value: unknown, acc: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeysDeep(item, acc);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      acc.add(key);
      collectKeysDeep(nested, acc);
    }
  }
}

describe('Story 1.3 / AC1 — every normalized event validates against NormalizedEventSchema', () => {
  it('produces transcript events that all pass NormalizedEventSchema.parse', () => {
    for (const event of transcriptEvents()) {
      expect(() => NormalizedEventSchema.parse(event)).not.toThrow();
    }
  });

  it('produces journal events that all pass NormalizedEventSchema.parse', () => {
    for (const event of journalEvents()) {
      expect(() => NormalizedEventSchema.parse(event)).not.toThrow();
    }
  });
});

describe('Story 1.3 / AC1 + R3 — no raw key leaks past ingest/ (camelCase only)', () => {
  it('emits only NormalizedEvent keys — never a raw snake_case / transcript key', () => {
    const events = [...transcriptEvents(), ...journalEvents()];
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      for (const key of Object.keys(event)) {
        expect(ALLOWED_EVENT_KEYS.has(key)).toBe(true);
      }
      for (const forbidden of FORBIDDEN_RAW_KEYS) {
        expect(forbidden in event).toBe(false);
      }
    }
  });

  it('does not leak a raw key NESTED inside payload (recursive R3 check, not just top-level)', () => {
    // R3 says "raw field names never leak past ingest/" — that includes nested under
    // payload, where the normalizer folds tool_use `input` / tool_result `content`. A
    // normalizer that mistakenly spread the whole raw tool_result (carrying tool_use_id /
    // is_error) into payload would PASS the top-level `forbidden in event` check above but
    // fail here. The fixture's tool_result raw items carry exactly those keys, so this is a
    // real guard, not a tautology.
    const allKeys = new Set<string>();
    for (const event of [...transcriptEvents(), ...journalEvents()]) {
      collectKeysDeep(event, allKeys);
    }
    for (const forbidden of FORBIDDEN_RAW_KEYS_ANYWHERE) {
      expect(allKeys.has(forbidden)).toBe(false);
    }
  });

  it('maps raw tool_result is_error -> camelCase isError boolean', () => {
    const events = transcriptEvents();
    const results = events.filter((e) => e.eventType === 'tool_result');
    // The fixture has one is_error:true result and several false/absent ones.
    expect(results.some((e) => e.isError === true)).toBe(true);
    expect(results.some((e) => e.isError === false)).toBe(true);
    // isError is required + non-null on EVERY event (default false off-result).
    for (const event of events) {
      expect(typeof event.isError).toBe('boolean');
    }
  });

  it('sets exitCode null for Bash results (no numeric exit code in the raw shape)', () => {
    // Dev Notes "Bash result shape": Bash tool_result carries only is_error, no exit code.
    for (const event of transcriptEvents()) {
      expect(event.exitCode).toBeNull();
    }
  });
});

describe('Story 1.3 / AC3 — allowlist EXCLUDES bookkeeping, KEEPS battle-relevant items', () => {
  it('drops thinking content items entirely', () => {
    const events = transcriptEvents();
    // No emitted event may be a thinking item, and the opaque signature must not leak.
    expect(events.some((e) => e.eventType === 'thinking')).toBe(false);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('OPAQUE_SIGNATURE_REDACTED');
    expect(serialized.toLowerCase()).not.toContain('signature');
  });

  it('drops attachment (deferred_tools_delta) records entirely', () => {
    const events = transcriptEvents();
    expect(events.some((e) => e.eventType === 'attachment')).toBe(false);
    expect(JSON.stringify(events)).not.toContain('deferred_tools_delta');
  });

  it('keeps every tool_use, every tool_result, every text, and the kickoff prompt', () => {
    const byType = new Map<string, number>();
    for (const event of transcriptEvents()) {
      byType.set(event.eventType, (byType.get(event.eventType) ?? 0) + 1);
    }
    // Fixture content: 5 tool_use (Read/Write/Edit/Bash + ... ), matching tool_results,
    // 1 text, 1 string-content kickoff prompt. Assert each kept category is present.
    expect((byType.get('tool_use') ?? 0)).toBeGreaterThanOrEqual(4);
    expect((byType.get('tool_result') ?? 0)).toBeGreaterThanOrEqual(4);
    expect((byType.get('text') ?? 0)).toBeGreaterThanOrEqual(1);
    // The kickoff is the string-content user record -> eventType 'prompt' (Dev Notes mapping).
    expect((byType.get('prompt') ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it('keeps the named tool on each tool_use event (toolName populated, not lost)', () => {
    const toolNames = transcriptEvents()
      .filter((e) => e.eventType === 'tool_use')
      .map((e) => e.toolName);
    // Tools are kept BY POLICY (not a closed list); the names in this session must survive.
    expect(toolNames).toContain('Read');
    expect(toolNames).toContain('Write');
    expect(toolNames).toContain('Edit');
    expect(toolNames).toContain('Bash');
  });

  it('keeps the journal started + result lifecycle but folds the opaque key into payload', () => {
    const events = journalEvents();
    const types = events.map((e) => e.eventType);
    // Both lifecycle records are kept (they bracket phases).
    expect(types).toContain('journal_started');
    expect(types).toContain('journal_result');
    // The opaque `key` hash must not be a leaked top-level field; it belongs in payload.
    for (const event of events) {
      expect('key' in event).toBe(false);
    }
    expect(JSON.stringify(events)).toContain('phase-dev-OPAQUEHASH-1');
  });

  it('derives journal subtype across all three documented branches (status > verdict > null)', () => {
    // Dev Notes "Field mapping": journal subtype = result.status when present, ELSE
    // result.verdict, ELSE null. The committed fixture only ever carries `status:'complete'`,
    // so the verdict-fallback branch and the neither-present branch are otherwise UNTESTED.
    // Feeding synthetic raw journal records straight into normalizeJournal pins each branch.
    const records: RawJournalRecord[] = [
      // status present -> status wins even though verdict is also present.
      { type: 'result', key: 'k-status', agentId: 'a', result: { status: 'failed', verdict: 'fail' } },
      // status ABSENT, verdict present -> verdict is the fallback signal.
      { type: 'result', key: 'k-verdict', agentId: 'a', result: { verdict: 'pass' } },
      // neither status nor verdict -> subtype is explicit null (no fabricated signal).
      { type: 'result', key: 'k-neither', agentId: 'a', result: { note: 'no status/verdict here' } },
      // a `started` record (no result object at all) -> subtype null.
      { type: 'started', key: 'k-started', agentId: 'a' },
    ];
    const [status, verdict, neither, started] = normalizeJournal(records);
    expect(status.subtype).toBe('failed'); // status preferred over verdict
    expect(verdict.subtype).toBe('pass'); // verdict fallback when status absent
    expect(neither.subtype).toBeNull(); // neither present -> null
    expect(started.subtype).toBeNull(); // no result -> null
  });
});

describe('Story 1.3 / AC2 — per-stream orderKey is stamped at normalize time', () => {
  it('stamps streamId = the stream label and a 0-based monotonic seqWithinStream', () => {
    const events = transcriptEvents();
    expect(events.length).toBeGreaterThan(0);
    events.forEach((event, index) => {
      expect(event.orderKey.streamId).toBe(DEV_STREAM_ID);
      // seqWithinStream is the kept-event index within the stream (gap-free, monotonic).
      expect(event.orderKey.seqWithinStream).toBe(index);
    });
  });

  it('stamps the journal stream with streamId "orchestrator"', () => {
    for (const event of journalEvents()) {
      expect(event.orderKey.streamId).toBe('orchestrator');
    }
  });

  it('gives every emitted event a unique eventId (uuids repeat across a line\'s items)', () => {
    const ids = transcriptEvents().map((e) => e.eventId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
