import { describe, expect, it } from 'vitest';
import {
  planTranscriptSources,
  manifestToPlannedSources,
  getAllFlagValues,
} from './transcript-source-plan';
import { SessionManifestSchema } from './session-manifest';

// Story 5.6 — AC2/§7 fail-CLOSED contract for the multi-stream CLI shape. build-bundle.ts must accept
// EXACTLY ONE of {repeated --transcript/--stream-id pairs, a --session-manifest} and FAIL LOUD on
// both/neither or a --transcript/--stream-id count mismatch. The pure decision lives in
// planTranscriptSources (the script just adds fs reads), so THESE negative branches are gate-covered —
// they are otherwise unreachable by vitest, which does not run scripts/build-bundle.ts. The dev's
// completion notes claimed these were "exercised end-to-end"; this file is what actually exercises them.

describe('Story 5.6 AC2 — planTranscriptSources resolves the legacy single-pair shape (backward-compat)', () => {
  it('maps a single --transcript/--stream-id pair to a one-element flags plan', () => {
    const plan = planTranscriptSources(['--transcript', 'dev.jsonl', '--stream-id', 'devid']);
    expect(plan).toEqual({ kind: 'flags', sources: [{ path: 'dev.jsonl', streamId: 'devid' }] });
  });

  it('tolerates --journal INTERLEAVED between --transcript and --stream-id (the real legacy invocation)', () => {
    // build-bundle's committed invocation is `--transcript A --journal J --stream-id S` — the pair is NOT
    // adjacent. This is the exact ordering the v1 adjacency parser broke on (Debug Log). It must zip by
    // index regardless of interleaving so the committed bundle stays byte-identical.
    const plan = planTranscriptSources([
      '--transcript', 'dev.jsonl', '--journal', 'j.jsonl', '--stream-id', 'devid', '--out', 'o.json',
    ]);
    expect(plan).toEqual({ kind: 'flags', sources: [{ path: 'dev.jsonl', streamId: 'devid' }] });
  });
});

describe('Story 5.6 AC2 — planTranscriptSources resolves the multi-pair shape (zip by ORDER)', () => {
  it('zips the i-th --transcript with the i-th --stream-id, preserving argv order', () => {
    const plan = planTranscriptSources([
      '--transcript', 'dev.jsonl', '--stream-id', 'devid',
      '--transcript', 'fix.jsonl', '--stream-id', 'fixid',
    ]);
    expect(plan).toEqual({
      kind: 'flags',
      sources: [
        { path: 'dev.jsonl', streamId: 'devid' },
        { path: 'fix.jsonl', streamId: 'fixid' },
      ],
    });
  });
});

describe('Story 5.6 AC2 — planTranscriptSources resolves the --session-manifest shape', () => {
  it('returns a manifest plan carrying the manifest path (the script reads+validates it)', () => {
    const plan = planTranscriptSources(['--session-manifest', 'session.json']);
    expect(plan).toEqual({ kind: 'manifest', manifestPath: 'session.json' });
  });
});

describe('Story 5.6 AC2 — planTranscriptSources is FAIL-CLOSED (the load-bearing §7 negative branches)', () => {
  it('THROWS when BOTH --session-manifest AND --transcript are supplied (ambiguous source set)', () => {
    expect(() =>
      planTranscriptSources(['--session-manifest', 'session.json', '--transcript', 'dev.jsonl', '--stream-id', 'd']),
    ).toThrow(/EITHER --session-manifest OR --transcript/);
  });

  it('THROWS when --session-manifest is combined with a stray --stream-id (no --transcript)', () => {
    // Even a lone --stream-id alongside the manifest is ambiguous — the guard must catch streamIds too,
    // not only --transcript (this is the branch a `transcriptPaths.length > 0` only-check would miss).
    expect(() =>
      planTranscriptSources(['--session-manifest', 'session.json', '--stream-id', 'd']),
    ).toThrow(/not both/);
  });

  it('THROWS when NEITHER a manifest NOR any --transcript is supplied (no source at all)', () => {
    expect(() => planTranscriptSources(['--journal', 'j.jsonl', '--out', 'o.json'])).toThrow(
      /missing transcript source/,
    );
  });

  it('THROWS on a --transcript/--stream-id COUNT MISMATCH (a pair would be mis-zipped)', () => {
    expect(() =>
      planTranscriptSources([
        '--transcript', 'dev.jsonl', '--transcript', 'fix.jsonl', '--stream-id', 'only-one',
      ]),
    ).toThrow(/2 --transcript flag\(s\) but 1 --stream-id flag\(s\)/);
  });

  it('THROWS on more --stream-id than --transcript too (mismatch is symmetric)', () => {
    expect(() =>
      planTranscriptSources(['--transcript', 'dev.jsonl', '--stream-id', 'a', '--stream-id', 'b']),
    ).toThrow(/1 --transcript flag\(s\) but 2 --stream-id flag\(s\)/);
  });

  it('THROWS when a --transcript flag is missing its value (a trailing flag, or another flag follows)', () => {
    // getAllFlagValues must reject `--transcript --stream-id …` (value swallowed by the next flag) and a
    // trailing `--transcript` with nothing after — otherwise a typo silently drops/zips the wrong stream.
    expect(() => planTranscriptSources(['--transcript', '--stream-id', 'd'])).toThrow(/--transcript is missing its value/);
    expect(() => planTranscriptSources(['--stream-id', 'd', '--transcript'])).toThrow(/--transcript is missing its value/);
  });
});

describe('Story 5.6 AC2 — getAllFlagValues collects every occurrence in argv order', () => {
  it('returns all values for a repeated flag, in order, and [] when absent', () => {
    expect(getAllFlagValues(['--transcript', 'a', '--x', 'y', '--transcript', 'b'], 'transcript')).toEqual(['a', 'b']);
    expect(getAllFlagValues(['--journal', 'j'], 'transcript')).toEqual([]);
  });
});

describe('Story 5.6 AC2 — manifestToPlannedSources maps a validated manifest to the plan shape', () => {
  it('maps {transcript, streamId} entries to {path, streamId} (validated source → plan)', () => {
    const manifest = SessionManifestSchema.parse([
      { transcript: 'dev.jsonl', streamId: 'devid' },
      { transcript: 'fix.jsonl', streamId: 'fixid' },
    ]);
    expect(manifestToPlannedSources(manifest)).toEqual([
      { path: 'dev.jsonl', streamId: 'devid' },
      { path: 'fix.jsonl', streamId: 'fixid' },
    ]);
  });
});
