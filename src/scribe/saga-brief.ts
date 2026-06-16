import type { ProjectedEvent } from '../schema/replay-bundle';
import type { BeatAnnotation, BeatType } from '../schema/beat-annotation';
import type { BattleTimeline } from '../schema/battle-timeline';
import type { TeachingTable } from '../portal/teaching-config';

// Derive the role/outcome member types from ProjectedEvent itself (the already-public shape) so the brief
// reuses the SAME unions with ZERO drift and no second import path to keep in sync.
type AbstractedRole = ProjectedEvent['role'];
type Outcome = ProjectedEvent['outcome'];

// Story 5.8 (AC1, AC3) — the PURE, name-free Saga brief builder. The Story 5.7 real bake leaked real
// identifiers into the Opus SAGA prose because SagaAuthor was fed the snippet-bearing reduced tagging-view,
// whose `snippet` keeps Bash command heads / tool_result heads / assistant-text heads (real table/component/
// symbol names). The fix is STRUCTURAL, not a filter: author the Saga over the SAME name-free data the
// public ReplayBundle ALREADY ships (the Story 5.5 payload-free `projectedEvents` + the frozen `annotations`
// beats) + the safe authored `teaching.json` one-liners. The brief is name-free BY CONSTRUCTION (the leak is
// impossible, not merely filtered), so Layer-2/Told honors the Story 5.5 HARD LINE. [Dev Notes §0, §1]
//
// It is a plain `interface` — NOT Zod — because it is a TRANSIENT in-memory bake-prompt input (never a
// shippable artifact, never read from an untrusted source; the TaggingViewEvent / TeachingOp precedent).
// SDK-free + phaser-free + browser-UNREACHABLE (only scripts/* + its test import it). [Dev Notes §1]

// Story 5.8 Review F1 — the closed set of BUILT-IN tool names that are abstract-by-construction (a verb,
// never a product/integration identifier). `toolName` flows verbatim from a tool_use's `item.name`
// (normalize.ts:95) through `projectEvents` — the ingest allowlist keeps ANY tool name (`keepAllToolUse`),
// and no scrub pattern matches an `mcp__<product>__<action>` / custom tool name. So an MCP/custom tool name
// carries a real product/integration identifier into the brief → the Saga prompt — the one channel that was
// NOT name-free by construction. We neutralize any toolName outside this built-in set to the generic 'tool'
// token, restoring the name-free-BY-CONSTRUCTION guarantee for `toolName` too (not a behavioral belt). The
// set mirrors translation-rules.json's recognized verbs plus the remaining standard Claude Code built-ins.
const BUILT_IN_TOOL_NAMES: ReadonlySet<string> = new Set([
  'Bash',
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'Read',
  'Grep',
  'Glob',
  'Task',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
]);

const NEUTRAL_TOOL_NAME = 'tool';

function abstractToolName(toolName: string | null): string | null {
  if (toolName === null) return null;
  return BUILT_IN_TOOL_NAMES.has(toolName) ? toolName : NEUTRAL_TOOL_NAME;
}

// DROPS orderKey/eventId (§2 — opaque ids the Saga grounds NOTHING on; carrying them buys nothing).
export interface SagaBriefEvent {
  eventType: string;
  toolName: string | null; // a built-in verb, the neutral 'tool' token (for mcp__*/custom), or null
  role: AbstractedRole; // the Story 5.5 union (schema/replay-bundle)
  outcome: Outcome; // the Story 5.5 union (schema/replay-bundle)
}

// EXACTLY the narrative-arc fields of a frozen beat. `beatType` is the shaman | dispel | summon signal;
// `confidence` is the interpreter's 0–1 self-rating (order-preserving, the arc spine). DROPS
// eventRef/groundingPointer/sourceHash/interpreterVersion (§2 — those carry no narrative arc and the
// eventRefs are opaque content addresses the Saga has no use for).
export interface SagaBriefBeat {
  beatType: BeatType; // schema/beat-annotation
  confidence: number; // the 0–1 self-rating
}

// The compact, name-free, JSON-serializable brief the Saga author serializes into its prompt. Every field
// is a field-restriction of the already-PUBLIC surface (ProjectedEvent / BeatAnnotation / TeachingTable),
// so the brief ⊆ {projectedEvents, annotations} + teaching.json by construction (AC3's subset proof).
export interface SagaBrief {
  events: SagaBriefEvent[]; // from projectedEvents (Story 5.5), name-free
  beats: SagaBriefBeat[]; // from annotations (frozen), name-free
  teaching: TeachingTable; // the shaman/dispel/summon concepts (teaching.json) — safe narrative material
}

/**
 * Build the name-free Saga brief from ONLY the name-free public surface (AC1, AC3).
 *
 * DECISION — the OPTIONAL `arc` summary (§3): OMITTED by default. The projected events (in order, with
 * role/outcome) + the beats (the shaman/dispel/summon arc, in order, with confidence) + the teaching
 * concepts already give the Saga the full closing arc (the kingdom-spanning struggle → the binding-spell
 * fix → the victory). A name-free `battleTimeline` arc summary would add only numeric aggregates the beats
 * already imply, so the simpler events+beats+teaching brief is preferred. The `battleTimeline` arg stays
 * OPTIONAL so the builder supports a future arc without a signature change, and so the standalone caller
 * (scribe-saga.ts, which has no timeline in hand) can call it without one. It is currently UNUSED — read
 * (never carried) so no name leaks even if a future arc is added.
 *
 * PURE/deterministic: maps each ProjectedEvent → SagaBriefEvent keeping ONLY {eventType, toolName, role,
 * outcome} — toolName is neutralized to 'tool' for any non-built-in (MCP / custom) name so it stays
 * name-free by construction (Review F1); each BeatAnnotation → SagaBriefBeat keeping ONLY {beatType,
 * confidence}; passes `teaching` through verbatim (it is already the validated TeachingTable — three safe
 * one-liners). Fresh objects; inputs untouched.
 */
export function buildSagaBrief(args: {
  projectedEvents: ProjectedEvent[];
  annotations: BeatAnnotation[];
  teaching: TeachingTable;
  battleTimeline?: BattleTimeline;
}): SagaBrief {
  const { projectedEvents, annotations, teaching } = args;
  return {
    events: projectedEvents.map(
      (event): SagaBriefEvent => ({
        eventType: event.eventType,
        toolName: abstractToolName(event.toolName), // F1: mcp__*/custom → neutral 'tool' (name-free)
        role: event.role,
        outcome: event.outcome,
      }),
    ),
    beats: annotations.map(
      (annotation): SagaBriefBeat => ({
        beatType: annotation.beatType,
        confidence: annotation.confidence,
      }),
    ),
    teaching,
  };
}
