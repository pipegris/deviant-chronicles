import { describe, expect, it } from 'vitest';
import type { ProjectedEvent } from '../schema/replay-bundle';
import type { BeatAnnotation } from '../schema/beat-annotation';
import { TEACHING } from '../portal/teaching-config';
import { SagaAuthor } from './saga-author';
// RED-PHASE: imports the not-yet-authored ./saga-brief, so this ERRORS now (module resolution) until
// the dev authors src/scribe/saga-brief.ts. It turns GREEN when (a) saga-brief.ts exists and (b)
// SagaAuthor's default SYSTEM_PROMPT carries the anonymization clause (AC2) and accepts the brief (AC4).
import { buildSagaBrief } from './saga-brief';

// RED-PHASE acceptance test for Story 5.8 (AC2, AC4) — the name-safe SagaAuthor. AC2: the default system
// prompt EXPLICITLY forbids emitting or inventing any real product/project/file/module/class/function/
// table/column/env-var/library name and instructs fantasy/role/concept language ONLY (the BELT over the
// already-name-free brief). AC4: the mocked SagaAuthor receives the BRIEF (not the snippet-bearing
// tagging-view, not the full events), so the serialized prompt is name-free.
//
// These are co-located alongside the existing saga-author.test.ts (the Story 4.2 suite) and are the NEW
// ACs the dev reconciles per Task 3. ZERO real network — an injected AnthropicLike fake records the
// request body. DO NOT add production code to make these pass here (red half of red-green).

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

const PATH_MARKERS = ['snippet', '/', '\\', '.ts', '.json', 'src/'];

const CANNED_SAGA =
  'And the Forgemaiden raised her hammer against the curse, and when it was bound at last she cried: ' +
  '"By hammer and hash, it is done!"';

interface FakeContentBlock {
  type: string;
  text?: string;
}

interface FakeClient {
  messages: {
    create(body: Record<string, unknown>): Promise<{ content: FakeContentBlock[] }>;
  };
  calls: Array<Record<string, unknown>>;
}

function fakeWithText(text: string = CANNED_SAGA): FakeClient {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    messages: {
      async create(body: Record<string, unknown>) {
        calls.push(body);
        return { content: [{ type: 'text', text }] };
      },
    },
  };
}

function makeProjectedEvents(): ProjectedEvent[] {
  // PLANT real-identifier-shaped strings into the fields buildSagaBrief DROPS (eventId, orderKey.streamId)
  // so the "serialized prompt is name-free" proof at the AUTHOR boundary is LOAD-BEARING, not a tautology
  // over clean fixtures: if the brief ever carried a dropped field, the leak would reach the prompt and the
  // .not.toContain assertions below would FAIL.
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
  ];
}

function makeAnnotations(): BeatAnnotation[] {
  // Same planting in the DROPPED beat fields (eventRef/interpreterVersion/sourceHash/groundingPointer).
  return [
    {
      eventRef: 'FK-23503',
      beatType: 'shaman',
      confidence: 0.9,
      interpreterVersion: 'Drizzle',
      sourceHash: 'expires_at',
      groundingPointer: { eventRefs: ['LogMailer', 'COALESCE', 'identity-client'] },
    },
  ];
}

function makeBrief() {
  return buildSagaBrief({
    projectedEvents: makeProjectedEvents(),
    annotations: makeAnnotations(),
    teaching: TEACHING,
  });
}

