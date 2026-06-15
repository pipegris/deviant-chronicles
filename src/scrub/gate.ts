import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJSON } from '../interpret/freeze';
import type { ScrubResult, ScrubReport } from './scrub';

// Story 5.1 / AC2 — the PURE publish-gate predicate + the manual-review approval-marker contract. This is
// the privacy guardrail's ENFORCEMENT point: a public ReplayBundle MUST NOT be emitted unless (a) the
// scrub pass ran and its output still matches what was approved, AND (b) an explicit manual-review
// approval marker is present and binds to that exact scrubbed output + report.
//
// ── Story-5.2 WIRING SEAM (the contract this story DEFINES; 5.2 WIRES) ────────────────────────────────
// Story 5.2's bundle build (scripts/build-bundle.ts) MUST:
//   1. run `scrubSession(events)` → a ScrubResult,
//   2. load the operator-authored ScrubApproval marker (the human read the report and signed off),
//   3. call `isPublishable({ scrubResult, approval })`, and
//   4. ABORT the bundle write when `!decision.ok` (refuse to publish an unscrubbed-or-unreviewed bundle).
// This story DEFINES + tests the predicate + the marker schema. It does NOT do the fs/orchestration and
// does NOT edit src/schema/replay-bundle.ts — whether/how the marker is persisted alongside the bundle is
// Story 5.2's decision (TuningConfigSchema in replay-bundle.ts is the documented forward-reference precedent).
// ──────────────────────────────────────────────────────────────────────────────────────────────────────
//
// PURE: NO clock, NO RNG, NO network, NO fs (5.2 does the IO and CALLS this). `node:crypto` (sha256) +
// canonicalJSON (REUSED from interpret/freeze.ts — the ONE canonical-JSON serializer) only. The gate
// fails CLOSED: any mismatch / missing marker / schema-invalid marker returns ok:false, never throws on a
// bad marker (a bad marker is a BLOCK reason, not a crash). Reasons reference hashes/ids only — never a
// secret value (the report/scrub no-leak posture holds here too). SDK-free + phaser-free (r4-isolation grep).

// The manual-review approval marker. Binds an approval to a SPECIFIC scrubbed output (scrubHash) and a
// SPECIFIC report (reportHash) so an approval CANNOT be reused after the session or pattern set changes —
// if either changes, the hashes change and the old marker no longer matches → the gate BLOCKS. approvedBy/
// approvedAt are operator-recorded DATA (not gate-computed), keeping the predicate clock-free/deterministic.
export const ScrubApprovalSchema = z
  .object({
    // A future shape change bumps this so an old marker cannot be reused after the contract changes.
    $markerVersion: z.literal(1),
    scrubHash: z.string().min(1),
    reportHash: z.string().min(1),
    approvedBy: z.string().min(1),
    approvedAt: z.string().min(1),
  })
  .strict();

export type ScrubApproval = z.infer<typeof ScrubApprovalSchema>;

// The gate verdict: ok + the human-readable reasons it blocked (empty when ok). Reasons name hashes/ids
// only — NEVER a secret value (the load-bearing no-leak invariant the gate test asserts).
export interface GateDecision {
  ok: boolean;
  reasons: string[];
}

// reportHash = sha256(canonicalJSON(report)) — the content address of the manual-review report. The SAME
// formula the approval marker is bound to, so a tampered/changed report no longer matches its approval.
export function reportHash(report: ScrubReport): string {
  return createHash('sha256').update(canonicalJSON(report)).digest('hex');
}

// scrubHash recomputed FROM the result's own scrubbedEvents + report.patternSetVersion — the SAME formula
// scrubSession uses (scrub.ts: sha256(canonicalJSON(scrubbedEvents) + patternSetVersion)). The gate uses
// this to self-validate that scrubResult.scrubHash actually content-addresses scrubResult.scrubbedEvents,
// so a caller that VIOLATES the sole-producer contract (hand-mutating scrubbedEvents while reusing a stale
// scrubHash field) is caught and BLOCKED rather than trusted. [R2 — defense-in-depth]
function scrubHashOf(scrubResult: ScrubResult): string {
  return createHash('sha256')
    .update(canonicalJSON(scrubResult.scrubbedEvents) + scrubResult.report.patternSetVersion)
    .digest('hex');
}

/**
 * The publish-gate predicate: is this scrubbed Session publishable?
 *
 * Returns ok:false with reasons when:
 *   - scrubResult.scrubHash does not content-address its own scrubbedEvents (the result was mutated after
 *     scrubSession produced it — a sole-producer-contract violation; self-validated, R2);
 *   - approval === null (UNREVIEWED — no manual-review marker present);
 *   - the marker fails ScrubApprovalSchema (e.g. a bumped $markerVersion / an extra key / a missing field);
 *   - approval.scrubHash !== scrubResult.scrubHash (the approval is for a DIFFERENT scrub — stale/mismatched);
 *   - approval.reportHash !== sha256(canonicalJSON(scrubResult.report)) (the report changed since approval).
 * Returns ok:true (reasons: []) ONLY when a scrub result is present AND a schema-valid marker matches BOTH
 * hashes. PURE — clock-free, fail-closed. Reasons carry no secret value (hashes/ids only).
 */
export function isPublishable(args: {
  scrubResult: ScrubResult;
  approval: ScrubApproval | null;
}): GateDecision {
  const { scrubResult, approval } = args;
  const reasons: string[] = [];

  // Self-validate the result FIRST (defense-in-depth, R2): recompute scrubHash from the result's own
  // scrubbedEvents + report.patternSetVersion and BLOCK if it disagrees with the supplied scrubHash field.
  // The sole sanctioned producer (scrubSession) always yields a consistent result; a caller that
  // hand-mutated scrubbedEvents while keeping a stale scrubHash is caught here, BEFORE any approval is
  // trusted (the approval is bound to the stale field, so it would otherwise match). Fail-closed.
  if (scrubResult.scrubHash !== scrubHashOf(scrubResult)) {
    return {
      ok: false,
      reasons: [
        'scrubResult.scrubHash does not content-address its own scrubbedEvents — the scrub result was mutated after scrubSession produced it',
      ],
    };
  }

  if (approval === null) {
    // Fail closed AND short-circuit: with no marker there is no hash to compare, so this is the only reason.
    return { ok: false, reasons: ['no manual-review approval marker present (unreviewed)'] };
  }

  // A bad marker is a BLOCK reason, not a thrown error — safeParse so the gate never crashes on bad input.
  const parsed = ScrubApprovalSchema.safeParse(approval);
  if (!parsed.success) {
    return { ok: false, reasons: ['approval marker is schema-invalid (fails ScrubApprovalSchema)'] };
  }
  const marker = parsed.data;

  if (marker.scrubHash !== scrubResult.scrubHash) {
    // Reference the hashes (ids), never a value — the no-leak invariant.
    reasons.push(
      `approval scrubHash (${marker.scrubHash}) does not match the current scrubbed output (${scrubResult.scrubHash}) — stale or mismatched approval`,
    );
  }

  const expectedReportHash = reportHash(scrubResult.report);
  if (marker.reportHash !== expectedReportHash) {
    reasons.push(
      `approval reportHash (${marker.reportHash}) does not match the current report (${expectedReportHash}) — the report changed since approval`,
    );
  }

  return { ok: reasons.length === 0, reasons };
}
