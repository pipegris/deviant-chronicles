import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReplayBundleSchema } from '../schema/replay-bundle';
import { bundleHash } from './assemble-bundle';

// Story 5.2 / Task 5+6 — a guard test over the COMMITTED fixture-derived artifact
// public/bundles/story-10-1.json (the bundle that lets `pnpm dev`/`pnpm build` run end-to-end NOW).
// It must stay ReplayBundleSchema-valid and carry the baked timeline + scrub provenance + a (placeholder)
// Saga the committed dev build produces. A regression in the build script / schema / committed file is
// caught here. Reading the committed file in a node test is fine (tests are not Layer-0). The operator's
// --real bake regenerates this file with rich content (no code change) — this guard still holds then.

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

  it('carries the baked timeline, scrubbed events, frozen annotations, and a (placeholder) Saga', () => {
    const bundle = ReplayBundleSchema.parse(committedBundleRaw());
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.battleTimeline.beats.length).toBeGreaterThan(0);
    expect(bundle.normalizedEvents.length).toBeGreaterThan(0);
    expect(bundle.annotations.length).toBeGreaterThan(0);
    // The committed dev bundle carries the placeholder Saga (the deferred real bake replaces it).
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