describe('Story 5.8 / AC2 — the default SYSTEM_PROMPT carries the anonymization clause (the belt)', () => {
  it('forbids emitting/inventing real identifiers and instructs fantasy/role/concept language only', async () => {
    const fake = fakeWithText();
    await new SagaAuthor({ client: fake }).authorSaga(makeBrief());
    const system = (fake.calls[0].system as string).toLowerCase();
    // The clause must FORBID real names (any reasonable phrasing) AND name the abstract register.
    expect(system).toMatch(/(real|actual)[^.]*\b(name|identifier)/);
    expect(system).toMatch(/invent|fabricate|make up|do not/);
    // It must enumerate the concrete identifier kinds it bans (a representative subset must be named).
    expect(system).toMatch(/table/);
    expect(system).toMatch(/(env|environment)/);
    expect(system).toMatch(/(library|module|file|class|function)/);
    // It instructs fantasy/role/concept language only.
    expect(system).toMatch(/fantasy|role|concept/);
  });

  it('PRESERVES the Tolkien-register voice (the clause is appended, not a replacement)', async () => {
    const fake = fakeWithText();
    await new SagaAuthor({ client: fake }).authorSaga(makeBrief());
    const system = fake.calls[0].system as string;
    expect(system).toMatch(/Tolkien/);
    expect(system).toMatch(/Forgemaiden/);
    expect(system).toMatch(/By hammer and hash/);
  });
});

describe('Story 5.8 / AC2 — the fail-loud empty-Saga guard is preserved', () => {
  it('rejects when the response carries an empty/whitespace-only text block', async () => {
    const fakeEmpty = fakeWithText('   \n\t ');
    await expect(new SagaAuthor({ client: fakeEmpty }).authorSaga(makeBrief())).rejects.toThrow();
  });

  it('rejects when the response carries no text block at all', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fakeNoText: FakeClient = {
      calls,
      messages: {
        async create(body: Record<string, unknown>) {
          calls.push(body);
          return { content: [] };
        },
      },
    };
    await expect(new SagaAuthor({ client: fakeNoText }).authorSaga(makeBrief())).rejects.toThrow();
  });
});

describe('Story 5.8 / AC4 — the mocked SagaAuthor receives the name-free BRIEF (not the tagging-view/events)', () => {
  it('the user-message content re-parses to the BRIEF shape (events/beats/teaching), not eventIds', async () => {
    const brief = makeBrief();
    const fake = fakeWithText();
    await new SagaAuthor({ client: fake }).authorSaga(brief);
    const body = fake.calls[0];
    const messages = body.messages as Array<{ role?: string; content?: unknown }>;
    expect(messages[0].role).toBe('user');
    expect(typeof messages[0].content).toBe('string');
    const reparsed = JSON.parse(messages[0].content as string) as Record<string, unknown>;
    // The brief shape — NOT a bare array of events with eventIds (that was the legacy NormalizedEvent[]
    // input). The brief has named top-level fields.
    expect(reparsed).toHaveProperty('events');
    expect(reparsed).toHaveProperty('beats');
    expect(reparsed).toHaveProperty('teaching');
    expect(Array.isArray(reparsed.events)).toBe(true);
    expect((reparsed.events as unknown[]).length).toBe(brief.events.length);
    // The brief has NO eventIds and NO snippet (defense in depth — the leak-shaped fields are gone).
    const firstEvent = (reparsed.events as Array<Record<string, unknown>>)[0];
    expect(firstEvent).not.toHaveProperty('eventId');
    expect(firstEvent).not.toHaveProperty('snippet');
  });

  it('the serialized prompt is name-free: NO snippet, NO path markers, NONE of the real-identifier set', async () => {
    const fake = fakeWithText();
    await new SagaAuthor({ client: fake }).authorSaga(makeBrief());
    const messages = fake.calls[0].messages as Array<{ content?: unknown }>;
    const content = messages[0].content as string;
    for (const marker of PATH_MARKERS) {
      expect(content).not.toContain(marker);
    }
    for (const id of REAL_IDENTIFIERS) {
      expect(content).not.toContain(id);
    }
  });

  it('still a PROSE call over the brief: model claude-opus-4-8, no tools/tool_choice, required max_tokens', async () => {
    const fake = fakeWithText();
    await new SagaAuthor({ client: fake }).authorSaga(makeBrief());
    const body = fake.calls[0];
    expect(body.model).toBe('claude-opus-4-8');
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('tool_choice');
    expect(typeof body.max_tokens).toBe('number');
    expect((body.max_tokens as number) > 0).toBe(true);
  });
});
