// Story 5.6 / Task 3 (AC2, §7) — the PURE transcript-source RESOLUTION PLAN. AC2/§7 require the build to
// accept EXACTLY ONE of {repeated --transcript/--stream-id pairs, a --session-manifest} and to FAIL LOUD on
// both/neither or on a --transcript/--stream-id count mismatch. That fail-CLOSED decision is load-bearing
// (a wrong/ambiguous stream set must never silently ingest), so it lives HERE — a pure argv→plan function —
// rather than buried in scripts/build-bundle.ts, which vitest does NOT run (include is src/**/*.test.ts;
// the Story 3.2/5.2 thin-script precedent §4). The script keeps the fs reads; this helper owns the
// validation so the negative branches are gate-testable with no fs.

import { type SessionManifest } from './session-manifest';

export interface PlannedTranscriptSource {
  path: string;
  streamId: string;
}

// EXACTLY ONE arm is populated. Discriminated so the script reads the manifest file itself on the
// 'manifest' arm (then maps via manifestToPlannedSources) vs reading the per-flag paths on 'flags'.
export type TranscriptSourcePlan =
  | { kind: 'flags'; sources: PlannedTranscriptSource[] }
  | { kind: 'manifest'; manifestPath: string };

// Collect ALL `--<name> <value>` occurrences in argv ORDER (getFlag returns only the first; the multi-
// transcript shape needs every --transcript AND every --stream-id, zipped by index). Flags need NOT be
// adjacent — the legacy invocation interleaves `--transcript A --journal J --stream-id S`, which MUST keep
// working (the byte-identical-bundle path). A missing value fails LOUD so a typo never zips a wrong pair.
export function getAllFlagValues(argv: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== `--${name}`) continue;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`scripts/build-bundle.ts: --${name} is missing its value.`);
    }
    values.push(value);
  }
  return values;
}

function getFlag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

/**
 * Resolve the transcript-source PLAN from argv, fail-CLOSED (AC2/§7). EXACTLY ONE of:
 *   - a single `--session-manifest <path>` (→ { kind: 'manifest' }), OR
 *   - one-or-more `--transcript <path> --stream-id <id>` pairs zipped by order (→ { kind: 'flags' }).
 *
 * THROWS when:
 *   - both `--session-manifest` AND `--transcript`/`--stream-id` are present (ambiguous),
 *   - neither is present (no source),
 *   - the `--transcript` and `--stream-id` counts disagree (a pair would be mis-zipped),
 *   - any `--transcript`/`--stream-id`/`--session-manifest` flag is missing its value (via getAllFlagValues).
 *
 * The legacy single `--transcript … --stream-id …` invocation (in any order relative to --journal) maps to
 * a one-element `{ kind: 'flags', sources: [{path, streamId}] }` — UNCHANGED behavior (Hard Invariant 1).
 */
export function planTranscriptSources(argv: readonly string[]): TranscriptSourcePlan {
  const manifestPath = getFlag(argv, 'session-manifest');
  const transcriptPaths = getAllFlagValues(argv, 'transcript');
  const streamIds = getAllFlagValues(argv, 'stream-id');

  if (manifestPath !== undefined && (transcriptPaths.length > 0 || streamIds.length > 0)) {
    throw new Error(
      'scripts/build-bundle.ts: supply EITHER --session-manifest OR --transcript/--stream-id flags, not both.',
    );
  }
  if (manifestPath !== undefined) {
    return { kind: 'manifest', manifestPath };
  }
  if (transcriptPaths.length === 0) {
    throw new Error(
      'scripts/build-bundle.ts: missing transcript source — supply --transcript <path> --stream-id <id> (repeatable) or --session-manifest <path>.',
    );
  }
  if (transcriptPaths.length !== streamIds.length) {
    throw new Error(
      `scripts/build-bundle.ts: ${transcriptPaths.length} --transcript flag(s) but ${streamIds.length} --stream-id flag(s) — each transcript needs exactly one stream-id.`,
    );
  }
  return {
    kind: 'flags',
    sources: transcriptPaths.map((path, i) => ({ path, streamId: streamIds[i] })),
  };
}

/**
 * Map a validated `--session-manifest` table (already parsed via SessionManifestSchema, fail-closed +
 * .strict()) to the resolved per-stream PLAN the script reads. Kept here, not inline in the script, so the
 * manifest→plan mapping is covered alongside planTranscriptSources. PURE.
 */
export function manifestToPlannedSources(manifest: SessionManifest): PlannedTranscriptSource[] {
  return manifest.map(({ transcript, streamId }) => ({ path: transcript, streamId }));
}
