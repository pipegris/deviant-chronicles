// The documented ingest allowlist (config-as-data, NFR-4): battle-irrelevant bookkeeping
// is excluded by a reviewable policy object, NOT inline booleans scattered through
// normalize. This is parse-policy (it lives beside the parser), not battle-tuning (which
// lives in src/config/*.json). Each entry below carries a one-line rationale (AC3).

export type AllowlistKind = 'content_item' | 'record' | 'journal';

export interface AllowlistQuery {
  kind: AllowlistKind;
  type: string;
  // Only meaningful for content_item tool_use; tools are kept by-policy (see below).
  toolName?: string;
}

// The policy as DATA. `keep`/`exclude` are explicit so a reviewer reads the battle-meaning
// of each shape at a glance. Anything not listed is treated as excluded by default, except
// tool_use (kept by-policy regardless of name — see keepAllToolUse).
export const ALLOWLIST = {
  content_item: {
    // tool_use is kept BY POLICY for ANY tool name (not a closed list): Grep/Glob/Task are
    // absent from this session but a later session must not silently drop them (FR-1).
    keepAllToolUse: true,
    keep: [
      'tool_result', // carries isError + success/error content -> drives counters (Story 1.4).
      'text', // assistant narration -> Layer-2 caption/saga source.
    ],
    exclude: [
      'thinking', // internal model reasoning + an opaque signature; never viewer-facing.
    ],
  },
  // Transcript record envelopes (used for the shapes that are not content-item arrays).
  record: {
    keep: [
      'prompt', // the string-content kickoff -> the autonomous framing event.
    ],
    exclude: [
      'attachment', // deferred_tools_delta tooling-list churn; zero battle meaning.
    ],
  },
  // Workflow-journal records — both lifecycle records bracket phases (the AETHER STORM
  // synth-stumble and the 17/17 over-fix anchors live here), so both are kept.
  journal: {
    keep: ['started', 'result'],
    exclude: [] as string[],
  },
} as const;

/**
 * The allowlist's observable contract: does this shape survive ingestion?
 *
 * PURE. tool_use content items are kept regardless of tool name (forward-safe); everything
 * else is kept only if it appears in the `keep` list for its kind. Anything not explicitly
 * kept is excluded (battle-irrelevant bookkeeping).
 */
export function isAllowed(query: AllowlistQuery): boolean {
  if (query.kind === 'content_item') {
    if (query.type === 'tool_use') return ALLOWLIST.content_item.keepAllToolUse;
    return (ALLOWLIST.content_item.keep as readonly string[]).includes(query.type);
  }
  if (query.kind === 'record') {
    return (ALLOWLIST.record.keep as readonly string[]).includes(query.type);
  }
  return (ALLOWLIST.journal.keep as readonly string[]).includes(query.type);
}
