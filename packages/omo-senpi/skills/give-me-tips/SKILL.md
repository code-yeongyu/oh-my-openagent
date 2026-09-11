---
name: give-me-tips
description: "Explains any senpi tip in depth, including Tip: lines in the TUI. Use when the user asks about a tip, what a tipped feature does, or which tips they can see."
metadata:
  short-description: Deep, verified, brag-worthy explanations of any senpi tip
---

# give-me-tips - explain any senpi tip, in depth

## Purpose

Senpi shows the user tips: startup tips, working tips, and `Tip:` lines injected by omo
components. When the user asks about any of them - "what was that Tip: line", "what does this tip
mean", "how does that feature work" - this skill produces a DEEP explanation of that exact tip, in
the USER'S language (match the language they asked in, always).

Specific over generic, every time. "It retries on failure" is a failure of this skill. "It detects
the refusal from the stopDetails on the assistant message_end event, gates on the architect
category in your .omo/omo.json, and only then injects the directive" is the bar. The user asked
because the tip made them curious; reward that curiosity with the real mechanism, not a summary of
the tip text they already read.

## Query the live tip list FIRST

Never explain from memory. Get the ground truth of what tips exist:

1. Run `senpi --list-tips`. It prints JSON: `[{id, text, requiresCommand?}]`. Match the user's tip
   against this list by id or by text fragment.
2. If the flag is unavailable on this senpi version, fall back to reading the catalog sources
   directly at `packages/coding-agent/src/modes/interactive/tips/catalog/` inside the installed
   `@code-yeongyu/senpi` package (find it via the senpi install path or node_modules) or in a
   local clone of code-yeongyu/senpi.

Then - and this is the part most explanations get wrong - **available tips DIFFER per user**. The
catalog is the superset; what THIS user can actually see is gated by:

- the `tips` toggle in the senpi agent dir `settings.json` (tips can be off entirely),
- `tipsHistory` in that same settings/state, which drives cooldown rotation so a tip the user saw
  recently will not reappear for a while,
- `requiresCommand` gating: a tip tied to a command only shows when that command is available,
- keybinding availability: some tips reference bindings the user's setup may not have.

Read the senpi agent dir `settings.json` (and its tips history state) BEFORE explaining, and tell
the user which tips they personally can encounter and why - not the full catalog as if everyone
sees everything.

## Verify before explaining

Never invent behavior. A tip is a one-line promise; the truth lives in code. Before writing the
explanation, read the actual feature implementation:

- senpi itself: `code-yeongyu/senpi`, under `packages/coding-agent/` (the tips catalog lives at
  `packages/coding-agent/src/modes/interactive/tips/catalog/`; the features the tips point at live
  in the surrounding packages),
- omo components: `code-yeongyu/oh-my-openagent`, under `packages/omo-senpi/`.

Cite the concrete file paths you read in your explanation. If the code and the tip text disagree,
the code wins - say so and show what it actually does.

## Tone: BRAG

These tips exist because someone engineered something genuinely impressive, and a flat doc summary
betrays that. Lead with the most impressive engineering behind the tip - the clever detection, the
race that had to be closed, the state machine hiding under one sentence - and showcase it. The user
should finish the explanation feeling like they got a tour of the engine room, not a sticker
reading. Concrete mechanics over adjectives: name the events, the gates, the file paths, the exact
order of operations.

## The Fable-5-refusal tip specifically

When the user asks about the tip that appears after a Fable 5 refusal ("Fable 5 refused, but its
refusals should not wear you down..."), explain the full fallback-architect pipeline, citing
`packages/omo-senpi/src/components/fallback-architect/`:

1. **Refusal detection** (`detection.ts`): the component watches `message_end` events and applies
   the same refusal semantics senpi's own retry classifier uses - stopReason checked FIRST (so an
   abort or normal stop carrying stale stopDetails can never masquerade as a refusal), then
   stopDetails of type refusal/sensitive, plus the Anthropic usage-policy errorMessage pattern for
   provider-side blocks that carry no stopDetails at all.
2. **Architect category gate** (`architect-gate.ts`): on a `model_select` with source "fallback"
   moving AWAY from claude-fable-5 with a refusal pending, the component checks the user's own omo
   config for an active architect category. No architect category, no nudge - the feature never
   pretends depth is reachable when it is not.
3. **Hidden directive** (`directive.ts`, customType `omo-fallback-architect:directive`,
   display:false): the fallback model gets a hidden 5-step playbook - decompose the problem,
   consult `task(category: "architect")` with one self-contained query per part (the architect
   consultant IS Fable 5, reached through a lane its refusal cannot block), run independent
   consultations in parallel, and split refused queries into smaller benign sub-questions instead
   of resending. The directive also tells the model the user was shown the visible tip, so the
   two never contradict each other.
4. **Visible tip** (`tip-message.ts`, customType `omo-fallback-architect:tip`, display:true):
   rendered as a dim `Tip:` block via a registered message renderer. It names the ACTUAL fallback
   model the session landed on, reassures the user that the refused question is still being
   reasoned through in essence, and notes Fable-5-grade depth stays reachable through the
   architect category.

