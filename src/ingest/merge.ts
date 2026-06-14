import type { NormalizedEvent } from '../schema/normalized-event';

// PURE merge of the per-stream NormalizedEvent[] into a single total order (AC2). No fs /
// Date.now / Math.random (R2). The order key is the composite (logicalClock, streamId,
// seqWithinStream) — wall-clock alone is NEVER the key. The comparator is TOTAL (all three
// keys compared, never 0 for distinct events), so the result does not rely on Array.sort
// stability.

function compareOrderKey(a: NormalizedEvent, b: NormalizedEvent): number {
  const ak = a.orderKey;
  const bk = b.orderKey;
  if (ak.logicalClock !== bk.logicalClock) return ak.logicalClock - bk.logicalClock;
  if (ak.streamId !== bk.streamId) return ak.streamId < bk.streamId ? -1 : 1;
  return ak.seqWithinStream - bk.seqWithinStream;
}

/**
 * Concatenate every stream and sort into one total order by the composite key, then rewrite
 * logicalClock to the dense 0..n-1 merged index so the downstream timeline has a gap-free
 * monotonic clock (the Pacer/Model advance by it). streamId + seqWithinStream are preserved
 * as origin provenance.
 *
 * PURE and non-mutating: inputs are copied and fresh event objects are returned, so a second
 * run over the same inputs yields a byte-identical list (determinism, AC1).
 */
export function mergeStreams(streams: NormalizedEvent[][]): NormalizedEvent[] {
  const concatenated = streams.flat();
  const sorted = [...concatenated].sort(compareOrderKey);

  return sorted.map((event, index) => ({
    ...event,
    orderKey: {
      logicalClock: index,
      streamId: event.orderKey.streamId,
      seqWithinStream: event.orderKey.seqWithinStream,
    },
  }));
}
