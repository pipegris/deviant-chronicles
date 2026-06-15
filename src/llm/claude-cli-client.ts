import { execFile } from 'node:child_process';

// A `claude -p`-backed adapter that satisfies the SAME narrow `AnthropicLike` surface the
// ClaudeInterpreter and SagaAuthor inject — so an operator can run the offline interpret + Saga
// bakes through the Claude Code CLI with NO ANTHROPIC_API_KEY and NO `@anthropic-ai/sdk` call. It
// re-shapes the CLI's `result` string into the content-block response those two callers expect (a
// `tool_use` block for the interpreter, a `text` block for the Saga).
//
// CRITICAL — browser-UNREACHABLE: this module imports `node:child_process`, so it MUST stay off the
// browser graph. It is imported ONLY by scripts/** and its own co-located test; nothing on the
// src/main.ts -> render/arena-boot path may import it, or `vite build` would try to bundle
// node:child_process. There is NO `@anthropic-ai/sdk` import here, so this file needs no R4 zone.

// Duplicated locally (verbatim in shape) exactly as the interpreter + saga author each duplicate it,
// so the adapter stands in for the SDK without importing the SDK's full type.
export interface AnthropicLike {
  messages: {
    create(body: Record<string, unknown>): Promise<{ content: ContentBlock[] }>;
  };
}

// The minimum of a response content block the two callers read: the discriminating `type`, plus
// `text` (saga prose) and the already-parsed `input` (+ tool `name`) for the interpreter's forced
// tool_use. Mirrors the ContentBlock shape both callers define locally.
interface ContentBlock {
  type: string;
  text?: string;
  input?: unknown;
  name?: string;
}

// The `claude -p --output-format json` envelope. `result` is the assistant text (the only field we
// consume); the rest gate success. Extra envelope fields are ignored.
interface CliEnvelope {
  subtype?: string;
  is_error?: boolean;
  result?: string;
}

// Generous, fixed defaults for the (single, non-streaming, offline) CLI call. The timeout covers a
// real Opus bake over a full session; maxBuffer is large because the structured interpret result
// can be a sizable JSON array.
const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

// The JSON-only instruction appended to the system prompt for the STRUCTURED path. `--json-schema`
// did NOT reliably constrain output in testing, so we drive the JSON via the prompt instead: append
// the forced tool's input_schema and demand a single bare JSON value, then parse `.result`.
const JSON_ONLY_INSTRUCTION =
  '\n\nOutput ONLY a single JSON value that conforms to this JSON Schema. ' +
  'No prose, no markdown, no code fence:\n';

export interface ClaudeCliClientOptions {
  bin?: string;
  timeoutMs?: number;
  extraArgs?: string[];
}

export class ClaudeCliClient implements AnthropicLike {
  private readonly bin: string;
  private readonly timeoutMs: number;
  private readonly extraArgs: string[];

  constructor(options: ClaudeCliClientOptions = {}) {
    this.bin = options.bin ?? 'claude';
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.extraArgs = options.extraArgs ?? [];
  }

  readonly messages = {
    create: (body: Record<string, unknown>): Promise<{ content: ContentBlock[] }> =>
      this.create(body),
  };

  private async create(body: Record<string, unknown>): Promise<{ content: ContentBlock[] }> {
    const model = String(body.model);
    const system = typeof body.system === 'string' ? body.system : undefined;
    const userContent = this.lastUserContent(body);

    // STRUCTURED (interpreter) iff a forced tool is declared; otherwise PROSE (saga author).
    const tools = body.tools;
    const structuredTool =
      Array.isArray(tools) && tools.length > 0
        ? (tools[0] as { name?: unknown; input_schema?: unknown })
        : undefined;

    // For STRUCTURED, the schema + JSON-only instruction ride in the system prompt — the
    // prompt-driven-JSON approach (NOT --json-schema, which did not reliably constrain output).
    const sys = structuredTool
      ? (system ?? '') + JSON_ONLY_INSTRUCTION + JSON.stringify(structuredTool.input_schema)
      : system;

    const args = ['-p', '--model', model, '--output-format', 'json'];
    if (sys !== undefined) {
      args.push('--append-system-prompt', sys);
    }
    args.push(...this.extraArgs);

    const envelope = await this.invoke(args, userContent);
    const resultText = envelope.result ?? '';

    if (structuredTool) {
      const parsed = this.parseStructured(resultText, userContent.length);
      return { content: [{ type: 'tool_use', name: String(structuredTool.name), input: parsed }] };
    }
    return { content: [{ type: 'text', text: resultText }] };
  }

