# Agent-Model Matching Guide

> **For agents and users**: Why each agent needs a specific model — and how to customize without breaking things.

## The Core Insight: Models Are Developers

Think of AI models as developers on a team. Each has a different brain, different personality, different strengths. **A model isn't just "smarter" or "dumber." It thinks differently.** Give the same instruction to Claude and GPT, and they'll interpret it in fundamentally different ways.

This isn't a bug. It's the foundation of the entire system.

Oh My OpenCode assigns each agent a model that matches its *working style* — like building a team where each person is in the role that fits their personality.

### Sisyphus: The Sociable Lead

Sisyphus is the developer who knows everyone, goes everywhere, and gets things done through communication and coordination. Talks to other agents, understands context across the whole codebase, delegates work intelligently, and codes well too. But deep, purely technical problems? He'll struggle a bit.

**This is why Sisyphus uses Claude / Kimi / GLM.** These models excel at:
- Following complex, multi-step instructions (Sisyphus's prompt is ~1,100 lines)
- Maintaining conversation flow across many tool calls
- Understanding nuanced delegation and orchestration patterns
- Producing well-structured, communicative output

Using Sisyphus with GPT would be like taking your best project manager — the one who coordinates everyone, runs standups, and keeps the whole team aligned — and sticking them in a room alone to debug a race condition. Wrong fit. No GPT prompt exists for Sisyphus, and for good reason.

### Hephaestus: The Deep Specialist

Hephaestus is the developer who stays in their room coding all day. Doesn't talk much. Might seem socially awkward. But give them a hard technical problem and they'll emerge three hours later with a solution nobody else could have found.

**This is why Hephaestus uses GPT-5.3 Codex.** Codex is built for exactly this:
- Deep, autonomous exploration without hand-holding
- Multi-file reasoning across complex codebases
- Principle-driven execution (give a goal, not a recipe)
- Working independently for extended periods

Using Hephaestus with GLM or Kimi would be like assigning your most communicative, sociable developer to sit alone and do nothing but deep technical work. They'd get it done eventually, but they wouldn't shine — you'd be wasting exactly the skills that make them valuable.

### The Takeaway

Every agent's prompt is tuned to match its model's personality. **When you change the model, you change the brain — and the same instructions get understood completely differently.** Model matching isn't about "better" or "worse." It's about fit.

---

## How Claude and GPT Think Differently

This matters for understanding why some agents support both model families while others don't.

**Claude** responds to **mechanics-driven** prompts — detailed checklists, templates, step-by-step procedures. More rules = more compliance. You can write a 1,100-line prompt with nested workflows and Claude will follow every step.

**GPT** (especially 5.2+) responds to **principle-driven** prompts — concise principles, XML structure, explicit decision criteria. More rules = more contradiction surface = more drift. GPT works best when you state the goal and let it figure out the mechanics.

Real example: Prometheus's Claude prompt is ~1,100 lines across 7 files. The GPT prompt achieves the same behavior with 3 principles in ~121 lines. Same outcome, completely different approach.

Agents that support both families (Prometheus, Atlas) auto-detect your model at runtime and switch prompts via `isGptModel()`. You don't have to think about it.

---

## Agent Profiles

### Communicators → Claude / Kimi / GLM

These agents have Claude-optimized prompts — long, detailed, mechanics-driven. They need models that reliably follow complex, multi-layered instructions.

| Agent | Role | Fallback Chain | Notes |
|-------|------|----------------|-------|
| **Sisyphus** | Main orchestrator | Claude Opus → Kimi K2.5 → GLM 5 | **No GPT prompt.** Claude-family only. |
| **Metis** | Plan gap analyzer | Claude Opus → Kimi K2.5 → GPT-5.2 → Gemini 3 Pro | Claude preferred, GPT acceptable fallback. |

### Dual-Prompt Agents → Claude preferred, GPT supported

These agents ship separate prompts for Claude and GPT families. They auto-detect your model and switch at runtime.

| Agent | Role | Fallback Chain | Notes |
|-------|------|----------------|-------|
| **Prometheus** | Strategic planner | Claude Opus → GPT-5.2 → Kimi K2.5 → Gemini 3 Pro | Interview-mode planning. GPT prompt is compact and principle-driven. |
| **Atlas** | Todo orchestrator | Kimi K2.5 → Claude Sonnet → GPT-5.2 | Kimi is the sweet spot — Claude-like but cheaper. |

### Deep Specialists → GPT

These agents are built for GPT's principle-driven style. Their prompts assume autonomous, goal-oriented execution. Don't override to Claude.

| Agent | Role | Fallback Chain | Notes |
|-------|------|----------------|-------|
| **Hephaestus** | Autonomous deep worker | GPT-5.3 Codex only | No fallback. Requires GPT access. The craftsman. |
| **Oracle** | Architecture consultant | GPT-5.2 → Gemini 3 Pro → Claude Opus | Read-only high-IQ consultation. |
| **Momus** | Ruthless reviewer | GPT-5.2 → Claude Opus → Gemini 3 Pro | Verification and plan review. |

### Utility Runners → Speed over Intelligence

These agents do grep, search, and retrieval. They intentionally use the fastest, cheapest models available. **Don't "upgrade" them to Opus** — that's hiring a senior engineer to file paperwork.

| Agent | Role | Fallback Chain | Notes |
|-------|------|----------------|-------|
| **Explore** | Fast codebase grep | Grok Code Fast → MiniMax → Haiku → GPT-5-Nano | Speed is everything. Fire 10 in parallel. |
| **Librarian** | Docs/code search | Gemini Flash → MiniMax → GLM | Doc retrieval doesn't need deep reasoning. |
| **Multimodal Looker** | Vision/screenshots | Kimi K2.5 → Gemini Flash → GPT-5.2 → GLM-4.6v | Kimi excels at multimodal understanding. |

---

## Model Families

### Claude Family

Communicative, instruction-following, structured output. Best for agents that need to follow complex multi-step prompts.

| Model | Strengths |
|-------|-----------|
| **Claude Opus 4.6** | Best overall. Highest compliance with complex prompts. Default for Sisyphus. |
| **Claude Sonnet 4.6** | Faster, cheaper. Good balance for everyday tasks. |
| **Claude Haiku 4.5** | Fast and cheap. Good for quick tasks and utility work. |
| **Kimi K2.5** | Behaves very similarly to Claude. Great all-rounder at lower cost. Default for Atlas. |
| **GLM 5** | Claude-like behavior. Solid for orchestration tasks. |

### GPT Family

Principle-driven, explicit reasoning, deep technical capability. Best for agents that work autonomously on complex problems.

| Model | Strengths |
|-------|-----------|
| **GPT-5.3 Codex** | Deep coding powerhouse. Autonomous exploration. Required for Hephaestus. |
| **GPT-5.2** | High intelligence, strategic reasoning. Default for Oracle and Momus. |
| **GPT-5-Nano** | Ultra-cheap, fast. Good for simple utility tasks. |

### Other Models

| Model | Strengths |
|-------|-----------|
| **Gemini 3 Pro** | Excels at visual/frontend tasks. Different reasoning style. Default for `visual-engineering` and `artistry`. |
| **Gemini 3 Flash** | Fast. Good for doc search and light tasks. |
| **Grok Code Fast 1** | Blazing fast code grep. Default for Explore agent. |
| **MiniMax M2.5** | Fast and smart. Good for utility tasks and search/retrieval. |

### About Free-Tier Fallbacks

You may see model names like `kimi-k2.5-free`, `minimax-m2.5-free`, or `big-pickle` (GLM 4.6) in the source code or logs. These are free-tier versions of the same model families, served through the OpenCode Zen provider. They exist as lower-priority entries in fallback chains.

You don't need to configure them. The system includes them so it degrades gracefully when you don't have every paid subscription. If you have the paid version, the paid version is always preferred.

---

## Task Categories

When agents delegate work, they don't pick a model name — they pick a **category**. The category maps to the right model automatically.

| Category | When Used | Fallback Chain |
|----------|-----------|----------------|
| `visual-engineering` | Frontend, UI, CSS, design | Gemini 3 Pro → GLM 5 → Claude Opus |
| `ultrabrain` | Maximum reasoning needed | GPT-5.3 Codex → Gemini 3 Pro → Claude Opus |
| `deep` | Deep coding, complex logic | GPT-5.3 Codex → Claude Opus → Gemini 3 Pro |
| `artistry` | Creative, novel approaches | Gemini 3 Pro → Claude Opus → GPT-5.2 |
| `quick` | Simple, fast tasks | Claude Haiku → Gemini Flash → GPT-5-Nano |
| `unspecified-high` | General complex work | Claude Opus → GPT-5.2 → Gemini 3 Pro |
| `unspecified-low` | General standard work | Claude Sonnet → GPT-5.3 Codex → Gemini Flash |
| `writing` | Text, docs, prose | Gemini Flash → Claude Sonnet |

See the [Orchestration System Guide](./orchestration.md) for how agents dispatch tasks to categories.

---

## Customization

### Example Configuration

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",

  "agents": {
    // Main orchestrator: Claude Opus or Kimi K2.5 work best
    "sisyphus": {
      "model": "kimi-for-coding/k2p5",
      "ultrawork": { "model": "anthropic/claude-opus-4-6", "variant": "max" }
    },

    // Research agents: cheaper models are fine
    "librarian": { "model": "zai-coding-plan/glm-4.7" },
    "explore":   { "model": "github-copilot/grok-code-fast-1" },

    // Architecture consultation: GPT or Claude Opus
    "oracle": { "model": "openai/gpt-5.2", "variant": "high" },

    // Prometheus inherits sisyphus model; just add prompt guidance
    "prometheus": { "prompt_append": "Leverage deep & quick agents heavily, always in parallel." }
  },

  "categories": {
    "quick": { "model": "opencode/gpt-5-nano" },
    "unspecified-low": { "model": "kimi-for-coding/k2p5" },
    "unspecified-high": { "model": "anthropic/claude-sonnet-4-6", "variant": "max" },
    "visual-engineering": { "model": "google/gemini-3-pro", "variant": "high" },
    "writing": { "model": "kimi-for-coding/k2p5" }
  },

  // Limit expensive providers; let cheap ones run freely
  "background_task": {
    "providerConcurrency": { "anthropic": 3, "openai": 3, "opencode": 10, "zai-coding-plan": 10 },
    "modelConcurrency": { "anthropic/claude-opus-4-6": 2, "opencode/gpt-5-nano": 20 }
  }
}
```

Run `opencode models` to see available models, `opencode auth login` to authenticate providers.

### Safe vs Dangerous Overrides

**Safe** — same personality type:
- Sisyphus: Opus → Sonnet, Kimi K2.5, GLM 5 (all communicative models)
- Prometheus: Opus → GPT-5.2 (auto-switches to GPT prompt)
- Atlas: Kimi K2.5 → Sonnet, GPT-5.2 (auto-switches to GPT prompt)

**Dangerous** — personality mismatch:
- Sisyphus → GPT: **No GPT prompt exists. Will degrade significantly.**
- Hephaestus → Claude: **Built for Codex's autonomous style. Claude can't replicate this.**
- Explore → Opus: **Massive cost waste. Explore needs speed, not intelligence.**
- Librarian → Opus: **Same. Doc search doesn't need Opus-level reasoning.**

### How Model Resolution Works

Each agent has a fallback chain. The system tries models in priority order until it finds one available through your connected providers. You don't need to configure providers per model — just authenticate (`opencode auth login`) and the system figures out which models are available and where.

```
Agent Request → User Override (if configured) → Fallback Chain → System Default
```

---

## See Also

- [Installation Guide](./installation.md) — Setup and authentication
- [Orchestration System Guide](./orchestration.md) — How agents dispatch tasks to categories
- [Configuration Reference](../reference/configuration.md) — Full config options
- [`src/shared/model-requirements.ts`](../../src/shared/model-requirements.ts) — Source of truth for fallback chains
