# FEATURES KNOWLEDGE BASE

## OVERVIEW

Core feature modules + Claude Code compatibility layer. Background agents, skill MCP, builtin skills/commands, 5 loaders.

## STRUCTURE

```
features/
├── background-agent/           # Task lifecycle (1335 lines)
│   ├── manager.ts              # Launch → poll → complete
│   ├── concurrency.ts          # Per-provider limits
│   └── types.ts                # BackgroundTask, LaunchInput
├── skill-mcp-manager/          # MCP client lifecycle (520 lines)
│   ├── manager.ts              # Lazy loading, cleanup
│   └── types.ts                # SkillMcpConfig
├── builtin-skills/             # Playwright, git-master, frontend-ui-ux
│   └── skills.ts               # 1203 lines
├── builtin-commands/           # ralph-loop, refactor, init-deep, start-work, remove-deadcode
│   ├── commands.ts             # Command registry
│   └── templates/              # Command templates (4 files)
├── claude-code-agent-loader/   # ~/.claude/agents/*.md
├── claude-code-command-loader/ # ~/.claude/commands/*.md
├── claude-code-mcp-loader/     # .mcp.json
├── claude-code-plugin-loader/  # installed_plugins.json
├── claude-code-session-state/  # Session persistence
├── opencode-skill-loader/      # Skills from 6 directories
├── context-injector/           # AGENTS.md/README.md injection
├── boulder-state/              # Todo state persistence
├── hook-message-injector/      # Message injection
└── task-toast-manager/         # Background task notifications
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
- **Concurrency**: Per-provider/model limits
- **Cleanup**: 30m TTL, 3m stale timeout

## SKILL MCP

- **Lazy**: Clients created on first call
- **Transports**: stdio, http (SSE/Streamable)
- **Lifecycle**: 5m idle cleanup

## ANTI-PATTERNS

- **Sequential delegation**: Use `delegate_task` parallel
- **Trust self-reports**: ALWAYS verify
- **Main thread blocks**: No heavy I/O in loader init
