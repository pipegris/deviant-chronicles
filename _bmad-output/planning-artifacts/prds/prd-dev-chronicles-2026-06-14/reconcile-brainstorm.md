# Input Reconciliation — Brainstorm vs. PRD

**Source input:** `brainstorming-session-2026-06-14-023651.md` (50 ideas, 4 techniques)
**PRD:** `prd.md` (MVP "The Forge & The Shaman")
**Addendum:** `addendum.md`

This pass flags ONLY MVP-relevant ideas/nuances or qualitative "feel" that the brainstorm captured and the PRD dropped or weakened. Deferred-and-acknowledged content (per addendum + PRD §6.2) is intentionally excluded.

---

## Gaps

### HIGH severity

- **G1 — "Struggle charges the gauge" is mechanically present but its emotional truth is lost.**
  - *What's missing:* The brainstorm's most-cited creative breakthrough (#15, #30, Session Summary "a-ha born from struggle") is that the Insight Gauge fills from **failure, retries, thrashing** — and the explicit teaching/emotional payload: *"thrashing is charging-up, not failure"* and the retry-as-"Rise Again" shounen-climax catharsis (#30: "three knockdowns then comeback"). The PRD Glossary and FR-4/FR-5 reduce this to a dry mechanic ("charges from struggle... discharges on a breakthrough") and drop the emotional register entirely — the whole point that *hard-won fixes earn the most cinematic summon while easy wins earn none*.
  - *Where it should go:* §11 "Aesthetic and Tone" (add an emotional-intent line), and a Consequence under FR-5/FR-4 making the gauge proportionality explicit (more struggle → bigger summon). Also worth a line in §1 Vision.
  - *Severity:* HIGH — this is the brainstorm's signature emotional thesis and is currently invisible in the PRD's framing.

- **G2 — Retry / "Rise Again" beat (#30) is absent from the MVP feature set despite being present in the chosen Session.**
  - *What's missing:* The brainstorm makes retries-after-failure a visible, charged beat (hero staggers back up with defiant glow). Story 10.1 is explicitly chosen for "failed tests then a fix." Yet the PRD only renders failing tests as an "Enemy counter-attack that drains Resolve" (FR-3) — the Hero's *defiant rise* (the inverse, the resilience beat that feeds G1) is never specified as an animation or Battle Action. FR-7 lists idle/forge-strike/cast/stagger but no "rise/recover."
  - *Where it should go:* FR-3 (add a rule: retry-after-failure → Hero "rise again" action), FR-7 Consequences (add a recover/rise animation), and tie to the Insight Gauge charge in FR-5.
  - *Severity:* HIGH — it is a named MVP-relevant beat that directly produces the emotional arc the demo is selling, and the source data supports it.

- **G3 — "Honesty as cool" is stated once but the Dispel's full honesty mechanics are thinned out.**
  - *What's missing:* The brainstorm frames the Dispel (#36) and the broader "Honesty Layer" (Theme D, a top-4 breakthrough) richly: the **record-scratch**, the hero taking **self-inflicted damage from wasted effort**, the Scribe **crossing out a line and rewriting it on screen**, and the pedagogical line *"it verified and was wrong; that's why we read first."* The PRD keeps "glass-shatter + Scribe correction + Resolve stagger" (FR-4, FR-8, FR-9) but drops: the record-scratch sensory beat, the explicit framing that the stagger is *self-inflicted from wasted effort* (not enemy damage), and the "Scouting prevents mirages" risk/reward loop (#37) — even though Story 10.1 contains real assumption-then-correction moments (FR-2 Notes: double-Set-Cookie, user_id backfill). The single tone line in §11 ("treated as cool, not as failures to hide") is good but unsupported by the FRs.
  - *Where it should go:* FR-4 (clarify Dispel stagger is self-inflicted, distinct from enemy counter-attacks), FR-8 (add the record-scratch as part of the shatter set-piece), FR-9 (the Caption correction is the on-screen "crossing out" — make that visual intent explicit), Codex/Legend FR-11 (the "that's why we read first" lesson). Reinforce §11 tone line with a Vision mention.
  - *Severity:* HIGH — the honesty layer is a stated top differentiator; the PRD's FRs under-specify the very beats that carry it.

### MEDIUM severity

- **G4 — The Scribe's specific voice quality and the worked narration example are lost.**
  - *What's missing:* The brainstorm gives the Scribe a concrete, evaluable voice via a real worked example (#18): commit "fix(music): bound MusicBrainz/iTunes fetches with a timeout" → *"the minstrels of MusicBrainz answered slow... the Forgemaiden bound a sand-glass to the spell... the Hanging Curse of the Endless Wait was lifted."* It also names the Scribe ("Eldric the Chronicler") and the "Embellish" power that elevates a mundane event to legend. The PRD has a good tone line (§11: "measured, mythic, a little wry") but no exemplar, no name, and no "Embellish" notion — making the voice harder to author and verify against.
  - *Where it should go:* §11 "Narrative voice" (add the worked before→after example as the canonical voice target; optionally name Eldric), Glossary "Scribe" entry, and as a reference for the Saga in FR-10.
  - *Severity:* MEDIUM — tone is captured in spirit but the load-bearing concrete exemplar that makes it reproducible is gone.

- **G5 — Aether Storm / environmental hazard (#9) is MVP-relevant but only implicitly handled.**
  - *What's missing:* The brainstorm (#9) cleanly separates **your failures (enemy attacks)** from **environmental ones (rate-limits/API errors = Aether Storm, party waits out the storm)**. This is a teaching nuance directly relevant to any real agent transcript (Story 10.1 may well contain rate-limit/backoff or timeout waits). The PRD's Translation Engine treats failure Events uniformly as enemy counter-attacks (FR-3), with no concept of a non-attributable environmental pause. If the real log has waits/backoffs, they will be mis-narrated as the hero's failures — violating the "faithful mapping" thesis.
  - *Where it should go:* FR-3 Consequences (add an environmental-pause rule distinct from enemy-attack), or at minimum §8 Open Questions (does the curated Session contain environmental waits, and how are they rendered?).
  - *Severity:* MEDIUM — low build cost, real teaching value, and a correctness risk against the "100% real beats" counter-metric (SM-C1) if such Events exist and get mislabeled.

### LOW severity

- **G6 — Concrete real-data detail underused: the THUNDORR / Forgemaiden battle-cry and the F1/F2 "hidden second phase" review beat.**
  - *What's missing:* (a) The brainstorm gives the Forgemaiden a battle cry — *"By hammer and hash, it is done!"* (Hero #1) — a cheap, high-flavor asset for a Caption at the killing/forge-strike beat that the PRD omits. (b) The brainstorm's Code-Review-Finding-as-Hidden-Phase (#11) is grounded in the *exact* real findings of the chosen Session (Story 10.1 F1 "token NOT burned (single tx)", F2 "session-rotation bypass"), and the FR-2 Notes even acknowledge "review findings F1/F2 + a hidden second phase" exist in the data — yet no FR renders the boss's **surprise second phase / Critic NPC calls out the flank** beat. It's a real, dramatic, MVP-available beat left on the floor.
  - *Where it should go:* (a) §11 or FR-9 Captions (seed the battle cry). (b) FR-4 or FR-3 — consider a fourth tagged beat (review-finding → boss revives for a hidden phase), or explicitly note in §8 why it's excluded despite being in-data.
  - *Severity:* LOW — (a) is pure flavor; (b) is a genuine MVP-available beat but adding it expands scope, so flagging rather than mandating.

- **G7 — "Forging" identity of Edit/Write is flattened to generic "melee strike."**
  - *What's missing:* The brainstorm's Mapping #2 and Hero #1 frame Edit/Write not just as melee but as **forging** — "sword strike/hammer (main damage, *forging*)", "Forge Strike (Edit lands a feature)", "Hammer Flurry (multi-file edits)". The PRD keeps "forge-strike" as an animation name (FR-7) but the Translation Engine FR-3 describes it generically as "Hero melee strike," and the multi-file "Hammer Flurry" distinction (a readable signal that an edit touched many files) is dropped.
  - *Where it should go:* FR-3 Consequences (note multi-file Edit → flurry variant), FR-7 animation list.
  - *Severity:* LOW — animation naming preserves the spirit; the multi-file readability nuance is a minor enrichment.

---

## Summary judgment

The PRD is a faithful structural scoping of the MVP and correctly defers content. The losses are almost entirely **qualitative/emotional**, exactly as predicted: the "struggle charges the gauge" emotional truth (G1), the resilience/retry catharsis (G2), and the full honesty-layer texture (G3) are the brainstorm's stated breakthroughs and are the most weakened. G4 (Scribe voice exemplar) and G5 (environmental-vs-self failure) are reproducibility/correctness nuances worth restoring cheaply. G6–G7 are flavor.
