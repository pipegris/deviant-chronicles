import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleState, BattleTimeline, Beat } from '../schema/battle-timeline';
import type { AnnotatedView } from '../interpret/overlay';
import type { BeatSignal } from '../interpret/beat-signal';

// RED-PHASE ATDD acceptance tests for Story 4.1 (FR-9) — Live templated Captions per Battle Action.
// These FAIL until src/scribe/captions.ts exports the pure caption planner + the Dispel-correction
// handler + the `CaptionOp` type, and src/scribe/captions-config.ts loads the validated caption
// table from src/config/captions.json. The import error (the module does not exist yet) is the
// intended RED — exactly the posture beat-behavior.test.ts held in its own red phase.
//
// `scribe/captions.ts` is the Layer-2 (Told) sibling of render/beat-behavior.ts: a PURE module that
// maps a playback TRANSITION (prev/next BattleState + the advanced Beat[]) + the read-only Layer-1
// overlay (AnnotatedView) to typed caption ops, with ZERO Phaser (node env, no DOM). It makes NO
// truth claim of its own — it narrates Layer-1's frozen structure (R1).
//
// What the gate CAN prove here (per the story's gate-verifiable / operator-verified split):
//   AC1 — the pure caption SELECTION (right template family per actionType + per signature beat),
//         the DETERMINISTIC variant rotation (occurrence-index, no Math.random — run twice ->
//         byte-identical CaptionOp[], a repeated family yields a DIFFERENT variant on its 2nd use),
//         and the SM-C2 throttle (significant-only — one caption per captionable advanced beat,
//         NO caption for idle).
//   AC2 — the correction LOGIC: on a scribe-correction BeatSignal, the emitted `correct` op
//         references the CORRECT prior caption id and carries struck + rewritten text.
//   R1/R4/R5 — scribe/captions.ts stays SDK-free + phaser-free and writes NO mechanics field.
// It CANNOT prove the on-screen legibility / strikethrough->rewrite ANIMATION feel — jsdom does not
// advance Phaser tweens (the documented arena-animation.test.ts gap). Those are OPERATOR-verified.
//
// Pipeline reuse (copied verbatim from beat-behavior.test.ts L51-83): read the COMMITTED ingest
// fixtures with fs IN THE TEST (tests are not Layer-0 modules, so this respects R2) and run the SAME
// parse -> normalize -> merge -> translate -> pace chain the golden snapshot pins, then fold the
// resulting BattleTimeline to drive REAL transitions through planCaptions — AND run the
// FixtureInterpreter over the same events -> annotations -> applyOverlay -> the read-only view.
import {
  planCaptions,
  planCaptionCorrection,
  type CaptionOp,
} from './captions';
import { foldBattleState } from '../model/battle-model';
import { pace } from '../pace/derive-beats';
import { translate } from '../translate/translate';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';
import { applyOverlay } from '../interpret/overlay';
import { FixtureInterpreter } from '../interpret/fixture-interpreter';
import { scribeCorrection } from '../interpret/beat-signal';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'ingest', '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

// Copied verbatim from beat-behavior.test.ts so captions map the EXACT committed BattleTimeline.
function runIngest(): NormalizedEvent[] {
  const transcript = normalizeTranscript(
    parseTranscript(readFixture('sample-transcript.jsonl'), DEV_STREAM_ID),
    DEV_STREAM_ID,
  );
  const devMaxEpoch = Math.max(
    ...transcript.map((e) => Date.parse(e.timestamp)).filter((n) => !Number.isNaN(n)),
  );
  const journal = normalizeJournal(parseJournal(readFixture('sample-journal.jsonl')), devMaxEpoch + 1);
  return mergeStreams([transcript, journal]);
}

function timeline(): BattleTimeline {
  return pace(translate(runIngest()));
}

// The read-only overlay the boot threads in: the FixtureInterpreter's annotations (dispel @ u-0002#1,
// shaman @ u-0010#0, NO summon) applied side-by-side to the same events.
async function overlay(): Promise<AnnotatedView> {
  const events = runIngest();
  const annotations = await new FixtureInterpreter().interpret(events);
  return applyOverlay(events, annotations);
}

