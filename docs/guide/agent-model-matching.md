# Agent-Model Matching Guide

> **For agents and users**: How to pick the right model for each agent. Read this before customizing model settings.

Run `opencode models` to see all available models on your system, and `opencode auth login` to authenticate with providers.

---

## Model Families: Know Your Options

Not all models behave the same way. Understanding which models are "similar" helps you make safe substitutions.

### Claude-like Models (instruction-following, structured output)

These models respond similarly to Claude and work well with oh-my-opencode's Claude-optimized prompts:

| Model | Provider(s) | Notes |
|-------|-------------|-------|
| **Claude Opus 4.6** | anthropic, github-copilot, opencode | Best overall. Default for Sisyphus. |
| **Claude Sonnet 4.6** | anthropic, github-copilot, opencode | Faster, cheaper. Good balance. |
| **Claude Haiku 4.5** | anthropic, opencode | Fast and cheap. Good for quick tasks. |
| **Kimi K2.5** | kimi-for-coding | Behaves very similarly to Claude. Great all-rounder. Default for Atlas. |
| **Kimi K2.5 Free** | opencode | Free-tier Kimi. Rate-limited but functional. |
| **GLM 5** | zai-coding-plan, opencode | Claude-like behavior. Good for broad tasks. |
| **Big Pickle (GLM 4.6)** | opencode | Free-tier GLM. Decent fallback. |

### GPT Models (explicit reasoning, principle-driven)

GPT models need differently structured prompts. Some agents auto-detect GPT and switch prompts:

| Model | Provider(s) | Notes |
|-------|-------------|-------|
| **GPT-5.3-codex** | openai, github-copilot, opencode | Deep coding powerhouse. Required for Hephaestus. |
| **GPT-5.2** | openai, github-copilot, opencode | High intelligence. Default for Oracle. |
| **GPT-5-Nano** | opencode | Ultra-cheap, fast. Good for simple utility tasks. |

### Different-Behavior Models

These models have unique characteristics — don't assume they'll behave like Claude or GPT:

| Model | Provider(s) | Notes |
|-------|-------------|-------|
| **Gemini 3 Pro** | google, github-copilot, opencode | Excels at visual/frontend tasks. Different reasoning style. |
| **Gemini 3 Flash** | google, github-copilot, opencode | Fast, good for doc search and light tasks. |
| **MiniMax M2.5** | venice | Fast and smart. Good for utility tasks. |
| **MiniMax M2.5 Free** | opencode | Free-tier MiniMax. Fast for search/retrieval. |

### Speed-Focused Models

| Model | Provider(s) | Speed | Notes |
|-------|-------------|-------|-------|
| **Grok Code Fast 1** | github-copilot, venice | Very fast | Optimized for code grep/search. Default for Explore. |
| **Claude Haiku 4.5** | anthropic, opencode | Fast | Good balance of speed and intelligence. |
| **MiniMax M2.5 (Free)** | opencode, venice | Fast | Smart for its speed class. |
| **GPT-5.3-codex-spark** | openai | Extremely fast | Blazing fast but compacts so aggressively that oh-my-opencode's context management doesn't work well with it. Not recommended for omo agents. |

---

## Agent Roles and Recommended Models

### Claude-Optimized Agents

These agents have prompts tuned for Claude-family models. Use Claude > Kimi K2.5 > GLM 5 in that priority order.

| Agent | Role | Default Chain | What It Does |
|-------|------|---------------|--------------|
| **Sisyphus** | Main ultraworker | Opus (max) → Kimi K2.5 → GLM 5 → Big Pickle | Primary coding agent. Orchestrates everything. **Never use GPT — no GPT prompt exists.** |
| **Metis** | Plan review | Opus (max) → Kimi K2.5 → GPT-5.2 → Gemini 3 Pro | Reviews Prometheus plans for gaps. |

### Dual-Prompt Agents (Claude + GPT auto-switch)

These agents detect your model family at runtime and switch to the appropriate prompt. If you have GPT access, these agents can use it effectively.

Priority: **Claude > GPT > Claude-like models**

| Agent | Role | Default Chain | GPT Prompt? |
|-------|------|---------------|-------------|
| **Prometheus** | Strategic planner | Opus (max) → **GPT-5.2 (high)** → Kimi K2.5 → Gemini 3 Pro | Yes — XML-tagged, principle-driven (~300 lines vs ~1,100 Claude) |
| **Atlas** | Todo orchestrator | **Kimi K2.5** → Sonnet → GPT-5.2 | Yes — GPT-optimized todo management |

### GPT-Native Agents

These agents are built for GPT. Don't override to Claude.

| Agent | Role | Default Chain | Notes |
|-------|------|---------------|-------|
| **Hephaestus** | Deep autonomous worker | GPT-5.3-codex (medium) only | "Codex on steroids." No fallback. Requires GPT access. |
| **Oracle** | Architecture/debugging | GPT-5.2 (high) → Gemini 3 Pro → Opus | High-IQ strategic backup. GPT preferred. |
| **Momus** | High-accuracy reviewer | GPT-5.2 (medium) → Opus → Gemini 3 Pro | Verification agent. GPT preferred. |

