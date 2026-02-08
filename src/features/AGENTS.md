# FEATURES KNOWLEDGE BASE

## OVERVIEW

17 feature modules: background agents, skill MCPs, builtin skills/commands, Claude Code compatibility layer, task management.

**Feature Types**: Task orchestration, Skill definitions, Command templates, Claude Code loaders, Supporting utilities

## STRUCTURE

```
features/
├── background-agent/           # Task lifecycle (1556 lines)
│   ├── manager.ts              # Launch → poll → complete
│   └── concurrency.ts          # Per-provider limits
├── builtin-skills/             # Core skills
│   └── skills/                 # playwright, agent-browser, frontend-ui-ux, git-master, dev-browser
├── builtin-commands/           # ralph-loop, refactor, ulw-loop, init-deep, start-work, cancel-ralph, stop-continuation
├── claude-code-agent-loader/   # ~/.claude/agents/*.md
├── claude-code-command-loader/ # ~/.claude/commands/*.md
├── claude-code-mcp-loader/     # .mcp.json with ${VAR} expansion
├── claude-code-plugin-loader/  # installed_plugins.json (486 lines)
├── claude-code-session-state/  # Session persistence
├── opencode-skill-loader/      # Skills from 6 directories (loader.ts 311 lines)
├── context-injector/           # AGENTS.md/README.md injection
├── boulder-state/              # Todo state persistence
├── hook-message-injector/      # Message injection
├── task-toast-manager/         # Background task notifications
├── skill-mcp-manager/          # MCP client lifecycle (640 lines)
├── tmux-subagent/              # Tmux session management (472 lines)
├── mcp-oauth/                  # MCP OAuth handling
└── claude-tasks/               # Task schema/storage - see AGENTS.md
```

## LOADER PRIORITY

| Type | Priority (highest first) |
|------|--------------------------|
| Commands | `.opencode/command/` > `~/.config/opencode/command/` > `.claude/commands/` |
| Skills | `.opencode/skills/` > `~/.config/opencode/skills/` > `.claude/skills/` |
| MCPs | `.claude/.mcp.json` > `.mcp.json` > `~/.claude/.mcp.json` |

## BACKGROUND AGENT

- **Lifecycle**: `launch` → `poll` (2s) → `complete`
- **Stability**: 3 consecutive polls = idle
- **Concurrency**: Per-provider/model limits via `ConcurrencyManager`
- **Cleanup**: 30m TTL, 3m stale timeout
- **State**: Per-session Maps, cleaned on `session.deleted`

## SKILL MCP

- **Lazy**: Clients created on first call
- **Transports**: stdio, http (SSE/Streamable)
- **Lifecycle**: 5m idle cleanup

## ANTI-PATTERNS

- **Sequential delegation**: Use `task` parallel
- **Trust self-reports**: ALWAYS verify
- **Main thread blocks**: No heavy I/O in loader init
- **Direct state mutation**: Use managers for boulder/session state
