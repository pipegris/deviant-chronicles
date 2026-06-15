import { z } from 'zod';

// Story 5.6 / Task 3 (AC2, §7) — the validated --session-manifest loader. The operator's full-session
// bake supplies a checked-in JSON manifest listing the session's transcript streams (dev + fix + ...);
// build-bundle.ts reads the file and validates it HERE before handing the sources to ingestSession.
//
// .strict() is load-bearing (fail-CLOSED on a malformed/extra-keyed table — the scrub-patterns.ts
// validated-config precedent): a manifest carrying an unknown key or a non-string path/streamId throws
// at the boundary rather than silently ingesting a wrong stream set. The schema lives in src/bundle/ (not
// inline in the script) so vitest covers the fail-closed contract (the thin-script precedent §4).

export const SessionManifestSchema = z
  .array(
    z
      .object({
        transcript: z.string(),
        streamId: z.string(),
      })
      .strict(),
  )
  .min(1);
export type SessionManifest = z.infer<typeof SessionManifestSchema>;
