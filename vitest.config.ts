import { defineConfig } from 'vitest/config';

// Pure-TS pipeline tests (Layer 0/1). Node environment by default; the renderer
// is excluded from determinism tests (timeline-level, not pixel-level). jsdom is
// opted into per-file later only where the DOM is genuinely needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
