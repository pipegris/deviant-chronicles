import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Unit test for src/llm/claude-cli-client.ts — the `claude -p`-backed AnthropicLike adapter that
// lets the offline interpret + Saga bakes run through the Claude Code CLI (no ANTHROPIC_API_KEY, no
// @anthropic-ai/sdk). node:child_process is MOCKED so NO real `claude` runs in CI. The assertions
// mirror the structural-fake conventions in src/interpret/claude-interpreter.test.ts and
// src/scribe/saga-author.test.ts (record the request, return canned content, fail-loud guards), and
// the source-grep R4 regression guard in src/interpret/r4-isolation.test.ts.

// --- The mock of node:child_process. `execFile(bin, args, options, callback)` returns a child with
// a writable `.stdin` (captured so we can assert the prompt was piped). The callback is invoked
// asynchronously with the canned (err, stdout). A per-test `program` controls success vs failure.
interface ExecCall {
  bin: string;
  args: string[];
  stdin: string;
}

interface ExecProgram {
  // The mock just hands `err` to the exec callback; the adapter reads its `code` as unknown, so a
  // loose shape is enough (and avoids ErrnoException's string-typed `code`, which exec violates).
  err?: (Error & { code?: unknown }) | null;
  stdout?: string;
}

const execCalls: ExecCall[] = [];
let program: ExecProgram = { err: null, stdout: '' };

vi.mock('node:child_process', () => ({
  execFile: (
    bin: string,
    args: string[],
    _options: unknown,
    callback: (err: (Error & { code?: unknown }) | null, stdout: string, stderr: string) => void,
  ) => {
    const call: ExecCall = { bin, args, stdin: '' };
    execCalls.push(call);
    const stdin = {
      on() {
        return stdin;
      },
      end(data: string) {
        call.stdin = data;
      },
    };
    // Resolve on the next microtask so the adapter's `child.stdin?.end(stdin)` runs before the
    // callback fires (matches the real async exec ordering).
    queueMicrotask(() => callback(program.err ?? null, program.stdout ?? '', ''));
    return { stdin };
  },
}));

import { ClaudeCliClient } from './claude-cli-client';

beforeEach(() => {
  execCalls.length = 0;
  program = { err: null, stdout: '' };
});

afterEach(() => {
  vi.clearAllMocks();
});

// Build the `claude -p --output-format json` envelope as the CLI emits it.
function envelope(result: string, isError = false): string {
  return JSON.stringify({ subtype: 'success', is_error: isError, result });
}

// A minimal structured (interpreter-shaped) request body: a forced tool with an input_schema.
const STRUCTURED_BODY: Record<string, unknown> = {
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  system: 'You are a beat interpreter.',
  tools: [
    {
      name: 'emit_beat_annotations',
      input_schema: {
        type: 'object',
        properties: { annotations: { type: 'array' } },
        required: ['annotations'],
      },
    },
  ],
  tool_choice: { type: 'tool', name: 'emit_beat_annotations' },
  messages: [{ role: 'user', content: '[{"eventId":"u-0001#0"}]' }],
};

// A minimal prose (saga-author-shaped) request body: NO tools.
const PROSE_BODY: Record<string, unknown> = {
  model: 'claude-opus-4-8',
  max_tokens: 2048,
  system: 'You are the Scribe.',
  messages: [{ role: 'user', content: '[{"eventId":"u-0001#0"}]' }],
};

describe('ClaudeCliClient — structured (interpreter) call builds the right CLI args', () => {
  it('passes -p, --model, --output-format json, and the user content on STDIN', async () => {
    program = { err: null, stdout: envelope('{"annotations":[]}') };
    await new ClaudeCliClient().messages.create(STRUCTURED_BODY);

    expect(execCalls).toHaveLength(1);
    const { bin, args, stdin } = execCalls[0];
    expect(bin).toBe('claude');
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
    expect(args[args.indexOf('--model') + 1]).toBe('claude-sonnet-4-6');
    // The user message content is piped on STDIN (not passed as an arg).
    expect(stdin).toBe('[{"eventId":"u-0001#0"}]');
    expect(args).not.toContain(stdin);
  });

  it('appends a system prompt carrying the input_schema + the JSON-only instruction', async () => {
    program = { err: null, stdout: envelope('{"annotations":[]}') };
    await new ClaudeCliClient().messages.create(STRUCTURED_BODY);

    const { args } = execCalls[0];
    const sysIdx = args.indexOf('--append-system-prompt');
    expect(sysIdx).toBeGreaterThanOrEqual(0);
    const sys = args[sysIdx + 1];
    // Original system text is preserved.
    expect(sys).toContain('You are a beat interpreter.');
    // The JSON-only, no-fence instruction is present.
    expect(sys).toMatch(/Output ONLY a single JSON value/i);
    expect(sys).toMatch(/No prose, no markdown, no code fence/i);
    // The forced tool's input_schema is embedded (serialized).
    expect(sys).toContain('"annotations"');
    expect(sys).toContain(JSON.stringify(STRUCTURED_BODY.tools && (STRUCTURED_BODY.tools as { input_schema: unknown }[])[0].input_schema));
    // --json-schema must NOT be used (it did not reliably constrain output).
    expect(args).not.toContain('--json-schema');
  });

  it('does not emit sampling params or tool flags into the args (they live in the body only)', async () => {
    program = { err: null, stdout: envelope('{"annotations":[]}') };
    await new ClaudeCliClient().messages.create(STRUCTURED_BODY);
    const { args } = execCalls[0];
    expect(args).not.toContain('--temperature');
    expect(args).not.toContain('--tools');
  });
});

