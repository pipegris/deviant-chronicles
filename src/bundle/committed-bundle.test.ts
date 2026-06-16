import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReplayBundleSchema } from '../schema/replay-bundle';
import { bundleHash } from './assemble-bundle';

// Story 5.2 / Task 5+6 (rescoped at Story 5.9) — a guard test over the COMMITTED
// public/bundles/story-10-1.json. Since the Story 5.7/5.8 publish this is the FROZEN REAL-session bundle
// (chunked `claude -p` interpret + the name-safe Saga); before publish it is the fixture build. This guard
// is CONTENT-AGNOSTIC — it pins what must hold for EITHER: ReplayBundleSchema-valid, baked timeline +
// payload-free projection + frozen annotations + a present Saga, scrub provenance that binds, computable
// hashes, and (Story 5.8) a structurally name-safe Saga. The boot suites' fixture content lives separately
// in src/render/__fixtures__/fixture-bundle.json (Story 5.9), so this guard pins no fixture-specific value.
// Reading the committed file in a node test is fine (tests are not Layer-0).

function committedBundleRaw(): unknown {
  // The committed artifact lives at <repo>/public/bundles/story-10-1.json; this file is src/bundle/.
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'public',
    'bundles',
    'story-10-1.json',
  );
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('Story 5.2 — the committed public/bundles/story-10-1.json is a valid shippable bundle', () => {
  it('parses against ReplayBundleSchema (the artifact the boot loads at replay)', () => {
    expect(() => ReplayBundleSchema.parse(committedBundleRaw())).not.toThrow();
  });

  it('carries the baked timeline, the payload-free projected events, frozen annotations, and a Saga', () => {
    const bundle = ReplayBundleSchema.parse(committedBundleRaw());
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.battleTimeline.beats.length).toBeGreaterThan(0);
    // dev-story re-point (Story 5.5): the bundle ships `projectedEvents` (payload-free), not the full
    // `normalizedEvents`. The byte-absence + five-key + bounded-size proofs live in the dedicated
    // committed-bundle.payload-free.test.ts (AC1/AC2); here we pin the composition + provenance + hashes.
    expect(bundle.projectedEvents.length).toBeGreaterThan(0);
    expect(bundle.annotations.length).toBeGreaterThan(0);
    // The committed bundle carries a Saga (the fixture placeholder before publish; the real name-safe
    // Saga after the Story 5.8 bake is published) — assert only that it is present (content-agnostic).
    expect(bundle.saga).not.toBeNull();
  });

  it('embeds the scrub provenance proving the public events were scrubbed + approved (the gate verdict)', () => {
    const bundle = ReplayBundleSchema.parse(committedBundleRaw());
    expect(bundle.scrub).not.toBeNull();
    expect(bundle.scrub?.scrubHash).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.scrub?.reportHash).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.scrub?.approval.$markerVersion).toBe(1);
    // The embedded approval MUST bind to THIS bundle's own scrub content addresses — that binding is the
    // gate's pass condition (gate.ts: approval.scrubHash === scrubResult.scrubHash AND approval.reportHash
    // === reportHash(report)). A bundle whose approval points at a DIFFERENT scrub is one the fail-closed
    // assembler could NEVER have emitted (a forged / regressed artifact). The shape-only checks above pass
    // even for such a mismatch, so without this the guard would green-light a bundle that bypassed the gate.
    expect(bundle.scrub?.approval.scrubHash).toBe(bundle.scrub?.scrubHash);
    expect(bundle.scrub?.approval.reportHash).toBe(bundle.scrub?.reportHash);
  });

  it('has a content-addressed annotationHash and a computable bundleHash (determinism anchors)', () => {
    const bundle = ReplayBundleSchema.parse(committedBundleRaw());
    expect(bundle.annotationHash).toMatch(/^[0-9a-f]{64}$/);
    expect(bundleHash(bundle)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Story 5.8/5.9 — the committed bundle is structurally name-safe (Saga-leak regression guard)', () => {
  // The Story 5.7 real bake's Saga leaked real identifiers because SagaAuthor was fed the snippet-bearing
  // tagging-view; Story 5.8 authors it over the name-free public surface. This guards that regression
  // STRUCTURALLY — by the SHAPE of a leak (path separators / source-file extensions / snake_case
  // table-or-symbol tokens), NOT by hard-coding any real identifier (which would itself leak it into this
  // public repo). Content-agnostic: passes on the fixture placeholder Saga AND the real name-safe Saga.
  it('the committed Saga carries no path separators, source-file extensions, or snake_case identifiers', () => {
    const bundle = ReplayBundleSchema.parse(committedBundleRaw());
    const saga = bundle.saga ?? '';
    expect(saga).not.toMatch(/[/\\]/); // a path separator is a leaked path
    expect(saga).not.toMatch(/\.(ts|tsx|js|jsx|mjs|json|sql|env)\b/i); // a file extension is a leaked file
    expect(saga).not.toMatch(/\b[a-z]+_[a-z_]+\b/); // snake_case = a leaked table/column/env-var/symbol
  });

  it('the serialized bundle carries no per-event payload or content (the shipped surface stays projected)', () => {
    const serialized = JSON.stringify(committedBundleRaw());
    expect(serialized).not.toContain('"payload"');
    expect(serialized).not.toContain('"content"');
  });
});
