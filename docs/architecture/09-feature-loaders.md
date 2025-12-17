---
title: "Feature Loaders"
description: "Claude Code Compatibility Layer and Feature Loading Architecture"
---

# Feature Loaders (Claude Code Compatibility Layer)

## Overview
OhMyOpenCode (OMO) provides a comprehensive compatibility layer for Claude Code features, allowing users to leverage their existing custom agents, slash commands, skills, and MCP configurations within the OpenCode environment. This is achieved through specialized feature loaders that discover, parse, and transform these assets into OpenCode-compatible formats.

## Loader Categories

| Loader | User Path | Project Path | Purpose |
|--------|-----------|--------------|---------|
| **Agent** | `~/.claude/agents/` | `.claude/agents/` | Custom sub-agents with specialized prompts. |
| **Command** | `~/.claude/commands/` | `.claude/commands/` | Slash commands for quick tasks and templates. |
| **Skill** | `~/.claude/skills/` | `.claude/skills/` | Reusable skills converted to commands. |
| **MCP** | `~/.claude/.mcp.json` | `.mcp.json` | Model Context Protocol server integrations. |

---

## Agent Loader
The Agent Loader discovers custom agents defined as Markdown files with YAML frontmatter.

### Directory Structure
- **User Scope**: `~/.claude/agents/*.md`
- **Project Scope**: `.claude/agents/*.md`

### Markdown Frontmatter Format
```yaml
---
name: agent-name (optional, defaults to filename)
description: Agent description
model: model-identifier (optional)
tools: tool1,tool2 (comma-separated list)
---
System prompt content goes here.
```

### Transformation Logic
- **Mode**: All loaded agents are set to `mode: "subagent"`.
- **Description**: Prefixed with `(user)` or `(project)` to indicate origin.
- **Tools**: The `tools` string is parsed into a `Record<string, boolean>` mapping for the OpenCode SDK.
- **Prompt**: The Markdown body is used as the agent's system prompt.

---

## Command Loader
The Command Loader handles slash commands, supporting both Claude Code compatibility and native OpenCode paths.

### Directory Structure
- **Claude User**: `~/.claude/commands/*.md`
- **Claude Project**: `.claude/commands/*.md`
- **OpenCode Global**: `~/.config/opencode/command/*.md`
- **OpenCode Project**: `.opencode/command/*.md`

### Frontmatter Format
```yaml
---
description: Command description
argument-hint: Hint for arguments (optional)
agent: Target agent (optional)
model: Target model (optional)
subtask: boolean (optional)
---
Instruction content.
```

### Template Wrapping
The body of the command is automatically wrapped in an XML-style template to separate instructions from user arguments:
```xml
<command-instruction>
[Body content from Markdown]
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>
```

---

## Skill Loader
The Skill Loader converts Claude Code skills (directories containing a `SKILL.md` file) into executable slash commands.

### Directory Structure
- **User Scope**: `~/.claude/skills/{skill-name}/SKILL.md`
- **Project Scope**: `.claude/skills/{skill-name}/SKILL.md`

### SKILL.md Format
```yaml
---
name: skill-name
description: Skill description
model: Target model (optional)
---
Skill instructions.
```

### Conversion Mechanism
Skills are transformed into `CommandDefinition` objects. The instructions are wrapped in `<skill-instruction>` tags, and descriptions are prefixed with `(scope - Skill)`.

---

## MCP Loader
The MCP Loader integrates Model Context Protocol servers for external tool connectivity.

### Configuration Locations
1. `~/.claude/.mcp.json` (User Global)
2. `.mcp.json` (Project Root)
3. `.claude/.mcp.json` (Project Local)

### Loading Priority
Later paths override earlier ones. If a server with the same name exists in multiple locations, the project-level configuration takes precedence over the user-level configuration.

### Transformation
The loader transforms Claude Code MCP configurations into OpenCode `McpServerConfig`:
- **Local (stdio)**: Commands and arguments are merged into a command array.
- **Remote (http/sse)**: URLs and headers are mapped to remote config.
- **Environment**: Environment variables are expanded using a dedicated expander utility.

---

## Session State Management
OMO maintains internal state to track session lifecycles and provide UI feedback.

### State Tracking
- **Main Session**: Tracks the primary session ID (non-subagent).
- **Current Session**: Tracks the active session ID and its title.
- **Session Flags**: Tracks if the first message has been processed and manages subagent session sets.

### Terminal Integration
The session state is used to update the terminal title via `updateTerminalTitle`, reflecting the current status:
- `idle`: Waiting for input.
- `processing`: Agent is thinking.
- `tool`: Executing a specific tool (e.g., `tool: read`).
- `error`: Session encountered an error.

---

## Hook Message Injector
The Hook Message Injector provides a mechanism for OMO to programmatically inject messages into the chat history.

### Injection Mechanism
- **Storage**: Messages are persisted to `.opencode/storage/messages/{sessionID}/`.
- **Context Resolution**: If the current message context is missing agent or model info, the injector searches the session directory for the "nearest" message with valid fields to ensure the injected message has correct metadata.
- **Synthetic Parts**: Injected content is marked as `synthetic: true` in the message parts.

---

## Loading Order and Conflict Resolution
Configurations are loaded and merged in a specific sequence during plugin initialization:

1. **User Config** (`~/.claude/`)
2. **User Skills** (`~/.claude/skills/`)
3. **OpenCode Global** (`~/.config/opencode/command/`)
4. **System Defaults** (OpenCode built-in commands)
5. **Project Config** (`.claude/`)
6. **Project Skills** (`.claude/skills/`)
7. **OpenCode Project** (`.opencode/command/`)

**Conflict Resolution**: Later entries in the sequence override earlier ones. For example, a command defined in `.opencode/command/test.md` will override a command named `test` defined in `~/.claude/commands/test.md`.
