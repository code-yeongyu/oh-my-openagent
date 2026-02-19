# Agent-Model Matching Guide

> **For agents and users**: This document explains the principles behind oh-my-opencode's agent-model assignments. Use it to understand why each agent uses a specific model, and how to customize them correctly.

---

## Why Model Matching Matters

Each oh-my-opencode agent has a **dedicated system prompt** optimized for a specific model family. Some agents (Atlas, Prometheus) ship separate prompts for GPT vs Claude models, with automatic routing via `isGptModel()` detection. Assigning the wrong model family to an agent doesn't just degrade performance — the agent may receive instructions formatted for a completely different model's reasoning style.

**Key principle**: Agents are tuned to model families, not individual models. A Claude-tuned agent works with Opus, Sonnet, or Haiku. A GPT-tuned agent works with GPT-5.2 or GPT-5.3-codex. Crossing families requires a model-specific prompt (which only some agents have).

---

## Agent-Model Map (Source of Truth)

This table reflects the actual fallback chains in `src/shared/model-requirements.ts`. The first available model in the chain is used.

### Core Agents

| Agent | Role | Primary Model Family | Fallback Chain | Has GPT Prompt? |
|-------|------|---------------------|----------------|-----------------|
| **Sisyphus** | Main ultraworker | Claude | Opus → Kimi K2.5 → GLM 5 → Big Pickle | No — **never use GPT** |
| **Hephaestus** | Deep autonomous worker | GPT (only) | GPT-5.3-codex (medium) | N/A (GPT-native) |
| **Prometheus** | Strategic planner | Claude (default), GPT (auto-detected) | Opus → GPT-5.2 → Kimi K2.5 → Gemini 3 Pro | **Yes** — `src/agents/prometheus/gpt.ts` |
| **Atlas** | Todo orchestrator | Kimi K2.5 (default), GPT (auto-detected) | Kimi K2.5 → Sonnet → GPT-5.2 | **Yes** — `src/agents/atlas/gpt.ts` |
| **Oracle** | Architecture/debugging | GPT | GPT-5.2 → Gemini 3 Pro → Opus | No |
| **Metis** | Plan review consultant | Claude | Opus → Kimi K2.5 → GPT-5.2 → Gemini 3 Pro | No |
| **Momus** | High-accuracy reviewer | GPT | GPT-5.2 → Opus → Gemini 3 Pro | No |

### Utility Agents

| Agent | Role | Primary Model Family | Fallback Chain |
|-------|------|---------------------|----------------|
| **Explore** | Fast codebase grep | Grok/lightweight | Grok Code Fast 1 → MiniMax M2.5 → Haiku → GPT-5-nano |
| **Librarian** | Docs/code search | Lightweight | MiniMax M2.5 → Gemini 3 Flash → Big Pickle |
| **Multimodal Looker** | Vision/screenshots | Kimi/multimodal | Kimi K2.5 → Gemini 3 Flash → GPT-5.2 → GLM-4.6v |

### Task Categories

Categories are used for `background_task` and `delegate_task` dispatching:

| Category | Purpose | Primary Model | Notes |
|----------|---------|---------------|-------|
| `visual-engineering` | Frontend/UI work | Gemini 3 Pro | Gemini excels at visual tasks |
| `ultrabrain` | Maximum intelligence | GPT-5.3-codex (xhigh) | Highest reasoning variant |
| `deep` | Deep coding | GPT-5.3-codex (medium) | Requires GPT availability |
| `artistry` | Creative/design | Gemini 3 Pro | Requires Gemini availability |
| `quick` | Fast simple tasks | Claude Haiku | Cheapest, fastest |
| `unspecified-high` | General high-quality | Claude Opus | Default for complex tasks |
| `unspecified-low` | General standard | Claude Sonnet | Default for standard tasks |
| `writing` | Text/docs | Kimi K2.5 | Best prose quality |

---

## Model-Specific Prompt Routing

### Why Different Models Need Different Prompts

Claude and GPT models have fundamentally different instruction-following behaviors:

- **Claude models** respond well to **mechanics-driven** prompts — detailed checklists, templates, step-by-step procedures, and explicit anti-patterns. More rules = more compliance.
- **GPT models** (especially 5.2+) have **stronger instruction adherence** and respond better to **principle-driven** prompts — concise principles, XML-tagged structure, explicit decision criteria. More rules = more contradiction surface area = more drift.

This insight comes from analyzing OpenAI's Codex Plan Mode prompt alongside the GPT-5.2 Prompting Guide:
- Codex Plan Mode uses 3 clean principles in ~121 lines to achieve what Prometheus's Claude prompt does in ~1,100 lines across 7 files
- GPT-5.2's "conservative grounding bias" and "more deliberate scaffolding" mean it builds clearer plans by default, but needs **explicit decision criteria** (it won't infer what you want)
- The key concept is **"Decision Complete"** — a plan must leave ZERO decisions to the implementer. GPT models follow this literally when stated as a principle, while Claude models need enforcement mechanisms

### How It Works

Some agents detect the assigned model at runtime and switch prompts:

