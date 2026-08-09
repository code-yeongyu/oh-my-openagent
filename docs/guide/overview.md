# What Is Oh My OpenAgent?

Oh My OpenAgent is a multi-model agent orchestration harness for OpenCode. It transforms a single AI agent into a coordinated development team that actually ships code.

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

That's it. The agent figures everything out — explores your codebase, researches patterns, implements the feature, verifies with diagnostics. Keeps working until done.

Want more control? Press **Tab** to enter [Prometheus mode](./orchestration.md) for interview-based planning, then run `/start-work` for full orchestration.

---

## The Philosophy: Breaking Free

We used to call this "Claude Code on steroids." That was wrong.

This isn't about making Claude Code better. It's about breaking free from the idea that one model, one provider, one way of working is enough. Anthropic wants you locked in. OpenAI wants you locked in. Everyone wants you locked in.

Oh My OpenAgent doesn't play that game. It orchestrates across models, picking the right brain for the right job. Opus 5 for orchestration and visual work. GPT-5.6 Sol for deep reasoning. Kimi K3 and GLM 5.2 as visual fallbacks. Kimi high-speed for quick tasks. All working together, automatically.

---

## How It Works: Agent Orchestration

Instead of one agent doing everything, Oh My OpenAgent uses **specialized agents that delegate to each other** based on task type.

**The Architecture:**

```
User Request
    ↓
[IntentGate] — Classifies what you actually want
    ↓
[Sisyphus] — Main orchestrator, plans and delegates
    ↓
    ├─→ [Prometheus] — Strategic planning (interview mode)
    ├─→ [Atlas] — Todo orchestration and execution
    ├─→ [Oracle] — Architecture consultation
    ├─→ [Librarian] — Documentation/code search
    ├─→ [Explore] — Fast codebase grep
    └─→ [Category-based agents] — Specialized by task type
```

When Sisyphus delegates to a subagent, it doesn't pick a model name. It picks a **category** — `visual-engineering`, `ultrabrain`, `deep`, `artistry`, `quick`, `unspecified-low`, `unspecified-high`, `writing`. The category automatically maps to the right model. You touch nothing.

For a deep dive into how agents collaborate, see the [Orchestration System Guide](./orchestration.md).

---

## Meet the Agents

### Sisyphus: The Discipline Agent

Named after the Greek myth. He rolls the boulder every day. Never stops. Never gives up.

Sisyphus is your main orchestrator. He plans, delegates to specialists, and drives tasks to completion with aggressive parallel execution. He doesn't stop halfway. He doesn't get distracted. He finishes.

**Recommended models:**

- **Claude Opus 5** / **Opus 5** — Best overall experience. Sisyphus was built with Claude-optimized prompts.
- **Kimi K3** — Strongest Kimi for Sisyphus. Recommended when you can accept its thinking-token cost; the K3 prompt is calibrated to stop overthinking and keep work moving.
- **Kimi K2.7** — Restrained, outcome-first Kimi fallback for Claude-like orchestration paths.
- **GLM 5.2** — Solid option, especially via OpenCode Go. Sisyphus uses a GLM-5.2-calibrated prompt and the automatic chain includes `glm-5.2` explicitly, but current evidence is still lighter than Claude/Kimi maintainer validation.

