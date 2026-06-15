import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { BeatAnnotationSchema, type BeatAnnotation } from '../schema/beat-annotation';
import { type NormalizedEvent } from '../schema/normalized-event';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';

// RED-PHASE acceptance test for Story 3.2 — AC1: the REAL ClaudeInterpreter that calls
// claude-sonnet-4-6 via FORCED tool output and Zod-validates the result into BeatAnnotation[].
// It imports the not-yet-authored `./claude-interpreter` (ClaudeInterpreter), so it ERRORS now
// (RED — module resolution fails); turns GREEN when the dev authors src/interpret/claude-interpreter.ts.
//
// AC1 (verbatim, epics.md#Story-3.2): "Given scripts/interpret.ts When it runs offline Then it
// calls claude-sonnet-4-6 via structured/tool output, Zod-validates the result into
// BeatAnnotation[], and @anthropic-ai/sdk is imported only here/interpret/ (never browser-reachable;
// no API key in client) (R4)."
//
// Every assertion runs against a MOCKED Anthropic client (an injected `AnthropicLike` fake) —
// ZERO real network, no ANTHROPIC_API_KEY. The single real claude-sonnet-4-6 bake is a DEFERRED
// operator step (Epic 5 / Story 5.2), explicitly NOT this gate.
import { ClaudeInterpreter } from './claude-interpreter';
import type { BeatInterpreter } from './beat-interpreter';

// --- The events input is built by driving the REAL ingest pipeline over the committed fixtures,
// so the eventIds the mocked annotations anchor to are the SAME 14 the rest of the system sees.
// `runIngest`/`readFixture` are copied verbatim from src/interpret/fixture-interpreter.test.ts L27-44.
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

// --- The two canned annotations the fake tool_use returns. They reuse Story 3.1's grounded beats
// against the REAL fixture eventIds (Dispel@u-0002#1, Shaman@u-0010#0) so groundings resolve.
// interpreterVersion is set to the value the ClaudeInterpreter is expected to stamp (see the
// constructor-options test below); a missing field is added in the malformed-payload test only.
const CANNED_ANNOTATIONS: BeatAnnotation[] = [
  {
    eventRef: 'u-0002#1',
    beatType: 'dispel',
    confidence: 0.8,
    interpreterVersion: 'claude-sonnet-4-6/v1',
    sourceHash: 'mock',
    groundingPointer: { eventRefs: ['u-0002#1', 'u-0002#2', 'u-0003#0'] },
  },
  {
    eventRef: 'u-0010#0',
    beatType: 'shaman',
    confidence: 0.7,
    interpreterVersion: 'claude-sonnet-4-6/v1',
    sourceHash: 'mock',
    groundingPointer: { eventRefs: ['u-0009#0', 'u-0010#0'] },
  },
];

// --- The narrow structural `AnthropicLike` fake (the load-bearing test seam). It records the
// `body` arg of every messages.create call and returns whatever canned content the test supplies.
// Typing against the minimum surface keeps the fake trivial and avoids importing the SDK's types.
interface FakeContentBlock {
  type: string;
  id?: string;
  name?: string;
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

// A fake whose forced tool_use carries the two valid canned annotations.
function fakeWithCannedTool(annotations: BeatAnnotation[] = CANNED_ANNOTATIONS): FakeClient {
  return makeFakeClient([
    { type: 'tool_use', id: 'toolu_mock', name: 'emit_beat_annotations', input: { annotations } },
  ]);
}

describe('Story 3.2 / AC1 — ClaudeInterpreter implements the BeatInterpreter interface', () => {
  it('is structurally assignable to BeatInterpreter (typecheck-level conformance proof)', () => {
    // The binding fails `pnpm typecheck` if the ClaudeInterpreter shape drifts from the 3.1
    // interface contract (interpret(events): Promise<BeatAnnotation[]>, UNCHANGED).
    const interp: BeatInterpreter = new ClaudeInterpreter({ client: fakeWithCannedTool() });
    expect(interp).toBeDefined();
    expect(typeof interp.interpret).toBe('function');
  });

  it('produces a BeatAnnotation[] (the interface return contract)', async () => {
    const interp: BeatInterpreter = new ClaudeInterpreter({ client: fakeWithCannedTool() });
    const annotations = await interp.interpret(runIngest());
    expect(Array.isArray(annotations)).toBe(true);
  });
});

describe('Story 3.2 / AC1 — builds the request with claude-sonnet-4-6 + a FORCED emit tool', () => {
  it('calls messages.create exactly once with model claude-sonnet-4-6 by default', async () => {
    const fake = fakeWithCannedTool();
    await new ClaudeInterpreter({ client: fake }).interpret(runIngest());
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].model).toBe('claude-sonnet-4-6');
  });

