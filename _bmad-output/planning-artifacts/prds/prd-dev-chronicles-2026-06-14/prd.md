---
title: "Dev Chronicles MVP — The Forge & The Shaman"
status: final
created: 2026-06-14
updated: 2026-06-14
---

# PRD: Dev Chronicles MVP — The Forge & The Shaman
*Working title — confirm.*

## 0. Document Purpose

This PRD is for the builder (Archfelipe) and any collaborators or future contributors who pick up the Dev Chronicles project. It defines the **v0.1 MVP** — a single, polished, replay-driven showcase that renders one real agentic coding session as a Final Fantasy-style turn-based battle. It is scoped for a **portfolio / showcase** bar: a shareable browser demo that is both spectacular and genuinely *explanatory* of what an agentic dev session does.

It builds directly on the brainstorming session at `_bmad-output/brainstorming/brainstorming-session-2026-06-14-023651.md` (50 ideas across 4 techniques), which remains the canonical idea inventory and the seed for the Translation Engine ruleset. This PRD captures *capabilities*; technical mechanism and rejected alternatives live in `addendum.md`. Vocabulary is Glossary-anchored; features are grouped with FRs nested; inferred decisions are tagged `[ASSUMPTION]` inline and indexed in §9.

## 1. Vision

Agentic development is invisible. A coding agent reads files, edits code, runs tests, spawns sub-agents, hits errors, recovers, and ships a feature — but to anyone watching, it's a wall of scrolling JSON and terminal text. The drama, the strategy, and the *learning* are buried. **Dev Chronicles** transmutes that hidden process into a legible, thrilling spectacle.

The MVP takes **one real, completed coding story** from the Vibranto/kebox project and replays it as a turn-based RPG battle: the agent becomes a hero who strikes with edits, casts test-suite spells, takes counter-hits from failing tests, and overcomes the encounter to ship the feature. A passive **Scribe** narrates the whole thing in Tolkien-flavored prose, turning a commit log into a saga. Three signature beats anchor the demo — a cinematic **Eidolon summon** at the breakthrough, the **Fallen Shaman** (a root-cause bug whose symptom-imps keep reviving until the source falls), and the **Dispel** (the agent acts on an assumption, reads the code, and reality shatters the illusion).

It matters because it does three things at once: it **shows** (a beautiful, shareable demo), it **delights** (a real game-feel experience), and — most distinctively — it **teaches** (every fantasy beat is a faithful mapping of a real agentic-dev concept, so a newcomer comes away actually understanding what just happened). The MVP exists to prove that single thesis end-to-end with the smallest possible build.

## 2. Target User

### 2.1 Jobs To Be Done

- **As the builder/presenter**, I want to show — at a glance, on a shared link — that agentic development is legible, sophisticated, and exciting, so my portfolio piece lands emotionally and intellectually.
- **As a curious technical viewer** (recruiter, peer dev, conference attendee), I want to *watch* an agent solve a real problem and come away understanding what it actually did — without reading a single log line.
- **As a learner new to agentic dev**, I want the abstract concepts (tool calls, test failures, root-cause vs. symptom, acting on unverified assumptions) made concrete and memorable through metaphor.

### 2.2 Non-Users (v1)

