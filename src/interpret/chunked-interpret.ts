import type { NormalizedEvent } from '../schema/normalized-event';
import type { BeatAnnotation } from '../schema/beat-annotation';
import type { TaggingViewEvent } from '../bundle/tagging-view';

// Story 5.7 — the PURE chunked/windowed real-LLM interpret orchestrator. It windows the reduced
// TaggingViewEvent[] view (Story 5.6) into bounded, non-overlapping chunks, interprets each via the SAME
// 5.6 2-arg seam (chunk = PROMPT, FULL scrubbed events = GROUNDING on every call), then merges + dedups the
// per-chunk BeatAnnotation[]. WHY: a single `claude -p interpret` over the ~689-event whole view exceeds
// ClaudeCliClient's 600s execFile timeout (exit 143 / SIGTERM); chunking shrinks each call's PROMPT under it.
//
// BAKE-PROMPT-SHAPING ONLY: annotationHash/freeze/provenance and the committed fixture bundle are UNCHANGED
// — the per-annotation sourceHash + assembleBundle's annotationHash stay over the FULL scrubbed events
// because the full set is passed as the grounding arg on EVERY chunk call (the 5.6 2-arg contract, AS-IS).
//
// SDK-FREE by construction (R4 proof by design): the `interpret` function is INJECTED, so this module never
// imports @anthropic-ai/sdk and never spawns `claude -p` — the SDK/CLI zone stays in claude-interpreter.ts +
// scripts/, and the orchestrator is unit-testable with a FAKE at ZERO LLM spend (the 3.2/5.6 precedent). It
// imports only the TaggingViewEvent TYPE (the interpret->bundle edge is already type-only in
// claude-interpreter.ts:3 — erased at runtime, no cycle) + schema types.
//
// PURE + deterministic (R2 posture): no Date.now / Math.random / IO / global-mutable state; never mutates
// the input. The ONLY effect is awaiting the injected interpret callback.

// MAX_CHUNK_EVENTS — a documented module const (NOT config-as-data). This is a FIXED prompt-budget
// engineering knob (how many reduced-view rows fit comfortably under the `claude -p` timeout per call), NOT
// operator-tunable replay tuning (NFR-4 governs replay config — translation/pacing/captions — not a
// bake-input budget). Mirrors SNIPPET_MAX_CHARS (tagging-view.ts) and claude-interpreter.ts's MAX_TOKENS —
// fixed engineering ceilings kept inline. A config loader would earn nothing for a single internal
// build-time budget. Derivation (Dev Notes §3): each reduced-view row is <= ~280 bytes worst-case (Story
// 5.6 §5) -> 100 rows ~= ~28KB per chunk prompt -> 7 chunks for the 689-event view, each `claude -p`
// call far under the 600s timeout that the ~193KB whole-view one-shot exceeded (~28KB/4 ~= ~7K tokens).
export const MAX_CHUNK_EVENTS = 100;

/**
 * Split the reduced tagging view into contiguous, NON-overlapping chunks each `<= maxChunkSize` events, in
 * input order (AC1). A straightforward index walk; the last chunk is the remainder (may be smaller). The
 * flattened chunks deep-equal the input view — every event is covered EXACTLY once, no drop or duplicate.
 *
 * Non-overlapping is chosen for determinism + simplicity. The boundary-beat tradeoff: a beat anchored at a
 * chunk edge only ever sees the in-chunk PROMPT, but its GROUNDING is the full set on every call, and
 * claude-interpreter.ts's sanitizeAgainstEvents trims any out-of-set ref against the FULL authoritative id
 * set — so a chunk-local hallucination is dropped and a kept ref always resolves. Overlap (re-presenting
 * the prior chunk's tail) is a DEFERRED refinement, not needed for the timeout fix.
 *
 * PURE + deterministic: `slice` returns fresh arrays, so `view` is never mutated. Fail-loud guard:
 * `maxChunkSize >= 1` (throw on `<= 0` — a zero/negative size would loop forever or drop events; fail
 * closed, never a degenerate split). Empty view -> []. `view.length <= maxChunkSize` -> one chunk.
 */
export function chunkTaggingView(
  view: readonly TaggingViewEvent[],
  maxChunkSize: number,
): TaggingViewEvent[][] {
  if (maxChunkSize <= 0) {
    throw new Error(
      `chunkTaggingView: maxChunkSize must be >= 1 (got ${maxChunkSize}); a non-positive size would drop events.`,
    );
  }
  const chunks: TaggingViewEvent[][] = [];
  for (let i = 0; i < view.length; i += maxChunkSize) {
    chunks.push(view.slice(i, i + maxChunkSize));
  }
  return chunks;
}

