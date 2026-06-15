import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJSON } from '../interpret/freeze';
import { type ReplayBundle } from '../schema/replay-bundle';
import type { BattleTimeline } from '../schema/battle-timeline';
import type { BeatAnnotation } from '../schema/beat-annotation';
import { scrubSession, type ScrubResult } from '../scrub/scrub';
import { reportHash, type ScrubApproval } from '../scrub/gate';
import { PLANTED_SECRET_EVENTS } from '../scrub/__fixtures__/planted-secrets';
import { assembleBundle, bundleHash, type AssembleBundleInput } from './assemble-bundle';

// dev-story UNIT tests for Story 5.2 / Task 2, on top of the ATDD acceptance file (assemble-bundle.
// test.ts). These pin behaviors the ATDD does not: a BLOCK surfaces EVERY gate reason; bundleHash is
// canonical (insertion-order-independent); a changed baked timeline shifts bundleHash; and the
// fail-closed schema-boundary catches a tampered approval shape the gate would otherwise pass.

const scrubResultOf = (): ScrubResult => scrubSession(PLANTED_SECRET_EVENTS);

function validApproval(result: ScrubResult): ScrubApproval {
  return {
    $markerVersion: 1,
    scrubHash: result.scrubHash,
    reportHash: reportHash(result.report),
    approvedBy: 'operator@example.invalid',
    approvedAt: '2026-06-14T16:00:00.000Z',
  };
}

function annotationsFor(): BeatAnnotation[] {
  return [
    {
      eventRef: 'evt-token',
      beatType: 'dispel',
      confidence: 0.8,
      interpreterVersion: 'fixture-v1',
      sourceHash: 'fixture',
      groundingPointer: { eventRefs: ['evt-token'] },
    },
  ];
}

function timelineFor(): BattleTimeline {
  return {
    schemaVersion: 1,
    beats: [
      {
        orderKey: { logicalClock: 0, streamId: 'main', seqWithinStream: 0 },
        actionType: 'spell',
        sourceEventIds: ['evt-token'],
        weight: 2,
        dwellMs: 800,
      },
    ],
    totalDurationMs: 800,
  };
}

function inputFor(overrides: Partial<AssembleBundleInput> = {}): AssembleBundleInput {
  const scrubResult = overrides.scrubResult ?? scrubResultOf();
  return {
    scrubResult,
    approval: 'approval' in overrides ? overrides.approval! : validApproval(scrubResult),
    annotations: overrides.annotations ?? annotationsFor(),
    interpreterVersion: overrides.interpreterVersion ?? 'fixture-v1',
    promptVersion: overrides.promptVersion ?? 'prompt-v1',
    battleTimeline: overrides.battleTimeline ?? timelineFor(),
    tuningConfig: overrides.tuningConfig ?? { someRule: 'value' },
    saga: 'saga' in overrides ? overrides.saga! : 'placeholder saga',
    assetManifest: overrides.assetManifest ?? { hero: 'assets/hero.png' },
  };
}

