// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Namespace import: Phaser 4.0.0's ESM build has NO default export (verified) — `import Phaser` is
// undefined. This test boots the REAL adapter under jsdom (Phaser.HEADLESS, injected via the
// adapter's rendererType ctor arg) to cover the adapter's pending-buffer / postBoot->CREATE flush /
// idempotency and the render()-before-init() guard — the surface the SCENE-only smoke does not reach
// (F2/F3). Runs under jsdom for the same reason as arena-scene.test.ts (HEADLESS needs the DOM).
import * as Phaser from 'phaser';
import type { NormalizedEvent } from '../../schema/normalized-event';
import type { BattleTimeline } from '../../schema/battle-timeline';
import { PhaserRenderAdapter } from './phaser-render-adapter';
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

// Poll until the adapter reports ready (its Arena scene's create() has run), with a hard cap so a
// boot stall fails loud instead of hanging. Phaser boots asynchronously (waits on Texture READY).
async function waitForReady(adapter: PhaserRenderAdapter, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!adapter.isReady()) {
    if (Date.now() - start > timeoutMs) throw new Error('adapter did not become ready');
    await new Promise((r) => setTimeout(r, 5));
  }
}

let adapter: PhaserRenderAdapter | undefined;

// The adapter passes parent:'game-container' to Phaser.Game; under jsdom that element must exist or
// the boot cannot mount its (headless) canvas host. Create it before each test, remove it after.
beforeEach(() => {
  const div = document.createElement('div');
  div.id = 'game-container';
  document.body.appendChild(div);
});

afterEach(() => {
  adapter?.destroy();
  adapter = undefined;
  document.getElementById('game-container')?.remove();
  vi.restoreAllMocks();
});

describe('Story 2.3 AC1 — PhaserRenderAdapter (HEADLESS-injected) boot/flush/idempotency (F2 coverage)', () => {
  it('buffers a snapshot rendered DURING boot and flushes it once the scene create() has run', async () => {
    adapter = new PhaserRenderAdapter('game-container', undefined, Phaser.HEADLESS);
    adapter.init();

    // render() arrives BEFORE the scene's CREATE (the game is still booting) -> buffered to pending.
    const victory = foldBattleState(timeline()); // Boss hp 0, victory true
    expect(adapter.isReady()).toBe(false);
    adapter.render(victory);

    await waitForReady(adapter);

    // The pending victory snapshot was flushed on CREATE: the live scene's Boss bar reads 0 (not the
    // create-time seed of 1). This proves the buffer-during-boot path the Completion Notes claim.
    const scene = adapter.sceneForTest();
    expect(scene).not.toBeNull();
    expect(scene!.bossBarFraction()).toBe(0);
  });

  it('renders directly (no buffering) once the scene is ready', async () => {
    adapter = new PhaserRenderAdapter('game-container', undefined, Phaser.HEADLESS);
    adapter.init();
    await waitForReady(adapter);

    // Post-ready: a render goes straight to applySnapshot. t=0 -> full Boss bar; victory -> empty.
    adapter.render(initialBattleState());
    expect(adapter.sceneForTest()!.bossBarFraction()).toBe(1);
    adapter.render(foldBattleState(timeline()));
    expect(adapter.sceneForTest()!.bossBarFraction()).toBe(0);
  });

  it('init() is idempotent — a second init() does not boot a second game (same live scene)', async () => {
    adapter = new PhaserRenderAdapter('game-container', undefined, Phaser.HEADLESS);
    adapter.init();
    await waitForReady(adapter);
    const sceneBefore = adapter.sceneForTest();

    adapter.init(); // second call returns early (this.game already set) — no re-boot
    expect(adapter.isReady()).toBe(true);
    expect(adapter.sceneForTest()).toBe(sceneBefore); // identical scene instance — not recreated
  });

  it('render() before init() is a no-op-with-warning, NOT a silent buffer that never flushes (F3)', () => {
    adapter = new PhaserRenderAdapter('game-container', undefined, Phaser.HEADLESS);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // No init() yet -> this.game is null. The RenderPort contract permits render-any-time, so this
    // must not silently drop into a pending buffer that no boot will ever flush.
    expect(() => adapter!.render(initialBattleState())).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(adapter.isReady()).toBe(false);
  });

  it('destroy() then init() re-boots cleanly (ready resets and rises again)', async () => {
    adapter = new PhaserRenderAdapter('game-container', undefined, Phaser.HEADLESS);
    adapter.init();
    await waitForReady(adapter);

    adapter.destroy();
    expect(adapter.isReady()).toBe(false);
    expect(adapter.sceneForTest()).toBeNull();

    adapter.init();
    await waitForReady(adapter);
    expect(adapter.isReady()).toBe(true);
    expect(adapter.sceneForTest()!.bossBarFraction()).toBe(1); // fresh seed, full Boss bar
  });
});
