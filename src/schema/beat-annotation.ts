import { z } from 'zod';

// Exactly the three signature narrative beats the Interpreter tags (FR-2). Authored as a
// closed string-literal union (AC2); architecture names no others, so no others are added.
export const BeatTypeSchema = z.enum(['shaman', 'dispel', 'summon']);
export type BeatType = z.infer<typeof BeatTypeSchema>;

// Resolves a beat back to the Layer-0 event(s) it dramatizes (the portal's grounding
// feature). eventRefs is the FULL set — e.g. a Dispel spans an assumption event plus its
// ground-truth Read — distinct from the singular anchor `eventRef` on the annotation.
export const GroundingPointerSchema = z.object({
  eventRefs: z.array(z.string()),
});
export type GroundingPointer = z.infer<typeof GroundingPointerSchema>;

// EXACTLY the architecture-named fields (AC1). eventRef is the primary/anchor event id;
// groundingPointer.eventRefs is the full dramatized set. confidence is the interpreter's
// 0–1 self-rating. interpreterVersion + sourceHash make the annotation content-addressed.
export const BeatAnnotationSchema = z.object({
  eventRef: z.string(),
  beatType: BeatTypeSchema,
  // The interpreter's 0–1 self-rating: bounded so out-of-range values fail closed at this
  // Layer-1 gate rather than leaking into downstream gauge/threshold math.
  confidence: z.number().min(0).max(1),
  interpreterVersion: z.string(),
  sourceHash: z.string(),
  groundingPointer: GroundingPointerSchema,
});
export type BeatAnnotation = z.infer<typeof BeatAnnotationSchema>;
