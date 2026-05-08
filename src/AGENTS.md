# src/ — Plugin Source

**Generated:** 2026-05-08

## OVERVIEW

Entry `index.ts` orchestrates a 7-step initialization. Total: 1304 source files + 663 tests across the directories below. Cross-cutting helpers live in `shared/`; module boundaries are established by 120 barrel `index.ts` files.

## KEY FILES

| File | Purpose |
|------|---------|
| `index.ts` | Plugin entry; default-exports `pluginModule: PluginModule` with `{ id, server }` |
| `plugin-config.ts` | JSONC parse, multi-level merge (user + walked project), Zod v4 validation, migration |
| `plugin-state.ts` | `createModelCacheState()` — model resolution cache shared across handlers |
| `plugin-interface.ts` | 10 OpenCode hook handlers wired into `Hooks` |
| `create-managers.ts` | TmuxSessionManager, BackgroundManager, SkillMcpManager, ConfigHandler |
| `create-tools.ts` | SkillContext + AvailableCategories + ToolRegistry composition |
| `create-hooks.ts` | 5-tier composition: `createCoreHooks() + createContinuationHooks() + createSkillHooks()` |
| `create-runtime-tmux-config.ts` | `isTmuxIntegrationEnabled()` + `createRuntimeTmuxConfig()` |

## INITIALIZATION (7 STEPS)

```
serverPlugin(input, options)
  1. installAgentSortShim()        # patches Array.prototype.{toSorted,sort} for canonical agent ordering
  2. initConfigContext()           # detects opencode-vs-openagent config layout
  3. detectExternalSkillPlugin()   # warn if conflicting plugin loaded
  4. injectServerAuthIntoClient()  # wire auth headers into shared SDK client
  5. loadPluginConfig()            # walk project + user JSONC → Zod safeParse → migrate
  6. initializeOpenClaw()          # if openclaw config present (start reply-listener daemon)
  6. checkTeamModeDependencies()   # if team_mode.enabled (verify git, tmux, ensure ~/.omo/teams/)
  7. createManagers/Tools/Hooks/PluginInterface
```

## CONFIG LOADING (Phase pipeline)

```
loadPluginConfig(directory, ctx)
  1. User: ~/.config/opencode/oh-my-openagent.jsonc (legacy: oh-my-opencode.jsonc)
  2. Walked configs: <pwd up to $HOME>/.opencode/oh-my-openagent.jsonc
  3. mergeConfigs(user, walked)
     - agents/categories/claude_code: deepMerge (recursive, prototype-pollution safe)
     - disabled_*: Set union
     - mcp_env_allowlist: user-only (security)
     - others: override replaces
  4. Zod safeParse → defaults for omitted fields
  5. migrateConfigFile() → idempotent via _migrations tracking + timestamped backups
```

## HOOK COMPOSITION (5-tier)

```
createHooks()
  ├─→ createCoreHooks()
  │   ├─ createSessionHooks()     # 24: contextWindowMonitor, thinkMode, ralphLoop, modelFallback,
  │   │                             runtimeFallback, anthropicEffort, anthropicContextWindowLimitRecovery,
  │   │                             autoUpdateChecker, agentUsageReminder, nonInteractiveEnv,
  │   │                             interactiveBashSession, editErrorRecovery, delegateTaskRetry,
  │   │                             startWork, prometheusMdOnly, sisyphusJuniorNotepad,
  │   │                             questionLabelTruncator, taskResumeInfo, noSisyphusGpt,
  │   │                             noHephaestusNonGpt, legacyPluginToast, sessionRecovery,
  │   │                             sessionNotification, preemptiveCompaction
  │   ├─ createToolGuardHooks()   # 14: commentChecker, toolOutputTruncator, directoryAgentsInjector,
  │   │                             directoryReadmeInjector, emptyTaskResponseDetector, rulesInjector,
  │   │                             tasksTodowriteDisabler, writeExistingFileGuard, bashFileReadGuard,
  │   │                             readImageResizer, todoDescriptionOverride, webfetchRedirectGuard,
  │   │                             hashlineReadEnhancer, jsonErrorRecovery
  │   └─ createTransformHooks()   # 5: claudeCodeHooks, keywordDetector, contextInjectorMessagesTransform,
  │                                  thinkingBlockValidator, toolPairValidator
  ├─→ createContinuationHooks()   # 7: stopContinuationGuard, compactionContextInjector,
  │                                  compactionTodoPreserver, todoContinuationEnforcer (boulder),
  │                                  unstableAgentBabysitter, backgroundNotificationHook, atlasHook
  └─→ createSkillHooks()          # 2: categorySkillReminder, autoSlashCommand
```

Each tier produces an array of `(input, output) => void` handlers; the matching OpenCode handler iterates and calls each in registration order.

## SUBSYSTEM INVENTORY

| Subdir | Files (.ts) | LOC | Purpose | Has AGENTS.md |
|--------|-------------|-----|---------|---------------|
| `agents/` | 96 | 19,042 | 11 agent factories + dynamic prompt builder | yes |
| `hooks/` | 570 | 73,515 | ~50 lifecycle hooks across 57 dirs | yes |
| `tools/` | 306 | 43,348 | 16 tool dirs producing 20–39 tools | yes |
| `features/` | 389 | 68,410 | 20 feature modules (team-mode, background-agent, etc.) | yes |
| `shared/` | 258 | 30,416 | Cross-cutting utilities, barrel-exported | yes |
| `cli/` | 150 | 16,975 | Commander.js CLI: install, run, doctor, mcp-oauth | yes |
| `plugin/` | 55 | 11,756 | 10 OpenCode hook handlers + hook composition | yes |
| `config/` | 41 | 2,282 | 32 Zod v4 schema files | yes |
| `plugin-handlers/` | 27 | 5,791 | 6-phase config loading pipeline | yes |
| `openclaw/` | 26 | 3,291 | Bidirectional Discord/Telegram/HTTP integration | yes |
| `__tests__/` | 22 | 274 | Plugin-level integration tests + perf fixtures | — |
| `mcp/` | 7 | 205 | 3 built-in remote MCPs | yes |
| `testing/` | 2 | 225 | Test utilities | — |

## NOTES

- `plugin-interface.ts` is the **only** layer that talks to OpenCode's `Plugin` API. Every other file goes through it.
- Reach for `shared/` before adding helpers anywhere else — duplicate utilities WILL be flagged in review.
- Path aliases are forbidden. Use relative imports within a module, barrel imports across modules.