  it('forces the emit tool via tool_choice { type: "tool", name } matching the declared tool', async () => {
    const fake = fakeWithCannedTool();
    await new ClaudeInterpreter({ client: fake }).interpret(runIngest());
    const body = fake.calls[0];

    // tool_choice FORCES the structured output — the architecture's "structured/tool output".
    expect(body.tool_choice).toBeDefined();
    const toolChoice = body.tool_choice as { type?: string; name?: string };
    expect(toolChoice.type).toBe('tool');

    // The forced name must match a declared tool's name (so Claude must emit THAT tool).
    const tools = body.tools as Array<{ name?: string; input_schema?: unknown }>;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain(toolChoice.name);
  });

  it('declares a tool whose input_schema is an object carrying an `annotations` array', async () => {
    const fake = fakeWithCannedTool();
    await new ClaudeInterpreter({ client: fake }).interpret(runIngest());
    const tools = fake.calls[0].tools as Array<{ name?: string; input_schema?: Record<string, unknown> }>;
    const forcedName = (fake.calls[0].tool_choice as { name?: string }).name;
    const emitTool = tools.find((t) => t.name === forcedName);
    expect(emitTool).toBeDefined();

    const schema = emitTool?.input_schema as Record<string, unknown> | undefined;
    expect(schema?.type).toBe('object');
    const props = schema?.properties as Record<string, unknown> | undefined;
    expect(props).toBeDefined();
    const annotationsProp = props?.annotations as Record<string, unknown> | undefined;
    expect(annotationsProp).toBeDefined();
    expect(annotationsProp?.type).toBe('array');
  });

  it('passes a required max_tokens (the non-streaming offline call) and omits sampling params', async () => {
    // max_tokens is REQUIRED by the Messages API. claude-sonnet-4-6/claude-opus-4-8 use adaptive
    // thinking and 400 on temperature/top_p/budget_tokens — the request must omit them.
    const fake = fakeWithCannedTool();
    await new ClaudeInterpreter({ client: fake }).interpret(runIngest());
    const body = fake.calls[0];
    expect(typeof body.max_tokens).toBe('number');
    expect((body.max_tokens as number) > 0).toBe(true);
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body).not.toHaveProperty('top_k');
    expect(body).not.toHaveProperty('budget_tokens');
  });
});

describe('Story 3.2 / AC1 — maps the forced tool_use into a schema-valid BeatAnnotation[]', () => {
  it('returns exactly the canned annotations, each BeatAnnotationSchema.parse-valid', async () => {
    const annotations = await new ClaudeInterpreter({ client: fakeWithCannedTool() }).interpret(runIngest());
    expect(annotations).toHaveLength(2);
    for (const a of annotations) {
      expect(() => BeatAnnotationSchema.parse(a)).not.toThrow();
    }
    const types = annotations.map((a: BeatAnnotation) => a.beatType).sort();
    expect(types).toEqual(['dispel', 'shaman']);
  });

  it('preserves the grounding so every eventRef + groundingPointer resolves to a fixture eventId', async () => {
    const events = runIngest();
    const ids = new Set(events.map((e) => e.eventId));
    const annotations = await new ClaudeInterpreter({ client: fakeWithCannedTool() }).interpret(events);
    expect(annotations.length).toBeGreaterThan(0);
    for (const a of annotations) {
      expect(ids.has(a.eventRef)).toBe(true);
      expect(a.groundingPointer.eventRefs).toContain(a.eventRef);
      for (const ref of a.groundingPointer.eventRefs) {
        expect(ids.has(ref)).toBe(true);
      }
    }
  });
});