describe('ClaudeCliClient — structured call parses the envelope into a tool_use block', () => {
  it('returns a tool_use block whose .input is the parsed result + the tool name', async () => {
    const structured = { annotations: [{ eventRef: 'u-0001#0', beatType: 'shaman' }] };
    program = { err: null, stdout: envelope(JSON.stringify(structured)) };

    const res = await new ClaudeCliClient().messages.create(STRUCTURED_BODY);
    expect(res.content).toHaveLength(1);
    const block = res.content[0];
    expect(block.type).toBe('tool_use');
    expect(block.name).toBe('emit_beat_annotations');
    expect(block.input).toEqual(structured);
  });

  it('strips a ```json fence from the result before parsing', async () => {
    const structured = { annotations: [] };
    const fenced = '```json\n' + JSON.stringify(structured) + '\n```';
    program = { err: null, stdout: envelope(fenced) };

    const res = await new ClaudeCliClient().messages.create(STRUCTURED_BODY);
    expect(res.content[0].input).toEqual(structured);
  });

  it('strips a bare ``` fence (no language tag) and surrounding whitespace', async () => {
    const structured = { annotations: [{ eventRef: 'u-0002#1', beatType: 'dispel' }] };
    const fenced = '\n```\n' + JSON.stringify(structured) + '\n```\n';
    program = { err: null, stdout: envelope(fenced) };

    const res = await new ClaudeCliClient().messages.create(STRUCTURED_BODY);
    expect(res.content[0].input).toEqual(structured);
  });
});

describe('ClaudeCliClient — prose (saga) call returns a text block', () => {
  it('builds prose args without a JSON-only schema instruction and returns the result as text', async () => {
    const saga = 'By hammer and hash, it is done!';
    program = { err: null, stdout: envelope(saga) };

    const res = await new ClaudeCliClient().messages.create(PROSE_BODY);
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe('text');
    expect(res.content[0].text).toBe(saga);

    // Prose appends only the bare system prompt — no JSON-only instruction, no schema.
    const { args } = execCalls[0];
    const sys = args[args.indexOf('--append-system-prompt') + 1];
    expect(sys).toBe('You are the Scribe.');
    expect(sys).not.toMatch(/Output ONLY a single JSON value/i);
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-4-8');
  });
});

describe('ClaudeCliClient — fails LOUD (no silent empty result)', () => {
  it('throws when the envelope reports is_error: true', async () => {
    program = { err: null, stdout: envelope('nope', true) };
    await expect(new ClaudeCliClient().messages.create(PROSE_BODY)).rejects.toThrow(/is_error/);
  });

  it('throws when the process exits non-zero', async () => {
    // execFile surfaces a numeric exit `code` on the error; the adapter reads it as unknown.
    program = { err: Object.assign(new Error('command failed'), { code: 1 }), stdout: '' };
    await expect(new ClaudeCliClient().messages.create(PROSE_BODY)).rejects.toThrow(/exited non-zero/);
  });

  it('throws when the stdout is not a parseable JSON envelope', async () => {
    program = { err: null, stdout: 'not json at all' };
    await expect(new ClaudeCliClient().messages.create(PROSE_BODY)).rejects.toThrow(/JSON envelope/);
  });

  it('throws when a STRUCTURED result is not valid JSON', async () => {
    program = { err: null, stdout: envelope('this is prose, not the JSON we demanded') };
    await expect(new ClaudeCliClient().messages.create(STRUCTURED_BODY)).rejects.toThrow(/not valid JSON/);
  });

  it('does not leak the prompt content in error messages (lengths/ids only)', async () => {
    program = { err: null, stdout: envelope('garbage that is not json') };
    const body = {
      ...STRUCTURED_BODY,
      messages: [{ role: 'user', content: 'SECRET-SESSION-PAYLOAD-12345' }],
    };
    await expect(new ClaudeCliClient().messages.create(body)).rejects.toThrow(
      expect.not.stringContaining('SECRET-SESSION-PAYLOAD'),
    );
  });
});

describe('ClaudeCliClient — constructor options', () => {
  it('honors a custom bin and extraArgs', async () => {
    program = { err: null, stdout: envelope('ok') };
    await new ClaudeCliClient({ bin: '/usr/local/bin/claude', extraArgs: ['--verbose'] }).messages.create(
      PROSE_BODY,
    );
    const { bin, args } = execCalls[0];
    expect(bin).toBe('/usr/local/bin/claude');
    expect(args).toContain('--verbose');
  });
});

describe('ClaudeCliClient — R4: the adapter imports no @anthropic-ai/sdk (source grep)', () => {
  // The CLI path is the key-free alternative to the SDK; the adapter must never import the SDK.
  // Strip line-comments first (this file legitimately NAMES the package in its own prose), then
  // assert no real ESM import / dynamic import / require survives in executable code. Mirrors the
  // detection in src/interpret/claude-interpreter.test.ts §"NO real network".
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'claude-cli-client.ts'),
    'utf8',
  );
  const codeOnly = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  it('has no ESM import / dynamic import / require of @anthropic-ai/sdk', () => {
    expect(codeOnly).not.toMatch(/from\s+['"]@anthropic-ai\/sdk['"]/);
    expect(codeOnly).not.toMatch(/import\s*\(\s*['"]@anthropic-ai\/sdk['"]/);
    expect(codeOnly).not.toMatch(/require\s*\(\s*['"]@anthropic-ai\/sdk['"]/);
  });
});
