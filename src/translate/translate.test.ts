import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';

// RED-PHASE acceptance tests for Story 1.4 (Tasks 4-8) — the pure ordered-walk Translate
// engine: NormalizedEvent[] in, TranslatedAction[] out, driven entirely by
// src/config/translation-rules.json. These FAIL until src/translate/translate.ts (and the
// rules loader it depends on) exist. That is the intended TDD red signal.
//
// Pipeline reuse: we read the COMMITTED ingest fixtures with fs IN THE TEST (tests are not
// Layer-0 modules, so this respects R2) and run the SAME parse -> normalize -> merge chain
// as src/ingest/ingest.test.ts, then feed the merged events into translate(). This is the
// exact NormalizedEvent[] the snapshot pins, so eventIds below are stable.
import { translate } from './translate';
import { RULES } from './translation-rules';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'ingest', '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

// Mirror of src/ingest/ingest.test.ts runIngest() — the SAME merged ordering translate() must
// consume (incl. the devMaxEpoch+1 journal anchor).
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

function actionFor(eventId: string) {
  const events = runIngest();
  const actions = translate(events);
  // translate() emits one TranslatedAction per input event in walk order, so index-align.
  const idx = events.findIndex((e) => e.eventId === eventId);
  expect(idx).toBeGreaterThanOrEqual(0);
  return actions[idx];
}

describe('Story 1.4 AC1 — the six core mappings, over the committed fixture', () => {
  it('Read tool_use -> scout (u-0002#2, the schema read)', () => {
    expect(actionFor('u-0002#2').actionType).toBe('scout');
  });

  it('the second Read tool_use -> scout (u-0010#0, the normalize read)', () => {
    expect(actionFor('u-0010#0').actionType).toBe('scout');
  });

  it('Write tool_use -> melee strike on the Boss (u-0004#0)', () => {
    expect(actionFor('u-0004#0').actionType).toBe('melee');
  });

  it('Edit tool_use -> melee strike on the Boss (u-0006#0)', () => {
    expect(actionFor('u-0006#0').actionType).toBe('melee');
  });

  it('Bash test/build tool_use -> channeled spell (u-0008#0, "pnpm vitest run")', () => {
    expect(actionFor('u-0008#0').actionType).toBe('spell');
  });

  it('carries sourceEventId + orderKey through from the originating event (grounding link)', () => {
    const a = actionFor('u-0004#0');
    expect(a.sourceEventId).toBe('u-0004#0');
    expect(a.orderKey).toEqual({ logicalClock: 4, streamId: DEV_STREAM_ID, seqWithinStream: 4 });
  });

  it('a passing tool_result lands a hit on Problem Integrity and does NOT drain Resolve', () => {
    // e.g. u-0005#0 ("File created.") / u-0007#0 ("Edit applied.") — isError:false completed work.
    // Pin all three axes so this cannot pass for the wrong reason: a passing result must damage
    // the Boss (problemIntegrityDelta < 0), must NOT touch the Hero's Resolve (a clean hit, not a
    // counter), and resolves as a landed strike. Asserting only the Integrity sign would stay
    // green even if a regression also drained Resolve on a pass.
    const a = actionFor('u-0005#0');
    expect(a.actionType).toBe('melee');
    expect(a.problemIntegrityDelta).toBeLessThan(0);
    expect(a.resolveDelta).toBe(0);
  });

  // F3 regression: a passing tool_result damages the Boss only when it resolves WORK (a melee
  // or a spell), never a scout's own read completing. u-0003#0 is the result of the schema-Read
  // scout (u-0002#2) and u-0011#0 the result of the normalize-Read (u-0010#0) — neither follows
  // a strike, so neither is "completed work hitting the Boss". They must fall to idle, not melee.
  it("a scout's own result does NOT damage the Boss (u-0003#0, u-0011#0 are not melee hits)", () => {
    for (const id of ['u-0003#0', 'u-0011#0']) {
      const a = actionFor(id);
      expect(a.actionType, id).toBe('idle');
      expect(a.problemIntegrityDelta, id).toBe(0);
      expect(a.resolveDelta, id).toBe(0);
    }
  });
});

