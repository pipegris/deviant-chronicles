import { startArena } from './render/arena-boot';

// Story 2.3: the browser entry boots the Phaser ARENA (the RenderPort + playback drive), replacing
// the template's "Make something fun!" demo scene. The Anthropic SDK is NOT on this path (R4 — the
// browser entry never imports @anthropic-ai/sdk). The old template bootstrap (src/game/main.ts +
// its demo scenes) is left in place but unused.
document.addEventListener('DOMContentLoaded', () => {
  const handle = startArena('game-container');

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
});