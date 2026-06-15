import { describe, expect, it } from 'vitest';
import { SessionManifestSchema } from './session-manifest';

// Story 5.6 / Task 3 (AC2, §7) — the --session-manifest loader's fail-CLOSED contract. A well-formed
// manifest parses to the typed source list; a malformed one (unknown key, missing/wrong-typed field,
// empty array, non-array) throws at the boundary so the bake never ingests a wrong stream set.

describe('Story 5.6 AC2 — SessionManifestSchema validates the transcript-source table fail-closed', () => {
  it('parses a well-formed manifest into [{transcript, streamId}, ...]', () => {
    const manifest = [
      { transcript: 'a/dev.jsonl', streamId: 'dev1' },
      { transcript: 'a/fix.jsonl', streamId: 'fix1' },
    ];
    expect(SessionManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it('rejects an entry carrying an unknown key (.strict — defense against a typo/extra field)', () => {
    expect(() =>
      SessionManifestSchema.parse([{ transcript: 'a/dev.jsonl', streamId: 'dev1', extra: 'x' }]),
    ).toThrow();
  });

  it('rejects a missing streamId, a non-string field, an empty array, and a non-array', () => {
    expect(() => SessionManifestSchema.parse([{ transcript: 'a/dev.jsonl' }])).toThrow();
    expect(() => SessionManifestSchema.parse([{ transcript: 1, streamId: 'dev1' }])).toThrow();
    expect(() => SessionManifestSchema.parse([])).toThrow();
    expect(() => SessionManifestSchema.parse({ transcript: 'a', streamId: 'b' })).toThrow();
  });
});
