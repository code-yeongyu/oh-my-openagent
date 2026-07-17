# Configuration Reference

Complete reference for Oh My OpenCode plugin configuration. During the rename transition, the runtime recognizes both `oh-my-openagent.json[c]` and legacy `oh-my-opencode.json[c]` files.

---

## Table of Contents

- [Getting Started](#getting-started)
  - [File Locations](#file-locations)
  - [Quick Start Example](#quick-start-example)
- [Core Concepts](#core-concepts)
  - [Agents](#agents)
  - [Categories](#categories)
  - [Model Resolution](#model-resolution)
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
  - [Model Capabilities](#model-capabilities)
  - [Hashline Edit](#hashline-edit)
  - [Experimental](#experimental)
- [Reference](#reference)
  - [Environment Variables](#environment-variables)
  - [Provider-Specific](#provider-specific)

---

## Getting Started

### File Locations

User config loads first. Project configs are discovered by walking from the working directory up to `$HOME`; closer configs win. If the working directory is outside `$HOME`, only that directory is checked.

1. Walked configs: `.opencode/oh-my-openagent.json[c]` or legacy `.opencode/oh-my-opencode.json[c]`
2. User config (`.jsonc` preferred over `.json`):

| Platform    | Path candidates |
| ----------- | --------------- |
| macOS/Linux | `~/.config/opencode/oh-my-openagent.json[c]`, `~/.config/opencode/oh-my-opencode.json[c]` |
| Windows     | `%APPDATA%\opencode\oh-my-openagent.json[c]`, `%APPDATA%\opencode\oh-my-opencode.json[c]` |

**Security note:** `mcp_env_allowlist` is user-only. Walked configs cannot extend it.

**Rename compatibility:** The published package and CLI binary remain `oh-my-opencode`. OpenCode plugin registration prefers `oh-my-openagent`, while legacy `oh-my-opencode` entries and config basenames still load during the transition. Config detection checks `oh-my-opencode` before `oh-my-openagent`, so if both plugin config basenames exist in the same directory, the legacy `oh-my-opencode.*` file currently wins.
JSONC supports `// line comments`, `/* block comments */`, and trailing commas.

Enable schema autocomplete:

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json"
}
```

Run `bunx oh-my-openagent install` for guided setup. Run `opencode models` to list available models.

### Quick Start Example

Here's a practical starting configuration:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json",

  "agents": {
    // Main orchestrator: Claude Opus or Kimi K2.6 work best
    "sisyphus": {
      "model": "kimi-for-coding/k2p5",
      "ultrawork": { "model": "anthropic/claude-opus-4-7", "variant": "max" },
    },

    // Research agents: cheap fast models are fine
    "librarian": { "model": "google/gemini-3-flash" },
    "explore": { "model": "github-copilot/grok-code-fast-1" },

    // Architecture consultation: GPT-5.5 or Claude Opus
    "oracle": { "model": "openai/gpt-5.5", "variant": "high" },

    // Prometheus inherits sisyphus model; just add prompt guidance
    "prometheus": {
      "prompt_append": "Leverage deep & quick agents heavily, always in parallel.",
    },
  },

  "categories": {
    // quick - trivial tasks
    "quick": { "model": "opencode/gpt-5-nano" },

    // unspecified-low - moderate tasks
    "unspecified-low": { "model": "openai/gpt-5.6-luna", "variant": "xhigh" },

    // unspecified-high - complex work
    "unspecified-high": { "model": "anthropic/claude-opus-4-7", "variant": "max" },

    // writing - docs/prose
    "writing": { "model": "kimi-for-coding/k2p5" },

    // visual-engineering - Gemini dominates visual tasks
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
      "anthropic/claude-opus-4-7": 2,
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

Override built-in agent settings. Available agents: `sisyphus`, `hephaestus`, `prometheus`, `oracle`, `librarian`, `explore`, `multimodal-looker`, `metis`, `momus`, `atlas`, `sisyphus-junior`.

```json
{
  "agents": {
    "explore": { "model": "anthropic/claude-haiku-4-5", "temperature": 0.5 },
    "multimodal-looker": { "disable": true }
  }
}
```

Disable agents entirely: `{ "disabled_agents": ["oracle", "multimodal-looker"] }`

Agent tab cycling defaults to Sisyphus, Hephaestus, Prometheus, Atlas. Override known agent ordering with `agent_order`; omitted core agents keep their default relative order. Unknown or duplicate names are ignored and reported with a config toast.

```json
{
  "agent_order": ["hephaestus", "sisyphus", "prometheus", "atlas"]
}
```

#### Agent Options

| Option            | Type           | Description                                                     |
| ----------------- | -------------- | --------------------------------------------------------------- |
| `model`           | string         | Model override (`provider/model`)                               |
| `fallback_models` | string\|array  | Fallback models on API errors. Supports strings or mixed arrays of strings and object entries with per-model settings |
| `temperature`     | number         | Sampling temperature                                            |
| `top_p`           | number         | Top-p sampling                                                  |
| `prompt`          | string         | Replace system prompt. Supports `file://` URIs                  |
| `prompt_append`   | string         | Append to system prompt. Supports `file://` URIs                |
| `tools`           | array         | Allowed tools list                                     |
| `disable`         | boolean       | Disable this agent                                     |
| `mode`            | string        | Agent mode                                             |
| `color`           | string        | UI color                                               |
| `permission`      | object        | Per-tool permissions (see below)                       |
| `category`        | string        | Inherit model from category                            |
| `variant`         | string        | Model variant: `max`, `high`, `medium`, `low`, `xhigh`. Normalized to supported values |
| `maxTokens`       | number        | Max response tokens                                    |
| `thinking`        | object        | Anthropic extended thinking                            |
| `reasoningEffort` | string        | OpenAI reasoning: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Normalized to supported values |
| `textVerbosity`   | string        | Text verbosity: `low`, `medium`, `high`                |
| `providerOptions` | object        | Provider-specific options                              |

Prometheus is the exception for prompt replacement: its mandatory planner prompt always remains active so it can load `ulw-plan` first. For `agents.prometheus`, both `prompt` and `prompt_append` are appended to the mandatory base prompt instead of replacing it.

#### Anthropic Extended Thinking

```json
{
  "agents": {
    "oracle": { "thinking": { "type": "enabled", "budgetTokens": 200000 } }
  }
}
```

#### Agent Permissions

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


#### Fallback Models with Per-Model Settings

`fallback_models` accepts either a single model string or an array. Array entries can be plain strings or objects with individual model settings:

```jsonc
{
  "agents": {
    "sisyphus": {
      "model": "anthropic/claude-opus-4-7",
      "fallback_models": [
        // Simple string fallback
        "openai/gpt-5.5",
        // Object with per-model settings
        {
          "model": "google/gemini-3.1-pro",
          "variant": "high",
          "temperature": 0.2
        },
        {
          "model": "anthropic/claude-sonnet-4-6",
          "thinking": { "type": "enabled", "budgetTokens": 64000 }
        }
      ]
    }
  }
}
```

Object entries support: `model`, `variant`, `reasoningEffort`, `temperature`, `top_p`, `maxTokens`, `thinking`.

#### File URIs for Prompts

Both `prompt` and `prompt_append` support loading content from files via `file://` URIs. Category-level `prompt_append` supports the same URI forms.

For Prometheus, file-backed `prompt` content is appended after the mandatory base prompt; it does not replace the base prompt.

```jsonc
{
  "agents": {
    "sisyphus": {
      "prompt_append": "file:///absolute/path/to/prompt.txt"
    },
    "oracle": {
      "prompt": "file://./relative/to/project/prompt.md"
    },
    "explore": {
      "prompt_append": "file://~/home/dir/prompt.txt"
    }
  },
  "categories": {
    "custom": {
      "model": "anthropic/claude-sonnet-4-6",
      "prompt_append": "file://./category-context.md"
    }
  }
}
```

Paths can be absolute (`file:///abs/path`), relative to project root (`file://./rel/path`), or home-relative (`file://~/home/path`). If a file URI cannot be decoded, resolved, or read, OmO inserts a warning placeholder into the prompt instead of failing hard.

### Categories

Domain-specific model delegation used by the `task()` tool. When Sisyphus delegates work, it picks a category, not a model name.

#### Built-in Categories

| Category             | Default Model                   | Description                                    |
| -------------------- | ------------------------------- | ---------------------------------------------- |
| `visual-engineering` | `google/gemini-3.1-pro` (high)  | Frontend, UI/UX, design, animation             |
| `ultrabrain`         | `openai/gpt-5.6-sol` (xhigh)    | Deep logical reasoning, complex architecture   |
| `deep`               | `openai/gpt-5.6-terra` (xhigh)  | Autonomous problem-solving, thorough research  |
| `artistry`           | `google/gemini-3.1-pro` (high)  | Creative/unconventional approaches             |
| `quick`              | `openai/gpt-5.4-mini`           | Trivial tasks, typo fixes, single-file changes |
| `unspecified-low`    | `openai/gpt-5.6-luna` (xhigh)   | General tasks, low effort                      |
| `unspecified-high`   | `anthropic/claude-opus-4-7` (max) | General tasks, high effort                   |
| `writing`            | `kimi-for-coding/k2p5`          | Documentation, prose, technical writing        |

> **Note**: Built-in category defaults are available automatically. User-defined category config merges over the built-in defaults or adds custom categories.

#### Category Options

| Option              | Type          | Default | Description                                                         |
| ------------------- | ------------- | ------- | ------------------------------------------------------------------- |
| `model`             | string        | -       | Model override                                                      |
| `fallback_models`   | string\|array | -       | Fallback models on API errors. Supports strings or mixed arrays of strings and object entries with per-model settings |
| `temperature`       | number        | -       | Sampling temperature                                                |
| `top_p`             | number        | -       | Top-p sampling                                                      |
| `maxTokens`         | number        | -       | Max response tokens                                                 |
| `thinking`          | object        | -       | Anthropic extended thinking                                         |
| `reasoningEffort`   | string        | -       | OpenAI reasoning effort. Unsupported values are normalized          |
| `textVerbosity`     | string        | -       | Text verbosity                                                      |
| `tools`             | object        | -       | Tool usage control (disable with `{ "tool_name": false }`)         |
| `prompt_append`     | string        | -       | Append to system prompt                                             |
| `max_prompt_tokens` | number        | -       | Maximum prompt tokens for delegated tasks                           |
| `variant`           | string        | -       | Model variant. Unsupported values are normalized                    |
| `description`       | string        | -       | Shown in `task()` tool prompt                                       |
| `is_unstable_agent` | boolean       | `false` | Force background mode + monitoring. Auto-enabled for Gemini models. |
| `disable`           | boolean       | `false` | Exclude this category from task delegation                          |

Disable categories: `{ "categories": { "ultrabrain": { "disable": true } } }`

### Model Resolution

Runtime priority:

1. **UI-selected model** - model chosen in the OpenCode UI, for primary agents
2. **User override** - model set in config → used exactly as-is. Even on cold cache, explicit user configuration takes precedence over hardcoded fallback chains
3. **Category default** - model inherited from the assigned category config
4. **User `fallback_models`** - user-configured fallback list is tried before built-in fallback chains
5. **Provider fallback chain** - built-in provider/model chain from OmO source
6. **System default** - OpenCode's configured default model

#### Model Settings Compatibility

Model settings are compatibility-normalized against model capabilities instead of failing hard.

Normalized fields:

- `variant` - downgraded to the closest supported value
- `reasoningEffort` - downgraded to the closest supported value, or removed if unsupported
- `temperature` - removed if unsupported by the model metadata
- `top_p` - removed if unsupported by the model metadata
- `maxTokens` - capped to the model's reported max output limit
- `thinking` - removed if the target model does not support thinking

Examples:
- Claude models do not support `reasoningEffort` - it is removed automatically
- GPT-4.1 does not support reasoning - `reasoningEffort` is removed
- o-series models support `none` through `high` - `xhigh` is downgraded to `high`
- GPT-5 supports `none`, `minimal`, `low`, `medium`, `high`, `xhigh` - all pass through

Capability data comes from provider runtime metadata first. OmO also ships bundled models.dev-backed capability data, supports a refreshable local models.dev cache, and falls back to heuristic family detection plus alias rules when exact metadata is unavailable. `bunx oh-my-openagent doctor` surfaces capability diagnostics and warns when a configured model relies on compatibility fallback.


#### Agent Provider Chains

| Agent                 | Default Model       | Provider Priority                                                            |
| --------------------- | ------------------- | ---------------------------------------------------------------------------- |
|| **Sisyphus**          | `claude-opus-4-7`   | `anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max)` → `opencode-go\|kimi-for-coding\|moonshotai\|opencode\|vercel/kimi-k3` → `opencode-go\|vercel/kimi-k2.6` → `kimi-for-coding/k2p5` → `opencode\|bailian-coding-plan\|moonshotai\|moonshotai-cn\|firmware\|ollama-cloud\|aihubmix\|vercel/kimi-k2.5` → `openai\|github-copilot\|opencode\|vercel/gpt-5.5 (medium)` → `zai-coding-plan\|opencode\|bailian-coding-plan\|vercel/glm-5` → `opencode/big-pickle` |
| **Hephaestus**        | `gpt-5.6-sol`       | `openai\|vercel/gpt-5.6-sol (medium)` → `openai\|github-copilot\|opencode\|vercel/gpt-5.5 (medium)` |
| **oracle**            | `gpt-5.5`           | `openai\|github-copilot\|opencode\|vercel/gpt-5.5 (high)` → `google\|github-copilot\|opencode\|vercel/gemini-3.1-pro (high)` → `anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max)` → `opencode-go\|vercel/glm-5.2` |
| **librarian**         | `gpt-5.4-mini-fast` | `openai/gpt-5.4-mini-fast` → `opencode-go\|bailian-coding-plan/qwen3.5-plus` → `vercel/minimax-m2.7-highspeed` → `opencode-go\|vercel/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go\|vercel/minimax-m2.7` → `anthropic\|github-copilot\|vercel/claude-haiku-4-5` → `openai\|vercel/gpt-5.4-nano` |
| **explore**           | `gpt-5.4-mini-fast` | `openai/gpt-5.4-mini-fast` → `opencode-go\|bailian-coding-plan/qwen3.5-plus` → `vercel/minimax-m2.7-highspeed` → `opencode-go\|vercel/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go\|vercel/minimax-m2.7` → `anthropic\|github-copilot\|vercel/claude-haiku-4-5` → `openai\|vercel/gpt-5.4-nano` |
| **multimodal-looker** | `gpt-5.5`           | `openai\|opencode\|vercel/gpt-5.5 (medium)` → `opencode-go\|vercel/kimi-k2.6` → `zai-coding-plan\|vercel/glm-4.6v` → `openai\|github-copilot\|opencode\|vercel/gpt-5-nano` |
| **Prometheus**        | `claude-opus-4-7`   | `anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max)` → `openai\|github-copilot\|opencode\|vercel/gpt-5.5 (high)` → `opencode-go\|vercel/glm-5.2` → `google\|github-copilot\|opencode\|vercel/gemini-3.1-pro` |
| **Metis**             | `claude-sonnet-4-6` | `anthropic\|github-copilot\|opencode\|vercel/claude-sonnet-4-6` → `anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max)` → `openai\|github-copilot\|opencode\|vercel/gpt-5.5 (high)` → `opencode-go\|vercel/glm-5.2` → `kimi-for-coding/k2p5` |
| **Momus**             | `gpt-5.6-terra`     | `openai\|vercel/gpt-5.6-terra (high)` → `openai\|github-copilot\|opencode\|vercel/gpt-5.5 (xhigh)` → `anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max)` → `google\|github-copilot\|opencode\|vercel/gemini-3.1-pro (high)` → `opencode-go\|vercel/glm-5.2` |
| **Atlas**             | `claude-sonnet-4-6` | `anthropic\|github-copilot\|opencode\|vercel/claude-sonnet-4-6` → `opencode-go\|vercel/kimi-k2.6` → `openai\|github-copilot\|opencode\|vercel/gpt-5.5 (medium)` → `opencode-go\|vercel/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go\|vercel/minimax-m2.7` |
| **Sisyphus-Junior**   | `claude-sonnet-4-6` | `anthropic\|github-copilot\|opencode\|vercel/claude-sonnet-4-6` → `opencode-go\|vercel/kimi-k2.6` → `openai\|github-copilot\|opencode\|vercel/gpt-5.5 (medium)` → `opencode-go\|vercel/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go\|vercel/minimax-m2.7` → `opencode/big-pickle` |

#### Category Provider Chains

This table documents the first entry of each hardcoded provider fallback chain, not the built-in category default shown above. For example, `writing` defaults to `kimi-for-coding/k2p5`, while its provider fallback chain starts with Gemini.

| Category               | Provider Chain Primary | Provider Priority                                           |
| ---------------------- | ------------------- | -------------------------------------------------------------- |
| **visual-engineering** | `gemini-3.1-pro`    | `google\|github-copilot\|opencode\|vercel/gemini-3.1-pro (high)` → `zai-coding-plan\|opencode\|bailian-coding-plan\|vercel/glm-5` → `anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max)` → `opencode-go\|vercel/glm-5.2` → `kimi-for-coding/k2p5` |
| **ultrabrain**         | `gpt-5.6-sol`       | `openai\|vercel/gpt-5.6-sol (xhigh)` → `openai\|opencode\|vercel/gpt-5.5 (xhigh)` → `google\|github-copilot\|opencode\|vercel/gemini-3.1-pro (high)` → `anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max)` → `opencode-go\|vercel/glm-5.2` |
| **deep**               | `gpt-5.6-terra`     | `openai\|vercel/gpt-5.6-terra (xhigh)` → `openai\|vercel/gpt-5.6-sol (high)` → `openai\|github-copilot\|opencode\|vercel/gpt-5.5 (medium)` → `anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max)` → `google\|github-copilot\|opencode\|vercel/gemini-3.1-pro (high)` → `opencode-go\|vercel/kimi-k2.6` → `opencode-go\|vercel/glm-5.2` |
| **artistry**           | `gemini-3.1-pro`    | `google\|github-copilot\|opencode\|vercel/gemini-3.1-pro (high)` → `anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max)` → `openai\|github-copilot\|opencode\|vercel/gpt-5.5` → `opencode-go\|vercel/kimi-k2.6` → `opencode-go\|vercel/glm-5.2` |
| **quick**              | `gpt-5.4-mini`      | `openai\|github-copilot\|opencode\|vercel/gpt-5.4-mini` → `anthropic\|github-copilot\|vercel/claude-haiku-4-5` → `google\|github-copilot\|opencode\|vercel/gemini-3-flash` → `opencode-go\|vercel/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go\|vercel/minimax-m2.7` → `opencode\|vercel/gpt-5-nano` |
| **unspecified-low**    | `gpt-5.6-luna`      | `openai\|vercel/gpt-5.6-luna (xhigh)` → `anthropic\|github-copilot\|opencode\|vercel/claude-sonnet-4-6` → `openai\|opencode\|vercel/gpt-5.5 (medium)` → `opencode-go\|vercel/kimi-k2.6` → `google\|github-copilot\|opencode\|vercel/gemini-3-flash` → `opencode-go\|vercel/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go\|vercel/minimax-m2.7` |
| **unspecified-high**   | `claude-opus-4-7`   | `anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max)` → `openai\|github-copilot\|opencode\|vercel/gpt-5.5 (high)` → `zai-coding-plan\|opencode\|bailian-coding-plan\|vercel/glm-5` → `kimi-for-coding/k2p5` → `opencode-go\|vercel/glm-5.2` → `opencode\|bailian-coding-plan\|vercel/kimi-k2.5` → `opencode\|bailian-coding-plan\|moonshotai\|moonshotai-cn\|firmware\|ollama-cloud\|aihubmix\|vercel/kimi-k2.5` |
| **writing**            | `gemini-3-flash`    | `google\|github-copilot\|opencode\|vercel/gemini-3-flash` → `opencode-go\|vercel/kimi-k2.6` → `anthropic\|github-copilot\|opencode\|vercel/claude-sonnet-4-6` → `opencode-go\|vercel/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go\|vercel/minimax-m2.7` |

Run `bunx oh-my-openagent doctor --verbose` to see effective model resolution for your config.

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
    "modelConcurrency": { "anthropic/claude-opus-4-7": 2 }
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

File-based task persistence with dependency tracking, used for cross-session task management. The task system is controlled by `experimental.task_system` (defaults to `true` since v3.14). When enabled, `TodoWrite`/`TodoRead` are intercepted and replaced with the Task tools (`task_create`, `task_get`, `task_list`, `task_update`).

The `sisyphus.tasks` section configures **storage options** only:

```json
{
  "sisyphus": {
    "tasks": {
      "storage_path": ".omo/tasks",
      "claude_code_compat": false
    }
  }
}
```

| Option               | Default           | Description                                |
| -------------------- | ----------------- | ------------------------------------------ |
| `storage_path`       | `.omo/tasks` | Storage path (relative to project root)    |
| `task_list_id`       | -                 | Force task list ID (alternative to env `ULTRAWORK_TASK_LIST_ID`) |
| `claude_code_compat` | `false`           | Enable Claude Code path compatibility mode |

To disable the task system entirely, set `experimental.task_system` to `false`:

```json
{
  "experimental": { "task_system": false }
}
```

---

## Features

### Skills

Skills bring domain-specific expertise and embedded MCPs.

Built-in skills: `playwright`, `playwright-cli`, `agent-browser`, `dev-browser`, `git-master`, `frontend`

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
{ "disabled_hooks": ["comment-checker"] }
```

Available hooks: `todo-continuation-enforcer`, `session-notification`, `comment-checker`, `tool-output-truncator`, `question-label-truncator`, `directory-agents-injector`, `directory-readme-injector`, `empty-task-response-detector`, `think-mode`, `model-fallback`, `anthropic-context-window-limit-recovery`, `preemptive-compaction`, `rules-injector`, `background-notification`, `auto-update-checker`, `startup-toast`, `keyword-detector`, `agent-usage-reminder`, `non-interactive-env`, `interactive-bash-session`, `thinking-block-validator`, `tool-pair-validator`, `ralph-loop`, `category-skill-reminder`, `compaction-context-injector`, `compaction-todo-preserver`, `claude-code-hooks`, `auto-slash-command`, `edit-error-recovery`, `json-error-recovery`, `delegate-task-retry`, `prometheus-md-only`, `sisyphus-junior-notepad`, `team-tool-gating`, `no-sisyphus-gpt`, `no-hephaestus-non-gpt`, `start-work`, `atlas`, `unstable-agent-babysitter`, `task-resume-info`, `stop-continuation-guard`, `tasks-todowrite-disabler`, `runtime-fallback`, `write-existing-file-guard`, `bash-file-read-guard`, `hashline-read-enhancer`, `read-image-resizer`, `todo-description-override`, `webfetch-redirect-guard`, `fsync-skip-warning`, `legacy-plugin-toast`

Guard hooks such as `team-tool-gating`, `write-existing-file-guard`, `bash-file-read-guard`, `webfetch-redirect-guard`, `prometheus-md-only`, `rules-injector`, `tool-pair-validator`, and `thinking-block-validator` protect safety, permissions, or provider protocol correctness. Disable them only for audited local debugging in a trusted environment.

**Notes:**

- `directory-agents-injector` - auto-disabled on OpenCode 1.1.37+ (native AGENTS.md support)
- `no-sisyphus-gpt` - **do not disable**. It blocks incompatible GPT models for Sisyphus while allowing the dedicated GPT-5.4 and GPT-5.5 prompt paths.
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

`force_enable` (`false`) - force session-notification even if external notification plugins are detected.

### MCPs

Built-in MCPs (enabled by default): `websearch` (Exa AI), `context7` (library docs), `grep_app` (GitHub code search), and `lsp` (local language-server tools). Structural search and rewrite is provided by the `ast-grep` skill instead of a built-in MCP.

```json
{ "disabled_mcps": ["websearch", "context7", "grep_app", "lsp"] }
```

### LSP

LSP tools are served by the built-in `lsp` MCP server (see [MCPs](#mcps)). The
previous top-level `"lsp"` block in the plugin config is no longer read and is
automatically stripped on next startup; existing configs containing it are
silently migrated (see `packages/omo-opencode/src/shared/migration/config-migration.ts`).

To configure custom language servers, create `.opencode/lsp.json` at the project
root. The MCP server is launched with `LSP_TOOLS_MCP_PROJECT_CONFIG=.opencode/lsp.json`
and reads the server map from that file. The schema lives in the
`packages/lsp-tools-mcp` vendored package (upstream:
[code-yeongyu/lsp-tools-mcp](https://github.com/code-yeongyu/lsp-tools-mcp)).

To disable the LSP MCP entirely:

```json
{ "disabled_mcps": ["lsp"] }
```

---

## Advanced

### Runtime Fallback

Auto-switches to backup models on API errors.

**Simple configuration** (enable/disable with defaults):

```json
{ "runtime_fallback": true }
```

```json
{ "runtime_fallback": false }
```

**Advanced configuration** (full control):

```json
{
  "runtime_fallback": {
    "enabled": true,
    "retry_on_errors": [429, 500, 502, 503, 504],
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
| `retry_on_errors`       | `[429,500,502,503,504]` | HTTP codes that trigger fallback. Also handles classified provider key errors.                                              |
| `max_fallback_attempts` | `3`                 | Max fallback attempts per session (1–20)                                                                                       |
| `cooldown_seconds`      | `60`                | Seconds before retrying a failed model                                                                                         |
| `timeout_seconds`       | `30`                | Seconds before forcing next fallback. **Set to `0` to disable timeout-based escalation, main-session first-prompt watchdog escalation, and `message.updated` provider retry signal detection.** The historical 90-second subagent first-prompt watchdog and structured `session.status` retry events remain active. |
| `notify_on_fallback`    | `true`              | Toast notification on model switch                                                                                             |

#### Speeding Up Fallback (Proxy APIs)

If you are using a proxy API provider, they may return different error codes (e.g., `401`, `403`, `404`) for quota exhaustion or model unavailability. To make fallback trigger instantly without waiting for long timeouts:

```jsonc
{
  "runtime_fallback": {
    "enabled": true,
    // Add your proxy's specific error codes to retry_on_errors
    "retry_on_errors": [400, 401, 403, 404, 429, 500, 502, 503, 504],
    "max_fallback_attempts": 3,
    "cooldown_seconds": 15, // Shorter cooldown
    "timeout_seconds": 10   // Detect hung proxy requests faster
  }
}
```

Define `fallback_models` per agent or category:

```json
{
  "agents": {
    "sisyphus": {
      "model": "anthropic/claude-opus-4-7",
      "fallback_models": [
        "openai/gpt-5.5",
        {
          "model": "google/gemini-3.1-pro",
          "variant": "high"
        }
      ]
    }
  }
}
```

`fallback_models` also supports object-style entries so you can attach settings to a specific fallback model:

```json
{
  "agents": {
    "sisyphus": {
      "model": "anthropic/claude-opus-4-7",
      "fallback_models": [
        "openai/gpt-5.5",
        {
          "model": "anthropic/claude-sonnet-4-6",
          "variant": "high",
          "thinking": { "type": "enabled", "budgetTokens": 12000 }
        },
        {
          "model": "openai/gpt-5.5-codex",
          "reasoningEffort": "high",
          "temperature": 0.2,
          "top_p": 0.95,
          "maxTokens": 8192
        }
      ]
    }
  }
}
```

Mixed arrays are allowed, so string entries and object entries can appear together in the same fallback chain.

#### Object-style `fallback_models`

Object entries use the following shape:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `model` | string | Fallback model ID. Provider prefix is optional when OmO can inherit the current/default provider. |
| `variant` | string | Explicit variant override for this fallback entry. |
| `reasoningEffort` | string | OpenAI reasoning effort override for this fallback entry. |
| `temperature` | number | Temperature applied if this fallback model becomes active. |
| `top_p` | number | Top-p applied if this fallback model becomes active. |
| `maxTokens` | number | Max response tokens applied if this fallback model becomes active. |
| `thinking` | object | Anthropic thinking config applied if this fallback model becomes active. |

Per-model settings are **fallback-only**. They are promoted only when that specific fallback model is actually selected, so they do not override your primary model settings when the primary model resolves successfully.

`thinking` uses the same shape as the normal agent/category option:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `type` | string | `enabled` or `disabled` |
| `budgetTokens` | number | Optional Anthropic thinking budget |

Object entries can also omit the provider prefix when OmO can infer it from the current/default provider. If you provide both inline variant syntax in `model` and an explicit `variant` field, the explicit `variant` field wins.

#### Full examples

**1. Simple string chain**

Use strings when you only need an ordered fallback chain:

```json
{
  "agents": {
    "atlas": {
      "model": "anthropic/claude-sonnet-4-6",
      "fallback_models": [
        "anthropic/claude-haiku-4-5",
        "openai/gpt-5.5",
        "google/gemini-3.1-pro"
      ]
    }
  }
}
```

**2. Same-provider shorthand**

If the primary model already establishes the provider, fallback entries can omit the prefix:

```json
{
  "agents": {
    "atlas": {
      "model": "openai/gpt-5.5",
      "fallback_models": [
        "gpt-5.4-mini",
        {
          "model": "gpt-5.5-codex",
          "reasoningEffort": "medium",
          "maxTokens": 4096
        }
      ]
    }
  }
}
```

In this example OmO treats `gpt-5.4-mini` and `gpt-5.5-codex` as OpenAI fallback entries because the current/default provider is already `openai`.

**3. Mixed cross-provider chain**

Mix string entries and object entries when only some fallback models need special settings:

```json
{
  "agents": {
    "sisyphus": {
      "model": "anthropic/claude-opus-4-7",
      "fallback_models": [
        "openai/gpt-5.5",
        {
          "model": "anthropic/claude-sonnet-4-6",
          "variant": "high",
          "thinking": { "type": "enabled", "budgetTokens": 12000 }
        },
        {
          "model": "google/gemini-3.1-pro",
          "variant": "high"
        }
      ]
    }
  }
}
```

**4. Category-level fallback chain**

`fallback_models` works the same way under `categories`:

```json
{
  "categories": {
    "deep": {
      "model": "openai/gpt-5.5-codex",
      "fallback_models": [
        {
          "model": "openai/gpt-5.5",
          "reasoningEffort": "xhigh",
          "maxTokens": 12000
        },
        {
          "model": "anthropic/claude-opus-4-7",
          "variant": "max",
          "temperature": 0.2
        },
        "google/gemini-3.1-pro(high)"
      ]
    }
  }
}
```

**5. Full object entry with every supported field**

This shows every supported object-style parameter in one place:

```json
{
  "agents": {
    "oracle": {
      "model": "openai/gpt-5.5",
      "fallback_models": [
        {
          "model": "openai/gpt-5.5-codex(low)",
          "variant": "xhigh",
          "reasoningEffort": "high",
          "temperature": 0.3,
          "top_p": 0.9,
          "maxTokens": 8192,
          "thinking": {
            "type": "disabled"
          }
        }
      ]
    }
  }
}
```

In this example the explicit `"variant": "xhigh"` overrides the inline `(low)` suffix in `"model"`.

This final example is a **complete shape reference**. In real configs, prefer provider-appropriate settings:

- use `reasoningEffort` for OpenAI reasoning models
- use `thinking` for Anthropic thinking-capable models
- use `variant`, `temperature`, `top_p`, and `maxTokens` only when that fallback model supports them

### Model Capabilities

OmO can refresh a local models.dev capability snapshot on startup. This cache is controlled by `model_capabilities`.

```jsonc
{
  "model_capabilities": {
    "enabled": true,
    "auto_refresh_on_start": true,
    "refresh_timeout_ms": 5000,
    "source_url": "https://models.dev/api.json"
  }
}
```

| Option | Default behavior | Description |
| ------ | ---------------- | ----------- |
| `enabled` | enabled unless explicitly set to `false` | Master switch for model capability refresh behavior |
| `auto_refresh_on_start` | refresh on startup unless explicitly set to `false` | Refresh the local models.dev cache during startup checks |
| `refresh_timeout_ms` | `5000` | Timeout for the startup refresh attempt |
| `source_url` | `https://models.dev/api.json` | Override the models.dev source URL |

Notes:

- Startup refresh runs through the auto-update checker hook.
- Manual refresh is available via `bunx oh-my-openagent refresh-model-capabilities`.
- Provider runtime metadata still takes priority when OmO resolves capabilities for compatibility checks.

### Hashline Edit

Replaces the built-in `Edit` tool with a hash-anchored version using `LINE#ID` references to prevent stale-line edits. Disabled by default.

```json
{ "hashline_edit": true }
```

When enabled, OmO registers the hash-anchored `edit` tool and activates the `hashline-read-enhancer` companion hook, which annotates Read output with `LINE#ID` markers. Opt in by setting `hashline_edit: true`. Disable the companion hook via `disabled_hooks` if needed.

### Experimental

```json
{
  "experimental": {
    "truncate_all_tool_outputs": false,
    "aggressive_truncation": false,
    "disable_omo_env": false,
    "task_system": true,
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
| `disable_omo_env`                        | `false`    | Disable auto-injected `<omo-env>` block (date/time/locale). Improves cache hit rate. |
| `task_system`                            | `false`    | Enable Sisyphus task system                                                          |
| `dynamic_context_pruning.enabled`        | `false`    | Auto-prune old tool outputs to manage context window                                 |
| `dynamic_context_pruning.notification`   | `detailed` | Pruning notifications: `off` / `minimal` / `detailed`                                |
| `turn_protection.turns`                  | `3`        | Recent turns protected from pruning (1–10)                                           |
| `strategies.deduplication`               | `true`     | Remove duplicate tool calls                                                          |
| `strategies.supersede_writes`            | `true`     | Prune write inputs when file later read                                              |
| `strategies.supersede_writes.aggressive` | `false`    | Prune any write if ANY subsequent read exists                                        |
| `strategies.purge_errors.turns`          | `5`        | Turns before pruning errored tool inputs                                             |

### Telemetry

```jsonc
{
  "telemetry": false
}
```

| Option      | Default | Description                                                            |
| ----------- | ------- | ---------------------------------------------------------------------- |
| `telemetry` | `true`  | Enable anonymous daily-active telemetry. Set to `false` to disable it. |

---

## Reference

### Environment Variables

| Variable              | Description                                                       |
| --------------------- | ----------------------------------------------------------------- |
| `OPENCODE_CONFIG_DIR` | Override OpenCode config directory (useful for profile isolation) |
| `OMO_SEND_ANONYMOUS_TELEMETRY` | Set to `0`, `false`, or `no` to disable anonymous telemetry |
| `OMO_DISABLE_POSTHOG` | Legacy telemetry opt-out flag. Set to `1`, `true`, or `yes` to disable PostHog |
| `OMO_CODEX_DISABLE_POSTHOG` | Set to `1` or `true` to disable PostHog telemetry for the `omo-codex` adapter only. Does not affect oh-my-opencode telemetry |
| `OMO_CODEX_SEND_ANONYMOUS_TELEMETRY` | Set to `0`, `false`, or `no` to disable anonymous telemetry for `omo-codex` only |
| `OMO_CODEX_GIT_BASH_PATH` | Native Windows Codex installs only. Absolute path to Git Bash, for example `C:\Program Files\Git\bin\bash.exe`, when `where bash` cannot find it |
| `LAZYCODEX_CONFIG_MIGRATION_DISABLED` | Set to `1` to skip the Codex config migration that runs on every session start (including the `multi_agent_v2` force-disable and managed reasoning-profile sync), leaving `config.toml` untouched |
| `OMO_CODEX_CONFIG_MIGRATION_DISABLED` | Alias of `LAZYCODEX_CONFIG_MIGRATION_DISABLED` |
| `LSP_TOOLS_MCP_INSTALL_DECISIONS` | Override the path of the LSP install-decisions file (default `~/.codex/lsp-install-decisions.json`) |
| `POSTHOG_API_KEY` | Optional override for the built-in PostHog project API key |
| `POSTHOG_HOST` | Override the PostHog ingestion host. Defaults to `https://us.i.posthog.com` |

### LSP Install Decisions

When an LSP tool hits a language server that is not installed, it asks once per server and persists the answer to `~/.codex/lsp-install-decisions.json` (override with `LSP_TOOLS_MCP_INSTALL_DECISIONS`). A `declined` entry collapses all future diagnostics for that server to a one-line note. To get prompted again — or to re-enable a server that an agent declined on your behalf — delete the file (or the server's entry in it).

### Codex Light Git Bash MCP

Native Windows Codex installs bundle a `git_bash` MCP server and write `[plugins."omo@sisyphuslabs".mcp_servers.git_bash] enabled = true`. Non-Windows installs keep the bundled manifest entry but write `enabled = false`, so the plugin detail can still show the server while policy prevents exposure.

The installer discovers Git Bash with `OMO_CODEX_GIT_BASH_PATH`, standard Git for Windows locations, and PATH. If discovery fails, it prints manual install guidance and stops without running `winget` or changing system dependencies. The Light plugin also emits a fixed reminder before the first Codex shell-like `Bash` hook call in a Windows session, and resets that reminder after `PostCompact` so the first post-compaction shell call recommends `git_bash` again.

### Codex Companion Plugin Compatibility

LazyCodex can coexist with other Codex plugins, but if LazyCodex is your primary Codex workflow the `codex@openai-codex` companion plugin adds its own `SessionStart` and `Stop` lifecycle hooks. Those extra hooks can produce confusing Codex hook-failure banners even when the LazyCodex hooks are healthy.

`lazycodex doctor` warns when `omo@sisyphuslabs` is enabled and the companion plugin is enabled, or when stale `[hooks.state."codex@openai-codex:..."]` SessionStart/Stop trust entries remain in `~/.codex/config.toml`. The doctor only reports this condition; it does not disable or delete another plugin for you.

If LazyCodex is the primary workflow, disable the companion plugin explicitly:

```toml
[plugins."codex@openai-codex"]
enabled = false
```

If doctor still warns afterward, remove the stale `[hooks.state."codex@openai-codex:..."]` SessionStart/Stop entries from the Codex config after making your own backup.

### Provider-Specific

#### Google Auth

Install [`opencode-antigravity-auth`](https://github.com/NoeFabris/opencode-antigravity-auth) for Google Gemini. Provides multi-account load balancing, dual quota, and variant-based thinking.

##### Split Claude Routing

Provider path affects the effective Claude context limit. Antigravity Claude
models are the stable 200k lane. Direct Anthropic Claude models are the 1M lane
for accounts and model IDs that support long context.

Use Antigravity for cheaper or quota-balanced work where 200k context is enough.
Use direct Anthropic for long-context planning, review, and research sessions
where early compaction would lose important context.

```jsonc
{
  "agents": {
    // 200k lane: Google Antigravity Claude.
    "explore": {
      "model": "google/antigravity-claude-sonnet-4-6"
    },
    "librarian": {
      "model": "google/antigravity-claude-sonnet-4-6"
    },

    // 1M lane: direct Anthropic, only for eligible long-context accounts/models.
    "sisyphus": {
      "model": "anthropic/claude-opus-4-6",
      "variant": "max"
    },
    "oracle": {
      "model": "anthropic/claude-opus-4-6"
    }
  }
}
```

If you see an error like `prompt is too long ... > 200000`, check whether the
agent is routed through `google/antigravity-*`. Move that agent to a direct
`anthropic/*` model only when the account, model, and required beta/header setup
support 1M context. Keep the Antigravity lane explicit when you want predictable
200k behavior.

#### Ollama

**Must** disable streaming to avoid JSON parse errors:

```json
{
  "agents": {
    "explore": { "model": "ollama/qwen3-coder" }
  }
}
```

**Note:** The `stream` option should be configured in your OpenCode settings or via environment variables, not in the agent config. See [Ollama Troubleshooting](../troubleshooting/ollama.md) for details on disabling streaming.

Common models: `ollama/qwen3-coder`, `ollama/ministral-3:14b`, `ollama/lfm2.5-thinking`

See [Ollama Troubleshooting](../troubleshooting/ollama.md) for `JSON Parse error: Unexpected EOF` issues.
