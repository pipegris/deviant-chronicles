import type { NormalizedEvent } from '../schema/normalized-event';
import type { Outcome } from '../schema/replay-bundle';
import { classifyRole, type AbstractedRole } from './classify-role';
import { resolveTargetPath } from './project-events';

// Story 5.6 / Task 1 (AC1, AC3, AC4) — the PURE reduced "tagging view" builder. It maps the full
// NormalizedEvent[] to a compact, payload-FREE per-event row for the interpreter/Saga PROMPT INPUT only:
// the ~689-event real Story 10.1 session (~294K tokens of full payloads) does NOT fit the ~200K window
// for a one-shot `claude -p interpret`; this view shrinks the prompt to a per-event tag-salient row,
// targeting <250KB / <~60K tokens (Dev Notes §5). It is BAKE-INPUT ONLY — it is NEVER shipped, NEVER
// hashed (annotationHash + freeze stay over the FULL scrubbed events, AC3), and NEVER the freeze input.
//
// PURE + deterministic (R2 posture even though src/bundle/ is not a Layer-0 dir): no Date.now /
// Math.random / IO / global-mutable state; same input → deep-equal output; never mutates the input.
// SDK-free + phaser-free; imports only schema/ + classify-role + project-events (the Story 5.5
// precedent — src/bundle/ MAY consume these). [story Task 1; Dev Notes §1,§2,§4,§5,§6]

// The reduced per-event view row. EXACTLY five keys — NO eventType, NO payload, NO content. `role` +
// `outcome` reuse the Story 5.5 literal unions (one source of truth across the projection and the view,
// Dev Notes §2); `snippet` is a bounded, scrub-safe, PATH-FREE tag-salient excerpt (Dev Notes §6).
export interface TaggingViewEvent {
  eventId: string; // PRESERVED verbatim (§1) — the interpreter grounds on it; resolves on both sides.
  toolName: string | null; // the normalized field, reused as-is.
  role: AbstractedRole; // classifyRole(resolveTargetPath(event)) — IDENTICAL to project-events (§2).
  outcome: Outcome; // event.isError ? 'isError' : 'success' — the per-event 5.5 nuance (§2).
  snippet: string; // bounded (<= SNIPPET_MAX_CHARS), scrub-safe, path-free; '' when no usable payload.
}

// SNIPPET_MAX_CHARS — a FIXED prompt-budget engineering knob (how many chars per event the LLM needs to
// recognize a beat), NOT operator-tunable replay tuning (NFR-4 governs replay config — translation/
// pacing/captions — not a bake-input budget). Kept INLINE (not config-as-data) mirroring classify-role's
// inline-rules choice (Story 5.5 §3); a config loader would earn nothing. [Dev Notes §5]
export const SNIPPET_MAX_CHARS = 200;

// A path-like token: contains a slash, OR is a bare `name.ext` filename (1–5-char lower/upper extension).
// Used to scrub path-like tokens out of the tool_result head + the file-op summary (e.g. a `FAIL
// src/foo/bar.test.ts` head collapses to `FAIL`). NOT applied to a Bash command head — see boundSnippet's
// `stripPath` flag and the Bash branch (the command's paths are the beat signal — F1).
const PATH_LIKE = /[/\\]|^[\w.-]+\.[A-Za-z]{1,5}$/;

// Strip path-like tokens from a single line, leaving the tag-salient verdict/words. PURE; whitespace-
// collapsing is locale-independent. Empty result is fine — the caller hard-caps + returns '' when blank.
function stripPaths(line: string): string {
  return line
    .split(/\s+/)
    .filter((token) => token !== '' && !PATH_LIKE.test(token))
    .join(' ');
}

// Hard-cap a string to SNIPPET_MAX_CHARS BYTES (UTF-8), not UTF-16 code units, so the AC4 "fits the
// window" byte bound holds for multi-byte content too (a 200-char slice of 2-byte UTF-8 is ~400 bytes —
// F2/F3). Trim trailing bytes until Buffer.byteLength <= the cap; the slice is by code unit but the loop
// guarantees the BYTE budget. ASCII (the realistic bake content) is unaffected (1 byte/char). PURE.
function byteCap(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= SNIPPET_MAX_CHARS) return text;
  let end = Math.min(text.length, SNIPPET_MAX_CHARS);
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > SNIPPET_MAX_CHARS) {
    end--;
  }
  return text.slice(0, end);
}

