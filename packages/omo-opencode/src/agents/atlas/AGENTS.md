---
name: atlas-agent
description: Developer reference for the Atlas todo-list orchestrator agent -- model variants, prompt sections, and routing.
---

# src/agents/atlas/ -- Todo-List Orchestrator

**Generated:** 2026-05-18

## OVERVIEW

9 TypeScript files plus 5 markdown prompt variants in `packages/prompts-core/prompts/atlas/`. Atlas agent -- todo-list orchestrator that delegates via `task()` to complete every checkbox in a plan until fully done. Mode `primary`. Color `#10B981`.

## FILES

| File | Purpose |
|------|---------|
| `agent.ts` | `createAtlasAgent()` factory, prompts-core variant loading, runtime placeholder injection, `OrchestratorContext` |
| `index.ts` | Barrel exports |
| `prompt-section-builder.ts` | Composes category, agent, skills, and decision matrix sections |
| `atlas-prompt.test.ts` | Prompt composition tests |
| `prompt-runtime-injection.test.ts` | Runtime placeholder-resolution regression tests |
| `prompt-checkbox-enforcement.test.ts` | Checkbox enforcement behavior tests |
| `prompt-routing.test.ts` | Model-variant routing tests |
| `packages/prompts-core/prompts/atlas/default.md` | Default/Claude markdown prompt variant |
| `packages/prompts-core/prompts/atlas/gpt.md` | GPT-optimized markdown prompt variant |
| `packages/prompts-core/prompts/atlas/gemini.md` | Gemini-optimized markdown prompt variant |
| `packages/prompts-core/prompts/atlas/kimi.md` | Kimi K2.x markdown prompt variant |
| `packages/prompts-core/prompts/atlas/kimi-k2-7.md` | Kimi K2.7 markdown prompt variant |
| `packages/prompts-core/prompts/atlas/kimi-k3.md` | Kimi K3-native markdown prompt variant |
| `packages/prompts-core/prompts/atlas/opus-4-7.md` | Claude Opus 4.7 markdown prompt variant |

## MODEL VARIANT ROUTING

Parent `agent.ts` calls `resolveVariant()` from `@oh-my-opencode/prompts-core` against `atlasPromptVariants`:
- GPT family -> `gpt.md`
- Gemini family -> `gemini.md`
- Kimi K3 -> `kimi-k3.md` (checked first among Kimi)
- Kimi K2.7 -> `kimi-k2-7.md`
- Kimi K2.x family -> `kimi.md`
- GLM family -> `glm.md`
- Claude Opus 4.7 -> `opus-4-7.md`
- Default -> `default.md` (Claude 4.6 family)

`atlasPromptVariants` is ordered with `opus-4-7` before `default` so the specific Claude Opus 4.7 route wins before the generic fallback.

## RUNTIME INJECTION

The markdown files keep live OpenCode sections as placeholders. `agent.ts` resolves them through `loadPrompt()` runtime injections:
- `{CATEGORY_SECTION}` -> `buildCategorySection()`
- `{AGENT_SECTION}` -> `buildAgentSelectionSection()`
- `{DECISION_MATRIX}` -> `buildDecisionMatrix()`
- `{SKILLS_SECTION}` -> `buildSkillsSection()`
- `{{CATEGORY_SKILLS_DELEGATION_GUIDE}}` -> `buildCategorySkillsDelegationGuide()`

`prompt-section-builder.ts` remains the resolver implementation in `src/` because it depends on live category, agent, and skill state.

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
- Markdown prompts are imported with Bun's `.md` text loader so Atlas prompt content is bundled into `dist/index.js`.
