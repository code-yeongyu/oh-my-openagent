# src/ — Plugin Source

**Generated:** 2026-02-24

## OVERVIEW

Root source directory. Entry point `index.ts` orchestrates 4-step initialization: config → managers → tools → hooks → plugin interface.

## KEY FILES

| File | Purpose |
|------|---------|
| `index.ts` | Plugin entry, exports `OhMyOpenCodePlugin` |
| `plugin-config.ts` | JSONC parse, multi-level merge (user → project → defaults), Zod validation |
| `create-managers.ts` | TmuxSessionManager, BackgroundManager, SkillMcpManager, ConfigHandler |
| `create-tools.ts` | SkillContext + AvailableCategories + ToolRegistry |
| `create-hooks.ts` | 3-tier hook composition: Core(37) + Continuation(7) + Skill(2) |
| `plugin-interface.ts` | Assembles 8 OpenCode hook handlers into PluginInterface |

## CONFIG LOADING

```
loadPluginConfig(directory, ctx)
  1. User: ~/.config/opencode/oh-my-opencode.jsonc
  2. Project: .opencode/oh-my-opencode.jsonc
  3. mergeConfigs(user, project) → deepMerge for agents/categories, Set union for disabled_*
  4. Zod safeParse → defaults for omitted fields
  5. migrateConfigFile() → legacy key transformation
```

## HOOK COMPOSITION

```
createHooks()
  ├─→ createCoreHooks()           # 37 hooks
  │   ├─ createSessionHooks()     # 23: contextWindowMonitor, thinkMode, ralphLoop, modelFallback, runtimeFallback, noSisyphusGpt, noHephaestusNonGpt, anthropicEffort...
  │   ├─ createToolGuardHooks()   # 10: commentChecker, rulesInjector, writeExistingFileGuard, jsonErrorRecovery, hashlineReadEnhancer...
  │   └─ createTransformHooks()   # 4: claudeCodeHooks, keywordDetector, contextInjector, thinkingBlockValidator
  ├─→ createContinuationHooks()   # 7: todoContinuationEnforcer, atlas, stopContinuationGuard...
  └─→ createSkillHooks()          # 2: categorySkillReminder, autoSlashCommand
```