// ---- the committed 10-beat timeline (pinned by pace.test.ts.snap) the SM-C2 / selection tests key off ----
//   Beat[0] scout   ['u-0001','u-0002#1','u-0002#2','u-0003#0'] -> carries the DISPEL anchor u-0002#1
//   Beat[1] melee   ['u-0004#0']
//   Beat[2] melee   ['u-0005#0']            } the melee family REPEATS (rotation "repeats differ" proof)
//   Beat[3] melee   ['u-0006#0']
//   Beat[4] melee   ['u-0007#0']
//   Beat[5] spell   ['u-0008#0']
//   Beat[6] counter ['u-0009#0']            -> the struggle that charges the gauge
//   Beat[7] scout   ['u-0010#0','u-0011#0'] -> carries the SHAMAN anchor u-0010#0
//   Beat[8] idle    ['phase-...#started']   -> NOT captionable (the fail-closed neutral beat, SM-C2)
//   Beat[9] melee   ['phase-...#result']    -> the breakthrough (last beat; discharge)
const DISPEL_BEAT_INDEX = 0;
const IDLE_BEAT_INDEX = 8;

// A single-beat forward transition advancing beats[index] (cursor index -> index+1), exactly the
// boot's `beatsAdvanced = timeline.beats.slice(prevCursor, cursor)` for a speed-1 tick.
function transitionAt(tl: BattleTimeline, index: number): {
  prev: BattleState;
  next: BattleState;
  beats: Beat[];
} {
  return {
    prev: foldBattleState(tl, index),
    next: foldBattleState(tl, index + 1),
    beats: tl.beats.slice(index, index + 1),
  };
}

const emits = (ops: CaptionOp[]): Extract<CaptionOp, { kind: 'emit' }>[] =>
  ops.filter((o): o is Extract<CaptionOp, { kind: 'emit' }> => o.kind === 'emit');

// Fold the WHOLE timeline one beat at a time (the boot's per-transition cadence) and collect every
// emitted caption op, preserving order — the running "fold history" the rotation + correction key off.
function emitAllCaptions(tl: BattleTimeline, view: AnnotatedView): Extract<CaptionOp, { kind: 'emit' }>[] {
  const history: Extract<CaptionOp, { kind: 'emit' }>[] = [];
  for (let cursor = 0; cursor < tl.beats.length; cursor++) {
    const prev = foldBattleState(tl, cursor);
    const next = foldBattleState(tl, cursor + 1);
    const beats = tl.beats.slice(cursor, cursor + 1);
    history.push(...emits(planCaptions(prev, next, beats, view)));
  }
  return history;
}

