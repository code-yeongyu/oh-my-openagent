# Agent-Model Matching Guide

> **For agents and users**: This document explains the principles behind oh-my-opencode's agent-model assignments. Use it to understand why each agent uses a specific model, and how to customize them correctly.

---

## Why Model Matching Matters

Each oh-my-opencode agent has a **dedicated system prompt** optimized for a specific model family. Some agents (Atlas, Prometheus) ship separate prompts for GPT vs Claude models, with automatic routing via `isGptModel()` detection. Assigning the wrong model family to an agent doesn't just degrade performance — the agent may receive instructions formatted for a completely different model's reasoning style.

**Key principle**: Agents are tuned to model families, not individual models. A Claude-tuned agent works with Opus, Sonnet, or Haiku. A GPT-tuned agent works with GPT-5.2 or GPT-5.3-codex. Crossing families requires a model-specific prompt (which only some agents have).

---

## Design Philosophy: Intelligence Where It Matters, Speed Everywhere Else

The model catalog follows a clear hierarchy:

1. **Core agents get premium models** — Sisyphus (Claude Opus), Hephaestus (GPT-5.3-codex), Prometheus (Opus/GPT-5.2). These agents handle complex multi-step reasoning where model quality directly impacts output.

2. **Utility agents get fast, free-tier models** — Explore (Grok Code Fast → MiniMax M2.5 Free), Librarian (MiniMax M2.5 Free → Gemini Flash → Big Pickle). These agents do search, grep, and doc retrieval where speed matters more than deep reasoning.

3. **Orchestrator agents get balanced models** — Atlas (Kimi K2.5 → Sonnet), Metis (Opus → Kimi K2.5). These need good instruction-following but don't need maximum intelligence.

4. **Free-tier models are first-class citizens** — MiniMax M2.5 Free, Big Pickle, GPT-5-Nano, and Kimi K2.5 Free appear throughout fallback chains. This means oh-my-opencode works well even with OpenCode Zen (free) as the only provider.

---

## Agent-Model Map (Source of Truth)

This table reflects the actual fallback chains in `src/shared/model-requirements.ts`. The first available model in the chain is used.

### Core Agents

| Agent | Role | Fallback Chain (in order) | Has GPT Prompt? |
|-------|------|---------------------------|-----------------|
| **Sisyphus** | Main ultraworker | Opus (max) → Kimi K2.5 → Kimi K2.5 Free → GLM 5 → Big Pickle | No — **never use GPT** |
| **Hephaestus** | Deep autonomous worker | GPT-5.3-codex (medium) — no fallback | N/A (GPT-native) |
| **Prometheus** | Strategic planner | Opus (max) → **GPT-5.2 (high)** → Kimi K2.5 → Kimi K2.5 Free → Gemini 3 Pro | **Yes** — auto-switches |
| **Atlas** | Todo orchestrator | **Kimi K2.5** → Kimi K2.5 Free → Sonnet → GPT-5.2 | **Yes** — auto-switches |
| **Oracle** | Architecture/debugging | GPT-5.2 (high) → Gemini 3 Pro (high) → Opus (max) | No |
| **Metis** | Plan review consultant | Opus (max) → Kimi K2.5 → Kimi K2.5 Free → GPT-5.2 (high) → Gemini 3 Pro (high) | No |
| **Momus** | High-accuracy reviewer | GPT-5.2 (medium) → Opus (max) → Gemini 3 Pro (high) | No |

### Utility Agents

| Agent | Role | Fallback Chain (in order) | Design Rationale |
|-------|------|---------------------------|------------------|
| **Explore** | Fast codebase grep | Grok Code Fast 1 → **MiniMax M2.5 Free** → Haiku → GPT-5-Nano | Speed over intelligence. Grok Code is fastest for grep-style work. MiniMax Free as cheap fallback. |
| **Librarian** | Docs/code search | **MiniMax M2.5 Free** → Gemini 3 Flash → Big Pickle | Entirely free-tier chain. Doc retrieval doesn't need Opus-level reasoning. |
| **Multimodal Looker** | Vision/screenshots | **Kimi K2.5** → Kimi K2.5 Free → Gemini 3 Flash → GPT-5.2 → GLM-4.6v | Kimi excels at multimodal. Gemini Flash as lightweight vision fallback. |

### Task Categories

Categories are used for `background_task` and `delegate_task` dispatching:

