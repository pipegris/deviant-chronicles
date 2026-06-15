import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BeatAnnotationSchema, type BeatAnnotation } from '../schema/beat-annotation';
import { type NormalizedEvent } from '../schema/normalized-event';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';
import { FixtureInterpreter } from './fixture-interpreter';

// RED-PHASE acceptance test for Story 3.2 — AC2: the PURE freeze + content-address logic.
// It imports the not-yet-authored `./freeze` (canonicalJSON, annotationHash, freezeAnnotations,
// FrozenAnnotations), so it ERRORS now (RED — module resolution fails); turns GREEN when the dev
// authors src/interpret/freeze.ts.
//
// AC2 (verbatim, epics.md#Story-3.2): "Given the produced annotations When frozen Then they are
// content-addressed via annotationHash = sha256(normalizedEvents + interpreterVersion +
// promptVersion) and baked into the ReplayBundle; re-running with identical inputs yields the same
// hash."
import { canonicalJSON, annotationHash, freezeAnnotations, type FrozenAnnotations } from './freeze';

// --- Real fixture inputs: drive the ingest pipeline for the 14 NormalizedEvents, and the
// FixtureInterpreter for a valid BeatAnnotation[] to freeze (Dev Notes: "no need to hand-fabricate").
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

async function fixtureAnnotations(): Promise<BeatAnnotation[]> {
  return new FixtureInterpreter().interpret(runIngest());
}

const INTERPRETER_VERSION = 'claude-sonnet-4-6/v1';
const PROMPT_VERSION = 'beat-tag-v1';

