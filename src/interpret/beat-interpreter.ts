import type { NormalizedEvent } from '../schema/normalized-event';
import type { BeatAnnotation } from '../schema/beat-annotation';

// The Layer-1 entry seam (FR-2): turns Layer-0 NormalizedEvent[] into the read-only
// BeatAnnotation[] overlay that NEVER feeds mechanics (R1).
//
// ASYNC by design: the real impl (claude-interpreter.ts, Story 3.2) makes an
// @anthropic-ai/sdk network call, so the interface must be Promise-typed NOW or 3.2 re-opens
// it and breaks every consumer. The FixtureInterpreter satisfies it with an already-resolved
// array — still deterministic + offline (async adds no clock/RNG).
export interface BeatInterpreter {
  interpret(events: NormalizedEvent[]): Promise<BeatAnnotation[]>;
}
