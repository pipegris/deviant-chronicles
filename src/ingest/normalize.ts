import {
  NormalizedEventSchema,
  type NormalizedEvent,
} from '../schema/normalized-event';
import { isAllowed } from './allowlist';
import type { RawContentItem, RawTranscriptRecord } from './parse-transcript';
import type { RawJournalRecord } from './parse-journal';

// Raw records -> camelCase NormalizedEvent[], per stream. PURE (R2): no fs / Date.now /
// Math.random / global mutable state. Time derives ONLY from event timestamps via
// Date.parse(string) — a pure string->number transform that reads no clock.
//
// The R3 guarantee lives here: this is the ONLY place raw snake_case (is_error,
// tool_use_id, parentUuid, …) is read; every returned object is a clean camelCase
// NormalizedEvent. Each emitted event is validated with NormalizedEventSchema.parse before
// return (Zod-validated emission, AC1) — which also strips any stray key, but normalize is
// written to never produce one.

// Static-but-not-derivable fields, factored so the camelCase shape is authored in ONE fixed
// key order (stable JSON for the determinism snapshot, AC1).
const STREAM_DEPTH = 0; // no in-transcript sub-agent nesting in this session.
const RETRY_COUNT = 0; // retry/struggle detection is a pacing concern (Story 1.5), not 1.3.

// Map a raw snake_case key to its camelCase NormalizedEvent-side spelling. This is the R3
// boundary for content-block keys: tool_result.content can be an ARRAY of raw content items
// (a common real Claude Code shape) whose keys (tool_use_id, is_error, …) must NEVER leak.
const RAW_KEY_TO_CAMEL: Record<string, string> = {
  tool_use_id: 'toolUseId',
  is_error: 'isError',
};

/**
 * Recursively camelCase any raw snake_case keys in a tool_result.content value (R3).
 *
 * tool_result.content is `z.unknown()` at the raw boundary, so it may be a string (the
 * common case) OR an array of raw content blocks ({type:'text', text}, nested tool_result
 * objects carrying tool_use_id/is_error, …). A verbatim spread would leak those raw keys
 * past ingest/. PURE: builds fresh values, mutates nothing.
 */
function normalizeResultContent(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeResultContent);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[RAW_KEY_TO_CAMEL[key] ?? key] = normalizeResultContent(nested);
    }
    return out;
  }
  // Strings / numbers / booleans / null pass through unchanged (no raw keys to rename).
  return value;
}

// tool_result content can be large; for v0.1 we keep payload faithful (the public-bundle
// scrub is Epic 5). subtype is a nullable Interpreter signal, null for transcript items.
function normalizeContentItem(
  item: RawContentItem,
  uuid: string,
  itemIndex: number,
  streamId: string,
  seqWithinStream: number,
  provisionalClock: number,
  timestamp: string,
): NormalizedEvent | null {
  if (!isAllowed({ kind: 'content_item', type: item.type, toolName: 'name' in item ? item.name : undefined })) {
    return null; // thinking (and any future excluded item) is dropped here.
  }

  const base = {
    orderKey: { logicalClock: provisionalClock, streamId, seqWithinStream },
    // uuids repeat across a line's content items, so suffix with the item index to keep
    // every emitted eventId unique.
    eventId: `${uuid}#${itemIndex}`,
    timestamp,
    streamDepth: STREAM_DEPTH,
    exitCode: null,
    retryCount: RETRY_COUNT,
  };

  switch (item.type) {
    case 'text':
      return {
        ...base,
        eventType: 'text',
        toolName: null,
        subtype: null,
        isError: false,
        payload: { text: item.text },
      };
    case 'tool_use':
      return {
        ...base,
        eventType: 'tool_use',
        toolName: item.name,
        subtype: null,
        isError: false,
        payload: { input: item.input },
      };
    case 'tool_result':
      return {
        ...base,
        eventType: 'tool_result',
        toolName: null,
        subtype: null,
        // Bash (and every) result carries only is_error, no numeric exit code -> isError is
        // the real mechanical signal; default false when the raw key is absent.
        isError: item.is_error ?? false,
        // content may be a string OR an array of raw content blocks; normalize so no raw
        // snake_case key (tool_use_id/is_error) leaks past ingest/ (R3).
        payload: { content: item.content === undefined ? null : normalizeResultContent(item.content) },
      };
    default:
      // thinking is unreachable (filtered above); the exhaustive default keeps TS happy.
      return null;
  }
}

