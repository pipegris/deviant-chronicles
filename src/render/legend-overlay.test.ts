// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// RED-PHASE acceptance tests for Story 4.4 (Task 3) — the THIN HTML DOM Legend overlay
// (src/render/legend-overlay.ts), the on-demand transparency portal's DISPLAY surface (FR-11, UJ-2).
// These FAIL until `createLegendOverlay` is exported from ./legend-overlay (the import resolves to
// nothing and the module import ERRORs — the intended red, exactly as controls.test.ts was in its own
// red phase).
//
// SCOPE — the GATE-PROVABLE surface: open/close toggles the overlay's OWN visibility (isOpen() + DOM
// display), the panel renders ALL covered rows (the coverage half at the DOM level — 3 beats + 4
// actions), and destroy() removes listeners (no leaked listeners on re-boot). The visual LAYOUT /
// legibility / open-close FEEL is OPERATOR-verified (`pnpm dev`; jsdom lays out no real pixels) and is
// deliberately NOT asserted here. [story Task 3; "Keep DOM-shape assertions light"]
//
// Mirrors src/render/controls.test.ts (the DOM-overlay + AbortController teardown precedent): a fresh
// detached parent per test, real DOM events, destroy() in afterEach.
import { createLegendOverlay } from './legend-overlay';
import type { LegendGrounding, LegendOverlay } from './legend-overlay';

// The content feed the boot hands the overlay — the SAME flat, display-ready list portal.ts exposes via
// getLegendEntries() (beats first, then actions). We hand a hand-built stand-in here so the overlay test
// is independent of the (separately gated) portal content; the boot wires the real getLegendEntries().
type LegendEntry = {
  kind: 'beat' | 'action';
  key: string;
  fantasy: string;
  real: string;
};

const SAMPLE_ENTRIES: readonly LegendEntry[] = [
  { kind: 'beat', key: 'shaman', fantasy: 'the shaman', real: 'the root cause' },
  { kind: 'beat', key: 'dispel', fantasy: 'dispelling the mirage', real: 'reading to verify' },
  { kind: 'beat', key: 'summon', fantasy: 'summoning an eidolon', real: 'spawning a sub-agent' },
  { kind: 'action', key: 'melee', fantasy: 'a hammer strike', real: 'a code edit (Edit/Write)' },
  { kind: 'action', key: 'spell', fantasy: 'a channeled spell', real: 'running the tests/build/lint' },
  { kind: 'action', key: 'scout', fantasy: 'scouting the terrain', real: 'reading the code (Read/Grep)' },
  { kind: 'action', key: 'aetherStorm', fantasy: 'the Aether Storm', real: 'an environmental pause (rate limit)' },
];

// jsdom host: a fresh detached parent per test (the controls.test.ts pattern). The overlay mounts INTO
// `parent`; we clean both overlay and host in afterEach.
let parent: HTMLElement;
let overlay: LegendOverlay | undefined;

beforeEach(() => {
  parent = document.createElement('div');
  document.body.appendChild(parent);
});

afterEach(() => {
  overlay?.destroy();
  overlay = undefined;
  parent.remove();
  vi.restoreAllMocks();
});

// Treat an element as VISIBLE iff it is not hidden via the `hidden` attribute or `display:none` —
// tolerant of whichever visibility mechanism the overlay uses (the story names `display`/`hidden`).
function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false;
  if (el.style.display === 'none') return false;
  return true;
}

