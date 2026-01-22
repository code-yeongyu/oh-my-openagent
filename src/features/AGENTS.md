# FEATURES KNOWLEDGE BASE

## OVERVIEW

Core feature modules + Claude Code compatibility layer. Background agents, skill MCP, builtin skills/commands, and 5 loaders for Claude Code compat.

## STRUCTURE

```
features/
├── background-agent/           # Task lifecycle (1335 lines manager.ts)
│   ├── manager.ts              # Launch → poll → complete orchestration
│   ├── concurrency.ts          # Per-provider/model limits
│   └── types.ts                # BackgroundTask, LaunchInput
├── skill-mcp-manager/          # MCP client lifecycle (520 lines)
│   ├── manager.ts              # Lazy loading, idle cleanup
│   └── types.ts                # SkillMcpConfig, transports
├── builtin-skills/             # Playwright, git-master, frontend-ui-ux
│   └── skills.ts               # 1203 lines of skill definitions
├── builtin-commands/           # ralph-loop, refactor, init-deep
│   └── templates/              # Command implementations
├── claude-code-agent-loader/   # ~/.claude/agents/*.md
├── claude-code-command-loader/ # ~/.claude/commands/*.md
├── claude-code-mcp-loader/     # .mcp.json with ${VAR} expansion
├── claude-code-plugin-loader/  # installed_plugins.json
├── claude-code-session-state/  # Session state persistence
├── opencode-skill-loader/      # Skills from 6 directories (12 files)
├── context-injector/           # AGENTS.md/README.md injection
├── boulder-state/              # Todo state persistence
├── task-toast-manager/         # Toast notifications
└── hook-message-injector/      # Message injection
```

## LOADER PRIORITY

| Type | Priority (highest first) |
|------|--------------------------|
| Commands | `.opencode/command/` > `~/.config/opencode/command/` > `.claude/commands/` > `~/.claude/commands/` |
| Skills | `.opencode/skills/` > `~/.config/opencode/skills/` > `.claude/skills/` > `~/.claude/skills/` |
| Agents | `.claude/agents/` > `~/.claude/agents/` |
| MCPs | `.claude/.mcp.json` > `.mcp.json` > `~/.claude/.mcp.json` |

## BACKGROUND AGENT

- **Lifecycle**: `launch` → `poll` (2s interval) → `complete`
- **Stability**: 3 consecutive polls with same message count = idle
- **Concurrency**: Per-provider/model limits (e.g., max 3 Opus, max 10 Gemini)
- **Notification**: Batched system reminders to parent session
- **Cleanup**: 30m TTL, 3m stale timeout, signal handlers

## SKILL MCP

- **Lazy**: Clients created on first tool call
- **Transports**: stdio (local process), http (SSE/Streamable)
- **Environment**: `${VAR}` expansion in config
- **Lifecycle**: 5m idle cleanup, session-scoped

## CONFIG TOGGLES

```jsonc
{
  "claude_code": {
    "mcp": false,      // Skip .mcp.json
    "commands": false, // Skip commands/*.md
    "skills": false,   // Skip skills/*/SKILL.md
    "agents": false,   // Skip agents/*.md
    "hooks": false     // Skip settings.json hooks
  }
}
```

## ANTI-PATTERNS

- **Sequential delegation**: Use `delegate_task` for parallel
- **Trust self-reports**: ALWAYS verify agent outputs
- **Main thread blocks**: No heavy I/O in loader init
- **Manual versioning**: CI manages package.json version