```typescript
// From src/agents/prometheus/system-prompt.ts
export function getPrometheusPrompt(model?: string): string {
  if (model && isGptModel(model)) return getGptPrometheusPrompt()  // XML-tagged, principle-driven
  return PROMETHEUS_SYSTEM_PROMPT  // Claude-optimized, modular sections
}
```

**Agents with dual prompts:**
- **Prometheus**: Claude prompt (~1,100 lines, 7 files, mechanics-driven with checklists and templates) vs GPT prompt (~300 lines, single file, principle-driven with XML structure inspired by Codex Plan Mode)
- **Atlas**: Claude prompt vs GPT prompt (GPT-optimized todo orchestration with explicit scope constraints)

**Why this matters for customization**: If you override Prometheus to use a GPT model, the GPT prompt activates automatically — and it's specifically designed for how GPT reasons. But if you override Sisyphus to use GPT — there is no GPT prompt, and performance will degrade significantly because Sisyphus's prompt is deeply tuned for Claude's reasoning style.

### Model Family Detection

`isGptModel()` matches:
- Any model starting with `openai/` or `github-copilot/gpt-`
- Model names starting with common GPT prefixes (`gpt-`, `o1-`, `o3-`, `o4-`, `codex-`)

Everything else is treated as "Claude-like" (Claude, Kimi, GLM, Gemini).

---

## Customization Guide

### When to Customize

Customize model assignments when:
- You have a specific provider subscription (e.g., only OpenAI, no Anthropic)
- You want to use a cheaper model for certain agents
- You're experimenting with new models

### How to Customize

Override in `oh-my-opencode.json` (user: `~/.config/opencode/oh-my-opencode.json`, project: `.opencode/oh-my-opencode.json`):

```jsonc
{
  "agents": {
    "sisyphus": { "model": "kimi-for-coding/k2p5" },
    "atlas": { "model": "anthropic/claude-sonnet-4-6" },
    "prometheus": { "model": "openai/gpt-5.2" }  // Will auto-switch to GPT prompt
  }
}
```

### Safe Substitutions (same model family)

These swaps are safe because they stay within the same prompt family:

| Agent | Default | Safe Alternatives |
|-------|---------|-------------------|
| **Sisyphus** | Claude Opus | Claude Sonnet, Kimi K2.5, GLM 5 (any Claude-like) |
| **Hephaestus** | GPT-5.3-codex | No alternatives — GPT only |
| **Prometheus** | Claude Opus | Claude Sonnet (Claude prompt) OR GPT-5.2 (auto-switches to GPT prompt) |
| **Atlas** | Kimi K2.5 | Claude Sonnet (Claude prompt) OR GPT-5.2 (auto-switches to GPT prompt) |
| **Oracle** | GPT-5.2 | Gemini 3 Pro, Claude Opus |

### Dangerous Substitutions (cross-family without prompt support)

| Agent | Dangerous Override | Why |
|-------|-------------------|-----|
| **Sisyphus** → GPT | No GPT-optimized prompt exists. Sisyphus is deeply tuned for Claude-style reasoning. Performance drops dramatically. |
| **Hephaestus** → Claude | Hephaestus is purpose-built for GPT's Codex capabilities. Claude cannot replicate this. |
| **Explore** → Opus | Massive overkill and cost waste. Explore needs speed, not intelligence. |

### Explaining to Users

When a user asks about model configuration, explain:

1. **The default works out of the box** — the installer configures optimal models based on their subscriptions
2. **Each agent has a "home" model family** — Sisyphus is Claude-native, Hephaestus is GPT-native
3. **Some agents auto-adapt** — Prometheus and Atlas detect GPT models and switch to optimized prompts
4. **Cross-family overrides are risky** — unless the agent has a dedicated prompt for that family
5. **Cost optimization is valid** — swapping Opus → Sonnet or Kimi K2.5 for Sisyphus is fine and saves money
6. **Point to this guide** for the full fallback chains and rationale

---

## Provider Priority

When multiple providers are available, oh-my-opencode prefers:

```
Native (anthropic/, openai/, google/) > Kimi for Coding > GitHub Copilot > OpenCode Zen > Z.ai Coding Plan
```

Each fallback chain entry specifies which providers can serve that model. The system picks the first entry where at least one provider is connected.

---

## Quick Decision Tree for Users

```
What subscriptions do you have?

├── Claude (Anthropic) → Sisyphus works optimally. Prometheus/Metis use Claude prompts.
├── OpenAI/ChatGPT → Hephaestus unlocked. Oracle/Momus use GPT. Prometheus auto-switches.
├── Both Claude + OpenAI → Full agent roster. Best experience.
├── Gemini only → Visual-engineering category excels. Other agents use Gemini as fallback.
├── GitHub Copilot only → Works as fallback provider for all model families.
├── OpenCode Zen only → Free-tier access to multiple models. Functional but rate-limited.
└── No subscription → Limited functionality. Consider OpenCode Zen (free).

For each user scenario, the installer (`bunx oh-my-opencode install`) auto-configures the optimal assignment.
```

---

## See Also

- [Installation Guide](./installation.md) — Setup with subscription-based model configuration
- [Configuration Reference](../configurations.md) — Full config options including agent overrides
- [Overview](./overview.md) — How the agent system works
- [`src/shared/model-requirements.ts`](../../src/shared/model-requirements.ts) — Source of truth for fallback chains
