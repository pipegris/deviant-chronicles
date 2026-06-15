import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJSON } from '../interpret/freeze';
import { PLANTED_SECRET_EVENTS, PLANTED_SECRETS } from './__fixtures__/planted-secrets';
import { scrubSession, type ScrubResult } from './scrub';

// RED-PHASE acceptance test for Story 5.1 — AC2 (publish gate). It imports the not-yet-authored
// `./gate` (isPublishable, ScrubApproval, ScrubApprovalSchema, GateDecision), so it ERRORS now (RED —
// module resolution fails); turns GREEN when the dev authors src/scrub/gate.ts. [story Task 3]
//
// AC2 (verbatim): the gate BLOCKS when the scrub pass has not run (or its input no longer matches the
// scrubbed output) OR when no explicit manual-review approval marker is present, and PASSES only when
// BOTH a completed scrub AND a valid approval marker exist — refusing to emit an unscrubbed-or-
// unreviewed bundle. The marker binds an approval to a SPECIFIC scrubbed output (scrubHash) and report
// (reportHash) so an approval cannot be reused after the session/patterns change.
import {
  isPublishable,
  ScrubApprovalSchema,
  type ScrubApproval,
  type GateDecision,
} from './gate';

const scrubResult: () => ScrubResult = () => scrubSession(PLANTED_SECRET_EVENTS);

// reportHash = sha256(canonicalJSON(report)) — REUSE canonicalJSON from interpret/freeze.ts (the ONE
// canonical-JSON serializer; the story forbids a second). The same formula the gate must use internally.
function reportHashOf(result: ScrubResult): string {
  return createHash('sha256').update(canonicalJSON(result.report)).digest('hex');
}

// A schema-valid approval marker bound to a SPECIFIC scrub result (both hashes match). approvedBy/
// approvedAt are operator-recorded DATA, not gate-computed (the gate stays clock-free).
function validApproval(result: ScrubResult): ScrubApproval {
  return {
    $markerVersion: 1,
    scrubHash: result.scrubHash,
    reportHash: reportHashOf(result),
    approvedBy: 'operator@example.invalid',
    approvedAt: '2026-06-14T16:00:00.000Z',
  };
}

describe('Story 5.1 / AC2 — the gate BLOCKS an unscrubbed-or-unreviewed bundle', () => {
  it('BLOCKS with a null approval (unreviewed — no manual-review marker present)', () => {
    const decision: GateDecision = isPublishable({ scrubResult: scrubResult(), approval: null });
    expect(decision.ok).toBe(false);
    expect(decision.reasons.length).toBeGreaterThan(0);
  });

  it('BLOCKS when the approval`s scrubHash does NOT match (approval is for a DIFFERENT scrub)', () => {
    const result = scrubResult();
    const stale: ScrubApproval = { ...validApproval(result), scrubHash: 'deadbeef'.repeat(8) };
    const decision = isPublishable({ scrubResult: result, approval: stale });
    expect(decision.ok).toBe(false);
  });

  it('BLOCKS when the report was tampered/changed since approval (reportHash mismatch)', () => {
    const result = scrubResult();
    const tampered: ScrubApproval = { ...validApproval(result), reportHash: '0'.repeat(64) };
    const decision = isPublishable({ scrubResult: result, approval: tampered });
    expect(decision.ok).toBe(false);
  });

  it('BLOCKS on a schema-invalid marker (e.g. a bumped $markerVersion)', () => {
    const result = scrubResult();
    const bad = { ...validApproval(result), $markerVersion: 2 } as unknown as ScrubApproval;
    const decision = isPublishable({ scrubResult: result, approval: bad });
    expect(decision.ok).toBe(false);
  });
});

describe('Story 5.1 / AC2 — the gate self-validates the scrub result (R2 defense-in-depth)', () => {
  // A caller that VIOLATES the sole-producer contract — hand-mutating scrubbedEvents after scrubSession
  // produced the result, while keeping the stale scrubHash field — would otherwise slip through: the
  // approval is bound to the stale field, so both hash comparisons would match. The gate recomputes
  // scrubHash from scrubbedEvents + report.patternSetVersion and BLOCKS on the mismatch. [review R2]
  it('BLOCKS when scrubbedEvents were mutated after production (scrubHash no longer addresses them)', () => {
    const result = scrubResult();
    const approval = validApproval(result); // bound to the ORIGINAL (consistent) scrubHash + reportHash
    // Tamper: re-introduce a secret into the scrubbed output but KEEP the stale scrubHash field.
    const mutated: ScrubResult = {
      ...result,
      scrubbedEvents: [
        ...result.scrubbedEvents,
        { ...PLANTED_SECRET_EVENTS[0], eventId: 'evt-injected', payload: { leaked: PLANTED_SECRETS.token } },
      ],
    };
    const decision = isPublishable({ scrubResult: mutated, approval });
    expect(decision.ok).toBe(false);
    expect(decision.reasons.length).toBeGreaterThan(0);
  });

  it('the self-validation reason carries no secret value', () => {
    const result = scrubResult();
    const mutated: ScrubResult = {
      ...result,
      scrubbedEvents: [
        ...result.scrubbedEvents,
        { ...PLANTED_SECRET_EVENTS[0], eventId: 'evt-injected', payload: { leaked: PLANTED_SECRETS.token } },
      ],
    };
    const decision = isPublishable({ scrubResult: mutated, approval: validApproval(result) });
    const joined = decision.reasons.join(' | ');
    for (const value of Object.values(PLANTED_SECRETS)) {
      expect(joined).not.toContain(value);
    }
  });
});

