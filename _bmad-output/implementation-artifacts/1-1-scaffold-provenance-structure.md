# Story 1.1: Scaffold the project with provenance-enforced structure

Status: done

## Story

As the builder,
I want the Phaser 4 + Vite + TS project scaffolded with the provenance-aligned module structure and import-boundary enforcement,
So that every later story is written inside a foundation that mechanically prevents the determinism and provenance violations (R1–R5).

## Acceptance Criteria

**Given** an empty target directory
**When** I run `pnpm dlx degit phaserjs/template-vite-ts dev-chronicles && cd dev-chronicles && pnpm install && pnpm add -D vitest`
**Then** the Phaser 4.1 + Vite 6.3 + TS 5.7 template builds and `pnpm dev` serves the dev server
**And** the `src/` tree contains the empty layer directories `schema/ ingest/ translate/ pace/ model/ interpret/ scribe/ render/ portal/ config/` plus `scripts/` and `public/bundles/`.

**Given** the scaffold
**When** ESLint runs
**Then** an import-boundary rule (`eslint-plugin-boundaries` or `import/no-restricted-paths`) is configured encoding R1 (no `interpret/` import from Layer 0), R4 (`@anthropic-ai/sdk` only in `scripts/`+`interpret/`+`scribe/`), and R5 (Phaser only in `render/`)
**And** a deliberate boundary-violating import fails lint.

**Given** the repo
**When** CI (GitHub Actions) runs on push
**Then** it executes `typecheck + vitest + vite build` and fails on any error
**And** TS `strict` is enabled and files follow kebab-case with co-located `*.test.ts`.

## Dev Notes

### Scaffold method (degit into a non-empty root)
`degit` requires an empty target and the repo root already held `_bmad/`, `_bmad-output/`,
`.claude/`, `design-artifacts/`, `docs/`, `.git/`. So the template was cloned to `/tmp/dc-template`
via `pnpm dlx degit phaserjs/template-vite-ts /tmp/dc-template` and its files were **moved** into the
repo root without touching the pre-existing directories. Then `pnpm install`, `pnpm add -D vitest`.

### Stack versions actually installed
| Tool | Spec target | Installed |
| --- | --- | --- |
| Phaser | 4.1 | **4.0.0** (current template ships `phaser@4.0.0`, not 4.1; same major — proceeded) |
| Vite | 6.3 | 6.4.3 (resolved from `^6.3.1`) |
| TypeScript | 5.7 | 5.7.3 |
| Vitest | (add) | 4.1.8 |
| Zod (runtime) | 4.4.3 | 4.4.3 (pinned exact) |
| @anthropic-ai/sdk (dev/offline) | 0.104.1 | 0.104.1 (pinned exact, devDependency) |
| ESLint | — | 9.39.4 (flat config) |
| typescript-eslint | — | 8.61.0 |
| eslint-plugin-import | — | 2.32.0 |
| eslint-import-resolver-typescript | — | 4.4.5 |
| @eslint/js | — | 10.0.1 |
| node (local) | — | 24.15.0 / pnpm 10.10.0 |

**Deviation:** template ships Phaser **4.0.0** "Salusa" not 4.1; same major, all APIs the renderer
needs are present. The architecture's `phaserjs/template-vite-ts` choice is honored as-is.

### Template adjustments
- `package.json` rewritten: name `dev-chronicles`, `"type": "module"` (so `eslint.config.ts`/`vitest.config.ts`
  load), and scripts `dev/build/test/typecheck/lint/bundle:story-10-1`.
