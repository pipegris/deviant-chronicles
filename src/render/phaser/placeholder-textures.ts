// Namespace import: Phaser 4's ESM build has no default export (verified), so `import Phaser` would
// be undefined. We only need the Phaser.Scene TYPE here; a namespace import provides it.
import * as Phaser from 'phaser';
import type { EntityKind } from '../render-model';

// placeholder-textures — generate PLACEHOLDER textures at runtime (colored rects) keyed by an asset
// manifest. NO real art file is loaded. Final AI art (Story 5.3) is a manifest + loader change
// confined to render/: the scene references manifest[kind], never a hard-coded 'boss.png'. The
// engine never blocks on final art. [epics.md#Story-2.3 AC2 L288; #Story-5.3 L545]

// The default/fallback manifest (logical entity kind -> placeholder texture key) so the arena boots
// with placeholders even when no ReplayBundle.assetManifest is supplied (none exists for v0.1 —
// public/bundles/ is empty). The manifest indirection IS the swap seam. The eventual source is
// ReplayBundle.assetManifest (Record<string,string>, already in the schema). [src/schema/replay-bundle.ts L24-25]
export const DEFAULT_ASSET_MANIFEST: Record<EntityKind, string> = {
  forgemaiden: 'placeholder-forgemaiden',
  boss: 'placeholder-boss',
  minion: 'placeholder-minion',
};

// A placeholder texture's visual spec: a colored rect of a given size. Distinct colors/sizes make
// the three kinds legible at a glance (operator pass), and a larger Boss reads as the antagonist.
type Placeholder = { color: number; width: number; height: number };

const PLACEHOLDERS: Record<EntityKind, Placeholder> = {
  forgemaiden: { color: 0x4fc3f7, width: 64, height: 96 }, // hero — tall blue
  boss: { color: 0xe53935, width: 128, height: 160 }, // antagonist — large red
  minion: { color: 0xab47bc, width: 48, height: 64 }, // flanking — small purple
};

// generatePlaceholderTextures — bake a colored-rect texture for each manifest entry into the scene's
// Texture Manager, keyed by the manifest value. Idempotent (skips a key already registered). Each
// texture is built with a Graphics object's generateTexture(). Generation is GUARDED: under
// Phaser.HEADLESS (the boot smoke) the canvas/renderer is minimal and generateTexture can throw or
// no-op in jsdom — a failure must NOT break scene.create(), so we swallow it. The scene degrades to
// a plain Rectangle game object when a manifest texture is absent (see arena-scene.ts), so the cast
// is still created. This is the story's jsdom-fallback posture: never fake a pass, but don't let a
// non-visual texture-bake gap throw in the headless smoke.
export function generatePlaceholderTextures(
  scene: Phaser.Scene,
  manifest: Record<string, string> = DEFAULT_ASSET_MANIFEST,
): void {
  for (const kind of Object.keys(PLACEHOLDERS) as EntityKind[]) {
    const key = manifest[kind];
    if (!key || scene.textures.exists(key)) continue;
    const spec = PLACEHOLDERS[kind];
    try {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(spec.color, 1);
      g.fillRect(0, 0, spec.width, spec.height);
      g.generateTexture(key, spec.width, spec.height);
      g.destroy();
    } catch {
      // Texture bake unavailable in this (headless/jsdom) environment — the scene falls back to a
      // Rectangle. Recorded as a verification limitation, not silently faked.
    }
  }
}

// Re-export the visual spec so the scene can size its fallback Rectangle to match a placeholder when
// the baked texture is absent (keeps the headless fallback the same footprint as the real placeholder).
export function placeholderSpec(kind: EntityKind): { color: number; width: number; height: number } {
  return PLACEHOLDERS[kind];
}
