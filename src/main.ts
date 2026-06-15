import { startArena } from './render/arena-boot';

// Story 2.3: the browser entry boots the Phaser ARENA (the RenderPort + playback drive), replacing
// the template's "Make something fun!" demo scene. The Anthropic SDK is NOT on this path (R4 — the
// browser entry never imports @anthropic-ai/sdk). The old template bootstrap (src/game/main.ts +
// its demo scenes) is left in place but unused.
// A canned dev Saga so the operator can WATCH the victory panel during `pnpm dev` BEFORE the real
// claude-opus-4-8 bake (the deferred Epic-5 operator step). It is NOT a real bundle — the production
// browser path carries no baked Saga yet (Story 5.2 loads the bundle), so the live victory panel is
// otherwise dormant (the SAME dormant-in-fixture reality as the summon cinematic). [story Task 4]
const DEV_PREVIEW_SAGA =
  'And in the last hour the Forgemaiden raised her hammer against the Hanging Curse of the Endless ' +
  'Wait; the kingdom held its breath, and when the curse was bound at last she cried across the ' +
  'smoking field: "By hammer and hash, it is done!"';

document.addEventListener('DOMContentLoaded', () => {
  // The DEV-ONLY ?saga preview (Story 4.2): when present, thread a canned dev Saga into the boot so the
  // operator can watch the victory panel render at the milestone during `pnpm dev`. GUARDED by
  // import.meta.env.DEV: Vite statically replaces it with `false` in `build`, so this branch (and the
  // canned string's only use) dead-code-eliminates from the production bundle — no dev Saga ships. It
  // injects NO real bundle and does NOT alter the production path (which carries a null Saga until
  // Story 5.2). The SAME ?cinematic= DCE-preview precedent. [story Task 4 §"Operator-verifying the panel"]
  const wantSagaPreview =
    import.meta.env.DEV && new URLSearchParams(window.location.search).get('saga') !== null;
  const handle = startArena('game-container', wantSagaPreview ? { saga: DEV_PREVIEW_SAGA } : {});

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
});