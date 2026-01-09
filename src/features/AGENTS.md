# FEATURES KNOWLEDGE BASE

## OVERVIEW

Claude Code compatibility layer + core feature modules. Commands, skills, agents, MCPs, hooks from Claude Code work seamlessly.

## STRUCTURE

```
features/
├── background-agent/           # Task lifecycle, notifications (608 lines)
├── boulder-state/              # Boulder state persistence
├── builtin-commands/           # Built-in slash commands
│   └── templates/              # start-work, refactor, init-deep, ralph-loop
├── builtin-skills/             # Built-in skills
│   ├── git-master/             # Atomic commits, rebase, history search
│   └── frontend-ui-ux/         # Designer-turned-developer skill
├── claude-code-agent-loader/   # ~/.claude/agents/*.md
├── claude-code-command-loader/ # ~/.claude/commands/*.md
├── claude-code-mcp-loader/     # .mcp.json files
│   └── env-expander.ts         # ${VAR} expansion
├── claude-code-plugin-loader/  # installed_plugins.json (486 lines)
├── claude-code-session-state/  # Session state persistence
├── context-injector/           # Context collection and injection
├── opencode-skill-loader/      # Skills from OpenCode + Claude paths
├── skill-mcp-manager/          # MCP servers in skill YAML
├── task-toast-manager/         # Task toast notifications
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

- Lifecycle: pending → running → completed/failed
- OS notification on complete
- `background_output` to retrieve results
- `background_cancel` with task_id or all=true

## SKILL MCP

- MCP servers embedded in skill YAML frontmatter
- Lazy client loading, session-scoped cleanup
- `skill_mcp` tool exposes capabilities

## ANTI-PATTERNS

- Blocking on load (loaders run at startup)
- No error handling (always try/catch)
- Ignoring priority order
- Writing to ~/.claude/ (read-only)
