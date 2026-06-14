import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// RED-PHASE acceptance tests for Story 1.4, Task 1 — the translate/-LOCAL output type
// `TranslatedAction` (Zod schema + inferred type). These FAIL until
// src/translate/translated-action.ts exists; that is the intended TDD red signal.
//
// Per Dev Notes "Output type: local vs schema/", this is a translate/-local contract, NOT a
// new src/schema/ entry. It reuses the COMMITTED ActionTypeSchema union from
// ../schema/normalized-event (do NOT redefine that union here).
import {
  TranslatedActionSchema,
  type TranslatedAction,
} from './translated-action';
import { ActionTypeSchema } from '../schema/normalized-event';

// A representative scout action: no file target on the bar deltas, isMirage is N/A (null).
const validScout: TranslatedAction = {
  actionType: 'scout',
  sourceEventId: 'u-0002#2',
  orderKey: { logicalClock: 2, streamId: 'aecfc998031eb0576', seqWithinStream: 2 },
  target: '/work/project/src/schema/normalized-event.ts',
  isMirage: null,
  resolveDelta: 0,
  problemIntegrityDelta: 0,
  isAetherStorm: false,
};

// A melee strike that landed on a never-scouted file => Mirage; damages Problem Integrity.
const validMirageStrike: TranslatedAction = {
  actionType: 'melee',
  sourceEventId: 'u-0004#0',
  orderKey: { logicalClock: 4, streamId: 'aecfc998031eb0576', seqWithinStream: 4 },
  target: '/work/project/src/ingest/parse-transcript.ts',
  isMirage: true,
  resolveDelta: 0,
  problemIntegrityDelta: -10,
  isAetherStorm: false,
};

describe('Story 1.4 AC1/AC4 — TranslatedAction schema round-trips a valid action', () => {
  it('parses a valid scout action unchanged (schema/z.infer round-trip)', () => {
    const parsed = TranslatedActionSchema.parse(validScout);
    expect(parsed).toEqual(validScout);
  });

  it('parses a valid melee strike action unchanged', () => {
    const parsed = TranslatedActionSchema.parse(validMirageStrike);
    expect(parsed).toEqual(validMirageStrike);
  });

  it('reuses the committed ActionType union (every member is a legal actionType)', () => {
    // Guards against the schema silently redefining/narrowing the union. Every ActionType
    // member must be accepted by TranslatedAction.actionType.
    for (const member of ActionTypeSchema.options) {
      const candidate = { ...validScout, actionType: member, isMirage: null };
      expect(TranslatedActionSchema.parse(candidate).actionType).toBe(member);
    }
  });
});

describe('Story 1.4 AC1 — TranslatedAction rejects an invalid actionType', () => {
  it('throws a ZodError on an actionType outside the committed union', () => {
    expect(() =>
      TranslatedActionSchema.parse({ ...validScout, actionType: 'fireball' }),
    ).toThrow(z.ZodError);
  });

  it('throws a ZodError on the Mirage/solid pseudo-verbs (Mirage is a FLAG, not a member)', () => {
    // Dev Notes: Mirage/solid is the isMirage boolean flag, deliberately NOT an ActionType.
    expect(() =>
      TranslatedActionSchema.parse({ ...validScout, actionType: 'mirage' }),
    ).toThrow(z.ZodError);
  });
});

describe('Story 1.4 AC2/Task1 — isMirage and target accept explicit null', () => {
  it('accepts isMirage:null (N/A for non-strike actions) and target:null (no file target)', () => {
    // e.g. a Bash spell or an idle action: no file target, not a strike.
    const noTarget = TranslatedActionSchema.parse({
      actionType: 'spell',
      sourceEventId: 'u-0008#0',
      orderKey: { logicalClock: 8, streamId: 'aecfc998031eb0576', seqWithinStream: 8 },
      target: null,
      isMirage: null,
      resolveDelta: 0,
      problemIntegrityDelta: 0,
      isAetherStorm: false,
    });
    expect(noTarget.target).toBeNull();
    expect(noTarget.isMirage).toBeNull();
  });

  it('accepts isMirage:true and isMirage:false (the scouted/unscouted strike flag)', () => {
    expect(TranslatedActionSchema.parse({ ...validMirageStrike, isMirage: true }).isMirage).toBe(true);
    expect(TranslatedActionSchema.parse({ ...validMirageStrike, isMirage: false }).isMirage).toBe(false);
  });

  it('rejects an absent isMirage key (explicit null required, not undefined/absent)', () => {
    // Convention: serialized fields prefer explicit `null` over `undefined`. The flag must be
    // present (boolean | null), never omitted.
    const { isMirage: _omit, ...withoutFlag } = validScout;
    void _omit;
    expect(() => TranslatedActionSchema.parse(withoutFlag)).toThrow(z.ZodError);
  });
});