The engineering worth bragging about: the refusal never deletes the user's question. Detection
arms on the exact assistant message that preceded the switch (a later successful answer disarms
it), reminders ride inside queued prompts instead of burning extra assistant turns, and the whole
nudge self-cancels the moment Fable 5 becomes the active model again or senpi reverts the
fallback. One refusal triggers a coordinated downgrade in visibility with zero downgrade in
reachable reasoning depth.

## The Kibitzer recollection notice specifically

When the user asks about the `✦ Kibitzer` line that shows up mid-session
("recalled memory: ..."), or about the memory tip that promises stored memory can resurface on its own, explain the
whole kibitzer recall gate, citing `packages/omo-senpi/src/components/memory/` and
`packages/memory-core/src/recall/`. This is NOT the periodic save reminder: `memory.nudge` in
`nudge-wiring.ts` asks the agent to WRITE memory every N user turns, while kibitzer only READS
memory and hands one hint back. Keep the two apart in the explanation.

1. **Candidate collection** (`recall-wiring.ts`, `recall-session-read.ts`,
   `recall-query-planner-tools.ts`): on every `tool_call` and on settle the component snapshots the
   live session synchronously (the host disposes the ctx once the handler returns), runs a lexical
   planner over the user-only text window plus the last 8 tool-argument payloads, and scores memory
   files against it. Memory-owned hidden channels are excluded from the window, so a previous hint
   can never seed the next query.
2. **Delta gate and launch** (`kibitzer-trigger.ts`, `kibitzer-concurrency.ts`): the judge only
   launches when the sorted candidate-path fingerprint differs from the session's last launch. A
   launch that lands while a judge is already running is parked as the single trailing request. Per
   session the count stops at 200, `tool_call` launches carry a 90 s deadline, and at most 2 judges
   run process-wide; a capped launch is skipped, never queued.
3. **The judge** (`kibitzer-runner.ts`, `kibitzer-judge-spec.ts`, persona at
   `packages/memory-core/src/recall/assets/kibitzer-persona.md`): a quick-category in-process child
   with exactly ONE tool, `nudge(path, hint)`, and no file access. Its instruction is that silence is
   the default: it nudges only when a stored memory would change the agent's next action (it
   contradicts the current approach, records a past failure of it, answers a question the agent is
   about to re-derive, or names a constraint being ignored). Topical similarity alone is rejected.
4. **Hint contract** (`kibitzer-nudge-tool.ts`, `packages/memory-core/src/recall/gate.ts`): the
   path must be copied from the offered candidates, must not already be surfaced this session, and
   must not be a `system/` path; the hint is one factual present-tense sentence, at most 200
   characters (`NUDGE_HINT_MAX_CHARS`), single line, and secret-like text is rejected. The parent
   re-validates every accepted nudge against the same rules plus `memory.recall.max_items`
   (default 2, range 1 to 5) before anything is persisted.
5. **Delivery** (`kibitzer-delivery.ts`, `recall-drain.ts`): accepted nudges are marked surfaced in
   the session ledger at ACCEPT time, so a parallel judge can't repeat them. The model-facing half
   is a hidden `omo-kibitzer:recall` message (`display: false`) carrying a `<recalled-memory
   source="[[path]]">` block that says the memory is a hint, not current state, and must be
   verified. It is steered in at the next `tool_result` when nothing else is pending, ridden in on
   another source's idle flush, or drained into the next prompt; the pending file is stamped with
   the compaction epoch and a compaction drops everything held.
6. **The visible half** (`kibitzer-notice.ts`): because senpi draws nothing for the hidden message,
   the component appends an `omo-kibitzer:nudged` entry and renders it as Kibitzer advice:
   a single fixed `Kibitzer` title (`✦ Kibitzer`, accent tone; opener-era records carry a retired
   `opener` field that is ignored) over `recalled memory: <hint>`,
   `recalled memory: ...` for a second nudge, and the source paths in dim text. Expanding the entry reveals the caveat that it's a hint, not current
   state. The record keeps `via` (`steer`, `wake`, or `prompt`) for forensics, but no provenance is
   ever drawn. It's a transcript entry, not a toast: nothing pops over the input, and the renderer
   is fail-closed, so a malformed record draws nothing rather than a half-formed notice.

What's worth bragging about: the user sees one calm line, and behind it a read-only judge with a
single tool, a fingerprint-gated launch, a hard deadline, a 200-character hint budget, a ledger
that guarantees a memory surfaces at most once per session, and a compaction-epoch check that
refuses a verdict about a transcript that no longer exists. A judge that finds nothing says nothing,
and that silence is the designed outcome, not a failure. Gate skips and failures render separately
as `Kibitzer gate skipped` / `Kibitzer gate failed`; a deadline drop renders no notice at all and
only leaves an `outcome.json` behind. Turn the whole thing off with `memory.recall.enabled: false`.
