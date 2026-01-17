# FEATURES KNOWLEDGE BASE

## OVERVIEW
Claude Code compatibility layer + core feature modules. Commands, skills, agents, MCPs, hooks from Claude Code work seamlessly.

## STRUCTURE
```
features/
├── background-agent/           # Task lifecycle, notifications (1165 lines manager.ts)
├── boulder-state/              # Boulder/Todo state persistence
├── builtin-commands/           # Built-in slash commands (ralph-loop, refactor, init-deep)
├── builtin-skills/             # Built-in skills (1203 lines skills.ts)
│   ├── git-master/             # Atomic commits, history search
│   ├── playwright/             # Browser automation
│   └── frontend-ui-ux/         # Designer-developer skill
├── claude-code-agent-loader/   # ~/.claude/agents/*.md
├── claude-code-command-loader/ # ~/.claude/commands/*.md
├── claude-code-mcp-loader/     # .mcp.json files with ${VAR} expansion
├── claude-code-plugin-loader/  # installed_plugins.json
├── claude-code-session-state/  # Session state persistence
├── context-injector/           # AGENTS.md/README.md/Rules injection
├── opencode-skill-loader/      # Skills from OpenCode + Claude paths
├── skill-mcp-manager/          # MCP servers in skill YAML (stdio/http transports)
├── task-toast-manager/         # Task status toast notifications
└── hook-message-injector/      # Message injection into conversation streams
```

## LOADER PRIORITY
| Loader | Priority (highest first) |
|--------|--------------------------|
| Commands | `.opencode/command/` > `~/.config/opencode/command/` > `.claude/commands/` > `~/.claude/commands/` |
| Skills | `.opencode/skill/` > `~/.config/opencode/skill/` > `.claude/skills/` > `~/.claude/skills/` |
| Agents | `.claude/agents/` > `~/.claude/agents/` |
| MCPs | `.claude/.mcp.json` > `.mcp.json` > `~/.claude/.mcp.json` |

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

## BACKGROUND AGENT
- **Lifecycle**: `launch` → `poll` (idle/stability detection) → `complete`.
- **Concurrency**: Per-provider/model limits in `concurrency.ts`.
- **Notification**: Auto-injects system reminders into parent session on task completion.
- **Cleanup**: Shutdown handler cancels pending waiters; idle tasks pruning (30m TTL).

## SKILL MCP
- **Lazy Loading**: Clients connect on first tool call via `SkillMcpManager`.
- **Transports**: `stdio` (local process) or `http` (SSE/Streamable HTTP).
- **Environment**: `${VAR}` expansion in config via `env-expander.ts`.
- **Lifecycle**: Session-scoped clients; auto-cleanup after 5m idle.

## ANTI-PATTERNS
- **Sequential Delegation**: Calling agents one-by-one; use `delegate_task` for parallel runs.
- **Self-Report Trust**: Trusting agent's "I'm done" without verifying against session state.
- **Main Thread Blocks**: Heavy I/O or long-running logic during loader initialization.
- **Manual Versioning**: Updating `package.json` version field; managed exclusively by CI.
