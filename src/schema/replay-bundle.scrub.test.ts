import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// RED-PHASE acceptance test for Story 5.2 — Task 1: extend ReplayBundleSchema with the
// scrub/approval provenance block the Story 5.1 gate forward-referenced ("if ReplayBundle needs
// scrub/approval fields, ADD them to the 1.2 schema now"; TuningConfigSchema precedent).
//
// This file imports the NOT-YET-EXPORTED `ScrubProvenanceSchema` from ./replay-bundle, so it ERRORS
// now (RED — the named export does not exist); it turns GREEN when the dev (Task 1) adds:
//   export const ScrubProvenanceSchema = z.object({
//     scrubHash, reportHash, patternSetVersion, approval: ScrubApprovalSchema (from ../scrub/gate)
//   });
// and folds a NULLABLE field `scrub: ScrubProvenanceSchema.nullable()` into ReplayBundleSchema while
// keeping schemaVersion: z.literal(1) (an additive nullable field is backward-compatible — Decision §1).
//
// It is a SEPARATE file from replay-bundle.test.ts (the existing Story 1.2 green suite) so the
// pre-existing byte-for-byte round-trip there is not disturbed by the additive field — these tests
// pin ONLY the new scrub-provenance behavior (AC1: the bundle carries the scrub provenance; the gate
// verdict's content addresses are embedded so an auditor can re-verify the public events were scrubbed).
import {
  ReplayBundleSchema,
  ScrubProvenanceSchema,
  type ReplayBundle,
} from './replay-bundle';

const validOrderKey = { logicalClock: 0, streamId: 'main', seqWithinStream: 0 };

// dev-story re-point (Story 5.5): the bundle ships `projectedEvents` (payload-free), not the full
// `normalizedEvents`. Fixture updated to a valid ProjectedEvent; the Story 5.2 scrub-provenance
// assertions below are unaffected in intent (they pin the additive nullable `scrub` block).
const validProjectedEvent = {
  orderKey: validOrderKey,
  eventId: 'evt-0001',
  eventType: 'tool_use',
  toolName: 'Edit',
  outcome: 'success',
  role: 'source',
};

const validBeat = {
  orderKey: validOrderKey,
  actionType: 'melee',
  sourceEventIds: ['evt-0001'],
  weight: 1,
  dwellMs: 400,
};

const validAnnotation = {
  eventRef: 'evt-0001',
  beatType: 'dispel',
  confidence: 0.9,
  interpreterVersion: 'interp-v1',
  sourceHash: 'sha256:abc123',
  groundingPointer: { eventRefs: ['evt-0001'] },
};

// The populated scrub-provenance block (Decision §1): the content addresses that PROVE the public
// events were scrubbed + the operator's ScrubApproval marker (reused verbatim from src/scrub/gate.ts).
// approvedBy/approvedAt are operator-recorded DATA (mirrors src/scrub/gate.test.ts validApproval).
const validScrub = {
  scrubHash: 'a'.repeat(64),
  reportHash: 'b'.repeat(64),
  patternSetVersion: '1:0123456789abcdef',
  approval: {
    $markerVersion: 1,
    scrubHash: 'a'.repeat(64),
    reportHash: 'b'.repeat(64),
    approvedBy: 'operator@example.invalid',
    approvedAt: '2026-06-14T16:00:00.000Z',
  },
};

// A base bundle WITHOUT the scrub field set — the existing 1.2 fixtures stay valid by setting
// scrub: null (the additive-nullable backward-compatibility claim of Decision §1).
const baseBundle = {
  schemaVersion: 1,
  projectedEvents: [validProjectedEvent],
  annotations: [validAnnotation],
  battleTimeline: {
    schemaVersion: 1,
    beats: [validBeat],
    totalDurationMs: 400,
  },
  tuningConfig: { someRule: 'value' },
  saga: null,
  assetManifest: { hero: 'assets/hero.png' },
  annotationHash: 'sha256:deadbeef',
};