describe('Story 4.1 AC1 — templated selection per Action type (REAL fixture)', () => {
  it('a plain melee strike beat (Beat[1]) emits exactly one caption whose actionType is "melee"', async () => {
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = transitionAt(tl, 1);
    expect(beats[0]!.actionType).toBe('melee'); // guard the locator against the committed snapshot

    const ops = emits(planCaptions(prev, next, beats, view));
    expect(ops).toHaveLength(1);
    expect(ops[0]!.actionType).toBe('melee');
    // The caption text is drawn from the templated table (config-as-data), so it is non-empty and
    // is NOT the literal action-type token — it is in-register narration, not a debug label.
    expect(typeof ops[0]!.text).toBe('string');
    expect(ops[0]!.text.length).toBeGreaterThan(0);
    expect(ops[0]!.text).not.toBe('melee');
  });

  it('the caption text for a melee beat is one of the templated melee variants (drawn from the table, no network)', async () => {
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = transitionAt(tl, 1);
    const op = emits(planCaptions(prev, next, beats, view))[0]!;
    // The chosen text MUST be a member of the table's melee variants — it is SELECTED, not invented.
    const { CAPTIONS } = await import('./captions-config');
    expect(CAPTIONS.melee).toContain(op.text);
  });

  it('a signature DISPEL beat (Beat[0], anchor u-0002#1) is captioned from the "dispel" family, NOT the bare "scout" family', async () => {
    // The L1->L0 bridge: when an advanced beat carries a dispel/shaman/summon annotation in the
    // overlay, the signature-beat template family WINS over the bare actionType family (story Task 2).
    // Beat[0] is a `scout` actionType but carries the dispel annotation, so its caption must come from
    // the `dispel` variants, never the `scout` variants.
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = transitionAt(tl, DISPEL_BEAT_INDEX);
    expect(beats[0]!.actionType).toBe('scout');
    expect(beats.some((b) => b.sourceEventIds.includes('u-0002#1'))).toBe(true); // carries the dispel anchor

    const ops = emits(planCaptions(prev, next, beats, view));
    expect(ops).toHaveLength(1);
    const { CAPTIONS } = await import('./captions-config');
    expect(CAPTIONS.dispel).toContain(ops[0]!.text);
    expect(CAPTIONS.scout).not.toContain(ops[0]!.text);
  });

  it('EVERY emitted caption across the fixture draws its text from the family it was selected from (no invented text for ANY ActionType)', async () => {
    // The first three cases pin melee + the dispel-override family directly; this one closes the gap
    // for the remaining committed families the fold actually exercises (spell @ Beat[5], counter @
    // Beat[6], and the plain scout). AC1 says the caption is "drawn from a templated table keyed by
    // Action type" — assert it for the WHOLE run, not just one family: each emit's text must be a
    // member of the table family that drives it (the signature-beat family when one is tagged, else the
    // bare actionType family). A regression that hardcoded or mis-keyed text for spell/counter/scout
    // would slip past the melee-only checks but fails here.
    const tl = timeline();
    const view = await overlay();
    const { CAPTIONS } = await import('./captions-config');

    // Which signature-beat family (if any) a beat carries — mirrors the selector's L1->L0 bridge so the
    // expected family matches what planCaptions resolved (a tagged beat is captioned from its tag).
    const signatureFamilyOf = (eventIds: readonly string[]): keyof typeof CAPTIONS | null => {
      for (const id of eventIds) {
        for (const ann of view.byEventRef.get(id) ?? []) {
          if (ann.beatType === 'dispel' || ann.beatType === 'shaman' || ann.beatType === 'summon') {
            return ann.beatType;
          }
        }
      }
      return null;
    };

    // Track the families seen so the assertion is not vacuous — the committed fixture MUST exercise
    // these plain ActionType families (guards the locator against a future fixture/snapshot drift).
    const familiesSeen = new Set<string>();
    for (let cursor = 0; cursor < tl.beats.length; cursor++) {
      const beat = tl.beats[cursor]!;
      const ops = emits(
        planCaptions(foldBattleState(tl, cursor), foldBattleState(tl, cursor + 1), tl.beats.slice(cursor, cursor + 1), view),
      );
      for (const op of ops) {
        const family = signatureFamilyOf(beat.sourceEventIds) ?? op.actionType;
        familiesSeen.add(family);
        // The selected text is a real member of its family — config-as-data, never invented, no network.
        expect(CAPTIONS[family as keyof typeof CAPTIONS]).toContain(op.text);
      }
    }
    // The committed fixture exercises these plain ActionType families directly (spell @ Beat[5],
    // counter @ Beat[6]) plus the two signature-beat families that override a bare scout (dispel @
    // Beat[0], shaman @ Beat[7]) — so BOTH the bare-actionType branch and the signature-override branch
    // of the membership rule are covered. (There is no UNTAGGED scout beat in the thin slice — both
    // scout beats carry a signature annotation — so a bare-scout family is intentionally not asserted
    // here; the plain-scout path is covered by the unit suite's hand-built overlays.)
    expect(familiesSeen).toContain('spell');
    expect(familiesSeen).toContain('counter');
    expect(familiesSeen).toContain('dispel');
    expect(familiesSeen).toContain('shaman');
  });
});

