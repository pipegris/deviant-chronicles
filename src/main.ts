import { startArena } from './render/arena-boot';

// Story 2.3: the browser entry boots the Phaser ARENA (the RenderPort + playback drive), replacing
// the template's "Make something fun!" demo scene. The Anthropic SDK is NOT on this path (R4 — the
// browser entry never imports @anthropic-ai/sdk). The old template bootstrap (src/game/main.ts +
// its demo scenes) is left in place but unused.
document.addEventListener('DOMContentLoaded', () => {
  startArena('game-container');
});