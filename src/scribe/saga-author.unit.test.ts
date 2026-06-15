import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import { SagaAuthor } from './saga-author';

// Story 4.2 unit tests for SagaAuthor — the config-knob + default-prompt surface NOT covered by the
// ATDD acceptance test (saga-author.test.ts), which pins the request shape / canned return / fail-loud
// / no-network. These pin (a) the promptVersion knob (default + injected — it stamps which authoring
// instruction produced the Saga, parallel to the interpreter's version knobs) and (b) the DEFAULT
// system prompt actually carries the Tolkien-register instruction (the "no buried generic literal"
// guarantee). All against the same injected-fake seam — ZERO network. [story Task 1; CLAUDE.md
// "config-as-data"]

interface FakeContentBlock {
  type: string;
  text?: string;
}

interface FakeClient {
  messages: { create(body: Record<string, unknown>): Promise<{ content: FakeContentBlock[] }> };
  calls: Array<Record<string, unknown>>;
}

function fakeWithText(text = 'By hammer and hash, it is done!'): FakeClient {
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

// The author never inspects event contents (it JSON-serializes the array), so an empty window is fine
// for the config-knob assertions — they read the recorded request body / the returned string only.
const NO_EVENTS: NormalizedEvent[] = [];

describe('Story 4.2 (unit) — SagaAuthor.promptVersion is a config knob', () => {
  it('defaults promptVersion to a stable named version', () => {
    expect(new SagaAuthor().promptVersion).toBe('saga-tolkien-v1');
  });

  it('uses an injected promptVersion verbatim', () => {
    expect(new SagaAuthor({ promptVersion: 'saga-tolkien-v2' }).promptVersion).toBe('saga-tolkien-v2');
  });
});

describe('Story 4.2 (unit) — fails LOUD on an empty/whitespace-only text block (review F1)', () => {
  // AC1: "a refusal/empty must not silently bake an empty Saga." A refusal can surface as a
  // PRESENT-but-empty text block ({type:'text', text:''}), not only a missing/non-text block (which
  // saga-author.test.ts already covers). The trim-then-length guard must throw in both blank cases so
  // an empty string is never baked.
  function fakeWithRawText(text: string): FakeClient {
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

  it('rejects when the text block is the empty string', async () => {
    await expect(new SagaAuthor({ client: fakeWithRawText('') }).authorSaga(NO_EVENTS)).rejects.toThrow();
  });

  it('rejects when the text block is whitespace-only (trims to empty)', async () => {
    await expect(
      new SagaAuthor({ client: fakeWithRawText('   \n\t  ') }).authorSaga(NO_EVENTS),
    ).rejects.toThrow();
  });
});

describe('Story 4.2 (unit) — the DEFAULT system prompt is the Tolkien-register saga instruction', () => {
  it('sends a default system prompt that names the Tolkien register and the closing flourish', async () => {
    const fake = fakeWithText();
    await new SagaAuthor({ client: fake }).authorSaga(NO_EVENTS);
    const system = fake.calls[0].system as string;
    // The default prompt must aim at the established voice (not a generic "write a summary"): it names
    // the Tolkien register, the Forgemaiden, and the "By hammer and hash" closing cry. [prd.md L336-345]
    expect(system).toMatch(/Tolkien/);
    expect(system).toMatch(/Forgemaiden/);
    expect(system).toMatch(/By hammer and hash/);
  });

  it('still serializes the (empty) event window as the user message content', async () => {
    const fake = fakeWithText();
    await new SagaAuthor({ client: fake }).authorSaga(NO_EVENTS);
    const messages = fake.calls[0].messages as Array<{ role?: string; content?: unknown }>;
    expect(messages[0].role).toBe('user');
    expect(JSON.parse(messages[0].content as string)).toEqual([]);
  });
});