describe('Story 4.1 AC1 — deterministic variant rotation (occurrence-index, no Math.random)', () => {
  it('folding the whole timeline twice yields byte-identical CaptionOp[] (replay-stable, RNG-free)', async () => {
    const tl = timeline();
    const view = await overlay();
    const first = emitAllCaptions(tl, view);
    const second = emitAllCaptions(timeline(), await overlay());
    expect(second).toEqual(first);
  });

  it('the melee family repeats across Beats 1-4; consecutive melee captions read DIFFERENTLY and the rotation ADVANCES through the pool (not a 2-cycle toggle)', async () => {
    // The headline AC1 claim: "variants rotate so repeats don't read identically." The committed
    // fixture has FOUR consecutive melee beats before the breakthrough (Beats 1,2,3,4), so the melee
    // family is captioned four times in a row. A weak assertion (only the 1st vs 2nd differ) would be
    // satisfied by a buggy `variants[index % 2]` TOGGLE between two strings; that is NOT rotation. We
    // assert the first FOUR melee captions are PAIRWISE-distinct, which can only hold if the rotation
    // truly advances through the variant pool (the table supplies 4 melee variants; occurrence indices
    // 4,5,6,7 map to variants[0,1,2,3]). This pins the AC's "rotate" verb, not merely "differ once."
    const tl = timeline();
    const view = await overlay();
    const meleeCaptions = emitAllCaptions(tl, view).filter((o) => o.actionType === 'melee');
    // The fixture's four pre-breakthrough melee strikes give four captions to compare.
    expect(meleeCaptions.length).toBeGreaterThanOrEqual(4);
    const firstFour = meleeCaptions.slice(0, 4).map((o) => o.text);
    // Pairwise-distinct: a toggle (A,B,A,B) or a constant would FAIL this; only a real rotation passes.
    expect(new Set(firstFour).size).toBe(4);
    // And the headline guarantee restated explicitly: adjacent repeats never read identically.
    expect(meleeCaptions[1]!.text).not.toBe(meleeCaptions[0]!.text);
    expect(meleeCaptions[2]!.text).not.toBe(meleeCaptions[1]!.text);
    expect(meleeCaptions[3]!.text).not.toBe(meleeCaptions[2]!.text);
  });

  it('the rotation guarantee is ADJACENCY-ONLY: a NON-adjacent same-family repeat CAN collide (review F3, known limitation)', async () => {
    // Honest scope pin (review F3): the occurrence index is the ABSOLUTE event position, not a per-family
    // count, so a same-family pair separated by a MULTI-EVENT beat (which shifts subsequent anchor indices
    // by >1) can land on the same variant. The committed fixture exhibits this: the breakthrough melee
    // Beat[9] (anchor index 13 -> mod4=1) reads BYTE-IDENTICAL to the early melee Beat[2] (index 5 ->
    // mod4=1). This does NOT violate AC1 ("repeats don't read IDENTICALLY" = CONSECUTIVE repeats differ,
    // proven above) because the two are 8 beats apart, but it documents that "repeats differ" is NOT a
    // per-family guarantee under Option B. If a future change adopts Dev Notes Option A (a per-family
    // counter threaded from the boot history) this collision disappears and this test is updated. Pinning
    // it here means a maintainer who "fixes" rotation sees this assertion flip and makes a DELIBERATE call.
    const tl = timeline();
    const view = await overlay();
    const meleeCaptions = emitAllCaptions(tl, view).filter((o) => o.actionType === 'melee');
    // Five melee captions: the four pre-breakthrough (Beats 1-4) + the breakthrough (Beat[9]).
    expect(meleeCaptions.length).toBe(5);
    const breakthrough = meleeCaptions[4]!.text;
    const earlyByteIdentical = meleeCaptions[1]!.text; // Beat[2], index 5 -> mod4=1
    // KNOWN non-adjacent collision: the breakthrough melee text equals an earlier (non-adjacent) one.
    expect(breakthrough).toBe(earlyByteIdentical);
    // But it is NOT adjacent to its identical twin (the preceding melee in fold order is Beat[4]'s text).
    expect(breakthrough).not.toBe(meleeCaptions[3]!.text);
  });
});

describe('Story 4.1 AC2 / SM-C2 — caption density throttle (significant-only; idle is never captioned)', () => {
  it('the idle beat (Beat[8], the fail-closed neutral beat) produces NO caption op', async () => {
    // SM-C2 + the fail-closed neutral: captioning `idle` would be narrating nothing. The transition
    // crossing the idle beat emits zero caption ops.
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = transitionAt(tl, IDLE_BEAT_INDEX);
    expect(beats[0]!.actionType).toBe('idle');
    expect(emits(planCaptions(prev, next, beats, view))).toHaveLength(0);
  });

  it('the emitted caption count equals the captionable advanced-beat count (one caption per significant beat, none for idle)', async () => {
    // The Pacer ALREADY collapsed trivial bursts into single Beats, so "one caption per advanced
    // captionable beat" inherits significance for free. Across the committed 10-beat timeline, the
    // 9 non-idle beats are captionable and the 1 idle beat is not -> exactly 9 emit ops.
    const tl = timeline();
    const view = await overlay();
    const captionable = tl.beats.filter((b) => b.actionType !== 'idle').length;
    expect(emitAllCaptions(tl, view).length).toBe(captionable);
    // And no emit op was ever produced on a transition crossing an idle beat.
    for (let cursor = 0; cursor < tl.beats.length; cursor++) {
      const beats = tl.beats.slice(cursor, cursor + 1);
      if (beats[0]!.actionType !== 'idle') continue;
      const ops = emits(planCaptions(foldBattleState(tl, cursor), foldBattleState(tl, cursor + 1), beats, view));
      expect(ops).toHaveLength(0);
    }
  });
});

