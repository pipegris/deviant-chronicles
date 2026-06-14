import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// Unit tests on top of battle-timeline.test.ts. Cover decisions the ATDD suite leaves
// implicit: the documented Beat ↔ BeatAnnotation separation (R1 — a Beat must NOT require
// interpretation fields, and accepts the full ActionType set incl. aetherStorm), and the
// BattleState gauge/enemy contract.
import { BattleStateSchema, BattleTimelineSchema, BeatSchema } from './battle-timeline';

const validOrderKey = { logicalClock: 0, streamId: 'main', seqWithinStream: 0 };
const validBeat = {
  orderKey: validOrderKey,
  actionType: 'melee',
  sourceEventIds: ['evt-0001'],
  weight: 1,
  dwellMs: 400,
};

describe('Story 1.2 unit — Beat is mechanics-only and accepts the full ActionType set', () => {
  it('parses a Beat whose actionType is aetherStorm (an environmental-hazard verb)', () => {
    const value = BeatSchema.parse({ ...validBeat, actionType: 'aetherStorm' });
    expect(value.actionType).toBe('aetherStorm');
  });

  it('rejects a Beat missing pacing fields (weight/dwellMs are required mechanics)', () => {
    const { weight: _w, ...noWeight } = validBeat;
    void _w;
    expect(() => BeatSchema.parse(noWeight)).toThrow(z.ZodError);
  });

  it('allows a Beat collapsing multiple source events (sourceEventIds is the grounding set)', () => {
    const value = BeatSchema.parse({ ...validBeat, sourceEventIds: ['evt-0001', 'evt-0002'] });
    expect(value.sourceEventIds).toHaveLength(2);
  });
});

describe('Story 1.2 unit — BattleTimeline requires its version + duration metadata', () => {
  it('rejects a timeline missing totalDurationMs', () => {
    expect(() => BattleTimelineSchema.parse({ schemaVersion: 1, beats: [validBeat] })).toThrow(
      z.ZodError,
    );
  });

  it('accepts an empty beats array (a degenerate but valid timeline)', () => {
    const value = BattleTimelineSchema.parse({ schemaVersion: 1, beats: [], totalDurationMs: 0 });
    expect(value.beats).toHaveLength(0);
  });
});

describe('Story 1.2 unit — BattleState gauge + enemy contract', () => {
  const validBattleState = {
    problemIntegrity: 100,
    resolve: 100,
    insightGauge: 0,
    enemies: [{ id: 'boss', type: 'bug', hp: 100 }],
    cursor: 0,
    victory: false,
  };

  it('rejects a non-integer cursor (cursor indexes a beat position)', () => {
    expect(() => BattleStateSchema.parse({ ...validBattleState, cursor: 1.5 })).toThrow(z.ZodError);
  });

  it('rejects an enemy missing hp (thin enemy shape: id/type/hp all required)', () => {
    const bad = { ...validBattleState, enemies: [{ id: 'boss', type: 'bug' }] };
    expect(() => BattleStateSchema.parse(bad)).toThrow(z.ZodError);
  });

  it('accepts an empty enemy roster', () => {
    const value = BattleStateSchema.parse({ ...validBattleState, enemies: [] });
    expect(value.enemies).toHaveLength(0);
  });
});
