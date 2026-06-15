import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BeatAnnotation } from '../schema/beat-annotation';
import { type NormalizedEvent } from '../schema/normalized-event';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';
import { canonicalJSON } from './freeze';
import { ClaudeInterpreter } from './claude-interpreter';

// RED-PHASE acceptance test for Story 5.6 — AC3 / Task 4 (§8): the bake hands the interpreter the
// REDUCED view for the PROMPT but computes sourceHash over the FULL scrubbed events (provenance
// unchanged). The §8 resolution adds an OPTIONAL second arg:
//
//   interpret(promptEvents, groundingEvents = promptEvents)
//
// where `promptEvents` is serialized into messages[0].content (the prompt — the smaller reduced view
// at bake time) and `groundingEvents` (the FULL scrubbed events) is what stampProvenance filters by
// groundingPointer.eventRefs for sourceHash. It is backward-compatible: a single-arg call grounds over
// the same array it prompts with (every existing caller + the BeatInterpreter interface are unaffected).
//
// This file ERRORS / FAILS now (RED) because ClaudeInterpreter.interpret currently takes ONE arg and
// always grounds over the prompt events — a two-arg call with DISTINCT prompt vs grounding has no way to
// produce a sourceHash keyed to the full events yet. It turns GREEN once the dev adds the optional
// groundingEvents param per Task 4. All assertions run against an injected fake (zero network).

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

// The reduced PROMPT stand-in: a compact per-event slice carrying eventId + the abstracted fields but
// NO payload — exactly the shape AC3 hands the interpreter for the prompt. It is materially smaller than
// the full events. (Typed loosely; the interpreter only JSON.stringify's it into the prompt.)
function reducedPromptFor(events: NormalizedEvent[]): NormalizedEvent[] {
  return events.map(
    (e) =>
      ({
        orderKey: e.orderKey,
        eventId: e.eventId,
        eventType: e.eventType,
        toolName: e.toolName,
        subtype: null,
        timestamp: e.timestamp,
        streamDepth: e.streamDepth,
        exitCode: null,
        isError: e.isError,
        retryCount: e.retryCount,
        payload: null, // the reduced view carries NO full payload — this is the size fix.
      }) satisfies NormalizedEvent,
  );
}

// The canned annotation the fake's forced tool returns — grounded to REAL fixture eventIds so the
// grounding slice is non-empty.
const GROUNDING_REFS = ['u-0002#1', 'u-0002#2', 'u-0003#0'];
const CANNED: BeatAnnotation[] = [
  {
    eventRef: 'u-0002#1',
    beatType: 'dispel',
    confidence: 0.8,
    interpreterVersion: 'claude-sonnet-4-6/v1',
    sourceHash: 'mock',
    groundingPointer: { eventRefs: GROUNDING_REFS },
  },
];

// The narrow structural fake — typed with an explicit `type: string` block so it is structurally
// assignable to the interpreter's AnthropicLike (the existing claude-interpreter.test.ts precedent).
interface FakeContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface FakeClient {
  messages: { create(body: Record<string, unknown>): Promise<{ content: FakeContentBlock[] }> };
  calls: Array<Record<string, unknown>>;
}

function makeFake(): FakeClient {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    messages: {
      async create(body: Record<string, unknown>) {
        calls.push(body);
        return {
          content: [
            { type: 'tool_use', id: 'toolu_mock', name: 'emit_beat_annotations', input: { annotations: CANNED } },
          ],
        };
      },
    },
  };
}

// The expected authoritative sourceHash: sha256 over canonicalJSON of the FULL events filtered by refs.
function expectedSourceHashOver(events: NormalizedEvent[], refs: string[]): string {
  const refSet = new Set(refs);
  const grounded = events.filter((e) => refSet.has(e.eventId));
  return createHash('sha256').update(canonicalJSON(grounded)).digest('hex');
}

function promptContentOf(fake: FakeClient): string {
  const messages = fake.calls[0].messages as Array<{ role: string; content: string }>;
  return messages[0].content;
}

// ---------------------------------------------------------------------------------------------------
// AC3 — two-arg interpret: PROMPT = reduced view, sourceHash = FULL events.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.6 AC3 — interpret(promptEvents, groundingEvents) prompts the reduced view', () => {
  it('serializes the REDUCED promptEvents (not the full events) into messages[0].content', async () => {
    const fullEvents = runIngest();
    const reduced = reducedPromptFor(fullEvents);
    const fake = makeFake();

    await new ClaudeInterpreter({ client: fake }).interpret(reduced, fullEvents);

    expect(fake.calls).toHaveLength(1);
    // The prompt content is the reduced view's serialization, byte-for-byte.
    expect(promptContentOf(fake)).toBe(JSON.stringify(reduced));
    // ...and it is materially smaller than serializing the full payload-bearing events would be.
    expect(promptContentOf(fake).length).toBeLessThan(JSON.stringify(fullEvents).length);
  });

  it('the reduced prompt carries the event ids but NOT the raw payload content', async () => {
    const fullEvents = runIngest();
    const reduced = reducedPromptFor(fullEvents);
    const fake = makeFake();

    await new ClaudeInterpreter({ client: fake }).interpret(reduced, fullEvents);
    const content = promptContentOf(fake);

    expect(content).toContain('u-0002#1'); // grounding id present in the prompt
    expect(content).not.toContain('Kickoff: implement the ingest pipeline'); // raw payload absent
    expect(content).not.toContain('/work/project/src/schema/normalized-event.ts');
  });
});

describe('Story 5.6 AC3 — sourceHash is computed over the FULL grounding events, not the reduced prompt', () => {
  it('returns sourceHash = sha256(canonicalJSON(FULL events filtered by refs))', async () => {
    const fullEvents = runIngest();
    const reduced = reducedPromptFor(fullEvents);

    const [annotation] = await new ClaudeInterpreter({ client: makeFake() }).interpret(reduced, fullEvents);

    expect(annotation.sourceHash).toBe(expectedSourceHashOver(fullEvents, GROUNDING_REFS));
  });

  it('the FULL-grounded sourceHash DIFFERS from the reduced-prompt-grounded hash (proves it used arg 2)', async () => {
    const fullEvents = runIngest();
    const reduced = reducedPromptFor(fullEvents);

    const [annotation] = await new ClaudeInterpreter({ client: makeFake() }).interpret(reduced, fullEvents);

    // Hashing the REDUCED slice (payload-free) would yield a different digest; the interpreter must NOT
    // have used it. This is the load-bearing AC3 distinction.
    const reducedHash = expectedSourceHashOver(reduced, GROUNDING_REFS);
    expect(reducedHash).not.toBe(expectedSourceHashOver(fullEvents, GROUNDING_REFS));
    expect(annotation.sourceHash).not.toBe(reducedHash);
    expect(annotation.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------------------------------
// AC3 / backward-compat — a single-arg call grounds over the array it prompts with (unchanged).
// ---------------------------------------------------------------------------------------------------

describe('Story 5.6 AC3 — single-arg interpret(events) is backward-compatible (grounds over the prompt)', () => {
  it('groundingEvents defaults to promptEvents: single-arg sourceHash equals the two-arg same-array call', async () => {
    const events = runIngest();
    const [oneArg] = await new ClaudeInterpreter({ client: makeFake() }).interpret(events);
    const [twoArgSame] = await new ClaudeInterpreter({ client: makeFake() }).interpret(events, events);

    expect(oneArg.sourceHash).toBe(twoArgSame.sourceHash);
    expect(oneArg.sourceHash).toBe(expectedSourceHashOver(events, GROUNDING_REFS));
  });
});
