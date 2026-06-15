import type { NormalizedEvent } from '../schema/normalized-event';
import type { BeatAnnotation, BeatType } from '../schema/beat-annotation';
import type { AnnotatedView } from '../interpret/overlay';
import { LEGEND } from './legend-config';

// portal — the PURE, phaser-free transparency-portal core (FR-11, UJ-2): the ON-DEMAND Legend's
// coverage surface + the grounding RESOLVER, the on-demand sibling of the Story 4.3 always-on teaching
// planner one layer over in portal/. It exposes the fantasy<->real coverage (getLegendEntries, read from
// the templated config-as-data table) and resolveGrounding — given an active beat's annotation, the REAL
// Layer-0 NormalizedEvent(s) it dramatizes, resolved against the read-only Layer-1 overlay (fantasy ->
// real). ZERO phaser: selection/content/resolution live here; the on-screen DISPLAY lives in
// render/legend-overlay.ts. [story Task 2; Dev Notes #1, #4]
//
// LAYER & PURITY DISCIPLINE (R1, the load-bearing property): the portal is a Layer-1-CONSUMER (reads the
// frozen read-only AnnotatedView) + Layer-0-READER (returns the events the overlay carries) that writes
// NOTHING back into mechanics. resolveGrounding returns `readonly NormalizedEvent[]` read SIDE-BY-SIDE
// from the overlay (referential identity — see the test); it constructs/returns NO BattleState/Beat and
// writes NO mechanics field (problemIntegrity / resolve / insightGauge / hp / weight). It imports
// everything as TYPES. [architecture.md#R1 L225-228; interpret/overlay.ts L4-9]
//
// PURE + deterministic: no Date.now / Math.random / IO / module-mutable state; the same inputs yield a
// deep-equal output; mutates neither input.

// The four CORE actions the AC enumerates (strike/edit, spell/test, scout/read, Aether Storm/rate-limit)
// -> a closed string-literal union that is a SUBSET of ActionType. `summon` is a BEAT (a Legend `beats`
// row), and `counter`/`idle` are NOT core actions the viewer needs the Legend for, so they are
// deliberately excluded — the union, the LEGEND_ACTIONS list, the config schema, and the coverage test
// all agree on exactly these four. [story Dev Notes #3; schema/normalized-event.ts L19-27]
export type LegendActionType = 'melee' | 'spell' | 'scout' | 'aetherStorm';

// The closed coverage DOMAINS the renderer and the coverage gate iterate over ONE canonical list each.
// LEGEND_BEATS is the three signature BeatType members; LEGEND_ACTIONS is the four core LegendActionType
// members. `as const` makes them readonly literal tuples (no numeric enum — string-literal unions only).
export const LEGEND_BEATS: readonly BeatType[] = ['shaman', 'dispel', 'summon'] as const;
export const LEGEND_ACTIONS: readonly LegendActionType[] = ['melee', 'spell', 'scout', 'aetherStorm'] as const;

// LegendEntry — one display-ready fantasy<->real row, the renderer's content feed AND the coverage
// gate's surface. `kind` distinguishes a beat row from an action row (so the renderer can group them);
// `key` is the beat/action key; fantasy/real are the mapping strings read straight from the validated
// LEGEND table (never invented here). Plain `type`, NOT Zod — TRANSIENT in-memory view data consumed
// within the UI, never serialized (the TeachingOp / CaptionOp precedent). [story Task 2]
export type LegendEntry = {
  kind: 'beat' | 'action';
  key: BeatType | LegendActionType;
  fantasy: string;
  real: string;
};

// getLegendEntries — the PURE accessor returning the FULL covered set as a flat, ordered, display-ready
// list: beats first (in LEGEND_BEATS order), then actions (in LEGEND_ACTIONS order), each row read
// straight from the validated LEGEND table. This is the AC1 coverage surface — every LEGEND_BEATS and
// LEGEND_ACTIONS key is present exactly once with its non-empty fantasy<->real pair. Builds a fresh array
// each call (no shared mutable state). [story Task 2 "getLegendEntries(): LegendEntry[]"; AC1]
export function getLegendEntries(): LegendEntry[] {
  const entries: LegendEntry[] = [];
  for (const beat of LEGEND_BEATS) {
    const row = LEGEND.beats[beat];
    entries.push({ kind: 'beat', key: beat, fantasy: row.fantasy, real: row.real });
  }
  for (const action of LEGEND_ACTIONS) {
    const row = LEGEND.actions[action];
    entries.push({ kind: 'action', key: action, fantasy: row.fantasy, real: row.real });
  }
  return entries;
}

// resolveGrounding — the AC2 core (fantasy -> real): given an active beat's annotation, resolve its
// groundingPointer.eventRefs (the FULL set of Layer-0 event ids the beat dramatizes) to the REAL
// NormalizedEvent(s) they reference, looked up in the read-only `view` by eventId, returned in eventRefs
// ORDER. The resolved events are the SAME Layer-0 truth the overlay carries (read side-by-side, not
// rebuilt) — every explanation is accurate to the real Event (AC2). [story Task 2; Dev Notes #4]
//
// DANGLING-REF POLICY: FAIL LOUD (throw). The overlay is built from the SAME committed events the
// annotations were authored against, and Story 3.1/3.2 already enforce "every groundingPointer.eventRef
// resolves to a real eventId (no dangling)" as a build-time invariant (freezeAnnotations throws on a
// dangling ref). So a dangling ref at portal-resolve time is a CORRUPT-overlay programmer error, NOT a
// runtime-viewer condition — fail loud (the fail-closed-LOUD-at-build posture), do NOT silently drop.
// This is a DIFFERENT boundary from the replay-time fail-closed-to-default (an unmapped untrusted EVENT
// gets a neutral idle beat); a frozen-overlay dangling ref is corruption. Do NOT "fix" this to a silent
// skip. [story Dev Notes #4; architecture.md#fail-loud L280-281]
export function resolveGrounding(
  annotation: BeatAnnotation,
  view: AnnotatedView,
): readonly NormalizedEvent[] {
  return annotation.groundingPointer.eventRefs.map((ref) => {
    const event = view.events.find((e) => e.eventId === ref);
    if (!event) {
      throw new Error(
        `resolveGrounding: dangling groundingPointer.eventRef "${ref}" (beat "${annotation.beatType}") ` +
          `does not resolve to any Layer-0 event in the overlay — a corrupt-overlay invariant violation ` +
          `(Story 3.1/3.2 guarantee no dangling refs). Refusing to silently drop.`,
      );
    }
    return event;
  });
}

// resolveActiveBeatGrounding — a thin convenience over resolveGrounding: find the (first) annotation of
// `beatType` in the read-only overlay and resolve it, or `null` if the overlay carries none of that
// beat (e.g. summon, which the committed FixtureInterpreter omits by design — the 3.3/3.4 honest gap).
// The load-bearing pure unit is resolveGrounding; this just picks the active beat's annotation for the
// renderer's "active beat -> real event(s)" grounding section. PURE + read-only. [story Task 2 "(Optional
// helper) resolveActiveBeatGrounding"]
export function resolveActiveBeatGrounding(
  view: AnnotatedView,
  beatType: BeatType,
): readonly NormalizedEvent[] | null {
  const annotation = view.annotations.find((a) => a.beatType === beatType);
  if (!annotation) return null;
  return resolveGrounding(annotation, view);
}
