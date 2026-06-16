import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type NormalizedEvent } from '../schema/normalized-event';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';
import { projectEvents } from '../bundle/project-events';
import { fixtureAnnotations } from '../interpret/fixture-interpreter';
import { TEACHING } from '../portal/teaching-config';
import { buildSagaBrief, type SagaBrief } from './saga-brief';

// RED-PHASE acceptance test for Story 4.2 — AC1: the offline SagaAuthor that calls claude-opus-4-8
// for ONE Tolkien-register PROSE passage over the event window and returns it as a string, with an
// INJECTABLE client (the Story 3.2 seam). It imports the not-yet-authored `./saga-author`
// (SagaAuthor), so it ERRORS now (RED — module resolution fails); it turns GREEN when the dev authors
// src/scribe/saga-author.ts.
//
// AC1 (verbatim, epics.md#Story-4.2): "Given scripts/scribe-saga.ts When it runs offline Then it
// authors one Saga via claude-opus-4-8 (Tolkien-register prompt) over the relevant Event window and
// bakes it into the ReplayBundle."
//
// Every assertion runs against a MOCKED Anthropic client (an injected `AnthropicLike` fake) — ZERO
// real network, no ANTHROPIC_API_KEY. The single real claude-opus-4-8 Saga bake is a DEFERRED
// operator step (Epic 5 / Story 5.2 bundle assembly), explicitly NOT this gate. This mirrors
// src/interpret/claude-interpreter.test.ts (Story 3.2) — swapping forced-tool output for plain prose.
import { SagaAuthor } from './saga-author';

// --- The events input is built by driving the REAL ingest pipeline over the committed fixtures, so
// the Saga author receives the SAME validated NormalizedEvent[] the rest of the system sees.
// `runIngest`/`readFixture` are copied verbatim from src/interpret/claude-interpreter.test.ts L32-49.
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

// Story 5.8 — the Saga input is now the name-free SagaBrief, built over the SAME public surface the bundle
// ships: the payload-free projection of the fixture events + the frozen fixture beats + the teaching table.
// (AC4 task: "rebuild the test input as buildSagaBrief(...) over the committed fixture's public surface".)
function buildBrief(): SagaBrief {
  return buildSagaBrief({
    projectedEvents: projectEvents(runIngest()),
    annotations: fixtureAnnotations(),
    teaching: TEACHING,
  });
}

// The representative real-identifier set (Story 5.7 real-bake leak, story §0) + path/payload markers that
// must NEVER reach the Saga prompt — re-proving the BRIEF is what is serialized (AC1/AC4).
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

// --- The canned lush passage the fake returns. The Saga is FREE PROSE (NOT structured/tool output) —
// so unlike the interpreter the fake's content is a single `text` block, not a `tool_use` block.
const CANNED_SAGA =
  'And the Forgemaiden raised her hammer against the Hanging Curse of the Endless Wait, ' +
  'and the kingdom held its breath; and when the bug was bound at last she cried: ' +
  '"By hammer and hash, it is done!"';

// --- The narrow structural `AnthropicLike` fake (the load-bearing test seam). It records the `body`
// arg of every messages.create call and returns whatever canned content the test supplies. Typing
// against the minimum surface keeps the fake trivial and avoids importing the SDK's full type. This is
// the SAME fake shape claude-interpreter.test.ts uses (a `content: ContentBlock[]` response).
interface FakeContentBlock {
  type: string;
  text?: string;
  input?: unknown;
}

interface FakeClient {
  messages: {
    create(body: Record<string, unknown>): Promise<{ content: FakeContentBlock[] }>;
  };
  calls: Array<Record<string, unknown>>;
}

function makeFakeClient(content: FakeContentBlock[]): FakeClient {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    messages: {
      async create(body: Record<string, unknown>) {
        calls.push(body);
        return { content };
      },
    },
  };
}

// A fake whose single text block carries the canned lush Saga (the happy path).
function fakeWithCannedText(text: string = CANNED_SAGA): FakeClient {
  return makeFakeClient([{ type: 'text', text }]);
}

