# What Is Oh My OpenAgent?

Oh My OpenAgent is a multi-model agent orchestration harness. This guide covers OmO Native (omo-senpi), the standalone `omo` command; the OpenCode and Codex editions ship separately. It turns a single AI agent into a coordinated development team that actually ships code.

Not locked to Claude. Not locked to OpenAI. Not locked to anyone.

Just better results, cheaper models, real orchestration.

---

## Quick Start

### Installation

Paste this into your LLM agent session:

```
Install and configure oh-my-openagent by following the instructions here:
https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/refs/heads/dev/docs/guide/installation.md
```

Or read the full [Installation Guide](./installation.md) for manual setup, provider authentication, and troubleshooting.

### Your First Task

Once installed, just type:

```
ultrawork
```

That's it. The agent figures everything out: explores your codebase, researches patterns, implements the feature, verifies with diagnostics. Keeps working until done.

Want more control? Run `/ulw-plan` for interview-based planning, then `/ulw-execute` so the main agent executes the approved work plan in the same session.

---

## Pick a profile

You don't have to know model names to get a good main agent. Pick a profile by intent and omo picks the model:

- **Capable**: the strongest generalist you have. Claude Fable 5.1, then Claude Opus 5, then Kimi K3, then GLM 5.3.
- **Simple work**: fast and cheap for small, well-specified edits. GPT-5.6 Luna Fast, then DeepSeek V4 Flash, then Claude Haiku 4.5.
- **Deep work**: maximum reasoning for hard problems. GPT-6 Astra, then GPT-5.6 Sol. Same chain the `deep` category runs.

Set one key in `omo.json`:

```jsonc
{ "model_profile": "capable" }
```

At session start omo walks the chain and applies the first model your connected providers serve, then prints a notice naming the pick and the rungs it skipped. The switch is session-scoped: nothing is written to `settings.json`. Mid-session failures follow Senpi's own retry chains, not the profile.