describe('Story 1.4 AC1 Task5 — the spell resolves on its outcome (the FOLLOWING result)', () => {
  it('the failing tool_result after the Bash spell backfires -> a counter draining Resolve only', () => {
    // Fixture: u-0008#0 Bash "pnpm vitest run" is IMMEDIATELY followed by u-0009#0
    // tool_result isError:true on the SAME stream -> the channel backfires, NOT a clean hit.
    // Pin all three axes: a backfire is an enemy COUNTER (the metaphor, not just "some negative
    // delta"), it drains the Hero's Resolve (resolveDelta < 0), and it must NOT damage the Boss
    // (problemIntegrityDelta === 0) — a backlash hurts the Hero, never the Problem. Asserting
    // only resolveDelta < 0 would let a regression that also damaged Integrity slip through.
    const failResult = actionFor('u-0009#0');
    expect(failResult.actionType).toBe('counter');
    expect(failResult.resolveDelta).toBeLessThan(0);
    expect(failResult.problemIntegrityDelta).toBe(0);
  });
});

describe('Story 1.4 AC2 — scout-before-strike (Mirage) over the committed fixture', () => {
  it('Write of parse-transcript.ts is a Mirage (no prior Read of THAT path) — isMirage:true', () => {
    // The only earlier Read (u-0002#2) targeted normalized-event.ts, a DIFFERENT file.
    expect(actionFor('u-0004#0').isMirage).toBe(true);
  });

  it('Edit of parse-transcript.ts is a Mirage too (still no prior Read of that file) — isMirage:true', () => {
    expect(actionFor('u-0006#0').isMirage).toBe(true);
  });

  it('isMirage is null for non-strike actions (scout / spell)', () => {
    expect(actionFor('u-0002#2').isMirage).toBeNull(); // scout
    expect(actionFor('u-0008#0').isMirage).toBeNull(); // spell
  });

  it('a Read of file X BEFORE an Edit of file X makes the strike solid (isMirage:false)', () => {
    // Hand-built proof (the fixture has no scouted-then-struck pair). Same normalized target
    // path, scout earlier in the ordered walk => solid.
    const target = '/work/project/src/model/battle-state.ts';
    const events: NormalizedEvent[] = [
      makeEvent({ seq: 0, eventId: 'r1', eventType: 'tool_use', toolName: 'Read', payload: { input: { file_path: target } } }),
      makeEvent({ seq: 1, eventId: 'e1', eventType: 'tool_use', toolName: 'Edit', payload: { input: { file_path: target, old_string: 'a', new_string: 'b' } } }),
    ];
    const [scout, strike] = translate(events);
    expect(scout.actionType).toBe('scout');
    expect(strike.actionType).toBe('melee');
    expect(strike.isMirage).toBe(false);
  });

  it('a Read AFTER the strike does NOT retroactively solidify it (scout must come BEFORE)', () => {
    const target = '/work/project/src/model/battle-state.ts';
    const events: NormalizedEvent[] = [
      makeEvent({ seq: 0, eventId: 'e1', eventType: 'tool_use', toolName: 'Edit', payload: { input: { file_path: target, old_string: 'a', new_string: 'b' } } }),
      makeEvent({ seq: 1, eventId: 'r1', eventType: 'tool_use', toolName: 'Read', payload: { input: { file_path: target } } }),
    ];
    const [strike] = translate(events);
    expect(strike.isMirage).toBe(true);
  });
});