describe('Story 5.1 / AC2 — the gate PASSES only with a completed scrub AND a matching valid approval', () => {
  it('PASSES with a schema-valid approval that matches BOTH the scrubHash and the reportHash', () => {
    const result = scrubResult();
    const decision = isPublishable({ scrubResult: result, approval: validApproval(result) });
    expect(decision.ok).toBe(true);
    expect(decision.reasons).toEqual([]);
  });
});

describe('Story 5.1 / AC2 — the hashes ACTUALLY content-address the output (round-trip, not hand-faked)', () => {
  // The BLOCK tests above fabricate a mismatching scrubHash/reportHash by hand. That proves the gate
  // COMPARES the fields, but not that a GENUINELY different scrub yields a different hash — a scrubHash
  // computed over a constant would pass every other test yet silently break the gate's binding. So drive
  // a real mutation: approve scrub A, then run scrub over a CHANGED session B and confirm (a) the hashes
  // actually differ, and (b) A's approval now BLOCKS B. This is the end-to-end content-address proof.
  function mutatedEvents(): typeof PLANTED_SECRET_EVENTS {
    // A genuinely different (still Zod-valid) session: append one extra event with a benign payload.
    return [
      ...PLANTED_SECRET_EVENTS,
      {
        ...PLANTED_SECRET_EVENTS[0],
        eventId: 'evt-extra',
        payload: { note: 'a different, benign string leaf' },
      },
    ];
  }

  it('a changed session yields a DIFFERENT scrubHash and reportHash (the hashes are not constants)', () => {
    const a = scrubResult();
    const b = scrubSession(mutatedEvents());
    expect(b.scrubHash).not.toBe(a.scrubHash);
    expect(reportHashOf(b)).not.toBe(reportHashOf(a));
  });

  it('an approval bound to scrub A BLOCKS a different scrub B (approve-once-ship-anything is closed)', () => {
    const a = scrubResult();
    const approvalForA = validApproval(a);
    const b = scrubSession(mutatedEvents());
    const decision = isPublishable({ scrubResult: b, approval: approvalForA });
    expect(decision.ok).toBe(false);
    expect(decision.reasons.length).toBeGreaterThan(0);
  });
});

describe('Story 5.1 / AC2 — the approval-marker schema fails CLOSED (.strict)', () => {
  it('a valid marker parses against ScrubApprovalSchema', () => {
    expect(() => ScrubApprovalSchema.parse(validApproval(scrubResult()))).not.toThrow();
  });

  it('a bumped $markerVersion is rejected (an old marker cannot be reused after a shape change)', () => {
    expect(() =>
      ScrubApprovalSchema.parse({ ...validApproval(scrubResult()), $markerVersion: 2 }),
    ).toThrow();
  });

  it('an unknown/extra key is rejected (.strict — no silent extra field)', () => {
    expect(() =>
      ScrubApprovalSchema.parse({ ...validApproval(scrubResult()), extra: 'nope' }),
    ).toThrow();
  });
});

describe('Story 5.1 / AC2 — gate decision reasons never leak a secret value', () => {
  it('BLOCK reasons reference hashes/ids only, never a planted secret', () => {
    // Exercise every BLOCK path and assert no reason string carries a planted value.
    const result = scrubResult();
    const decisions: GateDecision[] = [
      isPublishable({ scrubResult: result, approval: null }),
      isPublishable({ scrubResult: result, approval: { ...validApproval(result), scrubHash: 'x'.repeat(64) } }),
      isPublishable({ scrubResult: result, approval: { ...validApproval(result), reportHash: 'y'.repeat(64) } }),
    ];
    for (const decision of decisions) {
      const joined = decision.reasons.join(' | ');
      for (const value of Object.values(PLANTED_SECRETS)) {
        expect(joined).not.toContain(value);
      }
    }
  });
});