- **Removed `log.js`** and its `node log.js …` calls from the dev/build scripts. `log.js` made a silent
  HTTP call to `gryzor.co` (Phaser telemetry) on every dev/build. An offline-determinism project should
  emit zero unexpected network calls, so the telemetry hook was dropped (scripts now run vite directly,
  equivalent to the template's `-nolog` variants). The template's `README.md` still documents `log.js`
  (left untouched — out of scope; noted here).
- `screenshot.png` (template marketing asset) removed.
- Kept `src/main.ts` and `src/game/` (Phaser bootstrap + scenes) verbatim.

### `src/` tree created (provenance layers, architecture §Directory Structure)
Empty layer dirs each carry a `.gitkeep` so git tracks them until real files land:
```
src/schema/                 (smoke test lives here; no .gitkeep)
src/ingest/  src/ingest/__fixtures__/
src/translate/
src/pace/    src/pace/__snapshots__/
src/model/
src/interpret/
src/scribe/
src/render/  src/render/phaser/
src/portal/
src/config/
scripts/
public/bundles/
src/main.ts  src/game/...   (template bootstrap, kept)
```

### Import-boundary mechanism (the load-bearing deliverable)
**Chosen mechanism:** ESLint 9 flat config (`eslint.config.ts`) using
`eslint-plugin-import`'s `import/no-restricted-paths` (for R1) + the core
`no-restricted-imports` rule (for R4/R5). Chose this over `eslint-plugin-boundaries`
because it configures cleanly on ESLint 9 flat config with the TS resolver and needs
no element-type taxonomy for a package-and-zone restriction.

Encoding:
- **R1 (Layer-0 must not import `interpret/`):** `import/no-restricted-paths` with four
  zones, each `target` = a Layer-0 dir (`src/ingest`, `src/translate`, `src/pace`,
  `src/model`) and `from` = `src/interpret`. Importing the Layer-1 overlay from any Layer-0
  module errors.
- **R4 (`@anthropic-ai/sdk` offline-only):** forbid-by-default + re-allow. The base config
  bans `@anthropic-ai/sdk` via `no-restricted-imports` for all `src/**`+`scripts/**`. A more
  specific config object matching `scripts/**`, `src/interpret/**`, `src/scribe/**` resets the
  rule to permit anthropic (still banning phaser). Anything else (incl. `src/main.ts`,
  `src/game/`, `src/render/`, `src/model/`) keeps the ban.
- **R5 (`phaser` only in `render/`+`game/`):** same inversion. `phaser` is banned by default;
  a config object matching `src/render/**` + `src/game/**` re-allows it (still banning anthropic).
  `src/game/` is included because it is the template's Phaser bootstrap.

`eslint .` ignores agent-tooling / build / planning dirs (`_bmad/`, `_bmad-output/`, `.claude/`,
`.omc/`, `design-artifacts/`, `docs/`, `dist/`, `node_modules/`, `public/`, `vite/`).

### Boundary-probe evidence (deliberate violation → lint fails → probe removed)
A throwaway `src/pace/__boundary-probe.ts` (plus a temp `src/interpret/__probe-target.ts` so the
R1 zone had a resolvable source) was added importing all three forbidden things from Layer-0 `pace/`.
`pnpm lint` then produced (exit 1):
```
src/pace/__boundary-probe.ts
  1:1   error  'phaser' import is restricted from being used. R5: phaser may only be imported from src/render/ and src/game/ (the RenderPort seam)                                   no-restricted-imports
  2:1   error  '@anthropic-ai/sdk' import is restricted from being used. R4: @anthropic-ai/sdk is offline/build-time only — allowed solely in scripts/, src/interpret/, src/scribe/  no-restricted-imports
  3:23  error  Unexpected path "../interpret/__probe-target" imported in restricted zone. R1: Layer-0 pace/ must not import the Layer-1 interpret/ overlay                           import/no-restricted-paths
✖ 3 problems (3 errors, 0 warnings)
```
All three rules (R1, R4, R5) fired. Both probe files were then deleted; `pnpm lint` returns clean (exit 0).

### TS strict + conventions
- `tsconfig.json`: `strict: true` plus `noImplicitOverride`, `noImplicitReturns`, `noUnusedLocals`,
  `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`,
  `resolveJsonModule`, `types: ["node","vitest/globals"]`, `include: ["src","scripts"]`.
  `strictPropertyInitialization` kept **off** (Phaser Scene subclasses assign fields in lifecycle
  hooks, not the ctor — template would not typecheck otherwise). `exactOptionalPropertyTypes` not
  enabled (risk against Phaser config types; not required by AC).
- New files kebab-case; tests co-located as `*.test.ts`. Template's PascalCase scene files
  (`src/game/scenes/*.ts`) left as-is (pre-existing template style; not part of this story's surface).

### Vitest + green smoke test
- `vitest.config.ts`: `environment: 'node'`, `include: ['src/**/*.test.ts']`.
- `src/schema/schema.test.ts`: a real test — builds a `XxxSchema` const + `z.infer` type, asserts a
  valid object parses and an invalid one throws `z.ZodError`. Exercises the actual Vitest+Zod toolchain
  and the naming convention, not `expect(true)`.

### CI
`.github/workflows/ci.yml` on push + PR: pnpm/action-setup@v4, setup-node@v4 (node 22, pnpm cache),
`pnpm install --frozen-lockfile`, then `typecheck` → `lint` → `test` → `build`, failing on any error.
Lockfile exists, so `--frozen-lockfile` is used.

### .gitignore / .env.example
- `.gitignore` merged with the template's. Ignores: `node_modules/`, `dist/`, `.env` + `.env.*`
  (with `!.env.example`), logs, `.claude/`, `_bmad/`, `.omc/state|sessions|logs|notepad.md|project-memory.json`,
  OS/editor cruft. Does NOT ignore `_bmad-output/`, `.omc/workflows/`, `public/bundles/`, source + config.
- `.env.example`: single `ANTHROPIC_API_KEY=` line with a comment that it is offline-scripts-only and
  never bundled.

### `bundle:story-10-1` script
Included as a placeholder that echoes a "not yet implemented (Epic 5, Story 5.2)" message and exits 0.

## File List

Added:
- `eslint.config.ts`
- `vitest.config.ts`
- `.env.example`
- `.github/workflows/ci.yml`
- `src/schema/schema.test.ts`
- `.gitkeep` in: `src/ingest/`, `src/ingest/__fixtures__/`, `src/translate/`, `src/pace/`,
  `src/pace/__snapshots__/`, `src/model/`, `src/interpret/`, `src/scribe/`, `src/render/`,
  `src/render/phaser/`, `src/portal/`, `src/config/`, `scripts/`, `public/bundles/`
- `_bmad-output/implementation-artifacts/1-1-scaffold-provenance-structure.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

Modified (from template):
- `package.json` (name, type:module, scripts, deps)
- `tsconfig.json` (strict family, include scripts, node/vitest types)
- `.gitignore` (merged provenance/agent/env rules)

Added via scaffold (template, moved into root): `index.html`, `src/main.ts`, `src/game/**`,
`public/style.css`, `public/favicon.png`, `public/assets/*`, `vite/config.{dev,prod}.mjs`,
`src/vite-env.d.ts`, `README.md`, `LICENSE`, `pnpm-lock.yaml`.

Removed (template): `log.js` (telemetry), `screenshot.png`, `package-lock.json` (npm; using pnpm).

## Change Log

- 2026-06-14 — Story 1.1 implemented: scaffolded `phaserjs/template-vite-ts` in-place (Phaser 4.0.0
  / Vite 6.4 / TS 5.7.3 / Vitest 4.1.8), added Zod 4.4.3 + @anthropic-ai/sdk 0.104.1 (dev),
  created the provenance `src/` layer tree, authored the ESLint import-boundary config encoding
  R1/R4/R5, proved a deliberate violation fails lint then removed the probe, enabled TS strict,
  added a green Vitest smoke test, and wired GitHub Actions CI (typecheck + lint + vitest + build).

## Completion Notes

All four gates pass on a clean tree:
- `pnpm typecheck` — PASS (tsc --noEmit, no errors).
- `pnpm lint` — PASS (clean tree, exit 0); the deliberate boundary probe failed with 3 errors (R1+R4+R5) before removal.
- `pnpm test` — PASS (vitest run, 1 file / 2 tests green).
- `pnpm build` — PASS (vite build → `dist/` with index.html + assets + bundles).

Verified: the production bundle contains no `@anthropic-ai/sdk` reference (R4 holds at the bundle level).
No git commit performed (operator commits).

Deviations to note: Phaser 4.0.0 (not 4.1) — current template version; same major. `log.js` telemetry
removed for the offline ethos. `dist/` was generated by the build gate and then deleted to leave a clean tree.
