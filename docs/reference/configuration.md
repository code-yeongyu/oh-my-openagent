---
title: "Configuration Reference"
description: "Complete reference for all oh-my-opencode configuration options, schema definitions, and governance settings."
---

# Configuration Reference

This document provides a complete reference for all configuration options available in OhMyOpenCode. For a higher-level overview, see [Architecture: Configuration System](../architecture/08-configuration.md). For agent-specific configuration, see [Agent Configuration Guide](../guides/agent-configuration.md).

## Table of Contents

- [Configuration File Locations](#configuration-file-locations)
- [JSON Schema Support](#json-schema-support)
- [Root-Level Options](#root-level-options)
- [Agent Configuration](#agent-configuration)
- [Claude Code Compatibility](#claude-code-compatibility)
- [OmO Agent Configuration](#omo-agent-configuration)
- [Governance Configuration](#governance-configuration)
- [Memory Tools Configuration](#memory-tools-configuration)
- [Meta-Learning Configuration](#meta-learning-configuration)
- [Hook Configuration](#hook-configuration)
- [MCP Configuration](#mcp-configuration)

---

## Configuration File Locations

OhMyOpenCode loads configuration from two locations with merge priority:

1. **User-Level**: `~/.config/opencode/oh-my-opencode.json` (respects `XDG_CONFIG_HOME`)
2. **Project-Level**: `.opencode/oh-my-opencode.json` (overrides user config)

### Merge Strategy

- **Objects**: Deep merged using `deepMerge` utility
- **Arrays** (`disabled_agents`, `disabled_hooks`, `disabled_mcps`): Concatenated and deduplicated
- **Scalars**: Project-level values override user-level values
- **Agent Names**: Normalized to be case-insensitive (e.g., `omo` becomes `OmO`)

---

## JSON Schema Support

Enable IDE autocomplete and validation by adding the `$schema` field:

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json"
}
```

The schema is automatically generated from `src/config/schema.ts` via `bun run build:schema`.

---

## Root-Level Options

### `$schema`
- **Type**: `string`
- **Optional**: Yes
- **Description**: JSON schema URL for IDE support
- **Example**: `"https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json"`

### `disabled_mcps`
- **Type**: `McpName[]`
- **Optional**: Yes
- **Default**: `[]` (all enabled)
- **Description**: Array of MCP server names to disable
- **Valid Values**: `"websearch_exa"`, `"context7"`, `"grep_app"`
- **Example**:
  ```json
  {
    "disabled_mcps": ["context7", "grep_app"]
  }
  ```

### `disabled_agents`
- **Type**: `BuiltinAgentName[]`
- **Optional**: Yes
- **Default**: `[]` (all enabled)
- **Description**: Array of built-in agent names to disable
- **Valid Values**: See [Agent Configuration](#agent-configuration) for full list
- **Example**:
  ```json
  {
    "disabled_agents": ["mobile-xcode", "mobile-react-native"]
  }
  ```

### `disabled_hooks`
- **Type**: `HookName[]`
- **Optional**: Yes
- **Default**: `[]` (all enabled)
- **Description**: Array of hook names to disable
- **Valid Values**: See [Hook Configuration](#hook-configuration) for full list
- **Example**:
  ```json
  {
    "disabled_hooks": ["comment-checker", "think-mode"]
  }
  ```

### `agents`
- **Type**: `AgentOverrides`
- **Optional**: Yes
- **Description**: Configuration overrides for specific agents
- **See**: [Agent Configuration](#agent-configuration) for detailed options

### `claude_code`
- **Type**: `ClaudeCodeConfig`
- **Optional**: Yes
- **Description**: Claude Code compatibility toggles
- **See**: [Claude Code Compatibility](#claude-code-compatibility)

### `google_auth`
- **Type**: `boolean`
- **Optional**: Yes
- **Default**: `false`
- **Description**: Enable Google Antigravity OAuth for Gemini models
- **Example**:
  ```json
  {
    "google_auth": true
  }
  ```

### `omo_agent`
- **Type**: `OmoAgentConfig`
- **Optional**: Yes
- **Description**: Global OmO orchestrator settings
- **See**: [OmO Agent Configuration](#omo-agent-configuration)

### `governance`
- **Type**: `GovernanceConfig`
- **Optional**: Yes
- **Description**: Governance system configuration
- **See**: [Governance Configuration](#governance-configuration)

### `memory_tools`
- **Type**: `MemoryToolsConfig`
- **Optional**: Yes
- **Description**: Memory tools configuration (LIF-73)
- **See**: [Memory Tools Configuration](#memory-tools-configuration)

### `meta_learning`
- **Type**: `MetaLearningConfig`
- **Optional**: Yes
- **Description**: Meta-learning system configuration (LIF-73)
- **See**: [Meta-Learning Configuration](#meta-learning-configuration)

---

## Agent Configuration

### Available Agents

#### Overridable Agents

All agents support the same configuration options via the `agents` object:

| Agent Name | Purpose | Default Model |
|------------|---------|---------------|
| `OmO` | Primary orchestrator | `anthropic/claude-opus-4-5` |
| `OmO-Plan` | Planning specialist | `anthropic/claude-opus-4-5` |
| `build` | Default OpenCode agent | (OpenCode default) |
| `plan` | Planning agent | (OpenCode default) |
| `oracle` | Strategic advisor | `openai/gpt-5.2` |
| `librarian` | Documentation researcher | `opencode/big-pickle` |
| `explore` | Codebase explorer | `opencode/grok-code` |
| `frontend-ui-ux-engineer` | UI/UX specialist | `google/gemini-3-pro-preview` |
| `document-writer` | Technical writer | `google/gemini-3-pro-preview` |
| `multimodal-looker` | Visual content analyst | `google/gemini-2.5-flash` |
| `docs-publisher` | Documentation publisher | `anthropic/claude-sonnet-4-5` |
| `product-strategist` | Requirements specialist | `anthropic/claude-sonnet-4-5` |
| `strategic-planner` | Architecture planner | `anthropic/claude-sonnet-4-5` |
| `task-planner` | Task breakdown specialist | `anthropic/claude-sonnet-4-5` |
| `implementation-specialist` | Implementation manager | `google/gemini-3-flash-preview` |
| `backend-typescript` | TypeScript/Node.js specialist | `google/gemini-3-flash-preview` |
| `frontend-react` | React specialist | `google/gemini-3-pro-preview` |
| `backend-rust` | Rust specialist | `google/gemini-3-flash-preview` |
| `backend-python` | Python specialist | `google/gemini-3-flash-preview` |
| `mobile-xcode` | iOS/macOS specialist | `google/gemini-3-pro-preview` |
| `mobile-react-native` | React Native specialist | `google/gemini-3-pro-preview` |
| `ai-ml-expert` | AI/ML specialist | `google/gemini-3-flash-preview` |
| `agent-specialist` | Multi-agent systems specialist | `google/gemini-3-flash-preview` |
| `security-specialist` | Security specialist | `google/gemini-3-flash-preview` |
| `test-specialist` | Testing specialist | `google/gemini-3-flash-preview` |
| `optimization-specialist` | Performance specialist | `google/gemini-3-flash-preview` |
| `context-learner` | Meta-learning analyst | `google/gemini-2.5-flash` |

### Agent Override Options

Each agent can be configured with the following options:

| Option | Type | Range/Values | Description |
|--------|------|--------------|-------------|
| `model` | `string` | - | Model ID (e.g., `openai/gpt-4o`, `anthropic/claude-3-5-sonnet`) |
| `temperature` | `number` | `0.0` to `2.0` | Sampling temperature |
| `top_p` | `number` | `0.0` to `1.0` | Nucleus sampling |
| `max_tokens` | `number` | `>= 1` | Maximum tokens to generate |
| `maxSteps` | `number` | `>= 1` | Maximum agentic iterations |
| `reasoning_effort` | `string` | `"low"`, `"medium"`, `"high"` | For OpenAI o1/o3 models |
| `prompt` | `string` | - | Override system prompt |
| `description` | `string` | - | Agent description visible to other agents |
| `tools` | `Record<string, boolean>` | - | Enable/disable specific tools |
| `disable` | `boolean` | - | Completely disable this agent |
| `mode` | `string` | `"subagent"`, `"primary"`, `"all"` | Agent operational mode |
| `color` | `string` | Hex color | UI color (e.g., `"#FF0000"`) |
| `permission` | `AgentPermission` | - | Tool-specific permissions |

**Note**: The schema uses `.passthrough()`, allowing any additional provider-specific parameters to be passed through.

### Agent Permission Schema

```typescript
interface AgentPermission {
  edit?: "ask" | "allow" | "deny";
  bash?: "ask" | "allow" | "deny" | Record<string, "ask" | "allow" | "deny">;
  webfetch?: "ask" | "allow" | "deny";
  doom_loop?: "ask" | "allow" | "deny";
  external_directory?: "ask" | "allow" | "deny";
}
```

### Example Configuration

```json
{
  "agents": {
    "oracle": {
      "model": "openai/o1",
      "reasoning_effort": "high",
      "temperature": 1.0,
      "maxSteps": 1
    },
    "explore": {
      "permission": {
        "bash": "deny",
        "edit": "deny"
      }
    },
    "frontend-ui-ux-engineer": {
      "temperature": 1.2,
      "color": "#FF69B4"
    },
    "mobile-xcode": {
      "disable": true
    }
  }
}
```

---

## Claude Code Compatibility

### `ClaudeCodeConfig` Schema

Controls which Claude Code compatibility features are enabled.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mcp` | `boolean` | `true` | Load MCP configs from `.mcp.json` files |
| `commands` | `boolean` | `true` | Load commands from `.claude/commands/` |
| `skills` | `boolean` | `true` | Load skills from `.claude/skills/` |
| `agents` | `boolean` | `true` | Load agents from `.claude/agents/` |
| `hooks` | `boolean` | `true` | Enable Claude Code hooks system |

### Example

```json
{
  "claude_code": {
    "mcp": true,
    "commands": true,
    "skills": true,
    "agents": true,
    "hooks": false
  }
}
```

### Compatibility Paths

| Feature | User Paths | Project Paths |
|---------|------------|---------------|
| MCP | `~/.claude/.mcp.json` | `./.mcp.json`, `./.claude/.mcp.json` |
| Commands | `~/.claude/commands/*.md` | `./.claude/commands/*.md` |
| Skills | `~/.claude/skills/*/SKILL.md` | `./.claude/skills/*/SKILL.md` |
| Agents | `~/.claude/agents/*.md` | `./.claude/agents/*.md` |
| Hooks | `~/.claude/settings.json` | `./.claude/settings.json`, `./.claude/settings.local.json` |

---

## OmO Agent Configuration

### `OmoAgentConfig` Schema

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `disabled` | `boolean` | `false` | Disable OmO orchestrator (restores original build/plan agents) |

### Example

```json
{
  "omo_agent": {
    "disabled": false
  }
}
```

When `disabled: true`:
- `OmO` and `OmO-Plan` agents are removed
- Original `build` and `plan` agents become primary agents

---

## Governance Configuration

The governance system enforces project standards, tracks changes, and integrates with Linear.

### `GovernanceConfig` Schema

| Sub-Config | Type | Description |
|------------|------|-------------|
| `path_validation` | `GovernancePathValidationConfig` | File path validation |
| `historian` | `GovernanceHistorianConfig` | Change tracking and changelog |
| `linear` | `GovernanceLinearConfig` | Linear integration |
| `hook_health` | `GovernanceHookHealthConfig` | Hook circuit breaker and metrics |
| `git_safety` | `GovernanceGitSafetyConfig` | Git safety validation |
| `security_scanner` | `GovernanceSecurityScannerConfig` | Security scanning |
| `conflict_detector` | `GovernanceConflictDetectorConfig` | File conflict detection |
| `orchestration` | `OrchestrationConfig` | Orchestration limits |
| `docs_blocking` | `GovernanceDocsBlockingConfig` | Documentation delegation enforcement |
| `artifact_truncation` | `GovernanceArtifactTruncationConfig` | Artifact response truncation |
| `delegation_compliance` | `GovernanceDelegationComplianceConfig` | Delegation compliance tracking |
| `workflow_state_enforcer` | `WorkflowStateEnforcerConfig` | Workflow state enforcement |
| `read_before_write` | `GovernanceReadBeforeWriteConfig` | Read-before-write enforcement (LIF-103) |

### Path Validation

**`governance.path_validation`**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable path validation |
| `mode` | `"warn" \| "block" \| "disabled"` | `"warn"` | Validation mode |
| `allowed_paths` | `string[]` | See below | Allowed path prefixes |

**Default `allowed_paths`**:
```json
[
  "context/specs/",
  "context/memory/",
  "context/learnings/",
  ".cursor/specs/",
  ".cursor/memory/",
  ".opencode/",
  "src/",
  "tests/",
  "docs/",
  "lib/",
  "packages/"
]
```

### Historian

**`governance.historian`**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable historian hook |
| `auto_create` | `boolean` | `true` | Auto-create changelog on session end |
| `changelog_path` | `string` | `"changelog/"` | Directory for changelog files |
| `min_changes` | `number` | `1` | Minimum file changes to create changelog |

### Linear Integration

**`governance.linear`**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable Linear context injection |
| `team_prefix` | `string` | `"LIF"` | Linear team prefix for issue detection |
| `cache_issues` | `boolean` | `true` | Cache issue data per session |
| `policy` | `"off" \| "optional" \| "required"` | `"optional"` | Linear issue requirement policy |

### Hook Health Manager

**`governance.hook_health`**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable hook health monitoring |
| `circuit_breaker_threshold` | `number` | `3` | Consecutive failures before circuit break |
| `slow_hook_threshold_ms` | `number` | `1000` | Threshold for slow hook warnings (ms) |
| `metrics_retention_count` | `number` | `100` | Number of metrics to retain per hook |
| `enable_metrics` | `boolean` | `true` | Enable metrics collection |
| `log_warnings` | `boolean` | `true` | Log warnings for slow/failed hooks |

### Git Safety Validator

**`governance.git_safety`**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable git safety validation |
| `protected_branches` | `string[]` | `["main", "master", "production", "prod"]` | Protected branch names |
| `block_force_operations` | `boolean` | `true` | Block force push/reset operations |
| `warn_on_destructive` | `boolean` | `true` | Warn on destructive operations |
| `allow_list_patterns` | `string[]` | `[]` | Regex patterns to allow |

### Security Scanner

**`governance.security_scanner`**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable security scanning |
| `scan_on_write` | `boolean` | `true` | Scan on file write operations |
| `scan_on_edit` | `boolean` | `true` | Scan on file edit operations |
| `mask_in_output` | `boolean` | `true` | Mask secrets in tool output |
| `allow_list_patterns` | `string[]` | `[]` | Patterns to allow (skip scanning) |

### Conflict Detector

**`governance.conflict_detector`**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable conflict detection |
| `lock_timeout_ms` | `number` | `60000` | Lock timeout in milliseconds |
| `warn_on_conflict` | `boolean` | `true` | Warn when conflicts detected |
| `block_on_conflict` | `boolean` | `false` | Block operations on conflict |

### Orchestration Limits

**`governance.orchestration`**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `max_turns` | `number` | `10` | Maximum orchestration turns |
| `max_delegation_depth` | `number` | `5` | Maximum delegation depth |
| `detect_loops` | `boolean` | `true` | Detect delegation loops |
| `warn_on_deep_chain` | `boolean` | `true` | Warn on deep delegation chains |
| `retry_max_attempts` | `number` | `3` | Maximum retry attempts |
| `retry_initial_delay_ms` | `number` | `1000` | Initial retry delay (ms) |
| `retry_max_delay_ms` | `number` | `30000` | Maximum retry delay (ms) |

### Documentation Delegation

**`governance.docs_blocking`**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable docs delegation enforcement |
| `mode` | `"warn" \| "block" \| "disabled"` | `"block"` | Enforcement mode |

### Artifact Truncation

**`governance.artifact_truncation`**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable artifact truncation |
| `max_summary_tokens` | `number` | `200` | Maximum summary tokens |
| `max_output_chars` | `number` | `4000` | Maximum output characters |
| `keep_task_metadata` | `boolean` | `true` | Keep task metadata in truncated output |

### Delegation Compliance

**`governance.delegation_compliance`**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable delegation compliance tracking |
| `track_violations` | `boolean` | `true` | Track policy violations |
| `strikes_to_block` | `number` | `3` | Violations before blocking |

### Workflow State Enforcer

**`governance.workflow_state_enforcer`**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable workflow state enforcement |
| `mode` | `"warn" \| "block" \| "disabled"` | `"warn"` | Enforcement mode |
| `workflow_agents` | `Record<string, string>` | See below | Command to agent mapping |
| `prerequisites` | `Record<string, string[]>` | See below | Command prerequisites |

**Default `workflow_agents`**:
```json
{
  "/specify": "product-strategist",
  "/plan": "strategic-planner",
  "/tasks": "task-planner"
}
```

**Default `prerequisites`**:
```json
{
  "/plan": ["spec.md"],
  "/tasks": ["plan.md"],
  "/implement": ["tasks.md"],
  "/review": ["spec.md"],
  "/test": ["spec.md"]
}
```

### Read-Before-Write Enforcement

**`governance.read_before_write`** (LIF-103)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable read-before-write enforcement |
| `mode` | `"block" \| "warn" \| "disabled"` | `"block"` | Enforcement mode |
| `exempt_tools` | `string[]` | See below | Tools exempt from enforcement |
| `exempt_paths` | `string[]` | See below | Path patterns exempt from enforcement |

**Default `exempt_tools`**:
```json
[
  "lsp_rename",
  "lsp_code_action_resolve",
  "ast_grep_replace",
  "memory_write",
  "memory_edit",
  "memory_delete",
  "create_spec_folder",
  "update_workflow_state"
]
```

**Default `exempt_paths`**:
```json
[
  "dist/**",
  "build/**",
  "node_modules/**",
  ".git/**"
]
```

### Example Governance Configuration

```json
{
  "governance": {
    "path_validation": {
      "enabled": true,
      "mode": "block",
      "allowed_paths": ["src/", "docs/", "tests/"]
    },
    "historian": {
      "enabled": true,
      "auto_create": true,
      "changelog_path": "docs/changelog/",
      "min_changes": 2
    },
    "linear": {
      "enabled": true,
      "team_prefix": "PROJ",
      "policy": "required"
    },
    "hook_health": {
      "enabled": true,
      "circuit_breaker_threshold": 5,
      "slow_hook_threshold_ms": 2000
    },
    "read_before_write": {
      "enabled": true,
      "mode": "block"
    }
  }
}
```

---

## Memory Tools Configuration

**`memory_tools`** (LIF-73)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable memory tools |
| `memory_path` | `string` | `"context/memory/"` | Base path for memory files |

### Example

```json
{
  "memory_tools": {
    "enabled": true,
    "memory_path": "context/memory/"
  }
}
```

---

## Meta-Learning Configuration

**`meta_learning`** (LIF-73)

Controls the self-improving meta-learning system that extracts insights from development sessions.

| Option | Type | Range | Default | Description |
|--------|------|-------|---------|-------------|
| `enabled` | `boolean` | - | `true` | Enable meta-learning extraction |
| `signal_threshold` | `number` | `0` to `10` | `3` | Minimum signal score to trigger extraction |
| `cooldown_minutes` | `number` | `>= 0` | `30` | Minutes between extractions per session |
| `context_threshold_percent` | `number` | `0` to `100` | `60` | Context usage % to trigger extraction |
| `max_candidates_per_session` | `number` | `1` to `10` | `3` | Maximum learnings to extract per session |
| `min_confidence` | `number` | `0` to `1` | `0.5` | Minimum confidence score for candidates |
| `max_extractions_per_day` | `number` | `>= 1` | `10` | Maximum extractions per day (budget control) |
| `storage_path` | `string` | - | `"context/learnings/"` | Directory for learning output |

### Example

```json
{
  "meta_learning": {
    "enabled": true,
    "signal_threshold": 5,
    "cooldown_minutes": 45,
    "context_threshold_percent": 70,
    "max_candidates_per_session": 5,
    "min_confidence": 0.7,
    "max_extractions_per_day": 15,
    "storage_path": "context/learnings/"
  }
}
```

### Signal Scoring

The meta-learning system assigns points based on session quality:

| Signal Type | Points | Examples |
|-------------|--------|----------|
| **Strong** | +3 | Memory file edits, shared utilities, architecture changes, cross-file refactoring |
| **Medium** | +2 | Decision language ("decided to...", "chose X over Y"), pattern identification |
| **Weak** | +1 | New file types, config changes, dependency changes |

Extraction triggers when the total score reaches `signal_threshold`.

---

## Hook Configuration

### Available Hooks

All hooks can be disabled via the `disabled_hooks` array.

| Hook Name | Category | Description |
|-----------|----------|-------------|
| `todo-continuation-enforcer` | Productivity | Enforces completion of all TODOs before stopping |
| `context-window-monitor` | Context | Monitors context usage and reminds agents of available space |
| `session-recovery` | Productivity | Automatically recovers from session errors |
| `session-notification` | Productivity | OS notifications when sessions go idle |
| `comment-checker` | Code Quality | Detects excessive comments and requests justification |
| `grep-output-truncator` | Output | Dynamically truncates grep output based on context |
| `tool-output-truncator` | Output | Truncates output from various tools |
| `directory-agents-injector` | Context | Auto-injects AGENTS.md files when reading files |
| `directory-readme-injector` | Context | Auto-injects README.md files when reading files |
| `empty-task-response-detector` | System | Warns when Task tool returns empty response |
| `think-mode` | Productivity | Auto-enables extended thinking when needed |
| `anthropic-auto-compact` | System | Auto-compacts sessions when hitting token limits |
| `rules-injector` | Context | Conditionally injects rules from `.claude/rules/` |
| `background-notification` | System | Notifies when background tasks complete |
| `auto-update-checker` | System | Checks for plugin updates on startup |
| `startup-toast` | System | Shows welcome message on plugin load |
| `keyword-detector` | Productivity | Detects keywords and activates specialized modes |
| `agent-usage-reminder` | Productivity | Reminds to leverage specialized agents |
| `non-interactive-env` | System | Detects non-interactive environments |
| `interactive-bash-session` | System | Manages interactive bash sessions via tmux |
| `governance-path-validator` | Governance | Validates file paths on write operations |
| `governance-historian` | Governance | Tracks file changes and creates changelogs |
| `governance-linear-injector` | Governance | Injects Linear issue context into prompts |
| `governance-docs-delegation` | Governance | Enforces documentation delegation |
| `hook-health-manager` | Governance | Circuit breaker and metrics for hooks |
| `git-safety-validator` | Governance | Validates git operations for safety |
| `security-scanner` | Governance | Scans for secrets in file operations |
| `conflict-detector` | Governance | Detects file conflicts |
| `workflow-state-enforcer` | Governance | Enforces workflow prerequisites |
| `meta-learning-extractor` | Meta-Learning | Extracts learnings from sessions |
| `read-before-write` | Governance | Enforces reading files before editing (LIF-103) |

### Example

```json
{
  "disabled_hooks": [
    "comment-checker",
    "think-mode",
    "session-notification"
  ]
}
```

---

## MCP Configuration

### Available MCPs

| MCP Name | Description |
|----------|-------------|
| `websearch_exa` | Real-time web search powered by Exa AI |
| `context7` | Official documentation lookup for libraries |
| `grep_app` | Ultra-fast code search across public GitHub repositories |

All MCPs are enabled by default.

### Example

```json
{
  "disabled_mcps": ["context7"]
}
```

---

## Complete Example Configuration

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
  
  "disabled_mcps": [],
  "disabled_agents": ["mobile-xcode", "mobile-react-native"],
  "disabled_hooks": ["comment-checker"],
  
  "google_auth": true,
  
  "omo_agent": {
    "disabled": false
  },
  
  "agents": {
    "OmO": {
      "model": "anthropic/claude-opus-4-5",
      "thinking": {
        "type": "enabled",
        "budget_tokens": 32000
      }
    },
    "oracle": {
      "model": "openai/o1",
      "reasoning_effort": "high"
    },
    "explore": {
      "permission": {
        "bash": "deny",
        "edit": "deny"
      }
    }
  },
  
  "claude_code": {
    "mcp": true,
    "commands": true,
    "skills": true,
    "agents": true,
    "hooks": true
  },
  
  "governance": {
    "path_validation": {
      "enabled": true,
      "mode": "warn",
      "allowed_paths": ["src/", "docs/", "tests/", ".opencode/"]
    },
    "historian": {
      "enabled": true,
      "auto_create": true,
      "changelog_path": "changelog/",
      "min_changes": 1
    },
    "linear": {
      "enabled": true,
      "team_prefix": "LIF",
      "policy": "optional"
    },
    "read_before_write": {
      "enabled": true,
      "mode": "block"
    }
  },
  
  "memory_tools": {
    "enabled": true,
    "memory_path": "context/memory/"
  },
  
  "meta_learning": {
    "enabled": true,
    "signal_threshold": 3,
    "cooldown_minutes": 30,
    "context_threshold_percent": 60,
    "max_candidates_per_session": 3,
    "min_confidence": 0.5,
    "max_extractions_per_day": 10,
    "storage_path": "context/learnings/"
  }
}
```

---

## See Also

- [Architecture: Configuration System](../architecture/08-configuration.md) - High-level overview
- [Agent Configuration Guide](../guides/agent-configuration.md) - Agent-specific configuration
- [Meta-Learning System](../guides/meta-learning.md) - Meta-learning feature guide
