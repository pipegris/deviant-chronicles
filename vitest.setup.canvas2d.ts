// vitest.setup.canvas2d — a MINIMAL HTMLCanvasElement 2D-context stub for the jsdom env, installed
// before any test module imports Phaser. WHY this exists (recorded honestly, per Story 2.3 Task 7's
// jsdom-fallback clause): jsdom does NOT implement HTMLCanvasElement.getContext('2d') (it returns
// null and warns unless the heavyweight native `canvas` package is installed and BUILT). Phaser
// 4.0.0 touches a 2D context at MODULE LOAD — CanvasFeatures.checkInverseAlpha (phaser.esm.js
// ~L24538) does `context.fillStyle = ...` on the result of getContext('2d'), which throws on null
// the instant `import Phaser from 'phaser'` runs. node-canvas cannot be built in this environment
// (its native .node binary is unavailable / its build script is blocked), so we supply a tiny inert
// 2D context instead.
//
// This does NOT weaken the headless boot smoke. Phaser.HEADLESS "doesn't create either a Canvas or
// WebGL Renderer" (phaser.esm.js L16508) — nothing actually rasterizes to pixels under HEADLESS, so
// the 2D context is only ever touched by feature-detection and the optional generateTexture raster
// path, neither of which is the thing under test. The smoke still boots a REAL Phaser.HEADLESS game
// and asserts the REAL ArenaScene creates the REAL game objects (cast, bars, gauge) and that
// applySnapshot updates the tracked Boss-bar fraction. Pixel/visual correctness remains operator-only.
//
// GUARDED: only patches when a DOM is present (the jsdom env) AND getContext is missing/returns null,
// so it is a NO-OP in the default node env (the pure render-model / render-port tests are untouched).

// A Proxy-backed inert 2D context: every property read returns a no-op function (covers ctx.save,
// fillRect, beginPath, arc, etc.), and the few accessors Phaser reads back get sane shapes. Property
// SETS (fillStyle, strokeStyle, lineWidth, imageSmoothingEnabled, ...) are accepted and ignored.
function makeInert2DContext(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {
    // Shapes Phaser reads back from the context (checkInverseAlpha + texture paths):
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: () => {},
    measureText: () => ({ width: 0 }),
    getContextAttributes: () => ({ willReadFrequently: true }),
    canvas: undefined as unknown,
  };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(obj, prop: string) {
      if (prop in obj) return obj[prop];
      // Any other method (fillRect, save, restore, translate, ...) is an accepted no-op.
      return () => undefined;
    },
    set(obj, prop: string, value) {
      obj[prop] = value; // accept fillStyle/strokeStyle/lineWidth/imageSmoothingEnabled/etc.
      return true;
    },
  };
  return new Proxy(target, handler) as unknown as CanvasRenderingContext2D;
}

// Probe whether jsdom's getContext('2d') is missing or returns null (the case we must stub). The
// probe itself logs a harmless "Not implemented" warning. Any throw => treat as needing the stub.
function getContext2dIsUnusable(proto: HTMLCanvasElement): boolean {
  const original = proto.getContext;
  if (typeof original !== 'function') return true;
  try {
    return original.call(document.createElement('canvas'), '2d') === null;
  } catch {
    return true;
  }
}

if (typeof HTMLCanvasElement !== 'undefined') {
  const proto = HTMLCanvasElement.prototype;
  if (getContext2dIsUnusable(proto)) {
    const inert = makeInert2DContext();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (proto as any).getContext = function getContext(contextId: string): unknown {
      return contextId === '2d' || contextId === '2d-willReadFrequently' ? inert : null;
    };
  }
}

// HTMLImageElement.src stub — WHY (also Story 2.3 Task 7's jsdom-fallback): Phaser's boot does NOT
// complete until the Texture Manager fires READY, which is gated on its three default textures
// (__DEFAULT/__MISSING/__WHITE) loading via `new Image(); image.src = <dataURI>` and firing onload
// (phaser.esm.js TextureManager.addBase64 + updatePending — _pending counts down from 3, emits READY
// at 0; on READY it also builds an internal stamp/tileSprite that REQUIRE __WHITE to actually EXIST
// as a texture). jsdom never fires onload for a data-URI src, so _pending sticks at 3 and `postBoot`
// is never called (boot stalls -> test timeout). We make `.src =` fire `onload` on a microtask so
// addBase64.onload runs create()+Parser.Image and the textures genuinely exist (firing onerror
// instead decrements _pending but leaves __WHITE missing, which then throws in texturesReady — tried
// and rejected). The image reports a sane 1x1 size so Parser.Image's source.width/height are valid.
// The inert 2D-context stub above carries the create()/refresh() raster path. Under HEADLESS nothing
// actually rasterizes; the smoke still boots a real game and asserts the real scene's real objects.
// GUARDED to the jsdom env (HTMLImageElement present); a NO-OP in node.
if (typeof HTMLImageElement !== 'undefined') {
  const proto = HTMLImageElement.prototype;
  const srcDesc = Object.getOwnPropertyDescriptor(proto, 'src');
  // Report a non-zero intrinsic size so TextureSource/Parser.Image compute valid frame dimensions.
  for (const dim of ['width', 'height', 'naturalWidth', 'naturalHeight'] as const) {
    Object.defineProperty(proto, dim, { configurable: true, get: () => 1 });
  }
  Object.defineProperty(proto, 'complete', { configurable: true, get: () => true });
  Object.defineProperty(proto, 'src', {
    configurable: true,
    enumerable: true,
    get(this: HTMLImageElement) {
      return (this as unknown as { _src?: string })._src ?? '';
    },
    set(this: HTMLImageElement, value: string) {
      (this as unknown as { _src?: string })._src = value;
      srcDesc?.set?.call(this, value); // preserve jsdom attribute reflection if present
      queueMicrotask(() => {
        const onload = (this as unknown as { onload?: (e: Event) => void }).onload;
        if (typeof onload === 'function') onload.call(this, new Event('load'));
        this.dispatchEvent(new Event('load'));
      });
    },
  });
}