/**
 * Expand a Claude Code transcript into per-content-item NormalizedEvents.
 *
 * A transcript LINE is an envelope; the battle events live INSIDE message.content (an
 * array of items). String content is the kickoff prompt -> one `prompt` event. seqWithin
 * Stream is the kept-event index within this stream (0-based, gap-free, monotonic).
 */
export function normalizeTranscript(
  records: RawTranscriptRecord[],
  streamId: string,
): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];

  for (const record of records) {
    // attachment (deferred_tools_delta) carries no message and is battle-irrelevant.
    if (record.type === 'attachment' || record.message === undefined) {
      continue;
    }

    const provisionalClock = Date.parse(record.timestamp);
    const content = record.message.content;

    if (typeof content === 'string') {
      if (!isAllowed({ kind: 'record', type: 'prompt' })) continue;
      events.push({
        orderKey: { logicalClock: provisionalClock, streamId, seqWithinStream: events.length },
        eventId: record.uuid,
        eventType: 'prompt',
        toolName: null,
        subtype: null,
        timestamp: record.timestamp,
        streamDepth: STREAM_DEPTH,
        exitCode: null,
        isError: false,
        retryCount: RETRY_COUNT,
        payload: { text: content },
      });
      continue;
    }

    content.forEach((item, itemIndex) => {
      const event = normalizeContentItem(
        item,
        record.uuid,
        itemIndex,
        streamId,
        events.length,
        provisionalClock,
        record.timestamp,
      );
      if (event !== null) events.push(event);
    });
  }

  return events.map((event) => NormalizedEventSchema.parse(event));
}

/**
 * Normalize the workflow journal -> NormalizedEvents on the 'orchestrator' stream.
 *
 * Both started + result lifecycle records are kept (they bracket phases). The journal has
 * no timestamp -> timestamp is "" (explicit-empty, NOT a fabricated wall-clock; ordering
 * uses orderKey, never this string). The opaque `key` hash is folded into payload, never
 * leaked as a top-level field (AC3).
 *
 * Provisional logicalClock anchors the journal at its phase boundary (Dev Notes "orderKey
 * derivation"): pass `anchorClock` = an epoch-ms just after the max dev timestamp / before
 * the min fix timestamp so the lifecycle records sort BETWEEN the transcript phases instead
 * of front-loading. The clock is `anchorClock + seqWithinStream`, preserving file order.
 * The epoch range is computed by the caller (the test / Epic-5 harness, which sees every
 * stream) and passed in, keeping this function pure and free of cross-stream coupling.
 * When `anchorClock` is omitted the provisional clock falls back to the self-contained
 * per-stream index (back-compatible with the `normalizeJournal(records)` call); either way
 * the post-merge dense-clock rewrite produces the final gap-free 0..n-1 clock.
 */
export function normalizeJournal(
  records: RawJournalRecord[],
  anchorClock = 0,
): NormalizedEvent[] {
  const streamId = 'orchestrator';
  const events: NormalizedEvent[] = [];

  records.forEach((record) => {
    if (!isAllowed({ kind: 'journal', type: record.type })) return;

    const seqWithinStream = events.length;
    // status/verdict is a useful Interpreter signal: status WHEN it is a string, else
    // verdict when IT is a string, else null. A non-string truthy status (e.g. a number)
    // must NOT slip into the string `subtype` field (it would throw on emission).
    const result = record.result ?? null;
    const subtype =
      typeof result?.status === 'string'
        ? result.status
        : typeof result?.verdict === 'string'
          ? result.verdict
          : null;

    events.push({
      orderKey: { logicalClock: anchorClock + seqWithinStream, streamId, seqWithinStream },
      // started + result share one `key`, so suffix with the record type to keep every
      // emitted eventId unique across the merged timeline (mirrors the transcript
      // `${uuid}#${itemIndex}` scheme). Field-mapping mandates a unique eventId.
      eventId: `${record.key}#${record.type}`,
      eventType: record.type === 'started' ? 'journal_started' : 'journal_result',
      toolName: null,
      subtype,
      timestamp: '',
      streamDepth: STREAM_DEPTH,
      exitCode: null,
      isError: false,
      retryCount: RETRY_COUNT,
      payload: { result, key: record.key },
    });
  });

  return events.map((event) => NormalizedEventSchema.parse(event));
}
