import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../schema/normalized-event';
import type { BattleTimeline } from '../schema/battle-timeline';

// RED-PHASE acceptance tests for Story 2.3 (Task 2 + Task 7) — the PURE view-model mapping
// `toRenderModel(snapshot, layout) -> RenderModel`. These FAIL until src/render/render-model.ts
// exports `toRenderModel`, the `RenderModel` / `RenderEntity` / `EntityKind` types, and
// `DEFAULT_LAYOUT`. The import error is the intended red (exactly like battle-model.test.ts was
// in its own red phase). This is the bulk of the gate-provable surface for AC1/AC2 — the snapshot
// -> drawable logic, expressed as plain data, with ZERO Phaser (node env, no DOM).
//
// Covers AC1 (the renderer consumes immutable BattleState snapshots — proven here by the no-mutation
// + purity assertions) and the TESTABLE half of AC2 (a Forgemaiden, a Boss, and >= 1 Minion exist
// in the model with hp fractions, and the Insight Gauge fraction is present). The VISUAL half of
// AC2 ("render as placeholder sprites ... visible") is operator-verified, not gate-verified.
//
// Pipeline reuse (Dev Notes "Testing Standards" + battle-model.test.ts L31-57, copied VERBATIM):
// we read the COMMITTED ingest fixtures with fs IN THE TEST (tests are not Layer-0 modules, so this
// respects R2) and run the SAME parse -> normalize -> merge -> translate -> pace chain the golden
// snapshot pins, then fold the resulting BattleTimeline to drive REAL BattleState snapshots through
// toRenderModel. We do NOT hand-build fake snapshots where a real one is cheap.
import { toRenderModel, DEFAULT_LAYOUT } from './render-model';
import { initialBattleState, foldBattleState } from '../model/battle-model';
import { pace } from '../pace/derive-beats';
import { translate } from '../translate/translate';
import { parseTranscript } from '../ingest/parse-transcript';
import { parseJournal } from '../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../ingest/normalize';
import { mergeStreams } from '../ingest/merge';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'ingest', '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

// Copied verbatim from src/model/battle-model.test.ts L41-57 so the renderer maps the EXACT
// committed BattleTimeline / BattleState the model tests fold.
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

describe('Story 2.3 AC2 — toRenderModel(initialBattleState()) yields the placeholder cast (full bars)', () => {
  it('contains a Forgemaiden with hpFraction === 1 (full Resolve at t=0)', () => {
    const model = toRenderModel(initialBattleState());
    const forgemaiden = model.entities.find((e) => e.kind === 'forgemaiden');
    expect(forgemaiden, 'the Forgemaiden entity is present').toBeDefined();
    // Resolve is the Forgemaiden's bar; at t=0 resolve === maxResolve, so the fraction is full.
    expect(forgemaiden!.hpFraction).toBe(1);
  });

  it('contains a Boss with hpFraction === 1 (full Problem Integrity at t=0)', () => {
    const model = toRenderModel(initialBattleState());
    const boss = model.entities.find((e) => e.kind === 'boss');
    expect(boss, 'the Boss entity is present').toBeDefined();
    // Boss hp === problemIntegrity === maxProblemIntegrity at t=0.
    expect(boss!.hpFraction).toBe(1);
  });

  it('contains AT LEAST ONE Minion (AC2 "at least one Minion"), each a static full bar (1) for v0.1', () => {
    const model = toRenderModel(initialBattleState());
    const minions = model.entities.filter((e) => e.kind === 'minion');
    expect(minions.length).toBeGreaterThanOrEqual(1);
    // v0.1 minions are SYNTHESIZED with a static full HP (1) — they have no per-minion model HP yet
    // (per-minion HP / death animation is Story 2.4). Pin the documented value so a regression that
    // wired minion hp to some snapshot field (out of scope here) is caught, not silently accepted.
    for (const m of minions) {
      expect(m.hpFraction).toBe(1);
    }
  });

  it('the gauge is empty (0) and victory is false at t=0', () => {
    const model = toRenderModel(initialBattleState());
    expect(model.insightGauge).toBe(0);
    expect(model.victory).toBe(false);
  });

  it('every entity carries an id, a kind, x/y coordinates, and an hpFraction in [0, 1]', () => {
    const model = toRenderModel(initialBattleState());
    expect(model.entities.length).toBeGreaterThanOrEqual(3); // forgemaiden + boss + >=1 minion
    for (const e of model.entities) {
      expect(typeof e.id).toBe('string');
      expect(['forgemaiden', 'boss', 'minion']).toContain(e.kind);
      expect(typeof e.x).toBe('number');
      expect(typeof e.y).toBe('number');
      expect(e.hpFraction).toBeGreaterThanOrEqual(0);
      expect(e.hpFraction).toBeLessThanOrEqual(1);
    }
  });
});

