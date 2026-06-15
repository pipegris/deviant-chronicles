import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReplayBundleSchema } from '../schema/replay-bundle';

// RED-PHASE acceptance test for Story 5.5 — Task 5 / AC1 + AC2: the COMMITTED public/bundles/
// story-10-1.json is the payload-free, name-free artifact.
//
// It FAILS now (RED) because the committed bundle is Story 5.2's output: it ships `normalizedEvents`
// with FULL payloads carrying raw content + raw file paths/names (verified directly — story §0). It
// turns GREEN when the dev (Task 5) re-runs `pnpm bundle:story-10-1` to regenerate the file in the
// NEW payload-free shape (`projectedEvents`, no `normalizedEvents`) and stages it.
//
// AC1: per-event data is the minimal payload-free projection. AC2: byte-level absence proof — the
// serialized bundle contains NONE of the fixture's known raw content strings AND none of its raw file
// paths/names (grep-absent), and per-event size is bounded small.
//
// Reading the committed file in a node test is fine (tests are not Layer-0).

function committedBundlePath(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'public',
    'bundles',
    'story-10-1.json',
  );
}

function committedBundleText(): string {
  return readFileSync(committedBundlePath(), 'utf8');
}

function committedBundleRaw(): unknown {
  return JSON.parse(committedBundleText());
}

// The KNOWN raw strings the Story 5.2 bundle ships today (verified in public/bundles/story-10-1.json) —
// the EXACT leak surface AC1/AC2 must remove. Raw content + raw absolute paths + raw bare file names.
const KNOWN_RAW_CONTENT: readonly string[] = [
  'Kickoff: implement the ingest pipeline for Story 10.1.',
  'I will start by reading the schema then editing the parser.',
  'export const NormalizedEventSchema = ...',
  'export function parseTranscript() {}',
  'File created.',
  'Edit applied.',
  'export function normalizeTranscript() {}',
  'nested raw payload',
];

const KNOWN_RAW_PATHS: readonly string[] = [
  '/work/project/src/schema/normalized-event.ts',
  '/work/project/src/ingest/parse-transcript.ts',
  '/work/project/src/ingest/normalize.ts',
  '/work/project',
];

const KNOWN_RAW_NAMES: readonly string[] = [
  'normalized-event.ts',
  'parse-transcript.ts',
  'normalize.ts',
];

const PROJECTED_KEYS = ['orderKey', 'eventId', 'eventType', 'toolName', 'outcome', 'role'].sort();

// ---------------------------------------------------------------------------------------------------
// AC1 — the committed bundle parses against the (updated) schema and ships projectedEvents.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC1 — the committed story-10-1.json is the payload-free, projected shape', () => {
  it('parses against ReplayBundleSchema (the updated public shape)', () => {
    expect(() => ReplayBundleSchema.parse(committedBundleRaw())).not.toThrow();
  });

  it('carries a non-empty `projectedEvents` array and NO `normalizedEvents` key', () => {
    const bundle = committedBundleRaw() as Record<string, unknown>;
    expect(Array.isArray(bundle.projectedEvents)).toBe(true);
    expect((bundle.projectedEvents as unknown[]).length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(bundle, 'normalizedEvents')).toBe(false);
  });

  it('every projected event is the five-key payload-free projection (no payload/content field)', () => {
    const bundle = committedBundleRaw() as { projectedEvents: ReadonlyArray<Record<string, unknown>> };
    for (const p of bundle.projectedEvents) {
      expect(Object.keys(p).sort()).toEqual(PROJECTED_KEYS);
      expect(Object.prototype.hasOwnProperty.call(p, 'payload')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(p, 'content')).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// AC2 — BYTE-LEVEL ABSENCE: the serialized committed bundle is grep-absent of every known raw content
// string AND every raw path/name. This is the load-bearing privacy proof on the SHIPPED artifact.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC2 — the committed bundle is grep-absent of raw content AND raw paths/names', () => {
  const text = (): string => committedBundleText();

  it('contains NONE of the known raw CONTENT strings', () => {
    const serialized = text();
    for (const needle of KNOWN_RAW_CONTENT) {
      expect(serialized).not.toContain(needle);
    }
  });

  it('contains NONE of the known raw absolute PATHS', () => {
    const serialized = text();
    for (const needle of KNOWN_RAW_PATHS) {
      expect(serialized).not.toContain(needle);
    }
  });

  it('contains NONE of the known raw bare file NAMES', () => {
    const serialized = text();
    for (const needle of KNOWN_RAW_NAMES) {
      expect(serialized).not.toContain(needle);
    }
  });

  it('carries no per-event `payload` field anywhere in the serialized artifact', () => {
    expect(text()).not.toContain('"payload"');
  });
});

// ---------------------------------------------------------------------------------------------------
// AC2 — bounded per-event size: each projected event serializes under a small byte cap.
// ---------------------------------------------------------------------------------------------------

describe('Story 5.5 AC2 — each committed projected event is bounded small (≤ 400 bytes/event)', () => {
  it('every projectedEvents entry serializes under the documented per-event byte cap', () => {
    const bundle = committedBundleRaw() as { projectedEvents: ReadonlyArray<unknown> };
    for (const p of bundle.projectedEvents) {
      const bytes = Buffer.byteLength(JSON.stringify(p), 'utf8');
      expect(bytes).toBeLessThanOrEqual(400);
    }
  });
});