| Category | Purpose | Fallback Chain | Notes |
|----------|---------|----------------|-------|
| `visual-engineering` | Frontend/UI work | Gemini 3 Pro (high) → GLM 5 → Opus (max) → Kimi K2.5 | Gemini excels at visual tasks |
| `ultrabrain` | Maximum intelligence | GPT-5.3-codex (xhigh) → Gemini 3 Pro (high) → Opus (max) | Highest reasoning variant |
| `deep` | Deep coding | GPT-5.3-codex (medium) → Opus (max) → Gemini 3 Pro (high) | Requires GPT availability |
| `artistry` | Creative/design | Gemini 3 Pro (high) → Opus (max) → GPT-5.2 | Requires Gemini availability |
| `quick` | Fast simple tasks | Haiku → Gemini 3 Flash → GPT-5-Nano | Cheapest, fastest |
| `unspecified-high` | General high-quality | Opus (max) → GPT-5.2 (high) → Gemini 3 Pro | Default for complex tasks |
| `unspecified-low` | General standard | Sonnet → GPT-5.3-codex (medium) → Gemini 3 Flash | Default for standard tasks |
| `writing` | Text/docs | **Kimi K2.5** → Gemini 3 Flash → Sonnet | Kimi produces best prose quality |

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
| **Librarian** | MiniMax M2.5 Free | Gemini 3 Flash, Big Pickle, any lightweight model |
| **Explore** | Grok Code Fast 1 | MiniMax M2.5 Free, Haiku, GPT-5-Nano — speed is key |

### Dangerous Substitutions (cross-family without prompt support)

| Agent | Dangerous Override | Why |
|-------|-------------------|-----|
| **Sisyphus** → GPT | No GPT-optimized prompt exists. Sisyphus is deeply tuned for Claude-style reasoning. Performance drops dramatically. |
| **Hephaestus** → Claude | Hephaestus is purpose-built for GPT's Codex capabilities. Claude cannot replicate this. |
| **Explore** → Opus | Massive overkill and cost waste. Explore needs speed, not intelligence. |
| **Librarian** → Opus | Same — doc retrieval is a search task, not a reasoning task. Opus is wasted here. |

### Explaining to Users

When a user asks about model configuration, explain:

1. **The default works out of the box** — the installer configures optimal models based on their subscriptions
2. **Each agent has a "home" model family** — Sisyphus is Claude-native, Hephaestus is GPT-native
3. **Some agents auto-adapt** — Prometheus and Atlas detect GPT models and switch to optimized prompts
4. **Cross-family overrides are risky** — unless the agent has a dedicated prompt for that family
5. **Cost optimization is valid** — swapping Opus → Sonnet or Kimi K2.5 for Sisyphus saves money with acceptable quality trade-off
6. **Utility agents are intentionally cheap** — Librarian and Explore use free-tier models by design. Don't "upgrade" them to Opus thinking it'll help — it just wastes tokens on simple search tasks
7. **Kimi K2.5 is a versatile workhorse** — it appears as primary for Atlas (orchestration), Multimodal Looker (vision), and writing tasks. It's consistently good across these roles without being expensive.
8. **Point to this guide** for the full fallback chains and rationale

---

## Provider Priority

When multiple providers are available, oh-my-opencode prefers:

```
Native (anthropic/, openai/, google/) > Kimi for Coding > GitHub Copilot > OpenCode Zen > Z.ai Coding Plan
```

Each fallback chain entry specifies which providers can serve that model. The system picks the first entry where at least one provider is connected.

**Notable provider mappings:**
- `venice` — alternative provider for Grok Code Fast 1 (Explore agent)
- `opencode` — serves free-tier models (Kimi K2.5 Free, MiniMax M2.5 Free, Big Pickle, GPT-5-Nano) and premium models via OpenCode Zen
- `zai-coding-plan` — GLM 5 and GLM-4.6v models

---

## Quick Decision Tree for Users

```
What subscriptions do you have?

├── Claude (Anthropic) → Sisyphus works optimally. Prometheus/Metis use Claude prompts.
├── OpenAI/ChatGPT → Hephaestus unlocked. Oracle/Momus use GPT. Prometheus auto-switches.
├── Both Claude + OpenAI → Full agent roster. Best experience.
├── Gemini only → Visual-engineering category excels. Other agents use Gemini as fallback.
├── Kimi for Coding → Atlas, Multimodal Looker, writing tasks work great. Sisyphus usable.
├── GitHub Copilot only → Works as fallback provider for all model families.
├── OpenCode Zen only → Free-tier access. Librarian/Explore work perfectly. Core agents functional but rate-limited.
└── No subscription → Limited functionality. Consider OpenCode Zen (free).

For each user scenario, the installer (`bunx oh-my-opencode install`) auto-configures the optimal assignment.
```

---

## See Also

- [Installation Guide](./installation.md) — Setup with subscription-based model configuration
- [Configuration Reference](../configurations.md) — Full config options including agent overrides
- [Overview](./overview.md) — How the agent system works
- [`src/shared/model-requirements.ts`](../../src/shared/model-requirements.ts) — Source of truth for fallback chains