Sisyphus works best on Claude Opus 5, Kimi K3/K2.7, and GLM 5.2. GPT-5.4 has its own prompt, while GPT-5.5 and GPT-5.6 Sol share a model-aware GPT-native prompt family. Hephaestus remains the recommended GPT-5.6 agent because [issue #6074](https://github.com/code-yeongyu/oh-my-openagent/issues/6074) tracks Sisyphus over-orchestration on bounded work.

### Hephaestus: The Legitimate Craftsman

Named with intentional irony. Anthropic blocked OpenCode from using their API because of this project. So the team built an autonomous GPT-native agent instead.

Hephaestus prefers GPT-5.6 Sol at medium effort through OpenAI or Vercel, then falls back to GPT-5.6 Sol at medium effort across OpenAI, GitHub Copilot, OpenCode, or Vercel. Give him a goal, not a recipe. He explores the codebase, researches patterns, and executes end-to-end without hand-holding.

Use Hephaestus when you need deep architectural reasoning, complex debugging across many files, or cross-domain knowledge synthesis. Switch to him explicitly when the work benefits from a GPT-native autonomous agent.

**Why this beats vanilla Codex CLI:**

- **Multi-model orchestration.** Pure Codex is single-model. OmO routes different tasks to different models automatically. Opus 5 for orchestration and visual work. GPT-5.6 Sol for deep reasoning. Kimi high-speed for quick tasks. The right brain for the right job.
- **Background agents.** Fire 5+ agents in parallel. Something Codex simply cannot do. While one agent writes code, another researches patterns, another checks documentation. Like a real dev team.
- **Category system.** Tasks are routed by intent, not model name. `visual-engineering` starts with Claude Opus 5 max, then Kimi K3 and GLM 5.2. `ultrabrain` prefers GPT-5.6 Sol xhigh, while `deep` uses GPT-5.6 Sol medium. `artistry` starts with Claude Fable 5, `quick` with Kimi high-speed, `unspecified-low` with GPT-5.6 Luna, and both `unspecified-high` and `writing` with Kimi K3. No manual juggling.
- **Accumulated wisdom.** Subagents learn from previous results. Conventions discovered in task 1 are passed to task 5. Mistakes made early aren't repeated. The system gets smarter as it works.

### Prometheus: The Strategic Planner

Prometheus interviews you like a real engineer. Asks clarifying questions. Identifies scope and ambiguities. Builds a detailed plan before a single line of code is touched.

Press **Tab** to enter Prometheus mode, or type `@plan "your task"` from Sisyphus.

### Atlas: The Conductor

Atlas executes Prometheus plans. Distributes tasks to specialized subagents. Accumulates learnings across tasks. Verifies completion independently.

Run `/start-work` to activate Atlas on your latest plan.

### Oracle: The Consultant

Read-only high-IQ consultant for architecture decisions and complex debugging. Consult Oracle when facing unfamiliar patterns, security concerns, or multi-system tradeoffs.

### Supporting Cast

- **Metis** — Gap analyzer. Catches what Prometheus missed before plans are finalized.
- **Momus** — Ruthless reviewer. Validates plans against clarity, verification, and context criteria.
- **Explore** — Fast codebase grep. Uses speed-focused models for pattern discovery.
- **Librarian** — Documentation and OSS code search. Stays current on library APIs and best practices.
- **Multimodal Looker** — Vision and screenshot analysis.

---

## Working Modes

### Ultrawork Mode: For the Lazy

Type `ultrawork` or just `ulw`. That's it.

The agent figures everything out. Explores your codebase. Researches patterns. Implements the feature. Verifies with diagnostics. Keeps working until done.

This is the "just do it" mode. Full automatic. You don't have to think deep because the agent thinks deep for you.

### Prometheus Mode: For the Precise

Press **Tab** to enter Prometheus mode.

Prometheus interviews you like a real engineer. Asks clarifying questions. Identifies scope and ambiguities. Builds a detailed plan before a single line of code is touched.

Then run `/start-work` and Atlas takes over. Tasks are distributed to specialized subagents. Each completion is verified independently. Learnings accumulate across tasks. Progress tracks across sessions.

Use Prometheus for multi-day projects, critical production changes, complex refactoring, or when you want a documented decision trail.

---

## Agent Model Matching

Different agents work best with different models. Oh My OpenAgent automatically assigns optimal models, but you can customize everything.

### Default Configuration

Models are auto-configured at install time. The interactive installer asks which providers you have, then generates optimal model assignments for each agent and category.

At runtime, fallback chains ensure work continues even if your preferred provider is down. Each agent has a provider priority chain. The system tries providers in order until it finds an available model.

### Custom Model Configuration

You can override specific agents or categories in your config:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",

  "agents": {
    // Main orchestrator: Claude Opus or Kimi K3 work best
    "sisyphus": {
      "model": "kimi-for-coding/kimi-k3",
      "ultrawork": { "model": "anthropic/claude-opus-5", "variant": "max" },
    },

    // Research agents: cheaper models are fine
    "librarian": { "model": "google/gemini-3.6-flash" },
    "explore": { "model": "github-copilot/grok-code-fast-1" },

    // Architecture consultation: GPT or Claude Opus
    "oracle": { "model": "openai/gpt-5.6-sol", "variant": "high" },
  },

  "categories": {
    // Frontend/UI work: Opus 5, then Kimi K3 and GLM 5.2
    "visual-engineering": {
      "model": "anthropic/claude-opus-5",
      "variant": "max",
    },

    // Hard logic and architecture: GPT-5.6 Sol xhigh
    "ultrabrain": { "model": "openai/gpt-5.6-sol", "variant": "xhigh" },

    // Autonomous research and execution
    "deep": { "model": "openai/gpt-5.6-sol", "variant": "medium" },

    // Creative and design work
    "artistry": { "model": "anthropic/claude-fable-5", "variant": "xhigh" },

    // Quick tasks: fast and cheap
    "quick": { "model": "kimi-for-coding/kimi-for-coding-highspeed" },

    // Low-effort fallback: GPT-5.6 Luna
    "unspecified-low": { "model": "openai/gpt-5.6-luna", "variant": "xhigh" },

    // High-effort fallback: Kimi K3, then Opus 5
    "unspecified-high": { "model": "kimi-for-coding/kimi-k3", "variant": "max" },

    // Prose and documentation
    "writing": { "model": "kimi-for-coding/kimi-k3", "variant": "low" },
  },
}
```

### Model Families

**Claude-like models** (instruction-following, structured output):

- Claude Opus 5, Claude Haiku 4.5
- Kimi K3 — behaves very similarly to Claude
- GLM 5.2 — Claude-like behavior, good for broad tasks

**GPT models** (explicit reasoning, principle-driven):

- GPT-5.6 Sol — preferred for Hephaestus and `ultrabrain`; the `deep` category uses it at medium effort
- GPT-5.6 Terra — balanced mid-tier; preferred for Momus (high) and available as an explicit override elsewhere
- GPT-5.6 Luna — light tier; default for the `unspecified-low` category (xhigh)
- GPT-5.6 Sol override paths — deep coding powerhouse, default for Oracle and the first GPT fallback for GPT-5.6-native roles
- GPT 5.6 Luna Fast — fast and cheap utility fallback after the Kimi high-speed quick default

**Different-behavior models**:

- Gemini 3.1 Pro — visual-capable explicit override for providers that expose it; not the built-in `visual-engineering` default
- MiniMax M3 / M2.7 / M2.7-highspeed — fast and smart for utility tasks
- Grok Code Fast 1 — optimized for code grep/search

See the [Agent-Model Matching Guide](./agent-model-matching.md) for complete details on which models work best for each agent, safe vs dangerous overrides, and provider priority chains.

---

## Why It's Better Than Pure Claude Code

Claude Code is good. But it's a single agent running a single model doing everything alone.

Oh My OpenAgent turns that into a coordinated team:

**Parallel execution.** Claude Code processes one thing at a time. OmO fires background agents in parallel — research, implementation, and verification happening simultaneously. Like having 5 engineers instead of 1.

**Hash-anchored edits.** Claude Code's edit tool fails when the model can't reproduce lines exactly. OmO's `LINE#ID` content hashing validates every edit before applying. Grok Code Fast 1 went from 6.7% to 68.3% success rate just from this change.

