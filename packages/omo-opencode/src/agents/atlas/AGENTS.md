---
name: atlas-agent
description: Developer reference for the Atlas todo-list orchestrator agent -- model variants, prompt sections, and routing.
---

# src/agents/atlas/ -- Todo-List Orchestrator

**Generated:** 2026-05-18

## OVERVIEW

5 TypeScript files plus 8 markdown prompt variants in `packages/prompts-core/prompts/atlas/`. Atlas agent -- todo-list orchestrator that delegates via `task()` to complete every checkbox in a plan until fully done. Mode `primary`. Color `#10B981`.

## FILES

| File | Purpose |
|------|---------|
| `agent.ts` | `createAtlasAgent()` factory, prompts-core variant loading, runtime placeholder injection, `OrchestratorContext` |
| `index.ts` | Barrel exports |
| `prompt-section-builder.ts` | Composes category, agent, skills, and decision matrix sections |
| `prompt-runtime-injection.test.ts` | Runtime placeholder-resolution regression tests |
| `prompt-routing.test.ts` | Model-variant routing tests |
| `packages/prompts-core/prompts/atlas/default.md` | Default base variant (DeepSeek/Grok/Haiku fragments derive from it) |
| `packages/prompts-core/prompts/atlas/gpt.md` | GPT-family base variant (dotted GPT presets derive from it) |
| `packages/prompts-core/prompts/atlas/gemini.md` | Gemini-family markdown prompt variant |
| `packages/prompts-core/prompts/atlas/kimi.md` | Kimi K2.x base variant (K2.6/K2.8 derive from it) |
| `packages/prompts-core/prompts/atlas/kimi-k2-7.md` | Kimi K2.7 markdown prompt variant |
| `packages/prompts-core/prompts/atlas/kimi-k3.md` | Kimi K3-native base variant (swe-2 shares it) |
| `packages/prompts-core/prompts/atlas/glm.md` | GLM-family base variant (GLM 5.2/5.3 derive from it) |
| `packages/prompts-core/prompts/atlas/opus-4-*.md`, `opus-5*.md`, `fable-5*.md`, `sonnet-5-5.md` | Anthropic-family authored variants |

## MODEL VARIANT ROUTING

Parent `agent.ts` calls `resolveVariant()` from `@oh-my-opencode/prompts-core` against `atlasPromptVariants`. The variant table and its routing contract live in `packages/prompts-core/src/atlas-preset-contract.ts` (issue #9851): every runtime preset maps to an Atlas variant built from one authored base per family plus a template/fragment derivation — there are no hand-copied per-model files. Resolution is by explicit matcher specificity, dotted-exact before generic (Opus 5.5 before Opus 5, Fable 5.1 before Fable 5, K2.8 before K2.7 before generic kimi), not table order; unknown models fall back to `default.md`.

`packages/prompts-core/src/runtime-preset-parity.test.ts` drives `RUNTIME_PRESET_MODEL_CASES` through `resolveVariant` and asserts each id resolves to its dedicated variant (never `default`), so a routing change that drops a model to the generic prompt fails the suite.

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
- Default model: `claude-sonnet-5`
- Denied tools: `task`, `call_omo_agent` (Atlas delegates; it does not run subagents directly)
- Checkbox enforcement in prompts
- Auto-continue: never asks user for approval between plan steps
- Parallel fan-out by default; sequential only for named blocking dependencies
- Post-delegation rule: edit plan checkbox, read plan to confirm, then dispatch next task
- Registered via `createAtlasAgent` in `src/agents/builtin-agents/atlas-agent.ts`
- Markdown prompts are imported with Bun's `.md` text loader so Atlas prompt content is bundled into `dist/index.js`.
