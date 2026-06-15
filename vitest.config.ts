import { defineConfig } from 'vitest/config';

// Pure-TS pipeline tests (Layer 0/1). Node environment by default; the renderer
// is excluded from determinism tests (timeline-level, not pixel-level). jsdom is
// opted into per-file later only where the DOM is genuinely needed.
//
// setupFiles runs before any test module imports — it installs a guarded, inert 2D-canvas-context
// stub for the jsdom env (the Story 2.3 headless Phaser boot smoke), because jsdom lacks
// getContext('2d') and Phaser 4 touches it at module load. The stub is a NO-OP in the node env, so
// the pure pipeline tests are unaffected. See vitest.setup.canvas2d.ts for the full rationale.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.canvas2d.ts'],
  },
});