describe('Story 5.2 / Task 1 — ScrubProvenanceSchema (the gate verdict embedded in the bundle)', () => {
  it('parses a populated scrub-provenance block and round-trips it byte-for-byte', () => {
    // The scrub provenance is what an auditor re-verifies — so parse must neither drop nor reorder
    // any field (a dropped nested approval field would change the serialized bytes a hash is taken over).
    const value = ScrubProvenanceSchema.parse(validScrub);
    expect(value).toEqual(validScrub);
    expect(JSON.stringify(value)).toBe(JSON.stringify(validScrub));
  });

  it('rejects a malformed nested approval marker with a ZodError (a bumped $markerVersion)', () => {
    // The embedded approval reuses ScrubApprovalSchema (gate.ts) verbatim — a bumped $markerVersion is
    // a different contract and must fail closed at the schema boundary.
    const bad = { ...validScrub, approval: { ...validScrub.approval, $markerVersion: 2 } };
    expect(() => ScrubProvenanceSchema.parse(bad)).toThrow(z.ZodError);
  });

  it('rejects a scrub block missing a content address (no scrubHash)', () => {
    const { scrubHash: _omit, ...withoutScrubHash } = validScrub;
    void _omit;
    expect(() => ScrubProvenanceSchema.parse(withoutScrubHash)).toThrow(z.ZodError);
  });
});

describe('Story 5.2 / Task 1 — ReplayBundle carries an additive NULLABLE scrub field (backward-compatible)', () => {
  it('accepts an explicit null scrub (the existing 1.2 fixtures stay valid; explicit-null convention)', () => {
    // Decision §1: a NULLABLE additive field keeps schemaVersion: 1 valid. The prior 1.2 bundle plus
    // scrub: null must parse AND preserve scrub === null (explicit null over undefined — not stripped).
    const value: ReplayBundle = ReplayBundleSchema.parse({ ...baseBundle, scrub: null });
    expect(value.scrub).toBeNull();
  });

  it('accepts AND preserves a populated scrub provenance block on the bundle (round-trip)', () => {
    // AC1: the shippable bundle embeds the scrub provenance (content addresses + approval). The populated
    // block must survive parse intact — proving the field is part of the bundle contract, not stripped.
    const value: ReplayBundle = ReplayBundleSchema.parse({ ...baseBundle, scrub: validScrub });
    expect(value.scrub).toEqual(validScrub);
    expect(value.scrub?.approval.scrubHash).toBe('a'.repeat(64));
    // Byte-for-byte: the bundle JSON the hash is taken over preserves the nested provenance exactly.
    expect(JSON.stringify(value)).toBe(JSON.stringify({ ...baseBundle, scrub: validScrub }));
  });

  it('keeps schemaVersion pinned to 1 AND carries scrub as a parsed field (not stripped as unknown)', () => {
    const value = ReplayBundleSchema.parse({ ...baseBundle, scrub: null });
    expect(value.schemaVersion).toBe(1);
    // RED-load-bearing: today z.object STRIPS the unknown `scrub` key, so `scrub` is ABSENT from the
    // parsed value. This asserts the field is part of the contract (present, === null) — it fails until
    // the dev adds `scrub` to ReplayBundleSchema, distinguishing "field exists" from "key silently dropped".
    expect('scrub' in value).toBe(true);
    expect(value.scrub).toBeNull();
    // A bumped schemaVersion still fails closed even with the new field present.
    expect(() => ReplayBundleSchema.parse({ ...baseBundle, scrub: null, schemaVersion: 2 })).toThrow(
      z.ZodError,
    );
  });

  it('rejects a bundle whose scrub block has a malformed nested approval (ZodError propagates)', () => {
    const bad = {
      ...baseBundle,
      scrub: { ...validScrub, approval: { ...validScrub.approval, scrubHash: '' } },
    };
    expect(() => ReplayBundleSchema.parse(bad)).toThrow(z.ZodError);
  });
});
