import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';

// RED-PHASE acceptance test for Story 5.6 — AC2 (multi-stream bundle merge). The testable ingest-
// assembly logic lives under src/bundle/ so vitest covers it (the thin-script precedent §4); the
// script owns readFileSync, the helper owns parse+normalize+merge over ALREADY-READ contents.
//
// It imports the not-yet-authored `./session-ingest` (ingestSession, TranscriptSource), so it ERRORS
// now (RED — module resolution fails) and turns GREEN once the dev authors src/bundle/session-ingest.ts
// per story Task 2. Tests are not Layer-0, so the fs reads are fine.
//
// AC2: ingestSession parses+normalizes EACH transcript with its stream-id and merges
//   [...allTranscripts, journal] into ONE orderKey-total-ordered NormalizedEvent[]. A SINGLE transcript
//   is byte-identical to the current build-bundle.ts inline merge (the committed-bundle guard). A SECOND
//   "fix" transcript merges in on its own stream-id, dense logicalClock 0..n-1, journal after both phases.
import { ingestSession } from './session-ingest';

const INGEST_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'ingest', '__fixtures__');
const BUNDLE_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';
const FIX_STREAM_ID = 'fixstream0001beef';

function readIngestFixture(name: string): string {
  return readFileSync(join(INGEST_FIXTURES, name), 'utf8');
}
function readBundleFixture(name: string): string {
  return readFileSync(join(BUNDLE_FIXTURES, name), 'utf8');
}

const devTranscriptRaw = (): string => readIngestFixture('sample-transcript.jsonl');
const fixTranscriptRaw = (): string => readBundleFixture('sample-fix-transcript.jsonl');
const journalRaw = (): string => readIngestFixture('sample-journal.jsonl');

// The EXACT inline merge build-bundle.ts performs TODAY for a single transcript + journal
// (build-bundle.ts L108-117) — the reference the single-transcript ingestSession path must reproduce
// byte-for-byte (this is what keeps the committed bundle byte-identical, Hard Invariant 1).
function legacySingleTranscriptMerge(): NormalizedEvent[] {
  const transcript = normalizeTranscript(parseTranscript(devTranscriptRaw(), DEV_STREAM_ID), DEV_STREAM_ID);
  const devMaxEpoch = Math.max(
    ...transcript.map((e) => Date.parse(e.timestamp)).filter((n) => !Number.isNaN(n)),
  );
  const journal = normalizeJournal(parseJournal(journalRaw()), devMaxEpoch + 1);
  return mergeStreams([transcript, journal]);
}

