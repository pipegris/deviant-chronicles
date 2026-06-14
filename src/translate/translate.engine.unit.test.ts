import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import { translate } from './translate';
import { RULES } from './translation-rules';

// dev-story unit tests layered ON TOP of the ATDD acceptance suite (translate.test.ts). They
// cover the rule categories and resolved Dev-Notes decisions the committed fixture cannot
// exercise: Task/Grep/Glob mappings, the "broad sweep does NOT solidify" rule, the journal
// completed-work sibling rule, and the commandPattern negative path. Hand-authored
// NormalizedEvents are legitimate here (tests are not Layer-0 modules; the schema is the
// contract).

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

describe('Story 1.4 AC1 — rule categories not present in the committed fixture', () => {
  it('Task tool_use -> summon (ally entrance), no file target, isMirage null', () => {
    const [a] = translate([
      makeEvent({ seq: 0, eventId: 'task1', eventType: 'tool_use', toolName: 'Task', payload: { input: { description: 'spawn explorer' } } }),
    ]);
    expect(a.actionType).toBe('summon');
    expect(a.target).toBeNull();
    expect(a.isMirage).toBeNull();
  });

  it('Grep and Glob tool_use -> scout (the same read-scout rule, via the toolName array)', () => {
    const actions = translate([
      makeEvent({ seq: 0, eventId: 'grep1', eventType: 'tool_use', toolName: 'Grep', payload: { input: { pattern: 'TODO', path: '/work/project/src' } } }),
      makeEvent({ seq: 1, eventId: 'glob1', eventType: 'tool_use', toolName: 'Glob', payload: { input: { pattern: '**/*.ts' } } }),
    ]);
    expect(actions[0].actionType).toBe('scout');
    expect(actions[1].actionType).toBe('scout');
  });
});

describe('Story 1.4 AC2 — broad scans (Grep/Glob) do NOT solidify a later strike', () => {
  it('a Grep over a directory does NOT make a later Edit of a file within it solid', () => {
    // Dev Notes decision (2): only a targeted Read of the SAME file_path counts; over-crediting
    // a broad sweep would let "I grepped the repo" fake a targeted read (Idea #35: memory != ground truth).
    const target = '/work/project/src/translate/translate.ts';
    const events: NormalizedEvent[] = [
      makeEvent({ seq: 0, eventId: 'grep1', eventType: 'tool_use', toolName: 'Grep', payload: { input: { pattern: 'translate', path: '/work/project/src/translate' } } }),
      makeEvent({ seq: 1, eventId: 'edit1', eventType: 'tool_use', toolName: 'Edit', payload: { input: { file_path: target, old_string: 'a', new_string: 'b' } } }),
    ];
    const [, strike] = translate(events);
    expect(strike.actionType).toBe('melee');
    expect(strike.isMirage).toBe(true);
  });
});

describe('Story 1.4 AC1 — journal completed-work signal damages Problem Integrity', () => {
  it('a journal_result with subtype "complete" -> melee damaging Problem Integrity (< 0)', () => {
    // The committed fixture journal result is exactly this (status:complete). The
    // journal-pass-damage sibling rule covers the journal stream's completed-work signal.
    const [a] = translate([
      makeEvent({ seq: 0, eventId: 'jr1', eventType: 'journal_result', subtype: 'complete', payload: { key: 'phase-1', result: { status: 'complete', verdict: 'pass' } } }),
    ]);
    expect(a.problemIntegrityDelta).toBeLessThan(0);
    expect(a.isAetherStorm).toBe(false);
  });

  it('a journal_result with subtype "pass" also damages Problem Integrity', () => {
    const [a] = translate([
      makeEvent({ seq: 0, eventId: 'jr2', eventType: 'journal_result', subtype: 'pass', payload: { key: 'phase-2', result: { verdict: 'pass' } } }),
    ]);
    expect(a.problemIntegrityDelta).toBeLessThan(0);
  });
});

describe('Story 1.4 AC1 — bash-spell commandPattern is matched, not every Bash', () => {
  it('a Bash command that is NOT a test/build (e.g. "ls -la") falls to the default idle', () => {
    // Proves bash-spell matches via the commandPattern, not the bare Bash tool — a non-build
    // shell command has no rule and fails closed to idle (AC4), never throwing.
    const [a] = translate([
      makeEvent({ seq: 0, eventId: 'ls1', eventType: 'tool_use', toolName: 'Bash', payload: { input: { command: 'ls -la', description: 'list files' } } }),
    ]);
    expect(a.actionType).toBe('idle');
  });

  it('a Bash "pnpm build" command DOES match bash-spell -> spell', () => {
    const [a] = translate([
      makeEvent({ seq: 0, eventId: 'b1', eventType: 'tool_use', toolName: 'Bash', payload: { input: { command: 'pnpm build', description: 'build' } } }),
    ]);
    expect(a.actionType).toBe('spell');
  });

  // F4 regression: the commandPattern is ANCHORED, so a bare substring "test"/"build" no longer
  // misfires a spell. An unanchored pattern turned `cat latest.txt` / `npm run build-docs` into
  // channeled spells, corrupting the narrative on real sessions (Dev Notes required anchored).
  it('commands that merely CONTAIN test/build as a substring do NOT become spells (anchored)', () => {
    for (const command of ['cat latest.txt', 'cd /srv/contestants && ls', 'npm run build-docs', 'echo "fastest"']) {
      const [a] = translate([
        makeEvent({ seq: 0, eventId: 'neg', eventType: 'tool_use', toolName: 'Bash', payload: { input: { command } } }),
      ]);
      expect(a.actionType, command).toBe('idle');
    }
  });

  it('genuine test/build/lint invocations DO match bash-spell across package managers and bare tools', () => {
    for (const command of ['pnpm vitest run', 'pnpm run test', 'npm run lint', 'npx tsc --noEmit', 'eslint .', 'yarn build']) {
      const [a] = translate([
        makeEvent({ seq: 0, eventId: 'pos', eventType: 'tool_use', toolName: 'Bash', payload: { input: { command } } }),
      ]);
      expect(a.actionType, command).toBe('spell');
    }
  });
});