describe('Story 1.4 AC3 — environmental hazard becomes an Aether Storm (guards SM-C1)', () => {
  // The redacted committed fixture has NO 529/overload (its journal result is a "complete"
  // pass), so we hand-author the hazard event. A test-authored NormalizedEvent is legitimate
  // — tests are not Layer-0 modules and the schema is the contract.
  const storm: NormalizedEvent = makeEvent({
    seq: 0,
    eventId: 'storm-1',
    eventType: 'journal_result',
    subtype: 'overload',
    payload: { key: 'phase-x', result: { status: 'overload' } },
  });

  it('a journal_result with an overload subtype -> actionType "aetherStorm", isAetherStorm:true', () => {
    const [a] = translate([storm]);
    expect(a.actionType).toBe('aetherStorm');
    expect(a.isAetherStorm).toBe(true);
  });

  it('an Aether Storm is environmental — it does NOT drain Resolve nor damage Integrity (SM-C1)', () => {
    const [a] = translate([storm]);
    expect(a.resolveDelta).toBe(0);
    expect(a.problemIntegrityDelta).toBe(0);
  });

  it('is classified BEFORE the generic fail rule: an overload result is NOT a counter', () => {
    // If ordering were wrong, this would fall through to result-fail-counter and drain Resolve.
    const [a] = translate([storm]);
    expect(a.actionType).not.toBe('counter');
  });

  // F1 regression: a REAL rate-limit/backoff/529 surfaces NOT as a journal_result subtype
  // (ingest stamps none) but as a tool_result isError:true whose payload.content carries the
  // error text (exactly the channel u-0009 arrives on). The aether-storm-result rule, ordered
  // before result-fail-counter and gated on a contentPattern, must classify it environmental —
  // otherwise it drains Resolve as a Hero failure, the exact SM-C1 violation AC3 prevents.
  it('a 529/overload tool_result (isError:true, error text in content) -> aetherStorm, NOT a counter (SM-C1)', () => {
    const realHazard: NormalizedEvent = makeEvent({
      seq: 0,
      eventId: 'hz-1',
      eventType: 'tool_result',
      isError: true,
      payload: { content: 'API Error: 529 {"type":"overloaded_error"} — retry after backoff' },
    });
    const [a] = translate([realHazard]);
    expect(a.actionType).toBe('aetherStorm');
    expect(a.isAetherStorm).toBe(true);
    expect(a.resolveDelta).toBe(0); // environmental: must NOT drain the Hero's Resolve
    expect(a.problemIntegrityDelta).toBe(0); // nor damage the Boss
  });

  it('a hazard in an ARRAY-shaped tool_result content (e.g. "rate limit") still -> aetherStorm', () => {
    // Real tool_result content can be a string OR an array of blocks (ingest/normalize); the
    // engine stringifies the array so a hazard token in any block is matchable.
    const arrayHazard: NormalizedEvent = makeEvent({
      seq: 0,
      eventId: 'hz-2',
      eventType: 'tool_result',
      isError: true,
      payload: { content: [{ type: 'text', text: 'Rate limit reached. Please slow down.' }] },
    });
    expect(translate([arrayHazard])[0].actionType).toBe('aetherStorm');
  });

  it('an ORDINARY failing tool_result (no hazard text) is still a counter, not an Aether Storm', () => {
    // Guards over-firing: only error TEXT matching the hazard vocabulary is environmental; a
    // plain test failure (like u-0009) remains a Resolve-draining counter.
    const plainFail: NormalizedEvent = makeEvent({
      seq: 0,
      eventId: 'pf-1',
      eventType: 'tool_result',
      isError: true,
      payload: { content: 'FAIL src/ingest/parse-transcript.test.ts' },
    });
    const [a] = translate([plainFail]);
    expect(a.actionType).toBe('counter');
    expect(a.resolveDelta).toBeLessThan(0);
  });
});

describe('Story 1.4 AC4 — fail-closed-to-default + never crashes', () => {
  it('an event matching NO rule -> the default idle action with zero deltas (no throw)', () => {
    // An assistant text event matches no rule.
    const textEvent = makeEvent({ seq: 0, eventId: 't1', eventType: 'text', payload: { text: 'thinking out loud' } });
    let actions: ReturnType<typeof translate> = [];
    expect(() => {
      actions = translate([textEvent]);
    }).not.toThrow();
    expect(actions[0].actionType).toBe('idle');
    expect(actions[0].resolveDelta).toBe(0);
    expect(actions[0].problemIntegrityDelta).toBe(0);
    expect(actions[0].isMirage).toBeNull();
  });

  it('translating an empty array returns an empty array', () => {
    expect(translate([])).toEqual([]);
  });

  it('does not throw on the full committed fixture (every event maps or falls to default)', () => {
    expect(() => translate(runIngest())).not.toThrow();
  });

  it('the committed fixture\'s journal_started event matches NO rule -> default idle (real fail-closed)', () => {
    // The hand-built text case above proves the default in isolation; this proves the SAME
    // fail-closed-to-default fires on a real unmapped event the committed fixture actually
    // produces (journal_started has no rule — only journal_result does), so the AC4 branch is
    // exercised by committed data, not only by a synthetic event.
    const events = runIngest();
    const startedId = events.find((e) => e.eventType === 'journal_started')?.eventId;
    expect(startedId).toBeDefined();
    const a = actionFor(startedId as string);
    expect(a.actionType).toBe('idle');
    expect(a.resolveDelta).toBe(0);
    expect(a.problemIntegrityDelta).toBe(0);
    expect(a.isMirage).toBeNull();
    expect(a.isAetherStorm).toBe(false);
  });
});

