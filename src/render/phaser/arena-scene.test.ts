// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// DEV-STORY FIX (justified, not a weakening): the ATDD scaffold wrote `import Phaser from 'phaser'`,
// but Phaser 4.0.0's ESM build exposes ONLY named exports — it has NO default export, so the default
// import resolves to `undefined` and every `Phaser.HEADLESS` / `Phaser.Game` / `Phaser.Core` use
// below would throw "Cannot read properties of undefined". A namespace import is the correct form
// and changes NONE of the assertions (the `Phaser.*` references resolve identically). Verified
// against node_modules/phaser/dist/phaser.esm.js (named-only `export { ... Scene, HEADLESS, ... }`).
import * as Phaser from 'phaser';
import type { NormalizedEvent } from '../../schema/normalized-event';
import type { BattleTimeline } from '../../schema/battle-timeline';

// RED-PHASE acceptance test for Story 2.3 (Task 4 + Task 7) — the HEADLESS Phaser BOOT SMOKE.
// This FAILS until src/render/phaser/arena-scene.ts exports `ArenaScene` (the module import errors
// now — render/phaser/ is empty except .gitkeep).
//
// Runs under the jsdom Vitest env (per-file pragma above) because Phaser.HEADLESS skips
// canvas/WebGL but STILL requires the DOM (verified from phaser 4.0.0 source: phaser.esm.js
// L16508-16510 "A Headless Renderer doesn't create either a Canvas or WebGL Renderer. However, it
// still absolutely relies on the DOM being present ... meant for unit testing"; HEADLESS === 3 at
// L16517; the renderer-selection branch returns early for HEADLESS at L17369-17372). The default
// Vitest env is `node` (vitest.config.ts) which has no document/window, so this file opts into jsdom.
//
// VERIFICATION LIMITATION (recorded honestly): `jsdom` is NOT currently a devDependency in this
// repo, so this file ERRORS at environment setup (ERR_MODULE_NOT_FOUND for the jsdom env) IN
// ADDITION to the missing ArenaScene implementation — it is doubly RED. Turning it GREEN requires
// the dev to (a) add jsdom (`pnpm add -D jsdom`, the framework dependency the per-file pragma
// implies) and (b) implement ArenaScene + applySnapshot. Per the story's Task 7 fallback clause,
// if a genuine jsdom/Phaser gap proves to block the boot, this becomes operator-verified — it is
// NOT to be weakened to a no-op. The two NODE-env tests (render-model.test.ts, render-port.test.ts)
// are the load-bearing gate-provable surface; this smoke is the create-once-without-throwing guard.
//
// What the smoke proves (NOT pixels — HEADLESS draws nothing; visual correctness is operator-only):
//   - a Phaser.Game with { type: Phaser.HEADLESS, scene: ArenaScene } boots without throwing,
//   - the Arena scene's create() runs and builds the expected game objects (Forgemaiden, Boss,
//     >= 1 Minion, health bars, and the Insight Gauge widget),
//   - applySnapshot(victory state) does not throw and updates the Boss bar's tracked fraction.
import { ArenaScene } from './arena-scene';
import { initialBattleState, foldBattleState } from '../../model/battle-model';
import { pace } from '../../pace/derive-beats';
import { translate } from '../../translate/translate';
import { parseTranscript } from '../../ingest/parse-transcript';
import { parseJournal } from '../../ingest/parse-journal';
import { normalizeTranscript, normalizeJournal } from '../../ingest/normalize';
import { mergeStreams } from '../../ingest/merge';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ingest', '__fixtures__');
const DEV_STREAM_ID = 'aecfc998031eb0576';

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

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

// Boot a HEADLESS game and resolve once the Arena scene's create() has run. audio.noAudio +
// banner:false keep Phaser from probing browser APIs jsdom lacks (the story's jsdom fallback knobs).
function bootArena(): Promise<{ game: Phaser.Game; scene: ArenaScene }> {
  return new Promise((resolve, reject) => {
    const game = new Phaser.Game({
      type: Phaser.HEADLESS,
      width: 1024,
      height: 768,
      banner: false,
      audio: { noAudio: true },
      scene: ArenaScene,
      callbacks: {
        postBoot: () => {
          // After boot the Arena scene is the active scene; create() has run by the first step.
          game.events.once(Phaser.Core.Events.POST_STEP, () => {
            const scene = game.scene.getScene('Arena') as ArenaScene;
            if (scene) resolve({ game, scene });
            else reject(new Error('Arena scene was not registered'));
          });
        },
      },
    });
  });
}

let activeGame: Phaser.Game | undefined;

afterEach(() => {
  activeGame?.destroy(true);
  activeGame = undefined;
});

describe('Story 2.3 AC1/AC2 — headless Phaser boot smoke (ArenaScene creates the placeholder cast)', () => {
  it('boots a Phaser.HEADLESS game with the Arena scene without throwing', async () => {
    const { game, scene } = await bootArena();
    activeGame = game;
    expect(scene).toBeInstanceOf(ArenaScene);
    expect(scene.scene.key).toBe('Arena');
  });

  it('the Arena scene creates a Forgemaiden, a Boss, and at least one Minion (AC2 cast)', async () => {
    const { game, scene } = await bootArena();
    activeGame = game;
    // The scene must expose its created entity game objects so the smoke can assert the cast
    // exists without inspecting pixels. The dev exposes a tracked map/list of entities by kind.
    const kinds = scene.entityKinds();
    expect(kinds).toContain('forgemaiden');
    expect(kinds).toContain('boss');
    expect(kinds.filter((k) => k === 'minion').length).toBeGreaterThanOrEqual(1);
  });

  it('the Arena scene creates health bars and the Insight Gauge widget (AC2 "health bars and the Insight Gauge visible")', async () => {
    const { game, scene } = await bootArena();
    activeGame = game;
    // At minimum the Forgemaiden + Boss have health bars (per AC2) and a gauge widget exists.
    expect(scene.hasHealthBar('forgemaiden')).toBe(true);
    expect(scene.hasHealthBar('boss')).toBe(true);
    expect(scene.hasInsightGauge()).toBe(true);
  });

  it('applySnapshot(initial) then applySnapshot(victory) does not throw and updates the Boss bar fraction', async () => {
    const { game, scene } = await bootArena();
    activeGame = game;
    const tl = timeline();

    expect(() => scene.applySnapshot(initialBattleState())).not.toThrow();
    expect(scene.bossBarFraction()).toBe(1); // full integrity at t=0

    const victory = foldBattleState(tl, tl.beats.length); // Boss hp 0, victory true
    expect(() => scene.applySnapshot(victory)).not.toThrow();
    expect(scene.bossBarFraction()).toBe(0); // bar emptied on the defeating snapshot
  });
});
