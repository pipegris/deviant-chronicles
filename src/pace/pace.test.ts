import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { TranslatedAction } from '../translate/translated-action';

// RED-PHASE acceptance tests for Story 1.5 (Tasks 5-8) — the pure Pace stage: TranslatedAction[]
// in, a typed BattleTimeline out, driven entirely by src/config/pacing-weights.json +
// window-config.json. These FAIL until src/pace/derive-beats.ts exports the top-level `pace()`
// (and the score/window/config modules it composes) exist. The import error is the intended red.
//
// Pipeline reuse: we read the COMMITTED ingest fixtures with fs IN THE TEST (tests are not
// Layer-0 modules, so this respects R2) and run the SAME parse -> normalize -> merge chain as
// src/ingest/ingest.test.ts and src/translate/translate.test.ts, then translate() -> pace().
// This is the EXACT merged ordering the ingest snapshot pins, so the BattleTimeline is stable.
//
// THE GOLDEN SNAPSHOT is the Epic-1 / NFR-2 determinism anchor: src/pace/__snapshots__/
// pace.test.ts.snap. It does NOT exist yet (the dir holds only .gitkeep). Vitest writes it on
// the first GREEN run and asserts byte-for-byte on every run after — any leaked nondeterminism
// (a clock, unstable key order, an unintended config edit) flips it LOUD. The implementing dev
// generates + commits it; in this red phase the file errors before any snapshot is written.
import { pace, deriveBeats } from './derive-beats';
import { scoreEvent } from './score-event';
import { windowEvents } from './window-events';
import type { ScoredAction } from './pace-types';
import { translate } from '../translate/translate';
import { BattleTimelineSchema } from '../schema/battle-timeline';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';
// Static, Vite-bundled JSON imports (resolveJsonModule is on) — the SAME way pacing-config.ts
// will import them. These are committed-config deliverables of this story; until the dev
// creates them the import fails meaningfully (the red signal also covers the config files).
import rawWeights from '../config/pacing-weights.json';
import rawWindow from '../config/window-config.json';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'ingest', '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

// Copied verbatim from src/translate/translate.test.ts L32-42 (which mirrors ingest.test.ts) so
// pace() consumes the EXACT merged ordering the committed ingest snapshot pins — including the
// devMaxEpoch+1 journal anchor that orders the orchestrator stream after the dev stream.
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

function actions(): TranslatedAction[] {
  return translate(runIngest());
}

