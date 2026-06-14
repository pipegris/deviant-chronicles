import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// RED-PHASE acceptance tests for Story 1.4, Tasks 2 & 3 — the ORDERED declarative ruleset
// (src/config/translation-rules.json) and its translate/-local Zod loader
// (src/translate/translation-rules.ts). These FAIL until both exist.
//
// Encodes the load-bearing structural ACs: the file IS the priority list (first-match-wins,
// specificity-first), toolName is an array (so "add a tool = JSON edit"), there is a
// fail-closed `default` idle, and a `$schemaVersion` so a future shape change fails closed.
import {
  TranslationRulesSchema,
  RULES,
  type TranslationRules,
} from './translation-rules';

describe('Story 1.4 AC1/AC4 Task3 — the bundled ruleset loads and validates', () => {
  it('exports RULES already parsed/validated by TranslationRulesSchema', () => {
    // RULES = TranslationRulesSchema.parse(rawRules) at module load. Re-parsing it must be a
    // no-op (idempotent), proving the committed JSON satisfies its own schema.
    expect(() => TranslationRulesSchema.parse(RULES)).not.toThrow();
  });

  it('carries a $schemaVersion so an old engine reading a new shape fails closed', () => {
    const rules = RULES as unknown as { $schemaVersion?: number; version?: number };
    expect(rules.$schemaVersion ?? rules.version).toBe(1);
  });

  it('rejects a rules object missing its rule array (schema is not vacuous)', () => {
    expect(() => TranslationRulesSchema.parse({ $schemaVersion: 1 })).toThrow(z.ZodError);
  });
});

// Helper: pull the ordered rule array regardless of the exact wrapper key the dev chooses
// (`rules` is expected, but tolerate the array being the top-level value).
function ruleList(rules: TranslationRules): Array<{ id: string; match?: unknown; emit?: { actionType?: string } }> {
  const candidate = rules as unknown as { rules?: unknown };
  const arr = Array.isArray(candidate.rules) ? candidate.rules : (rules as unknown);
  if (!Array.isArray(arr)) throw new Error('ruleset has no ordered rule array');
  return arr as Array<{ id: string; match?: unknown; emit?: { actionType?: string } }>;
}

describe('Story 1.4 AC1 Task2 — the six core rules + hazard + outcome rules are present', () => {
  it('contains the documented rule ids', () => {
    const ids = ruleList(RULES).map((r) => r.id);
    for (const id of [
      'aether-storm',
      'bash-spell',
      'edit-write-melee',
      'read-scout',
      'task-summon',
      'result-fail-counter',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('orders aether-storm BEFORE result-fail-counter (AC3 / SM-C1 specificity-first)', () => {
    // The load-bearing ordering: a 529/overload must be classified environmental BEFORE the
    // generic fail rule can miscount it as a Hero failure.
    const ids = ruleList(RULES).map((r) => r.id);
    expect(ids.indexOf('aether-storm')).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf('aether-storm')).toBeLessThan(ids.indexOf('result-fail-counter'));
  });

  it('orders bash-spell (commandPattern) BEFORE the broad read-scout rule', () => {
    const ids = ruleList(RULES).map((r) => r.id);
    expect(ids.indexOf('bash-spell')).toBeLessThan(ids.indexOf('read-scout'));
  });

  it('expresses Read/Grep/Glob as ONE rule via a toolName ARRAY (add-a-tool = JSON edit)', () => {
    const readScout = ruleList(RULES).find((r) => r.id === 'read-scout') as
      | { match?: { toolName?: unknown } }
      | undefined;
    const toolName = readScout?.match?.toolName;
    expect(Array.isArray(toolName)).toBe(true);
    expect(toolName).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob']));
  });

  it('marks the edit-write-melee rule as a Mirage candidate (the strike subject to scouting)', () => {
    const melee = ruleList(RULES).find((r) => r.id === 'edit-write-melee') as
      | { match?: { toolName?: string[] }; emit?: { isMirageCandidate?: boolean } }
      | undefined;
    expect(melee?.match?.toolName).toEqual(expect.arrayContaining(['Edit', 'Write']));
    expect(melee?.emit?.isMirageCandidate).toBe(true);
  });
});

describe('Story 1.4 AC4 Task2 — a fail-closed default idle action lives in DATA, not code', () => {
  it('defines a top-level default action of actionType "idle" with zero deltas', () => {
    const rules = RULES as unknown as {
      default?: { actionType?: string; resolveDelta?: number; problemIntegrityDelta?: number };
    };
    expect(rules.default?.actionType).toBe('idle');
    expect(rules.default?.resolveDelta).toBe(0);
    expect(rules.default?.problemIntegrityDelta).toBe(0);
  });
});
