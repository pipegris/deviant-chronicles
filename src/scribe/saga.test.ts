import { describe, expect, it } from 'vitest';
import { ReplayBundleSchema, type ReplayBundle } from '../schema/replay-bundle';

// RED-PHASE acceptance test for Story 4.2 — AC2: the SDK-FREE browser-reachable Saga READER. It
// imports the not-yet-authored `./saga` (readSaga), so it ERRORS now (RED — module resolution
// fails); it turns GREEN when the dev authors src/scribe/saga.ts as a PURE
// `readSaga(bundle: ReplayBundle): string | null` that returns `bundle.saga`.
//
// AC2 (verbatim, epics.md#Story-4.2): "Given the Replay at the victory milestone When it reaches the
// closing Then it displays the stored Saga with no runtime LLM call (offline-at-replay)."
//
// This file pins the READER half of AC2 (the offline-at-replay determinism): the reader returns the
// baked Saga string VERBATIM, returns `null` when the Saga is not yet authored (the explicit-null
// posture from Story 1.2 — NOT an error), and a baked-then-loaded Saga is BYTE-STABLE across a
// serialize/reload (the Saga is a plain string in the bundle JSON). The browser-path victory wiring
// (renderSaga? fires at the victory edge) is pinned separately in arena-boot-saga.test.ts.
import { readSaga } from './saga';

// RECORDED CHOICE (story Task 5 "build the fixture by ReplayBundleSchema.parse(...) — or a minimal
// typed literal if a full valid bundle is heavy; record the choice"): we build the fixture via the
// REAL ReplayBundleSchema.parse so the test exercises the actual schema, kept MINIMAL — empty
// projectedEvents/annotations/beats/records (all schema-legal: the array/record fields have no .min,
// battleTimeline allows an empty beats array). The ONLY field under test is `saga`; everything else is
// a valid skeleton. dev-story (Story 5.5): the per-event field is `projectedEvents` (payload-free), not
// `normalizedEvents`; empty is still schema-legal. [src/schema/replay-bundle.ts]
function makeBundle(saga: string | null): ReplayBundle {
  return ReplayBundleSchema.parse({
    schemaVersion: 1,
    projectedEvents: [],
    annotations: [],
    battleTimeline: { schemaVersion: 1, beats: [], totalDurationMs: 0 },
    tuningConfig: {},
    saga,
    assetManifest: {},
    annotationHash: 'mock-hash',
  });
}

const CANNED_SAGA =
  'And the Forgemaiden raised her hammer against the Hanging Curse of the Endless Wait, ' +
  'and when it was bound at last she cried: "By hammer and hash, it is done!"';

describe('Story 4.2 / AC2 — readSaga returns the baked Saga string verbatim', () => {
  it('returns the exact baked prose (byte-identical to the bundle field)', () => {
    const bundle = makeBundle(CANNED_SAGA);
    expect(readSaga(bundle)).toBe(CANNED_SAGA);
  });

  it('returns the value identically to bundle.saga (no transform / re-wrap)', () => {
    const bundle = makeBundle(CANNED_SAGA);
    expect(readSaga(bundle)).toBe(bundle.saga);
  });
});

describe('Story 4.2 / AC2 — readSaga returns null when the Saga is not yet authored', () => {
  it('returns null for the explicit-null (unauthored) posture, NOT an error', () => {
    const bundle = makeBundle(null);
    // The not-yet-authored posture is `null` (Story 1.2: explicit null). The reader surfaces it as
    // `null` — the victory wiring treats this as "no Saga to show", never an error / never a throw.
    expect(readSaga(bundle)).toBeNull();
  });
});

describe('Story 4.2 / AC2 — a baked-then-loaded Saga is BYTE-STABLE (offline-at-replay determinism)', () => {
  it('survives a JSON serialize/reload unchanged', () => {
    const bundle = makeBundle(CANNED_SAGA);
    // The Saga is a plain string in the bundle JSON; a serialize -> parse -> re-read round-trip must
    // yield the identical string (no in-browser recompute, no drift — NFR-5 offline-at-replay).
    const reloaded = JSON.parse(JSON.stringify(bundle)) as ReplayBundle;
    expect(readSaga(reloaded)).toBe(readSaga(bundle));
    expect(readSaga(reloaded)).toBe(CANNED_SAGA);
  });

  it('preserves a null Saga across a serialize/reload (still null, still not an error)', () => {
    const bundle = makeBundle(null);
    const reloaded = JSON.parse(JSON.stringify(bundle)) as ReplayBundle;
    expect(readSaga(reloaded)).toBeNull();
  });
});