**IntentGate.** Claude Code takes your prompt and runs. OmO uses regex detectors for explicit mode keywords: `ultrawork`/`ulw`, the Team Mode spellings, `hyperplan`, and the adjacent hyperplan-ultrawork combo. Matching text injects the corresponding mode prompt.

**LSP + AST tools.** Workspace-level rename, go-to-definition, find-references, pre-build diagnostics, AST-aware code rewrites. IDE precision that vanilla Claude Code doesn't have.

**Skills with embedded MCPs.** Each skill brings its own MCP servers, scoped to the task. Context window stays clean instead of bloating with every tool.

**Discipline enforcement.** Todo enforcer yanks idle agents back to work. Comment checker strips AI slop. Goal is opt-in: `goal.enabled` and `goal.auto_start` both default to `false`. When enabled and started, it holds a persistent per-session objective and re-injects a continuation prompt on idle until a completion audit confirms the work is done.

**The fundamental advantage.** Models have different temperaments. Claude thinks deeply. GPT reasons architecturally. Gemini visualizes. Haiku moves fast. Single-model tools force you to pick one personality for all tasks. Oh My OpenAgent leverages them all, routing by task type. This isn't a temporary hack — it's the only architecture that makes sense as models specialize further. The gap between multi-model orchestration and single-model limitation widens every month. We're betting on that future.

---

## IntentGate

IntentGate is a regex-based mode keyword injector. It detects `ultrawork` or `ulw`, `team mode`/`team-mode`/`team_mode`/`teammode`, `hyperplan`, and the adjacent hyperplan-ultrawork combo, then adds the matching mode instructions.

It does not semantically classify requests as research, implementation, investigation, or fixes. Prompts without those explicit mode keywords continue without IntentGate mode injection.

---

## What's Next

- **[Installation Guide](./installation.md)** — Complete setup instructions, provider authentication, and troubleshooting
- **[Orchestration Guide](./orchestration.md)** — Deep dive into agent collaboration, planning with Prometheus, and execution with Atlas
- **[Agent-Model Matching Guide](./agent-model-matching.md)** — Which models work best for each agent and how to customize
- **[Team Mode Guide](./team-mode.md)** — Parallel multi-agent coordination (OFF by default); 12 `team_*` tools, shared mailbox, shared task list, optional tmux layout
- **[Configuration Reference](../reference/configuration.md)** — Full config options with examples
- **[Features Reference](../reference/features.md)** — Complete feature documentation
- **[Manifesto](../manifesto.md)** — Philosophy behind the project

---

**Ready to start?** Type `ultrawork` and see what a coordinated AI team can do.
