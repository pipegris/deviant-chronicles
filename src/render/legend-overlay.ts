// legend-overlay — the THIN HTML DOM overlay for the ON-DEMAND Legend / transparency portal (FR-11,
// UJ-2): a viewer-opened panel mapping fantasy<->real, the DISPLAY surface for the portal content
// selected in portal/portal.ts. It imports NO phaser (the controls.ts posture): renderer-agnostic,
// accessible, fully jsdom-testable WITHOUT booting Phaser, so R5 is satisfied with nothing to confine.
//
// THE NON-INTERRUPTION MECHANISM (story Dev Notes #5, the load-bearing decision): open/close mutates
// ONLY this overlay's OWN visibility (its `open` flag + the panel's `hidden` attribute). It dispatches
// NO PlaybackAction, NEVER pauses/seeks/restarts, NEVER sets cinematicActive, NEVER touches the
// reducer/cursor/BattleState. The portal is a pure-read render/UI concern layered over the live arena;
// the boot's status-gated rAF loop keeps ticking unchanged while it is open. It reads only the content
// it is HANDED (the entries + an optional grounding section) and pushes NOTHING upstream (R5/AC1
// one-way). The arena-boot non-interruption gate (arena-boot-legend.test.ts) pins this by construction.

// LegendEntry — the flat, display-ready fantasy<->real row the boot feeds in (the SAME shape
// portal.getLegendEntries() returns: beats first, then actions). Declared structurally here so the
// overlay stays renderer-agnostic and decoupled from the (separately gated) portal content module — it
// renders exactly the rows it is handed. [story Task 3]
export type LegendEntry = {
  kind: 'beat' | 'action';
  key: string;
  fantasy: string;
  real: string;
};

// One abstracted grounding row the overlay renders for the active beat (Story 5.5 / AC4): tool + coarse
// role + per-event outcome + the teaching concept. Declared structurally here (decoupled from the
// separately-gated portal AbstractedGrounding) so the overlay stays renderer-agnostic and renders exactly
// the rows it is handed. NO file/symbol name can appear (the projection has none — structurally).
export type LegendGroundingRow = {
  tool: string | null;
  role: string;
  outcome: string;
  concept: string;
};

// A resolved active-beat grounding to show in the optional "active beat -> abstracted grounding" section:
// the beat plus the ABSTRACTED rows it dramatizes (resolved by portal.resolveAbstractedGrounding upstream;
// the overlay only DISPLAYS them — it never resolves itself, keeping it pure-display + phaser-free). Story
// 5.5 (AC4) replaces the prior bare-eventId list with the abstracted rows (tool/role/outcome/concept) — no
// raw eventId is the VISIBLE grounding text now (the AC asks for the abstracted grounding). [Dev Notes §6]
export type LegendGrounding = {
  beatKey: string;
  rows: readonly LegendGroundingRow[];
};

export type LegendOverlayOptions = {
  parent: HTMLElement;
  entries: readonly LegendEntry[];
  // Optional read-only accessor for the active-beat grounding, called on each open() so the panel shows
  // the CURRENT active beat's real event(s). A closure over the boot's read-only `view` + current beat;
  // returns null when there is no active grounded beat (e.g. summon, omitted from the committed fixture).
  // Pure-read: the overlay calls it but pushes nothing back. [story Task 3, Task 4]
  getActiveGrounding?: () => LegendGrounding | null;
};

export type LegendOverlay = {
  root: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  destroy(): void;
};

export function createLegendOverlay(opts: LegendOverlayOptions): LegendOverlay {
  const { parent, entries, getActiveGrounding } = opts;

  const root = document.createElement('div');
  root.className = 'legend-overlay';

  // All listeners are bound to one AbortController.signal so destroy() removes them ALL at once
  // (abort()), not merely detach the DOM — a retained button reference must stop toggling after
  // teardown, so a re-boot leaks no live listeners (the controls.ts AbortController precedent).
  const ac = new AbortController();
  const { signal } = ac;

  // The toggle BUTTON — the always-visible production affordance (UJ-2's "open the Legend"). The panel
  // (the content container) is distinct from it and starts HIDDEN (on-demand, not always-on).
  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'legend-toggle';
  toggleButton.textContent = 'Legend';

  const panel = document.createElement('div');
  panel.className = 'legend-panel';
  panel.hidden = true;

  // The fantasy<->real rows — rendered ONCE from the handed entries (renderer-agnostic content feed; the
  // overlay does not hardcode the rows). Each row shows both sides so the coverage is visible at the DOM
  // level (the gate's coverage half). Layout/legibility are operator-verified, so the markup is minimal.
  const rowsContainer = document.createElement('div');
  rowsContainer.className = 'legend-rows';
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = `legend-row legend-row-${entry.kind}`;

    const fantasy = document.createElement('span');
    fantasy.className = 'legend-fantasy';
    fantasy.textContent = entry.fantasy;

    const real = document.createElement('span');
    real.className = 'legend-real';
    real.textContent = entry.real;

    row.append(fantasy, real);
    rowsContainer.appendChild(row);
  }

  // The optional "active beat -> real event(s)" grounding section (AC2's reveal, fantasy -> real). Its
  // text is refreshed on each open() from getActiveGrounding(); empty/hidden when there is no active
  // grounded beat. The overlay only DISPLAYS what resolveGrounding produced upstream.
  const grounding = document.createElement('div');
  grounding.className = 'legend-grounding';
  grounding.hidden = true;

  function refreshGrounding(): void {
    const active = getActiveGrounding?.() ?? null;
    if (active && active.rows.length > 0) {
      // Render each abstracted row as a human-readable "tool + role + outcome — concept" line. NO raw
      // eventId / file / symbol name is shown (the AC4 requirement; the rows structurally carry none).
      const lines = active.rows.map((r) => {
        const tool = r.tool ?? '(no tool)';
        return `${tool} · ${r.role} · ${r.outcome} — ${r.concept}`;
      });
      grounding.textContent = `Active beat "${active.beatKey}" grounds: ${lines.join(' | ')}`;
      grounding.hidden = false;
    } else {
      grounding.textContent = '';
      grounding.hidden = true;
    }
  }

  panel.append(rowsContainer, grounding);
  root.append(toggleButton, panel);
  parent.appendChild(root);

  let open = false;

  function applyVisibility(): void {
    panel.hidden = !open;
  }

  function openOverlay(): void {
    open = true;
    refreshGrounding(); // reflect the CURRENT active beat's real event(s) at open time (pure read)
    applyVisibility();
  }

  function closeOverlay(): void {
    open = false;
    applyVisibility();
  }

  function toggleOverlay(): void {
    if (open) closeOverlay();
    else openOverlay();
  }

  toggleButton.addEventListener('click', () => toggleOverlay(), { signal });

  function isOpen(): boolean {
    return open;
  }

  function destroy(): void {
    ac.abort(); // remove all listeners…
    root.remove(); // …and detach the DOM. Idempotent: abort()/remove() on an already-torn-down node are no-ops.
  }

  return { root, open: openOverlay, close: closeOverlay, toggle: toggleOverlay, isOpen, destroy };
}