/**
 * Merge + dedup the concatenated per-chunk annotations (AC3). Chunking can produce DUPLICATE beats: a beat
 * whose grounding spans a chunk boundary, or the model emitting the same anchor beat from two adjacent
 * chunks, yields two annotations with the same (eventRef, beatType).
 *
 * Walk the input IN ORDER (chunk/event order); the dedup KEY = `${eventRef} ${beatType}` (the ` ` joiner
 * avoids concatenation collisions — `'a b'+'shaman'` vs `'a'+'b shaman'` stay distinct). For each key keep
 * the HIGHEST-confidence annotation; on EQUAL confidence keep the FIRST-SEEN (stable tiebreak — `>` not
 * `>=`). Output preserves FIRST-SEEN insertion order via a `Map` (Maps preserve insertion order; we replace
 * the value in place when a strictly-higher dup arrives, never re-inserting), so distinct (eventRef,
 * beatType) pairs come out in chunk order.
 *
 * Dedup is keyed on (eventRef, beatType) NOT groundingPointer — two chunks may ground the same anchor beat
 * to slightly different ref sets; the highest-confidence one's grounding wins as the single source of truth
 * (intentional, documented). The kept annotation's grounding still resolves against the full events, so
 * freeze stays fail-loud-clean. Provenance is NOT re-stamped: each annotation's sourceHash was already
 * stamped over the full grounding by the interpreter; we leave it intact.
 *
 * PURE + deterministic: never mutates the input; same input -> deep-equal output.
 */
export function mergeAnnotations(annotations: readonly BeatAnnotation[]): BeatAnnotation[] {
  const byKey = new Map<string, BeatAnnotation>();
  for (const annotation of annotations) {
    const key = `${annotation.eventRef} ${annotation.beatType}`;
    const existing = byKey.get(key);
    // Keep the existing first-seen unless a STRICTLY-higher confidence arrives (`>`, not `>=`, so an
    // equal-confidence later dup is dropped — the stable first-seen tiebreak).
    if (existing === undefined || annotation.confidence > existing.confidence) {
      byKey.set(key, annotation);
    }
  }
  return [...byKey.values()];
}

/**
 * The arguments to the chunked interpret orchestrator (AC2). The `interpret` callback is INJECTED so the
 * orchestrator stays PURE-of-the-SDK + gate-testable with a FAKE (the script binds
 * `(chunk, grounding) => interpreter.interpret(chunk, grounding)` as the callback — the SAME Story 5.6
 * 2-arg ClaudeInterpreter.interpret seam, reused AS-IS). `groundingEvents` is the FULL scrubbed set passed
 * on EVERY chunk call; `maxChunkSize` defaults to MAX_CHUNK_EVENTS.
 */
export interface ChunkedInterpretArgs {
  promptView: readonly TaggingViewEvent[];
  groundingEvents: NormalizedEvent[];
  interpret: (
    promptEvents: readonly TaggingViewEvent[],
    groundingEvents: NormalizedEvent[],
  ) => Promise<BeatAnnotation[]>;
  maxChunkSize?: number;
}

/**
 * Interpret the reduced tagging view in bounded chunks, then merge + dedup (AC1, AC2, AC3, AC4).
 *
 * Split `promptView` into `<= maxChunkSize` chunks, then for EACH chunk IN ORDER call
 * `interpret(chunk, groundingEvents)` — the chunk is the small PROMPT; `groundingEvents` is the FULL set
 * passed on EVERY call (AC2 — so per-annotation sourceHash stays over the full events via the 5.6 2-arg
 * seam). Concatenate the per-chunk results in chunk order, then merge + dedup (AC3). Empty view -> [] with
 * ZERO interpret calls.
 *
 * SEQUENTIAL (not Promise.all): each `claude -p` call is a heavyweight subprocess, so sequential calls keep
 * memory/process pressure bounded; and the concatenation order = chunk order = the deterministic merge
 * input (the tiebreak is order-sensitive). The bake is a one-time offline step, so wall-clock isn't
 * critical.
 *
 * PURE except for awaiting the injected interpret: fresh accumulators per call, never mutates inputs.
 */
export async function interpretChunked(args: ChunkedInterpretArgs): Promise<BeatAnnotation[]> {
  const { promptView, groundingEvents, interpret, maxChunkSize } = args;
  const chunks = chunkTaggingView(promptView, maxChunkSize ?? MAX_CHUNK_EVENTS);
  const collected: BeatAnnotation[] = [];
  for (const chunk of chunks) {
    const chunkAnnotations = await interpret(chunk, groundingEvents);
    collected.push(...chunkAnnotations);
  }
  return mergeAnnotations(collected);
}
