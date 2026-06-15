import { z } from 'zod';

// Story 5.1 — the manual-review approval marker SHAPE, as a CRYPTO-FREE leaf module.
//
// It lives here (not inline in gate.ts) so the BROWSER-reachable bundle schema (src/schema/replay-
// bundle.ts embeds this in its scrub-provenance field) can import the marker shape WITHOUT pulling
// gate.ts's `node:crypto` (via interpret/freeze.ts canonicalJSON) into the browser bundle — node
// builtins are not browser-available and would break the Vite build. gate.ts re-exports these so its
// existing importers (gate.test.ts) are unchanged; the gate LOGIC (the crypto-using predicate) stays
// in gate.ts. This is the same leaf-split posture as scrub-patterns.ts vs scrub.ts. SDK-free + phaser-
// free (no R4/R5 surface). [architecture.md#R4; story Task 1 Decision §1]

// The marker binds an approval to a SPECIFIC scrubbed output (scrubHash) and a SPECIFIC report
// (reportHash) so an approval CANNOT be reused after the session or pattern set changes — if either
// changes, the hashes change and the old marker no longer matches → the gate BLOCKS. approvedBy/
// approvedAt are operator-recorded DATA (not gate-computed), keeping the predicate clock-free. Field
// order is FIXED so the marker round-trips byte-for-byte where embedded (a hash is taken over it).
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
