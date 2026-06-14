import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

// Provenance-enforcing import boundaries (architecture R1/R4/R5).
//
// R1 — Layer discipline: Layer-0 modules (ingest/translate/pace/model) MUST NOT
//      import the Layer-1 interpret/ overlay. Encoded with import/no-restricted-paths.
// R4 — LLM isolation: @anthropic-ai/sdk is forbidden everywhere by default and
//      re-allowed ONLY in scripts/, src/interpret/, src/scribe/ (offline-only).
// R5 — RenderPort one-way: phaser is forbidden everywhere by default and re-allowed
//      ONLY in src/render/ and src/game/ (the template bootstrap).
//
// R4/R5 use a forbid-by-default + per-directory re-allow pattern: the base config
// bans the package via no-restricted-imports, and later (more specific) config
// objects whose `files` match the permitted directories reset the rule to 'off'.

const restrictAnthropic = {
  name: '@anthropic-ai/sdk',
  message:
    'R4: @anthropic-ai/sdk is offline/build-time only — allowed solely in scripts/, src/interpret/, src/scribe/.',
};

const restrictPhaser = {
  name: 'phaser',
  message: 'R5: phaser may only be imported from src/render/ and src/game/ (the RenderPort seam).',
};

export default tseslint.config(
  {
    // Agent tooling, build output, vendored configs and planning docs are outside the linted surface.
    ignores: [
      'dist/**',
      'node_modules/**',
      'public/**',
      'vite/**',
      '_bmad/**',
      '_bmad-output/**',
      '.claude/**',
      '.omc/**',
      'design-artifacts/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    plugins: { import: importPlugin },
    settings: {
      'import/resolver': {
        typescript: true,
        node: true,
      },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [restrictAnthropic, restrictPhaser] },
      ],

      // R1 — Layer 0 must not reach into the Layer 1 interpret/ overlay.
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/ingest',
              from: './src/interpret',
              message: 'R1: Layer-0 ingest/ must not import the Layer-1 interpret/ overlay.',
            },
            {
              target: './src/translate',
              from: './src/interpret',
              message: 'R1: Layer-0 translate/ must not import the Layer-1 interpret/ overlay.',
            },
            {
              target: './src/pace',
              from: './src/interpret',
              message: 'R1: Layer-0 pace/ must not import the Layer-1 interpret/ overlay.',
            },
            {
              target: './src/model',
              from: './src/interpret',
              message: 'R1: Layer-0 model/ must not import the Layer-1 interpret/ overlay.',
            },
          ],
        },
      ],
    },
  },

  // R4 re-allow: @anthropic-ai/sdk permitted in the offline LLM zones. phaser stays banned here.
  {
    files: ['scripts/**/*.ts', 'src/interpret/**/*.ts', 'src/scribe/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [restrictPhaser] }],
    },
  },

  // R5 re-allow: phaser permitted in the render seam and the Phaser bootstrap. anthropic stays banned here.
  {
    files: ['src/render/**/*.ts', 'src/game/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [restrictAnthropic] }],
    },
  },
);
