import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// RED-PHASE acceptance test for Story 1.2 — Task 2: src/schema/battle-timeline.ts
// (Pacer output / battle model state). Encodes ACs 1–4 for Beat, BattleTimeline,
// BattleState. Imports the not-yet-authored module, so it ERRORS now (RED) and turns
// GREEN once the dev defines these schemas + inferred types in battle-timeline.ts.
import {
  BattleStateSchema,
  BattleTimelineSchema,
  BeatSchema,
  type BattleState,
  type BattleTimeline,
  type Beat,
} from './battle-timeline';

const validOrderKey = { logicalClock: 0, streamId: 'main', seqWithinStream: 0 };

// A Beat is the Pacer's paced unit: order position, action verb, the source events it
// collapses (grounding), and pacing weight/dwell for the renderer. It must NOT carry
// interpretation (beatType/confidence) — that is Layer-1 BeatAnnotation (R1 separation).
const validBeat = {
  orderKey: validOrderKey,
  actionType: 'melee',
  sourceEventIds: ['evt-0001'],
  weight: 1,
  dwellMs: 400,
};

const validTimeline = {
  schemaVersion: 1,
  beats: [validBeat],
  totalDurationMs: 400,
};

const validBattleState = {
  problemIntegrity: 100,
  resolve: 100,
  insightGauge: 0,
  enemies: [{ id: 'boss', type: 'bug', hp: 100 }],
  cursor: 0,
  victory: false,
};

describe('Story 1.2 / AC1+AC4 — BeatSchema const + Beat type round-trips', () => {
  it('parses a valid Beat and exposes the inferred Beat type', () => {
    const value: Beat = BeatSchema.parse(validBeat);
    expect(value.actionType).toBe('melee');
    expect(value.sourceEventIds).toEqual(['evt-0001']);
    expect(value.weight).toBe(1);
    expect(value.dwellMs).toBe(400);
  });

  it('throws ZodError when a Beat is missing its orderKey', () => {
    const { orderKey: _omit, ...beatWithoutOrderKey } = validBeat;
    void _omit;
    expect(() => BeatSchema.parse(beatWithoutOrderKey)).toThrow(z.ZodError);
  });

  it('throws ZodError when actionType is not a known string-literal member (AC2 reuse)', () => {
    expect(() => BeatSchema.parse({ ...validBeat, actionType: 'teleport' })).toThrow(z.ZodError);
  });

  it('keeps interpretation OFF the Beat — a beat carrying beatType/confidence parses but drops them', () => {
    // R1 separation: a Beat carries mechanics only; interpretation lives in Layer-1
    // BeatAnnotation. Feed a Beat that ALSO carries interpretation keys (beatType,
    // confidence): the parse must succeed (Beat does not REQUIRE them) AND the parsed
    // result must NOT carry them (the Beat contract has no place for interpretation, so
    // z.object strips them). A naive spread of validBeat — which never had those keys —
    // would assert nothing, so the interpretation keys are added explicitly here.
    const withInterpretation = { ...validBeat, beatType: 'dispel', confidence: 0.9 };
    const value: Beat = BeatSchema.parse(withInterpretation);
    expect(value.actionType).toBe('melee');
    expect(value).not.toHaveProperty('beatType');
    expect(value).not.toHaveProperty('confidence');
  });
});

describe('Story 1.2 / AC1+AC4 — BattleTimelineSchema const + BattleTimeline type', () => {
  it('parses a valid versioned timeline', () => {
    const value: BattleTimeline = BattleTimelineSchema.parse(validTimeline);
    expect(value.schemaVersion).toBe(1);
    expect(value.beats).toHaveLength(1);
  });

  it('throws ZodError when a nested beat is malformed (missing orderKey)', () => {
    const bad = { ...validTimeline, beats: [{ ...validBeat, orderKey: undefined }] };
    expect(() => BattleTimelineSchema.parse(bad)).toThrow(z.ZodError);
  });

  it('throws ZodError on a wrong schemaVersion literal', () => {
    expect(() => BattleTimelineSchema.parse({ ...validTimeline, schemaVersion: 2 })).toThrow(
      z.ZodError,
    );
  });
});

describe('Story 1.2 / AC1+AC4 — BattleStateSchema const + BattleState type', () => {
  it('parses the immutable playback snapshot the model emits', () => {
    const value: BattleState = BattleStateSchema.parse(validBattleState);
    expect(value.problemIntegrity).toBe(100);
    expect(value.victory).toBe(false);
    expect(value.enemies).toHaveLength(1);
    expect(value.cursor).toBe(0);
  });

  it('throws ZodError when victory is not a boolean', () => {
    expect(() => BattleStateSchema.parse({ ...validBattleState, victory: 'yes' })).toThrow(
      z.ZodError,
    );
  });
});