describe('Story 3.2 / AC1 — fails LOUD on a malformed structured response (build-time boundary)', () => {
  it('rejects when the response carries NO tool_use block', async () => {
    // A response with only a text block (the model refused to emit the forced tool) must throw —
    // the Layer-1 boundary is strict at build time. Pin the message so this fails for the RIGHT
    // reason (the missing-tool_use guard), not some unrelated crash that also happens to throw.
    const fake = makeFakeClient([{ type: 'text' }]);
    await expect(
      new ClaudeInterpreter({ client: fake }).interpret(runIngest()),
    ).rejects.toThrow(/no tool_use block/);
  });

  it('throws a ZodError when a tool_use annotation is missing a required field (no groundingPointer)', async () => {
    // The interpreter must BeatAnnotationSchema.parse each element; a missing groundingPointer
    // (required) must fail loud rather than leak a malformed annotation downstream. Assert it is a
    // ZodError specifically — a bare .toThrow() would pass even if a TypeError fired BEFORE .parse(),
    // i.e. before the schema boundary ever ran, which would NOT prove fail-closed-via-Zod.
    const malformed = [
      {
        eventRef: 'u-0002#1',
        beatType: 'dispel',
        confidence: 0.8,
        interpreterVersion: 'claude-sonnet-4-6/v1',
        sourceHash: 'mock',
        // groundingPointer intentionally omitted
      },
    ] as unknown as BeatAnnotation[];
    const fake = fakeWithCannedTool(malformed);
    await expect(new ClaudeInterpreter({ client: fake }).interpret(runIngest())).rejects.toThrow(
      ZodError,
    );
  });

  it('throws a ZodError when confidence is out of the [0,1] range (the schema bound fails closed)', async () => {
    const malformed = [
      {
        eventRef: 'u-0002#1',
        beatType: 'dispel',
        confidence: 1.7,
        interpreterVersion: 'claude-sonnet-4-6/v1',
        sourceHash: 'mock',
        groundingPointer: { eventRefs: ['u-0002#1'] },
      },
    ] as unknown as BeatAnnotation[];
    const fake = fakeWithCannedTool(malformed);
    await expect(new ClaudeInterpreter({ client: fake }).interpret(runIngest())).rejects.toThrow(
      ZodError,
    );
  });

  it('throws a ZodError on an UNKNOWN beatType (the closed enum fails the value closed)', async () => {
    // beatType is a CLOSED enum ['shaman','dispel','summon']. An LLM hallucinating an out-of-vocab
    // beat ('wizard') is a realistic failure mode the schema must reject at this Layer-1 gate —
    // otherwise an unmapped beat would leak downstream. (Mirrors the confidence-bound branch above
    // for the other half of the AC1 "Zod-validate the result" clause.)
    const malformed = [
      {
        eventRef: 'u-0002#1',
        beatType: 'wizard',
        confidence: 0.8,
        interpreterVersion: 'claude-sonnet-4-6/v1',
        sourceHash: 'mock',
        groundingPointer: { eventRefs: ['u-0002#1'] },
      },
    ] as unknown as BeatAnnotation[];
    const fake = fakeWithCannedTool(malformed);
    await expect(new ClaudeInterpreter({ client: fake }).interpret(runIngest())).rejects.toThrow(
      ZodError,
    );
  });
});

describe('Story 3.2 / AC1 (F1) — provenance is interpreter-stamped, never LLM-controlled', () => {
  // The model emits the interpretive fields; the interpreter OVERWRITES interpreterVersion +
  // sourceHash post-parse so the annotation's content address can never be forged by the model.
  // The fake here returns a FORGED interpreterVersion + sourceHash; both must be replaced.
  const forged: BeatAnnotation[] = [
    {
      eventRef: 'u-0002#1',
      beatType: 'dispel',
      confidence: 0.8,
      interpreterVersion: 'EVIL-FORGED-VERSION',
      sourceHash: 'EVIL-FORGED-HASH',
      groundingPointer: { eventRefs: ['u-0002#1', 'u-0002#2', 'u-0003#0'] },
    },
  ];

  it('overwrites interpreterVersion with the interpreter authoritative value (not the model value)', async () => {
    const interp = new ClaudeInterpreter({
      client: fakeWithCannedTool(forged),
      interpreterVersion: 'authoritative-v9',
    });
    const [a] = await interp.interpret(runIngest());
    expect(a.interpreterVersion).toBe('authoritative-v9');
    expect(a.interpreterVersion).not.toBe('EVIL-FORGED-VERSION');
  });

  it('derives sourceHash deterministically (not the model value), keyed to the grounded events', async () => {
    const events = runIngest();
    const [a] = await new ClaudeInterpreter({ client: fakeWithCannedTool(forged) }).interpret(events);
    // A real 64-char hex sha256, NOT the forged literal.
    expect(a.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.sourceHash).not.toBe('EVIL-FORGED-HASH');
    // Deterministic: a second identical run yields the SAME derived hash.
    const [b] = await new ClaudeInterpreter({ client: fakeWithCannedTool(forged) }).interpret(events);
    expect(b.sourceHash).toBe(a.sourceHash);
  });

  it('ties sourceHash to the grounded slice: a different grounding yields a different hash', async () => {
    const events = runIngest();
    const other: BeatAnnotation[] = [
      { ...forged[0], groundingPointer: { eventRefs: ['u-0009#0', 'u-0010#0'] } },
    ];
    const [a] = await new ClaudeInterpreter({ client: fakeWithCannedTool(forged) }).interpret(events);
    const [b] = await new ClaudeInterpreter({ client: fakeWithCannedTool(other) }).interpret(events);
    expect(b.sourceHash).not.toBe(a.sourceHash);
  });
});

