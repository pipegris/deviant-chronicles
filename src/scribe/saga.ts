import type { ReplayBundle } from '../schema/replay-bundle';

// saga — the SDK-FREE, browser-reachable Saga READER (Layer 2, Told). This is the module that SHIPS
// in the browser bundle: it reads the baked Saga string from the ReplayBundle and exposes it for
// display at the victory milestone. It has NO network, NO LLM, NO SDK — it only reads the baked
// string. The offline authoring (the one claude-opus-4-8 call) lives in the browser-UNREACHABLE
// saga-author.ts; this reader is the offline-at-replay half (NFR-5). [architecture.md#Directory
// Structure L358 "saga.ts — reads the baked Saga from the bundle"; #R4 L236-238]
//
// LAYER-2 DISCIPLINE (R1): this makes NO truth claim that feeds mechanics. It returns a string|null
// and constructs NO BattleState/Beat, writes NO mechanics field — reading/displaying the Saga mutates
// NO Layer-0 state. ReplayBundle is a TYPE-only import. [architecture.md#R1 L225-228]
//
// THE NOT-YET-AUTHORED / NULL POSTURE: ReplayBundle.saga is `string | null` (Story 1.2 — explicit
// null when unauthored). readSaga surfaces that null verbatim; the victory-display wiring treats null
// as "no Saga to show" (the panel simply does not render) — it is NOT an error. This is the project's
// fail-closed-to-default posture at replay time. The single REAL bake (the deferred Epic-5 operator
// step) is what flips `saga` from null to the lush prose. [src/schema/replay-bundle.ts L20-21]

// Return the baked Saga string verbatim, or null when not yet authored. Pure: it only reads
// bundle.saga (no transform, no re-wrap), so a baked-then-loaded Saga is byte-stable.
export function readSaga(bundle: ReplayBundle): string | null {
  return bundle.saga;
}
