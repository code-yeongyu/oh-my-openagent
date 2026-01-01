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
├── builtin-commands/           # Built-in slash command definitions
├── builtin-skills/             # Built-in skills (playwright, etc.)
│   └── */SKILL.md              # Each skill in own directory
├── claude-code-agent-loader/   # Load agents from ~/.claude/agents/*.md
├── claude-code-command-loader/ # Load commands from ~/.claude/commands/*.md
├── claude-code-mcp-loader/     # Load MCPs from .mcp.json
│   └── env-expander.ts         # ${VAR} expansion
├── claude-code-plugin-loader/  # Load external plugins from installed_plugins.json
├── claude-code-session-state/  # Session state persistence
├── opencode-skill-loader/      # Load skills from OpenCode and Claude paths
├── skill-mcp-manager/          # MCP servers embedded in skills
│   ├── manager.ts              # Lazy-loading MCP client lifecycle
│   └── types.ts
└── hook-message-injector/      # Inject messages into conversation
```

## LOADER PRIORITY

Each loader reads from multiple directories (highest priority first):

| Loader | Priority Order |
|--------|---------------|
| Commands | `.opencode/command/` > `~/.config/opencode/command/` > `.claude/commands/` > `~/.claude/commands/` |
| Skills | `.opencode/skill/` > `~/.config/opencode/skill/` > `.claude/skills/` > `~/.claude/skills/` |
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

## MCP LOADER (claude-code-mcp-loader)

Loads MCP server configs from `.mcp.json` files. Full Claude Code compatibility.

### File Locations (Priority Order)

| Path | Scope | Description |
|------|-------|-------------|
| `~/.claude/.mcp.json` | user | User-global MCP servers |
| `./.mcp.json` | project | Project-specific MCP servers |
| `./.claude/.mcp.json` | local | Local overrides (git-ignored) |

### .mcp.json Format

```json
{
  "mcpServers": {
    "server-name": {
      "type": "stdio|http|sse",
      "command": "npx",
      "args": ["-y", "@anthropics/mcp-server-example"],
      "env": {
        "API_KEY": "${MY_API_KEY}"
      },
      "disabled": false
    }
  }
}
```

### Server Types

| Type | Required Fields | Description |
|------|-----------------|-------------|
| `stdio` (default) | `command`, `args?`, `env?` | Local subprocess MCP |
| `http` | `url`, `headers?` | HTTP-based remote MCP |
| `sse` | `url`, `headers?` | SSE-based remote MCP |

### Environment Variable Expansion

Supports `${VAR}` syntax in all string fields:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["${HOME}/mcp-server/index.js"],
      "env": {
        "API_KEY": "${MY_API_KEY}",
        "DEBUG": "${DEBUG:-false}"
      }
    }
  }
}
```

### Examples

**stdio (Local subprocess)**:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropics/mcp-server-filesystem", "/path/to/dir"]
    }
  }
}
```

**http (Remote)**:
```json
{
  "mcpServers": {
    "remote-api": {
      "type": "http",
      "url": "https://mcp.example.com/api",
      "headers": {
        "Authorization": "Bearer ${API_TOKEN}"
      }
    }
  }
}
```

**Disable a server**:
```json
{
  "mcpServers": {
    "expensive-server": {
      "command": "...",
      "disabled": true
    }
  }
}
```

### Transformation

Claude Code format → OpenCode format:

| Claude Code | OpenCode |
|-------------|----------|
| `type: "stdio"` | `type: "local"` |
| `type: "http\|sse"` | `type: "remote"` |
| `command` + `args` | `command: [cmd, ...args]` |
| `env` | `environment` |
| `headers` | `headers` |

## SKILL MCP MANAGER

- **Purpose**: Manage MCP servers embedded in skill YAML frontmatter
- **Lifecycle**: Lazy client loading, session-scoped cleanup
- **Config**: `mcp` field in skill's YAML frontmatter defines server config
- **Tool**: `skill_mcp` exposes MCP capabilities (tools, resources, prompts)

## BUILTIN SKILLS

- **Location**: `src/features/builtin-skills/*/SKILL.md`
- **Available**: `playwright` (browser automation)
- **Disable**: `disabled_skills: ["playwright"]` in config

## ANTI-PATTERNS (FEATURES)

- **Blocking on load**: Loaders run at startup, keep them fast
- **No error handling**: Always try/catch, log failures, return empty on error
- **Ignoring priority**: Higher priority dirs must override lower
- **Modifying user files**: Loaders read-only, never write to ~/.claude/
