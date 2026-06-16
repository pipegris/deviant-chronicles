import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BeatAnnotation } from '../schema/beat-annotation';
import { type NormalizedEvent } from '../schema/normalized-event';
import type { TaggingViewEvent } from '../bundle/tagging-view';
import { SNIPPET_MAX_CHARS } from '../bundle/tagging-view';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';
import { canonicalJSON, freezeAnnotations } from './freeze';
import { ClaudeInterpreter } from './claude-interpreter';

// RED-PHASE acceptance test for Story 5.7 — Chunked/windowed real-LLM interpret (unblocks the deferred
// full-session bake). It imports the NOT-YET-AUTHORED `./chunked-interpret` module, so this file ERRORS
// now (RED — module resolution fails). It turns GREEN once the dev authors src/interpret/chunked-interpret.ts
// with the PURE chunk splitter + the per-chunk interpret/merge orchestrator + MAX_CHUNK_EVENTS.
//
// The story's ACs (verbatim Given/When/Then) are the authoritative source. This file encodes the
// GATE-VERIFIABLE half (Vitest, against a FAKE interpreter — ZERO LLM spend, the Story 3.2/5.6
// mocked-machinery precedent). Every assertion runs against an INJECTED fake / a mocked AnthropicLike
// client — no real network, no ANTHROPIC_API_KEY. The actual full-session `claude -p` bake is the
// DEFERRED operator step (out of this gate).
//
// AC1 — a PURE orchestrator splits TaggingViewEvent[] into contiguous, non-overlapping chunks each
//        <= a configured max size, covering EVERY event EXACTLY once in order; deterministic; no mutation.
// AC2 — the orchestrator calls the SAME 2-arg interpret(chunkPromptEvents, FULL groundingEvents) so
//        per-annotation sourceHash + annotationHash/freeze stay over the FULL scrubbed events; the model
//        PROMPT is only the chunk, the GROUNDING arg is the full set on EVERY call.
// AC3 — concatenate per-chunk BeatAnnotation[] in chunk order, dedup (eventRef+beatType) keeping the
//        highest-confidence (stable tiebreak = keep first-seen on equal confidence); merged set is
//        deterministic; every ref still resolves against the full events (freeze stays fail-loud-clean).
// AC4 — at the configured chunk size each chunk's serialized prompt is bounded well under the whole-view
//        size that timed out (concrete per-chunk Buffer.byteLength bound + a documented chunk count).

import {
  chunkTaggingView,
  interpretChunked,
  mergeAnnotations,
  MAX_CHUNK_EVENTS,
  type ChunkedInterpretArgs,
} from './chunked-interpret';

// ---------------------------------------------------------------------------------------------------
// Helpers — synthetic TaggingViewEvent[] views + real ingest for the grounding/freeze cross-checks.
// ---------------------------------------------------------------------------------------------------

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'ingest', '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

// Drive the REAL ingest pipeline over the committed fixtures so the eventIds the cross-checks anchor to
// are the SAME ones the rest of the system sees (the claude-interpreter.test.ts L39-49 precedent).
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

// A tiny builder of N synthetic tagging-view rows with the valid 5-key shape. Deterministic — the
// eventId encodes the index so chunk slices are identity-checkable.
function makeView(n: number, snippet = 'ran tests'): TaggingViewEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    eventId: `e-${i}`,
    toolName: 'Bash',
    // ATDD-fix: 'self' is NOT a valid AbstractedRole ('test'|'schema'|'migration'|'config'|'doc'|'source');
    // the original red scaffold used a non-existent literal. Use 'source' (the catch-all). The role value is
    // irrelevant to chunk coverage/order/merge/byte-bound — the chunker treats rows opaquely — so this
    // honest fix tightens types without weakening any assertion.
    role: 'source' as const,
    outcome: 'success' as const,
    snippet,
  }));
}