// Take the FIRST line, collapse internal whitespace runs, optionally strip path-like tokens, then hard-cap
// to SNIPPET_MAX_CHARS BYTES (no ellipsis; the cap is a byte budget, not a UI concern). `stripPath` is
// false ONLY for a Bash command head (its paths are the beat signal — F1). Deterministic.
function boundSnippet(raw: string, stripPath = true): string {
  const firstLine = raw.split('\n')[0] ?? '';
  const collapsed = firstLine.replace(/\s+/g, ' ').trim();
  const cleaned = stripPath ? stripPaths(collapsed) : collapsed;
  return byteCap(cleaned);
}

// Read the first text leaf of a normalized tool_result `content` value: a string passes through; an array
// (the real Claude Code shape — normalize.ts L40-53) yields its first `{type:'text', text}` leaf's text;
// anything else → ''. PURE. [Dev Notes §6]
function firstResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item !== null && typeof item === 'object') {
        const { type, text } = item as { type?: unknown; text?: unknown };
        if (type === 'text' && typeof text === 'string') return text;
      }
    }
  }
  return '';
}

// Extract the most tag-salient SHORT text per normalized payload shape (Dev Notes §6), bounded + path-
// free. The snippet is the per-event signal the interpreter keys a beat off: the Bash command (Shaman/
// Dispel hinge on what ran), the tool_result pass/fail head (the outcome signal), the assistant/prompt
// narrative head, the journal status/verdict. File-op tool_uses (Edit/Write/Read/...) get a path-FREE
// `"<toolName> <role>"` summary — the path is read ONLY to classify the role and is then DISCARDED, never
// echoed (the no-leak invariant, AC1). PURE.
function extractSnippet(event: NormalizedEvent): string {
  const payload = event.payload;
  if (payload === null || typeof payload !== 'object') return '';

  switch (event.eventType) {
    case 'tool_use': {
      const input = (payload as { input?: unknown }).input;
      if (input === null || typeof input !== 'object') return '';
      const command = (input as { command?: unknown }).command;
      // Bash: the command IS the tag signal — keep its path args INTACT (do NOT stripPaths, F1). `./build.sh`
      // / `cat package.json` / `pnpm vitest run src/foo.test.ts` would otherwise gut to ''/`cat`/`pnpm vitest
      // run`, erasing what ran. The command is a transient, already-scrubbed bake input (§6) — no retained leak.
      if (event.toolName === 'Bash' && typeof command === 'string') {
        return boundSnippet(command, false);
      }
      // File-op (and any other) tool_use: a path-free summary. resolveTargetPath is read ONLY to derive
      // the coarse role token (classifyRole discards the path); the path itself NEVER reaches the snippet.
      const role = classifyRole(resolveTargetPath(event));
      return boundSnippet(event.toolName === null ? role : `${event.toolName} ${role}`);
    }
    case 'tool_result': {
      const content = (payload as { content?: unknown }).content;
      // The pass/fail head — path-like tokens (e.g. a FAIL'ing spec path) are stripped, leaving `FAIL` /
      // `File created.` style verdicts. This is the outcome signal the Shaman/Dispel beats hinge on.
      return boundSnippet(firstResultText(content));
    }
    case 'prompt':
    case 'text': {
      const text = (payload as { text?: unknown }).text;
      return typeof text === 'string' ? boundSnippet(text) : '';
    }
    case 'journal_started':
    case 'journal_result':
      // The short status/verdict already lives in the normalized `subtype` (e.g. `complete` / `pass`).
      return event.subtype === null ? '' : boundSnippet(event.subtype);
    default:
      return '';
  }
}

/**
 * Build the reduced tagging view from the full (scrubbed) NormalizedEvents — the interpreter/Saga PROMPT
 * INPUT (Dev Notes §0). One row per event, in input order, carrying ONLY {eventId, toolName, role,
 * outcome, snippet}. `eventId`/`toolName`/`role`/`outcome` are derived EXACTLY as project-events.ts
 * derives them (so the view and the shipped projection agree, §2); the ONLY new logic is `snippet`.
 *
 * SCRUB-SAFE (AC1 / Hard Invariant 3): the caller MUST pass already-SCRUBBED events (build-bundle.ts feeds
 * scrubResult.scrubbedEvents) — any secret/PII in a snippet source was already redacted by Story 5.1. This
 * builder only TRUNCATES already-scrubbed text; it MUST NEVER be called on raw/un-scrubbed events.
 *
 * PURE + deterministic; fresh objects, input untouched.
 */
export function buildTaggingView(events: NormalizedEvent[]): TaggingViewEvent[] {
  return events.map((event) => ({
    eventId: event.eventId,
    toolName: event.toolName,
    role: classifyRole(resolveTargetPath(event)),
    outcome: event.isError ? 'isError' : 'success',
    snippet: extractSnippet(event),
  }));
}
