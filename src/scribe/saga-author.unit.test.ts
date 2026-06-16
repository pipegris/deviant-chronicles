import { describe, expect, it } from 'vitest';
import { SagaAuthor } from './saga-author';
import { buildSagaBrief, type SagaBrief } from './saga-brief';
import { TEACHING } from '../portal/teaching-config';

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

// The author never inspects the brief contents (it JSON-serializes it), so an empty brief is fine for the
// config-knob assertions — they read the recorded request body / the returned string only. Story 5.8: the
// input is the name-free SagaBrief, not a NormalizedEvent[].
const EMPTY_BRIEF: SagaBrief = buildSagaBrief({ projectedEvents: [], annotations: [], teaching: TEACHING });

describe('Story 4.2 (unit) — SagaAuthor.promptVersion is a config knob', () => {
  it('defaults promptVersion to a stable named version', () => {
    // Story 5.8 (§5): bumped to saga-tolkien-v2 because the SYSTEM_PROMPT gained the anonymization clause.
    expect(new SagaAuthor().promptVersion).toBe('saga-tolkien-v2');
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
    await expect(new SagaAuthor({ client: fakeWithRawText('') }).authorSaga(EMPTY_BRIEF)).rejects.toThrow();
  });

  it('rejects when the text block is whitespace-only (trims to empty)', async () => {
    await expect(
      new SagaAuthor({ client: fakeWithRawText('   \n\t  ') }).authorSaga(EMPTY_BRIEF),
    ).rejects.toThrow();
  });
});

describe('Story 4.2 (unit) — the DEFAULT system prompt is the Tolkien-register saga instruction', () => {
  it('sends a default system prompt that names the Tolkien register and the closing flourish', async () => {
    const fake = fakeWithText();
    await new SagaAuthor({ client: fake }).authorSaga(EMPTY_BRIEF);
    const system = fake.calls[0].system as string;
    // The default prompt must aim at the established voice (not a generic "write a summary"): it names
    // the Tolkien register, the Forgemaiden, and the "By hammer and hash" closing cry. [prd.md L336-345]
    expect(system).toMatch(/Tolkien/);
    expect(system).toMatch(/Forgemaiden/);
    expect(system).toMatch(/By hammer and hash/);
  });

  it('serializes the (empty) name-free brief as the user message content', async () => {
    const fake = fakeWithText();
    await new SagaAuthor({ client: fake }).authorSaga(EMPTY_BRIEF);
    const messages = fake.calls[0].messages as Array<{ role?: string; content?: unknown }>;
    expect(messages[0].role).toBe('user');
    // Story 5.8: the content is the serialized SagaBrief object (events/beats empty, teaching present),
    // NOT a bare event array — the brief replaced the NormalizedEvent[] input.
    expect(JSON.parse(messages[0].content as string)).toEqual(EMPTY_BRIEF);
  });
});