describe('Story 3.2 / AC2 — canonicalJSON is key-order-stable (canonical serialization)', () => {
  it('produces identical output regardless of object key insertion order', () => {
    expect(canonicalJSON({ b: 1, a: 2 })).toBe(canonicalJSON({ a: 2, b: 1 }));
  });

  it('recursively sorts nested object keys', () => {
    const x = canonicalJSON({ outer: { z: 1, a: 2 }, first: true });
    const y = canonicalJSON({ first: true, outer: { a: 2, z: 1 } });
    expect(x).toBe(y);
  });

  it('PRESERVES array order (order is meaningful for events/annotations)', () => {
    // Only object KEYS are sorted; arrays must keep their order — flipping it must change output.
    expect(canonicalJSON([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJSON([3, 1, 2])).not.toBe(canonicalJSON([1, 2, 3]));
  });
});

describe('Story 3.2 / AC2 — annotationHash is deterministic over identical inputs', () => {
  it('returns equal hex strings for two calls with the same inputs', () => {
    const events = runIngest();
    const a = annotationHash({ normalizedEvents: events, interpreterVersion: INTERPRETER_VERSION, promptVersion: PROMPT_VERSION });
    const b = annotationHash({ normalizedEvents: events, interpreterVersion: INTERPRETER_VERSION, promptVersion: PROMPT_VERSION });
    expect(a).toBe(b);
    // A hex sha256 is 64 lowercase hex chars.
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is invariant to object-key reordering within the events (canonicality, not insertion order)', () => {
    const events = runIngest();
    // Re-serialize each event through a key-shuffled JSON round-trip; the hash must be unchanged
    // because canonicalJSON sorts keys before hashing.
    const reordered = events.map((e) => {
      const entries = Object.entries(e).reverse();
      return Object.fromEntries(entries) as unknown as NormalizedEvent;
    });
    const a = annotationHash({ normalizedEvents: events, interpreterVersion: INTERPRETER_VERSION, promptVersion: PROMPT_VERSION });
    const b = annotationHash({ normalizedEvents: reordered, interpreterVersion: INTERPRETER_VERSION, promptVersion: PROMPT_VERSION });
    expect(b).toBe(a);
  });
});

describe('Story 3.2 / AC2 — annotationHash is a GOLDEN content address (pins the absolute digest)', () => {
  // The relative determinism assertions above (equal-for-same / different-for-changed) all stay
  // green even if the hash COMPOSITION silently drifts — e.g. swapping canonicalJSON for plain
  // JSON.stringify, reordering the hashed triple, or changing the digest algorithm — as long as the
  // result stays deterministic + order-sensitive. This golden pins the EXACT digest over the
  // committed 14-event fixture + the default versions, so any such drift fails LOUD. It mirrors how
  // Layer-0 determinism is anchored by committed golden snapshots (src/pace + src/ingest). If the
  // ingest fixture legitimately changes, re-bless this snapshot together with those.
  it('matches the committed digest for the fixture events + default versions', () => {
    const hash = annotationHash({
      normalizedEvents: runIngest(),
      interpreterVersion: INTERPRETER_VERSION,
      promptVersion: PROMPT_VERSION,
    });
    expect(hash).toMatchInlineSnapshot(`"94bee47b5bc1eb1da877e473cfab1903de4a81e871effe1397951f6c06105a1b"`);
  });
});

describe('Story 3.2 / AC2 — a changed input yields a DIFFERENT hash (the headline proof)', () => {
  it('flips when ONE event field changes', () => {
    const events = runIngest();
    const base = annotationHash({ normalizedEvents: events, interpreterVersion: INTERPRETER_VERSION, promptVersion: PROMPT_VERSION });
    const mutated = events.map((e, i) => (i === 0 ? { ...e, eventId: `${e.eventId}-CHANGED` } : e));
    const next = annotationHash({ normalizedEvents: mutated, interpreterVersion: INTERPRETER_VERSION, promptVersion: PROMPT_VERSION });
    expect(next).not.toBe(base);
  });

  it('flips when interpreterVersion changes', () => {
    const events = runIngest();
    const base = annotationHash({ normalizedEvents: events, interpreterVersion: INTERPRETER_VERSION, promptVersion: PROMPT_VERSION });
    const next = annotationHash({ normalizedEvents: events, interpreterVersion: 'claude-opus-4-8/v1', promptVersion: PROMPT_VERSION });
    expect(next).not.toBe(base);
  });

  it('flips when promptVersion changes', () => {
    const events = runIngest();
    const base = annotationHash({ normalizedEvents: events, interpreterVersion: INTERPRETER_VERSION, promptVersion: PROMPT_VERSION });
    const next = annotationHash({ normalizedEvents: events, interpreterVersion: INTERPRETER_VERSION, promptVersion: 'beat-tag-v2' });
    expect(next).not.toBe(base);
  });
});

describe('Story 3.2 / AC2 — freezeAnnotations returns the bundle-ready frozen slice', () => {
  it('carries annotations + annotationHash + the two versions that produced them', async () => {
    const events = runIngest();
    const annotations = await fixtureAnnotations();
    const frozen: FrozenAnnotations = freezeAnnotations({
      normalizedEvents: events,
      annotations,
      interpreterVersion: INTERPRETER_VERSION,
      promptVersion: PROMPT_VERSION,
    });
    expect(frozen.annotations).toEqual(annotations);
    expect(frozen.interpreterVersion).toBe(INTERPRETER_VERSION);
    expect(frozen.promptVersion).toBe(PROMPT_VERSION);
    // The hash is the SAME as the standalone annotationHash over the same triple (over the EVENTS
    // + versions — NOT the annotations).
    expect(frozen.annotationHash).toBe(
      annotationHash({ normalizedEvents: events, interpreterVersion: INTERPRETER_VERSION, promptVersion: PROMPT_VERSION }),
    );
  });

  it('does NOT duplicate normalizedEvents into the frozen slice (they live at ReplayBundle top level)', async () => {
    const frozen = freezeAnnotations({
      normalizedEvents: runIngest(),
      annotations: await fixtureAnnotations(),
      interpreterVersion: INTERPRETER_VERSION,
      promptVersion: PROMPT_VERSION,
    });
    expect(Object.prototype.hasOwnProperty.call(frozen, 'normalizedEvents')).toBe(false);
  });
});

describe('Story 3.2 / AC2 (NFR-2) — frozen-then-reloaded is byte-stable across serialize/parse', () => {
  it('survives a JSON.stringify -> JSON.parse round-trip with identical hash + deep-equal annotations', async () => {
    const events = runIngest();
    const annotations = await fixtureAnnotations();
    const args = { normalizedEvents: events, annotations, interpreterVersion: INTERPRETER_VERSION, promptVersion: PROMPT_VERSION };

    const first = freezeAnnotations(args);
    const reloaded = JSON.parse(JSON.stringify(first)) as FrozenAnnotations;

    // Re-freeze from the reloaded annotations + the same inputs → byte-stable artifact.
    const refrozen = freezeAnnotations({
      normalizedEvents: events,
      annotations: reloaded.annotations.map((a: BeatAnnotation) => ({ ...a })),
      interpreterVersion: reloaded.interpreterVersion,
      promptVersion: reloaded.promptVersion,
    });
    expect(refrozen.annotationHash).toBe(first.annotationHash);
    expect(refrozen.annotations).toEqual(first.annotations);
  });
});

describe('Story 3.2 / AC2 — every frozen annotation is schema-valid + its grounding resolves', () => {
  it('parses each frozen annotation and resolves every eventRef/groundingPointer to a fixture id', async () => {
    const events = runIngest();
    const ids = new Set(events.map((e) => e.eventId));
    const frozen = freezeAnnotations({
      normalizedEvents: events,
      annotations: await fixtureAnnotations(),
      interpreterVersion: INTERPRETER_VERSION,
      promptVersion: PROMPT_VERSION,
    });
    expect(frozen.annotations.length).toBeGreaterThan(0);
    for (const a of frozen.annotations) {
      expect(() => BeatAnnotationSchema.parse(a)).not.toThrow();
      expect(ids.has(a.eventRef)).toBe(true);
      for (const ref of a.groundingPointer.eventRefs) {
        expect(ids.has(ref)).toBe(true);
      }
    }
  });
});

describe('Story 3.2 / AC2 — freeze.ts is SDK-free + clock/RNG-free (source-grep, mirrors 3.1)', () => {
  // freeze.ts MUST NOT import @anthropic-ai/sdk — it is the browser-cleanable, independently
  // testable determinism core (only claude-interpreter.ts + scripts/ touch the SDK). It is also
  // PURE: no clock/RNG (node:crypto is the only Node builtin it may use). Mirrors
  // fixture-interpreter.test.ts L121-141.
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'freeze.ts'), 'utf8');

  it('does not import @anthropic-ai/sdk (the determinism core stays SDK-free)', () => {
    expect(source).not.toContain('@anthropic-ai/sdk');
  });

  it('does not read a clock or RNG (Date.now / Math.random / performance.now)', () => {
    expect(source).not.toContain('Date.now');
    expect(source).not.toContain('Math.random');
    expect(source).not.toContain('performance.now');
  });
});