describe('Story 1.4 AC4 / NFR-4 Task7 — adding a rule is a JSON-only change (data-driven engine)', () => {
  // The mechanical proof that the metaphor lives in DATA: pass an EXTENDED ruleset (committed
  // RULES + one new rule) as the `rules` arg. The output for a NEW tool changes accordingly,
  // with ZERO change to translate.ts. Then the SAME events under the committed RULES fall to
  // default for that tool — proving the engine added no hard-coded behavior.
  const monitorEvent = makeEvent({
    seq: 0,
    eventId: 'm1',
    eventType: 'tool_use',
    toolName: 'Monitor',
    payload: { input: {} },
  });

  function extendedRules() {
    const base = RULES as unknown as { rules: unknown[] };
    const extra = { id: 'monitor-summon', match: { eventType: 'tool_use', toolName: ['Monitor'] }, emit: { actionType: 'summon' } };
    return { ...(RULES as object), rules: [extra, ...base.rules] } as typeof RULES;
  }

  it('a Monitor event maps to summon under the EXTENDED ruleset', () => {
    const [a] = translate([monitorEvent], extendedRules());
    expect(a.actionType).toBe('summon');
  });

  it('the SAME Monitor event falls to the default idle under the committed RULES (no hidden rule)', () => {
    const [a] = translate([monitorEvent], RULES);
    expect(a.actionType).toBe('idle');
  });

  it('the extended ruleset differs from the committed one ONLY for the newly-covered event', () => {
    // Translating a Read (already covered) is identical under both rulesets — the new rule
    // added behavior for Monitor alone.
    const read = makeEvent({ seq: 0, eventId: 'r1', eventType: 'tool_use', toolName: 'Read', payload: { input: { file_path: '/x.ts' } } });
    const committed = translate([read], RULES);
    const extended = translate([read], extendedRules());
    expect(JSON.stringify(extended)).toBe(JSON.stringify(committed));
  });
});

describe('Story 1.4 — purity / determinism at the translate stage (R2)', () => {
  it('a second run over the same input is byte-identical (the stage-level determinism guard)', () => {
    const events = runIngest();
    expect(JSON.stringify(translate(events))).toBe(JSON.stringify(translate(events)));
  });

  it('does not mutate the input events array (fresh objects, no input mutation)', () => {
    const events = runIngest();
    const before = JSON.stringify(events);
    translate(events);
    expect(JSON.stringify(events)).toBe(before);
  });

  it('emits exactly one TranslatedAction per input event', () => {
    const events = runIngest();
    expect(translate(events)).toHaveLength(events.length);
  });
});

// --- test helper -------------------------------------------------------------------------
// Build a schema-shaped NormalizedEvent for hand-authored scenarios. All fields the engine
// reads are settable; the rest take stable defaults so the action is deterministic.
function makeEvent(opts: {
  seq: number;
  eventId: string;
  eventType: string;
  toolName?: string | null;
  subtype?: string | null;
  isError?: boolean;
  payload?: Record<string, unknown> | null;
  streamId?: string;
}): NormalizedEvent {
  return {
    orderKey: {
      logicalClock: opts.seq,
      streamId: opts.streamId ?? 'test-stream',
      seqWithinStream: opts.seq,
    },
    eventId: opts.eventId,
    eventType: opts.eventType,
    toolName: opts.toolName ?? null,
    subtype: opts.subtype ?? null,
    timestamp: '2026-06-14T12:00:00.000Z',
    streamDepth: 0,
    exitCode: null,
    isError: opts.isError ?? false,
    retryCount: 0,
    payload: opts.payload ?? null,
  };
}
