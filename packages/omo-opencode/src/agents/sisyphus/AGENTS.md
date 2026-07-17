---
name: sisyphus-variants
description: Developer reference for Sisyphus orchestrator model-specific prompt variants — selection logic and key exports.
---

# src/agents/sisyphus/ -- Orchestrator Variants

**Generated:** 2026-07-17

## OVERVIEW

Model-specific prompt variants for the Sisyphus main orchestrator. Parent `sisyphus-agent-factory.ts` routes to the correct variant based on active model.

## FILES

| File | Purpose |
|------|---------|
| `default.ts` | Base/Claude variant: task management, delegation guides, 542 LOC |
| `claude-opus-4-7.ts` | Opus 4.7-native: literal-instruction tuning, bounded exploration/thinking |
| `claude-opus-4-8.ts` | Opus 4.8-native: silence-default narration, small-decision autonomy, bounded exploration |
| `claude-fable-5.ts` | Fable 5-native: top-tier model, Opus 4.8 tuning direction |
| `gemini.ts` | Gemini-optimized: stricter tool-usage rules, 5 NEVER rules |
| `gpt-5-4.ts` | GPT-5.4-native: 8-block architecture, entropy-reduced, 449 LOC |
| `gpt-5-5.ts` | GPT-5.5-native: updated orchestration prompt tuned for GPT-5.5 |
| `glm-5-2.ts` | GLM-5.2-native variant with explicit failure-mode calibration |
| `kimi-k2-6.ts` | Kimi K2.6-native variant |
| `kimi-k2-7.ts` | Kimi K2.7-native variant |
| `kimi-k3.ts` | Kimi K3-native variant with explicit anti-overthinking calibration |
| `index.ts` | Barrel exports |

## VARIANT SELECTION

`sisyphus-agent-factory.ts` selects variant by model name:
- Kimi K3 -> `kimi-k3.ts`
- Kimi K2.7 -> `kimi-k2-7.ts`
- Kimi K2 family -> `kimi-k2-6.ts`
- Contains "gpt-5.5" -> `gpt-5-5.ts`
- GPT-5.4+ -> `gpt-5-4.ts`
- Contains "claude-fable-5" -> `claude-fable-5.ts`
- Contains "claude-opus-4-8" -> `claude-opus-4-8.ts`
- Contains "claude-opus-4-7" -> `claude-opus-4-7.ts`
- GLM family -> `glm-5-2.ts`
- Default -> fallback prompt (Claude, etc.; Gemini gets corrective overlays)

## KEY EXPORTS

Each variant exports:
- `buildTaskManagementSection()` -- todo/task management prompt
- `buildSisyphusPrompt()` or equivalent -- full prompt builder
