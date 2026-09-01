---
name: builtin-agents-factory-layer
description: Conditional factory wrappers that apply overrides, model resolution, skill filtering, and provider gating to the 11 agent definitions.
---

# src/agents/builtin-agents/ -- Conditional Factory Layer

**Generated:** 2026-05-18

## OVERVIEW

Conditional factory layer beneath the 11 raw `createXXXAgent` factories in `src/agents/`. Each `maybeCreateXXXConfig` wrapper decides whether an agent registers, resolves its model via the 4-step pipeline, applies user overrides, filters skills, and returns the final `AgentConfig` -- or `undefined` if the agent is disabled or requirements are not met. Outputs feed `createPluginInterface`.

## FILE CATALOG

| File | Purpose |
|------|---------|
| `agent-overrides.ts` | Applies user overrides: category expansion, `deepMerge` of model/temp/prompt/permissions, `file://` prompt resolution |
| `model-resolution.ts` | 4-step pipeline wrapper: `resolveModelPipeline` (override → category → provider fallback → system default) + `getFirstFallbackModel` |
| `resolve-file-uri.ts` | Converts `file://` paths to absolute paths, bounds them to project root, reads content for prompt append |
| `resolve-file-uri.test.ts` | Tests for URI decoding, path expansion, project-root bounds, missing-file handling |
| `environment-context.ts` | Appends `createEnvContext()` block to agent prompt unless `disableOmoEnv` is set |
| `available-skills.ts` | `buildAvailableSkills` -- merges builtin skills with discovered user skills, filters disabled |
| `available-skills.test.ts` | Tests for builtin + discovered skill merging and disabled filtering |
| `sisyphus-agent.ts` | `maybeCreateSisyphusConfig` -- checks disabled list, model requirements, applies overrides + frontier tool schema guard + GPT patch guard |
| `sisyphus-agent.test.ts` | Tests for disabled-agent filtering, model resolution, override application, first-run fallback behavior |
| `hephaestus-agent.ts` | `maybeCreateHephaestusConfig` -- provider gating (`requiresProvider`), category override support, variant defaulting to medium |
| `atlas-agent.ts` | `maybeCreateAtlasConfig` -- UI-selected model respect, variant resolution |
| `general-agents.ts` | `collectPendingBuiltinAgents` -- handles all non-special-cased agents (skips sisyphus/hephaestus/atlas/sisyphus-junior), bulk model resolution and override application |

## PIPELINE FIT

Phase 3 of `plugin-handlers/config-handler.ts` invokes these factories. The resulting `AgentConfig` array feeds `createPluginInterface`. Returns `undefined` for disabled agents or unmet model requirements.
