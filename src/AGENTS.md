# AGENTS KNOWLEDGE BASE

## OVERVIEW

Main plugin entry point and orchestration layer. 1000+ lines of plugin initialization, hook registration, tool composition, and lifecycle management.

**Core Responsibilities:**
- Plugin initialization and configuration loading
- 40+ lifecycle hooks orchestration  
- 25+ tools composition and filtering
- Background agent management
- Session state coordination
- MCP server lifecycle
- Tmux integration
- Claude Code compatibility layer

## STRUCTURE
```
src/
├── index.ts                          # Main plugin entry (1000 lines) - orchestration layer
├── index.compaction-model-agnostic.static.test.ts  # Compaction hook tests
├── agents/                           # 11 AI agents (16 files)
├── cli/                              # CLI commands (9 files) 
├── config/                           # Schema validation (3 files)
├── features/                         # Background features (20+ files)
├── hooks/                            # 40+ lifecycle hooks (14 files)
├── mcp/                              # MCP server configs (7 files)
├── plugin-handlers/                  # Config loading (3 files)
├── shared/                           # Utilities (70 files)
└── tools/                            # 25+ tools (15 files)
```

## KEY COMPONENTS

**Plugin Initialization:**
- `OhMyOpenCodePlugin()`: Main plugin factory (lines 124-841)
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

**Integration Points:**
- Claude Code compatibility hooks and commands
- OpenCode SDK client interactions
- Session state persistence and recovery
- Model variant resolution and application

## HOOK REGISTRATION PATTERNS

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
- **Tool Enhancement**: output truncation, error recovery, validation
- **Agent Coordination**: usage reminders, babysitting, delegation

## TOOL COMPOSITION

**Core Tools:**
```typescript
const allTools: Record<string, ToolDefinition> = {
  ...builtinTools,           // Basic file/session operations
  ...createGrepTools(ctx),   // Content search
  ...createAstGrepTools(ctx), // AST-aware refactoring
  task: delegateTask,        // Agent delegation
  skill: skillTool,          // Skill execution
  // ... 20+ more tools
};
```

**Tool Filtering:**
- Agent permission-based restrictions
- User-configured disabled tools
- Dynamic tool availability based on session state

## SESSION LIFECYCLE

**Session Events:**
- `session.created`: Initialize session state, tmux setup
- `session.deleted`: Cleanup resources, clear caches
- `message.updated`: Update agent assignments
- `session.error`: Trigger recovery mechanisms

**Continuation Flow:**
1. User message triggers agent selection
2. Model/variant resolution applied
3. Tools execute with hook interception
4. Continuation enforcers monitor completion
5. Session compaction preserves context

## CONFIGURATION INTEGRATION

**Plugin Config Loading:**
- Project + user config merging
- Schema validation via Zod
- Migration support for legacy configs
- Dynamic feature enablement

**Runtime Configuration:**
- Hook enablement based on `disabled_hooks`
- Tool filtering via `disabled_tools`
- Agent overrides and category definitions
- Experimental feature toggles

## ANTI-PATTERNS

- **Direct hook exports**: All hooks created via factories for testability
- **Global state pollution**: Session-scoped state management
- **Synchronous blocking**: Async-first architecture with background coordination
- **Tight coupling**: Plugin components communicate via events, not direct calls
- **Memory leaks**: Proper cleanup on session deletion and plugin unload
