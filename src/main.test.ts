// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// review F1 — the browser entry's boot-failure path. main.ts loads the committed ReplayBundle in the
// DOMContentLoaded handler; when loadBundle rejects (a missing/old/malformed bundle), the fix must
// surface a CLEAN, observable failure — a console.error AND a visible boot-error banner — instead of
// re-throwing inside the terminal .catch of a void-ed promise (which is only an unhandled-rejection
// warning, not an attributable failure). This pins both: the banner renders, and no error escapes the
// .catch as an unhandled rejection.
//
// main.ts registers ONE DOMContentLoaded listener at module load, so we mock ./render/arena-boot
// (loadBundle/bootFromBundle) BEFORE importing it ONCE, then drive each case by re-dispatching the
// event and varying the mock's resolve/reject (importing once keeps the listener count stable at 1).

const loadBundle = vi.fn();
const bootFromBundle = vi.fn();

vi.mock('./render/arena-boot', () => ({
  loadBundle: (...args: unknown[]) => loadBundle(...args),
  bootFromBundle: (...args: unknown[]) => bootFromBundle(...args),
}));

// Drive the registered DOMContentLoaded handler and let the loadBundle promise + its .then/.catch
// microtasks settle (the handler is sync but its body is a promise chain).
async function fireDomReadyAndSettle(): Promise<void> {
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await Promise.resolve();
  await Promise.resolve();
}

let unhandled: unknown[] = [];
function onUnhandled(e: PromiseRejectionEvent): void {
  e.preventDefault();
  unhandled.push(e.reason);
}

beforeAll(async () => {
  await import('./main');
});

beforeEach(() => {
  loadBundle.mockReset();
  bootFromBundle.mockReset();
  unhandled = [];
  document.body.innerHTML = '';
  const gameContainer = document.createElement('div');
  gameContainer.id = 'game-container';
  document.body.appendChild(gameContainer);
  window.addEventListener('unhandledrejection', onUnhandled);
});

afterEach(() => {
  window.removeEventListener('unhandledrejection', onUnhandled);
  vi.restoreAllMocks();
});

afterAll(() => {
  vi.resetModules();
});

describe('main.ts — boot-failure surfacing (review F1)', () => {
  it('renders a visible boot-error banner into #game-container when loadBundle rejects', async () => {
    loadBundle.mockRejectedValue(new Error('loadBundle: HTTP 404 fetching /bundles/story-10-1.json'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await fireDomReadyAndSettle();

    const banner = document.querySelector('#game-container [data-boot-error="true"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain('HTTP 404');
    expect(banner?.getAttribute('role')).toBe('alert');
    // The failure is logged loudly too (the operator/console sees it).
    expect(errorSpy).toHaveBeenCalled();
    // bootFromBundle is NOT reached — a failed load must not boot the arena.
    expect(bootFromBundle).not.toHaveBeenCalled();
  });

  it('does NOT produce an unhandled rejection on a failed load (the .catch is terminal, not re-throwing)', async () => {
    loadBundle.mockRejectedValue(new Error('malformed bundle'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await fireDomReadyAndSettle();

    // The pre-fix code re-threw inside the terminal .catch → a dangling rejection. The fix surfaces the
    // error in-handler, so nothing escapes as an unhandledrejection.
    expect(unhandled).toHaveLength(0);
  });

  it('boots the arena (no error banner) when loadBundle resolves with a bundle', async () => {
    const fakeBundle = { schemaVersion: 1 } as unknown;
    loadBundle.mockResolvedValue(fakeBundle);

    await fireDomReadyAndSettle();

    expect(bootFromBundle).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-boot-error="true"]')).toBeNull();
  });
});
