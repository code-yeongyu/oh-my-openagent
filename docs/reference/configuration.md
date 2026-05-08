# Configuration Reference

This reference documents the current runtime behavior for Oh My OpenAgent plugin config loading and validation.

During the rename transition, both basenames are accepted:

- Preferred: `oh-my-openagent.jsonc` or `oh-my-openagent.json`
- Legacy: `oh-my-opencode.jsonc` or `oh-my-opencode.json`

## Format and Naming Rules

- Config format: JSONC (`//` comments, `/* */` comments, trailing commas)
- Key style: `snake_case`
- Validation: Zod v4 schema validation
- Auto-migration: legacy keys and values are migrated by `migrateConfigFile()`

Schema autocomplete:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-openagent.schema.json",
}
```

## File Discovery and Merge Order

Load order (`src/plugin-config.ts`):

1. User config in OpenCode config dir (`~/.config/opencode` on macOS/Linux, `%APPDATA%\\opencode` on Windows)
2. Walked project configs from the current directory up to `$HOME` (closer directory wins)

When current directory is outside `$HOME`, walking is pinned to that directory.

### Merge semantics

- Deep merge: `agents`, `categories`, `team_mode`, `claude_code`
- Set union (dedup arrays):
  - `agent_definitions`
  - `disabled_agents`
  - `disabled_mcps`
  - `disabled_hooks`
  - `disabled_commands`
  - `disabled_skills`
  - `disabled_tools`
  - `mcp_env_allowlist` (during merge phase)
- Override replace: all other keys

Security rule: final `mcp_env_allowlist` is forced to user-config only. Walked/project configs cannot extend it.

## Migration Behavior

- Legacy basename can be migrated to canonical basename automatically.
- Config migrations are idempotent and tracked using migration sidecar state (plus legacy `_migrations` compatibility handling).
- When content changes, migration writes timestamped backups like `*.bak.<ISO timestamp>`.

## Top-level Key Reference

Types/defaults below are from `assets/oh-my-openagent.schema.json`.

| Key | Type | Default |
| --- | --- | --- |
| `$schema` | `string` | none |
| `_migrations` | `string[]` | none |
| `agent_definitions` | `string[]` | none |
| `agents` | `object` | none |
| `auto_update` | `boolean` | none |
| `babysitting` | `object` | none |
| `background_task` | `object` | none |
| `browser_automation_engine` | `object` | none |
| `categories` | `object` | none |
| `claude_code` | `object` | none |
| `comment_checker` | `object` | none |
| `default_run_agent` | `string` | none |
| `disabled_agents` | `string[]` | none |
| `disabled_commands` | `string[]` | none |
| `disabled_hooks` | `string[]` | none |
| `disabled_mcps` | `string[]` | none |
| `disabled_skills` | `string[]` | none |
| `disabled_tools` | `string[]` | none |
| `experimental` | `object` | none |
| `git_master` | `object` | `{ "commit_footer": true, "include_co_authored_by": true, "git_env_prefix": "GIT_MASTER=1" }` |
| `hashline_edit` | `boolean` | none |
| `keyword_detector` | `object` | none |
| `mcp_env_allowlist` | `string[]` | none |
| `model_capabilities` | `object` | none |
| `model_fallback` | `boolean` | none |
| `new_task_system_enabled` | `boolean` | none |
| `notification` | `object` | none |
| `openclaw` | `object` | none |
| `ralph_loop` | `object` | none |
| `runtime_fallback` | `boolean \| object` | none |
| `sisyphus` | `object` | none |
| `sisyphus_agent` | `object` | none |
| `skills` | `string[] \| object` | none |
| `start_work` | `object` | none |
| `team_mode` | `object` | none |
| `tmux` | `object` | none |
| `websearch` | `object` | none |

## High-use Sections

### `team_mode` (all fields)

```jsonc
{
  "team_mode": {
    "enabled": false,
    "tmux_visualization": false,
    "max_parallel_members": 4,
    "max_members": 8,
    "max_messages_per_run": 10000,
    "max_wall_clock_minutes": 120,
    "max_member_turns": 500,
    "base_dir": "/custom/path", // optional
    "message_payload_max_bytes": 32768,
    "recipient_unread_max_bytes": 262144,
    "mailbox_poll_interval_ms": 3000,
  },
}
```

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | Master switch |
| `tmux_visualization` | `boolean` | `false` | Visual tmux mode |
| `max_parallel_members` | `integer` | `4` | Range `1..8` |
| `max_members` | `integer` | `8` | Range `1..8` |
| `max_messages_per_run` | `integer` | `10000` | Minimum `1` |
| `max_wall_clock_minutes` | `integer` | `120` | Minimum `1` |
| `max_member_turns` | `integer` | `500` | Minimum `1` |
| `base_dir` | `string` | none | Optional override path |
| `message_payload_max_bytes` | `integer` | `32768` | Minimum `1024` |
| `recipient_unread_max_bytes` | `integer` | `262144` | Minimum `1024` |
| `mailbox_poll_interval_ms` | `integer` | `3000` | Minimum `500` |

### `tmux`

| Field | Type | Default |
| --- | --- | --- |
| `enabled` | `boolean` | `false` |
| `layout` | `string` | `"main-vertical"` |
| `main_pane_size` | `number` | `60` |
| `main_pane_min_width` | `number` | `120` |
| `agent_pane_min_width` | `number` | `40` |
| `isolation` | `string` | `"inline"` |

### `background_task`

| Field | Type | Default |
| --- | --- | --- |
| `defaultConcurrency` | `number` | none |
| `providerConcurrency` | `object` | none |
| `modelConcurrency` | `object` | none |
| `maxDepth` | `integer` | none |
| `staleTimeoutMs` | `number` | none |
| `messageStalenessTimeoutMs` | `number` | none |
| `taskTtlMs` | `number` | none |
| `sessionGoneTimeoutMs` | `number` | none |
| `syncPollTimeoutMs` | `number` | none |
| `maxToolCalls` | `integer` | none |
| `circuitBreaker` | `object` | none |

### `experimental`

| Field | Type | Default |
| --- | --- | --- |
| `aggressive_truncation` | `boolean` | none |
| `auto_resume` | `boolean` | none |
| `preemptive_compaction` | `boolean` | none |
| `truncate_all_tool_outputs` | `boolean` | none |
| `dynamic_context_pruning` | `object` | none |
| `task_system` | `boolean` | none |
| `plugin_load_timeout_ms` | `number` | none |
| `safe_hook_creation` | `boolean` | none |
| `disable_omo_env` | `boolean` | none |
| `hashline_edit` | `boolean` | none |
| `model_fallback_title` | `boolean` | none |
| `max_tools` | `integer` | none |

### `openclaw`

| Field | Type | Default |
| --- | --- | --- |
| `enabled` | `boolean` | `false` |
| `gateways` | `object` | `{}` |
| `hooks` | `object` | `{}` |
| `replyListener` | `object` | none |

### `sisyphus_agent`

| Field | Type | Default |
| --- | --- | --- |
| `disabled` | `boolean` | none |
| `default_builder_enabled` | `boolean` | none |
| `planner_enabled` | `boolean` | none |
| `replace_plan` | `boolean` | none |
| `tdd` | `boolean` | `true` |

### `git_master`

| Field | Type | Default |
| --- | --- | --- |
| `commit_footer` | `boolean \| string` | `true` |
| `include_co_authored_by` | `boolean` | `true` |
| `git_env_prefix` | `string` | `"GIT_MASTER=1"` |

### `model_capabilities`

| Field | Type | Default |
| --- | --- | --- |
| `enabled` | `boolean` | none |
| `auto_refresh_on_start` | `boolean` | none |
| `refresh_timeout_ms` | `integer` | none |
| `source_url` | `string` | none |

### `browser_automation_engine`

| Field | Type | Default |
| --- | --- | --- |
| `provider` | `string` | `"playwright"` |

### `notification`, `comment_checker`, `keyword_detector`, `websearch`, `ralph_loop`, `babysitting`, `start_work`

| Key | Field | Type | Default |
| --- | --- | --- | --- |
| `notification` | `force_enable` | `boolean` | none |
| `comment_checker` | `custom_prompt` | `string` | none |
| `keyword_detector` | `disabled_keywords` | `string[]` | none |
| `websearch` | `provider` | `string` | none |
| `ralph_loop` | `enabled` | `boolean` | `false` |
| `ralph_loop` | `default_max_iterations` | `number` | `100` |
| `ralph_loop` | `state_dir` | `string` | none |
| `ralph_loop` | `default_strategy` | `string` | `"continue"` |
| `babysitting` | `timeout_ms` | `number` | `120000` |
| `start_work` | `auto_commit` | `boolean` | `true` |

## Agents, Categories, Skills

- `agents`: per-agent overrides. Built-ins include `sisyphus`, `hephaestus`, `prometheus`, `oracle`, `librarian`, `explore`, `atlas`, `metis`, `momus`, `multimodal-looker`, `sisyphus-junior`.
- `categories`: category-level model and prompt routing overrides.
- `skills`: either array form or object form.
- `disabled_agents`, `disabled_skills`, `disabled_hooks`, `disabled_tools`, `disabled_commands`, `disabled_mcps`: string arrays.

## Runtime and Model Fallback

- `model_fallback`: global switch for proactive model fallback behavior.
- `runtime_fallback`: boolean or object config for reactive fallback behavior.
- Provider/model fallback chains are defined in code (`src/shared/model-requirements.ts`).

## Verified JSONC Example

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-openagent.schema.json",
  "agents": {
    "sisyphus": { "model": "anthropic/claude-opus-4-7" },
    "explore": { "model": "github-copilot/grok-code-fast-1" },
  },
  "categories": {
    "quick": { "model": "opencode/gpt-5-nano" },
    "deep": { "model": "openai/gpt-5.5" },
  },
  "disabled_hooks": ["startup-toast"],
  "team_mode": {
    "enabled": true,
    "max_parallel_members": 4,
    "max_members": 8,
    "max_messages_per_run": 10000,
    "max_wall_clock_minutes": 120,
    "max_member_turns": 500,
    "message_payload_max_bytes": 32768,
    "recipient_unread_max_bytes": 262144,
    "mailbox_poll_interval_ms": 3000,
    "tmux_visualization": false,
  },
  "tmux": { "enabled": false },
}
```
