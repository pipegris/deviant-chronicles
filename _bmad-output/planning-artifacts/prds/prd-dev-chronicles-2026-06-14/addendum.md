# Addendum — Dev Chronicles MVP PRD

Technical-how, mechanism decisions, and rejected alternatives that belong downstream (architecture / solution design), not in the capability-focused PRD. Source: brainstorm `_bmad-output/brainstorming/brainstorming-session-2026-06-14-023651.md` (Phase 4) and PRD Discovery.

## Architecture mechanism — the 4 layers

```
[1] EVENT SOURCE  →  [2] TRANSLATOR  →  [3] GAME STATE  →  [4] RENDERER
   (curated logs +     (declarative      (turn-based       (Phaser sprites
    Annotation          rules engine)     battle model)     + animation)
    Sidecar)                                  ↕
   [Scribe sidecar: templated Captions + pre-generated Saga → feeds 3 & 4]
```

- **Layer 1 — Event Source:** Claude Code transcript JSONL + `.omc/state/*.jsonl`. Real sample observed in kebox: `{"agent":"aafc72b","agent_type":"Plan","event":"agent_stop","success":true,"duration_ms":386672}`. Normalize into an ordered Event list; pair with a hand-authored Annotation Sidecar tagging the Shaman / Dispel / breakthrough beats.
- **Layer 2 — Translator:** ordered declarative ruleset (YAML/JSON). Example rule shapes from the brainstorm:
  - `{tool: Edit} → {type: melee, anim: forge_strike, target: boss}`
  - `{tool: Bash, cmd: ~test} → {type: spell, resolve: on_exit_code}`
  - `{event: test_fail} → {type: enemy_attack, move: club_swing, dmg: hero}`
  - `{tool: Task, agent: Explore} → {type: summon_ally, lane: open}`
  - `{event: agent_stop, ok: true} → {type: tag_out}`
  - `{event: rate_limit | backoff | network_wait} → {type: aether_storm}` (environmental, NOT a hero failure — protects SM-C1)
  - `{tool: Edit, after: Read(same_target)} → solid enemy`; `{tool: Edit, no prior Read} → mirage` (scout-before-strike loop)
- **Pacing/aggregation (FR-12):** a separate declarative pass collapses trivial Event bursts and assigns dwell-time weights so the Replay has active-time rhythm (~2–4 min target). Tuned empirically against Story 10.1's real tool-call density (Open Q2/Q6). This pass + the Annotation Sidecar are the two legibility levers.
- **Layer 3 — Game State:** turn queue, Problem Integrity + Resolve bars, Insight Gauge, live Enemy instances (incl. Shaman-with-reviving-imps and Mirage shimmer state). Pure TypeScript, deterministic.
- **Layer 4 — Renderer:** Phaser 3 scenes/timelines/tweens/particles.
- **Scribe sidecar:** caption lane = templated lookup keyed by Battle Action (sync, offline). Saga lane = one-time Claude generation, stored with the Session for deterministic replay.

## Tech choices & rejected alternatives

- **Renderer = Phaser 3 (chosen).** Native 2D sprite engine; sprite sheets, tweens, particles, scene management — FF battle scenes are its habitat; browser target = shareable URL.
  - *Rejected — PixiJS:* lower-level renderer, more game logic to hand-build. More control, more work; not worth it for v0.1.
  - *Rejected — hand-rolled Canvas/CSS:* painful for "fluid animations."
  - *Rejected — Godot/Unity native:* overkill; kills the "share a URL" superpower.
- **Replay-first (chosen) over real-time.** Lower difficulty, deterministic, scrubbable/demoable. Real-time = later swap (same renderer fed by a live socket/hooks), not a rebuild.
- **Curated demo (chosen) over full auto-detection.** Reliably detecting root-cause-vs-symptom and assumption-vs-read from raw logs is unsolved for v0.1; the Annotation Sidecar tags real Events instead. Auto-detection is the long-term product direction.
- **Scribe models:** `claude-haiku-4-5` for cheap/fast caption-style generation if ever needed; `claude-opus-4-8` for the lush closing Saga. v0.1 only calls the LLM once (Saga pre-generation), so the cost is negligible and playback is offline.

## Brainstorm content deferred beyond MVP (future content/architecture)

- Full bestiary variety (#4–#9, #32, #34), all hero classes + Eidolon pantheon (#16), kaiju tier-escalation (#17).
- Orchestration-made-visible: adaptive split-screen Arena (#23), tag-team handoffs (#25–#27), human-as-God (#21), compaction memory-fade (#22).
- Meta-game: Codebase=Kingdom (#38), Renown/titles (#39), New Game+ (#40), collectible Codex (#41), achievements (#42).
- Social: contributors-as-crowd (#43), git-blame potions (#44), spectator/commentator mode (#45).
- Real-time mode (#46 swap) and drop-in arbitrary sessions.

## Brainstorm-as-spec

The v1 Translation Engine ruleset is seeded directly from the brainstorm mapping table (#1–#45). The brainstorm document is the source-of-truth for the metaphor; the rules config is its machine encoding. "Rule packs" (e.g., LOTR pack, kaiju pack) are a future extensibility direction.