// A worst-case-realistic ~689-event view: snippets near SNIPPET_MAX_CHARS (the per-row byte ceiling),
// toolName/eventId at realistic lengths — so the AC4 byte bound proves the budget under the worst case.
// NOTE (F2): the snippet is ASCII ('x' * 200), so it never JSON-escapes (1 byte/char -> 289 bytes/row).
// This matches real bake content, which is ASCII-dominant (Bash command heads, FAIL/pass verdict words).
// The CHUNK_BYTE_BOUND below is calibrated for that ASCII payload — an escape-pathological snippet (200
// raw bytes of all-'"', which the tagging-view byteCap permits) would serialize to ~489 bytes/row (49KB
// per 100-row chunk) because each '"' becomes '\"'. That is not a defect: the load-bearing AC4 proof is
// the RELATIVE bound (whole view > 4x any chunk), which holds under both shapes since escaping scales
// proportionally; and even 49KB (~12K tokens) is far under the 200K window + the 600s timeout.
function makeRealisticView(n: number): TaggingViewEvent[] {
  const bigSnippet = 'x'.repeat(SNIPPET_MAX_CHARS); // the max-length scrub-safe excerpt (ASCII, no escapes)
  return Array.from({ length: n }, (_, i) => ({
    eventId: `u-${String(i).padStart(4, '0')}#0`,
    toolName: 'Bash',
    // ATDD-fix: 'self' is not a valid AbstractedRole — use 'source' (see makeView). Role is irrelevant to
    // the AC4 byte bound (dominated by the SNIPPET_MAX_CHARS snippet), so this is a type-honest no-op fix.
    role: 'source' as const,
    outcome: i % 2 === 0 ? ('success' as const) : ('isError' as const),
    snippet: bigSnippet,
  }));
}

// The narrow structural AnthropicLike fake (the claude-interpreter.test.ts seam) — records each
// messages.create body and returns the supplied canned tool_use.
interface FakeContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
}
interface FakeClient {
  messages: { create(body: Record<string, unknown>): Promise<{ content: FakeContentBlock[] }> };
  calls: Array<Record<string, unknown>>;
}
function makeFakeSdkClient(annotations: BeatAnnotation[]): FakeClient {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    messages: {
      async create(body: Record<string, unknown>) {
        calls.push(body);
        return {
          content: [
            { type: 'tool_use', id: 'toolu_mock', name: 'emit_beat_annotations', input: { annotations } },
          ],
        };
      },
    },
  };
}

function makeAnnotation(
  eventRef: string,
  beatType: BeatAnnotation['beatType'],
  confidence: number,
  eventRefs: string[] = [eventRef],
): BeatAnnotation {
  return {
    eventRef,
    beatType,
    confidence,
    interpreterVersion: 'test/v1',
    sourceHash: 'mock',
    groundingPointer: { eventRefs },
  };
}

// ===================================================================================================
// AC1 — the PURE chunk splitter: contiguous, non-overlapping, covers every event exactly once in order.
// ===================================================================================================

describe('Story 5.7 AC1 — chunkTaggingView splits into contiguous non-overlapping chunks', () => {
  it('the flattened chunks deep-equal the input view (order + every event exactly once)', () => {
    const view = makeView(13);
    const chunks = chunkTaggingView(view, 5);
    expect(chunks.flat()).toEqual(view);
  });

  it('every chunk is <= maxChunkSize and the count is ceil(view.length / maxChunkSize)', () => {
    const view = makeView(13);
    const chunks = chunkTaggingView(view, 5);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(5);
    }
    expect(chunks).toHaveLength(Math.ceil(13 / 5)); // 3
  });

  it('a non-multiple length yields a remainder last chunk (13 / 5 -> [5,5,3])', () => {
    const chunks = chunkTaggingView(makeView(13), 5);
    expect(chunks.map((c) => c.length)).toEqual([5, 5, 3]);
  });

  it('an exact multiple yields full chunks only (10 / 5 -> [5,5])', () => {
    const chunks = chunkTaggingView(makeView(10), 5);
    expect(chunks.map((c) => c.length)).toEqual([5, 5]);
  });

  it('an empty view yields []', () => {
    expect(chunkTaggingView([], 5)).toEqual([]);
  });

  it('view.length <= maxChunkSize yields exactly one chunk equal to the view', () => {
    const view = makeView(3);
    const chunks = chunkTaggingView(view, 5);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(view);
  });

  it('is deterministic (same input -> deep-equal output on a second call)', () => {
    const view = makeView(13);
    expect(chunkTaggingView(view, 5)).toEqual(chunkTaggingView(view, 5));
  });

  it('never mutates the input view (deep-equal to a pre-call snapshot)', () => {
    const view = makeView(13);
    const snapshot = structuredClone(view);
    chunkTaggingView(view, 5);
    expect(view).toEqual(snapshot);
  });

  it('throws on maxChunkSize <= 0 (fail-closed; a degenerate split would loop / drop events)', () => {
    expect(() => chunkTaggingView(makeView(5), 0)).toThrow();
    expect(() => chunkTaggingView(makeView(5), -1)).toThrow();
  });
});

