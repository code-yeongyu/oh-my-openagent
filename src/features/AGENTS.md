# FEATURES KNOWLEDGE BASE

## OVERVIEW

Claude Code compatibility layer and core feature modules. Enables Claude Code configs/commands/skills/MCPs/hooks to work seamlessly in OpenCode.

## STRUCTURE

```
features/
├── background-agent/           # Background task management
│   ├── manager.ts              # Task lifecycle, notifications
│   ├── manager.test.ts
│   └── types.ts
├── claude-code-agent-loader/   # Load agents from ~/.claude/agents/*.md
├── claude-code-command-loader/ # Load commands from ~/.claude/commands/*.md
├── claude-code-mcp-loader/     # Load MCPs from .mcp.json
│   └── env-expander.ts         # ${VAR} expansion
├── claude-code-session-state/  # Session state persistence
├── claude-code-skill-loader/   # Load skills from ~/.claude/skills/*/SKILL.md
└── hook-message-injector/      # Inject messages into conversation
```

## LOADER PRIORITY

Each loader reads from multiple directories (highest priority first):

| Loader | Priority Order |
|--------|---------------|
| Commands | `.opencode/command/` > `~/.config/opencode/command/` > `.claude/commands/` > `~/.claude/commands/` |
| Skills | `.claude/skills/` > `~/.claude/skills/` |
| Agents | `.claude/agents/` > `~/.claude/agents/` |
| MCPs | `.claude/.mcp.json` > `.mcp.json` > `~/.claude/.mcp.json` |

## HOW TO ADD A LOADER

1. Create directory: `src/features/claude-code-my-loader/`
2. Create files:
   - `loader.ts`: Main loader logic with `load()` function
   - `types.ts`: TypeScript interfaces
   - `index.ts`: Barrel export
3. Pattern: Read from multiple dirs, merge with priority, return normalized config

## BACKGROUND AGENT SPECIFICS

- **Task lifecycle**: pending → running → completed/failed
- **Notifications**: OS notification on task complete (configurable)
- **Result retrieval**: `background_output` tool with task_id
- **Cancellation**: `background_cancel` with task_id or all=true

## CONFIG TOGGLES

Disable features in `oh-my-opencode.json`:

```json
{
  "claude_code": {
    "mcp": false,      // Skip .mcp.json loading
    "commands": false, // Skip commands/*.md loading
    "skills": false,   // Skip skills/*/SKILL.md loading
    "agents": false,   // Skip agents/*.md loading
    "hooks": false     // Skip settings.json hooks
  }
}
```

## HOOK MESSAGE INJECTOR

- **Purpose**: Inject system messages into conversation at specific points
- **Timing**: PreToolUse, PostToolUse, UserPromptSubmit, Stop
- **Format**: Returns `{ messages: [{ role: "user", content: "..." }] }`

## ANTI-PATTERNS (FEATURES)

- **Blocking on load**: Loaders run at startup, keep them fast
- **No error handling**: Always try/catch, log failures, return empty on error
- **Ignoring priority**: Higher priority dirs must override lower
- **Modifying user files**: Loaders read-only, never write to ~/.claude/