describe('Story 2.3 AC2 — at the END of the real fixture timeline the model reflects victory', () => {
  it('the Boss hpFraction is 0 at the completion beat (Boss defeated)', () => {
    const tl = timeline();
    const end = foldBattleState(tl, tl.beats.length);
    const model = toRenderModel(end);
    const boss = model.entities.find((e) => e.kind === 'boss');
    expect(boss, 'the Boss entity is present').toBeDefined();
    expect(boss!.hpFraction).toBe(0);
  });

  it('victory is true at the completion beat', () => {
    const tl = timeline();
    const model = toRenderModel(foldBattleState(tl, tl.beats.length));
    expect(model.victory).toBe(true);
  });

  it('the gauge fraction tracks snapshot.insightGauge / maxGauge across the fixture', () => {
    const tl = timeline();
    const counterIdx = tl.beats.findIndex((b) => b.actionType === 'counter');
    expect(counterIdx).toBeGreaterThanOrEqual(0);
    // Just AFTER the counter beat the gauge is charged (60/100 = 0.6 in this fixture); the model's
    // insightGauge MUST be the snapshot value normalized by the layout's maxGauge, not the raw value.
    const charged = foldBattleState(tl, counterIdx + 1);
    const model = toRenderModel(charged);
    // Pin the CONCRETE values, not just `expected === snapshot.insightGauge / maxGauge` (which would
    // tautologically pass even if toRenderModel divided by the wrong constant or passed the raw value):
    // the raw gauge is 60 and the normalized fraction is 0.6 — proving the mapping divides by maxGauge.
    expect(charged.insightGauge).toBe(60);
    expect(model.insightGauge).toBeCloseTo(0.6, 10);
    expect(model.insightGauge).toBeCloseTo(charged.insightGauge / DEFAULT_LAYOUT.maxGauge, 10);
    expect(model.insightGauge).toBeGreaterThan(0);
    expect(model.insightGauge).toBeLessThanOrEqual(1);
  });

  it('the Forgemaiden hpFraction tracks snapshot.resolve / maxResolve', () => {
    const tl = timeline();
    const end = foldBattleState(tl, tl.beats.length);
    const model = toRenderModel(end);
    const forgemaiden = model.entities.find((e) => e.kind === 'forgemaiden');
    expect(forgemaiden, 'the Forgemaiden entity is present').toBeDefined();
    // In this fixture resolve ends at 87/100; the fraction must reflect that, not stay pinned at 1.
    expect(forgemaiden!.hpFraction).toBeCloseTo(end.resolve / DEFAULT_LAYOUT.maxResolve, 10);
  });
});

