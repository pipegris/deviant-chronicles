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

// RED-PHASE acceptance test for Story 3.1 — AC1: the BeatInterpreter interface +
// the deterministic FixtureInterpreter double. It imports the not-yet-authored
// `./beat-interpreter` (interface) and `./fixture-interpreter` (the CI double), so it
// ERRORS now (RED — module resolution fails); turns GREEN when the dev authors them.
//
// AC1 (verbatim, epics.md#Story-3.1): "Given the interpret/ module When the interface is
// defined Then BeatInterpreter produces BeatAnnotation[] and a FixtureInterpreter returns
// fixed annotations for the test fixture with no network call."
import type { BeatInterpreter } from './beat-interpreter';
import { FixtureInterpreter } from './fixture-interpreter';

// --- The events input is built by driving the REAL ingest pipeline over the committed
// fixtures (story-specific: "CONSUME the ingest fixture's NormalizedEvent[]"), so the
// eventIds the FixtureInterpreter anchors to are the SAME 14 the rest of the system sees.
// `runIngest`/`readFixture` are copied verbatim from src/ingest/ingest.test.ts L16-37.
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

describe('Story 3.1 / AC1 — FixtureInterpreter implements the BeatInterpreter interface', () => {
  it('is structurally assignable to BeatInterpreter (typecheck-level conformance proof)', () => {
    // This binding is the structural-conformance proof: it fails `pnpm typecheck` if the
    // FixtureInterpreter shape drifts from the interface contract.
    const interp: BeatInterpreter = new FixtureInterpreter();
    expect(interp).toBeDefined();
    expect(typeof interp.interpret).toBe('function');
  });

  it('produces a BeatAnnotation[] (the interface return contract)', async () => {
    const interp: BeatInterpreter = new FixtureInterpreter();
    const annotations = await interp.interpret(runIngest());
    expect(Array.isArray(annotations)).toBe(true);
  });
});

describe('Story 3.1 / AC1 — every emitted annotation is BeatAnnotationSchema-valid', () => {
  it('parses each returned annotation without throwing (validated emission)', async () => {
    // Mirrors ingest.test.ts L140-144's validated-emission test against the Layer-1 contract.
    const annotations = await new FixtureInterpreter().interpret(runIngest());
    for (const a of annotations) {
      expect(() => BeatAnnotationSchema.parse(a)).not.toThrow();
    }
  });
});

describe('Story 3.1 / AC1 — the fixture emits exactly the authored Dispel + Shaman beats', () => {
  it('returns exactly two annotations and omits summon by design', async () => {
    // The thin redacted fixture has no sub-agent-spawn event, so a Summon would be a FALSE
    // grounding; the fixture authors only the two beats it genuinely supports (Dev Notes
    // "Why a Dispel + Shaman and NOT a Summon"). The omission is asserted, not an oversight.
    const annotations = await new FixtureInterpreter().interpret(runIngest());
    expect(annotations).toHaveLength(2);
    const types = annotations.map((a: BeatAnnotation) => a.beatType).sort();
    expect(types).toEqual(['dispel', 'shaman']);
    expect(annotations.some((a: BeatAnnotation) => a.beatType === 'summon')).toBe(false);
  });

  it('anchors the Dispel at u-0002#1 with the assumption+ground-truth-Read grounding', async () => {
    const annotations = await new FixtureInterpreter().interpret(runIngest());
    const dispel = annotations.find((a: BeatAnnotation) => a.beatType === 'dispel');
    expect(dispel).toBeDefined();
    expect(dispel?.eventRef).toBe('u-0002#1');
    expect(dispel?.groundingPointer.eventRefs).toEqual(['u-0002#1', 'u-0002#2', 'u-0003#0']);
  });

  it('anchors the Shaman at u-0010#0 with the failing-result+diagnostic-Read grounding', async () => {
    const annotations = await new FixtureInterpreter().interpret(runIngest());
    const shaman = annotations.find((a: BeatAnnotation) => a.beatType === 'shaman');
    expect(shaman).toBeDefined();
    expect(shaman?.eventRef).toBe('u-0010#0');
    expect(shaman?.groundingPointer.eventRefs).toEqual(['u-0009#0', 'u-0010#0']);
  });

  it('carries a fixed fixture provenance on every annotation (confidence in [0,1], fixture-v1)', async () => {
    const annotations = await new FixtureInterpreter().interpret(runIngest());
    for (const a of annotations) {
      expect(a.confidence).toBeGreaterThanOrEqual(0);
      expect(a.confidence).toBeLessThanOrEqual(1);
      expect(a.interpreterVersion).toBe('fixture-v1');
      expect(a.sourceHash).toBe('fixture');
    }
  });
});

describe('Story 3.1 / AC1 — the double is deterministic (no clock / no RNG)', () => {
  it('returns byte-identical annotations across repeated calls', async () => {
    // A leaked Date.now()/Math.random() would flip this. Two independent calls must deep-equal.
    const interp = new FixtureInterpreter();
    const first = await interp.interpret(runIngest());
    const second = await interp.interpret(runIngest());
    expect(first).toEqual(second);
  });
});

describe('Story 3.1 / AC1 — the double is offline (no network call): source-grep proof', () => {
  // The strongest available headless proof of "no network call": the module source imports
  // nothing from the SDK / node / I/O and reads no clock or RNG. Tests are NOT Layer-0
  // modules, so reading the source with fs here is fine (ingest.test.ts L1-21 precedent).
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixture-interpreter.ts'), 'utf8');

  it('does not import @anthropic-ai/sdk (R4-for-the-double — the LLM is never called in CI)', () => {
    expect(source).not.toContain('@anthropic-ai/sdk');
  });

  it('does not read a clock or RNG (Date.now / Math.random / performance.now)', () => {
    expect(source).not.toContain('Date.now');
    expect(source).not.toContain('Math.random');
    expect(source).not.toContain('performance.now');
  });

  it('does not import node: builtins or fs (no I/O in the deterministic double)', () => {
    expect(source).not.toMatch(/from\s+['"]node:/);
    expect(source).not.toMatch(/from\s+['"]fs['"]/);
    expect(source).not.toMatch(/require\(\s*['"](node:|fs)/);
  });
});