describe('Story 5.2 / Task 2 unit — a gate BLOCK surfaces ALL reasons in the thrown error', () => {
  it('a stale+report-mismatched approval throws an error naming both content addresses (not just one)', () => {
    // A doubly-wrong marker (both scrubHash AND reportHash differ) makes the gate accumulate TWO
    // reasons; the assembler must surface BOTH (it joins decision.reasons), so the operator sees the
    // full diagnosis. Neither reason carries a secret value (hashes/ids only).
    const result = scrubResultOf();
    const doublyStale: ScrubApproval = {
      ...validApproval(result),
      scrubHash: 'deadbeef'.repeat(8),
      reportHash: 'feedface'.repeat(8),
    };
    let message = '';
    try {
      assembleBundle(inputFor({ scrubResult: result, approval: doublyStale }));
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('stale or mismatched approval');
    expect(message).toContain('the report changed since approval');
  });
});

describe('Story 5.2 / Task 2 unit — bundleHash is canonical (insertion-order-independent)', () => {
  it('two structurally-equal bundles with different key insertion order hash identically', () => {
    const bundle = assembleBundle(inputFor());
    // Rebuild the SAME bundle with object keys inserted in a scrambled order. canonicalJSON sorts keys
    // recursively, so the content address must be identical — proving bundleHash is over CANONICAL
    // bytes, not insertion order (the Decision §3 reuse of freeze.ts canonicalJSON).
    const reordered = JSON.parse(
      JSON.stringify({
        scrub: bundle.scrub,
        annotationHash: bundle.annotationHash,
        assetManifest: bundle.assetManifest,
        saga: bundle.saga,
        tuningConfig: bundle.tuningConfig,
        battleTimeline: bundle.battleTimeline,
        annotations: bundle.annotations,
        // dev-story re-point (Story 5.5): the bundle field is `projectedEvents`, not `normalizedEvents`.
        projectedEvents: bundle.projectedEvents,
        schemaVersion: bundle.schemaVersion,
      }),
    ) as ReplayBundle;
    expect(bundleHash(reordered)).toBe(bundleHash(bundle));
    // And it equals the direct sha256(canonicalJSON(...)) — no hidden transform.
    expect(bundleHash(bundle)).toBe(
      createHash('sha256').update(canonicalJSON(bundle)).digest('hex'),
    );
  });
});

describe('Story 5.2 / Task 2 unit — a changed baked timeline shifts the whole-bundle hash', () => {
  it('a different totalDurationMs yields a different bundleHash (the timeline is part of the content)', () => {
    const a = assembleBundle(inputFor());
    const b = assembleBundle(
      inputFor({ battleTimeline: { ...timelineFor(), totalDurationMs: 1200 } }),
    );
    expect(bundleHash(b)).not.toBe(bundleHash(a));
  });
});

describe('Story 5.2 / Task 2 unit — assembleBundle validates the baked timeline against the shipped events (review F3)', () => {
  it('THROWS when a beat sourceEventId does not resolve to any normalizedEvents eventId (dangling beat ref)', () => {
    // review F3: the baked timeline's beat sourceEventIds are the Layer-0 grounding the portal resolves
    // onto the SHIPPED events (Decision §4). A timeline paced from DIFFERENT events (an alternate caller
    // NOT using pace(translate(scrubbedEvents))) carries beats whose sourceEventIds dangle — the assembler
    // must fail LOUD at the sole composition point, mirroring freezeAnnotations' dangling-grounding guard,
    // rather than composing a silently-inconsistent bundle.
    const mismatched: BattleTimeline = {
      schemaVersion: 1,
      beats: [
        {
          orderKey: { logicalClock: 0, streamId: 'main', seqWithinStream: 0 },
          actionType: 'spell',
          sourceEventIds: ['evt-not-in-the-shipped-events'],
          weight: 2,
          dwellMs: 800,
        },
      ],
      totalDurationMs: 800,
    };
    let message = '';
    try {
      assembleBundle(inputFor({ battleTimeline: mismatched }));
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('evt-not-in-the-shipped-events');
    expect(message).toContain('does not resolve');
  });

  it('PASSES when every beat sourceEventId resolves to a shipped event (the pace(translate(scrubbed)) path)', () => {
    // The honest path: a timeline whose beats reference the scrubbed eventIds (what the script computes)
    // composes without throwing — the guard does not fire on a correctly-paced bundle.
    expect(() => assembleBundle(inputFor())).not.toThrow();
  });
});

describe('Story 5.2 / Task 2 unit — a malformed approval is fail-closed (the gate uses .strict())', () => {
  it('a marker carrying an extra unknown key is rejected (assemble throws — never assembles)', () => {
    // ScrubApprovalSchema is .strict(), so an extra key makes isPublishable safeParse fail → the gate
    // BLOCKS ("schema-invalid") → assembleBundle throws before composing. This pins that a tampered
    // marker shape can NEVER produce a bundle (fail-closed), the same posture as a stale/null marker.
    const result = scrubResultOf();
    const tampered = {
      ...validApproval(result),
      extraKey: 'not allowed by the strict approval schema',
    } as unknown as ScrubApproval;
    let message = '';
    try {
      assembleBundle(inputFor({ scrubResult: result, approval: tampered }));
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('schema-invalid');
  });
});
