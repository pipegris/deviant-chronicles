import { startArena } from './render/arena-boot';

// Story 2.3: the browser entry boots the Phaser ARENA (the RenderPort + playback drive), replacing
// the template's "Make something fun!" demo scene. The Anthropic SDK is NOT on this path (R4 — the
// browser entry never imports @anthropic-ai/sdk). The old template bootstrap (src/game/main.ts +
// its demo scenes) is left in place but unused.
document.addEventListener('DOMContentLoaded', () => {
  const handle = startArena('game-container');

  // Story 3.4: the DEV-ONLY preview trigger. `?cinematic=summon` plays the THUNDORR cinematic on
  // demand so the operator can WATCH it now — the committed FixtureInterpreter omits `summon` by
  // design (the thin redacted slice has no groundable sub-agent-spawn event), so the PRODUCTION summon
  // trigger never fires in the dev fixture. GUARDED by import.meta.env.DEV: Vite statically replaces
  // it with `false` in `build`, so the entire branch (and the previewSummonCinematic call tree)
  // dead-code-eliminates from the production bundle — the dev-only ergonomics never ship. It plays the
  // cinematic DIRECTLY over the current snapshot; it injects NO fake summon into the production overlay.
  if (import.meta.env.DEV) {
    const cinematic = new URLSearchParams(window.location.search).get('cinematic');
    if (cinematic === 'summon') handle.previewSummonCinematic();
  }
});