describe('Story 4.1 AC2 — Dispel self-correction op references the correct prior caption (REAL fixture)', () => {
  it('on the scribe-correction signal for the Dispel (cursor + grounding from u-0002#1), a `correct` op targets the prior emit caption and carries struck + rewritten text', async () => {
    // AC2 (the honesty beat) at the data level. The Dispel anchor u-0002#1 lives in Beat[0]; the
    // caption emitted when Beat[0] was crossed is the one the correction crosses out. We replay the
    // fold to build the caption history (exactly the boot-owned history), then drive the SAME
    // scribe-correction signal beat-behavior.ts emits (scribeCorrection(next.cursor, grounding)) into
    // the correction handler and assert it resolves the right prior caption id.
    const tl = timeline();
    const view = await overlay();

    // The history of emits up to + including the Dispel beat transition (the prior captions exist).
    const history = emitAllCaptions(tl, view);
    expect(history.length).toBeGreaterThan(0);

    // The exact signal the render behavior plan emits for the committed fixture's Dispel.
    const { next } = transitionAt(tl, DISPEL_BEAT_INDEX);
    const signal: BeatSignal = scribeCorrection(next.cursor, {
      eventRefs: ['u-0002#1', 'u-0002#2', 'u-0003#0'],
    });

    const op = planCaptionCorrection(signal, history);
    expect(op).not.toBeNull();
    expect(op!.kind).toBe('correct');

    // The target MUST be a caption id that was actually emitted (it crosses out a REAL prior caption).
    const emittedIds = new Set(history.map((h) => h.captionId));
    expect(emittedIds.has(op!.targetCaptionId)).toBe(true);

    // The struck text is the prior caption's own text; the rewrite is the in-register "the Scribe owns
    // it" correction (Tolkien register, from the dispel family). Both are present + non-empty, and the
    // rewrite differs from the struck text (it is a REWRITE, not an echo).
    const struckCaption = history.find((h) => h.captionId === op!.targetCaptionId)!;
    expect(op!.struckText).toBe(struckCaption.text);
    expect(typeof op!.newText).toBe('string');
    expect(op!.newText.length).toBeGreaterThan(0);
    expect(op!.newText).not.toBe(op!.struckText);

    // The correction's newText is drawn from the dispel template family (config-as-data, no network).
    const { CAPTIONS } = await import('./captions-config');
    expect(CAPTIONS.dispel).toContain(op!.newText);

    // The correction rides the Dispel's firing cursor (so the render layer lands it on the same beat
    // as the shatter cinematic's record-scratch — Story 3.5).
    expect(op!.cursor).toBe(next.cursor);
  });
});

describe('Story 4.1 — planCaptions is PURE + R1-clean at the data level (REAL fixture)', () => {
  it('two calls on the same transition + overlay deep-equal (deterministic, no hidden RNG/clock)', async () => {
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = transitionAt(tl, 1);
    expect(planCaptions(prev, next, beats, view)).toEqual(planCaptions(prev, next, beats, view));
  });

  it('does NOT mutate prev / next / beatsAdvanced / view (stringify before/after is identical)', async () => {
    const tl = timeline();
    const view = await overlay();
    const { prev, next, beats } = transitionAt(tl, DISPEL_BEAT_INDEX);
    const before = JSON.stringify([prev, next, beats, view.events, view.annotations]);
    planCaptions(prev, next, beats, view);
    const after = JSON.stringify([prev, next, beats, view.events, view.annotations]);
    expect(after).toBe(before);
  });

  it('R1 at the data level: no emitted caption op carries a mechanics field (problemIntegrity/resolve/insightGauge/hp/weight/dwellMs) and no BattleState is returned', async () => {
    // scribe/ makes NO mechanics write: planCaptions returns ONLY CaptionOp[] (an array — never a
    // BattleState/Beat), and no op carries a Layer-0 mechanics key. architecture.md#R1 / #Anti-Patterns.
    const MECHANICS_KEYS = ['problemIntegrity', 'resolve', 'insightGauge', 'hp', 'weight', 'dwellMs', 'victory', 'enemies'];
    const tl = timeline();
    const view = await overlay();
    for (let cursor = 0; cursor < tl.beats.length; cursor++) {
      const ops = planCaptions(
        foldBattleState(tl, cursor),
        foldBattleState(tl, cursor + 1),
        tl.beats.slice(cursor, cursor + 1),
        view,
      );
      expect(Array.isArray(ops)).toBe(true);
      for (const op of ops) {
        for (const mech of MECHANICS_KEYS) {
          expect(Object.prototype.hasOwnProperty.call(op, mech)).toBe(false);
        }
      }
    }
  });
});
