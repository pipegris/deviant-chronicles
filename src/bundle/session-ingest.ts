import type { NormalizedEvent } from '../schema/normalized-event';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';

// Story 5.6 / Task 2 (AC2) — the multi-transcript ingest-assembly helper. The full Story 10.1 session is
// dev + fix transcripts + the journal (multiple transcript streams); build-bundle.ts previously ingested
// ONE transcript + ONE journal. This helper generalizes that to N transcripts. It lives under src/bundle/
// (NOT scripts/) so vitest covers it (the Story 3.2/5.2 thin-script precedent §4): the SCRIPT owns
// readFileSync, this helper owns parse+normalize+merge over ALREADY-READ contents — gate-testable with no
// fs. R3 is honored: ingest/ is still the ONLY raw-JSONL parser (this helper just calls it per stream).
//
// PURE-EXCEPT-DECLARED: no fs / Date.now / Math.random / global-mutable state of its own — it reads the
// raw strings it is given and returns fresh NormalizedEvents (Date.parse over event timestamps is a pure
// string→number transform, the same as normalize.ts). [story Task 2; Dev Notes §3]

// One transcript stream: its raw JSONL text + the stream-id to normalize it under. The script builds this
// from repeated --transcript/--stream-id pairs or a --session-manifest (Task 3); the helper is agnostic.
export interface TranscriptSource {
  transcript: string;
  streamId: string;
}

/**
 * Parse + normalize EACH transcript with its own stream-id, anchor the journal AFTER every transcript
 * phase, and merge `[...allTranscripts, journal]` into ONE orderKey-total-ordered NormalizedEvent[].
 *
 * `devMaxEpoch` is the max parseable timestamp across ALL transcript events (generalizing build-bundle's
 * single-transcript `Math.max(...)`), so the journal's lifecycle records sort after every transcript
 * phase regardless of how many streams there are. `mergeStreams` already takes NormalizedEvent[][] and
 * rewrites logicalClock to a dense 0..n-1 total order (merge.ts §3) — NO merge change is needed.
 *
 * BACKWARD-COMPAT (Hard Invariant 1): a single-element `transcripts` array yields the IDENTICAL list the
 * pre-change build-bundle.ts produced (same devMaxEpoch, same `mergeStreams([transcript, journal])`), so
 * the committed `pnpm bundle:story-10-1` fixture bundle stays byte-identical. Proven in the test.
 *
 * PURE + deterministic: same args → deep-equal output.
 */
export function ingestSession(args: {
  transcripts: ReadonlyArray<{ raw: string; streamId: string }>;
  journalRaw: string;
}): NormalizedEvent[] {
  const allTranscripts: NormalizedEvent[][] = args.transcripts.map(({ raw, streamId }) =>
    normalizeTranscript(parseTranscript(raw, streamId), streamId),
  );

  // The journal anchors just AFTER the latest transcript timestamp across ALL streams (so its lifecycle
  // records never front-load before the dev/fix phases). Flatten then reduce — empty/unparseable
  // timestamps are filtered exactly as build-bundle.ts did (Date.parse → NaN dropped).
  const devMaxEpoch = Math.max(
    ...allTranscripts
      .flat()
      .map((e) => Date.parse(e.timestamp))
      .filter((n) => !Number.isNaN(n)),
  );
  const journal = normalizeJournal(parseJournal(args.journalRaw), devMaxEpoch + 1);

  return mergeStreams([...allTranscripts, journal]);
}
