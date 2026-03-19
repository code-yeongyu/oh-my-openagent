# src/ — Plugin Source

**Generated:** 2026-03-06

## OVERVIEW

Entry point `index.ts` orchestrates 5-step initialization: loadConfig → createManagers → createTools → createHooks → createPluginInterface.

## KEY FILES

| File | Purpose |
|------|---------|
| `index.ts` | Plugin entry, exports `OhMyOpenCodePlugin` |
| `plugin-config.ts` | JSONC parse, multi-level merge, Zod v4 validation |
| `create-managers.ts` | TmuxSessionManager, BackgroundManager, SkillMcpManager, ConfigHandler |
| `create-tools.ts` | SkillContext + AvailableCategories + ToolRegistry (26 tools) |
| `create-hooks.ts` | 3-tier: Core(39) + Continuation(7) + Skill(2) = 48 hooks |
| `plugin-interface.ts` | 8 OpenCode hook handlers: config, tool, chat.message, chat.params, chat.headers, event, tool.execute.before, tool.execute.after |

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
  │   ├─ createSessionHooks()     # 23: contextWindowMonitor, thinkMode, ralphLoop, modelFallback, runtimeFallback, noSisyphusGpt, noHephaestusNonGpt, anthropicEffort, intentGate...
  │   ├─ createToolGuardHooks()   # 10: commentChecker, rulesInjector, writeExistingFileGuard, jsonErrorRecovery, hashlineReadEnhancer...
  │   └─ createTransformHooks()   # 4: claudeCodeHooks, keywordDetector, contextInjector, thinkingBlockValidator
  ├─→ createContinuationHooks()   # 7: todoContinuationEnforcer, atlas, stopContinuationGuard, ralphLoopActivator...
  └─→ createSkillHooks()          # 2: categorySkillReminder, autoSlashCommand
```
