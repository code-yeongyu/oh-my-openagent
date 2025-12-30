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

<Note>
For a detailed guide on configuring specific agents, including purpose and default models, see the [Agent Configuration Guide](/docs/guides/agent-configuration.md).
</Note>

You can override the behavior of both OMO builtin agents and standard OpenCode agents (`build`, `plan`).

### Overridable Agents

- **Core**: `OmO`, `OmO-Plan`, `oracle`, `librarian`, `explore`
- **UI & Documentation**: `frontend-ui-ux-engineer`, `document-writer`, `multimodal-looker`, `docs-publisher`
- **Workflow**: `product-strategist`, `strategic-planner`, `task-planner`
- **Implementation**: `implementation-specialist`, `backend-typescript`, `frontend-react`, `backend-rust`, `backend-python`, `mobile-xcode`, `mobile-react-native`
- **AI/ML**: `ai-ml-expert`, `agent-specialist`
- **Cross-cutting**: `security-specialist`, `test-specialist`, `optimization-specialist`
- **Standard OpenCode**: `build`, `plan`

### Agent Override Schema

```typescript
interface AgentOverrideConfig {
  model?: string;
  temperature?: number; // 0.0 to 2.0
  top_p?: number;       // 0.0 to 1.0
  max_tokens?: number;  // Max tokens to generate
  maxSteps?: number;    // Max agentic iterations
  reasoning_effort?: "low" | "medium" | "high"; // OpenAI o1/o3
  prompt?: string;      // System prompt override
  tools?: Record<string, boolean>; // Enable/disable specific tools
  disable?: boolean;    // Disable this specific agent
  description?: string;
  mode?: "subagent" | "primary" | "all";
  color?: string;       // Hex color code (e.g., "#6495ED")
  permission?: AgentPermission;
  // .passthrough() allows any additional provider-specific parameters
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
    policy?: "off" | "optional" | "required"; // default: "optional"
  };
  hook_health?: {
    enabled?: boolean;  // default: true
    circuit_breaker_threshold?: number; // default: 3
    slow_hook_threshold_ms?: number; // default: 1000
    metrics_retention_count?: number; // default: 100
    enable_metrics?: boolean; // default: true
    log_warnings?: boolean; // default: true
  };
  git_safety?: {
    enabled?: boolean;  // default: true
    protected_branches?: string[]; // default: ["main", "master", "production", "prod"]
    block_force_operations?: boolean; // default: true
    warn_on_destructive?: boolean; // default: true
    allow_list_patterns?: string[]; // default: []
  };
  security_scanner?: {
    enabled?: boolean;  // default: true
    scan_on_write?: boolean; // default: true
    scan_on_edit?: boolean; // default: true
    mask_in_output?: boolean; // default: true
    allow_list_patterns?: string[]; // default: []
  };
  conflict_detector?: {
    enabled?: boolean;  // default: true
    lock_timeout_ms?: number; // default: 60000
    warn_on_conflict?: boolean; // default: true
    block_on_conflict?: boolean; // default: false
  };
  orchestration?: {
    max_turns?: number; // default: 10
    max_delegation_depth?: number; // default: 5
    detect_loops?: boolean; // default: true
    warn_on_deep_chain?: boolean; // default: true
    retry_max_attempts?: number; // default: 3
    retry_initial_delay_ms?: number; // default: 1000
    retry_max_delay_ms?: number; // default: 30000
  };
  docs_blocking?: {
    enabled?: boolean;  // default: true
    mode?: "warn" | "block" | "disabled"; // default: "block"
  };
  artifact_truncation?: {
    enabled?: boolean;  // default: true
    max_summary_tokens?: number; // default: 200
    max_output_chars?: number; // default: 4000
    keep_task_metadata?: boolean; // default: true
  };
  delegation_compliance?: {
    enabled?: boolean;  // default: false
    track_violations?: boolean; // default: true
    strikes_to_block?: number; // default: 3
  };
  workflow_state_enforcer?: {
    enabled?: boolean;  // default: true
    mode?: "warn" | "block" | "disabled"; // default: "warn"
    workflow_agents?: Record<string, string>; // default: {"/specify": "product-strategist", ...}
    prerequisites?: Record<string, string[]>; // default: {"/plan": ["spec.md"], ...}
  };
  read_before_write?: {
    enabled?: boolean;  // default: true
    mode?: "block" | "warn" | "disabled"; // default: "block"
    exempt_tools?: string[]; // default: ["lsp_rename", "ast_grep_replace", ...]
    exempt_paths?: string[]; // default: ["dist/**", "build/**", ...]
  };
}
```

**Note**: For complete details on all governance options, see [Configuration Reference](../reference/configuration.md#governance-configuration).

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
