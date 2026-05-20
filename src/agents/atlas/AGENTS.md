---
name: atlas-agent
description: Developer reference for the Atlas todo-list orchestrator agent -- model variants, prompt sections, and routing.
---

# src/agents/atlas/ -- Todo-List Orchestrator

**Generated:** 2026-05-18

## OVERVIEW

17 files. Atlas agent -- todo-list orchestrator that delegates via `task()` to complete every checkbox in a plan until fully done. Mode `primary`. Color `#10B981`.

## FILES

| File | Purpose |
|------|---------|
| `agent.ts` | `createAtlasAgent()` factory, model-variant routing, `OrchestratorContext` |
| `index.ts` | Barrel exports |
| `default.ts` | Default/Claude prompt variant |
| `gemini.ts` | Gemini-optimized prompt variant |
| `gpt.ts` | GPT-optimized prompt variant |
| `kimi.ts` | Kimi K2.x prompt variant |
| `opus-4-7.ts` | Claude Opus 4.7 prompt variant |
| `default-prompt-sections.ts` | Default prompt section definitions |
| `gemini-prompt-sections.ts` | Gemini prompt section definitions |
| `gpt-prompt-sections.ts` | GPT prompt section definitions |
| `kimi-prompt-sections.ts` | Kimi prompt section definitions |
| `opus-4-7-prompt-sections.ts` | Opus 4.7 prompt section definitions |
| `prompt-section-builder.ts` | Composes category, agent, skills, and decision matrix sections |
| `shared-prompt.ts` | Shared prompt content: delegation system, parallel rules, auto-continue, notepad protocol, post-delegation rule, boulder completion |
| `atlas-prompt.test.ts` | Prompt composition tests |
| `prompt-checkbox-enforcement.test.ts` | Checkbox enforcement behavior tests |
| `prompt-routing.test.ts` | Model-variant routing tests |

## MODEL VARIANT ROUTING

Parent `agent.ts` selects variant by model name:
- `isGptModel()` -> `gpt.ts`
- `isGeminiModel()` -> `gemini.ts`
- `isKimiK2Model()` -> `kimi.ts`
- `isClaudeOpus47Model()` -> `opus-4-7.ts`
- Default -> `default.ts` (Claude 4.6 family)

## KEY BEHAVIORS

- Mode: `primary` (respects UI model selection)
- Temperature: 0.1
- Default model: `claude-sonnet-4-6`
- Denied tools: `task`, `call_omo_agent` (Atlas delegates; it does not run subagents directly)
- Checkbox enforcement in prompts (per `prompt-checkbox-enforcement.test.ts`)
- Auto-continue: never asks user for approval between plan steps
- Parallel fan-out by default; sequential only for named blocking dependencies
- Post-delegation rule: edit plan checkbox, read plan to confirm, then dispatch next task
- Registered via `createAtlasAgent` in `src/agents/builtin-agents/atlas-agent.ts`
