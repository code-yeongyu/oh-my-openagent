---
name: hephaestus-agent
description: Developer reference for the Hephaestus autonomous deep worker agent - model variants and key behaviors.
---

# src/agents/hephaestus/ -- Autonomous Deep Worker

**Generated:** 2026-05-15

## OVERVIEW

6 files. Hephaestus agent -- autonomous deep worker with GPT-5.4, GPT-5.5, GPT-5.6, and base-prompt variants. Goal-oriented: give it objectives, not step-by-step instructions. "The Legitimate Craftsman."

## FILES

| File | Purpose |
|------|---------|
| `agent.ts` | `createHephaestusAgent()` factory, model-variant routing |
| `gpt.ts` | Base GPT prompt: discipline rules and verification |
| `gpt-5-6.ts` | GPT-5.6-native outcome-first prompt |
| `gpt-5-5.ts` | GPT-5.5-native prompt with task discipline sections |
| `gpt-5-4.ts` | GPT-5.4-native prompt with XML-tagged blocks, entropy-reduced |
| `index.ts` | Barrel exports |

## KEY BEHAVIORS

- Mode: `primary` (respects UI model selection)
- Requires OpenAI-compatible provider (no fallback chain)
- Spawn tools `task`, `call_omo_agent`, and `look_at` are denied
- Executes assigned goals directly without delegation

## MODEL VARIANTS

| Model | Prompt Source | Optimizations |
|-------|-------------|---------------|
| gpt-5.6 | `gpt-5-6.ts` | Outcome-first, manual-QA-focused prompt |
| gpt-5.5 | `gpt-5-5.ts` | Task discipline prompt |
| gpt-5.4 | `gpt-5-4.ts` | XML-tagged blocks, 8 sections |
| Other supported GPT | `gpt.ts` | Base prompt |
