# src/agents/sisyphus/ -- Orchestrator Variants

**Generated:** 2026-04-11

## OVERVIEW

4 files. Model-specific prompt variants for the Sisyphus main orchestrator. Parent `sisyphus.ts` routes to the correct variant based on active model.

## FILES

| File | Purpose |
|------|---------|
| `default.ts` | Base/Claude variant: task management, delegation guides, 542 LOC |
| `gemini.ts` | Gemini-optimized: stricter tool-usage rules, 5 NEVER rules |
| `gpt-5-4.ts` | GPT-5.4-native: 8-block architecture, entropy-reduced, 449 LOC |
| `index.ts` | Barrel exports |

## VARIANT SELECTION

Parent `sisyphus.ts` selects variant by model name:
- Contains "gemini" -> `gemini.ts`
- Contains "gpt-5.4" -> `gpt-5-4.ts`
- Default -> `default.ts` (Claude, Kimi, GLM, etc.)

## KEY EXPORTS

Each variant exports:
- `buildTaskManagementSection()` -- todo/task management prompt
- `buildSisyphusPrompt()` or equivalent -- full prompt builder