describe('Story 2.3 — toRenderModel is PURE (deterministic, no input mutation)', () => {
  it('two calls on the same snapshot deep-equal (same input -> same model)', () => {
    const snapshot = initialBattleState();
    expect(toRenderModel(snapshot)).toEqual(toRenderModel(snapshot));
  });

  it('does NOT mutate the input BattleState (stringify before/after is identical)', () => {
    const tl = timeline();
    const snapshot = foldBattleState(tl, tl.beats.length);
    const before = JSON.stringify(snapshot);
    toRenderModel(snapshot);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('clamps hpFraction into [0, 1] even when a layout max is below the snapshot value (fail-closed)', () => {
    // Defensive clamp (Dev Notes "RenderModel shape"): a mis-set layout max must never produce a
    // bar fraction outside [0,1]. Drive resolve=100 against a deliberately-too-small maxResolve.
    const snapshot = initialBattleState(); // resolve 100, problemIntegrity 100
    const tightLayout = { ...DEFAULT_LAYOUT, maxResolve: 50, maxProblemIntegrity: 50, maxGauge: 50 };
    const model = toRenderModel(snapshot, tightLayout);
    for (const e of model.entities) {
      expect(e.hpFraction).toBeGreaterThanOrEqual(0);
      expect(e.hpFraction).toBeLessThanOrEqual(1);
    }
    expect(model.insightGauge).toBeGreaterThanOrEqual(0);
    expect(model.insightGauge).toBeLessThanOrEqual(1);
  });

  it('a non-positive (or NaN) layout max yields an empty bar (0), never NaN/Infinity (fail-closed)', () => {
    // The `fraction()` guard `if (!(max > 0)) return 0` is a DISTINCT branch from the too-small-max
    // clamp above: a 0 / negative / NaN max would otherwise produce value/0 = Infinity or NaN and a
    // garbage bar. Drive each pathological max and assert the fraction is a finite 0 (empty bar).
    const snapshot = initialBattleState();
    for (const badMax of [0, -10, NaN]) {
      const badLayout = {
        ...DEFAULT_LAYOUT,
        maxResolve: badMax,
        maxProblemIntegrity: badMax,
        maxGauge: badMax,
      };
      const model = toRenderModel(snapshot, badLayout);
      const forgemaiden = model.entities.find((e) => e.kind === 'forgemaiden')!;
      const boss = model.entities.find((e) => e.kind === 'boss')!;
      expect(Number.isFinite(forgemaiden.hpFraction)).toBe(true);
      expect(forgemaiden.hpFraction).toBe(0);
      expect(boss.hpFraction).toBe(0);
      expect(Number.isFinite(model.insightGauge)).toBe(true);
      expect(model.insightGauge).toBe(0);
    }
  });
});

describe('Story 2.3 — Boss-enemy-absent fallback (fail-closed-to-default, never throws)', () => {
  // The story (Task 2) mandates: "If the Boss enemy is absent (defensive — should not happen in
  // v0.1), fall back to hpFraction from snapshot.problemIntegrity / layout.maxProblemIntegrity
  // (fail-closed-to-default, never throw)." The source has this real branch
  // (`bossEnemy ? bossEnemy.hp : snapshot.problemIntegrity`); the happy-path tests never exercise it.
  it('with no Boss in snapshot.enemies, the Boss entity falls back to problemIntegrity and does not throw', () => {
    const tl = timeline();
    const charged = foldBattleState(tl, tl.beats.findIndex((b) => b.actionType === 'counter') + 1);
    // problemIntegrity is 16/100 at this point in the fixture; strip the enemies array so the
    // .find(boss) returns undefined and the fallback branch runs.
    const noBossSnapshot = { ...charged, enemies: [] };
    expect(charged.problemIntegrity).toBe(16);

    let model!: ReturnType<typeof toRenderModel>;
    expect(() => {
      model = toRenderModel(noBossSnapshot);
    }).not.toThrow();

    const boss = model.entities.find((e) => e.kind === 'boss');
    expect(boss, 'the Boss entity is still emitted via the fallback').toBeDefined();
    // Fallback fraction = problemIntegrity / maxProblemIntegrity = 16/100 = 0.16 — identical to the
    // live-enemy path here because boss.hp tracks problemIntegrity in lockstep, which is the point:
    // the bar stays correct even when the enemy entry is missing.
    expect(boss!.hpFraction).toBeCloseTo(0.16, 10);
    expect(boss!.hpFraction).toBeCloseTo(
      noBossSnapshot.problemIntegrity / DEFAULT_LAYOUT.maxProblemIntegrity,
      10,
    );
  });

  it('the Boss-absent fallback is clamped to [0, 1] like the live path', () => {
    // A defeated-state snapshot (problemIntegrity 0) with no enemy entry must still yield a 0 bar,
    // not NaN/negative — the fallback inherits the same clamp.
    const tl = timeline();
    const end = foldBattleState(tl, tl.beats.length); // problemIntegrity 0, victory true
    const model = toRenderModel({ ...end, enemies: [] });
    const boss = model.entities.find((e) => e.kind === 'boss')!;
    expect(boss.hpFraction).toBe(0);
    // victory is read from the top-level snapshot field, unaffected by the missing enemy.
    expect(model.victory).toBe(true);
  });
});
