import type { NormalizedEvent } from '../schema/normalized-event';
import type { ProjectedEvent } from '../schema/replay-bundle';
import { classifyRole } from './classify-role';

// Story 5.5 / Task 2 (AC1, AC5) — the PURE payload-free projector. The public ReplayBundle ships THIS
// projection instead of the full normalizedEvents: each event collapses to {orderKey, eventId,
// eventType, toolName, outcome, role}, DROPPING payload (file contents / prompts / command bodies /
// tool-output), the raw path, the file name, and any symbol name. The interpreter + Saga still read the
// FULL local session at bake time for quality; only what SHIPS shrinks to this projection (AC5).
//
// PURE + deterministic (R2): no Date.now / Math.random / IO / global-mutable state; same input →
// deep-equal output; never mutates the input events. SDK-free + phaser-free. [story Task 2; Dev Notes §1,§4]

// resolveTargetPath — the tool_use target the role classifier reads. MIRRORS translate.ts resolveTarget
// (file_path ?? path, trimmed-to-null) but re-derived minimally here on purpose: importing the Layer-0
// translate internal would couple src/bundle/ → src/translate/ (Dev Notes §3 — translate.resolveTarget
// is file-local and Layer-0; the lower-coupling choice is the two-line re-derivation). The path is read
// ONLY to feed classifyRole and is then DISCARDED — it is never carried into the projection.
function resolveTargetPath(event: NormalizedEvent): string | null {
  const payload = event.payload;
  if (payload === null || typeof payload !== 'object') return null;
  const input = (payload as { input?: unknown }).input;
  if (input === null || typeof input !== 'object') return null;
  const { file_path: filePath, path } = input as { file_path?: unknown; path?: unknown };
  const raw = typeof filePath === 'string' ? filePath : typeof path === 'string' ? path : null;
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Project scrubbed NormalizedEvents to the minimal payload-free ProjectedEvents the public bundle ships.
 *
 * Keeps ONLY the opaque identity ({orderKey, eventId} — both opaque, ref-stable per Dev Notes §1), the
 * abstracted structure (eventType, toolName), the per-event outcome (`isError ? 'isError' : 'success'`),
 * and the coarse role (classifyRole over the discarded target path). Carries NO payload/content forward.
 *
 * `outcome` is each event's OWN isError (Dev Notes §4): a tool_use is `success` (the call was issued);
 * its paired tool_result carries the real pass/fail. This is honest at the abstracted per-event level and
 * is intentionally NOT a cross-event correlation (that is the Layer-0 engine's job, already baked into
 * the timeline). PURE + deterministic; fresh objects, input untouched.
 */
export function projectEvents(events: NormalizedEvent[]): ProjectedEvent[] {
  return events.map((event) => ({
    orderKey: event.orderKey,
    eventId: event.eventId,
    eventType: event.eventType,
    toolName: event.toolName,
    outcome: event.isError ? 'isError' : 'success',
    role: classifyRole(resolveTargetPath(event)),
  }));
}