describe('Story 4.2 / AC1 — SagaAuthor builds a claude-opus-4-8 PROSE request (right model, Tolkien prompt, event window)', () => {
  it('calls messages.create exactly once with model claude-opus-4-8 by default', async () => {
    const fake = fakeWithCannedText();
    await new SagaAuthor({ client: fake }).authorSaga(buildBrief());
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].model).toBe('claude-opus-4-8');
  });

  it('sends a non-empty system prompt (the Tolkien-register saga instruction)', async () => {
    const fake = fakeWithCannedText();
    await new SagaAuthor({ client: fake }).authorSaga(buildBrief());
    const body = fake.calls[0];
    expect(typeof body.system).toBe('string');
    expect((body.system as string).length).toBeGreaterThan(0);
  });

  it('carries the name-free SagaBrief (not a bare event array with eventIds) as the user message', async () => {
    // Story 5.8 (AC4): the user content re-parses to the BRIEF shape — named top-level fields
    // (events/beats/teaching), NOT a bare NormalizedEvent[] with eventIds (the old, leak-shaped input).
    const brief = buildBrief();
    const fake = fakeWithCannedText();
    await new SagaAuthor({ client: fake }).authorSaga(brief);
    const body = fake.calls[0];
    const messages = body.messages as Array<{ role?: string; content?: unknown }>;
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
    const userMsg = messages[0];
    expect(userMsg.role).toBe('user');
    expect(typeof userMsg.content).toBe('string');
    const reparsed = JSON.parse(userMsg.content as string) as Record<string, unknown>;
    expect(reparsed).toHaveProperty('events');
    expect(reparsed).toHaveProperty('beats');
    expect(reparsed).toHaveProperty('teaching');
    expect(Array.isArray(reparsed.events)).toBe(true);
    expect((reparsed.events as unknown[]).length).toBe(brief.events.length);
    // The brief carries NO eventIds and NO snippet — the leak-shaped fields are gone (defense in depth).
    const firstEvent = (reparsed.events as Array<Record<string, unknown>>)[0];
    expect(firstEvent).not.toHaveProperty('eventId');
    expect(firstEvent).not.toHaveProperty('snippet');
  });

  it('is a PROSE call: it sets NO tools / tool_choice (unlike the structured-output interpreter)', async () => {
    // The Saga is one free-form prose string, NOT a typed payload — so the request must be a plain
    // text completion with no forced tool. (This is the documented divergence from Story 3.2.)
    const fake = fakeWithCannedText();
    await new SagaAuthor({ client: fake }).authorSaga(buildBrief());
    const body = fake.calls[0];
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('tool_choice');
  });

  it('passes a required max_tokens and omits the sampling params claude-opus-4-8 rejects', async () => {
    // max_tokens is REQUIRED by the Messages API. claude-opus-4-8 uses adaptive thinking and 400s on
    // temperature/top_p/budget_tokens — the request must omit them (the verified contract).
    const fake = fakeWithCannedText();
    await new SagaAuthor({ client: fake }).authorSaga(buildBrief());
    const body = fake.calls[0];
    expect(typeof body.max_tokens).toBe('number');
    expect((body.max_tokens as number) > 0).toBe(true);
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body).not.toHaveProperty('top_k');
    expect(body).not.toHaveProperty('budget_tokens');
  });
});

describe('Story 4.2 / AC1 — returns the canned Saga text (the prose result)', () => {
  it('resolves to the first text content block, trimmed', async () => {
    const saga = await new SagaAuthor({ client: fakeWithCannedText() }).authorSaga(buildBrief());
    expect(saga).toBe(CANNED_SAGA);
  });

  it('trims surrounding whitespace from the returned passage', async () => {
    const fake = fakeWithCannedText(`\n\n  ${CANNED_SAGA}  \n`);
    const saga = await new SagaAuthor({ client: fake }).authorSaga(buildBrief());
    expect(saga).toBe(CANNED_SAGA);
  });
});

describe('Story 4.2 / AC1 — fails LOUD on no text block (a refusal/empty must not bake an empty Saga)', () => {
  it('rejects when the response carries NO content blocks at all', async () => {
    const fake = makeFakeClient([]);
    await expect(new SagaAuthor({ client: fake }).authorSaga(buildBrief())).rejects.toThrow();
  });

  it('rejects when the response carries only NON-text blocks (e.g. a tool_use)', async () => {
    // A response with no `text` block (the model refused / returned only a tool_use) must throw — the
    // authoring boundary is fail-loud, exactly like the interpreter's missing-tool_use guard.
    const fake = makeFakeClient([{ type: 'tool_use', input: {} }]);
    await expect(new SagaAuthor({ client: fake }).authorSaga(buildBrief())).rejects.toThrow();
  });
});