describe('Story 1.5 AC3/Task7 — the GOLDEN BattleTimeline snapshot (the NFR-2 determinism anchor)', () => {
  it('pace(translate(runIngest())) matches the committed golden snapshot', () => {
    // Writes src/pace/__snapshots__/pace.test.ts.snap on first GREEN run; asserts byte-for-byte
    // thereafter. This is the FULL-pipeline determinism guard (the ingest snapshot is the
    // stage-level one). Any nondeterministic change flips it loud.
    expect(pace(actions())).toMatchSnapshot();
  });

  it('a second pace() run over the same input is byte-identical (R2 determinism)', () => {
    expect(JSON.stringify(pace(actions()))).toBe(JSON.stringify(pace(actions())));
  });

  it('pace() does not mutate its input actions array (fresh objects, no input mutation)', () => {
    const input = actions();
    const before = JSON.stringify(input);
    pace(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('Story 1.5 Task5 — the emitted artifact is a schema-valid BattleTimeline', () => {
  it('the result parses against the committed BattleTimelineSchema (boundary-validated output)', () => {
    expect(() => BattleTimelineSchema.parse(pace(actions()))).not.toThrow();
  });

  it('schemaVersion is 1 and totalDurationMs === sum(beat.dwellMs)', () => {
    const tl = pace(actions());
    expect(tl.schemaVersion).toBe(1);
    const sum = tl.beats.reduce((s, b) => s + b.dwellMs, 0);
    expect(tl.totalDurationMs).toBe(sum);
  });

  it('every Beat carries MECHANICS ONLY — no beatType/confidence/isMontage/isMirage label (R1)', () => {
    // Assert keys on the PRE-PARSE deriveBeats() output, NOT pace()'s post-parse beats: BeatSchema
    // is a plain (non-.strict()) z.object, so BattleTimelineSchema.parse silently STRIPS unknown
    // keys. Checking pace().beats would let a stray beatType/isMontage label added in deriveBeats
    // slip past (parse drops it before the assertion). Building the beats directly here means an
    // accidental interpretation field fails LOUD before the parse can hide it (R1 leak guard).
    const acts = actions();
    const scored: ScoredAction[] = acts.map((a) => ({ ...a, weight: scoreEvent(a) }));
    const beats = deriveBeats(windowEvents(scored));
    expect(beats.length).toBeGreaterThan(0);
    for (const b of beats) {
      expect(Object.keys(b).sort()).toEqual(
        ['actionType', 'dwellMs', 'orderKey', 'sourceEventIds', 'weight'].sort(),
      );
    }
  });

  it('empty input -> an empty, valid timeline { schemaVersion:1, beats:[], totalDurationMs:0 }', () => {
    const tl = pace([]);
    expect(tl).toEqual({ schemaVersion: 1, beats: [], totalDurationMs: 0 });
    expect(() => BattleTimelineSchema.parse(tl)).not.toThrow();
  });
});

describe('Story 1.5 AC1/Task8 — montage collapse over the committed fixture (drama, not 1:1 noise)', () => {
  it('aggregation happened: there are strictly FEWER Beats than TranslatedActions', () => {
    const acts = actions();
    const tl = pace(acts);
    expect(tl.beats.length).toBeGreaterThan(0);
    expect(tl.beats.length).toBeLessThan(acts.length);
  });

  it('at least one Beat is a montage (sourceEventIds.length > 1)', () => {
    const tl = pace(actions());
    const montages = tl.beats.filter((b) => b.sourceEventIds.length > 1);
    expect(montages.length).toBeGreaterThan(0);
  });

  it('CONSERVATION: the union of all beats[*].sourceEventIds equals the full ordered input id set', () => {
    // No information is lost — every action is accounted for in exactly one Beat (no drop/dup),
    // and the order is preserved. This is the documented Pace conservation invariant.
    const acts = actions();
    const tl = pace(acts);
    const collapsed = tl.beats.flatMap((b) => b.sourceEventIds);
    expect(collapsed).toEqual(acts.map((a) => a.sourceEventId));
  });
});

describe('Story 1.5 AC1/Task8 — significant fixture beats stay DISCRETE and out-weigh montages', () => {
  it('the melee/spell/counter strikes each remain their OWN Beat (sourceEventIds.length === 1)', () => {
    // u-0004#0 (Write melee), u-0006#0 (Edit melee), u-0008#0 (Bash spell), u-0009#0 (counter)
    // are SIGNIFICANT per the translate contract — they must NOT be collapsed into a montage.
    const tl = pace(actions());
    const significantIds = ['u-0004#0', 'u-0006#0', 'u-0008#0', 'u-0009#0'];
    for (const id of significantIds) {
      const beat = tl.beats.find((b) => b.sourceEventIds.length === 1 && b.sourceEventIds[0] === id);
      expect(beat, `discrete beat for ${id}`).toBeDefined();
    }
  });

  it("a significant beat's weight AND dwellMs both strictly exceed a montage beat's", () => {
    const tl = pace(actions());
    const montage = tl.beats.find((b) => b.sourceEventIds.length > 1);
    const significant = tl.beats.find(
      (b) => b.sourceEventIds.length === 1 && b.sourceEventIds[0] === 'u-0004#0',
    );
    expect(montage).toBeDefined();
    expect(significant).toBeDefined();
    expect(significant!.weight).toBeGreaterThan(montage!.weight);
    expect(significant!.dwellMs).toBeGreaterThan(montage!.dwellMs);
  });
});

describe('Story 1.5 AC3/Task6 — dwell-budget LOGIC (NOT a literal 2-4 min on the tiny fixture)', () => {
  // The ~2-4 min target is a CONFIG GOAL for the FULL session; the 14-event fixture is a small
  // slice. We assert the LOGIC that makes 2-4 min a config lever (significant out-dwells trivial;
  // totalDurationMs scales with config) rather than padding the fixture to a wall-clock length.

  it('every Beat has a positive dwellMs and totalDurationMs is their exact sum', () => {
    const tl = pace(actions());
    for (const b of tl.beats) expect(b.dwellMs).toBeGreaterThan(0);
    expect(tl.totalDurationMs).toBe(tl.beats.reduce((s, b) => s + b.dwellMs, 0));
  });

  it('TUNABILITY: scaling the config dwell magnitude scales totalDurationMs (NFR-4, zero code change)', () => {
    // pace(actions, weights, windowCfg): pass an in-memory weights config whose dwell magnitude
    // is doubled. totalDurationMs must grow (proving dwell is a DATA lever, not a hardcoded length).
    const base = pace(actions());
    const baseWeightsImport = rawWeights as {
      $schemaVersion: 1;
      weights: Record<string, number>;
      modifiers: Record<string, number>;
      dwell: Record<string, unknown>;
    };
    // Double every numeric leaf in the dwell block.
    const scaledDwell: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(baseWeightsImport.dwell)) {
      scaledDwell[k] =
        typeof v === 'number'
          ? v * 2
          : Object.fromEntries(
              Object.entries(v as Record<string, number>).map(([kk, vv]) => [kk, vv * 2]),
            );
    }
    const scaledWeights = { ...baseWeightsImport, dwell: scaledDwell };
    const scaled = pace(actions(), scaledWeights as never);
    expect(scaled.totalDurationMs).toBeGreaterThan(base.totalDurationMs);
  });
});

describe('Story 1.5 NFR-4/Task8 — windowing is a DATA lever (raising the threshold collapses more)', () => {
  it('a HIGHER montageThresholdWeight makes previously-discrete beats montageable -> fewer Beats', () => {
    // pace(actions, weights, windowCfg): raise montageThresholdWeight so actions that were
    // significant (discrete) now fall at/below threshold (montageable). The Beat count must drop
    // with ZERO change to pace/*.ts — the mechanical proof the rhythm lives in DATA (NFR-4).
    const baseWindow = rawWindow as {
      $schemaVersion: 1;
      montageThresholdWeight: number;
      minRunToCollapse: number;
      [k: string]: unknown;
    };
    const baseCount = pace(actions()).beats.length;
    const greedy = { ...baseWindow, montageThresholdWeight: Number.MAX_SAFE_INTEGER };
    const greedyCount = pace(actions(), undefined as never, greedy as never).beats.length;
    expect(greedyCount).toBeLessThan(baseCount);
  });
});