// ===================================================================================================
// AC4 — context/timeout fit: each chunk's serialized prompt is bounded well under the whole-view size.
// ===================================================================================================

describe('Story 5.7 AC4 — each chunk is bounded well under the whole-view size that timed out', () => {
  // The documented derivation (Dev Notes §3): MAX_CHUNK_EVENTS = 100 reduced-view rows, each <= ~280
  // bytes worst-case -> ~28KB per chunk prompt -> 7 chunks for 689 events. A conservative byte bound
  // (covering ~28KB + headroom) proves the per-call budget that drives the sub-600s latency.
  // ASSUMPTION (F2): this absolute bound is calibrated for ASCII-payload snippets (the realistic bake
  // content; 'x'*200 -> 289 bytes/row -> 29KB/chunk). An escape-pathological 200-byte snippet would
  // exceed it (~49KB) — see the makeRealisticView note; the load-bearing guarantee is the RELATIVE
  // whole-view-vs-chunk proof below, which is escape-shape-independent.
  const CHUNK_BYTE_BOUND = 35_000;
  const VIEW_SIZE = 689;

  it('MAX_CHUNK_EVENTS is the documented fixed budget (100)', () => {
    expect(MAX_CHUNK_EVENTS).toBe(100);
  });

  it('a 689-event view chunks into the documented 7 chunks at MAX_CHUNK_EVENTS', () => {
    const view = makeRealisticView(VIEW_SIZE);
    const chunks = chunkTaggingView(view, MAX_CHUNK_EVENTS);
    expect(chunks).toHaveLength(Math.ceil(VIEW_SIZE / MAX_CHUNK_EVENTS)); // 7
    expect(chunks).toHaveLength(7);
  });

  it('each chunk serializes under the per-chunk byte bound (worst-case realistic rows)', () => {
    const view = makeRealisticView(VIEW_SIZE);
    const chunks = chunkTaggingView(view, MAX_CHUNK_EVENTS);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(JSON.stringify(chunk))).toBeLessThan(CHUNK_BYTE_BOUND);
    }
  });

  it('the WHOLE view serializes materially larger than any single chunk (the WHY — it one-shot timed out)', () => {
    const view = makeRealisticView(VIEW_SIZE);
    const chunks = chunkTaggingView(view, MAX_CHUNK_EVENTS);
    const wholeBytes = Buffer.byteLength(JSON.stringify(view));
    const maxChunkBytes = Math.max(...chunks.map((c) => Buffer.byteLength(JSON.stringify(c))));
    // The whole view is what exceeded the 600s claude -p timeout one-shot; each chunk is far smaller.
    expect(wholeBytes).toBeGreaterThan(maxChunkBytes * 4);
  });
});

// ===================================================================================================
// AC2 — per-chunk FULL grounding: chunk is the PROMPT, the FULL set is the grounding on EVERY call.
// ===================================================================================================

