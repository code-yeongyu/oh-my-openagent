# Configuration Reference

Complete reference for `oh-my-opencode.jsonc` configuration. This document covers every available option with examples.

---

## Table of Contents

- [Getting Started](#getting-started)
  - [File Locations](#file-locations)
  - [Quick Start Example](#quick-start-example)
- [Core Concepts](#core-concepts)
  - [Agents](#agents)
  - [Categories](#categories)
  - [Model Resolution](#model-resolution)
- [Athena Council](#athena-council)
  - [Council Members](#council-members)
  - [Council Resilience](#council-resilience)
  - [Launch Strategy](#launch-strategy)
  - [Non-Interactive Mode](#non-interactive-mode-athena-junior)
  - [Council Tools](#council-tools)
  - [Council Archives](#council-archives)
  - [Background Behavior](#background-behavior)
  - [Council-Member Agent](#council-member-agent)
- [Task System](#task-system)
  - [Background Tasks](#background-tasks)
  - [Sisyphus Agent](#sisyphus-agent)
  - [Sisyphus Tasks](#sisyphus-tasks)
- [Features](#features)
  - [Skills](#skills)
  - [Hooks](#hooks)
  - [Commands](#commands)
  - [Browser Automation](#browser-automation)
  - [Tmux Integration](#tmux-integration)
  - [Git Master](#git-master)
  - [Comment Checker](#comment-checker)
  - [Notification](#notification)
  - [MCPs](#mcps)
  - [LSP](#lsp)
- [Advanced](#advanced)
  - [Runtime Fallback](#runtime-fallback)
  - [Hashline Edit](#hashline-edit)
  - [Experimental](#experimental)
- [Reference](#reference)
  - [Environment Variables](#environment-variables)
  - [Provider-Specific](#provider-specific)

---

## Getting Started

### File Locations

Priority order (project overrides user):

1. `.opencode/oh-my-opencode.jsonc` / `.opencode/oh-my-opencode.json`
2. User config (`.jsonc` preferred over `.json`):

| Platform    | Path                                      |
| ----------- | ----------------------------------------- |
| macOS/Linux | `~/.config/opencode/oh-my-opencode.jsonc` |
| Windows     | `%APPDATA%\opencode\oh-my-opencode.jsonc` |

JSONC supports `// line comments`, `/* block comments */`, and trailing commas.

Enable schema autocomplete:

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json"
}
```

Run `bunx oh-my-opencode install` for guided setup. Run `opencode models` to list available models.

### Quick Start Example

Here's a practical starting configuration:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json",

  "agents": {
    // Main orchestrator: Claude Opus or Kimi K2.5 work best
    "sisyphus": {
      "model": "kimi-for-coding/k2p5",
      "ultrawork": { "model": "anthropic/claude-opus-4-6", "variant": "max" },
    },

    // Research agents: cheap fast models are fine
    "librarian": { "model": "google/gemini-3-flash" },
    "explore": { "model": "github-copilot/grok-code-fast-1" },

    // Architecture consultation: GPT-5.4 or Claude Opus
    "oracle": { "model": "openai/gpt-5.4", "variant": "high" },

    // Prometheus inherits sisyphus model; just add prompt guidance
    "prometheus": {
      "prompt_append": "Leverage deep & quick agents heavily, always in parallel.",
    },
  },

  "categories": {
    // quick — trivial tasks
    "quick": { "model": "opencode/gpt-5-nano" },

    // unspecified-low — moderate tasks
    "unspecified-low": { "model": "anthropic/claude-sonnet-4-6" },

    // unspecified-high — complex work
    "unspecified-high": { "model": "openai/gpt-5.4-high" },

    // writing — docs/prose
    "writing": { "model": "google/gemini-3-flash" },

    // visual-engineering — Gemini dominates visual tasks
    "visual-engineering": {
      "model": "google/gemini-3.1-pro",
      "variant": "high",
    },

    // Custom category for git operations
    "git": {
      "model": "opencode/gpt-5-nano",
      "description": "All git operations",
      "prompt_append": "Focus on atomic commits, clear messages, and safe operations.",
    },
  },

  // Limit expensive providers; let cheap ones run freely
  "background_task": {
    "providerConcurrency": {
      "anthropic": 3,
      "openai": 3,
      "opencode": 10,
      "zai-coding-plan": 10,
    },
    "modelConcurrency": {
      "anthropic/claude-opus-4-6": 2,
      "opencode/gpt-5-nano": 20,
    },
  },

  "experimental": { "aggressive_truncation": true, "task_system": true },
  "tmux": { "enabled": false },
}
```

---

## Core Concepts

### Agents

Override built-in agent settings. Available agents: `sisyphus`, `hephaestus`, `prometheus`, `athena`, `athena-junior`, `oracle`, `librarian`, `explore`, `multimodal-looker`, `metis`, `momus`, `atlas`, `council-member`.

```json
{
  "agents": {
    "explore": { "model": "anthropic/claude-haiku-4-5", "temperature": 0.5 },
    "multimodal-looker": { "disable": true }
  }
}
```

Disable agents entirely: `{ "disabled_agents": ["oracle", "multimodal-looker"] }`

#### Agent Options

| Option            | Type          | Description                                            |
| ----------------- | ------------- | ------------------------------------------------------ |
| `model`           | string        | Model override (`provider/model`)                      |
| `fallback_models` | string\|array | Fallback models on API errors                          |
| `temperature`     | number        | Sampling temperature                                   |
| `top_p`           | number        | Top-p sampling                                         |
| `prompt`          | string        | Replace system prompt                                  |
| `prompt_append`   | string        | Append to system prompt                                |
| `tools`           | array         | Allowed tools list                                     |
| `disable`         | boolean       | Disable this agent                                     |
| `mode`            | string        | Agent mode                                             |
| `color`           | string        | UI color                                               |
| `permission`      | object        | Per-tool permissions (see below)                       |
| `category`        | string        | Inherit model from category                            |
| `variant`         | string        | Model variant: `max`, `high`, `medium`, `low`, `xhigh` |
| `maxTokens`       | number        | Max response tokens                                    |
| `thinking`        | object        | Anthropic extended thinking                            |
| `reasoningEffort` | string        | OpenAI reasoning: `low`, `medium`, `high`, `xhigh`     |
| `textVerbosity`   | string        | Text verbosity: `low`, `medium`, `high`                |
| `providerOptions` | object        | Provider-specific options                              |

#### Anthropic Extended Thinking

```json
{
  "agents": {
    "oracle": { "thinking": { "type": "enabled", "budgetTokens": 200000 } }
  }
}
```

#### Agent Permissions

Use `prompt_append` to add extra instructions without replacing the default system prompt:

```json
{
  "agents": {
    "librarian": {
      "prompt_append": "Always use the elisp-dev-mcp for Emacs Lisp documentation lookups."
    }
  }
}
```

You can also override settings for `Sisyphus` (the main orchestrator) and `build` (the default agent) using the same options.

### Athena Council

Athena is a multi-model council orchestrator. It launches multiple AI models to independently analyze the same question, then synthesizes their responses by agreement level. Requires at least 2 council members.

There are two variants:
- **Athena** (primary agent) — Interactive. Asks the user to confirm member selection, analysis mode, and intent before launching.
- **Athena-Junior** (subagent) — Non-interactive. Invoked programmatically via `task(subagent_type="athena-junior")` or CLI `oh-my-opencode run`. Returns structured `<athena_council_result>` JSON.

### Council Members

```jsonc
{
  "agents": {
    "athena": {
      "council": {
        "members": [
          { "model": "anthropic/claude-opus-4-6", "name": "Claude" },
          { "model": "openai/gpt-5.2", "name": "GPT" },
          { "model": "google/gemini-3-pro", "name": "Gemini" },
          { "model": "x-ai/grok-3", "name": "Grok" }
        ]
      }
    }
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `model` | Yes | Provider/model ID (e.g., `openai/gpt-5.2`) |
| `name` | Yes | Display name (must be unique, alphanumeric + spaces/hyphens/dots) |
| `variant` | No | Model variant override |
| `temperature` | No | Temperature override (0–2) |

Minimum 2 members required. The installer (`bunx oh-my-opencode install`) auto-configures council members based on your available providers.

### Council Resilience

Control retry behavior, stuck detection, and member timeouts:

```jsonc
{
  "agents": {
    "athena": {
      "council": {
        "members": [/* ... */],
        "retry_on_fail": 1,
        "retry_failed_if_others_finished": true,
        "cancel_retrying_on_quorum": true,
        "stuck_threshold_seconds": 120,
        "member_max_running_seconds": 1800
      }
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `retry_on_fail` | number | `0` | Retry attempts per failed member (0–5) |
| `retry_failed_if_others_finished` | boolean | `false` | Retry failed members only after others complete |
| `cancel_retrying_on_quorum` | boolean | `true` | Stop retrying once enough members succeed (quorum = 2) |
| `stuck_threshold_seconds` | number | `120` | Seconds of inactivity before a member is considered stuck |
| `member_max_running_seconds` | number | `1800` | Hard timeout per member (30 minutes default) |

### Launch Strategy

By default, Athena launches council members one-by-one via `task()` calls, which makes each member visible as a separate task in the TUI. Set `bulk_launch` to launch all members at once via the `athena_council` tool instead:

```jsonc
{
  "agents": {
    "athena": {
      "bulk_launch": true,
      "council": { "members": [/* ... */] }
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `bulk_launch` | boolean | `false` | `false` = launch members one-by-one via `task()` (TUI-inspectable). `true` = launch all at once via `athena_council` tool. |

### Non-Interactive Mode (Athena-Junior)

Athena-Junior is invoked programmatically — it does not use the Question tool. Configure its behavior under `agents.athena`:

```jsonc
{
  "agents": {
    "athena": {
      "council": {
        "members": [
          { "model": "anthropic/claude-opus-4-6", "name": "Claude" },
          { "model": "openai/gpt-5.2", "name": "GPT" }
        ]
      },
      // Non-interactive settings (used by athena-junior)
      "non_interactive_mode": "delegation",
      "non_interactive_members": "custom",
      "non_interactive_member_list": ["Claude", "GPT"]
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `non_interactive_mode` | `"delegation"` \| `"solo"` | `"delegation"` | How council members analyze. `delegation` = members delegate to explore/librarian subagents (faster). `solo` = members explore the codebase themselves (more thorough). |
| `non_interactive_members` | `"all"` \| `"custom"` | `"all"` | Which members to use. `all` = all configured members. `custom` = only those in `non_interactive_member_list`. |
| `non_interactive_member_list` | string[] | — | Member names when `non_interactive_members` is `"custom"`. Must match names from `council.members`. |

These settings are injected into Athena-Junior's prompt at runtime. The interactive Athena agent asks users these questions via the Question tool instead.

#### Invoking Athena-Junior

From another agent (e.g., Sisyphus):
```
task(subagent_type="athena-junior", load_skills=[], description="...", prompt="...", run_in_background=true)
```

From CLI:
```bash
bunx oh-my-opencode run --agent athena-junior --prompt "Analyze the auth module"
```

### Council Tools

Three specialized tools power the council workflow. They are **globally denied** to all agents except Athena and Athena-Junior:

| Tool | Purpose |
|------|---------|
| `prepare_council_prompt` | Saves the analysis prompt to a temp file for efficient sharing across members |
| `athena_council` | Launches all council members in parallel as background tasks |
| `council_finalize` | Extracts `<COUNCIL_MEMBER_RESPONSE>` content from each member, creates archives, injects synthesis guidance |

No configuration needed — permissions are enforced automatically.

### Council Archives

After synthesis, council results are archived to `.sisyphus/athena/council-{name}-{id}/` with:
- Individual member response files
- `meta.yaml` with session metadata (members, models, timestamps)

### Background Behavior

Athena-Junior is always executed as a background task, regardless of the caller's `run_in_background` setting. This prevents the 10-minute sync poll timeout from killing long council sessions.

Additionally, Athena-Junior is exempt from the standard 30-minute background task TTL (`TASK_TTL_MS`). Council members are independent background tasks with their own TTLs, so the orchestrator needs to outlive them.

### Council-Member Agent

Council members are dynamically registered as agents named `"Council: {name}"` (e.g., `"Council: Claude"`). Override council-member defaults under `agents.council-member`:

```jsonc
{
  "agents": {
    "council-member": {
      "temperature": 0.3,
      "prompt_append": "Focus on security implications."
    }
  }
}
```

Council members have a restricted tool allowlist: `read`, `grep`, `glob`, `lsp_*`, `ast_grep_search`, `call_omo_agent`, `background_output`, `background_wait`, and `background_cancel`. In delegation mode, members use `call_omo_agent` to delegate searches to explore/librarian. In solo mode, delegation is restricted via prompt instruction. They cannot write or edit files.

### Permission Options

Control what tools an agent can use:

```json
{
  "agents": {
    "explore": {
      "permission": {
        "edit": "deny",
        "bash": "ask",
        "webfetch": "allow"
      }
    }
  }
}
```

| Permission           | Values                                                                      |
| -------------------- | --------------------------------------------------------------------------- |
| `edit`               | `ask` / `allow` / `deny`                                                    |
| `bash`               | `ask` / `allow` / `deny` or per-command: `{ "git": "allow", "rm": "deny" }` |
| `webfetch`           | `ask` / `allow` / `deny`                                                    |
| `doom_loop`          | `ask` / `allow` / `deny`                                                    |
| `external_directory` | `ask` / `allow` / `deny`                                                    |

### Categories

Domain-specific model delegation used by the `task()` tool. When Sisyphus delegates work, it picks a category, not a model name.

Available agents: `sisyphus`, `hephaestus`, `prometheus`, `athena`, `athena-junior`, `oracle`, `librarian`, `explore`, `multimodal-looker`, `metis`, `momus`, `atlas`

#### Built-in Categories

| Category             | Default Model                   | Description                                    |
| -------------------- | ------------------------------- | ---------------------------------------------- |
| `visual-engineering` | `google/gemini-3.1-pro` (high)  | Frontend, UI/UX, design, animation             |
| `ultrabrain`         | `openai/gpt-5.3-codex` (xhigh)  | Deep logical reasoning, complex architecture   |
| `deep`               | `openai/gpt-5.3-codex` (medium) | Autonomous problem-solving, thorough research  |
| `artistry`           | `google/gemini-3.1-pro` (high)  | Creative/unconventional approaches             |
| `quick`              | `anthropic/claude-haiku-4-5`    | Trivial tasks, typo fixes, single-file changes |
| `unspecified-low`    | `anthropic/claude-sonnet-4-6`   | General tasks, low effort                      |
| `unspecified-high`   | `openai/gpt-5.4` (high)         | General tasks, high effort                     |
| `writing`            | `google/gemini-3-flash`         | Documentation, prose, technical writing        |

> **Note**: Built-in defaults only apply if the category is present in your config. Otherwise the system default model is used.

#### Category Options

| Option              | Type          | Default | Description                                                         |
| ------------------- | ------------- | ------- | ------------------------------------------------------------------- |
| `model`             | string        | -       | Model override                                                      |
| `fallback_models`   | string\|array | -       | Fallback models on API errors                                       |
| `temperature`       | number        | -       | Sampling temperature                                                |
| `top_p`             | number        | -       | Top-p sampling                                                      |
| `maxTokens`         | number        | -       | Max response tokens                                                 |
| `thinking`          | object        | -       | Anthropic extended thinking                                         |
| `reasoningEffort`   | string        | -       | OpenAI reasoning effort                                             |
| `textVerbosity`     | string        | -       | Text verbosity                                                      |
| `tools`             | array         | -       | Allowed tools                                                       |
| `prompt_append`     | string        | -       | Append to system prompt                                             |
| `variant`           | string        | -       | Model variant                                                       |
| `description`       | string        | -       | Shown in `task()` tool prompt                                       |
| `is_unstable_agent` | boolean       | `false` | Force background mode + monitoring. Auto-enabled for Gemini models. |

Disable categories: `{ "disabled_categories": ["ultrabrain"] }`

### Model Resolution

3-step priority at runtime:

1. **User override** — model set in config → used exactly as-is
2. **Provider fallback chain** — tries each provider in priority order until available
3. **System default** — falls back to OpenCode's configured default model

#### Agent Provider Chains

| Agent                 | Default Model       | Provider Priority                                                                                                 |
| --------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Sisyphus**          | `claude-opus-4-6`   | `claude-opus-4-6` → `glm-5` → `big-pickle`                                                                        |
| **Hephaestus**        | `gpt-5.3-codex`     | `gpt-5.3-codex` → `gpt-5.4` (GitHub Copilot fallback)                                                             |
| **oracle**            | `gpt-5.4`           | `gpt-5.4` → `gemini-3.1-pro` → `claude-opus-4-6`                                                                  |
| **librarian**         | `gemini-3-flash`    | `gemini-3-flash` → `minimax-m2.5-free` → `big-pickle`                                                             |
| **explore**           | `grok-code-fast-1`  | `grok-code-fast-1` → `minimax-m2.5-free` → `claude-haiku-4-5` → `gpt-5-nano`                                      |
| **multimodal-looker** | `gpt-5.3-codex`     | `gpt-5.3-codex` → `k2p5` → `gemini-3-flash` → `glm-4.6v` → `gpt-5-nano`                                           |
| **Prometheus**        | `claude-opus-4-6`   | `claude-opus-4-6` → `gpt-5.4` → `gemini-3.1-pro`                                                                  |
| **Metis**             | `claude-opus-4-6`   | `claude-opus-4-6` → `gpt-5.4` → `gemini-3.1-pro`                                                                  |
| **Momus**             | `gpt-5.4`           | `gpt-5.4` → `claude-opus-4-6` → `gemini-3.1-pro`                                                                  |
| **Atlas**             | `claude-sonnet-4-6` | `claude-sonnet-4-6` → `gpt-5.4`                                                                                   |
| **Sisyphus-Junior**   | `claude-sonnet-4-6` | `claude-sonnet-4-6` → `gpt-5.4` → `gemini-3-flash`                                                                |
| **Athena**            | `claude-opus-4-6`   | `claude-opus-4-6` → `kimi-k2.5-free` → `glm-4.7` → `glm-4.7-free` → `gpt-5.2` → `gemini-3-pro`                 |
| **Athena-Junior**     | `claude-opus-4-6`   | `claude-opus-4-6` → `kimi-k2.5-free` → `glm-4.7` → `glm-4.7-free` → `gpt-5.2` → `gemini-3-pro`                 |

#### Category Provider Chains

| Category               | Default Model       | Provider Priority                                              |
| ---------------------- | ------------------- | -------------------------------------------------------------- |
| **visual-engineering** | `gemini-3.1-pro`    | `gemini-3.1-pro` → `glm-5` → `claude-opus-4-6`                 |
| **ultrabrain**         | `gpt-5.3-codex`     | `gpt-5.3-codex` → `gemini-3.1-pro` → `claude-opus-4-6`         |
| **deep**               | `gpt-5.3-codex`     | `gpt-5.3-codex` → `claude-opus-4-6` → `gemini-3.1-pro`         |
| **artistry**           | `gemini-3.1-pro`    | `gemini-3.1-pro` → `claude-opus-4-6` → `gpt-5.4`               |
| **quick**              | `claude-haiku-4-5`  | `claude-haiku-4-5` → `gemini-3-flash` → `gpt-5-nano`           |
| **unspecified-low**    | `claude-sonnet-4-6` | `claude-sonnet-4-6` → `gpt-5.3-codex` → `gemini-3-flash`       |
| **unspecified-high**   | `gpt-5.4`           | `gpt-5.4` → `claude-opus-4-6` → `glm-5` → `k2p5` → `kimi-k2.5` |
| **writing**            | `gemini-3-flash`    | `gemini-3-flash` → `claude-sonnet-4-6`                         |

Run `bunx oh-my-opencode doctor --verbose` to see effective model resolution for your config.

---

## Task System

### Background Tasks

Control parallel agent execution and concurrency limits.

```json
{
  "background_task": {
    "defaultConcurrency": 5,
    "staleTimeoutMs": 180000,
    "providerConcurrency": { "anthropic": 3, "openai": 5, "google": 10 },
    "modelConcurrency": { "anthropic/claude-opus-4-6": 2 }
  }
}
```

| Option                | Default  | Description                                                           |
| --------------------- | -------- | --------------------------------------------------------------------- |
| `defaultConcurrency`  | -        | Max concurrent tasks (all providers)                                  |
| `staleTimeoutMs`      | `180000` | Interrupt tasks with no activity (min: 60000)                         |
| `providerConcurrency` | -        | Per-provider limits (key = provider name)                             |
| `modelConcurrency`    | -        | Per-model limits (key = `provider/model`). Overrides provider limits. |

Priority: `modelConcurrency` > `providerConcurrency` > `defaultConcurrency`

### Sisyphus Agent

Configure the main orchestration system.

```json
{
  "sisyphus_agent": {
    "disabled": false,
    "default_builder_enabled": false,
    "planner_enabled": true,
    "replace_plan": true
  }
}
```

| Option                    | Default | Description                                                     |
| ------------------------- | ------- | --------------------------------------------------------------- |
| `disabled`                | `false` | Disable all Sisyphus orchestration, restore original build/plan |
| `default_builder_enabled` | `false` | Enable OpenCode-Builder agent (off by default)                  |
| `planner_enabled`         | `true`  | Enable Prometheus (Planner) agent                               |
| `replace_plan`            | `true`  | Demote default plan agent to subagent mode                      |

Sisyphus agents can also be customized under `agents` using their names: `Sisyphus`, `OpenCode-Builder`, `Prometheus (Planner)`, `Metis (Plan Consultant)`.

### Sisyphus Tasks

Enable the Sisyphus Tasks system for cross-session task tracking.

```json
{
  "sisyphus": {
    "tasks": {
      "enabled": false,
      "storage_path": ".sisyphus/tasks",
      "claude_code_compat": false
    }
  }
}
```

| Option               | Default           | Description                                |
| -------------------- | ----------------- | ------------------------------------------ |
| `enabled`            | `false`           | Enable Sisyphus Tasks system               |
| `storage_path`       | `.sisyphus/tasks` | Storage path (relative to project root)    |
| `claude_code_compat` | `false`           | Enable Claude Code path compatibility mode |

---

## Features

### Skills

Skills bring domain-specific expertise and embedded MCPs.

Built-in skills: `playwright`, `playwright-cli`, `agent-browser`, `dev-browser`, `git-master`, `frontend-ui-ux`

Disable built-in skills: `{ "disabled_skills": ["playwright"] }`

#### Skills Configuration

```json
{
  "skills": {
    "sources": [
      { "path": "./my-skills", "recursive": true },
      "https://example.com/skill.yaml"
    ],
    "enable": ["my-skill"],
    "disable": ["other-skill"],
    "my-skill": {
      "description": "What it does",
      "template": "Custom prompt template",
      "from": "source-file.ts",
      "model": "custom/model",
      "agent": "custom-agent",
      "subtask": true,
      "argument-hint": "usage hint",
      "license": "MIT",
      "compatibility": ">= 3.0.0",
      "metadata": { "author": "Your Name" },
      "allowed-tools": ["read", "bash"]
    }
  }
}
```

| `sources` option | Default | Description                     |
| ---------------- | ------- | ------------------------------- |
| `path`           | -       | Local path or remote URL        |
| `recursive`      | `false` | Recurse into subdirectories     |
| `glob`           | -       | Glob pattern for file selection |

### Hooks

Disable built-in hooks via `disabled_hooks`:

```json
{ "disabled_hooks": ["comment-checker", "agent-usage-reminder"] }
```

Available hooks: `todo-continuation-enforcer`, `context-window-monitor`, `session-recovery`, `session-notification`, `comment-checker`, `grep-output-truncator`, `tool-output-truncator`, `directory-agents-injector`, `directory-readme-injector`, `empty-task-response-detector`, `think-mode`, `anthropic-context-window-limit-recovery`, `rules-injector`, `background-notification`, `auto-update-checker`, `startup-toast`, `keyword-detector`, `agent-usage-reminder`, `non-interactive-env`, `interactive-bash-session`, `compaction-context-injector`, `thinking-block-validator`, `claude-code-hooks`, `ralph-loop`, `preemptive-compaction`, `auto-slash-command`, `sisyphus-junior-notepad`, `no-sisyphus-gpt`, `start-work`, `runtime-fallback`

**Notes:**

- `directory-agents-injector` — auto-disabled on OpenCode 1.1.37+ (native AGENTS.md support)
- `no-sisyphus-gpt` — **do not disable**. It blocks incompatible GPT models for Sisyphus while allowing the dedicated GPT-5.4 prompt path.
- `startup-toast` is a sub-feature of `auto-update-checker`. Disable just the toast by adding `startup-toast` to `disabled_hooks`.

### Commands

Disable built-in commands via `disabled_commands`:

```json
{ "disabled_commands": ["init-deep", "start-work"] }
```

Available commands: `init-deep`, `ralph-loop`, `ulw-loop`, `cancel-ralph`, `refactor`, `start-work`, `stop-continuation`, `handoff`

### Browser Automation

| Provider               | Interface | Installation                                        |
| ---------------------- | --------- | --------------------------------------------------- |
| `playwright` (default) | MCP tools | Auto-installed via npx                              |
| `agent-browser`        | Bash CLI  | `bun add -g agent-browser && agent-browser install` |

Switch provider:

```json
{ "browser_automation_engine": { "provider": "agent-browser" } }
```

### Tmux Integration

Run background subagents in separate tmux panes. Requires running inside tmux with `opencode --port <port>`.

```json
{
  "tmux": {
    "enabled": true,
    "layout": "main-vertical",
    "main_pane_size": 60,
    "main_pane_min_width": 120,
    "agent_pane_min_width": 40
  }
}
```

| Option                 | Default         | Description                                                                         |
| ---------------------- | --------------- | ----------------------------------------------------------------------------------- |
| `enabled`              | `false`         | Enable tmux pane spawning                                                           |
| `layout`               | `main-vertical` | `main-vertical` / `main-horizontal` / `tiled` / `even-horizontal` / `even-vertical` |
| `main_pane_size`       | `60`            | Main pane % (20–80)                                                                 |
| `main_pane_min_width`  | `120`           | Min main pane columns                                                               |
| `agent_pane_min_width` | `40`            | Min agent pane columns                                                              |

### Git Master

Configure git commit behavior:

```json
{ "git_master": { "commit_footer": true, "include_co_authored_by": true } }
```

### Comment Checker

Customize the comment quality checker:

```json
{
  "comment_checker": {
    "custom_prompt": "Your message. Use {{comments}} placeholder."
  }
}
```

### Notification

Force-enable session notifications:

```json
{ "notification": { "force_enable": true } }
```

`force_enable` (`false`) — force session-notification even if external notification plugins are detected.

### MCPs

Built-in MCPs (enabled by default): `websearch` (Exa AI), `context7` (library docs), `grep_app` (GitHub code search).

```json
{ "disabled_mcps": ["websearch", "context7", "grep_app"] }
```

### LSP

Configure Language Server Protocol integration:

```json
{
  "lsp": {
    "typescript-language-server": {
      "command": ["typescript-language-server", "--stdio"],
      "extensions": [".ts", ".tsx"],
      "priority": 10,
      "env": { "NODE_OPTIONS": "--max-old-space-size=4096" },
      "initialization": {
        "preferences": { "includeInlayParameterNameHints": "all" }
      }
    },
    "pylsp": { "disabled": true }
  }
}
```

| Option           | Type    | Description                          |
| ---------------- | ------- | ------------------------------------ |
| `command`        | array   | Command to start LSP server          |
| `extensions`     | array   | File extensions (e.g. `[".ts"]`)     |
| `priority`       | number  | Priority when multiple servers match |
| `env`            | object  | Environment variables                |
| `initialization` | object  | Init options passed to server        |
| `disabled`       | boolean | Disable this server                  |

---

## Advanced

### Runtime Fallback

Auto-switches to backup models on API errors.

**Simple configuration** (enable/disable with defaults):

```json
{ "runtime_fallback": true }
{ "runtime_fallback": false }
```

**Advanced configuration** (full control):

```json
{
  "runtime_fallback": {
    "enabled": true,
    "retry_on_errors": [400, 429, 503, 529],
    "max_fallback_attempts": 3,
    "cooldown_seconds": 60,
    "timeout_seconds": 30,
    "notify_on_fallback": true
  }
}
```

| Option                  | Default             | Description                                                                                                                    |
| ----------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `enabled`               | `false`             | Enable runtime fallback                                                                                                        |
| `retry_on_errors`       | `[400,429,503,529]` | HTTP codes that trigger fallback. Also handles classified provider key errors.                                                 |
| `max_fallback_attempts` | `3`                 | Max fallback attempts per session (1–20)                                                                                       |
| `cooldown_seconds`      | `60`                | Seconds before retrying a failed model                                                                                         |
| `timeout_seconds`       | `30`                | Seconds before forcing next fallback. **Set to `0` to disable timeout-based escalation and provider retry message detection.** |
| `notify_on_fallback`    | `true`              | Toast notification on model switch                                                                                             |

Define `fallback_models` per agent or category:

```json
{
  "agents": {
    "sisyphus": {
      "model": "anthropic/claude-opus-4-6",
      "fallback_models": ["openai/gpt-5.4", "google/gemini-3.1-pro"]
    }
  }
}
```

### Hashline Edit

Replaces the built-in `Edit` tool with a hash-anchored version using `LINE#ID` references to prevent stale-line edits. Disabled by default.

```json
{ "hashline_edit": true }
```

When enabled, two companion hooks are active: `hashline-read-enhancer` (annotates Read output) and `hashline-edit-diff-enhancer` (shows diffs). Opt-in by setting `hashline_edit: true`. Disable the companion hooks individually via `disabled_hooks` if needed.

### Experimental

```json
{
  "experimental": {
    "truncate_all_tool_outputs": false,
    "aggressive_truncation": false,
    "auto_resume": false,
    "disable_omo_env": false,
    "task_system": false,
    "dynamic_context_pruning": {
      "enabled": false,
      "notification": "detailed",
      "turn_protection": { "enabled": true, "turns": 3 },
      "protected_tools": [
        "task",
        "todowrite",
        "todoread",
        "lsp_rename",
        "session_read",
        "session_write",
        "session_search"
      ],
      "strategies": {
        "deduplication": { "enabled": true },
        "supersede_writes": { "enabled": true, "aggressive": false },
        "purge_errors": { "enabled": true, "turns": 5 }
      }
    }
  }
}
```

| Option                                   | Default    | Description                                                                          |
| ---------------------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| `truncate_all_tool_outputs`              | `false`    | Truncate all tool outputs (not just whitelisted)                                     |
| `aggressive_truncation`                  | `false`    | Aggressively truncate when token limit exceeded                                      |
| `auto_resume`                            | `false`    | Auto-resume after thinking block recovery                                            |
| `disable_omo_env`                        | `false`    | Disable auto-injected `<omo-env>` block (date/time/locale). Improves cache hit rate. |
| `task_system`                            | `false`    | Enable Sisyphus task system                                                          |
| `dynamic_context_pruning.enabled`        | `false`    | Auto-prune old tool outputs to manage context window                                 |
| `dynamic_context_pruning.notification`   | `detailed` | Pruning notifications: `off` / `minimal` / `detailed`                                |
| `turn_protection.turns`                  | `3`        | Recent turns protected from pruning (1–10)                                           |
| `strategies.deduplication`               | `true`     | Remove duplicate tool calls                                                          |
| `strategies.supersede_writes`            | `true`     | Prune write inputs when file later read                                              |
| `strategies.supersede_writes.aggressive` | `false`    | Prune any write if ANY subsequent read exists                                        |
| `strategies.purge_errors.turns`          | `5`        | Turns before pruning errored tool inputs                                             |

---

## Reference

### Environment Variables

| Variable              | Description                                                       |
| --------------------- | ----------------------------------------------------------------- |
| `OPENCODE_CONFIG_DIR` | Override OpenCode config directory (useful for profile isolation) |

### Provider-Specific

#### Google Auth

Install [`opencode-antigravity-auth`](https://github.com/NoeFabris/opencode-antigravity-auth) for Google Gemini. Provides multi-account load balancing, dual quota, and variant-based thinking.

#### Ollama

**Must** disable streaming to avoid JSON parse errors:

```json
{
  "agents": {
    "explore": { "model": "ollama/qwen3-coder", "stream": false }
  }
}
```

Common models: `ollama/qwen3-coder`, `ollama/ministral-3:14b`, `ollama/lfm2.5-thinking`

See [Ollama Troubleshooting](../troubleshooting/ollama.md) for `JSON Parse error: Unexpected EOF` issues.
