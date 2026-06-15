import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';
import { projectEvents } from './project-events';

// RED-PHASE acceptance test for Story 5.6 — AC1 (the reduced tagging-view builder), AC3 (the
// preserve-eventId grounding contract), and AC4 (the context-fit size bound).
//
// It imports the not-yet-authored `./tagging-view` (buildTaggingView, SNIPPET_MAX_CHARS,
// TaggingViewEvent), so it ERRORS now (RED — module resolution fails) and turns GREEN once the dev
// authors src/bundle/tagging-view.ts per story Task 1. Tests are not Layer-0, so the fs read is fine
// (the committed-bundle / claude-interpreter test precedent).
//
// AC1: buildTaggingView is PURE/deterministic, emits EXACTLY {eventId, toolName, role, outcome,
//   snippet} per event, preserves eventId 1:1, bounds every snippet <= SNIPPET_MAX_CHARS, and derives
//   role/outcome IDENTICALLY to the shipped projection (project-events.ts).
// AC3: the view preserves every eventId, so a grounded annotation resolves against both the view and
//   the full events (the freeze guard).
// AC4: the reduced view over a synthetic ~689-event session is well under the context window
//   (serialized bytes < 250KB, token estimate < 60K), and materially smaller than the full events.
import { buildTaggingView, SNIPPET_MAX_CHARS, type TaggingViewEvent } from './tagging-view';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'ingest', '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

// Drive the REAL ingest pipeline over the committed fixtures so the view runs over the SAME 14
// normalized events the rest of the system sees (the merged dev transcript + journal). This is the
// same `runIngest` the claude-interpreter / fixture-interpreter tests use.
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

// The exact five keys a TaggingViewEvent must carry — NO `eventType`, NO `payload`, NO `content`.
const VIEW_KEYS = ['eventId', 'toolName', 'role', 'outcome', 'snippet'].sort();

function byId(view: TaggingViewEvent[], eventId: string): TaggingViewEvent {
  const found = view.find((v: TaggingViewEvent) => v.eventId === eventId);
  if (found === undefined) throw new Error(`test setup: no view event for ${eventId}`);
  return found;
}