describe('Story 5.7 AC2 — interpretChunked passes the chunk as prompt and the FULL set as grounding', () => {
  it('calls interpret once per chunk; each call.promptEvents deep-equals the matching chunk slice', async () => {
    const promptView = makeView(13); // 13 @ 5 -> 3 chunks
    const groundingEvents = runIngest();
    const recorded: Array<{
      promptEvents: readonly TaggingViewEvent[];
      groundingEvents: NormalizedEvent[];
    }> = [];

    const args: ChunkedInterpretArgs = {
      promptView,
      groundingEvents,
      maxChunkSize: 5,
      interpret: async (promptEvents, grounding) => {
        recorded.push({ promptEvents, groundingEvents: grounding });
        return [];
      },
    };
    await interpretChunked(args);

    const expectedChunks = chunkTaggingView(promptView, 5);
    expect(recorded).toHaveLength(expectedChunks.length); // 3 calls
    for (let i = 0; i < expectedChunks.length; i++) {
      expect(recorded[i].promptEvents).toEqual(expectedChunks[i]);
    }
    // The concatenation of all recorded prompt slices, in call order, reconstructs the full view
    // (contiguous, in order, no overlap).
    expect(recorded.flatMap((r) => [...r.promptEvents])).toEqual(promptView);
  });

  it('passes the REFERENTIALLY-SAME full groundingEvents array on EVERY call (=== the input)', async () => {
    const promptView = makeView(13);
    const groundingEvents = runIngest();
    const seen: NormalizedEvent[][] = [];

    await interpretChunked({
      promptView,
      groundingEvents,
      maxChunkSize: 5,
      interpret: async (_promptEvents, grounding) => {
        seen.push(grounding);
        return [];
      },
    });

    expect(seen.length).toBeGreaterThan(1);
    for (const grounding of seen) {
      expect(grounding).toBe(groundingEvents); // referential identity (the FULL set, not a chunk)
    }
  });

  it('an empty promptView yields [] with ZERO interpret calls (no wasted claude -p subprocess)', async () => {
    // The orchestrator's documented empty-view contract ("Empty view -> [] with ZERO interpret calls").
    // A regression that called interpret() once on an empty chunk would still return [] (merge of []),
    // so the OUTPUT alone cannot catch it — assert the call COUNT is 0, which pins the no-subprocess
    // guarantee that matters at bake time (each interpret call is a heavyweight claude -p subprocess).
    let calls = 0;
    const merged = await interpretChunked({
      promptView: [],
      groundingEvents: runIngest(),
      maxChunkSize: 5,
      interpret: async () => {
        calls += 1;
        return [makeAnnotation('u-1', 'shaman', 0.9)];
      },
    });
    expect(calls).toBe(0);
    expect(merged).toEqual([]);
  });

  it('drives a chunk through the REAL ClaudeInterpreter: sourceHash is over the FULL events, not the chunk', async () => {
    // The grounding-over-full-events end-to-end proof: bind the real 2-arg ClaudeInterpreter.interpret as
    // the injected callback (with a mocked SDK), and assert the returned sourceHash is sha256 over the
    // FULL events filtered by the beat's refs — NOT the reduced chunk. This re-proves the 5.6 2-arg
    // contract is preserved end-to-end through the orchestrator (Hard Invariant 2 / AC2).
    const fullEvents = runIngest();
    const refs = ['u-0002#1', 'u-0002#2', 'u-0003#0'];
    const canned = [makeAnnotation('u-0002#1', 'dispel', 0.8, refs)];
    const fakeSdk = makeFakeSdkClient(canned);
    const interpreter = new ClaudeInterpreter({ client: fakeSdk });

    // One chunk (small view) so a single interpret call fires; grounding is the FULL events.
    const promptView = makeView(3);
    const merged = await interpretChunked({
      promptView,
      groundingEvents: fullEvents,
      maxChunkSize: 100, // a single chunk
      interpret: (chunk, grounding) => interpreter.interpret(chunk, grounding),
    });

    expect(merged).toHaveLength(1);
    const refSet = new Set(refs);
    const grounded = fullEvents.filter((e) => refSet.has(e.eventId));
    const expectedHash = createHash('sha256').update(canonicalJSON(grounded)).digest('hex');
    expect(merged[0].sourceHash).toBe(expectedHash);
    // ...and NOT a hash over the reduced chunk prompt (the load-bearing AC2 distinction).
    expect(merged[0].sourceHash).not.toBe(
      createHash('sha256').update(canonicalJSON([])).digest('hex'),
    );
  });

  it('uses MAX_CHUNK_EVENTS as the default when maxChunkSize is omitted (the production wiring path)', async () => {
    // build-bundle.ts:213 deliberately OMITS maxChunkSize so the orchestrator falls back to
    // MAX_CHUNK_EVENTS (Task 4: "Do NOT pass maxChunkSize"). That `maxChunkSize ?? MAX_CHUNK_EVENTS`
    // fallback is the EXACT production code path, yet every other interpretChunked test passes an
    // explicit size — so a regression to the default would slip through. Drive a view spanning two
    // default-size chunks and assert the call count + slice boundaries match a MAX_CHUNK_EVENTS split.
    const promptView = makeView(MAX_CHUNK_EVENTS + 1); // 101 @ 100 -> 2 chunks
    const recorded: Array<readonly TaggingViewEvent[]> = [];

    await interpretChunked({
      promptView,
      groundingEvents: runIngest(),
      // maxChunkSize intentionally OMITTED — exercise the MAX_CHUNK_EVENTS default.
      interpret: async (chunk) => {
        recorded.push(chunk);
        return [];
      },
    });

    const expectedChunks = chunkTaggingView(promptView, MAX_CHUNK_EVENTS);
    expect(recorded).toHaveLength(2);
    expect(recorded.map((c) => c.length)).toEqual([MAX_CHUNK_EVENTS, 1]);
    for (let i = 0; i < expectedChunks.length; i++) {
      expect(recorded[i]).toEqual(expectedChunks[i]);
    }
  });
});

