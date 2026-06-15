import { createHash } from 'node:crypto';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { TaggingViewEvent } from '../bundle/tagging-view';
import { BeatAnnotationSchema, type BeatAnnotation } from '../schema/beat-annotation';
import type { BeatInterpreter } from './beat-interpreter';
import { canonicalJSON } from './freeze';

// Story 5.6 (AC3, §8) — the interpreter PROMPT input is either the FULL NormalizedEvent[] (the legacy /
// default path) or the compact reduced TaggingViewEvent[] (the bake path, so a large session fits the
// context window). The prompt is OPAQUE to the interpreter — it is only JSON.stringify'd into the request
// — so this union just documents the two real shapes; the structural grounding contract lives entirely on
// the SEPARATE `groundingEvents: NormalizedEvent[]` arg. `import type` keeps this erased at runtime (no
// interpret→bundle runtime import / no cycle; the only file-level edge stays bundle→interpret via freeze).
type PromptEvents = readonly NormalizedEvent[] | readonly TaggingViewEvent[];

// Story 3.2 / AC1 — the REAL BeatInterpreter: calls claude-sonnet-4-6 via FORCED tool output
// and Zod-validates the result into BeatAnnotation[]. This is the ONLY production module that
// touches @anthropic-ai/sdk (R4-allowed in interpret/) — and it imports the SDK LAZILY, only
// when no client is injected, so the browser bundle never pulls it (the real R4 proof is the
// dist-grep in Task 7) and tests/CI never construct a real client.
// [architecture.md#LLM Integration L185-187; #R4 L236-238]

// The narrow structural surface the interpreter depends on — just enough of the SDK's
// `messages.create` for a fake to stand in trivially without importing the SDK's full type.
// `create` takes the request body and resolves to a response carrying a content-block array.
export interface AnthropicLike {
  messages: {
    create(body: Record<string, unknown>): Promise<{ content: ContentBlock[] }>;
  };
}

// The minimum of a response content block this module reads: its discriminating `type` and,
// for a tool_use block, the already-PARSED `input` object (the SDK hands back an object, not a
// JSON string — so we never JSON.parse it; we Zod-validate it). Other SDK fields are ignored.
interface ContentBlock {
  type: string;
  input?: unknown;
}

// Default config knobs (config-as-data, not magic numbers buried in the call): the model and
// the two versions that stamp/address the interpretation. Escalation is just a different
// `model` id — see Dev Notes §"Escalation". [CLAUDE.md "no hardcoded tuning constants"]
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_INTERPRETER_VERSION = 'claude-sonnet-4-6/v1';
const DEFAULT_PROMPT_VERSION = 'beat-tag-v1';
// Generous, fixed ceiling for the (small, non-streaming, offline) annotation array. max_tokens
// is REQUIRED by the Messages API. Sampling params / budget_tokens are deliberately OMITTED —
// claude-sonnet-4-6 + claude-opus-4-8 use adaptive thinking and 400 on those. [claude-api skill]
const MAX_TOKENS = 4096;

const EMIT_TOOL_NAME = 'emit_beat_annotations';

// The forced tool. The model emits ONLY the interpretive fields it can judge —
// eventRef/beatType/confidence/groundingPointer — but NOT interpreterVersion/sourceHash: those are
// PROVENANCE the interpreter stamps authoritatively post-parse (the model must not control its own
// content address). [Dev Notes §"Authoritative provenance"]
const EMIT_BEATS_TOOL = {
  name: EMIT_TOOL_NAME,
  description:
    'Emit the signature narrative beats (shaman/dispel/summon) found in the session, each ' +
    'grounded back to the Layer-0 event(s) it dramatizes.',
  input_schema: {
    type: 'object',
    properties: {
      annotations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            eventRef: { type: 'string' },
            beatType: { type: 'string', enum: ['shaman', 'dispel', 'summon'] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            groundingPointer: {
              type: 'object',
              properties: {
                eventRefs: { type: 'array', items: { type: 'string' } },
              },
              required: ['eventRefs'],
            },
          },
          required: ['eventRef', 'beatType', 'confidence', 'groundingPointer'],
        },
      },
    },
    required: ['annotations'],
  },
} as const;

const SYSTEM_PROMPT =
  'You are a narrative-beat interpreter for a deterministic replay system. Read the ' +
  'JSON array of normalized session events and tag the signature beats (shaman, dispel, ' +
  'summon). For each beat, set eventRef to the anchor event id, and groundingPointer.eventRefs ' +
  'to the full set of event ids it dramatizes (including the anchor). Emit them via the ' +
  `${EMIT_TOOL_NAME} tool. Make no claim you cannot ground in the provided events.`;