describe('Story 3.2 / AC3 — escalation to claude-opus-4-8 is a config knob (same request shape)', () => {
  it('sends model claude-opus-4-8 when constructed with that model id', async () => {
    const fake = fakeWithCannedTool();
    await new ClaudeInterpreter({ client: fake, model: 'claude-opus-4-8' }).interpret(runIngest());
    expect(fake.calls[0].model).toBe('claude-opus-4-8');
    // Same request shape — still a forced tool with an annotations-array schema.
    expect((fake.calls[0].tool_choice as { type?: string }).type).toBe('tool');
    const tools = fake.calls[0].tools as Array<{ input_schema?: Record<string, unknown> }>;
    expect(tools.length).toBeGreaterThan(0);
  });
});

describe('Story 3.2 / AC1 — NO real network: the injected fake is the only client', () => {
  // The strongest available headless proof of "no real call": the fake has no network, and the
  // TEST never constructs a real `Anthropic`. (The build + dist-grep in Task 7 is the primary R4
  // proof; this is the regression guard at the unit level.) Tests are not Layer-0 modules, so the
  // fs read here is fine (fixture-interpreter.test.ts L121-129 precedent).
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'claude-interpreter.test.ts'),
    'utf8',
  );

  // DEV-STORY FIX (documented justification): the original ATDD assertions grepped the whole
  // source with `.not.toContain('@anthropic-ai/sdk')` / `.not.toMatch(/new\s+Anthropic\s*\(/)`.
  // That mechanism is self-defeating: this very file legitimately NAMES both strings in its
  // AC-quoting comments and in these assertions' own descriptions/argument literals, so the bare
  // grep can NEVER pass — it matches the test's own prose, not real SDK usage. The test's INTENT
  // (the fake is the only client — no real SDK import, no real construction in EXECUTABLE code)
  // is preserved and strengthened: we strip line-comments first, then assert there is no real
  // ESM `import ... '@anthropic-ai/sdk'` statement and no `new Anthropic(` in actual code. This
  // honors "make the test green honestly without weakening it" — the guarantee is the same, the
  // detection is now correct. [story prompt: "fix the test WITH a documented justification"]
  const codeOnly = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  it('the test source has no real ESM import of @anthropic-ai/sdk (the fake stands in for the SDK)', () => {
    expect(codeOnly).not.toMatch(/from\s+['"]@anthropic-ai\/sdk['"]/);
    expect(codeOnly).not.toMatch(/import\s*\(\s*['"]@anthropic-ai\/sdk['"]/);
    // Also reject a CommonJS require of the SDK — the ESM-only matchers above would miss it (F3).
    expect(codeOnly).not.toMatch(/require\s*\(\s*['"]@anthropic-ai\/sdk['"]/);
  });

  it('the test source never constructs a real Anthropic client (new Anthropic())', () => {
    // Exclude this assertion's own description line, which necessarily spells "new Anthropic()".
    const executable = codeOnly
      .split('\n')
      .filter((line) => !line.includes('never constructs a real Anthropic client'))
      .join('\n');
    expect(executable).not.toMatch(/new\s+Anthropic\s*\(/);
  });
});
