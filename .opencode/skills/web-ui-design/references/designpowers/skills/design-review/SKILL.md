---
name: design-review
description: Use when the user wants to evaluate something that ALREADY EXISTS rather than build something new — "review this", "audit this screen", "what's wrong with this page", "is this accessible?", or when they share a screenshot, URL, or existing code/markup. Runs the existing reviewers (design-critic, accessibility-reviewer, heuristic-evaluator) in parallel against the artefact and reconciles their findings into one prioritised report — WITHOUT running discovery, strategy, or the full build pipeline
---

# Design Review (the review lane)

Most design work is improving something that already exists, not starting from a blank page. This is the **review-only lane**: it takes an existing artefact — a screenshot, a live URL, a prototype, or existing code/markup — and runs it through the same reviewers and reconciliation the full pipeline uses, but **without** discovery, strategy, design, or build.

It's the counterpart to the build lane. The build lane asks "what are we designing?" and creates. The review lane asks "what are we evaluating?" and critiques.

## When to Use

Route here, instead of the build pipeline, when the user already has something:

- "Review / audit / critique this [screen / page / app / flow / component]"
- "What's wrong with this?" / "How can I improve this?" / "Is this accessible?"
- They share a **screenshot**, a **URL**, or point at **existing code/markup**
- They want a usability, accessibility, or craft assessment of work that already exists

If the user wants to *build* something new, use the normal pipeline (`design-discovery` → …). If it's genuinely unclear which they want, ask one question: "Do you want me to review something you already have, or design something new?"

## What this lane skips and why

It deliberately skips discovery, research, strategy, inspiration, planning, and build — there is nothing to build. It does **not** skip accessibility, usability, or craft evaluation. The point is a rigorous, reconciled critique, fast, then a decision about what to fix.

## Process

### Step 1: Get the artefact

Establish what you're reviewing and take it in directly — always evaluate the **actual artefact**, never a description of it:

| Artefact | How to take it in |
|----------|-------------------|
| **Screenshot / image** | Read the image directly |
| **Live URL** | Load and screenshot it (browser tooling); note interactive states |
| **Existing code / markup** | Read the relevant files; if it runs, screenshot the running build |
| **A `DESIGN.md` + a build** | Read the spec via `design-md`, then review the build against it |

If you can only get a static image, say so — keyboard, focus, and screen-reader findings will be **inferred, not verified**. Be explicit about that coverage limit.

### Step 2: Capture a lightweight inferred brief

The reviewers normally evaluate against a brief, personas, and principles. In review mode those don't exist yet, so build a **minimal inferred brief** — a few quick questions, not a discovery session:

1. **What is this, and what's the main thing a person is trying to do here?** (the key task)
2. **Who is it for?** (audience and ability spectrum — if unknown, assume the full spectrum: permanent, temporary, situational)
3. **What's the quality bar, and what prompted the review?** (shipping prototype vs. flagship; "it feels off" vs. "failed an audit" vs. "low conversion")

Record this in `design-state.md`, clearly marked as **inferred** (reconstructed for review, not authored up front).

### Step 3: Run the three reviewers in parallel

Dispatch the existing reviewer agents **simultaneously** against the artefact and the inferred brief — this is the Reconciliation Protocol's parallel-review step (see `using-designpowers`):

```
        artefact + inferred brief
   ┌────────────┼────────────┐
   v            v            v
design-critic  accessibility-  heuristic-evaluator
               reviewer
   └────────────┼────────────┘
                v
          reconciliation
```

- **accessibility-reviewer** — WCAG/COGA evaluation. On a static image, flags what it can verify vs. only infer.
- **design-critic** — craft and intent against the inferred brief.
- **heuristic-evaluator** — Nielsen's 10 + a cognitive walkthrough of the key task from Step 2.

### Step 4: Reconcile

Apply the **Reconciliation Protocol** from `using-designpowers`: classify findings (Aligned / Complementary / Conflicting) and resolve conflicts by its priority rules (accessibility over aesthetics, usability over style, brief over opinion, personas break ties, escalate to the user if unresolvable).

### Step 5: Present one consolidated report

Deliver a single prioritised report — not three separate ones:

```markdown
# Design Review: [what was reviewed]

**Reviewed:** [artefact + how it was accessed]
**Inferred brief:** [key task · audience · quality bar]
**Coverage:** [what was verified vs. inferred — e.g. "static screenshot: visual + content verified; interaction/keyboard inferred"]

## Summary
[2-3 sentences: overall assessment]

## Findings (prioritised, reconciled)
### Critical — blocks access or breaks the key task
- [source(s)] [finding] → [fix] · affects [persona(s)]
### Major — significantly degrades the experience
- ...
### Minor — improvement opportunities
- ...

## What works well
- [genuine strengths — review is not only problems]

## Recommendation
[Ship as-is / fix criticals first / rethink — and the single most important next move]
```

For each Critical and Major finding, name who it affects and why it matters — not just what's wrong.

### Step 6: Offer next steps (the user decides)

End by handing the decision to the user. Offer the routes that fit the artefact:

- **Fix it** — if it's code you can edit, dispatch `design-builder` with the prioritised fix list.
- **Track it** — send deferred Minor findings to `design-debt-tracker` so they aren't silently dropped (accessibility debt needs explicit user acknowledgement to accept).
- **Go deeper** — if the review reveals the problem is *strategic* (the flow itself is wrong, not the execution), recommend dropping into the full pipeline at `design-strategy` or `design-discovery`.
- **Validate with people** — if findings are contested, suggest `synthetic-user-testing` (persona walkthroughs) or `usability-testing` (real participants).

The review proposes; it does not auto-fix without direction.

## Integration

- **Entry point:** the Build-or-Review fork in `using-designpowers`
- **Dispatches (in parallel):** `accessibility-reviewer`, `design-critic` (via `designpowers-critique`), `heuristic-evaluator`
- **Reconciles via:** the Reconciliation Protocol in `using-designpowers`
- **Hands off to:** `design-builder` (fixes), `design-debt-tracker` (deferred), `design-strategy`/`design-discovery` (if strategic), `synthetic-user-testing`/`usability-testing` (validation)
- **Records to:** `design-state.md` (inferred brief, findings, reconciliation decisions)