// ---------------------------------------------------------------------------------------------------
// AC1 — shape: EXACTLY the five payload-free keys per event.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.6 AC1 — buildTaggingView emits exactly the five payload-free keys per event', () => {
  it('every view event has exactly {eventId, toolName, role, outcome, snippet} (set equality)', () => {
    const view = buildTaggingView(runIngest());
    expect(view.length).toBeGreaterThan(0);
    for (const v of view) {
      expect(Object.keys(v).sort()).toEqual(VIEW_KEYS);
      // Hard payload-free invariant: the full normalized payload/content NEVER appears on the view.
      expect(Object.prototype.hasOwnProperty.call(v, 'payload')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(v, 'content')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(v, 'eventType')).toBe(false);
    }
  });

  it('produces one view event per input event (1:1, no drop/duplication)', () => {
    const events = runIngest();
    const view = buildTaggingView(events);
    expect(view).toHaveLength(events.length);
  });

  it('snippet is ALWAYS a present string (explicit "" when no payload — never null/undefined)', () => {
    const view = buildTaggingView(runIngest());
    for (const v of view) {
      expect(typeof v.snippet).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// AC1 / AC3 (§1) — eventId is PRESERVED verbatim, in order. This is the grounding contract.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.6 AC1/AC3 — the view preserves eventId 1:1 with the input (same ids, same order)', () => {
  it('view eventIds equal the input events eventIds, in the SAME order', () => {
    const events = runIngest();
    const view: TaggingViewEvent[] = buildTaggingView(events);
    expect(view.map((v) => v.eventId)).toEqual(events.map((e) => e.eventId));
  });

  it('carries the known committed-fixture eventIds verbatim (e.g. u-0001, u-0002#1, the journal ids)', () => {
    const view: TaggingViewEvent[] = buildTaggingView(runIngest());
    const ids = new Set(view.map((v) => v.eventId));
    for (const ref of ['u-0001', 'u-0002#1', 'u-0002#2', 'u-0009#0', 'u-0010#0', 'phase-dev-OPAQUEHASH-1#result']) {
      expect(ids.has(ref)).toBe(true);
    }
  });

  it('the view eventIds are a SUPERSET of the committed fixture annotation refs (the freeze guard, AC3)', () => {
    // The two committed annotations ground on these refs (public/bundles/story-10-1.json). The reduced
    // view MUST carry every one so an interpreter grounding off the view resolves against both the view
    // AND the full events (the freeze input). Hard-coded from the committed bundle to keep this a real,
    // value-bearing assertion (not a tautology over whatever the builder happens to emit).
    const annotationRefs = ['u-0002#1', 'u-0002#2', 'u-0003#0', 'u-0010#0', 'u-0009#0'];
    const view: TaggingViewEvent[] = buildTaggingView(runIngest());
    const ids = new Set(view.map((v) => v.eventId));
    for (const ref of annotationRefs) {
      expect(ids.has(ref)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// AC1 (§2) — role + outcome are derived IDENTICALLY to the shipped projection (project-events.ts),
// so the view and the projection agree by construction (one conceptual source of truth).
// ---------------------------------------------------------------------------------------------------

describe('Story 5.6 AC1 — role/outcome match project-events.ts byte-for-byte per event', () => {
  it('every view event role + outcome equals the same event projection role + outcome', () => {
    const events = runIngest();
    const view = buildTaggingView(events);
    const projected = projectEvents(events);
    expect(view).toHaveLength(projected.length);
    for (let i = 0; i < view.length; i++) {
      expect(view[i].eventId).toBe(projected[i].eventId);
      expect(view[i].role).toBe(projected[i].role);
      expect(view[i].outcome).toBe(projected[i].outcome);
      expect(view[i].toolName).toBe(projected[i].toolName);
    }
  });

  it('outcome is the per-event isError nuance — the FAIL tool_result (u-0009#0) is isError', () => {
    const view = buildTaggingView(runIngest());
    // u-0009#0 is the `is_error:true` Bash tool_result; u-0002#2 (a tool_use) is success.
    expect(byId(view, 'u-0009#0').outcome).toBe('isError');
    expect(byId(view, 'u-0002#2').outcome).toBe('success');
  });

  it('role reuses classifyRole — the Read of normalized-event.ts (u-0002#2) is schema, the Bash (u-0008#0) is source', () => {
    const view = buildTaggingView(runIngest());
    // u-0002#2 reads src/schema/normalized-event.ts -> 'schema'; the Bash run has no path -> 'source'.
    expect(byId(view, 'u-0002#2').role).toBe('schema');
    expect(byId(view, 'u-0008#0').role).toBe('source');
  });
});

// ---------------------------------------------------------------------------------------------------
// AC1 (§5/§6) — every snippet is bounded, and the per-event-type extraction is tag-salient + path-free.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.6 AC1 — SNIPPET_MAX_CHARS bound + per-type snippet extraction (verified on the fixture)', () => {
  it('SNIPPET_MAX_CHARS is the documented ~200-char prompt-budget knob', () => {
    expect(typeof SNIPPET_MAX_CHARS).toBe('number');
    expect(SNIPPET_MAX_CHARS).toBeGreaterThan(0);
    expect(SNIPPET_MAX_CHARS).toBeLessThanOrEqual(200);
  });

  it('every snippet is <= SNIPPET_MAX_CHARS', () => {
    const view = buildTaggingView(runIngest());
    for (const v of view) {
      expect(v.snippet.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS);
    }
  });

  it('a multi-byte snippet is capped on BYTES, not UTF-16 units (the cap is a byte budget — F2/F3)', () => {
    // Regression for F2/F3: a 200-char slice of 2-byte UTF-8 is ~400 bytes, blowing the AC4 byte bound.
    // boundSnippet now caps on Buffer.byteLength, so a long multi-byte command head is <= 200 BYTES (and a
    // fortiori <= 200 chars). Use a Bash command (no path-stripping) of 600 multi-byte chars.
    const multiByte = 'é'.repeat(600); // each 'é' is 2 bytes in UTF-8
    const snippet = snippetOf(
      makeEvent({ eventType: 'tool_use', toolName: 'Bash', payload: { input: { command: multiByte } } }),
    );
    expect(Buffer.byteLength(snippet, 'utf8')).toBeLessThanOrEqual(SNIPPET_MAX_CHARS);
    expect(snippet.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS);
  });

  it('a Bash tool_use snippet is the command head (u-0008#0 -> "pnpm vitest run")', () => {
    const snippet = byId(buildTaggingView(runIngest()), 'u-0008#0').snippet;
    expect(snippet).toContain('pnpm vitest run');
  });

  it('a Bash command head KEEPS its path args intact — they are the beat signal, not stripped (F1)', () => {
    // Regression for F1: stripPaths used to run over the Bash command too, gutting `./build.sh` -> '',
    // `cat package.json` -> 'cat', `pnpm vitest run src/foo.test.ts` -> 'pnpm vitest run'. The command IS
    // the beat signal (Dev Notes §6); the path args MUST survive. (Already-scrubbed transient bake input.)
    const bash = (command: string): string =>
      snippetOf(makeEvent({ eventType: 'tool_use', toolName: 'Bash', payload: { input: { command } } }));
    expect(bash('./build.sh')).toBe('./build.sh');
    expect(bash('cat package.json')).toBe('cat package.json');
    expect(bash('pnpm vitest run src/bundle/tagging-view.test.ts')).toBe(
      'pnpm vitest run src/bundle/tagging-view.test.ts',
    );
  });

  it('a tool_result snippet is the result pass/fail head (u-0009#0 -> starts "FAIL")', () => {
    const snippet = byId(buildTaggingView(runIngest()), 'u-0009#0').snippet;
    expect(snippet.startsWith('FAIL')).toBe(true);
  });

  it('the kickoff prompt snippet is the user-text head (u-0001 -> starts "Kickoff:")', () => {
    const snippet = byId(buildTaggingView(runIngest()), 'u-0001').snippet;
    expect(snippet.startsWith('Kickoff:')).toBe(true);
  });

  it('an assistant-text snippet is the narrative head (u-0002#1 -> the "I will start by reading" line)', () => {
    const snippet = byId(buildTaggingView(runIngest()), 'u-0002#1').snippet;
    expect(snippet).toContain('I will start by reading');
  });

  it('a journal snippet is the short status/subtype (phase result -> "complete")', () => {
    const snippet = byId(buildTaggingView(runIngest()), 'phase-dev-OPAQUEHASH-1#result').snippet;
    expect(snippet).toContain('complete');
  });

  it('a file-op tool_use snippet is PATH-FREE — it never echoes the raw /work/project path', () => {
    const view = buildTaggingView(runIngest());
    // u-0002#2 is a Read of /work/project/src/schema/normalized-event.ts; u-0004#0 a Write; u-0006#0 an Edit.
    for (const ref of ['u-0002#2', 'u-0004#0', 'u-0006#0']) {
      const snippet = byId(view, ref).snippet;
      expect(snippet).not.toContain('/work/project');
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// AC1 (§6) — the fail-closed-to-default snippet branch: a no-usable-payload event, and an UNKNOWN
// eventType, must yield the explicit '' (never null/undefined, never a leak of stray payload). Story
// Task 1 enumerates "no usable payload / absent → ''"; extractSnippet has several `return ''` paths
// (null payload, non-object input, missing field, null subtype) PLUS `default: return ''` for an
// unrecognized eventType. The fixture-only tests above never reach these — they assert "snippet is a
// string", which holds for '' OR a real snippet, so they do NOT pin the fail-closed behavior. These
// synthetic cases do (a string-literal eventType is an open `z.string()` field, so an unmapped value
// is reachable and MUST degrade to '' — the per-event analogue of the engine's fail-closed-to-default).
// ---------------------------------------------------------------------------------------------------

// A minimal valid NormalizedEvent with caller-supplied overrides — for the negative/edge snippet cases.
function makeEvent(overrides: Partial<NormalizedEvent>): NormalizedEvent {
  return {
    orderKey: { logicalClock: 0, streamId: 'synthetic', seqWithinStream: 0 },
    eventId: 'edge-0',
    eventType: 'text',
    toolName: null,
    subtype: null,
    timestamp: '2026-06-14T16:00:00.000Z',
    streamDepth: 0,
    exitCode: null,
    isError: false,
    retryCount: 0,
    payload: null,
    ...overrides,
  };
}

function snippetOf(event: NormalizedEvent): string {
  const [view] = buildTaggingView([event]);
  return view.snippet;
}

describe('Story 5.6 AC1 — extractSnippet degrades to the explicit "" on absent/edge/unknown payloads', () => {
  it('a null payload yields "" (the explicit empty string, not null/undefined)', () => {
    const snippet = snippetOf(makeEvent({ eventType: 'tool_use', toolName: 'Bash', payload: null }));
    expect(snippet).toBe('');
  });

  it('a tool_use whose input is missing/non-object yields "" (Bash with no command)', () => {
    expect(snippetOf(makeEvent({ eventType: 'tool_use', toolName: 'Bash', payload: {} }))).toBe('');
    expect(
      snippetOf(makeEvent({ eventType: 'tool_use', toolName: 'Bash', payload: { input: null } })),
    ).toBe('');
  });

  it('a prompt/text event with a non-string text field yields "" (no coercion of a non-string)', () => {
    expect(snippetOf(makeEvent({ eventType: 'text', payload: { text: 42 } }))).toBe('');
    expect(snippetOf(makeEvent({ eventType: 'prompt', payload: { text: null } }))).toBe('');
  });

  it('a tool_result whose content is null/absent yields "" (no pass/fail head to extract)', () => {
    expect(snippetOf(makeEvent({ eventType: 'tool_result', payload: { content: null } }))).toBe('');
    expect(snippetOf(makeEvent({ eventType: 'tool_result', payload: {} }))).toBe('');
  });

  it('a journal event with a null subtype yields "" (the short status lives in subtype)', () => {
    expect(snippetOf(makeEvent({ eventType: 'journal_result', subtype: null, payload: { ok: true } }))).toBe('');
  });

  it('an UNKNOWN eventType degrades to "" (the default arm — fail-closed, never a leak of stray payload)', () => {
    // eventType is an open z.string(); a value the switch does not handle MUST hit `default: return ''`
    // and never serialize the raw payload. Guard against a future eventType silently leaking content.
    const snippet = snippetOf(
      makeEvent({ eventType: 'some_future_event_type', payload: { secretish: 'should-not-appear' } }),
    );
    expect(snippet).toBe('');
  });

  it('a path-only tool_result head collapses to "" after path-stripping (e.g. a bare "src/x.ts" line)', () => {
    // The path-free invariant: if a result line is JUST a path, stripPaths empties it → '' (not a leak).
    expect(snippetOf(makeEvent({ eventType: 'tool_result', payload: { content: 'src/ingest/normalize.ts' } }))).toBe('');
  });
});

// ---------------------------------------------------------------------------------------------------
// AC1 — the whole serialized view over the fixture leaks NO known raw path/name (the 5.5 path-free
// posture extended to the bake-input surface).
// ---------------------------------------------------------------------------------------------------

describe('Story 5.6 AC1 — the serialized view is grep-absent of the known raw paths/names', () => {
  it('JSON.stringify(view) contains none of the known raw absolute paths or bare file names', () => {
    const serialized = JSON.stringify(buildTaggingView(runIngest()));
    for (const needle of [
      '/work/project/src/schema/normalized-event.ts',
      '/work/project/src/ingest/parse-transcript.ts',
      '/work/project/src/ingest/normalize.ts',
      '/work/project',
      'normalized-event.ts',
      'parse-transcript.ts',
    ]) {
      expect(serialized).not.toContain(needle);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// AC1 — PURE + deterministic: same input -> deep-equal output, and the input is never mutated.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.6 AC1 — buildTaggingView is PURE and deterministic', () => {
  it('is deterministic: two calls over the same input are deep-equal', () => {
    const events = runIngest();
    expect(buildTaggingView(events)).toEqual(buildTaggingView(events));
  });

  it('never mutates the input events (deep-equal snapshot before/after)', () => {
    const events = runIngest();
    const before = structuredClone(events);
    buildTaggingView(events);
    expect(events).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------------
// AC4 — context fit: a synthetic ~689-event session reduces to a bounded view well under the window,
// and is materially smaller than the same session serialized as full events (the WHY).
// ---------------------------------------------------------------------------------------------------

// Synthesize a realistic large session: ~689 NormalizedEvents with ~400-char payloads, alternating a
// few representative shapes (a fat Bash command, a fat file Edit, a fat tool_result, an assistant text).
// Each event is a VALID NormalizedEvent (the builder consumes the normalized shape). PURE: no clock/RNG.
function makeLargeSession(count: number): NormalizedEvent[] {
  const filler = 'x'.repeat(400); // ~400-char payload body, the story's realistic-size knob.
  const events: NormalizedEvent[] = [];
  for (let i = 0; i < count; i++) {
    const base = {
      orderKey: { logicalClock: i, streamId: 'synthetic', seqWithinStream: i },
      eventId: `s-${i}`,
      timestamp: '2026-06-14T16:00:00.000Z',
      streamDepth: 0,
      exitCode: null,
      isError: i % 7 === 0,
      retryCount: 0,
    };
    const kind = i % 4;
    if (kind === 0) {
      events.push({
        ...base,
        eventType: 'tool_use',
        toolName: 'Bash',
        subtype: null,
        payload: { input: { command: `run-${i} ${filler}`, description: filler } },
      });
    } else if (kind === 1) {
      events.push({
        ...base,
        eventType: 'tool_use',
        toolName: 'Edit',
        subtype: null,
        payload: {
          input: { file_path: `/work/project/src/mod-${i}.ts`, old_string: filler, new_string: filler },
        },
      });
    } else if (kind === 2) {
      events.push({
        ...base,
        eventType: 'tool_result',
        toolName: null,
        subtype: null,
        payload: { content: `result-${i} ${filler}` },
      });
    } else {
      events.push({
        ...base,
        eventType: 'text',
        toolName: null,
        subtype: null,
        payload: { text: `narration-${i} ${filler}` },
      });
    }
  }
  return events;
}

describe('Story 5.6 AC4 — the reduced view of a ~689-event session fits the context window', () => {
  const SESSION_SIZE = 689;
  const BYTE_BOUND = 250_000;
  const TOKEN_BOUND = 60_000;

  it('serialized reduced-view bytes are < 250KB for the full ~689-event session', () => {
    const view = buildTaggingView(makeLargeSession(SESSION_SIZE));
    const bytes = Buffer.byteLength(JSON.stringify(view), 'utf8');
    expect(bytes).toBeLessThan(BYTE_BOUND);
  });

  it('the chars/4 token estimate is < 60K (a one-shot `claude -p interpret` now fits)', () => {
    const view = buildTaggingView(makeLargeSession(SESSION_SIZE));
    const tokenEstimate = JSON.stringify(view).length / 4;
    expect(tokenEstimate).toBeLessThan(TOKEN_BOUND);
  });

  it('the reduced view is MATERIALLY smaller than the same session serialized as full events (the WHY)', () => {
    const events = makeLargeSession(SESSION_SIZE);
    const viewBytes = Buffer.byteLength(JSON.stringify(buildTaggingView(events)), 'utf8');
    const fullBytes = Buffer.byteLength(JSON.stringify(events), 'utf8');
    // The full events carry the ~400-char payloads; the view drops them for a bounded snippet.
    expect(fullBytes).toBeGreaterThan(viewBytes * 2);
  });

  it('still preserves all ~689 eventIds verbatim (grounding holds at scale)', () => {
    const events = makeLargeSession(SESSION_SIZE);
    const view: TaggingViewEvent[] = buildTaggingView(events);
    expect(view.map((v) => v.eventId)).toEqual(events.map((e) => e.eventId));
  });

  it('the byte bound holds for a MULTI-BYTE ~689-event session too (F2 — not just ASCII)', () => {
    // F2: before the byte-cap fix, a maxed 2-byte-UTF-8 view = ~335KB (> 250KB), because the cap was on
    // UTF-16 units not bytes. Synthesize the same ~689-event session with 2-byte 'é' filler and assert the
    // serialized view still fits the byte bound (each snippet is now byte-capped at SNIPPET_MAX_CHARS).
    const filler = 'é'.repeat(400); // 800 bytes per payload body
    const events: NormalizedEvent[] = [];
    for (let i = 0; i < SESSION_SIZE; i++) {
      events.push(
        makeEvent({
          orderKey: { logicalClock: i, streamId: 'synthetic', seqWithinStream: i },
          eventId: `m-${i}`,
          eventType: 'tool_use',
          toolName: 'Bash',
          payload: { input: { command: `run-${i} ${filler}` } },
        }),
      );
    }
    const bytes = Buffer.byteLength(JSON.stringify(buildTaggingView(events)), 'utf8');
    expect(bytes).toBeLessThan(BYTE_BOUND);
  });
});