### Utility Agents (Speed > Intelligence)

These agents do search, grep, and retrieval. They intentionally use fast, cheap models. **Don't "upgrade" them to Opus — it wastes tokens on simple tasks.**

| Agent | Role | Default Chain | Design Rationale |
|-------|------|---------------|------------------|
| **Explore** | Fast codebase grep | MiniMax M2.5 Free → Grok Code Fast → MiniMax M2.5 → Haiku → GPT-5-Nano | Speed is everything. Grok is blazing fast for grep. |
| **Librarian** | Docs/code search | MiniMax M2.5 Free → Gemini Flash → Big Pickle | Entirely free-tier. Doc retrieval doesn't need deep reasoning. |
| **Multimodal Looker** | Vision/screenshots | Kimi K2.5 → Kimi Free → Gemini Flash → GPT-5.2 → GLM-4.6v | Kimi excels at multimodal understanding. |

---

## Task Categories

Categories control which model is used for `background_task` and `delegate_task`. See the [Orchestration System Guide](./understanding-orchestration-system.md) for how agents dispatch tasks to categories.

| Category | When Used | Recommended Models | Notes |
|----------|-----------|-------------------|-------|
| `visual-engineering` | Frontend, UI, CSS, design | Gemini 3 Pro (high) → GLM 5 → Opus → Kimi K2.5 | Gemini dominates visual tasks |
| `ultrabrain` | Maximum reasoning needed | GPT-5.3-codex (xhigh) → Gemini 3 Pro → Opus | Highest intelligence available |
| `deep` | Deep coding, complex logic | GPT-5.3-codex (medium) → Opus → Gemini 3 Pro | Requires GPT availability |
| `artistry` | Creative, novel approaches | Gemini 3 Pro (high) → Opus → GPT-5.2 | Requires Gemini availability |
| `quick` | Simple, fast tasks | Haiku → Gemini Flash → GPT-5-Nano | Cheapest and fastest |
| `unspecified-high` | General complex work | Opus (max) → GPT-5.2 (high) → Gemini 3 Pro | Default when no category fits |
| `unspecified-low` | General standard work | Sonnet → GPT-5.3-codex (medium) → Gemini Flash | Everyday tasks |
| `writing` | Text, docs, prose | Kimi K2.5 → Gemini Flash → Sonnet | Kimi produces best prose |

---

## Why Different Models Need Different Prompts

Claude and GPT models have fundamentally different instruction-following behaviors:

- **Claude models** respond well to **mechanics-driven** prompts — detailed checklists, templates, step-by-step procedures. More rules = more compliance.
- **GPT models** (especially 5.2+) respond better to **principle-driven** prompts — concise principles, XML-tagged structure, explicit decision criteria. More rules = more contradiction surface = more drift.

Key insight from Codex Plan Mode analysis:
- Codex Plan Mode achieves the same results with 3 principles in ~121 lines that Prometheus's Claude prompt needs ~1,100 lines across 7 files
- The core concept is **"Decision Complete"** — a plan must leave ZERO decisions to the implementer
- GPT follows this literally when stated as a principle; Claude needs enforcement mechanisms

This is why Prometheus and Atlas ship separate prompts per model family — they auto-detect and switch at runtime via `isGptModel()`.

---

## Customization Guide

### How to Customize

Override in `oh-my-opencode.json`:

```jsonc
{
  "agents": {
    "sisyphus": { "model": "kimi-for-coding/k2p5" },
    "prometheus": { "model": "openai/gpt-5.2" }  // Auto-switches to GPT prompt
  }
}
```

### Selection Priority

When choosing models for Claude-optimized agents:

```
Claude (Opus/Sonnet) > GPT (if agent has dual prompt) > Claude-like (Kimi K2.5, GLM 5)
```

When choosing models for GPT-native agents:

```
GPT (5.3-codex, 5.2) > Claude Opus (decent fallback) > Gemini (acceptable)
```

### Safe vs Dangerous Overrides

**Safe** (same family):
- Sisyphus: Opus → Sonnet, Kimi K2.5, GLM 5
- Prometheus: Opus → GPT-5.2 (auto-switches prompt)
- Atlas: Kimi K2.5 → Sonnet, GPT-5.2 (auto-switches)

**Dangerous** (no prompt support):
- Sisyphus → GPT: **No GPT prompt. Will degrade significantly.**
- Hephaestus → Claude: **Built for Codex. Claude can't replicate this.**
- Explore → Opus: **Massive cost waste. Explore needs speed, not intelligence.**
- Librarian → Opus: **Same. Doc search doesn't need Opus-level reasoning.**

---

## Provider Priority

```
Native (anthropic/, openai/, google/) > Kimi for Coding > GitHub Copilot > Venice > OpenCode Zen > Z.ai Coding Plan
```

---

## See Also

- [Installation Guide](./installation.md) — Setup and authentication
- [Orchestration System](./understanding-orchestration-system.md) — How agents dispatch tasks to categories
- [Configuration Reference](../configurations.md) — Full config options
- [`src/shared/model-requirements.ts`](../../src/shared/model-requirements.ts) — Source of truth for fallback chains