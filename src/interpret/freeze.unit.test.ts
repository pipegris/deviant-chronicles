import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type NormalizedEvent } from '../schema/normalized-event';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';
import { type BeatAnnotation } from '../schema/beat-annotation';
import { canonicalJSON, annotationHash, freezeAnnotations } from './freeze';

// Story 3.2 — focused UNIT tests for freeze.ts edges NOT covered by the ATDD freeze.test.ts:
// the hash is independent of the annotations (it is over events+versions), an empty annotation
// set freezes fine, and canonicalJSON's primitive/null handling.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'ingest', '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

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

const INTERPRETER_VERSION = 'claude-sonnet-4-6/v1';
const PROMPT_VERSION = 'beat-tag-v1';

describe('Story 3.2 — annotationHash is over the INPUTS (events+versions), not the annotations', () => {
  it('an empty annotation set freezes with the same hash as the standalone annotationHash', () => {
    const events = runIngest();
    const frozen = freezeAnnotations({
      normalizedEvents: events,
      annotations: [],
      interpreterVersion: INTERPRETER_VERSION,
      promptVersion: PROMPT_VERSION,
    });
    expect(frozen.annotations).toEqual([]);
    expect(frozen.annotationHash).toBe(
      annotationHash({
        normalizedEvents: events,
        interpreterVersion: INTERPRETER_VERSION,
        promptVersion: PROMPT_VERSION,
      }),
    );
  });
});

describe('Story 3.2 — canonicalJSON handles primitives + null', () => {
  it('serializes primitives and null like JSON.stringify', () => {
    expect(canonicalJSON(null)).toBe('null');
    expect(canonicalJSON(42)).toBe('42');
    expect(canonicalJSON('a')).toBe('"a"');
    expect(canonicalJSON(true)).toBe('true');
  });

  it('preserves explicit null inside a sorted object (null vs absent stays stable)', () => {
    expect(canonicalJSON({ b: null, a: 1 })).toBe('{"a":1,"b":null}');
  });
});

describe('Story 3.2 (F4) — canonicalJSON fails LOUD on undefined (a content-address footgun)', () => {
  it('throws on a top-level undefined', () => {
    expect(() => canonicalJSON(undefined)).toThrow(/undefined/);
  });

  it('throws on undefined nested in an object (would silently collapse to absent)', () => {
    expect(() => canonicalJSON({ a: 1, b: undefined })).toThrow(/undefined/);
  });

  it('throws on undefined nested in an array (would silently coerce to null)', () => {
    expect(() => canonicalJSON([1, undefined, 2])).toThrow(/undefined/);
  });
});

describe('Story 3.2 (F5) — freezeAnnotations rejects a dangling grounding ref', () => {
  const INTERPRETER_VERSION = 'claude-sonnet-4-6/v1';
  const PROMPT_VERSION = 'beat-tag-v1';

  function annot(eventRef: string, eventRefs: string[]): BeatAnnotation {
    return {
      eventRef,
      beatType: 'dispel',
      confidence: 0.8,
      interpreterVersion: INTERPRETER_VERSION,
      sourceHash: 'x',
      groundingPointer: { eventRefs },
    };
  }

  it('throws when an annotation eventRef is not a normalizedEvents eventId', () => {
    const events = runIngest();
    expect(() =>
      freezeAnnotations({
        normalizedEvents: events,
        annotations: [annot('GHOST-EVENT', ['u-0002#1'])],
        interpreterVersion: INTERPRETER_VERSION,
        promptVersion: PROMPT_VERSION,
      }),
    ).toThrow(/dangling ref/);
  });

  it('throws when a groundingPointer.eventRefs member is not a normalizedEvents eventId', () => {
    const events = runIngest();
    expect(() =>
      freezeAnnotations({
        normalizedEvents: events,
        annotations: [annot('u-0002#1', ['u-0002#1', 'GHOST-REF'])],
        interpreterVersion: INTERPRETER_VERSION,
        promptVersion: PROMPT_VERSION,
      }),
    ).toThrow(/dangling ref/);
  });

  it('freezes cleanly when every ref resolves to a fixture eventId', () => {
    const events = runIngest();
    const frozen = freezeAnnotations({
      normalizedEvents: events,
      annotations: [annot('u-0002#1', ['u-0002#1', 'u-0002#2', 'u-0003#0'])],
      interpreterVersion: INTERPRETER_VERSION,
      promptVersion: PROMPT_VERSION,
    });
    expect(frozen.annotations).toHaveLength(1);
  });
});
