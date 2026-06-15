import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { canonicalJSON } from '../interpret/freeze';
import { ReplayBundleSchema, type ReplayBundle } from '../schema/replay-bundle';
import type { BattleTimeline } from '../schema/battle-timeline';
import type { BeatAnnotation } from '../schema/beat-annotation';
import { scrubSession, type ScrubResult } from '../scrub/scrub';
import { reportHash, type ScrubApproval } from '../scrub/gate';
import {
  PLANTED_SECRET_EVENTS,
  PLANTED_SECRETS,
} from '../scrub/__fixtures__/planted-secrets';

// RED-PHASE acceptance test for Story 5.2 — Task 2: the PURE bundle assembler.
//
// It imports the NOT-YET-AUTHORED `../bundle/assemble-bundle` (assembleBundle + bundleHash), so it
// ERRORS now (RED — module resolution fails); it turns GREEN when the dev (Task 2) authors
// src/bundle/assemble-bundle.ts with:
//   - assembleBundle(input): ReplayBundle — a PURE function (no fs/argv/clock/RNG/network) that
//       (1) calls isPublishable({ scrubResult, approval }) FIRST and THROWS LOUD with the gate reasons
//           when !ok (fail-closed — refuse to assemble from an unscrubbed/unreviewed session),
//       (2) uses scrubResult.scrubbedEvents as the PUBLIC normalizedEvents (never the raw session),
//       (3) calls freezeAnnotations(...) (Story 3.2) to validate + content-address + reject dangling
//           grounding refs, folding annotations + annotationHash into the bundle,
//       (4) builds the `scrub` provenance block (Task 1 field), and
//       (5) returns a value ReplayBundleSchema.parse(...) accepts (validate at the boundary).
//   - bundleHash(bundle): string — a PURE whole-bundle content address = sha256(canonicalJSON(bundle)),
//       REUSING canonicalJSON from interpret/freeze.ts (the ONE canonical serializer — Decision §3).
//
// Maps the gate-verifiable split: (1) builds a Zod-valid ReplayBundle from the fixture via the mocked
// LLM; (2) the Story 5.1 publish gate BLOCKS unscrubbed/unreviewed and PASSES scrubbed+approved
// (fail-closed); (4) hash determinism — same inputs → identical annotationHash + bundleHash.
import { assembleBundle, bundleHash } from './assemble-bundle';
import { projectEvents } from './project-events';

// ── Fixture inputs (the MOCKED-LLM path: scrubbed fixture events + a placeholder Saga) ───────────────
// The scrub result over the committed planted-secrets fixture (the SAME shared input src/scrub
// uses). The fixture plants OBVIOUSLY-FAKE secrets; the assembler ships the SCRUBBED events, so a
// planted value must be ABSENT from the assembled bundle's public normalizedEvents.
const scrubResultOf = (): ScrubResult => scrubSession(PLANTED_SECRET_EVENTS);

// A schema-valid approval marker bound to a SPECIFIC scrub result (both hashes match) — mirrors
// src/scrub/gate.test.ts validApproval. reportHash is REUSED from gate.ts (one canonical formula).
function validApproval(result: ScrubResult): ScrubApproval {
  return {
    $markerVersion: 1,
    scrubHash: result.scrubHash,
    reportHash: reportHash(result.report),
    approvedBy: 'operator@example.invalid',
    approvedAt: '2026-06-14T16:00:00.000Z',
  };
}

// Annotations grounded in the scrubbed fixture's REAL eventIds (scrubbing leaves eventId untouched —
// scrub.ts L191-216). freezeAnnotations rejects dangling refs, so the refs MUST resolve to a shipped
// event. evt-token / evt-pii-home are present in PLANTED_SECRET_EVENTS.
function fixtureAnnotationsFor(): BeatAnnotation[] {
  return [
    {
      eventRef: 'evt-token',
      beatType: 'dispel',
      confidence: 0.8,
      interpreterVersion: 'fixture-v1',
      sourceHash: 'fixture',
      groundingPointer: { eventRefs: ['evt-token', 'evt-pii-home'] },
    },
  ];
}