export interface ClaudeInterpreterOptions {
  client?: AnthropicLike;
  model?: string;
  promptVersion?: string;
  interpreterVersion?: string;
}

export class ClaudeInterpreter implements BeatInterpreter {
  private readonly injectedClient?: AnthropicLike;
  private readonly model: string;
  readonly interpreterVersion: string;
  readonly promptVersion: string;

  constructor(options: ClaudeInterpreterOptions = {}) {
    this.injectedClient = options.client;
    this.model = options.model ?? DEFAULT_MODEL;
    this.interpreterVersion = options.interpreterVersion ?? DEFAULT_INTERPRETER_VERSION;
    this.promptVersion = options.promptVersion ?? DEFAULT_PROMPT_VERSION;
  }

  // Story 5.6 / Task 4 (AC3, §8): `groundingEvents` is an OPTIONAL second arg defaulting to
  // `promptEvents` — so a single-arg call is unchanged (grounds over the array it prompts with) and the
  // BeatInterpreter interface stays single-arg (this is a ClaudeInterpreter-private extension). At bake
  // time the script passes the REDUCED tagging view as `promptEvents` (so the large session fits the
  // context window) and the FULL scrubbed events as `groundingEvents`, so the prompt shrinks while
  // sourceHash + provenance stay computed over the full events (provenance unchanged). The forced-tool /
  // validation logic is identical.
  async interpret(
    promptEvents: PromptEvents,
    groundingEvents: NormalizedEvent[] = promptEvents as NormalizedEvent[],
  ): Promise<BeatAnnotation[]> {
    const client = await this.resolveClient();

    const response = await client.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(promptEvents) }],
      tools: [EMIT_BEATS_TOOL],
      tool_choice: { type: 'tool', name: EMIT_TOOL_NAME },
    });

    // Find the forced tool_use block. Absent → fail LOUD: the Layer-1 boundary is strict at
    // build time, so a refusal/text-only response must not silently yield zero beats.
    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (toolUse === undefined) {
      throw new Error(
        `ClaudeInterpreter: response carried no tool_use block (expected forced ${EMIT_TOOL_NAME}).`,
      );
    }

    // The SDK returns block.input ALREADY parsed (an object) — do NOT JSON.parse it. Read the
    // annotations array and Zod-validate each element; a malformed payload throws (fail-loud).
    const input = toolUse.input as { annotations?: unknown } | undefined;
    const rawAnnotations = input?.annotations;
    if (!Array.isArray(rawAnnotations)) {
      throw new Error(
        'ClaudeInterpreter: tool_use input did not carry an `annotations` array.',
      );
    }

    // Stamp AUTHORITATIVE provenance over the model's interpretive fields, THEN validate. The
    // model never controls interpreterVersion (the interpreter's own id) or sourceHash (derived
    // deterministically over the grounded events) — so the frozen annotation's content address is
    // interpreter-stamped, not LLM-forgeable, and stays consistent with annotationHash. Zod still
    // validates the model's eventRef/beatType/confidence/groundingPointer (fail-loud preserved).
    return rawAnnotations.map((a) => this.stampProvenance(a, groundingEvents));
  }

  // Overwrite the two provenance fields with interpreter-authoritative values, then parse. The
  // grounded slice (events whose eventId is in the model's groundingPointer.eventRefs, in event
  // order) is read defensively: a malformed/absent groundingPointer yields an empty slice here and
  // is caught LOUD by the subsequent BeatAnnotationSchema.parse (groundingPointer is required).
  private stampProvenance(raw: unknown, events: NormalizedEvent[]): BeatAnnotation {
    const candidate = (raw ?? {}) as { groundingPointer?: { eventRefs?: unknown } };
    const refs = candidate.groundingPointer?.eventRefs;
    const refSet = new Set(Array.isArray(refs) ? (refs as unknown[]).map(String) : []);
    const grounded = events.filter((e) => refSet.has(e.eventId));
    const sourceHash = createHash('sha256').update(canonicalJSON(grounded)).digest('hex');
    return BeatAnnotationSchema.parse({
      ...(raw as Record<string, unknown>),
      interpreterVersion: this.interpreterVersion,
      sourceHash,
    });
  }

  // Use the injected fake when provided (tests + the operator escalation path). Otherwise
  // lazily import + construct the real SDK client — `new Anthropic()` resolves ANTHROPIC_API_KEY
  // from the environment (never a hardcoded/literal key). The dynamic import keeps the SDK out of
  // the browser bundle and out of every test path. [claude-api skill; .env.example]
  private async resolveClient(): Promise<AnthropicLike> {
    if (this.injectedClient !== undefined) {
      return this.injectedClient;
    }
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    return new Anthropic() as unknown as AnthropicLike;
  }
}
