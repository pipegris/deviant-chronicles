import { describe, expect, it } from 'vitest';

// RED-PHASE acceptance test for Story 1.3 — Task 6: src/ingest/allowlist.ts (the documented
// allowlist as config-as-data, NFR-4). Encodes AC3: battle-irrelevant bookkeeping is excluded
// per a DOCUMENTED, reviewable allowlist — not inline booleans. The module does not exist yet,
// so the import fails to resolve (RED).
//
// The exact export name/shape is a dev decision; this suite asserts the BEHAVIOR the allowlist
// must encode via a predicate (`isAllowed`), which is the policy's observable contract:
//   - KEEP every tool_use regardless of tool name (forward-safe: Grep/Glob/Task absent in this
//     session must NOT be silently dropped by a closed name list).
//   - KEEP tool_result + text + the string-content kickoff prompt + journal started/result.
//   - EXCLUDE thinking content items and attachment records.
import { isAllowed } from './allowlist';

describe('Story 1.3 / AC3 — allowlist KEEPS battle-relevant items', () => {
  it('keeps tool_use for tools present in this session', () => {
    for (const toolName of ['Edit', 'Write', 'Read', 'Bash', 'Monitor', 'ToolSearch', 'StructuredOutput']) {
      expect(isAllowed({ kind: 'content_item', type: 'tool_use', toolName })).toBe(true);
    }
  });

  it('keeps tool_use for tools NOT in this session (forward-safe, not a closed name list)', () => {
    // The robustness clause: a later session with Grep/Glob/Task must not lose those events.
    for (const toolName of ['Grep', 'Glob', 'Task']) {
      expect(isAllowed({ kind: 'content_item', type: 'tool_use', toolName })).toBe(true);
    }
  });

  it('keeps tool_result, text, the kickoff prompt, and journal lifecycle records', () => {
    expect(isAllowed({ kind: 'content_item', type: 'tool_result' })).toBe(true);
    expect(isAllowed({ kind: 'content_item', type: 'text' })).toBe(true);
    expect(isAllowed({ kind: 'record', type: 'prompt' })).toBe(true);
    expect(isAllowed({ kind: 'journal', type: 'started' })).toBe(true);
    expect(isAllowed({ kind: 'journal', type: 'result' })).toBe(true);
  });
});

describe('Story 1.3 / AC3 — allowlist EXCLUDES battle-irrelevant bookkeeping', () => {
  it('excludes thinking content items (internal reasoning + opaque signature)', () => {
    expect(isAllowed({ kind: 'content_item', type: 'thinking' })).toBe(false);
  });

  it('excludes attachment records (deferred_tools_delta tooling churn)', () => {
    expect(isAllowed({ kind: 'record', type: 'attachment' })).toBe(false);
  });
});
