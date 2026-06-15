import { z } from 'zod';
import rawLegend from '../config/legend.json';

// The portal/-local LEGEND-table config schema + the bundled, validated table (Story 4.4, FR-11) — the
// ON-DEMAND transparency portal's content. Mirrors src/portal/teaching-config.ts VERBATIM in structure;
// the mapping copy lives ENTIRELY in src/config/legend.json (config-as-data, NFR-4). [story Task 1]
//
// Kept (non-obvious WHY): portal/ is browser-reachable, so this module stays SDK-free + phaser-free and
// has NO eslint zone — the source-grep in r1-discipline.test.ts is the real R4/R5 guard. The `import
// rawLegend from '...json'` is a STATIC Vite-bundled import (no fs/clock), and the parse-at-load fails
// CLOSED (a malformed committed file throws on import rather than silently mis-mapping). The Legend is
// templated config-as-data — there is NO LLM here. [architecture.md#R4 L236-238]

// The brevity bound (the gate-checkable max length): closes the PRD review-rubric's open finding that
// "concise" was unbounded. ONE constant referenced by BOTH schema fields AND the unit test, so the
// brevity gate has a single source of truth. Higher than TEACHING_MAX_LEN=140 because the Legend row is
// the fuller two-sided PAIR, not the 4.3 one-liner. [story Dev Notes #6; review-rubric.md L35]
export const LEGEND_MAX_LEN = 160;

// A single fantasy<->real mapping ROW: a non-empty string PAIR, each bounded by the brevity floor.
const LegendRowSchema = z
  .object({
    fantasy: z.string().min(1).max(LEGEND_MAX_LEN),
    real: z.string().min(1).max(LEGEND_MAX_LEN),
  })
  .strict();

// The table is keyed EXHAUSTIVELY by the three signature BeatType members (shaman | dispel | summon) and
// the four CORE LegendActionType members (melee | spell | scout | aetherStorm — the four actions the AC
// names; summon is a BEAT, counter/idle are deliberately not Legend rows, story Dev Notes #3). An
// exhaustive z.object(...).strict() (NOT z.record) is chosen so a MISSING key (e.g. forgetting `summon`
// or `aetherStorm`) fails LOUD at import — z.record would accept a partial map — and .strict() rejects a
// TYPO'd key (e.g. `shamn`, or a stray `counter` action), exactly the TeachingTableSchema /
// CaptionsTableSchema / ModelTuningSchema fail-closed posture. [story Task 1; Dev Notes #2, #3]
export const LegendTableSchema = z
  .object({
    // A future shape change bumps this so an old reader reading a new artifact fails closed.
    $schemaVersion: z.literal(1),
    beats: z
      .object({
        shaman: LegendRowSchema,
        dispel: LegendRowSchema,
        summon: LegendRowSchema,
      })
      .strict(),
    actions: z
      .object({
        melee: LegendRowSchema,
        spell: LegendRowSchema,
        scout: LegendRowSchema,
        aetherStorm: LegendRowSchema,
      })
      .strict(),
  })
  .strict();

export type LegendRow = z.infer<typeof LegendRowSchema>;
export type LegendTable = z.infer<typeof LegendTableSchema>;

// Parsed + validated at module load (fail-closed). portal.ts reads LEGEND.beats[beatType] /
// LEGEND.actions[actionType] generically.
export const LEGEND: LegendTable = LegendTableSchema.parse(rawLegend);