// ---------------------------------------------------------------------------------------------------
// AC2 — BACKWARD-COMPAT: a single-element transcripts array reproduces the current inline merge EXACTLY.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.6 AC2 — single-transcript ingestSession is byte-identical to the current build-bundle merge', () => {
  it('deep-equals the legacy inline mergeStreams([transcript, journal]) result', () => {
    const result = ingestSession({
      transcripts: [{ raw: devTranscriptRaw(), streamId: DEV_STREAM_ID }],
      journalRaw: journalRaw(),
    });
    expect(result).toEqual(legacySingleTranscriptMerge());
  });

  it('produces the SAME ordered eventIds the merged committed fixture session carries', () => {
    const result: NormalizedEvent[] = ingestSession({
      transcripts: [{ raw: devTranscriptRaw(), streamId: DEV_STREAM_ID }],
      journalRaw: journalRaw(),
    });
    // The 14 known merged eventIds (the committed-bundle order — dev events then the two journal ids).
    expect(result.map((e) => e.eventId)).toEqual([
      'u-0001',
      'u-0002#1',
      'u-0002#2',
      'u-0003#0',
      'u-0004#0',
      'u-0005#0',
      'u-0006#0',
      'u-0007#0',
      'u-0008#0',
      'u-0009#0',
      'u-0010#0',
      'u-0011#0',
      'phase-dev-OPAQUEHASH-1#started',
      'phase-dev-OPAQUEHASH-1#result',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
// AC2 — MULTI-STREAM: a second "fix" transcript merges into one total order on its own stream-id.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.6 AC2 — multiple transcripts merge into one orderKey-total-ordered session', () => {
  function multiStream(): NormalizedEvent[] {
    return ingestSession({
      transcripts: [
        { raw: devTranscriptRaw(), streamId: DEV_STREAM_ID },
        { raw: fixTranscriptRaw(), streamId: FIX_STREAM_ID },
      ],
      journalRaw: journalRaw(),
    });
  }

  it('includes BOTH the dev and the fix transcript events plus the journal lifecycle records', () => {
    const result = multiStream();
    const ids = new Set(result.map((e) => e.eventId));
    // dev events
    expect(ids.has('u-0001')).toBe(true);
    expect(ids.has('u-0008#0')).toBe(true);
    // fix events (the second transcript) — eventId is `${uuid}#${itemIndex}`, so the Bash tool_use is
    // f-0002#0 (NOT the raw tool_use.id `f-bash-1`), mirroring the dev stream's u-0008#0.
    expect(ids.has('f-0001')).toBe(true);
    expect(ids.has('f-0002#0')).toBe(true);
    // journal
    expect(ids.has('phase-dev-OPAQUEHASH-1#result')).toBe(true);
  });

  it('preserves each stream-id as origin provenance in orderKey.streamId', () => {
    const result = multiStream();
    const dev = result.find((e) => e.eventId === 'u-0001');
    const fix = result.find((e) => e.eventId === 'f-0001');
    const journal = result.find((e) => e.eventId === 'phase-dev-OPAQUEHASH-1#result');
    expect(dev?.orderKey.streamId).toBe(DEV_STREAM_ID);
    expect(fix?.orderKey.streamId).toBe(FIX_STREAM_ID);
    expect(journal?.orderKey.streamId).toBe('orchestrator');
  });

  it('rewrites logicalClock to a dense 0..n-1 total order (the merge invariant)', () => {
    const result = multiStream();
    expect(result.map((e) => e.orderKey.logicalClock)).toEqual(result.map((_, i) => i));
  });

  it('anchors the journal AFTER both transcript phases (dev + fix come before the journal ids)', () => {
    const result = multiStream();
    const lastFixIndex = result.findIndex((e) => e.eventId === 'f-0003#0');
    const journalStartIndex = result.findIndex((e) => e.eventId === 'phase-dev-OPAQUEHASH-1#started');
    expect(lastFixIndex).toBeGreaterThanOrEqual(0);
    expect(journalStartIndex).toBeGreaterThan(lastFixIndex);
  });

  it('every eventId is unique across the merged streams (no collision between dev/fix/journal)', () => {
    const ids = multiStream().map((e) => e.eventId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the multi-stream result is strictly larger than the single-transcript result', () => {
    const single = ingestSession({
      transcripts: [{ raw: devTranscriptRaw(), streamId: DEV_STREAM_ID }],
      journalRaw: journalRaw(),
    });
    expect(multiStream().length).toBeGreaterThan(single.length);
  });
});

// ---------------------------------------------------------------------------------------------------
// AC2 — determinism: ingestSession is pure (same input -> deep-equal output).
// ---------------------------------------------------------------------------------------------------

describe('Story 5.6 AC2 — ingestSession is deterministic', () => {
  it('two calls over the same args are deep-equal (single-transcript)', () => {
    const args = {
      transcripts: [{ raw: devTranscriptRaw(), streamId: DEV_STREAM_ID }],
      journalRaw: journalRaw(),
    };
    expect(ingestSession(args)).toEqual(ingestSession(args));
  });

  it('two calls over the same args are deep-equal (multi-transcript)', () => {
    const args = {
      transcripts: [
        { raw: devTranscriptRaw(), streamId: DEV_STREAM_ID },
        { raw: fixTranscriptRaw(), streamId: FIX_STREAM_ID },
      ],
      journalRaw: journalRaw(),
    };
    expect(ingestSession(args)).toEqual(ingestSession(args));
  });
});

// ---------------------------------------------------------------------------------------------------
// AC2 / AC3 (Hard Invariant 1 + 2) — the FIXTURE bundle's content address is UNCHANGED. The multi-
// stream + reduced-view work is purely additive: the single-transcript path that produces the FIXTURE
// bundle must keep emitting the SAME annotationHash. This guards the byte-identical fixture build from
// a refactor regression.
//
// Story 5.9 re-point: this guard moved from the SHIPPED public/bundles/story-10-1.json to the dedicated
// FIXTURE bundle (src/render/__fixtures__/fixture-bundle.json). Since the Story 5.7/5.8 publish, the
// shipped artifact is the FROZEN REAL-session bundle (a DIFFERENT annotationHash, frozen-once); the
// FIXTURE bundle is the stable reference the mocked `pnpm bundle:story-10-1` reproduces, so it is what
// must keep the c10c15aa content address.
// ---------------------------------------------------------------------------------------------------

const FIXTURE_BUNDLE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'render',
  '__fixtures__',
  'fixture-bundle.json',
);

// The annotationHash of the mocked fixture build (Story 5.5 HEAD value). The multi-stream/reduced-view
// work is bake-INPUT only; it must NOT move this content address (AC3, Hard Invariant 2).
const FIXTURE_ANNOTATION_HASH = 'c10c15aa86e16bee87ffb548f47b457dda84b441ad01d19911a480369496442f';

describe('Story 5.6 AC3 — the fixture bundle annotationHash is unchanged from HEAD', () => {
  it('the fixture bundle still carries the HEAD annotationHash (the mocked-build content address)', () => {
    const bundle = JSON.parse(readFileSync(FIXTURE_BUNDLE, 'utf8')) as { annotationHash?: string };
    expect(bundle.annotationHash).toBe(FIXTURE_ANNOTATION_HASH);
  });
});
