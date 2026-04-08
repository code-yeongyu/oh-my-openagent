# src/ — Plugin Source

**Generated:** 2026-04-05

## OVERVIEW

Entry point `index.ts` orchestrates 5-step initialization: loadConfig → createManagers → createTools → createHooks → createPluginInterface.

## KEY FILES

| File | Purpose |
|------|---------|
| `index.ts` | Plugin entry, exports `OhMyOpenCodePlugin` |
| `plugin-config.ts` | JSONC parse, multi-level merge, Zod v4 validation |
| `create-managers.ts` | TmuxSessionManager, BackgroundManager, SkillMcpManager, ConfigHandler |
| `create-tools.ts` | SkillContext + AvailableCategories + ToolRegistry (26 tools) |
| `create-hooks.ts` | 3-tier: Core(43) + Continuation(7) + Skill(2) = 52 hooks |
| `plugin-interface.ts` | 10 OpenCode hook handlers: config, tool, chat.message, chat.params, chat.headers, event, tool.execute.before, tool.execute.after, experimental.chat.messages.transform, experimental.session.compacting |

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
  ├─→ createCoreHooks()           # 43 hooks
  │   ├─ createSessionHooks()     # 24: contextWindowMonitor, thinkMode, ralphLoop, modelFallback, runtimeFallback, noSisyphusGpt, noHephaestusNonGpt, anthropicEffort, intentGate, legacyPluginToast...
  │   ├─ createToolGuardHooks()   # 14: commentChecker, rulesInjector, writeExistingFileGuard, jsonErrorRecovery, hashlineReadEnhancer, bashFileReadGuard, readImageResizer, todoDescriptionOverride, webfetchRedirectGuard...
  │   └─ createTransformHooks()   # 5: claudeCodeHooks, keywordDetector, contextInjector, thinkingBlockValidator, toolPairValidator
  ├─→ createContinuationHooks()   # 7: todoContinuationEnforcer, atlas, stopContinuationGuard, compactionContextInjector...
  └─→ createSkillHooks()          # 2: categorySkillReminder, autoSlashCommand
```