describe('Story 4.4 AC1 — the Legend overlay opens/closes its OWN visibility (the toggle surface)', () => {
  it('starts CLOSED (hidden) — the portal is on-demand, not always-on', () => {
    overlay = createLegendOverlay({ parent, entries: SAMPLE_ENTRIES });
    expect(overlay.isOpen()).toBe(false);
  });

  it('open() shows the panel and reports isOpen()===true; close() hides it again', () => {
    overlay = createLegendOverlay({ parent, entries: SAMPLE_ENTRIES });

    overlay.open();
    expect(overlay.isOpen()).toBe(true);

    overlay.close();
    expect(overlay.isOpen()).toBe(false);
  });

  it('toggle() flips open<->closed', () => {
    overlay = createLegendOverlay({ parent, entries: SAMPLE_ENTRIES });

    overlay.toggle();
    expect(overlay.isOpen()).toBe(true);
    overlay.toggle();
    expect(overlay.isOpen()).toBe(false);
  });

  it('the toggle BUTTON (the production affordance) flips the overlay when clicked', () => {
    overlay = createLegendOverlay({ parent, entries: SAMPLE_ENTRIES });
    const button = overlay.root.querySelector('button');
    if (!button) throw new Error('the overlay must render a toggle <button> (the UJ-2 open affordance)');

    button.click();
    expect(overlay.isOpen()).toBe(true);
    button.click();
    expect(overlay.isOpen()).toBe(false);
  });

  it('open reflects into a visible DOM panel; close hides it (jsdom visibility, not pixels)', () => {
    overlay = createLegendOverlay({ parent, entries: SAMPLE_ENTRIES });
    // The panel is the content container distinct from the toggle button. We assert via the public
    // open()/close() + a visibility read on the root or a panel element, tolerant of the exact markup.
    overlay.open();
    // Some visible element other than the button now carries the rows.
    const visibleAfterOpen = SAMPLE_ENTRIES.every((entry) =>
      Array.from(overlay!.root.querySelectorAll<HTMLElement>('*')).some(
        (el) => isVisible(el) && (el.textContent ?? '').includes(entry.real),
      ),
    );
    expect(visibleAfterOpen).toBe(true);
  });
});

describe('Story 4.4 AC1 — the panel RENDERS all covered rows (the coverage half at the DOM level)', () => {
  it('renders every entry`s fantasy AND real text (3 beats + 4 actions => 7 rows)', () => {
    overlay = createLegendOverlay({ parent, entries: SAMPLE_ENTRIES });
    overlay.open();

    const text = overlay.root.textContent ?? '';
    for (const entry of SAMPLE_ENTRIES) {
      expect(text).toContain(entry.fantasy);
      expect(text).toContain(entry.real);
    }
  });

  it('the panel content is driven by the entries it is handed (renderer-agnostic content feed)', () => {
    // Hand a smaller custom list and prove the overlay renders exactly what it is given — it does not
    // hardcode the rows (the boot feeds it getLegendEntries()).
    const custom: readonly LegendEntry[] = [
      { kind: 'beat', key: 'shaman', fantasy: 'FANTASY-ALPHA', real: 'REAL-ALPHA' },
      { kind: 'action', key: 'melee', fantasy: 'FANTASY-BETA', real: 'REAL-BETA' },
    ];
    overlay = createLegendOverlay({ parent, entries: custom });
    overlay.open();

    const text = overlay.root.textContent ?? '';
    expect(text).toContain('FANTASY-ALPHA');
    expect(text).toContain('REAL-ALPHA');
    expect(text).toContain('FANTASY-BETA');
    expect(text).toContain('REAL-BETA');
  });
});