  // Pull the last user message's text content out of the request body. Both callers send a single
  // user turn whose `content` is a JSON-serialized string; we pass it on STDIN to dodge arg-length
  // limits on big sessions.
  private lastUserContent(body: Record<string, unknown>): string {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i] as { role?: unknown; content?: unknown };
      if (msg.role === 'user' && typeof msg.content === 'string') {
        return msg.content;
      }
    }
    throw new Error('ClaudeCliClient: request body carried no string user message content.');
  }

  // Run `claude` with the user content on STDIN and parse the JSON envelope. Fail LOUD on a non-zero
  // exit, an `is_error` envelope, or an unparseable envelope — every message references lengths/ids
  // only, never the prompt content (the session text stays out of any error/log surface).
  private async invoke(args: string[], stdin: string): Promise<CliEnvelope> {
    // execFile takes no stdin option; promisify discards the child handle we need to feed it. Wrap
    // the callback form so we can write the prompt to the child's stdin (avoiding arg-length limits).
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        this.bin,
        args,
        { timeout: this.timeoutMs, maxBuffer: DEFAULT_MAX_BUFFER, encoding: 'utf8' },
        (err, out) => {
          if (err) {
            const code = (err as { code?: unknown }).code;
            reject(
              new Error(
                `ClaudeCliClient: \`${this.bin}\` exited non-zero (code ${String(code)}) ` +
                  `for a ${stdin.length}-char prompt.`,
              ),
            );
            return;
          }
          resolve(out);
        },
      );
      child.stdin?.on('error', () => {
        // A broken stdin pipe (child died early) surfaces via the exec callback's error — swallow
        // the duplicate EPIPE here so it doesn't escape as an unhandled rejection.
      });
      child.stdin?.end(stdin);
    });

    let envelope: CliEnvelope;
    try {
      envelope = JSON.parse(stdout) as CliEnvelope;
    } catch {
      throw new Error(
        `ClaudeCliClient: could not parse the \`${this.bin}\` JSON envelope ` +
          `(${stdout.length}-char stdout).`,
      );
    }

    if (envelope.is_error === true) {
      throw new Error(
        `ClaudeCliClient: \`${this.bin}\` reported is_error (subtype ${String(envelope.subtype)}).`,
      );
    }
    return envelope;
  }

  // Strip a leading/trailing ```json…``` (or bare ```…```) fence + surrounding whitespace, then
  // JSON.parse the remainder into the structured payload the interpreter Zod-validates. A malformed
  // result throws LOUD (the error references the length only).
  private parseStructured(result: string, promptLength: number): unknown {
    const stripped = stripJsonFence(result.trim());
    try {
      return JSON.parse(stripped);
    } catch {
      throw new Error(
        `ClaudeCliClient: structured result was not valid JSON ` +
          `(${stripped.length}-char result for a ${promptLength}-char prompt).`,
      );
    }
  }
}

// Remove a Markdown code fence the model may have wrapped the JSON in. Handles ```json … ``` and a
// bare ``` … ```; returns the inner text trimmed. Non-fenced input is returned unchanged.
function stripJsonFence(text: string): string {
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i;
  const match = fence.exec(text);
  return match ? match[1].trim() : text;
}
