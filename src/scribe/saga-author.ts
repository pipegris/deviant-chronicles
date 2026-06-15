import type { NormalizedEvent } from '../schema/normalized-event';

// Story 4.2 / AC1 — the OFFLINE Saga authoring logic (Layer 2, Told): calls claude-opus-4-8 for ONE
// lush, Tolkien-register PROSE passage over the session's event window and returns it as a string.
// This is the SECOND (and last) production module that touches @anthropic-ai/sdk (R4-allowed in
// scribe/) — and, like the Story 3.2 interpreter, it imports the SDK LAZILY, only when no client is
// injected, so the browser bundle never pulls it (the real R4 proof is the dist-grep in Task 6) and
// tests/CI never construct a real client. It is browser-UNREACHABLE: nothing on the
// main.ts -> render/arena-boot path imports it (only its co-located test + scripts/scribe-saga.ts
// do), so the SDK is tree-shaken out of dist/.
//
// The testable authoring logic lives HERE (under src/), not in scripts/, for the SAME reason as
// Story 3.2: vitest only runs src/**/*.test.ts, so logic in scripts/ could not be gate-tested.
//
// The DIVERGENCE from the interpreter (which forced a tool to get a typed BeatAnnotation[]): the Saga
// is ONE free-form prose STRING, so this is a plain text completion with NO tools/tool_choice — it
// reads the first `text` content block and returns its trimmed text. [architecture.md#LLM Integration
// L188 "one lush prose passage"]

// The narrow structural surface this module depends on — just enough of the SDK's `messages.create`
// for a fake to stand in trivially without importing the SDK's full type. `create` takes the request
// body and resolves to a response carrying a content-block array. (Mirrors claude-interpreter.ts
// AnthropicLike verbatim in shape.)
export interface AnthropicLike {
  messages: {
    create(body: Record<string, unknown>): Promise<{ content: ContentBlock[] }>;
  };
}

// The minimum of a response content block this module reads: its discriminating `type` and, for a
// text block, the prose `text`. Other SDK fields are ignored.
interface ContentBlock {
  type: string;
  text?: string;
}

// Default config knobs (config-as-data, not magic strings buried in the call). The model is
// claude-opus-4-8 — the project's single lush-prose authoring model. The promptVersion stamps which
// authoring instruction produced the Saga (parallels the interpreter's version knobs); it is carried
// as metadata for the operator/Story-5.2 bundle, not sent in the request body. [CLAUDE.md
// "config-as-data … no hardcoded tuning constants"]
const DEFAULT_MODEL = 'claude-opus-4-8';
const DEFAULT_PROMPT_VERSION = 'saga-tolkien-v1';
// Generous, fixed ceiling for the (single, non-streaming, offline) lush passage. max_tokens is
// REQUIRED by the Messages API. Sampling params / budget_tokens are deliberately OMITTED —
// claude-opus-4-8 uses adaptive thinking and 400s on those. [claude-api skill]
const MAX_TOKENS = 2048;

// The default Tolkien-register saga prompt — a named module constant (the established
// claude-interpreter.ts SYSTEM_PROMPT pattern; NOT externalized to config/*.json). It instructs claude
// to write ONE lush, elegiac/triumphant closing Saga in Tolkien register over the supplied session
// events, faithful to the real events (no invented stakes — SM-C1), ending on the victory; the
// Forgemaiden's cry "By hammer and hash, it is done!" is an apt closing flourish. The prompt is a
// constructor option (`systemPrompt?`) so it stays a config knob, not a buried literal. [prd.md
// #"Aesthetic and Tone" L336-345]
const SYSTEM_PROMPT =
  'You are the Scribe of a deterministic replay rendered as a 16-bit high-fantasy battle. ' +
  'Read the JSON array of normalized session events and compose ONE lush, elegiac, triumphant ' +
  'closing Saga in a measured, mythic Tolkien register — the kingdom-spanning arc of the whole ' +
  'session, culminating in the victory. Stay FAITHFUL to the real events: dramatize what happened, ' +
  'invent no stakes that the events do not bear. Render the developer as the Forgemaiden, bugs and ' +
  'errors as curses and beasts, the fix as the binding spell. Close on the Forgemaiden’s ' +
  'battle cry: "By hammer and hash, it is done!" Return ONLY the Saga prose, no preamble.';

export interface SagaAuthorOptions {
  client?: AnthropicLike;
  model?: string;
  promptVersion?: string;
  systemPrompt?: string;
}

export class SagaAuthor {
  private readonly injectedClient?: AnthropicLike;
  private readonly model: string;
  private readonly systemPrompt: string;
  readonly promptVersion: string;

  constructor(options: SagaAuthorOptions = {}) {
    this.injectedClient = options.client;
    this.model = options.model ?? DEFAULT_MODEL;
    this.systemPrompt = options.systemPrompt ?? SYSTEM_PROMPT;
    this.promptVersion = options.promptVersion ?? DEFAULT_PROMPT_VERSION;
  }

  // Author the closing Saga over the full event window. A PLAIN text completion (no tools): the Saga
  // is free prose. Reads the first `text` content block and returns its trimmed text. A response with
  // no text block (a refusal / empty) THROWS — fail-loud at the authoring boundary, so a bad bake never
  // silently writes an empty Saga (the interpreter's missing-tool_use guard, applied to prose).
  async authorSaga(events: NormalizedEvent[]): Promise<string> {
    const client = await this.resolveClient();

    const response = await client.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS,
      system: this.systemPrompt,
      messages: [{ role: 'user', content: JSON.stringify(events) }],
    });

    const textBlock = response.content.find(
      (b) => b.type === 'text' && typeof b.text === 'string',
    );
    // Fail-loud at the authoring boundary on BOTH no-text-block AND an empty/whitespace-only text
    // block: a refusal can surface as either a missing text block or a present-but-empty one
    // ({type:'text', text:''}), and AC1 requires that neither silently bakes an empty Saga.
    const saga = textBlock?.text?.trim() ?? '';
    if (saga.length === 0) {
      throw new Error(
        'SagaAuthor: response carried no Saga prose (a refusal/empty must not bake an empty Saga).',
      );
    }
    return saga;
  }

  // Use the injected fake when provided (tests + the operator path). Otherwise lazily import +
  // construct the real SDK client — `new Anthropic()` resolves ANTHROPIC_API_KEY from the environment
  // (never a hardcoded/literal key). The dynamic import keeps the SDK out of the browser bundle and out
  // of every test path. [claude-api skill; .env.example; claude-interpreter.ts L167-173]
  private async resolveClient(): Promise<AnthropicLike> {
    if (this.injectedClient !== undefined) {
      return this.injectedClient;
    }
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    return new Anthropic() as unknown as AnthropicLike;
  }
}