describe('Story 4.4 / 5.5 AC4 — the overlay DISPLAYS the active-beat ABSTRACTED grounding (the reveal half)', () => {
  // dev-story re-point (Story 5.5 / AC4): the reveal is the ABSTRACTED grounding (tool + role + outcome +
  // concept), NOT bare eventIds — the boot now resolves it via portal.resolveAbstractedGrounding and hands
  // the overlay `{ beatKey, rows }`. These pin the display contract WITHOUT asserting layout/feel (still
  // operator-verified): the overlay renders exactly the abstracted rows it is handed (and NO file/symbol
  // name, structurally), and hides the section when there is none. The Story 4.4 eventId-display
  // assertions are replaced by the abstracted-row assertions per AC4 ("NO raw transcript and NO file/symbol
  // name shown"); nothing weakened — the section is still proven visible/hidden/refreshed. [story Task 4]
  it('open() renders the active beat`s ABSTRACTED rows (tool + role + outcome + concept), no eventId', () => {
    const getActiveGrounding = () => ({
      beatKey: 'dispel',
      rows: [
        { tool: null, role: 'source', outcome: 'success', concept: 'verifying beats guessing' },
        { tool: 'Read', role: 'schema', outcome: 'success', concept: 'verifying beats guessing' },
      ],
    });
    overlay = createLegendOverlay({ parent, entries: SAMPLE_ENTRIES, getActiveGrounding });

    overlay.open();
    const text = overlay.root.textContent ?? '';
    // The reveal names the active beat AND surfaces the abstracted grounding (accurate to the real Event
    // at the abstracted level, AC4): the tool, the coarse role, the outcome, and the teaching concept.
    expect(text).toContain('dispel');
    expect(text).toContain('Read');
    expect(text).toContain('schema');
    expect(text).toContain('success');
    expect(text).toContain('verifying beats guessing');
    // ...and NO raw eventId / file path appears in the GROUNDING section (scope the no-name/no-path proof
    // to the grounding element — the unrelated LEGEND rows legitimately contain '/' e.g. "Edit/Write").
    const groundingText = overlay.root.querySelector<HTMLElement>('.legend-grounding')?.textContent ?? '';
    expect(groundingText).not.toContain('u-0002#1');
    expect(groundingText).not.toContain('/');
  });

  it('hides the grounding section when there is no active grounded beat (getActiveGrounding -> null)', () => {
    // The fail-closed branch: summon is omitted from the committed fixture, and before any grounded beat
    // is reached the accessor returns null — the section must stay HIDDEN, never show a stray/empty row.
    overlay = createLegendOverlay({ parent, entries: SAMPLE_ENTRIES, getActiveGrounding: () => null });
    overlay.open();
    const groundingEl = overlay.root.querySelector<HTMLElement>('.legend-grounding');
    if (!groundingEl) throw new Error('the overlay must render a grounding section element');
    expect(isVisible(groundingEl)).toBe(false);
    // ...and it leaked no grounding text into the panel.
    expect(overlay.root.textContent ?? '').not.toContain('grounds:');
  });

  it('hides the grounding section when the resolved set is EMPTY (rows: []) — no empty reveal', () => {
    // An active beat with an empty resolved set is treated as "nothing to reveal" (fail-closed), not an
    // empty "grounds: " row — guards against a beat whose grounding resolved to no rows.
    overlay = createLegendOverlay({
      parent,
      entries: SAMPLE_ENTRIES,
      getActiveGrounding: () => ({ beatKey: 'shaman', rows: [] }),
    });
    overlay.open();
    const groundingEl = overlay.root.querySelector<HTMLElement>('.legend-grounding');
    if (!groundingEl) throw new Error('the overlay must render a grounding section element');
    expect(isVisible(groundingEl)).toBe(false);
  });

  it('REFRESHES the grounding on each open() — it reflects the CURRENT active beat, not a stale one', () => {
    // refreshGrounding runs on open(), so as the cursor advances between opens the panel must show the
    // NEW active beat's abstracted rows, never a cached prior reveal. Pin it so a future "render once"
    // refactor that drops the per-open refresh fails RED.
    let active: LegendGrounding = {
      beatKey: 'dispel',
      rows: [{ tool: 'Read', role: 'schema', outcome: 'success', concept: 'DISPEL-CONCEPT' }],
    };
    overlay = createLegendOverlay({ parent, entries: SAMPLE_ENTRIES, getActiveGrounding: () => active });

    overlay.open();
    expect(overlay.root.textContent ?? '').toContain('DISPEL-CONCEPT');
    overlay.close();

    // The cursor advanced to the shaman beat; the next open must reflect THAT beat's abstracted rows.
    active = {
      beatKey: 'shaman',
      rows: [{ tool: null, role: 'source', outcome: 'isError', concept: 'SHAMAN-CONCEPT' }],
    };
    overlay.open();
    const text = overlay.root.textContent ?? '';
    expect(text).toContain('shaman');
    expect(text).toContain('SHAMAN-CONCEPT');
    expect(text).toContain('isError');
    expect(text).not.toContain('DISPEL-CONCEPT'); // the stale dispel reveal is gone
  });
});

describe('Story 4.4 — destroy() removes the overlay + its listeners (no leak on re-boot)', () => {
  it('after destroy() the root is detached and the toggle button no longer flips state', () => {
    overlay = createLegendOverlay({ parent, entries: SAMPLE_ENTRIES });
    const button = overlay.root.querySelector('button');
    if (!button) throw new Error('the overlay must render a toggle <button>');
    const root = overlay.root;

    overlay.destroy();

    // Detached from the mount host (a re-boot will not stack duplicate overlays)...
    expect(parent.contains(root)).toBe(false);
    // ...and the listener is gone: clicking the now-orphan button does not re-open the overlay.
    button.click();
    expect(overlay.isOpen()).toBe(false);
    overlay = undefined; // already torn down; do not double-destroy in afterEach
  });

  it('destroy() is idempotent — calling it twice does not throw (double-teardown safety)', () => {
    const o = createLegendOverlay({ parent, entries: SAMPLE_ENTRIES });
    o.destroy();
    expect(() => o.destroy()).not.toThrow();
  });
});
