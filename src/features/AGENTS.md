# FEATURES KNOWLEDGE BASE

## OVERVIEW

Background systems that extend plugin capabilities: agents, skills, Claude Code compatibility layer, MCP managers, and task orchestration.

## STRUCTURE

```
features/
├── background-agent/           # Task lifecycle, concurrency (manager.ts 1646 lines, concurrency.ts)
├── boulder-state/              # Persistent state for multi-step operations
├── builtin-commands/           # Command templates: refactor (619 lines), ralph-loop, handoff, init-deep
├── builtin-skills/             # Skills: git-master (1111 lines), playwright, dev-browser, frontend-ui-ux
├── claude-code-agent-loader/   # CC agent loading from .opencode/agents/
├── claude-code-command-loader/ # CC command loading from .opencode/commands/
├── claude-code-mcp-loader/     # CC MCP loading from .opencode/mcp/
├── claude-code-plugin-loader/  # CC plugin discovery from .opencode/plugins/
├── claude-code-session-state/  # Subagent session state tracking
├── claude-tasks/               # Task schema + storage (has own AGENTS.md)
├── context-injector/           # Auto-injects AGENTS.md, README.md, rules
├── hook-message-injector/      # System message injection
├── mcp-oauth/                  # OAuth flow for MCP servers
├── opencode-skill-loader/      # YAML frontmatter skill loading
├── skill-mcp-manager/          # MCP client lifecycle per session (manager.ts 150 lines)
├── task-toast-manager/         # Task progress notifications
├── tmux-subagent/              # Tmux integration (manager.ts 350 lines)
└── tool-metadata-store/        # Tool execution metadata caching
```

## KEY PATTERNS

**Background Agent Lifecycle:**
- Task creation -> Queue -> Concurrency check -> Execute -> Monitor -> Cleanup
- Manager.ts handles full lifecycle with 1646 lines of task orchestration
- Concurrency.ts manages parallel execution limits per provider/model
- Tasks survive session restarts via persistent storage

**Claude Code Compatibility Layer:**
5 directories provide full CC compatibility:
- agent-loader: Loads custom agents from .opencode/agents/
- command-loader: Loads slash commands from .opencode/commands/
- mcp-loader: Loads MCP servers from .opencode/mcp/
- plugin-loader: Discovers plugins from .opencode/plugins/
- session-state: Tracks subagent session state and recovery

**Skill Loading Pipeline:**
1. opencode-skill-loader: Parses YAML frontmatter from skill files
2. skill-mcp-manager: Manages MCP lifecycle per skill session (manager.ts 150 lines)
3. Context injection: Auto-loads AGENTS.md, README.md, rules into context
4. Hook message injector: Injects system messages for skill activation

## HOW TO ADD

1. Create directory under `src/features/`
2. Add `index.ts`, `types.ts`, `constants.ts` as needed
3. Export from `index.ts` following barrel pattern
4. Register in main plugin if plugin-level feature

## CHILD DOCUMENTATION

- See `claude-tasks/AGENTS.md` for task schema and storage details
