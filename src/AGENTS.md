# SRC KNOWLEDGE BASE

## OVERVIEW

Main plugin entry point and orchestration layer. Plugin initialization, hook registration, tool composition, and lifecycle management.

## STRUCTURE
```
src/
├── index.ts                          # Main plugin entry (88 lines) — OhMyOpenCodePlugin factory
├── create-hooks.ts                   # Hook coordination: core, continuation, skill (62 lines)
├── create-managers.ts                # Manager initialization: Tmux, Background, SkillMcp, Config (80 lines)
├── create-tools.ts                   # Tool registry + skill context composition (54 lines)
├── plugin-interface.ts               # Plugin interface assembly — 7 OpenCode hooks (66 lines)
├── plugin-config.ts                  # Config loading orchestration (user + project merge)
├── plugin-state.ts                   # Model cache state (context limits, anthropic 1M flag)
├── agents/                           # 11 AI agents (32 files) - see agents/AGENTS.md
├── cli/                              # CLI installer, doctor (107+ files) - see cli/AGENTS.md
├── config/                           # Zod schema (21 component files) - see config/AGENTS.md
├── features/                         # Background agents, skills, commands (18 dirs) - see features/AGENTS.md
├── hooks/                            # 41 lifecycle hooks (36 dirs) - see hooks/AGENTS.md
├── mcp/                              # Built-in MCPs (6 files) - see mcp/AGENTS.md
├── plugin/                           # Plugin interface composition (21 files)
├── plugin-handlers/                  # Config loading, plan inheritance (15 files) - see plugin-handlers/AGENTS.md
├── shared/                           # Cross-cutting utilities (84 files) - see shared/AGENTS.md
└── tools/                            # 25+ tools (14 dirs) - see tools/AGENTS.md
```

## PLUGIN INITIALIZATION (10 steps)

1. `injectServerAuthIntoClient(ctx.client)` — Auth injection
2. `startTmuxCheck()` — Tmux availability
3. `loadPluginConfig(ctx.directory, ctx)` — User + project config merge → Zod validation
4. `createFirstMessageVariantGate()` — First message variant override gate
5. `createModelCacheState()` — Model context limits cache
6. `createManagers(...)` → 4 managers:
   - `TmuxSessionManager` — Multi-pane tmux sessions
   - `BackgroundManager` — Parallel subagent execution
   - `SkillMcpManager` — MCP server lifecycle
   - `ConfigHandler` — Plugin config API to OpenCode
7. `createTools(...)` → `createSkillContext()` + `createAvailableCategories()` + `createToolRegistry()`
8. `createHooks(...)` → `createCoreHooks()` + `createContinuationHooks()` + `createSkillHooks()`
9. `createPluginInterface(...)` → 7 OpenCode hook handlers
10. Return plugin with `experimental.session.compacting`

## HOOK REGISTRATION (3 tiers)

**Core Hooks** (`create-core-hooks.ts`):
- Session (20): context-window-monitor, session-recovery, think-mode, ralph-loop, anthropic-effort, ...
- Tool Guard (8): comment-checker, tool-output-truncator, rules-injector, write-existing-file-guard, ...
- Transform (4): claude-code-hooks, keyword-detector, context-injector, thinking-block-validator

**Continuation Hooks** (`create-continuation-hooks.ts`):
- 7 hooks: stop-continuation-guard, compaction-context-injector, todo-continuation-enforcer, atlas, ...

**Skill Hooks** (`create-skill-hooks.ts`):
- 2 hooks: category-skill-reminder, auto-slash-command

## PLUGIN INTERFACE (7 OpenCode handlers)

| Handler | Source | Purpose |
|---------|--------|---------|
| `tool` | filteredTools | All registered tools |
| `chat.params` | createChatParamsHandler | Anthropic effort level |
| `chat.message` | createChatMessageHandler | First message variant, session setup |
| `experimental.chat.messages.transform` | createMessagesTransformHandler | Context injection, keyword detection |
| `config` | configHandler | Agent/MCP/command registration |
| `event` | createEventHandler | Session lifecycle |
| `tool.execute.before` | createToolExecuteBeforeHandler | Pre-tool hooks |
| `tool.execute.after` | createToolExecuteAfterHandler | Post-tool hooks |

## SAFE HOOK CREATION PATTERN

```typescript
const hook = isHookEnabled("hook-name")
  ? safeCreateHook("hook-name", () => createHookFactory(ctx), { enabled: safeHookEnabled })
  : null;
```

All hooks use this pattern for graceful degradation on failure.
