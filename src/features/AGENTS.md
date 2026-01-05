# FEATURES KNOWLEDGE BASE

## OVERVIEW

Claude Code compatibility layer + core feature modules. Commands, skills, agents, MCPs, hooks from Claude Code work seamlessly.

## STRUCTURE

```
features/
├── background-agent/           # Task lifecycle, notifications (460 lines)
├── builtin-commands/           # Built-in slash commands
├── builtin-skills/             # Built-in skills (playwright)
├── claude-code-agent-loader/   # ~/.claude/agents/*.md
├── claude-code-command-loader/ # ~/.claude/commands/*.md
├── claude-code-mcp-loader/     # .mcp.json files
│   └── env-expander.ts         # ${VAR} expansion
├── claude-code-plugin-loader/  # installed_plugins.json (484 lines)
├── claude-code-session-state/  # Session state persistence
├── opencode-skill-loader/      # Skills from OpenCode + Claude paths
├── skill-mcp-manager/          # MCP servers in skill YAML
└── hook-message-injector/      # Inject messages into conversation
```

## LOADER PRIORITY

| Loader | Priority (highest first) |
|--------|--------------------------|
| Commands | `.opencode/command/` > `~/.config/opencode/command/` > `.claude/commands/` > `~/.claude/commands/` |
| Skills | `.opencode/skill/` > `~/.config/opencode/skill/` > `.claude/skills/` > `~/.claude/skills/` |
| Agents | `.claude/agents/` > `~/.claude/agents/` |
| MCPs | `.claude/.mcp.json` > `.mcp.json` > `~/.claude/.mcp.json` |

## CONFIG TOGGLES

```json
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

- **Lifecycle**: pending → running → completed/error/cancelled
- **TTL**: Tasks kept for 30 minutes after completion
- **Retry**: Automatic retry (3 attempts with 0ms, 2s delays) for transient failures
- **Notification Delivery**: 
  - OS toast on completion
  - Automatic injection at next tool use via PreToolUse hook
  - Ensures agent always receives completion notifications
- **Tools**:
  - `background_output`: Retrieve results by task_id
  - `background_cancel`: Cancel by task_id or all=true
- **Error Handling**: 
  - Non-retryable errors (agent not found) fail immediately
  - Retryable errors (network timeouts) retry with 0ms, 2s delays

## SKILL MCP

- MCP servers embedded in skill YAML frontmatter
- Lazy client loading, session-scoped cleanup
- `skill_mcp` tool exposes capabilities

## ANTI-PATTERNS

- Blocking on load (loaders run at startup)
- No error handling (always try/catch)
- Ignoring priority order
- Writing to ~/.claude/ (read-only)