describe('Story 4.2 / AC1 — the model is a config knob (config-as-data, no buried literal)', () => {
  it('sends the model id it is constructed with', async () => {
    const fake = fakeWithCannedText();
    await new SagaAuthor({ client: fake, model: 'claude-opus-4-8' }).authorSaga(buildBrief());
    expect(fake.calls[0].model).toBe('claude-opus-4-8');
  });

  it('defaults the model to claude-opus-4-8 when no model option is given', async () => {
    const fake = fakeWithCannedText();
    await new SagaAuthor({ client: fake }).authorSaga(buildBrief());
    expect(fake.calls[0].model).toBe('claude-opus-4-8');
  });

  it('uses an injected systemPrompt verbatim when provided (the prompt is an option)', async () => {
    const customPrompt = 'CUSTOM TOLKIEN SAGA PROMPT — write one lush elegiac closing passage.';
    const fake = fakeWithCannedText();
    await new SagaAuthor({ client: fake, systemPrompt: customPrompt }).authorSaga(buildBrief());
    expect(fake.calls[0].system).toBe(customPrompt);
  });
});

describe('Story 5.8 / AC2 — the default SYSTEM_PROMPT carries the anonymization clause (the belt)', () => {
  it('forbids inventing real identifiers and instructs fantasy/role/concept language only', async () => {
    const fake = fakeWithCannedText();
    await new SagaAuthor({ client: fake }).authorSaga(buildBrief());
    const system = (fake.calls[0].system as string).toLowerCase();
    expect(system).toMatch(/(real|actual)[^.]*\b(name|identifier)/);
    expect(system).toMatch(/invent|fabricate|make up|do not/);
    expect(system).toMatch(/table/);
    expect(system).toMatch(/(env|environment)/);
    expect(system).toMatch(/(library|module|file|class|function)/);
    expect(system).toMatch(/fantasy|role|concept/);
  });

  it('PRESERVES the Tolkien-register voice (the clause is appended, not a replacement)', async () => {
    const fake = fakeWithCannedText();
    await new SagaAuthor({ client: fake }).authorSaga(buildBrief());
    const system = fake.calls[0].system as string;
    expect(system).toMatch(/Tolkien/);
    expect(system).toMatch(/Forgemaiden/);
    expect(system).toMatch(/By hammer and hash/);
  });
});

describe('Story 5.8 / AC1+AC4 — the serialized brief prompt is name-free', () => {
  it('the user-message content contains NO snippet, NO path markers, NONE of the real-identifier set', async () => {
    const fake = fakeWithCannedText();
    await new SagaAuthor({ client: fake }).authorSaga(buildBrief());
    const messages = fake.calls[0].messages as Array<{ content?: unknown }>;
    const content = messages[0].content as string;
    for (const marker of PATH_MARKERS) {
      expect(content).not.toContain(marker);
    }
    for (const id of REAL_IDENTIFIERS) {
      expect(content).not.toContain(id);
    }
  });
});

describe('Story 4.2 / AC1 — NO real network: the injected fake is the only client', () => {
  // The strongest available headless proof of "no real call": the fake has no network, and the TEST
  // never constructs a real `Anthropic`. (The build + dist-grep in Task 6 is the primary R4 proof;
  // this is the regression guard at the unit level — mirrors claude-interpreter.test.ts §"NO real
  // network", post-F3: strip line-comments, then assert no real ESM import / require / `new Anthropic(`
  // survives in EXECUTABLE code. The bare grep over the whole file can never pass because the file's
  // own AC-quoting comments name the SDK.)
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'saga-author.test.ts'),
    'utf8',
  );
  const codeOnly = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  it('the test source has no real ESM import / require of the SDK (the fake stands in for it)', () => {
    expect(codeOnly).not.toMatch(/from\s+['"]@anthropic-ai\/sdk['"]/);
    expect(codeOnly).not.toMatch(/import\s*\(\s*['"]@anthropic-ai\/sdk['"]/);
    expect(codeOnly).not.toMatch(/require\s*\(\s*['"]@anthropic-ai\/sdk['"]/);
  });

  it('the test source never constructs a real Anthropic client (new Anthropic())', () => {
    const executable = codeOnly
      .split('\n')
      .filter((line) => !line.includes('never constructs a real Anthropic client'))
      .join('\n');
    expect(executable).not.toMatch(/new\s+Anthropic\s*\(/);
  });
});
