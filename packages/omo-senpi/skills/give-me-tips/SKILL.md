---
name: give-me-tips
description: "Explains any senpi tip in depth - startup tips, working tips, and any Tip: line shown in the TUI (including the Fable-5-refusal fallback tip). Use when the user asks about a Tip: line, says give-me-tips, asks what a tip means, how a tipped feature works, or which tips they can see. Queries the live tip list (senpi --list-tips) first, checks what THIS user can actually see, then verifies the real feature code before explaining."
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
