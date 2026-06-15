import { describe, expect, it } from 'vitest';
import type { BeatAnnotation } from '../schema/beat-annotation';
import type { NormalizedEvent } from '../schema/normalized-event';
import { ClaudeInterpreter } from './claude-interpreter';

// Story 3.2 — focused UNIT tests for ClaudeInterpreter behaviors NOT covered by the ATDD
// acceptance file (claude-interpreter.test.ts): the config-as-data version knobs the freeze CLI
// reads, and the request's system-prompt + user-message wiring. All against an injected fake —
// ZERO network.

interface FakeContentBlock {
  type: string;
  input?: unknown;
}

function makeFake(content: FakeContentBlock[]): {
  messages: { create(body: Record<string, unknown>): Promise<{ content: FakeContentBlock[] }> };
  calls: Array<Record<string, unknown>>;
} {
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

const VALID: BeatAnnotation[] = [
  {
    eventRef: 'u-0002#1',
    beatType: 'dispel',
    confidence: 0.8,
    interpreterVersion: 'x',
    sourceHash: 'mock',
    groundingPointer: { eventRefs: ['u-0002#1'] },
  },
];

function fakeWithTool() {
  return makeFake([{ type: 'tool_use', input: { annotations: VALID } }]);
}

const EVENTS: NormalizedEvent[] = [];

describe('Story 3.2 — ClaudeInterpreter exposes config-as-data version knobs', () => {
  it('defaults interpreterVersion + promptVersion to the documented literals', () => {
    const interp = new ClaudeInterpreter({ client: fakeWithTool() });
    expect(interp.interpreterVersion).toBe('claude-sonnet-4-6/v1');
    // Story 10.1 bumped the default prompt version to beat-tag-v2 (SYSTEM_PROMPT gained the
    // verbatim-id / no-invented-id instruction; provenance stamps the version, so it must change).
    expect(interp.promptVersion).toBe('beat-tag-v2');
  });

  it('lets the constructor override both versions (the freeze-CLI stamping seam)', () => {
    const interp = new ClaudeInterpreter({
      client: fakeWithTool(),
      interpreterVersion: 'claude-opus-4-8/v1',
      promptVersion: 'beat-tag-v2',
    });
    expect(interp.interpreterVersion).toBe('claude-opus-4-8/v1');
    expect(interp.promptVersion).toBe('beat-tag-v2');
  });
});

describe('Story 3.2 — the request wires a system prompt + the events as the user message', () => {
  it('sends a non-empty system prompt and the JSON-serialized events as user content', async () => {
    const fake = fakeWithTool();
    const events: NormalizedEvent[] = [
      {
        orderKey: { logicalClock: 1, streamId: 's', seqWithinStream: 0 },
        eventId: 'u-0001',
        eventType: 'tool_use',
        toolName: 'Read',
        subtype: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        streamDepth: 0,
        exitCode: null,
        isError: false,
        retryCount: 0,
        payload: null,
      },
    ];
    await new ClaudeInterpreter({ client: fake }).interpret(events);
    const body = fake.calls[0];
    expect(typeof body.system).toBe('string');
    expect((body.system as string).length).toBeGreaterThan(0);
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    // The events are passed JSON-serialized so the model can read the eventIds to ground against.
    expect(messages[0].content).toBe(JSON.stringify(events));
  });
});

describe('Story 3.2 (F1) — the tool schema does NOT ask the model for provenance fields', () => {
  it('omits interpreterVersion + sourceHash from the annotation item required list', async () => {
    const fake = fakeWithTool();
    await new ClaudeInterpreter({ client: fake }).interpret(EVENTS);
    const tools = fake.calls[0].tools as Array<{ input_schema?: Record<string, unknown> }>;
    const props = (tools[0].input_schema?.properties as Record<string, unknown>) ?? {};
    const items = (props.annotations as { items?: Record<string, unknown> })?.items ?? {};
    const required = (items.required as string[]) ?? [];
    // The model judges eventRef/beatType/confidence/groundingPointer; provenance is interpreter-stamped.
    expect(required).toEqual(['eventRef', 'beatType', 'confidence', 'groundingPointer']);
    expect(required).not.toContain('interpreterVersion');
    expect(required).not.toContain('sourceHash');
  });
});

describe('Story 3.2 — fail-loud when the tool_use input omits the annotations array', () => {
  it('rejects when input has no annotations property (not an array)', async () => {
    // Pin the message: a missing `annotations` array must fail at the array-guard with a clear
    // diagnostic, not pass on some incidental downstream throw.
    const fake = makeFake([{ type: 'tool_use', input: {} }]);
    await expect(new ClaudeInterpreter({ client: fake }).interpret(EVENTS)).rejects.toThrow(
      /annotations.*array/,
    );
  });
});