// ===================================================================================================
// AC3 — merge + dedup: highest-confidence per (eventRef,beatType), stable first-seen tiebreak, chunk order.
// ===================================================================================================

describe('Story 5.7 AC3 — mergeAnnotations dedups (eventRef+beatType) keeping highest confidence', () => {
  it('keeps the highest-confidence annotation when the same (eventRef,beatType) appears twice', () => {
    const merged = mergeAnnotations([
      makeAnnotation('u-1', 'shaman', 0.6),
      makeAnnotation('u-1', 'shaman', 0.9), // higher confidence dup -> wins
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].confidence).toBe(0.9);
  });

  it('on EQUAL confidence keeps the FIRST-SEEN (stable tiebreak: > not >=)', () => {
    const first = makeAnnotation('u-1', 'shaman', 0.9, ['u-1', 'first']);
    const second = makeAnnotation('u-1', 'shaman', 0.9, ['u-1', 'second']);
    const merged = mergeAnnotations([first, second]);
    expect(merged).toHaveLength(1);
    // The first-seen grounding is retained (the equal-confidence later dup is dropped).
    expect(merged[0].groundingPointer.eventRefs).toEqual(['u-1', 'first']);
  });

  it('retains distinct (eventRef,beatType) pairs in first-seen (chunk) order', () => {
    const merged = mergeAnnotations([
      makeAnnotation('u-1', 'shaman', 0.6),
      makeAnnotation('u-1', 'shaman', 0.9),
      makeAnnotation('u-2', 'dispel', 0.5),
    ]);
    expect(merged.map((a) => `${a.eventRef} ${a.beatType}`)).toEqual(['u-1 shaman', 'u-2 dispel']);
    expect(merged.find((a) => a.eventRef === 'u-1')?.confidence).toBe(0.9);
    expect(merged.find((a) => a.eventRef === 'u-2')?.confidence).toBe(0.5);
  });

  it('does NOT collide distinct refs/types via concatenation (the " " joiner)', () => {
    // 'a b'+'c' vs 'a'+'b c' would collide under a bare concat; the space joiner keeps them distinct.
    const merged = mergeAnnotations([
      makeAnnotation('a b', 'shaman', 0.5),
      makeAnnotation('a', 'shaman', 0.5), // distinct key from 'a b shaman'
    ]);
    expect(merged).toHaveLength(2);
  });

  it('the same (eventRef,beatType) but DIFFERENT beatType is NOT deduped (keyed on both)', () => {
    const merged = mergeAnnotations([
      makeAnnotation('u-1', 'shaman', 0.5),
      makeAnnotation('u-1', 'dispel', 0.5),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('is deterministic (call-twice toEqual) and does not mutate the input', () => {
    const input = [
      makeAnnotation('u-1', 'shaman', 0.6),
      makeAnnotation('u-1', 'shaman', 0.9),
      makeAnnotation('u-2', 'dispel', 0.5),
    ];
    const snapshot = structuredClone(input);
    const a = mergeAnnotations(input);
    const b = mergeAnnotations(input);
    expect(a).toEqual(b);
    expect(input).toEqual(snapshot);
  });
});

describe('Story 5.7 AC3 — the full interpretChunked merge keeps highest-confidence across chunks', () => {
  it('merges overlapping beats emitted from adjacent chunks (highest confidence wins, chunk order)', async () => {
    const promptView = makeView(10); // 10 @ 5 -> 2 chunks
    const groundingEvents = runIngest();
    let call = 0;

    const merged = await interpretChunked({
      promptView,
      groundingEvents,
      maxChunkSize: 5,
      interpret: async () => {
        call += 1;
        if (call === 1) {
          // chunk 0: a low-confidence shaman on u-1
          return [makeAnnotation('u-1', 'shaman', 0.6)];
        }
        // chunk 1: a HIGHER-confidence dup of u-1/shaman + a distinct u-2/dispel + an EQUAL-confidence
        // later dup of u-1/shaman (must be dropped in favor of the higher one).
        return [
          makeAnnotation('u-1', 'shaman', 0.9),
          makeAnnotation('u-2', 'dispel', 0.5),
          makeAnnotation('u-1', 'shaman', 0.9),
        ];
      },
    });

    expect(merged.map((a) => `${a.eventRef} ${a.beatType}`)).toEqual(['u-1 shaman', 'u-2 dispel']);
    expect(merged.find((a) => a.eventRef === 'u-1')?.confidence).toBe(0.9);
  });

  it('the merged set is deterministic across two identical interpretChunked runs', async () => {
    const promptView = makeView(10);
    const groundingEvents = runIngest();
    const run = () =>
      interpretChunked({
        promptView,
        groundingEvents,
        maxChunkSize: 5,
        interpret: async () => [makeAnnotation('u-1', 'shaman', 0.7)],
      });
    expect(await run()).toEqual(await run());
  });
});

describe('Story 5.7 AC3 — the merged refs still resolve against the full events (freeze fail-loud-clean)', () => {
  it('freezeAnnotations over the merged set + full events does NOT throw (no dangling ref)', async () => {
    const fullEvents = runIngest();
    // Two real fixture ids the merged beats ground to, across two chunks.
    const refA = fullEvents[1].eventId;
    const refB = fullEvents[3].eventId;
    let call = 0;

    const merged = await interpretChunked({
      promptView: makeView(10),
      groundingEvents: fullEvents,
      maxChunkSize: 5,
      interpret: async () => {
        call += 1;
        return call === 1
          ? [makeAnnotation(refA, 'shaman', 0.6, [refA])]
          : [makeAnnotation(refB, 'dispel', 0.5, [refB])];
      },
    });

    expect(() =>
      freezeAnnotations({
        normalizedEvents: fullEvents,
        annotations: merged,
        interpreterVersion: 'test/v1',
        promptVersion: 'test-prompt',
      }),
    ).not.toThrow();
  });
});

// ===================================================================================================
// AC5 (orchestrator discipline) — the chunked orchestrator is SDK-free by construction (R4 by design).
// The byte-identical committed-bundle + dist-grep halves of AC5 are build-gate / operator checks
// (pnpm bundle:story-10-1 + git diff + grep -ril anthropic dist/) covered by the existing
// committed-bundle*.test.ts + r4-isolation.test.ts and the gates, not a unit assertion here. This
// asserts the testable invariant: the new module never imports the SDK in its source.
// ===================================================================================================

describe('Story 5.7 AC5 — the chunked-interpret module is SDK-free (R4 by construction)', () => {
  it('chunked-interpret.ts has no @anthropic-ai/sdk import (the orchestrator injects interpret)', () => {
    const moduleSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'chunked-interpret.ts'),
      'utf8',
    );
    const codeOnly = moduleSource
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(codeOnly).not.toMatch(/from\s+['"]@anthropic-ai\/sdk['"]/);
    expect(codeOnly).not.toMatch(/import\s*\(\s*['"]@anthropic-ai\/sdk['"]/);
    expect(codeOnly).not.toMatch(/require\s*\(\s*['"]@anthropic-ai\/sdk['"]/);
  });
});
