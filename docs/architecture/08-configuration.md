---
title: "Configuration System"
description: "Comprehensive guide to OhMyOpenCode configuration, schema, and loading strategy."
---

# Configuration System

OhMyOpenCode (OMO) features a robust, dual-level configuration system that allows for both global user preferences and project-specific overrides. The system is built on [Zod](https://zod.dev/) for strict type safety and validation.

## Configuration File Locations

OMO looks for configuration files in two locations, loading them in order:

1.  **User-Level (Base)**:
    *   **macOS/Linux**: `~/.config/opencode/oh-my-opencode.json` (respects `XDG_CONFIG_HOME`)
    *   **Windows**: `%APPDATA%\opencode\oh-my-opencode.json`
2.  **Project-Level (Override)**:
    *   `.opencode/oh-my-opencode.json` in the project root.

### Loading Strategy

The configuration is loaded during plugin initialization:
1.  The User-level config is loaded as the base.
2.  The Project-level config is loaded and merged into the base.
3.  **Merging Rules**:
    *   **Objects**: Deeply merged (using `deepMerge`).
    *   **Arrays** (`disabled_agents`, `disabled_hooks`, `disabled_mcps`): Concatenated and deduplicated.
    *   **Scalars**: Project-level values overwrite user-level values.
    *   **Agent Names**: Normalized to be case-insensitive (e.g., `omo` becomes `OmO`).

## JSON Schema Support

For IDE autocomplete and validation, OMO provides a JSON schema. You can add the `$schema` field to your configuration file:

```json
{
  "$schema": "https://raw.githubusercontent.com/sst/oh-my-opencode/master/assets/oh-my-opencode.schema.json"
}
```

## Configuration Schema

The root configuration object follows the `OhMyOpenCodeConfig` interface.

### Root Interface

```typescript
interface OhMyOpenCodeConfig {
  $schema?: string;
  disabled_mcps?: McpName[];
  disabled_agents?: BuiltinAgentName[];
  disabled_hooks?: HookName[];
  agents?: AgentOverrides;
  claude_code?: ClaudeCodeConfig;
  google_auth?: boolean;
  omo_agent?: OmoAgentConfig;
  governance?: GovernanceConfig;
}
```

| Field | Type | Description |
| :--- | :--- | :--- |
| `disabled_mcps` | `McpName[]` | List of MCP servers to disable. |
| `disabled_agents` | `BuiltinAgentName[]` | List of OMO builtin agents to disable. |
| `disabled_hooks` | `HookName[]` | List of OMO hooks to disable. |
| `agents` | `AgentOverrides` | Configuration overrides for specific agents. |
| `claude_code` | `ClaudeCodeConfig` | Compatibility settings for Claude Code features. |
| `google_auth` | `boolean` | Enable Google Antigravity OAuth (default: `false`). |
| `omo_agent` | `OmoAgentConfig` | Global settings for the OmO orchestrator. |
| `governance` | `GovernanceConfig` | Settings for the OMO governance system. |

---

## Agent Configuration

You can override the behavior of both OMO builtin agents and standard OpenCode agents (`build`, `plan`).

### Overridable Agents
- `OmO`, `OmO-Plan` (Orchestrators)
- `oracle`, `librarian`, `explore`, `frontend-ui-ux-engineer`, `document-writer`, `multimodal-looker`
- `build`, `plan` (Standard OpenCode agents)

### Agent Override Schema

```typescript
interface AgentOverrideConfig {
  model?: string;
  temperature?: number; // 0.0 to 2.0
  top_p?: number;       // 0.0 to 1.0
  prompt?: string;      // System prompt override
  tools?: Record<string, boolean>; // Enable/disable specific tools
  disable?: boolean;    // Disable this specific agent
  description?: string;
  mode?: "subagent" | "primary" | "all";
  color?: string;       // Hex color code (e.g., "#6495ED")
  permission?: AgentPermission;
}
```

### Permissions Schema

```typescript
interface AgentPermission {
  edit?: "ask" | "allow" | "deny";
  bash?: "ask" | "allow" | "deny" | Record<string, "ask" | "allow" | "deny">;
  webfetch?: "ask" | "allow" | "deny";
  doom_loop?: "ask" | "allow" | "deny";
  external_directory?: "ask" | "allow" | "deny";
}
```

---

## Hook Configuration

OMO includes over 21 lifecycle hooks. You can disable any of them using the `disabled_hooks` array.

### Available Hooks

| Category | Hook Names |
| :--- | :--- |
| **Productivity** | `todo-continuation-enforcer`, `session-recovery`, `session-notification`, `think-mode`, `agent-usage-reminder` |
| **Context** | `context-window-monitor`, `rules-injector`, `directory-agents-injector`, `directory-readme-injector` |
| **Output** | `grep-output-truncator`, `tool-output-truncator`, `empty-task-response-detector`, `background-notification` |
| **System** | `comment-checker`, `anthropic-auto-compact`, `auto-update-checker`, `keyword-detector`, `non-interactive-env`, `interactive-bash-session` |
| **Governance** | `governance-path-validator`, `governance-historian`, `governance-linear-injector` |

---

## Claude Code Compatibility

OMO can load configurations and assets from Claude Code compatible directories.

```typescript
interface ClaudeCodeConfig {
  mcp?: boolean;      // Load .mcp.json configs (default: true)
  commands?: boolean; // Load .claude/commands/ (default: true)
  skills?: boolean;   // Load .claude/skills/ (default: true)
  agents?: boolean;   // Load .claude/agents/ (default: true)
  hooks?: boolean;    // Enable Claude Code hooks (default: true)
}
```

---

## Governance Configuration

The governance system enforces project standards and maintains the audit trail.

```typescript
interface GovernanceConfig {
  path_validation?: {
    enabled?: boolean;  // default: true
    mode?: "warn" | "block" | "disabled";  // default: "warn"
    allowed_paths?: string[]; // default: [src/, docs/, tests/, .opencode/, ...]
  };
  historian?: {
    enabled?: boolean;  // default: true
    auto_create?: boolean;  // default: true
    changelog_path?: string; // default: "changelog/"
    min_changes?: number;    // default: 1
  };
  linear?: {
    enabled?: boolean;  // default: true
    team_prefix?: string; // default: "LIF"
    cache_issues?: boolean; // default: true
  };
}
```

---

## Example Configurations

### Minimal Configuration
Disable a few hooks and enable Google Auth.

```json
{
  "disabled_hooks": ["think-mode", "session-notification"],
  "google_auth": true
}
```

### Agent Override Example
Change the model and color for the `oracle` agent.

```json
{
  "agents": {
    "oracle": {
      "model": "openai/gpt-4o",
      "color": "#FFD700",
      "temperature": 0.5
    }
  }
}
```

### Full Governance Configuration
Strict path validation and custom changelog location.

```json
{
  "governance": {
    "path_validation": {
      "enabled": true,
      "mode": "block",
      "allowed_paths": ["src/", "docs/", "package.json"]
    },
    "historian": {
      "enabled": true,
      "changelog_path": "docs/changelog/",
      "min_changes": 2
    },
    "linear": {
      "team_prefix": "PROJ",
      "cache_issues": true
    }
  }
}
```
