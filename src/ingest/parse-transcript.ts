/// <reference lib="es2022.error" />
// ^ tsconfig pins `lib: ES2020`, which lacks the 2-arg `new Error(msg, { cause })` overload.
// This file-local lib slice adds only the ErrorOptions/`cause` typing (a runtime feature
// Node + the Vite build already support) so the loud-abort errors can preserve their cause
// (ESLint preserve-caught-error) without editing the shared tsconfig.
import { z } from 'zod';

// The R3 anti-corruption boundary for the Claude Code transcript stream: ONLY src/ingest/
// parses the untrusted raw JSONL and Zod-validates it. These raw schemas are ingest/-local
// and distinct from the downstream NormalizedEvent contract. Real records carry extra
// envelope keys (promptId, version, userType, …) that Zod strips by default, so one schema
// validates both the minimal redacted fixture and the real files.

// Discriminated on `type` so an unknown content-item type aborts LOUD (AC3) instead of
// passing through. `thinking` is parsed only to keep the union total — the allowlist drops
// it (its opaque signature is never viewer-facing).
export const RawContentItemSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('thinking'),
    thinking: z.string(),
    signature: z.string(),
  }),
  z.object({
    type: z.literal('tool_use'),
    id: z.string(),
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
    caller: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('tool_result'),
    tool_use_id: z.string(),
    content: z.unknown(),
    // Omitted on many real success results, so optional (normalize defaults it to false).
    is_error: z.boolean().optional(),
  }),
]);
export type RawContentItem = z.infer<typeof RawContentItemSchema>;

// content is EITHER a plain string (the kickoff prompt) OR an array of content items.
export const RawMessageSchema = z.object({
  role: z.string(),
  content: z.union([z.string(), z.array(RawContentItemSchema)]),
});
export type RawMessage = z.infer<typeof RawMessageSchema>;

// `message` is present on user/assistant, absent on `attachment` (which carries an
// `attachment` object instead) — both optional so all three record types validate.
export const RawTranscriptRecordSchema = z.object({
  type: z.enum(['user', 'assistant', 'attachment']),
  uuid: z.string(),
  parentUuid: z.string().nullable(),
  // Must be a PARSEABLE date: normalize derives the provisional clock via Date.parse, and an
  // unparseable timestamp would otherwise escape as a bare ZodError on emission with no
  // located context. Validating it HERE routes it through the loud Ingest: message (AC3).
  timestamp: z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
    message: 'timestamp is not a parseable date',
  }),
  agentId: z.string(),
  isSidechain: z.boolean(),
  sessionId: z.string(),
  cwd: z.string(),
  gitBranch: z.string(),
  message: RawMessageSchema.optional(),
  attachment: z.record(z.string(), z.unknown()).optional(),
});
export type RawTranscriptRecord = z.infer<typeof RawTranscriptRecordSchema>;

/**
 * Parse + Zod-validate a Claude Code transcript JSONL string into RawTranscriptRecord[].
 *
 * PURE: the caller (test / Epic-5 harness) is responsible for the fs read; this function
 * only transforms the string it is given. Blank lines are skipped. A malformed line (bad
 * JSON) or a schema-invalid record throws LOUD with a message that names the stream and
 * the 0-based line index (AC3) — fail at the build-time boundary, never warn-and-skip.
 */
export function parseTranscript(jsonl: string, streamId: string): RawTranscriptRecord[] {
  const lines = jsonl.split('\n');
  const records: RawTranscriptRecord[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (line.trim() === '') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Ingest: malformed transcript record at ${streamId}:line ${lineIndex} — ${detail}`,
        { cause: err },
      );
    }

    try {
      records.push(RawTranscriptRecordSchema.parse(parsed));
    } catch (err) {
      // .parse (not swallowed .safeParse) so a schema-invalid record throws a ZodError;
      // re-wrap with the located message, surfacing the error name so the build failure
      // is both actionable AND recognizably Zod-rooted (AC1/AC3). The original ZodError is
      // preserved as `cause`.
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      throw new Error(
        `Ingest: malformed transcript record at ${streamId}:line ${lineIndex} — ${detail}`,
        { cause: err },
      );
    }
  }

  return records;
}
