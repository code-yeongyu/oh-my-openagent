# Escalation Ladder: Adding a Final-Decision Tier Above Oracle

> **For users**: How to reserve your most expensive model for the one thing it's
> worth spending on — the final judgment — using `agent_definitions`, with **zero
> core changes**.

---

## The problem: Oracle is the wrong place to mount a scarce model

Oh My OpenAgent already has a cost hierarchy. Cheap utility agents
(Explore, Librarian) do grep and retrieval; Oracle handles debugging and
first-line architecture. For most stacks that's the right shape.

But Oracle is **heavily auto-invoked by the framework itself**:

- The `review-work` skill fans out **3 parallel Oracle instances**.
- `skeptical-reverify` can spin up to **6**.
- Prometheus planning uses Oracle as a **blocking gate**.

That's by design — Oracle earns its keep on routine review passes. But it also
means Oracle is the *last* agent you want pointed at a genuinely scarce,
top-of-stack model: every hook would burn that model on work a mid-tier model
handles fine.

There's no documented tier *above* Oracle — a model expensive enough that it
must **never** be auto-invoked, and is reached only by deliberate escalation.

## The pattern: a guarded final-decision agent

"Themis" is that tier. It is a read-only agent with four disciplines that keep
the expensive model cheap in aggregate:

| Discipline | What it means |
|---|---|
| **Never auto-invoked** | No skill, hook, or planning gate references it. It runs only when a human or orchestrator explicitly escalates. |
| **Brief-gated** | It accepts a prepared *Decision Brief* (question, options, constraints, pre-gathered evidence, prior attempts, stakes) — not a raw codebase. |
| **NEEDS_PREP bounce** | If the brief lacks load-bearing evidence, it returns a short list of what's missing and stops — pushing the gathering back down to cheap agents instead of doing it on the expensive model. |
| **Hard tool budget** | Read-only, ≤5 spot-verification reads per invocation. No exploration. |

Net effect: the expensive model spends tokens only on the judgment step that
cheaper agents can't do, and everything else stays on the existing tiers. It's a
**token-efficiency pattern**, not a capability claim.

## When to use it — and when not to

**Reach for Themis when:**

- A decision is a **one-way door** (hard/expensive to reverse) and survived
  Oracle-tier analysis without settling.
- Two solid options remain after cheap agents gathered all the evidence, and
  someone has to *commit*.
- The cost of the wrong call dwarfs the cost of one expensive invocation.

**Do NOT reach for Themis when:**

- You still need research or code search → that's Explore / Librarian.
- You need requirements clarified → that's Metis.
- You need a plan reviewed → that's Momus.
- You're debugging or want first-line architecture → that's Oracle.
- The pick is trivial or cheaply reversible → just decide.

If you invoke it without a prepared brief, a well-written Themis prompt will
simply bounce you with `NEEDS_PREP`. That bounce is the point: it's a ~100-token
reminder to do the cheap work first.

## Setup

`agent_definitions` loads external agent files (Markdown or JSON) as first-class
subagents — see the [Configuration Reference](../reference/configuration.md).
The example file lives at
[`docs/examples/agents/themis.md`](../examples/agents/themis.md).

1. Copy the example somewhere stable, e.g. `~/.config/opencode/agents/themis.md`.
2. Point its `model:` field at **your** most expensive/frontier model. The value
   in the example is illustrative — the pattern works with whatever sits at the
   top of your stack. See the
   [Agent-Model Matching Guide](./agent-model-matching.md) for the supported set.
3. Register the path in your config:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json",

  // Load Themis as a custom subagent. Never auto-invoked — reached only
  // when you (or an orchestrator) deliberately escalate a prepared brief.
  "agent_definitions": [
    "~/.config/opencode/agents/themis.md",
  ],
}
```

4. Restart OpenCode. Themis appears as a subagent you can escalate to
   explicitly.

## The Decision Brief

Themis is only as good as the brief it's handed. A valid brief has six parts:

- **QUESTION** — the decision as a single answerable question.
- **OPTIONS** — 2+ concrete candidates with honest pros/cons.
- **CONSTRAINTS** — hard, non-negotiable limits.
- **EVIDENCE** — pre-gathered facts: code excerpts with `file:line`, measured
  numbers, API shapes, failure logs. *Excerpts, not pointers.*
- **PRIOR ATTEMPTS** — what was already tried and why it didn't settle it.
- **STAKES** — what happens if the decision is wrong, and how reversible it is.

The gathering is deliberately front-loaded onto cheap agents. By the time Themis
is invoked, the expensive model does nothing but reason and rule.

## Why this is docs, not a built-in agent

This pattern is fully expressible with the **existing** `agent_definitions`
mechanism, so it ships as documentation rather than core code — nothing new to
maintain, and you can adapt the brief format and tool budget to your own stack.

If a first-class `themis` (a factory + `AgentPromptMetadata`, like `momus.ts`)
would be worth having in the box, that's a maintainer call — this guide is the
low-risk way to try the pattern first.

## See Also

- [Agent-Model Matching Guide](./agent-model-matching.md) — Which model belongs
  where, and the supported set.
- [Orchestration System Guide](./orchestration.md) — How agents dispatch work.
- [Configuration Reference](../reference/configuration.md) — Full config
  options, including `agent_definitions`.
- [`docs/examples/agents/themis.md`](../examples/agents/themis.md) — The
  ready-to-use agent definition.
