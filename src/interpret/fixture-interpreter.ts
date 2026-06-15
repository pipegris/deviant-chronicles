import type { NormalizedEvent } from '../schema/normalized-event';
import { BeatAnnotationSchema, type BeatAnnotation } from '../schema/beat-annotation';
import type { BeatInterpreter } from './beat-interpreter';

// The deterministic CI test double for the BeatInterpreter seam: FIXED hand-authored
// annotations so the beat system is testable with ZERO LLM calls (the real LLM is never
// called in CI). Deliberately SDK-FREE — interpret/ is an R4-allowed zone, but pulling the
// LLM SDK in here would defeat this double's whole purpose; lint permits it, so the test's
// source-grep is the real guard. No clock/RNG/network/fs (annotations are literals).

// Two annotations against the committed fixture's real eventIds (the 14-event ingest
// snapshot). A Dispel on the "assumption + ground-truth Read" pair and a Shaman on the
// "failed test + diagnostic re-read" root-cause pair — the two beats the thin redacted slice
// genuinely supports. Summon is OMITTED: the fixture has no sub-agent-spawn event, so a
// synthetic Summon would be a FALSE grounding (the rich real beats come from the full session
// at bundle time, 3.2/Epic 5). sourceHash is a fixed literal — the fixture is not
// content-addressed; the real sha256 is Story 3.2.
const FIXTURE_ANNOTATIONS: readonly BeatAnnotation[] = [
  {
    eventRef: 'u-0002#1',
    beatType: 'dispel',
    confidence: 0.8,
    interpreterVersion: 'fixture-v1',
    sourceHash: 'fixture',
    groundingPointer: { eventRefs: ['u-0002#1', 'u-0002#2', 'u-0003#0'] },
  },
  {
    eventRef: 'u-0010#0',
    beatType: 'shaman',
    confidence: 0.7,
    interpreterVersion: 'fixture-v1',
    sourceHash: 'fixture',
    groundingPointer: { eventRefs: ['u-0009#0', 'u-0010#0'] },
  },
];

// The fixed fixture annotations, validated + returned SYNCHRONOUSLY. Extracted from interpret() so a
// SYNCHRONOUS consumer (the Story 3.3 browser boot, which threads the read-only overlay before its
// first synchronous tick) can obtain the same deterministic annotations without the async seam — the
// dev/CI double does no real async work, so this is the same content interpret() returns, just not
// Promise-wrapped. The async BeatInterpreter seam (for the real LLM impl) is UNCHANGED: interpret()
// still satisfies it by awaiting this. Each literal is BeatAnnotationSchema.parse'd — the Layer-1
// boundary-validation mandate, and a loud guard if a future edit breaks the shape.
export function fixtureAnnotations(): BeatAnnotation[] {
  return FIXTURE_ANNOTATIONS.map((a) => BeatAnnotationSchema.parse(a));
}

export class FixtureInterpreter implements BeatInterpreter {
  // The annotations are pre-authored against KNOWN eventIds, so the double is
  // content-independent by design and does not read its input. `void _events` is the
  // codebase's intentional-unused convention (matches the `void _omit` pattern in the schema
  // tests) — it satisfies both tsc noUnusedParameters and eslint no-unused-vars. Delegates to the
  // synchronous fixtureAnnotations() (same content) so the async seam wraps one source of truth.
  async interpret(_events: NormalizedEvent[]): Promise<BeatAnnotation[]> {
    void _events;
    return fixtureAnnotations();
  }
}
