# AGENTS KNOWLEDGE BASE

## OVERVIEW

Main plugin entry point and orchestration layer. Plugin initialization, hook registration, tool composition, and lifecycle management.

**Core Responsibilities:**
- Plugin initialization via `OhMyOpenCodePlugin()` factory
- Hook registration: `createCoreHooks()`, `createContinuationHooks()`, `createSkillHooks()`
- Tool composition with filtering
- Background agent management via `BackgroundManager`
- MCP lifecycle via `SkillMcpManager`

## STRUCTURE
```
src/
├── index.ts                          # Main plugin entry (999 lines)
├── create-hooks.ts                   # Hook coordination: core, continuation, skill
├── plugin-config.ts                  # Config loading orchestration
├── plugin-state.ts                   # Model cache state
├── agents/                           # 11 AI agents (20 files) - see agents/AGENTS.md
├── cli/                              # CLI installer, doctor (100+ files) - see cli/AGENTS.md
├── config/                           # Zod schema (21 files) - see config/AGENTS.md
├── features/                         # Background agents, skills, commands (17 dirs) - see features/AGENTS.md
├── hooks/                            # 40+ lifecycle hooks (30+ dirs) - see hooks/AGENTS.md
├── mcp/                              # Built-in MCPs (8 files) - see mcp/AGENTS.md
├── plugin/                           # Plugin SDK types
├── plugin-handlers/                  # Plugin config loading (5 files) - see plugin-handlers/AGENTS.md
├── shared/                           # Cross-cutting utilities (84 files) - see shared/AGENTS.md
└── tools/                            # 25+ tools (14 dirs) - see tools/AGENTS.md
```

## KEY COMPONENTS

**Plugin Initialization:**
- `OhMyOpenCodePlugin()`: Main plugin factory
- Configuration loading via `loadPluginConfig()`
- Hook registration with safe creation patterns
- Tool composition and disabled tool filtering

**Lifecycle Management:**
- 40+ hooks: session recovery, continuation enforcers, compaction, context injection
- Background agent coordination via `BackgroundManager`
- Tmux session management for multi-pane workflows
- MCP server lifecycle via `SkillMcpManager`

**Tool Ecosystem:**
- 25+ tools: LSP, AST-grep, delegation, background tasks, skills
- Tool filtering based on agent permissions and user config
- Metadata restoration for tool outputs

## HOOK REGISTRATION

**Safe Hook Creation:**
```typescript
const hook = isHookEnabled("hook-name")
  ? safeCreateHook("hook-name", () => createHookFactory(ctx), { enabled: safeHookEnabled })
  : null;
```

**Hook Categories:**
- **Session Management**: recovery, notification, compaction
- **Continuation**: todo/task enforcers, stop guards
- **Context**: injection, rules, directory content
- **Tool Enhancement**: output truncation, error recovery
- **Agent Coordination**: usage reminders, babysitting, delegation

## TOOL COMPOSITION

```typescript
const allTools: Record<string, ToolDefinition> = {
  ...builtinTools,
  ...createGrepTools(ctx),
  ...createAstGrepTools(ctx),
  task: delegateTask,
  skill: skillTool,
};
```

**Filtering:** Agent permissions, user `disabled_tools`, session state.

## LIFECYCLE FLOW

1. User message triggers agent selection
2. Model/variant resolution applied
3. Tools execute with hook interception
4. Continuation enforcers monitor completion
5. Session compaction preserves context