Want one exact model instead? Put it in the same key: `"model_profile": "anthropic/claude-opus-5"`. Anything with a `/` is a pin. The precedence is simple: a `--model` flag or scoped model wins, then a pinned model, then a profile, then Senpi's own default. Leave the key unset and omo doesn't touch the session model at all. Profiles pick the main session model only; categories and curated agents keep their own chains. Full detail in the [omo.json reference](../reference/omo-json.md#model-profiles-senpi-harness).

---

## The Philosophy: Breaking Free

We used to call this "Claude Code on steroids." That was wrong.

This isn't about making Claude Code better. It's about breaking free from the idea that one model, one provider, one way of working is enough. Anthropic wants you locked in. OpenAI wants you locked in. Everyone wants you locked in.

Oh My OpenAgent doesn't play that game. It orchestrates across models, picking the right brain for the right job. Your session model for orchestration. Visual work uses `claude-fable-5-1` max, then `claude-opus-5` max, then `kimi-k3` max. GPT-6 Astra for deep reasoning, with GPT-5.6 Sol behind it. Kimi high-speed for quick tasks. All working together, automatically.

---

## How It Works: Agent Orchestration

Instead of one agent doing everything, Oh My OpenAgent uses **one main agent that delegates** through the `task` tool, routed by task type.

**The Architecture:**

```
User Request
    |
[IntentGate]  injects mode prompts on ultrawork/ulw, team-mode, hyperplan keywords
    |
[Main agent]  runs on your session model; plans, delegates, verifies
    |
    +--> task(category: "...")        -> the category worker (fresh session, category's model + skills)
    +--> task(subagent_type: "explore")    -> fast codebase grep
    +--> task(subagent_type: "librarian")  -> documentation and OSS code search
    +--> task(category: "architect")       -> the architect consult lane (read-only design advice)
    +--> [Kibitzer]                        -> resident memory recall sidecar, read-only, nudges only

Planning path (same session, no agent switching):
/ulw-plan  ->  plan-consultant gap analysis  ->  plan-reviewer rounds  ->  /ulw-execute
```

When the main agent delegates, it doesn't pick a model name. Curated read-only agents (`explore`, `librarian`, `plan-consultant`, `plan-reviewer`) are invoked with `task(subagent_type: ...)`. Implementation work uses a **category**: `architect`, `visual-engineering`, `ultrabrain`, `deep`, `artistry`, `quick`, `unspecified-low`, `unspecified-high`, `writing`. The category maps to the right model automatically. You touch nothing.

For a deep dive into how the pieces collaborate, see the [Orchestration System Guide](./orchestration.md).

---

## How omo-senpi delegates

### The main agent

The main agent is your session. It runs on your session model (a profile, a pin, or whatever you picked with `/model`), plans the work, fans out delegation, and drives tasks to completion with aggressive parallel execution. It doesn't stop halfway. It doesn't get distracted. It finishes.

Recommended models, named plainly:

- **Claude Opus 5** (or Claude Fable 5). The reference configuration. The orchestration prompt was built against Claude's habit of following long, mechanics-driven instructions.
- **GPT 5.6 Sol**. The GPT-recommended configuration. It gets a model-aware GPT-native prompt built for autonomous, principle-driven work: give it a goal, not a recipe. Over-orchestration on small bounded tasks is a known risk.

Kimi K3 and GLM 5.2 / 5.3 have tuned prompt presets too, with lighter validation. Models below the recommended tier aren't supported as the main agent. The **Capable** profile walks the Claude-first slice of this list (Fable 5.1, Opus 5, Kimi K3, GLM 5.3), so it's the safe default when you'd rather not choose; pick **Deep work** for the GPT side. Details in the [Agent-Model Matching Guide](./agent-model-matching.md).

### The category worker

Every `task(category: ...)` call spawns the category worker: a fresh worker session configured by the category's model and skills. It gets one prompt, does the work, and reports back. Nothing else leaks in. That's what makes a `deep` call on GPT-6 Astra and a `quick` call on Kimi high-speed behave predictably side by side.

### Curated agents

Four read-only specialists ship with their own prompts, tool policies, and model chains:

- **`explore`**: fast codebase grep. Speed-focused models for pattern discovery.
- **`librarian`**: documentation and OSS code search. Stays current on library APIs and best practices.
- **`plan-consultant`**: gap analyzer. Catches hidden intentions, ambiguities, and AI failure points before a plan is finalized. Plan-gated: only spawnable during a `/ulw-plan` run.
- **`plan-reviewer`**: one-shot reviewer. Validates a work plan against clarity, verification, and context criteria. Plan-gated as well.

Architecture consultation isn't an agent. Run `task(category: "architect")`: the architect consult lane surveys the whole system, weighs trade-offs, and proposes designs without implementing them.

### Kibitzer

Kibitzer is the memory side: one resident, read-only sidecar per main agent session. It receives the session's prompts, tool calls and tool results as bounded, redacted events, wakes only when a stored memory it has not judged yet comes into play, can read the workspace, the parent transcript and memory to check itself, and hands back a recollection when one applies. It cannot write memory or files; its only act is a nudge.

---

## Working Modes

### Ultrawork Mode: For the Lazy

Type `ultrawork` or just `ulw`. That's it.

The agent figures everything out. Explores your codebase. Researches patterns. Implements the feature. Verifies with diagnostics. Keeps working until done.

This is the "just do it" mode. Full automatic. You don't have to think deep because the agent thinks deep for you.

### Plan first with /ulw-plan

Run `/ulw-plan`. The main agent becomes the Ultrawork Planner and interviews you like a real engineer. Asks clarifying questions. Identifies scope and ambiguities. Fans out research, brings in `plan-consultant` for gap analysis and `plan-reviewer` for high-accuracy review rounds, and writes a decision-complete work plan before a single line of code is touched.

Then run `/ulw-execute [plan-name] [--worktree <path>] [--make-pr] [--ship]`. The main agent loads the ulw-plan work plan, sets a Goal when the Goal tools are enabled, registers every plan task as todos, and executes in the same session. Tasks fan out to categories and curated agents. Each completion is verified independently. Learnings accumulate across tasks. Progress tracks across sessions.

Use `/ulw-plan` for multi-day projects, critical production changes, complex refactoring, or when you want a documented decision trail.

---

## Agent Model Matching

The main agent runs on your session model, chosen by a profile, a pin, or `/model` (see [Pick a profile](#pick-a-profile)). Everything it delegates resolves through a fallback chain: categories and curated agents each carry a provider priority chain, and the system tries rungs in order until it finds a model your connected providers can serve. Work continues even when your preferred provider is down.

### Custom Model Configuration

Override specific categories or curated agents in `omo.json`:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",

  "agents": {
    // Planning helpers: Claude for the gap analysis, GPT for the review
    "plan-consultant": { "model": "anthropic/claude-opus-5", "reasoning": "high" },
    "plan-reviewer": { "model": "openai/gpt-6-astra", "reasoning": "xhigh" },

    // Research agents: cheap and fast is the point
    "explore": { "model": "openai/gpt-5.6-luna-fast", "reasoning": "low" },
    "librarian": { "model": "openai/gpt-5.6-luna-fast", "reasoning": "low" }
  },

  "categories": {
    // Design consultation: Fable 5 max
    "architect": { "model": "anthropic/claude-fable-5-1", "reasoning": "max" },

    // Frontend/UI work: Fable 5 max, then Opus 5 max, then Kimi K3 max
    "visual-engineering": { "model": "anthropic/claude-fable-5-1", "reasoning": "max" },

    // Hard logic: GPT-6 Astra max, then GPT-5.6 Sol max
    "ultrabrain": { "model": "openai/gpt-6-astra", "reasoning": "max" },

    // Autonomous research and execution: GPT-6 Astra high, then GPT-5.6 Sol medium
    "deep": { "model": "openai/gpt-6-astra", "reasoning": "high" },

    // Creative and design work
    "artistry": { "model": "anthropic/claude-fable-5-1", "reasoning": "max" },

    // Quick tasks: fast and cheap
    "quick": { "model": "kimi-coding/kimi-for-coding-highspeed" },

    // Low-effort fallback: Grok 4.6 xhigh
    "unspecified-low": { "model": "xai/grok-4.6", "reasoning": "xhigh" },

    // High-effort fallback: GPT-6 Astra, then Opus 5, GLM 5.3, and Kimi K3
    "unspecified-high": { "model": "openai/gpt-6-astra", "reasoning": "high" },

    // Prose and documentation
    "writing": { "model": "anthropic/claude-fable-5-1", "reasoning": "medium" }
  }
}
```

### Model Families

**Claude-like models** (instruction-following, structured output):

- Claude Fable 5, Claude Opus 5, Claude Sonnet 5, Claude Haiku 4.5
- Kimi K3: behaves very similarly to Claude
- GLM 5.2 / 5.3: Claude-like behavior, good for broad tasks

**GPT models** (explicit reasoning, principle-driven):

- GPT-6 Astra: OpenAI's most capable model; default for `plan-reviewer` (xhigh, high on Copilot), `ultrabrain` (max), `deep` (high), and `unspecified-high` (high), with `gpt-6-astra-fast` as the Fast-mode variant
- GPT-5.6 Sol: the GPT-recommended main-agent configuration; the fallback rung under Astra for `ultrabrain` (max) and `deep` (medium)
- GPT-5.6 Terra: balanced mid-tier; second rung in `unspecified-low`
- GPT 5.6 Luna Fast: fast and cheap; default for `explore` and `librarian`

**Other families**:

- Grok 4.6: default for the `unspecified-low` category (xhigh)
- DeepSeek V4 Flash / Pro: utility rungs in `explore`, `librarian`, `quick`, and `unspecified-low`

See the [Agent-Model Matching Guide](./agent-model-matching.md) for the full chains, safe vs risky overrides, and the tuned-preset list.

---

## Why It's Better Than Pure Claude Code

Claude Code is good. But it's a single agent running a single model doing everything alone.

Oh My OpenAgent turns that into a coordinated team:

**Parallel execution.** Claude Code processes one thing at a time. OmO fires background agents in parallel: research, implementation, and verification happening simultaneously. Like having 5 engineers instead of 1.

**Hash-anchored edits.** Claude Code's edit tool fails when the model can't reproduce lines exactly. Hash-anchored `LINE#ID` edits are opt-in (`hashline_edit: true`). When enabled, OmO's `LINE#ID` hashing validates every edit before applying.

**IntentGate.** Claude Code takes your prompt and runs. OmO uses regex detectors for explicit mode keywords: `ultrawork`/`ulw`, the Team Mode spellings, `hyperplan`, and the adjacent hyperplan-ultrawork combo. Matching text injects the corresponding mode prompt.

**LSP + AST tools.** Workspace-level rename, go-to-definition, find-references, pre-build diagnostics, AST-aware code rewrites. IDE precision that vanilla Claude Code doesn't have.

**Skills with embedded MCPs.** Each skill brings its own MCP servers, scoped to the task. Context window stays clean instead of bloating with every tool.

**Discipline enforcement.** Todo enforcer yanks idle agents back to work. Comment checker strips AI slop. Goal is opt-in: `goal.enabled` and `goal.auto_start` both default to `false`. When enabled and started, it holds a persistent per-session objective and re-injects a continuation prompt on idle until a completion audit confirms the work is done.

**The fundamental advantage.** Models have different temperaments. Claude thinks deeply. GPT reasons architecturally. Haiku moves fast. Single-model tools force you to pick one personality for all tasks. Oh My OpenAgent uses them all, routing by task type. This isn't a temporary hack. It's the only architecture that makes sense as models specialize further. The gap between multi-model orchestration and single-model limitation widens every month. We're betting on that future.

---

## IntentGate

IntentGate is a regex-based mode keyword injector. It detects `ultrawork` or `ulw`, `team mode`/`team-mode`/`team_mode`/`teammode`, `hyperplan`, and the adjacent hyperplan-ultrawork combo, then adds the matching mode instructions.

It does not semantically classify requests as research, implementation, investigation, or fixes. Prompts without those explicit mode keywords continue without IntentGate mode injection.

---

## What's Next

- **[Installation Guide](./installation.md)**: complete setup instructions, provider authentication, and troubleshooting
- **[Orchestration Guide](./orchestration.md)**: deep dive into delegation, planning with `/ulw-plan`, and execution with `/ulw-execute`
- **[Agent-Model Matching Guide](./agent-model-matching.md)**: which models each role runs on and how to customize
- **[Team Mode Guide](./team-mode.md)**: parallel multi-agent coordination (OFF by default); 12 `team_*` tools, shared mailbox, shared task list, optional tmux layout
- **[Configuration Reference](../reference/configuration.md)**: full config options with examples
- **[Features Reference](../reference/features.md)**: complete feature documentation
- **[Manifesto](../manifesto.md)**: philosophy behind the project

---

**Ready to start?** Type `ultrawork` and see what a coordinated AI team can do.