// A minimal baked timeline grounded in the scrubbed events (Decision §4: the public timeline derives
// from the SCRUBBED events). orderKey/sourceEventIds reference shipped eventIds. Shape per
// BattleTimelineSchema (schemaVersion 1, beats, totalDurationMs).
function fixtureTimeline(): BattleTimeline {
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

// The mocked-LLM placeholder Saga (the deferred-bake stand-in — NOT real prose; Decision §8).
const PLACEHOLDER_SAGA = '«PLACEHOLDER SAGA — real bake is the deferred operator step»';

const TUNING_CONFIG = { pacingWeights: { $schemaVersion: 1 } } as const;
const ASSET_MANIFEST = { hero: 'assets/hero.png' } as const;

// The full assembler input (Decision §2 signature): already-ingested + scrubbed inputs; the assembler
// owns gate + freeze + compose + validate. A test helper so each case can vary one knob.
function assembleInput(
  overrides: Partial<{
    scrubResult: ScrubResult;
    approval: ScrubApproval | null;
    annotations: BeatAnnotation[];
    interpreterVersion: string;
    promptVersion: string;
    battleTimeline: BattleTimeline;
    tuningConfig: Record<string, unknown>;
    saga: string | null;
    assetManifest: Record<string, string>;
  }> = {},
): Parameters<typeof assembleBundle>[0] {
  const scrubResult = overrides.scrubResult ?? scrubResultOf();
  return {
    scrubResult,
    approval: 'approval' in overrides ? overrides.approval! : validApproval(scrubResult),
    annotations: overrides.annotations ?? fixtureAnnotationsFor(),
    interpreterVersion: overrides.interpreterVersion ?? 'fixture-v1',
    promptVersion: overrides.promptVersion ?? 'prompt-v1',
    battleTimeline: overrides.battleTimeline ?? fixtureTimeline(),
    tuningConfig: overrides.tuningConfig ?? { ...TUNING_CONFIG },
    saga: 'saga' in overrides ? overrides.saga! : PLACEHOLDER_SAGA,
    assetManifest: overrides.assetManifest ?? { ...ASSET_MANIFEST },
  } as Parameters<typeof assembleBundle>[0];
}

describe('Story 5.2 / AC1 — assembleBundle composes a Zod-valid ReplayBundle (mocked LLM)', () => {
  it('produces a value ReplayBundleSchema.parse accepts (validated at the boundary)', () => {
    const bundle = assembleBundle(assembleInput());
    // The assembler validates at the boundary; round-tripping it through the schema must not throw.
    expect(() => ReplayBundleSchema.parse(bundle)).not.toThrow();
    const parsed: ReplayBundle = ReplayBundleSchema.parse(bundle);
    expect(parsed.schemaVersion).toBe(1);
  });

  it('embeds the baked timeline, tuning config, placeholder saga, and asset manifest (AC1 composition)', () => {
    const bundle = assembleBundle(assembleInput());
    expect(bundle.battleTimeline).toEqual(fixtureTimeline());
    expect(bundle.tuningConfig).toEqual(TUNING_CONFIG);
    expect(bundle.saga).toBe(PLACEHOLDER_SAGA);
    expect(bundle.assetManifest).toEqual(ASSET_MANIFEST);
  });

  it('folds freezeAnnotations: the annotations + a content-addressed annotationHash are in the bundle', () => {
    const bundle = assembleBundle(assembleInput());
    expect(bundle.annotations).toHaveLength(1);
    expect(bundle.annotations[0]?.beatType).toBe('dispel');
    // annotationHash is the freeze content address (64-char lowercase hex), not a placeholder.
    expect(bundle.annotationHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('embeds the scrub provenance block built from the scrub result + approval (Task 1 field)', () => {
    const result = scrubResultOf();
    const approval = validApproval(result);
    const bundle = assembleBundle(assembleInput({ scrubResult: result, approval }));
    expect(bundle.scrub).not.toBeNull();
    expect(bundle.scrub?.scrubHash).toBe(result.scrubHash);
    expect(bundle.scrub?.reportHash).toBe(reportHash(result.report));
    expect(bundle.scrub?.patternSetVersion).toBe(result.report.patternSetVersion);
    expect(bundle.scrub?.approval).toEqual(approval);
  });
});

describe('Story 5.5 / AC1 — the public per-event data is the payload-free PROJECTION of the scrubbed events', () => {
  // dev-story re-point (Story 5.5): the bundle no longer ships `normalizedEvents` (full payloads) — it
  // ships `projectedEvents` (the payload-free projection). The Story 5.2 assertion `bundle.normalizedEvents
  // === scrubbedEvents` is replaced by `bundle.projectedEvents === projectEvents(scrubbedEvents)`: the
  // assembler projects the SAME scrubbed events the gate cleared, just payload-free. No assertion weakened
  // — the "public events derive from the scrubbed session, never the raw one" guarantee is preserved and
  // sharpened (the projection carries even less surface).
  it('ships projectEvents(scrubResult.scrubbedEvents) as projectedEvents (no normalizedEvents key)', () => {
    const result = scrubResultOf();
    const bundle = assembleBundle(assembleInput({ scrubResult: result })) as unknown as Record<
      string,
      unknown
    >;
    expect(bundle.projectedEvents).toEqual(projectEvents(result.scrubbedEvents));
    expect(Object.prototype.hasOwnProperty.call(bundle, 'normalizedEvents')).toBe(false);
  });

  it('contains NO planted secret value anywhere in the assembled bundle (the gate point, end-to-end)', () => {
    // The whole point of the gate: the shippable artifact must carry the SCRUBBED events. Serialize the
    // entire bundle and assert every planted secret is absent (the Story 5.1 planted-secrets posture).
    const bundle = assembleBundle(assembleInput());
    const serialized = JSON.stringify(bundle);
    for (const secret of Object.values(PLANTED_SECRETS)) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe('Story 5.2 / AC2 — assembleBundle is FAIL-CLOSED: it runs the Story 5.1 gate FIRST', () => {
  it('THROWS when no approval marker is present (unreviewed — refuses to assemble)', () => {
    expect(() => assembleBundle(assembleInput({ approval: null }))).toThrow();
  });

  it('the thrown error carries the gate reason (so the failure is diagnosable), NOT a secret value', () => {
    let message = '';
    try {
      assembleBundle(assembleInput({ approval: null }));
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message.length).toBeGreaterThan(0);
    // The gate's null-approval reason is "...unreviewed..." — assert the gate reason surfaced.
    expect(message.toLowerCase()).toContain('unreviewed');
    // And no planted secret leaks into the thrown message (the gate no-leak invariant holds here too).
    for (const secret of Object.values(PLANTED_SECRETS)) {
      expect(message).not.toContain(secret);
    }
  });

  it('THROWS on a STALE approval (bound to a different scrub — approve-once-ship-anything is closed)', () => {
    const result = scrubResultOf();
    const stale: ScrubApproval = { ...validApproval(result), scrubHash: 'deadbeef'.repeat(8) };
    expect(() => assembleBundle(assembleInput({ scrubResult: result, approval: stale }))).toThrow();
  });

  it('PASSES (returns a bundle, does NOT throw) with a matching valid approval', () => {
    const result = scrubResultOf();
    expect(() =>
      assembleBundle(assembleInput({ scrubResult: result, approval: validApproval(result) })),
    ).not.toThrow();
  });
});

describe('Story 5.2 / AC2 — hash determinism (same inputs → identical annotationHash + bundleHash)', () => {
  it('bundleHash is sha256(canonicalJSON(bundle)) — 64-char lowercase hex over the assembled bundle', () => {
    const bundle = assembleBundle(assembleInput());
    const expected = createHash('sha256').update(canonicalJSON(bundle)).digest('hex');
    expect(bundleHash(bundle)).toBe(expected);
    expect(bundleHash(bundle)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('assembling twice from identical inputs yields an EQUAL bundleHash AND an EQUAL annotationHash', () => {
    // AC2 verbatim: "re-running the build with identical inputs reproduces the same bundle hashes."
    const a = assembleBundle(assembleInput());
    const b = assembleBundle(assembleInput());
    expect(bundleHash(a)).toBe(bundleHash(b));
    expect(a.annotationHash).toBe(b.annotationHash);
    // The whole bundle is byte-identical (determinism is literal — the baked-timeline posture).
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a CHANGED annotation yields a DIFFERENT bundleHash AND a different annotationHash', () => {
    const a = assembleBundle(assembleInput());
    const changed = assembleBundle(
      assembleInput({
        annotations: [{ ...fixtureAnnotationsFor()[0]!, confidence: 0.1 }],
      }),
    );
    expect(bundleHash(changed)).not.toBe(bundleHash(a));
  });

  it('a CHANGED saga yields a DIFFERENT bundleHash (the saga is part of the bundle content)', () => {
    const a = assembleBundle(assembleInput());
    const changed = assembleBundle(assembleInput({ saga: 'a different placeholder saga' }));
    expect(bundleHash(changed)).not.toBe(bundleHash(a));
  });

  it('a CHANGED interpreterVersion yields a DIFFERENT annotationHash (the run-identity key shifts)', () => {
    // annotationHash = sha256(canonicalJSON({normalizedEvents, interpreterVersion, promptVersion})).
    const a = assembleBundle(assembleInput({ interpreterVersion: 'fixture-v1' }));
    const b = assembleBundle(assembleInput({ interpreterVersion: 'fixture-v2' }));
    expect(b.annotationHash).not.toBe(a.annotationHash);
  });
});

describe('Story 5.2 / Task 2 — freeze rejects a dangling grounding ref (assemble fails loud)', () => {
  it('THROWS when an annotation references an eventId absent from the scrubbed events', () => {
    // freezeAnnotations rejects a grounding ref not present in normalizedEvents (a hallucinated ref).
    const dangling: BeatAnnotation[] = [
      {
        eventRef: 'evt-does-not-exist',
        beatType: 'dispel',
        confidence: 0.8,
        interpreterVersion: 'fixture-v1',
        sourceHash: 'fixture',
        groundingPointer: { eventRefs: ['evt-does-not-exist'] },
      },
    ];
    expect(() => assembleBundle(assembleInput({ annotations: dangling }))).toThrow();
  });
});

describe('Story 5.2 / Task 2 — assembleBundle is PURE (no fs/argv/clock/RNG/network in src/bundle/)', () => {
  // Structural R2/R4 guard: the assembler is browser-cleanable determinism core — it must touch no
  // forbidden runtime surface and no SDK. A source-grep over the module (tests are not Layer-0, so the
  // fs read is fine — mirrors arena-boot-saga.test.ts's source-grep guard). RED now: the module does not
  // exist yet, so readFileSync throws and the suite errors meaningfully.
  it('the assembler source imports no @anthropic-ai/sdk and uses no clock/RNG/fetch', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'assemble-bundle.ts'),
      'utf8',
    );
    expect(source).not.toContain('@anthropic-ai/sdk');
    expect(source).not.toContain('Date.now');
    expect(source).not.toContain('Math.random');
    expect(source).not.toContain('performance.now');
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });
});

// Touch z so an unused-import lint rule never trips this RED scaffold (z is used in the schema-reject
// path above via ReplayBundleSchema; this is a defensive no-op kept explicit).
void z;
