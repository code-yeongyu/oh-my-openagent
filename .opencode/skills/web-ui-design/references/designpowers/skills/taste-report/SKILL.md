---
name: taste-report
description: Use when the user wants to see how they design — "what's my taste", "show me my taste report", "how do I decide", "what are my patterns", or periodically as the personal profile matures. Generates a longitudinal, reflective report from the PERSONAL taste profile (design-memory) — recurring moves, tells, evolution, blind spots — that helps a designer understand their own instincts. Personal layer only: it never reports client-specific signals from any project's DESIGN.md
---

# Taste Report

A taste report turns the personal taste profile from a lookup table into a mirror. `design-memory` accumulates a designer's portable instincts over many projects; this skill reads that accumulation and reflects it back as something the designer can actually learn from — *how you decide, what you reach for, what you reject, and how that's changed.* It's the moment the system stops just remembering your taste and starts helping you see it.

## Scope: Personal Layer Only

This report describes the **portable** taste in `~/.designpowers/taste-profile.md` — the instincts that travel with the designer regardless of client. It **must not** include client- or project-specific signals (the contents of any project's `DESIGN.md`). A client's required teal accent is that client's taste, not the designer's. If the personal profile is clean (it should be — `design-memory`'s Promotion Gate keeps client specifics out), this is automatic. If you notice client-bound entries that leaked into the personal profile, flag them as contamination rather than reporting them as the designer's taste.

## When to Use

- The user asks: "what's my taste?", "how do I design?", "show me my patterns", "what do I always do?"
- Periodically, as the profile matures — offer it after a project's retrospective once the profile has **3+ projects** of history (below that, there isn't enough signal; say so).
- When a designer wants to articulate their own style — for a portfolio, a team, a client pitch.

## What the Report Contains

Read `~/.designpowers/taste-profile.md` and the project history, then synthesise — don't just reformat the tables. Look for the patterns *across* entries that the designer might not see themselves.

```markdown
# How You Design — Taste Report
_Generated [date] · based on [N] projects · [X] strong opinions, [Y] soft patterns_

## In one line
[The single sharpest characterisation of their taste. e.g. "You're a restraint-first
designer who earns every accent and trusts whitespace to do the work."]

## How you decide
[3-5 observations about their decision-making, each with evidence from the profile.
Not what they like — HOW they choose. e.g.:
- "You subtract before you add — your overrides almost always remove an element
   rather than restyle it (4 of 5 recorded overrides)."
- "You decide colour last. Type and spacing are settled before accent appears."]

## What you reach for
[Recurring moves — the defaults they return to across projects. The strong opinions
and confirmed soft patterns, framed as instincts not rules.]

## What you reject
[The anti-patterns, synthesised into a point of view. e.g. "You reject anything that
performs friendliness — confetti, mascots, exclamation marks, skeleton 'delight'."]

## How your taste is evolving
[Movement over time from the project history. What's hardened from soft to strong,
what you've changed your mind about, what's newly appearing. e.g. "Your tolerance
for density has risen — early projects favoured sparse layouts, recent ones trust
the user with more on screen."]

## Possible blind spots
[Gentle, honest. Tendencies that could become ruts, or places the profile is thin.
e.g. "Every project leans editorial-serif for personality — worth testing whether
that's taste or habit." Frame as questions, not judgements.]

## Where the signal is thin
[What the profile doesn't yet know — areas with little evidence, so the designer
knows what's well-established vs. a guess. Honesty about confidence.]
```

## How to Write It Well

1. **Synthesise, don't transcribe.** The value is in patterns *across* entries — "you always subtract," "you decide colour last" — not in re-listing the table rows. If you're just reformatting the profile, you haven't done the work.
2. **Every claim cites evidence.** Tie each observation to specific projects, overrides, or repeated decisions in the profile. No evidence, no claim — this is `design-memory`, and the same "evidence over claims" rule applies.
3. **Describe decision-making, not just preference.** "Prefers muted palettes" is a lookup. "Decides colour last, after structure is settled" is insight. Reach for the second.
4. **Be honest about confidence and thinness.** Distinguish strong, well-evidenced patterns from thin ones. Don't manufacture a richer picture than the data supports.
5. **Blind spots are a gift, not a verdict.** Surface ruts and gaps gently, as questions. The goal is self-awareness, never a grade.
6. **Stay in the personal layer.** If a "preference" is really one client's brand requirement, it does not belong here.

## Integration

- **Reads from:** `~/.designpowers/taste-profile.md` and its project history (via `design-memory`)
- **Never reads:** any project's `DESIGN.md` as personal taste (that's client taste — see `design-md`)
- **Offered after:** `design-retrospective`, once the profile has enough history
- **Pairs with:** `design-memory` (the store), `design-taste` (per-project calibration)
- **Produces:** a report for the user — not a profile edit. It reflects; it does not rewrite the profile.
