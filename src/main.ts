import { loadBundle, bootFromBundle } from './render/arena-boot';
import type { ReplayBundle } from './schema/replay-bundle';

// Story 2.3 / 5.2: the browser entry boots the Phaser ARENA (the RenderPort + playback drive) FROM the
// committed ReplayBundle. It fetch+Zod-validates public/bundles/story-10-1.json via loadBundle, then
// runs the Replay from it via bootFromBundle — fully client-side, NO external service (offline-at-
// replay, NFR-5). The Anthropic SDK is NOT on this path (R4 — the browser entry never imports
// @anthropic-ai/sdk; the bundle is a static JSON, the boot's Saga source is the SDK-free reader). The
// old template bootstrap (src/game/main.ts + its demo scenes) is left in place but unused. [story Task 4]
// A canned dev Saga override so the operator can force the victory panel during `pnpm dev` even before
// the bundle carries an authored Saga. The committed bundle now carries a (placeholder) Saga, so the
// panel lights up from the bundle WITHOUT this override — it is kept only as a dev convenience.
const DEV_PREVIEW_SAGA =
  'And in the last hour the Forgemaiden raised her hammer against the Hanging Curse of the Endless ' +
  'Wait; the kingdom held its breath, and when the curse was bound at last she cried across the ' +
  'smoking field: "By hammer and hash, it is done!"';

document.addEventListener('DOMContentLoaded', () => {
  // Fetch + Zod-validate the committed bundle FIRST (the async boundary), then boot synchronously from
  // it. loadBundle fails LOUD on a malformed/missing bundle (build-time-strict / replay-forgiving line)
  // — a missing bundle is a hard boot error, not a silent fallback. The .catch surfaces it observably.
  void loadBundle()
    .then((bundle) => bootArena(bundle))
    .catch((err: unknown) => {
      // review F1: surface the boot failure as a CLEAN, observable error — log loudly AND render a
      // visible boot-error banner — instead of re-throwing into a dangling rejection (the terminal
      // .catch of a void-ed promise has no further handler, so a throw here is only an unhandled-
      // rejection warning, not an attributable failure). A missing/old/malformed bundle must not
      // silently render nothing.
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('Replay boot failed: could not load the ReplayBundle.', error);
      renderBootError(error);
    });
});

// review F1: render a visible boot-error banner into the game container so a missing/malformed bundle
// produces an OBSERVABLE failure on screen (the fail-loud intent), not a blank canvas + a console-only
// rejection. Text-content only (no innerHTML) so the error message can never inject markup.
function renderBootError(error: Error): void {
  const host = document.getElementById('game-container') ?? document.body;
  const banner = document.createElement('div');
  banner.setAttribute('role', 'alert');
  banner.dataset.bootError = 'true';
  banner.textContent = `Replay failed to load: ${error.message}`;
  host.appendChild(banner);
}

function bootArena(bundle: ReplayBundle): void {
  // The DEV-ONLY ?saga preview (Story 4.2): when present, thread the canned dev Saga OVERRIDE into the
  // boot so the operator can watch the victory panel render even if the bundle's Saga is unauthored.
  // GUARDED by import.meta.env.DEV: Vite statically replaces it with `false` in `build`, so this branch
  // (and the canned string's only use) dead-code-eliminates from the production bundle — no dev Saga
  // ships. The production path now surfaces the BUNDLE'S baked Saga via readSaga(bundle). [story Task 4]
  const wantSagaPreview =
    import.meta.env.DEV && new URLSearchParams(window.location.search).get('saga') !== null;
  const handle = bootFromBundle(
    bundle,
    'game-container',
    wantSagaPreview ? { saga: DEV_PREVIEW_SAGA } : {},
  );

  // The DEV-ONLY preview triggers (Story 3.4 summon + Story 3.5 shaman/dispel). The `?cinematic=` URL
  // flag plays a signature cinematic on demand so the operator can WATCH it. `summon` is omitted from
  // the committed FixtureInterpreter by design (no groundable sub-agent-spawn event), so its dev preview
  // is the ONLY way to see it; `shaman` + `dispel` DO fire on the committed fixture during normal
  // playback (the FixtureInterpreter tags shaman@u-0010#0 + dispel@u-0002#1), so their hooks are a
  // replay-on-demand convenience (re-watch without scrubbing to the exact beat). GUARDED by
  // import.meta.env.DEV: Vite statically replaces it with `false` in `build`, so the entire branch (and
  // the preview*Cinematic call trees) dead-code-eliminates from the production bundle — the dev-only
  // ergonomics never ship. Each plays the cinematic DIRECTLY over the current snapshot; NONE injects a
  // fake annotation into the production overlay.
  if (import.meta.env.DEV) {
    const cinematic = new URLSearchParams(window.location.search).get('cinematic');
    if (cinematic === 'summon') handle.previewSummonCinematic();
    else if (cinematic === 'shaman') handle.previewShamanCinematic();
    else if (cinematic === 'dispel') handle.previewDispelCinematic();
  }

  // The ON-DEMAND Legend / transparency portal (Story 4.4, FR-11, UJ-2). The always-visible toggle
  // button the boot mounts IS the production affordance ("open the Legend") — it ships and works in
  // prod with no flag. The DEV-ONLY ?legend flag merely AUTO-opens the panel during `pnpm dev` so the
  // operator can verify its layout/legibility mid-playback without a click. GUARDED by import.meta.env
  // .DEV: Vite statically replaces it with `false` in `build`, so this branch dead-code-eliminates from
  // the production bundle (the ?cinematic= / ?saga DCE-preview precedent). Opening the Legend does NOT
  // mutate the reducer/cursor/BattleState (the overlay holds no dispatch edge — Dev Notes #5). [Task 5]
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('legend') !== null) {
    handle.legend.open();
  }
}