# Agent-Model Matching Guide for Newcomers

> **Quick Reference**: Which model to use with which agent for the best results

This guide helps you match the right AI model to each oh-my-opencode agent based on real-world usage and testing.

---

## TL;DR

| Agent | Best Models | Avoid |
|-------|-------------|-------|
| **Sisyphus** | Claude Opus, Sonnet, Kimi K2.5, GLM 5 | GPT ❌ |
| **Hephaestus** | GPT-5.3-codex only | Non-GPT ❌ |
| **Prometheus** | Claude Opus | GPT (untested) |
| **Atlas** | Kimi K2.5, Claude Sonnet, GPT-5.2+ | — |

---

## Detailed Breakdown

### Sisyphus (ultraworker)
**Purpose**: Primary orchestrator for complex multi-step tasks

**Recommended Models** (in order of preference):
1. **Claude Opus-4-6** — The best overall performance
2. **Claude Sonnet-4-6** — Satisfiable, often better than pure Claude Code + Opus
3. **Kimi K2.5** — Good for broad tasks, excellent cost-performance
4. **GLM 5** — Good for various tasks, not as capable on broad tasks as Kimi
5. **MiniMax** — Budget option when cost matters

**⚠️ NEVER USE GPT** — Sisyphus is optimized for Claude-style models and performs poorly on GPT.

**Configuration Example**:
```json
{
  "agent": {
    "sisyphus": {
      "model": "anthropic/claude-opus-4-6",
      "variant": "max"
    }
  }
}
```

---

### Hephaestus (deep worker)
**Purpose**: Deep coding tasks requiring extensive reasoning

**Required Model**: **GPT-5.3-codex** (always)

Think of Hephaestus as "Codex on steroids" — it's specifically designed and tuned for GPT models.

**⚠️ DO NOT USE** if you don't have GPT access. DeepSeek *might* work but is not officially supported.

**Configuration Example**:
```json
{
  "agent": {
    "hephaestus": {
      "model": "openai/gpt-5.3-codex",
      "variant": "medium"
    }
  }
}
```

---

### Prometheus (planner)
**Purpose**: Strategic planning and work plan generation

**Recommended Model**: **Claude Opus-4-6** (strongly recommended)

Prometheus is optimized for Claude's reasoning capabilities. GPT compatibility is not yet tested but may be evaluated in the future.

**Configuration Example**:
```json
{
  "agent": {
    "plan": {
      "model": "anthropic/claude-opus-4-6",
      "variant": "max"
    }
  }
}
```

---

### Atlas (orchestrator)
**Purpose**: Todo list orchestration and multi-agent coordination

**Recommended Models** (in order of preference):
1. **Kimi K2.5** — Best for Atlas orchestration
2. **Claude Sonnet-4-6** — Strong alternative
3. **GPT-5.2+** — Good enough, has GPT-optimized prompt

Atlas has model-specific prompt detection and will automatically use GPT-optimized instructions when running on GPT models.

**Configuration Example**:
```json
{
  "agent": {
    "atlas": {
      "model": "kimi/kimi-k2.5"
    }
  }
}
```

---

## Quick Decision Tree

```
Do you have GPT access?
├── YES → Use Hephaestus for deep coding, Atlas for orchestration
└── NO  → Use Sisyphus (Claude/Kimi/GLM) for all tasks

Need planning/strategy?
├── YES → Use Prometheus (Claude Opus recommended)
└── NO  → Skip Prometheus, use other agents directly

Complex multi-step task?
├── YES → Use Sisyphus (Claude-family models)
└── NO  → Use category-specific agents or Hephaestus
```

---

## Common Pitfalls to Avoid

1. **Don't use GPT with Sisyphus** — Performance will be subpar
2. **Don't use non-GPT with Hephaestus** — It's specifically built for GPT
3. **Don't force Prometheus on GPT** — It's untested; use Claude for now
4. **Don't overthink Atlas** — It adapts automatically to your model

---

## Model Fallback Chains (Default Behavior)

The system will automatically fall back through these chains if your preferred model is unavailable:

**Sisyphus**: Opus → Kimi K2.5 → GLM 4.7 → Big Pickle
**Hephaestus**: GPT-5.3-codex only (no fallback)
**Prometheus**: Opus → Kimi K2.5 → GLM 4.7 → GPT-5.2 → Gemini 3 Pro
**Atlas**: Kimi K2.5 → GLM 4.7 → Opus → GPT-5.2 → Gemini 3 Pro

---

## Tips for Newcomers

- **Start with Sisyphus + Claude Opus** for general tasks
- **Use Hephaestus when you need deep reasoning** (requires GPT)
- **Try GLM 5 or Kimi K2.5** for cost-effective alternatives to Claude
- **Check the model requirements** in your config to avoid mismatches
- **Use `variant: "max"` or `variant: "high"`** for best results on capable models

---

## See Also

- [AGENTS.md](../AGENTS.md) — Full agent documentation
- [configurations.md](./configurations.md) — Configuration reference
- [orchestration-guide.md](./orchestration-guide.md) — How orchestration works