describe('Story 1.4 AC1 Task5 — a spell that LANDS (passing result) damages Integrity', () => {
  it('Bash spell then a passing tool_result on the SAME stream -> Integrity damage (spell lands)', () => {
    // The complement of the fixture's backfire case: isError:false resolves the channel to a
    // clean hit on Problem Integrity (the result-pass-damage effect).
    const stream = 'main-stream';
    const events: NormalizedEvent[] = [
      makeEvent({ seq: 0, eventId: 'spell1', eventType: 'tool_use', toolName: 'Bash', streamId: stream, payload: { input: { command: 'pnpm vitest run' } } }),
      makeEvent({ seq: 1, eventId: 'res1', eventType: 'tool_result', isError: false, streamId: stream, payload: { content: 'PASS' } }),
    ];
    const [spell, result] = translate(events);
    expect(spell.actionType).toBe('spell');
    // The landed spell resolves as a hit on the Boss (the positive complement of the backfire
    // counter): pin actionType too so this stays the mirror of the u-0009#0 backfire assertion.
    expect(result.actionType).toBe('melee');
    expect(result.problemIntegrityDelta).toBeLessThan(0);
    expect(result.resolveDelta).toBe(0);
  });

  // F2 regression: the spell channel is LOAD-BEARING, not dead state. A passing result lands a
  // Boss hit ONLY because a strike (the spell) was open on its stream. The SAME passing result
  // with NO preceding strike resolves nothing -> idle. Previously the channel set influenced no
  // output, so deleting it changed nothing; this asserts the channel now drives the outcome.
  it('a passing result with NO open strike on its stream does NOT damage the Boss (idle)', () => {
    const lone: NormalizedEvent = makeEvent({
      seq: 0,
      eventId: 'res-alone',
      eventType: 'tool_result',
      isError: false,
      payload: { content: 'PASS' },
    });
    const [a] = translate([lone]);
    expect(a.actionType).toBe('idle');
    expect(a.problemIntegrityDelta).toBe(0);
  });

  it("a spell's result resolves only the SAME stream (a sub-agent result does not land the main spell)", () => {
    // Same-stream guard: the spell channels on 'main'; a passing result on a DIFFERENT stream
    // resolves no main-stream strike -> idle, leaving the main spell open for its own result.
    const events: NormalizedEvent[] = [
      makeEvent({ seq: 0, eventId: 'sp', eventType: 'tool_use', toolName: 'Bash', streamId: 'main', payload: { input: { command: 'pnpm vitest run' } } }),
      makeEvent({ seq: 1, eventId: 'sub-res', eventType: 'tool_result', isError: false, streamId: 'sub', payload: { content: 'PASS' } }),
    ];
    const [, subResult] = translate(events);
    expect(subResult.actionType).toBe('idle');
  });
});

describe('Story 1.4 AC2 — null/empty-target strike (F6 sentinel-collision hardening)', () => {
  it('a strike with NO file target is always a Mirage, and an empty-string-path Read never solidifies it', () => {
    // A Read whose file_path trims to '' is "no target" (recorded as null, not ''), so it does
    // NOT solidify a later null-target strike — null and empty-string can no longer alias.
    const events: NormalizedEvent[] = [
      makeEvent({ seq: 0, eventId: 'rd', eventType: 'tool_use', toolName: 'Read', payload: { input: { file_path: '   ' } } }),
      makeEvent({ seq: 1, eventId: 'ed', eventType: 'tool_use', toolName: 'Edit', payload: { input: { old_string: 'a', new_string: 'b' } } }),
    ];
    const [scout, strike] = translate(events);
    expect(scout.target).toBeNull();
    expect(strike.target).toBeNull();
    expect(strike.isMirage).toBe(true);
  });
});

describe('Story 1.4 — the committed RULES are internally consistent', () => {
  it('every rule emits a member of the committed ActionType union (no typos in the JSON)', () => {
    // Guards the committed JSON: RULES is already schema-validated at import, so a bad
    // actionType would have thrown on load — this asserts the safety net stayed green.
    const actionTypes = RULES.rules.map((r) => r.emit.actionType);
    expect(actionTypes.length).toBeGreaterThan(0);
    expect(actionTypes).toContain('aetherStorm');
    expect(RULES.default.actionType).toBe('idle');
  });
});