- Developers wanting a real-time debugging/observability dashboard for live agent runs (that's the deferred real-time mode).
- Teams wanting to replay *their own arbitrary* sessions (v0.1 is one curated story, not a drop-in tool).
- Players expecting interactive gameplay — this is a replay/cinematic, not a game you control.

### 2.3 Key User Journeys

- **UJ-1. Archfelipe shares the demo as a portfolio piece.**
  - **Persona + context:** Archfelipe, the builder, drops the link into a portfolio page / social post / chat with a peer.
  - **Entry state:** Recipient clicks a public URL on desktop; no install, no login.
  - **Path:** The Arena loads → a title card names the quest ("The Saving of the Magic-Link Gate") → playback begins → the hero trades blows with the boss, the three signature beats fire → a closing saga scrolls.
  - **Climax:** The boss falls with the THUNDORR summon; the viewer audibly reacts ("whoa").
  - **Resolution:** A victory card + the option to replay or scrub. Viewer leaves impressed *and* understanding what an agentic session is.

- **UJ-2. A curious viewer learns what the agent actually did.**
  - **Persona + context:** Dana, a backend dev skeptical of "AI coding," watches because it looks fun.
  - **Entry state:** Mid-replay, Dana doesn't know the fantasy↔real mapping yet.
  - **Path:** Dana toggles the **Codex/Legend** overlay → sees that "the hammer strike = a code edit," "the reviving imps = recurring test failures from one root cause" → watches the Fallen Shaman fall and the whole imp-swarm die at once.
  - **Climax:** The "fix the root cause, not the symptom" lesson lands as a *felt* moment, not a lecture.
  - **Resolution:** Dana can articulate what root-cause debugging means and that the agent did it.

## 3. Glossary

*Downstream work and readers use these terms exactly; no synonyms elsewhere in the PRD.*

- **Session** — One completed agentic coding run for a single story, captured as logs. The MVP replays exactly one curated Session.
- **Event** — One atomic record in the Session log (a tool call, a result, an agent lifecycle transition). The fundamental unit translated into gameplay.
- **Tool Call** — An Event representing an agent action: `Read`, `Edit`, `Write`, `Bash` (test/build), `Task` (sub-agent spawn), etc.
- **Annotation Sidecar** — A hand-authored file accompanying the curated Session that tags the special narrative beats (which Events constitute the Fallen Shaman, the Dispel, the breakthrough) that cannot be reliably auto-detected in v0.1.
- **Translation Engine** — The declarative rules layer that maps each Event (plus Annotation Sidecar tags) to a Battle Action. Seeded from the brainstorm mapping table.
- **Battle Action** — A game-side effect emitted by the Translation Engine (e.g., melee strike, spell cast, enemy counter-attack, summon, dispel).
- **Arena** — The on-screen battle scene where the Replay is rendered.
- **Hero** — The on-screen avatar of the agent. The MVP features one Hero, the **Forgemaiden** (the Executor class).
- **Enemy** — An on-screen foe representing a problem. Includes **Minions** (trivial fixes), the **Boss** (the story's feature/bug), and the **Fallen Shaman**.
- **Boss** — The primary Enemy representing the story's central feature/bug; defeated when the story's work completes (tests pass).
- **Fallen Shaman** — A special Enemy representing a root-cause bug. It resurrects its symptom-imps until the Shaman itself is defeated, at which point all its imps die at once.
- **Mirage** — An Enemy (or terrain) rendered with a "shimmer of falseness" because the Hero is acting on an unverified assumption rather than verified code.
- **Dispel** — The beat where the Hero reads ground-truth code and a Mirage shatters, revealing the real situation; the Scribe visibly corrects its narration.
- **Aether Storm** — The rendering of an *environmental* hazard (rate limit, backoff, network wait) — a storm that pauses channeling — as distinct from a Hero failure or an Enemy attack. Keeps narration honest (protects SM-C1).
- **Eidolon Summon** — A cinematic special move triggered at a breakthrough; a patron titan (the Forgemaiden's is **THUNDORR**) descends, delivers a colossal blow, and departs.
- **Insight Gauge** — The Hero meter that charges from struggle (failed attempts, retries, long thinking) and discharges on a breakthrough to enable an Eidolon Summon.
- **Problem Integrity** — The Boss/Enemy health bar; drained by progress (passing tests, completed work).
- **Resolve** — The Hero health bar; drained by failures, errors, and wasted effort (e.g., a Dispel stagger).
- **Scribe** — The narration system. Emits **Captions** (fast, per-Event) and a **Saga** (a lush milestone narration), both in Tolkien register.
- **Caption** — A short, instant, templated narration line tied to a Battle Action.
- **Saga** — A longer, LLM-authored narrative passage emitted at a milestone (e.g., the closing victory); pre-generated and stored for deterministic Replay.
- **Codex / Legend** — An optional overlay that explains the fantasy↔real mapping for the beats currently on screen (the teaching layer).
- **Replay** — The deterministic playback of the curated Session as a Battle, with playback controls.

## 4. Features

### 4.1 Session Ingestion & Curated Replay Timeline

**Description:** The system ingests one hand-picked, completed kebox Session and produces a normalized, ordered timeline of Events ready for translation. Because v0.1 is a **curated demo** (not auto-detection), ingestion pairs the raw Session log with an **Annotation Sidecar** that marks the special beats. The result is a single, deterministic timeline that drives the entire Replay. Realizes UJ-1.

**Reality check on the Annotation Sidecar:** authoring the sidecar is not trivial data-entry — it is the **editorial/screenwriting heart of v0.1.** It requires reading the real Session event-by-event and exercising judgment about which Events constitute the dramatic beats, where the "fight" rises and falls, and what to collapse. Treat it as a creative authoring task with a real time cost, not a config chore. It is also the lever that keeps the Replay legible (see FR-12). `[NOTE FOR PM] The sidecar is where the demo is won or lost; budget real authoring time and expect iteration against the rendered Replay.]`

**Functional Requirements:**

#### FR-1: Parse a curated Session into a normalized Event timeline

The system can read a chosen kebox Session (Claude Code transcript JSONL plus `.omc/state/*.jsonl`) and produce an ordered list of normalized Events. Realizes UJ-1.

**Consequences (testable):**
- Given the curated Session files, the system emits a deterministic ordered Event list (same input → identical output).
- Each Event carries at minimum: timestamp/order, type (tool call / result / agent lifecycle), tool name where applicable, and outcome (success/failure) where applicable.
- Events irrelevant to the Battle (e.g., internal bookkeeping) are filtered out per a documented allowlist.

**Data sources (confirmed on disk):**
- **Claude Code transcript** at `~/.claude/projects/-home-archfelipe-dev-kebox/*.jsonl` — the granular tool-call stream. Per-record shape: `message.content[]` with `{type: "tool_use", name, input}` for actions; paired `{type: "tool_result", toolUseResult.success, content}` for outcomes; plus `uuid`, `parentUuid`, `timestamp`, `sessionId`. Sub-agent spawns appear as `Task` tool_use records.
- **`.omc/state/agent-replay-*.jsonl`** — agent lifecycle stream: `{t, agent, agent_type, event: agent_start|agent_stop, success, duration_ms, parent_mode}`.

**Out of Scope:**
- Auto-detecting root-cause vs. symptom or assumption-vs-read from raw logs (see §6.2; handled via Annotation Sidecar in v0.1).

#### FR-2: Apply the Annotation Sidecar to tag special beats

An author can supply an Annotation Sidecar that tags which Events constitute the Fallen Shaman encounter, the Dispel beat, and the breakthrough (Eidolon Summon trigger). Realizes UJ-2.

**Consequences (testable):**
- The Replay reflects every tagged beat at the correct point in the timeline.
- Annotation is data, not code: editing the sidecar changes the Replay without code changes.
- If a referenced Event ID is missing/invalid, ingestion fails loudly with a clear message rather than rendering a broken Replay.

**Notes:** The curated Session is **Story 10.1** (session identity persistence / magic-link recovery, completed 2026-06-11). Confirmed to contain real instances of all three signature beats: a root-cause atomicity fix that resolved a cascade (Fallen Shaman), multiple assumption-then-correction moments — the double-`Set-Cookie` blind spot and the cross-site `user_id` invariant backfill (Dispel), and review findings F1/F2 + a hidden second phase. The corresponding transcript exists on disk, so the Replay uses **real events**, not a reconstruction.

### 4.2 Translation Engine (Event → Battle Action)

**Description:** A declarative rules layer maps each Event (and any Annotation Sidecar tag) to one or more Battle Actions. This is the heart of the system and is **data-driven**: the rules are authored as config seeded directly from the brainstorm mapping table, so the metaphor can be tuned without touching engine code. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-3: Map Events to Battle Actions via declarative rules

The system can translate each Event into Battle Action(s) using an ordered, declarative ruleset.

**Consequences (testable):**
- `Edit`/`Write` → Hero melee strike on the Boss; `Read`/`Grep`/`Glob` → scouting/reveal action; `Bash` test/build → a channeled spell that resolves on the Event's outcome; `Task` (sub-agent) → an ally/summon entrance.
- A failing test/result Event → an Enemy counter-attack that drains Resolve (the true-duel model).
- A passing test / completed-work Event → damage to Problem Integrity.
- **Scout-before-strike loop:** when the Hero acts (Edit/Write) on code that was *not* preceded by a relevant `Read`/scout Event, the target renders as a **Mirage** (shimmer of falseness); when scouted first, the target renders solid/true. This makes "read before you write" a visible cause-and-effect.
- **Environmental vs. self-inflicted failures (Aether Storm):** Events representing environmental hazards (rate limits, backoff/retries, network waits) translate to an **Aether Storm** (an environmental effect that pauses channeling), *not* to a Hero failure or an Enemy counter-attack. This keeps narration honest and protects SM-C1.
- Rules live in a config file; adding/editing a rule requires no engine-code change.
- An Event with no matching rule produces a defined default (e.g., a neutral "idle/thinking" beat), never a crash.

#### FR-4: Translate the three signature beats

The system can render the three tagged signature beats as their specified Battle Actions.

**Consequences (testable):**
- **Fallen Shaman:** while the tagged Shaman lives, defeated symptom-imps visibly resurrect; when the Shaman is defeated, all its imps die in one wave.
- **Dispel:** when a tagged assumption Event is followed by its tagged ground-truth `Read`, the on-screen Mirage shatters (glass-break + a **record-scratch** beat), the Hero takes a self-inflicted Resolve stagger (wasted effort), and the real situation is revealed beneath. The Scribe visibly **crosses out and rewrites** its prior line (see FR-9).
- **Eidolon Summon:** when the tagged breakthrough fires and the Insight Gauge is charged, the THUNDORR summon cinematic plays and deals a decisive blow.

### 4.3 Battle Model & Playback

**Description:** A turn-based battle state machine consumes Battle Actions and maintains the Arena's logical state — whose turn it is, the two health bars (Problem Integrity, Resolve), the Insight Gauge, and live Enemy instances. It exposes deterministic playback so the Replay can be paused, scrubbed, and re-watched. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-5: Maintain turn-based battle state from the Battle Action stream

The system can advance a single-Arena, turn-based battle state as Battle Actions are consumed in timeline order.

**Consequences (testable):**
- Problem Integrity and Resolve bars update consistently with the Actions applied; values are reproducible for a given timeline position.
- The Insight Gauge charges on struggle Events (failed attempts/retries) and discharges on the breakthrough.
- The Boss is defeated exactly when the story's completion Event is reached; the Battle then enters a victory state.

#### FR-6: Provide deterministic playback controls

A viewer can control Replay playback. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Play, pause, and restart are available and behave predictably.
- The viewer can scrub to any point and the Arena renders the correct state for that position.
- At least one speed control (e.g., normal / fast) is available. `[ASSUMPTION: scrub + play/pause/restart + a fast-forward toggle is the full control set for v0.1.]`
- Replaying the same Session yields an identical experience (deterministic; no randomness that changes outcomes).

#### FR-12: Aggregate and pace Events so the Battle reads as drama, not noise

The system can collapse and pace Events so the Replay has rhythm and legibility — a real Session has hundreds of granular tool calls, and a literal 1:1 render would be unwatchable noise that defeats the teaching goal. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Trivial/repetitive Event bursts (e.g., a run of small reads) are aggregated into a single readable Battle Action or a brief montage, per declarative pacing rules — not rendered one-tap-per-Event.
- The Replay has an "active-time" rhythm: significant beats (a strike that lands a feature, a counter-hit, a signature beat) are given visual weight and dwell time; filler is compressed.
- Pacing is data-driven (config), not hardcoded, so the demo's rhythm can be tuned without engine changes.
- The total Replay runs to a watchable length for a showcase. `[ASSUMPTION: target a ~2–4 minute Replay for the curated Session; tune via pacing rules + the Annotation Sidecar.]`

**Notes:** This FR and the Annotation Sidecar (FR-2) are the two levers that turn a raw log into a *legible* story. The "is the 10.1 tool-call density replay-worthy?" check (Open Q2) feeds directly into the pacing rules here.

### 4.4 Battle Renderer (Phaser Arena)

**Description:** The Phaser 3 browser front-end renders the battle state as a fluid, FF-style pixel scene: the Forgemaiden, the Boss, Minions/imps, the Fallen Shaman, and the THUNDORR summon, with animations for each Battle Action. This is where "fluid animations + bitmap sprites" lives, and where the three hero moments must visually land. Realizes UJ-1.

**Functional Requirements:**

#### FR-7: Render the Arena and core combat animations

The system can render the single Arena with the Hero and Enemies and animate the core Battle Actions.

**Consequences (testable):**
- The Forgemaiden has at least: idle, forge-strike (melee), cast (spell), stagger (took damage), and **rise/recover** (the defiant "get back up" beat after a knockdown) animations.
- A burst of consecutive edits across files renders as a **Hammer Flurry** (a visibly faster multi-strike), distinct from a single forge-strike.
- After a failure/stagger, the Hero's **rise** visibly coincides with the Insight Gauge charging further (struggle → power; see FR-5), so retries read as building toward triumph, not as defeat.
- Enemy types render distinctly (Boss vs. Minion/imp vs. Fallen Shaman) and have hit/death animations.
- Health bars and the Insight Gauge are visible and animate with state changes; the Aether Storm has a distinct environmental visual.
- Frame pacing stays smooth on a modern laptop browser (see NFRs).

#### FR-8: Render the three signature cinematics

The system can render the THUNDORR summon, the Fallen Shaman swarm-clear, and the Dispel shatter as polished, readable set-pieces.

**Consequences (testable):**
- The THUNDORR summon is a distinct full-scene cinematic (time-freeze cutaway, colossal blow, departure).
- The Shaman's death visibly triggers the simultaneous death of all its imps in one wave.
- The Dispel renders a glass-shatter + a visible Scribe correction.
- All three beats are legible to a first-time viewer without prior explanation (validated informally; see SMs).

**Feature-specific NFRs:**
- Art is AI-generated pixel art, curated for cross-asset visual consistency (single coherent palette/scale).

### 4.5 The Scribe (Narration)

**Description:** The Scribe turns Events into Tolkien-flavored narration in two registers: instant templated **Captions** for the rapid-fire beats, and a lush LLM-authored **Saga** at the milestone (the victory). For deterministic, free Replay, the Saga is **pre-generated once and stored** with the curated Session. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-9: Emit live Captions per Battle Action

The system can display a short, in-register Caption synchronized to each significant Battle Action.

**Consequences (testable):**
- Captions are drawn from a templated table keyed by Battle Action type (no network call at Replay time).
- Caption variants rotate so repeated actions don't read identically every time.
- The Dispel Caption visibly *corrects* a prior Caption (the honesty beat).

#### FR-10: Display a pre-generated closing Saga

The system can display a lush, LLM-authored Saga at the victory milestone, pre-generated and stored for deterministic playback.

**Consequences (testable):**
- The Saga is authored once via Claude (Tolkien-register system prompt) over the relevant Event window and stored alongside the curated Session.
- Replay displays the stored Saga with no runtime LLM call.
- `[ASSUMPTION: a single closing Saga is sufficient for v0.1; per-chapter/mid-battle Sagas are deferred.]`

### 4.6 Codex / Legend (Teaching Overlay)

**Description:** The teaching layer that distinguishes Dev Chronicles from pure spectacle. A key risk surfaced in review: if teaching is purely an opt-in overlay, viewers won't toggle it and the comprehension goal (SM-1) fails while the wow goal (SM-2) passes. So teaching is **partly always-on**: at each of the three signature beats, a concise plain-dev caption auto-surfaces (non-dismissible, brief), and a fuller Legend is available on demand for viewers who want more. Realizes UJ-2.

**Functional Requirements:**

#### FR-11: Always-on signature-beat teaching + on-demand Legend

The system auto-surfaces a brief plain-dev explanation at each signature beat, and a viewer can additionally open a fuller fantasy↔real Legend on demand. Realizes UJ-2.

**Consequences (testable):**
- At each of the three signature beats, a concise, plain-dev one-liner auto-appears without any viewer action (e.g., on the Fallen Shaman's death: "The whole bug class died at once — that's fixing the *root cause*, not the symptoms.").
- The auto-surfaced teaching is brief enough not to bury the spectacle (counterbalanced by SM-C2) and disappears on its own.
- A fuller Legend overlay can be opened/closed on demand without interrupting playback, covering the three beats and the core actions (strike/edit, spell/test, scout/read, Aether Storm/rate-limit).
- Every explanation is accurate to the real Event it represents.

**Notes:** `[NOTE FOR PM] A full unlock-by-encounter collectible Codex (brainstorm #41) is deferred; v0.1 ships always-on beat teaching + an on-demand Legend only.`

## 5. Non-Goals (Explicit)

- **Not a real-time observability tool.** v0.1 replays a finished Session only; it does not hook a live agent run.
- **Not a general drop-in replayer.** v0.1 renders one curated Session, not arbitrary user logs.
- **Not an interactive game.** No player control over the battle outcome; viewers control playback only.
- **Not a full game engine of mechanics.** No meta-game/leveling, no Kingdom, no multiplayer/crowd, no full bestiary or all-hero roster — these are additive content for later (brainstorm Themes B, C, E, F).
- **Not becoming a BMAD/Claude Code plugin** in v0.1 — it's a standalone browser artifact.

## 6. MVP Scope

### 6.1 In Scope

- Ingestion of **one curated kebox Session** + an Annotation Sidecar (FR-1, FR-2).
- A **declarative Translation Engine** covering core actions + the three signature beats (FR-3, FR-4).
- A **turn-based battle model** with two health bars + Insight Gauge and **deterministic playback controls** (FR-5, FR-6).
- **Event aggregation + active-time pacing** so the Replay reads as drama, not noise (FR-12).
- A **Phaser browser Arena** rendering the Forgemaiden, Boss, Minions/imps, Fallen Shaman, and core + cinematic animations (FR-7, FR-8).
- The **Scribe**: templated Captions + one pre-generated closing Saga (FR-9, FR-10).
- **Always-on signature-beat teaching** + an on-demand Legend (FR-11).
- All three signature beats — **THUNDORR summon, Fallen Shaman clear, the Dispel** — polished to "must land" quality.
- A **shareable public URL** for the static browser demo.

`[NOTE FOR PM] This is a deliberately ambitious v0.1 (engine + data pipeline + AI-art production in one). The builder chose to hold all three signature beats rather than phase to one. The biggest schedule risks are AI-art consistency (see Risk) and Annotation Sidecar authoring effort (FR-2); manage those as the critical path.]`

### 6.2 Out of Scope for MVP

- **Real-time / live-hook mode** — deferred; v0.1 is replay-first. Becomes a later data-source swap.
- **Automatic detection** of root-cause-vs-symptom and assumption-vs-read from raw logs — deferred; handled via Annotation Sidecar. `[NOTE FOR PM] This is the load-bearing deferral — automation is the long-term product, but curation is what makes the showcase reliable.`
- **Drop-in arbitrary sessions** — deferred to a generalization phase.
- **Additional heroes, full bestiary, summons beyond THUNDORR** — additive content.
- **Parallel-agent split-screen Arena** (brainstorm #23) — deferred; v0.1 is single-Arena sequential.
- **Meta-game** (Kingdom, Renown, New Game+, achievements) and **social/crowd layer** — deferred.
- **Full collectible Codex** — only the contextual Legend ships in v0.1.

## 7. Success Metrics

*Showcase-stakes: a small mix of qualitative and lightweight quantitative targets.*

**Primary**
- **SM-1 (Comprehension):** A first-time technical viewer who watches the full Replay **with no overlay toggled** (relying only on the always-on signature-beat teaching) can, unprompted, correctly explain what "the Fallen Shaman dying clears all the imps" means in real dev terms (root cause vs. symptom). Target: ≥ 4 of 5 informal test viewers. The "no overlay toggled" condition is deliberate — it tests that comprehension survives without opt-in (the review risk behind FR-11). Validates FR-4, FR-8, FR-11.
- **SM-2 (Wow):** Viewers react positively to the three signature beats (verbal "whoa" / replays the beat / shares the link). Target: majority of informal viewers react to at least one beat. Validates FR-8, FR-10.
- **SM-3 (It runs the real thing):** The demo renders a genuinely real kebox Session (not a fabricated script) end-to-end without manual intervention during playback. Target: binary — yes. Validates FR-1, FR-3, FR-5.

**Secondary**
- **SM-4 (Shareability):** The demo loads from a public URL on a modern desktop browser with no install/login, in under ~5 seconds to first frame. Validates FR-6, FR-7.

**Counter-metrics (do not optimize)**
- **SM-C1 (Don't fabricate for spectacle):** The fraction of on-screen beats that correspond to a real Event must stay at 100% — counterbalances SM-2. We do not invent dramatic beats that didn't happen; the Annotation Sidecar *tags* real Events, it does not *manufacture* them.
- **SM-C2 (Don't over-narrate):** Caption density should not bury the action — counterbalances the temptation to make the Scribe talk constantly. If viewers report the text is exhausting, that's a regression.

## 8. Open Questions

1. ~~Which Session is the curated showcase?~~ **RESOLVED:** Story 10.1, transcript confirmed on disk with all three signature beats present as real events.
2. ~~Exact JSONL schema/fields~~ **RESOLVED:** schema captured (see FR-1 Data sources). Remaining sub-task: correlate the specific 10.1 session file(s) among the 36 transcripts (by date 2026-06-11 / commit `0b7cb64`) and confirm tool-call density is replay-worthy.
3. **AI art toolchain** — which generator + sprite/animation workflow yields consistent pixel art at the needed animation fidelity (idle/strike/cast/stagger + cinematics)?
4. **Hosting** for the public URL (static host: GitHub Pages / Netlify / Vercel / Coolify static). `[ASSUMPTION: a static host is sufficient since Replay is fully client-side after the Saga is pre-generated.]`
5. **Annotation authoring ergonomics** — given the sidecar is an editorial task (FR-2), is hand-editing acceptable, or is a tiny annotation helper UI / preview-loop worth building first to make iteration against the rendered Replay fast? (Likely hand-edit for v0.1, but the iteration loop matters.)
6. **Pacing tuning** — what aggregation thresholds and dwell times yield a watchable ~2–4 min Replay for Story 10.1 without dropping a signature beat? (Resolved empirically against the real event density; feeds FR-12.)

## 9. Assumptions Index

*Every `[ASSUMPTION]` surfaced for confirmation:*

- **§4.3 / FR-6** — The v0.1 playback control set is play/pause/restart + scrub + a fast-forward toggle.
- **§4.3 / FR-12** — Target Replay length is ~2–4 minutes for the curated Session, tuned via pacing rules + the Annotation Sidecar.
- **§4.5 / FR-10** — A single closing Saga is sufficient for v0.1; mid-battle/per-chapter Sagas are deferred.
- **§8 / Q4** — A static host is sufficient because Replay is fully client-side once the Saga is pre-generated.

---

## Cross-Cutting NFRs

- **Performance:** The Arena targets smooth animation (≈60 fps; no perceptible jank during cinematics) on a current mid-range laptop browser. First frame within ~5s of page load on a typical broadband connection.
- **Determinism:** A given curated Session + Annotation Sidecar always produces an identical Replay — no runtime randomness that alters outcomes, no runtime LLM calls. Essential for a reliable, re-runnable showcase.
- **Portability / shareability:** Runs in current Chrome/Firefox/Safari/Edge desktop browsers from a static URL, no install, no login.
- **Maintainability:** Translation rules and Captions are data (config), editable without engine-code changes; the brainstorm mapping table is the source-of-truth seed.
- **Offline-at-Replay:** No external service is required during playback (the Saga is pre-generated and stored).

## Aesthetic and Tone

- **Visual reference:** Classic 16-bit Final Fantasy battle screens (sprite-based heroes/enemies, side-on Arena, ATB-style action, summon cinematics). Bitmap/pixel art, fluid tweened animation.
- **Anti-references:** Generic flat/corporate "infographic" dashboards; cluttered HUDs; modern 3D. Avoid the look of a profiler or a log viewer.
- **Narrative voice (the Scribe):** High-fantasy / Tolkien register — measured, mythic, a little wry. Captions are terse and punchy; the Saga is lush and elegiac/triumphant. The voice must stay faithful to the real Event (no invented stakes). **Worked exemplar** (the target voice quality): a real commit *"fix(music): bound MusicBrainz/iTunes search fetches with a timeout"* becomes *"the minstrels of MusicBrainz answered slow, and the kingdom held its breath... the Forgemaiden bound a sand-glass to the spell, and the Hanging Curse of the Endless Wait was lifted."* The Scribe also has a signature move, **"Embellish"** (elevating a mundane event to legend), and the Forgemaiden has a battle cry — *"By hammer and hash, it is done!"*
- **Emotional truths to preserve (not just mechanics):**
  - **Struggle, not success, charges the Insight Gauge** — a hard-won fix after several failures earns the most cinematic summon; an easy win earns none. The feeling to evoke: *thrashing is charging up.*
  - **Retries read as defiance, not defeat** — the "Rise Again" beat should feel like a shounen comeback, building toward the eventual kill.
  - **Honesty is cool** — the Dispel / the agent being wrong is staged as a dramatic, even admirable beat (the Scribe owning a correction), never as something hidden or shameful.
- **Tone of the teaching:** Earnest and a little playful; the plain-dev one-liners (FR-11) are confident and clear, never condescending.

## Constraints and Guardrails

- **Privacy / data exposure:** The curated Session is real project data and may contain code snippets, file paths, or other detail. Before publishing the public demo, the ingested Session must be reviewed and scrubbed of secrets/credentials and anything not intended for public view. `[NOTE FOR PM] Add a pre-publish review checklist; the fantasy layer obscures but does not guarantee redaction.`
- **Cost:** The only LLM cost is one-time Saga pre-generation per curated Session — negligible. No per-view cost.
- **Attribution:** If AI-generated art or asset packs are used, retain license/attribution records.

### Risk — AI-generated art is the primary cost & quality risk

Producing **visually consistent** AI pixel art across ~7 entities (Forgemaiden, Boss, Minion/imp, Fallen Shaman) plus multi-frame animations (idle/forge-strike/cast/stagger/rise) and the THUNDORR cinematic is, by the adversarial review's judgment, the single largest effort and the most likely place for the timeline to slip or for the demo to look incoherent. **Mitigation (load-bearing): build placeholder-first.** The engine, Translation Engine, Battle Model, Scribe, and pacing must be provable with crude placeholder sprites, so art production is *parallel and swappable* and never blocks the thesis. Lock a single palette/scale/style guide before generating final assets. `[NOTE FOR PM] Treat final art as its own workstream with its own owner and schedule; do not let it gate engine/translation progress.]`

## Platform

- **v0.1:** Web, desktop browser, static deployment. Single shareable URL.
- **Later:** Same renderer fed by a live socket for real-time mode; potential mobile/responsive pass (out of scope now).
