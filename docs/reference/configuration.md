# Configuration Reference

Complete reference for Oh My OpenCode plugin configuration. Every omo harness reads one unified config file, `omo.jsonc`; the legacy `oh-my-openagent.json[c]` / `oh-my-opencode.json[c]` files are imported once by the migration engine and are no longer read at runtime.

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
  - [CodeGraph](#codegraph)
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

One unified file configures every omo harness: the OpenCode plugin, Senpi (task, codegraph, config-watch), and the Codex codegraph loader. The legacy `oh-my-openagent.json[c]` / `oh-my-opencode.json[c]` files and `~/.omo/config.jsonc` are read by nothing but the migration engine (see [Migration](#migration)).

1. User layer (lowest precedence): `~/.omo/omo.jsonc` on every platform (`omo.json` is accepted as a fallback basename).
2. Project layers: `.omo/omo.jsonc` (then `.omo/omo.json`) in every directory from the working directory up to `$HOME`. Farther ancestors merge first, so the nearest project file wins and beats the user layer. `$HOME` itself is skipped by the walk because `~/.omo` is already the user layer. If the working directory is outside `$HOME`, the walk continues to the filesystem root.

#### Resolution Order

Within the merged document each harness resolves its own view VSCode-style, later layers winning:

1. Shared base keys
2. The `[harness]` block: `[opencode]`, `[senpi]`, or `[codex]`
3. `profiles.<name>`
4. `profiles.<name>.[harness]`

Defaults apply once at the end. The option keys documented in this reference are the contents of the `[opencode]` block. `agents` and `categories` can also live at the shared base level so every harness sees them, using the shared field set documented in the [omo.json reference](./omo-json.md); OpenCode-specific agent options belong in `[opencode]`.

#### Profiles

No default profiles ship: a profile exists only when you write one under `profiles.<name>` or the migration derives one from a legacy profile directory. Activation, highest priority first:

1. `OMO_PROFILE`
2. `OCX_PROFILE` (set by `ocx oc -p <name>`)
3. An `OPENCODE_CONFIG_DIR` whose path ends in `profiles/<name>`
4. None

Activating a profile that does not exist produces a diagnostic and falls back to the base configuration.

#### Model Catalog

A top-level `models` record maps a short name to the canonical shape `{ model, reasoning? }`. Deprecated `variant` and `reasoningEffort` inputs are accepted for compatibility and normalized to `reasoning`. When an agent or category `model` string matches a catalog key, it resolves to the entry's model id and fills any unset `reasoning` from the entry; tuning written at the use site always wins. `[harness]` blocks can override individual catalog entries for one harness.

#### Security Invariants

`mcp_env_allowlist` and `browser_automation_engine.playwright_mcp_args` are honored only from the user layer, including the user layer's own active profile block. Project layers cannot extend them.

JSONC supports `// line comments`, `/* block comments */`, and trailing commas.

Enable schema autocomplete:

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json"
}
```

Run `bunx oh-my-openagent install` for guided setup. Run `opencode models` to list available models.

#### Migration

The first time a current harness starts (and again on install or via the CLI), a lock-and-journal migration engine imports the legacy files into the unified file:

- Sources: `oh-my-openagent.json[c]` / `oh-my-opencode.json[c]` in the OpenCode user config directory, in each of its `profiles/<name>/` directories, and in walked project `.opencode/` directories, plus `~/.omo/config.jsonc`.
- Targets: the legacy user file imports into `~/.omo/omo.jsonc` under `[opencode]`; each legacy profile becomes `profiles.<name>."[opencode]"` holding only the keys that differ from the user file; a project file imports into that project's `.omo/omo.jsonc`. `~/.omo/config.jsonc` imports its shared `codegraph` settings plus its `[opencode]` / `[codex]` blocks, and a legacy `[omo]` block maps to `[senpi]`.
- Conflict policy: no-clobber. A value already present in the target wins, and every skipped legacy value is reported as a diagnostic instead of overwriting. Prior legacy migration history is preserved under the target's `legacy_migrations` key.
- Markers: each applied migration records its id in the target's `_migrations` array, so re-runs are no-ops. `2026-07-opencode-config-unification` covers the `oh-my-*` files; `2026-07-codex-config-jsonc` covers `~/.omo/config.jsonc`; `2026-08-reasoning-unification` rewrites persisted model and reasoning fields. Codex startup runs only the second group; OpenCode plugin startup, Senpi startup, install, and the CLI run both groups, so whichever side runs first applies each group exactly once.
- Backups: sources move to `~/.omo/migration-backup-<UTC timestamp>-opencode-config/` (project sources to `<project>/.omo/migration-backup-<UTC timestamp>/`). An interrupted run resumes from its journal on the next start.
- Manual run: `oh-my-openagent config migrate`. `--dry-run` prints the transform, backup move plan, and conflicts without writing; `--json` prints machine-readable output.
- Diagnostics surface once per startup: an OpenCode toast, a Senpi `session_start` notification, or Codex loader warnings.

### Quick Start Example

Here's a practical starting `~/.omo/omo.jsonc`. OpenCode plugin settings live inside the `[opencode]` block:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",

  "[opencode]": {
    "agents": {
      // Main orchestrator: Claude Opus or Kimi K3 work best
      "sisyphus": {
        "model": "kimi-for-coding/kimi-k3",
        "ultrawork": { "model": "anthropic/claude-opus-5", "reasoning": "max" },
      },

      // Research agents: cheap fast models are fine
      "librarian": { "model": "google/gemini-3.6-flash" },
      "explore": { "model": "github-copilot/grok-code-fast-1" },

      // Architecture consultation: GPT-5.6 Sol or Claude Opus
      "oracle": { "model": "openai/gpt-5.6-sol", "reasoning": "high" },

      // Prometheus inherits sisyphus model; just add prompt guidance
      "prometheus": {
        "prompt_append": "Leverage deep & quick agents heavily, always in parallel.",
      },
    },

    "categories": {
      // quick - Kimi high-speed by default
      "quick": { "model": "kimi-for-coding/kimi-for-coding-highspeed" },

      // unspecified-low - moderate tasks
      "unspecified-low": { "model": "openai/gpt-5.6-luna", "reasoning": "xhigh" },

      // unspecified-high - complex work
      "unspecified-high": { "model": "kimi-for-coding/kimi-k3", "reasoning": "max" },

      // writing - docs/prose
      "writing": { "model": "kimi-for-coding/kimi-k3", "reasoning": "low" },

      // visual-engineering - Opus 5, then Kimi K3 and GLM 5.2
      "visual-engineering": {
        "model": "anthropic/claude-opus-5",
        "reasoning": "max",
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
        "anthropic/claude-opus-5": 2,
        "opencode/gpt-5-nano": 20,
      },
    },

    "experimental": { "aggressive_truncation": true, "task_system": true },
    "tmux": { "enabled": false },
  },
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

| Option            | Type                    | Description                                                     |
| ----------------- | ----------------------- | --------------------------------------------------------------- |
| `model`           | string                  | Model override (`provider/model`)                               |
| `models`          | array                   | Ordered model chain; entries are strings or per-model objects   |
| `fallback_models` | string\|array           | Deprecated compatibility fallback chain                         |
| `reasoning`       | string                  | Canonical reasoning level or harness-native preset token        |
| `temperature`     | number                  | Sampling temperature                                            |
| `top_p`           | number                  | Top-p sampling                                                  |
| `prompt`          | string                  | Replace system prompt. Supports `file://` URIs                  |
| `prompt_append`   | string                  | Append to system prompt. Supports `file://` URIs                |
| `tools`           | record<string, boolean> | Per-tool enable/disable map                                     |
| `disable`         | boolean                 | Disable this agent                                              |
| `description`     | string                  | Agent description                                               |
| `mode`            | `subagent \| primary \| all` | Agent mode                                                |
| `color`           | string                  | Six-digit hex UI color (`#RRGGBB`)                              |
| `displayName`     | string                  | Localized display name shown in the agent selector              |
| `permission`      | object                  | Per-tool permissions (see below)                                |
| `category`        | string                  | Inherit model from category                                     |
| `skills`          | string[]                | Skill names to inject into the agent prompt                     |
| `variant`         | string                  | Deprecated compatibility input; use `reasoning`                 |
| `maxTokens`       | number                  | Max response tokens                                             |
| `thinking`        | object                  | Migrated legacy Anthropic form; use `reasoning` plus provider options |
| `reasoningEffort` | string                  | Deprecated compatibility input; use `reasoning`                 |
| `textVerbosity`   | string                  | Text verbosity: `low`, `medium`, `high`                         |
| `providerOptions` | object                  | Provider-specific options                                       |
| `ultrawork`       | object                  | Per-message ultrawork model and reasoning override              |
| `compaction`      | object                  | Compaction model and reasoning override                         |

Prometheus is the exception for prompt replacement: its mandatory planner prompt always remains active so it can load `ulw-plan` first. For `agents.prometheus`, both `prompt` and `prompt_append` are appended to the mandatory base prompt instead of replacing it.

#### Anthropic Extended Thinking

```json
{
  "agents": {
    "oracle": {
      "reasoning": "high",
      "providerOptions": { "thinking": { "type": "enabled", "budgetTokens": 200000 } }
    }
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
      "model": "anthropic/claude-opus-5",
      "fallback_models": [
        // Simple string fallback
        "openai/gpt-5.6-sol",
        // Object with per-model settings
        {
          "model": "google/gemini-3.1-pro",
          "reasoning": "high",
          "temperature": 0.2
        },
        {
          "model": "anthropic/claude-sonnet-5",
          "reasoning": "high"
        }
      ]
    }
  }
}
```

Object entries support canonical `model`, `reasoning`, `temperature`, `top_p`, and `maxTokens`. Deprecated `variant`, `reasoningEffort`, and `thinking` remain accepted as compatibility inputs and are normalized to `reasoning` and provider options.

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
      "model": "anthropic/claude-sonnet-5",
      "prompt_append": "file://./category-context.md"
    }
  }
}
```

Paths can be absolute (`file:///abs/path`), relative to project root (`file://./rel/path`), or home-relative (`file://~/home/path`). Home-relative files are limited to `~/.config/opencode`, `~/.config/oh-my-openagent`, `~/.omo`, and `~/.opencode`. If a file URI cannot be decoded, resolved, accepted, or read, OmO inserts a warning placeholder into the prompt instead of failing hard.

### Categories

Domain-specific model delegation used by the `task()` tool. When Sisyphus delegates work, it picks a category, not a model name.

#### Built-in Categories

| Category             | Default Model                   | Description                                    |
| -------------------- | ------------------------------- | ---------------------------------------------- |
| `visual-engineering` | `anthropic/claude-opus-5` (max) | Frontend, UI/UX, design, animation            |
| `ultrabrain`         | `openai/gpt-5.6-sol` (xhigh)    | Deep logical reasoning, complex architecture   |
| `deep`               | `openai/gpt-5.6-sol` (medium)   | Autonomous problem-solving, thorough research  |
| `artistry`           | `anthropic/claude-fable-5` (xhigh) | Creative/unconventional approaches             |
| `quick`              | `kimi-for-coding/kimi-for-coding-highspeed` | Trivial tasks, typo fixes, single-file changes |
| `unspecified-low`    | `openai/gpt-5.6-luna` (xhigh)   | General tasks, low effort                      |
| `unspecified-high`   | `kimi-for-coding/kimi-k3` (max)  | General tasks, high effort                     |
| `writing`            | `kimi-for-coding/kimi-k3` (low)  | Documentation, prose, technical writing        |

> **Note**: Built-in category defaults are available automatically. User-defined category config merges over the built-in defaults or adds custom categories.

#### Category Options

| Option              | Type          | Default | Description                                                         |
| ------------------- | ------------- | ------- | ------------------------------------------------------------------- |
| `model`             | string        | -       | Model override                                                      |
| `models`            | array         | -       | Ordered model chain; entries are strings or per-model objects       |
| `fallback_models`   | string\|array | -       | Deprecated compatibility fallback chain                            |
| `reasoning`         | string        | -       | Canonical reasoning level or harness-native preset token            |
| `temperature`       | number        | -       | Sampling temperature                                                |
| `top_p`             | number        | -       | Top-p sampling                                                      |
| `max_tokens`        | number        | -       | Canonical max response tokens                                       |
| `provider_options`  | object        | -       | Provider-specific request options                                   |
| `maxTokens`         | number        | -       | Deprecated compatibility input; use `max_tokens`                    |
| `thinking`          | object        | -       | Migrated legacy form; use `reasoning` plus `provider_options`       |
| `reasoningEffort`   | string        | -       | Deprecated compatibility input; use `reasoning`                     |
| `textVerbosity`     | string        | -       | Text verbosity                                                      |
| `tools`             | object        | -       | Tool usage control (disable with `{ "tool_name": false }`)         |
| `prompt_append`     | string        | -       | Append to system prompt                                             |
| `max_prompt_tokens` | number        | -       | Maximum prompt tokens for delegated tasks                           |
| `variant`           | string        | -       | Deprecated compatibility input; use `reasoning`                     |
| `description`       | string        | -       | Shown in `task()` tool prompt                                       |
| `is_unstable_agent` | boolean       | `false` | Force background mode + monitoring. Auto-enabled for Gemini models. |
| `disable`           | boolean       | `false` | Exclude this category from task delegation                          |
| `warn_unavailable`  | boolean       | -       | Suppress the once-per-session dead-chain warning for this category. A category set here still respects the global `task.warnings.unavailable_categories` flag. |

Disable categories: `{ "categories": { "ultrabrain": { "disable": true } } }`

### Model Resolution

Runtime priority:

The same resolved chain drives spawn-time selection and runtime retry fallback, so a recovered task stays on the same category chain.

A builtin category can be hidden from `availableCategories` when none of its fallback-chain rungs resolves against the live registry. Spawns then fail with `model_unavailable`, carry the attempted chain and missing providers, and emit a once-per-session warning unless `task.warnings.unavailable_categories` is false or `categories.<name>.warn_unavailable` is false. Setting an explicit category model is the forcing path.


1. **UI-selected model** - model chosen in the OpenCode UI, for primary agents
2. **User override** - model set in config → used exactly as-is. Even on cold cache, explicit user configuration takes precedence over hardcoded fallback chains
3. **Category default** - model inherited from the assigned category config
4. **User `fallback_models`** - user-configured fallback list is tried before built-in fallback chains
5. **Provider fallback chain** - built-in provider/model chain from OmO source
6. **System default** - OpenCode's configured default model

The same resolved chain drives spawn-time selection and runtime retry fallback, so a recovered task stays on the same category chain.

A builtin category can be hidden from `availableCategories` when none of its fallback-chain rungs resolves against the live registry. Spawns then fail with `model_unavailable`, carry the attempted chain and missing providers, and emit a once-per-session warning unless `task.warnings.unavailable_categories` is false or `categories.<name>.warn_unavailable` is false. Setting an explicit category model is the forcing path.

A builtin category can be hidden from `availableCategories` when none of its fallback-chain rungs resolves against the live registry. Spawns then fail with `model_unavailable`, carry the attempted chain and missing providers, and emit a once-per-session warning unless `task.warnings.unavailable_categories` is false or `categories.<name>.warn_unavailable` is false. Setting an explicit category model is the forcing path.

#### Model Settings Compatibility

Model settings are compatibility-normalized against model capabilities instead of failing hard.

Normalized fields:

- `reasoning` - downgraded to the closest supported value, or removed if unsupported
- `temperature` - removed if unsupported by the model metadata
- `top_p` - removed if unsupported by the model metadata
- `maxTokens` - capped to the model's reported max output limit
- Provider-specific thinking options - removed if the target model does not support thinking

Deprecated `reasoningEffort` and `variant` inputs are first migrated to `reasoning`.

Examples:
- GPT-4.1 does not support reasoning, so `reasoning` is removed
- o-series models support `off` through `high`, so `xhigh` is downgraded to `high`
- GPT-5 supports `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`

Capability data comes from provider runtime metadata first. OmO also ships bundled models.dev-backed capability data, supports a refreshable local models.dev cache, and falls back to heuristic family detection plus alias rules when exact metadata is unavailable. `bunx oh-my-openagent doctor` surfaces capability diagnostics and warns when a configured model relies on compatibility fallback.


#### Agent Provider Chains

| Agent | Default Model | Provider Priority |
| --- | --- | --- |
| **Sisyphus** | `claude-opus-5` | `anthropic\|github-copilot\|opencode\|vercel/claude-opus-5 (max)` → `opencode-go\|kimi-for-coding\|moonshotai\|opencode\|vercel\|bailian-coding-plan\|moonshotai-cn\|firmware\|ollama-cloud\|aihubmix/kimi-k3` → `openai\|github-copilot\|opencode\|vercel/gpt-5.6-sol (medium)` → `zai-coding-plan\|opencode\|bailian-coding-plan\|vercel/glm-5.2` → `opencode/big-pickle` |
| **Hephaestus** | `gpt-5.6-sol` | `openai\|github-copilot\|vercel\|opencode/gpt-5.6-sol (medium)` |
| **Oracle** | `gpt-5.6-sol` | `openai\|opencode\|vercel/gpt-5.6-sol (xhigh)` → `github-copilot/gpt-5.6-sol (high)` → `google\|github-copilot\|opencode\|vercel/gemini-3.1-pro (high)` → `anthropic\|github-copilot\|opencode\|vercel/claude-opus-5 (max)` → `opencode-go\|vercel/glm-5.2` |
| **Librarian** | `gpt-5.6-luna-fast` | `openai/gpt-5.6-luna-fast (low)` → `deepseek/deepseek-v4-flash (max)` → `opencode-go\|bailian-coding-plan/qwen3.7-plus` → `vercel/minimax-m2.7-highspeed` → `opencode-go\|vercel/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go\|vercel/minimax-m2.7` → `anthropic\|github-copilot\|vercel/claude-haiku-4-5` → `openai\|vercel/gpt-5.4-nano` |
| **Explore** | `gpt-5.6-luna-fast` | `openai/gpt-5.6-luna-fast (low)` → `deepseek/deepseek-v4-flash (max)` → `opencode-go\|bailian-coding-plan/qwen3.7-plus` → `vercel/minimax-m2.7-highspeed` → `opencode-go\|vercel/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go\|vercel/minimax-m2.7` → `anthropic\|github-copilot\|vercel/claude-haiku-4-5` → `openai\|vercel/gpt-5.4-nano` |
| **Multimodal Looker** | `gpt-5.6-sol` | `openai\|opencode\|vercel/gpt-5.6-sol (low)` → `opencode-go\|vercel/kimi-k3` → `zai-coding-plan\|vercel/glm-4.6v` → `openai\|github-copilot\|opencode\|vercel/gpt-5-nano` |
| **Prometheus** | `claude-fable-5` | `anthropic\|github-copilot\|opencode\|vercel/claude-fable-5 (xhigh)` → `opencode-go\|kimi-for-coding\|moonshotai\|opencode\|vercel/kimi-k3 (max)` |
| **Metis** | `claude-opus-5` | `anthropic\|github-copilot\|opencode\|vercel/claude-opus-5 (high)` → `opencode-go\|kimi-for-coding\|moonshotai\|opencode\|vercel/kimi-k3 (low)` |
| **Momus** | `gpt-5.6-terra` | `openai\|vercel/gpt-5.6-terra (high)` → `github-copilot/gpt-5.6-terra (high)` → `openai\|opencode\|vercel/gpt-5.6-sol (xhigh)` → `github-copilot/gpt-5.6-sol (high)` → `anthropic\|github-copilot\|opencode\|vercel/claude-opus-5 (max)` → `google\|github-copilot\|opencode\|vercel/gemini-3.1-pro (high)` → `opencode-go\|vercel/glm-5.2` |
| **Atlas** | `claude-sonnet-5` | `anthropic\|github-copilot\|opencode\|vercel/claude-sonnet-5` → `opencode-go\|vercel/kimi-k3` → `openai\|github-copilot\|opencode\|vercel/gpt-5.6-sol (medium)` → `opencode-go\|vercel/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go\|vercel/minimax-m2.7` |
| **Sisyphus Junior** | `claude-sonnet-5` | `anthropic\|github-copilot\|opencode\|vercel/claude-sonnet-5` → `opencode-go\|vercel/kimi-k3` → `openai\|github-copilot\|opencode\|vercel/gpt-5.6-sol (medium)` → `opencode-go\|vercel/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go\|vercel/minimax-m2.7` → `opencode/big-pickle` |

#### Category Provider Chains

This table mirrors the authoritative hardcoded category fallback chains, including each default first rung and its remaining provider priority.

| Category | Provider Chain Primary | Provider Priority |
| --- | --- | --- |
| **Visual Engineering** | `claude-opus-5` | `anthropic\|anthropic-api\|github-copilot\|opencode\|vercel/claude-opus-5 (max)` → `kimi-for-coding\|moonshotai\|opencode-go\|opencode\|vercel/kimi-k3 (max)` → `zai-coding-plan\|opencode-go\|vercel/glm-5.2 (max)` → `openai\|quotio-openai\|github-copilot\|opencode\|vercel/gpt-5.6-sol (medium)` |
| **Ultrabrain** | `gpt-5.6-sol` | `openai\|quotio-openai\|vercel/gpt-5.6-sol (max)` → `github-copilot/gpt-5.6-sol (max)` → `openai\|opencode\|vercel/gpt-5.6-sol (max)` |
| **Deep** | `gpt-5.6-sol` | `openai\|quotio-openai\|github-copilot\|opencode\|vercel/gpt-5.6-sol (medium)` |
| **Artistry** | `claude-fable-5` | `anthropic\|anthropic-api\|github-copilot\|opencode\|vercel/claude-fable-5 (xhigh)` → `kimi-for-coding\|moonshotai\|opencode-go\|opencode\|vercel/kimi-k3 (max)` → `anthropic\|anthropic-api\|github-copilot\|opencode\|vercel/claude-opus-5 (xhigh)` |
| **Quick** | `kimi-for-coding-highspeed` | `kimi-for-coding/kimi-for-coding-highspeed` → `quotio-openai/gpt-5.6-luna-fast (low)` → `deepseek/deepseek-v4-flash (off)` → `qwen-token-plan\|alibaba-token-plan\|bailian-coding-plan\|opencode-go\|vercel/qwen3.6-flash (low)` → `opencode-go\|vercel/minimax-m3 (max)` → `opencode-go\|vercel/minimax-m2.7 (max)` → `xai/grok-4.20-0309-non-reasoning` → `anthropic\|anthropic-api\|github-copilot\|vercel/claude-haiku-4-5 (off)` |
| **Unspecified Low** | `gpt-5.6-terra` | `openai\|quotio-openai\|github-copilot\|opencode\|vercel/gpt-5.6-terra (high)` → `anthropic\|anthropic-api\|github-copilot\|opencode\|vercel/claude-sonnet-5 (low)` → `qwen-token-plan\|alibaba-token-plan\|qwen-token-plan-cn\|alibaba-token-plan-cn/qwen3.8-max-preview (max)` → `deepseek\|opencode-go\|vercel/deepseek-v4-pro (max)` → `xiaomi\|opencode-go\|vercel/mimo-v2.5-pro (max)` |
| **Unspecified High** | `kimi-k3` | `kimi-for-coding\|moonshotai\|opencode-go\|opencode\|vercel/kimi-k3 (max)` → `anthropic\|anthropic-api\|github-copilot\|opencode\|vercel/claude-opus-5 (xhigh)` → `openai\|quotio-openai\|github-copilot\|opencode\|vercel/gpt-5.6-sol (high)` |
| **Writing** | `kimi-k3` | `kimi-for-coding\|moonshotai\|opencode-go\|opencode\|vercel/kimi-k3 (low)` → `anthropic\|anthropic-api\|github-copilot\|opencode\|vercel/claude-opus-5 (low)` → `google\|github-copilot\|opencode\|vercel/gemini-3.6-flash` |

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
    "modelConcurrency": { "anthropic/claude-opus-5": 2 }
  }
}
```

| Option                | Default  | Description                                                           |
| --------------------- | -------- | --------------------------------------------------------------------- |
| `defaultConcurrency`        | `5`       | Max concurrent tasks (all providers)                                  |
| `providerConcurrency`       | -         | Per-provider limits (key = provider name)                             |
| `modelConcurrency`          | -         | Per-model limits (key = `provider/model`). Overrides provider limits. |
| `maxDepth`                  | -         | Maximum nested subagent depth (min: 1)                                |
| `staleTimeoutMs`            | `180000`  | Interrupt tasks with no activity (min: 60000)                         |
| `messageStalenessTimeoutMs` | `1800000` | Timeout when no progress update was ever received (min: 60000)        |
| `taskTtlMs`                 | `1800000` | Absolute non-terminal task TTL (min: 300000)                          |
| `sessionGoneTimeoutMs`      | `60000`   | Timeout when a task session disappears (min: 10000)                   |
| `taskCleanupDelayMs`        | `600000`  | Delay before terminal tasks are removed (min: 60000)                  |
| `syncPollTimeoutMs`         | -         | Synchronous polling timeout in milliseconds (min: 60000)             |
| `maxToolCalls`              | `200`     | Maximum tool calls per subagent task (min: 10)                        |
| `circuitBreaker`            | -         | Circuit-breaker object: `enabled`, `maxToolCalls`, `consecutiveThreshold` |

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

File-based task persistence with dependency tracking, used for cross-session task management. The task system is controlled by `experimental.task_system` (defaults to `false`). When enabled, `TodoWrite`/`TodoRead` are intercepted and replaced with the Task tools (`task_create`, `task_get`, `task_list`, `task_update`).

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

Available hooks: `todo-continuation-enforcer`, `session-notification`, `comment-checker`, `tool-output-truncator`, `question-label-truncator`, `directory-agents-injector`, `directory-readme-injector`, `empty-task-response-detector`, `think-mode`, `model-fallback`, `anthropic-context-window-limit-recovery`, `preemptive-compaction`, `rules-injector`, `background-notification`, `auto-update-checker`, `codegraph-bootstrap`, `ast-grep-sg-provision`, `startup-toast`, `keyword-detector`, `agent-usage-reminder`, `non-interactive-env`, `interactive-bash-session`, `tool-pair-validator`, `monitor-status-injector`, `goal`, `category-skill-reminder`, `compaction-context-injector`, `compaction-todo-preserver`, `claude-code-hooks`, `auto-slash-command`, `edit-error-recovery`, `json-error-recovery`, `delegate-task-retry`, `prometheus-md-only`, `sisyphus-junior-notepad`, `team-tool-gating`, `no-sisyphus-gpt`, `no-hephaestus-non-gpt`, `hephaestus-agents-md-injector`, `start-work`, `atlas`, `unstable-agent-babysitter`, `task-resume-info`, `stop-continuation-guard`, `tasks-todowrite-disabler`, `runtime-fallback`, `write-existing-file-guard`, `notepad-write-guard`, `bash-file-read-guard`, `hashline-read-enhancer`, `read-image-resizer`, `todo-description-override`, `webfetch-redirect-guard`, `fsync-skip-warning`, `plan-format-validator`, `legacy-plugin-toast`

Guard hooks such as `team-tool-gating`, `write-existing-file-guard`, `bash-file-read-guard`, `webfetch-redirect-guard`, `prometheus-md-only`, `rules-injector`, and `tool-pair-validator` protect safety, permissions, or provider protocol correctness. Disable them only for audited local debugging in a trusted environment.

**Notes:**

- `directory-agents-injector` - auto-disabled on OpenCode 1.1.37+ (native AGENTS.md support)
- `no-sisyphus-gpt` - **do not disable**. It blocks incompatible GPT models for Sisyphus while allowing GPT-5.4 and the shared model-aware GPT-5.5/GPT-5.6 Sol prompt paths.
- `startup-toast` is a sub-feature of `auto-update-checker`. Disable just the toast by adding `startup-toast` to `disabled_hooks`.

### Commands

Disable built-in commands via `disabled_commands`:

```json
{ "disabled_commands": ["refactor", "start-work"] }
```

Available commands: `goal`, `refactor`, `start-work`, `stop-continuation`, `remove-ai-slops`, `handoff`, `hyperplan`. The `disabled_commands` option currently accepts only the schema enum, which does not include `handoff`.

### Browser Automation

| Provider               | Interface | Installation                                        |
| ---------------------- | --------- | --------------------------------------------------- |
| `playwright` (default) | MCP tools | Auto-installed via npx                              |
| `agent-browser`        | Bash CLI  | `bun add -g agent-browser && agent-browser install` |
| `dev-browser`          | Skill     | Uses persistent dev-browser state                   |
| `playwright-cli`       | Bash CLI  | Uses the token-efficient `@playwright/cli`           |

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
    "agent_pane_min_width": 40,
    "isolation": "inline"
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
| `isolation`            | `inline`        | `inline` / `window` / `session`                                                     |

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

Built-in MCPs (enabled by default): `websearch` (Exa AI), `context7` (library docs), `grep_app` (GitHub code search), `lsp` (local language-server tools), and `codegraph`. Structural search and rewrite is provided by the `ast-grep` skill instead of a built-in MCP.

```json
{ "disabled_mcps": ["websearch", "context7", "grep_app", "lsp", "codegraph"] }
```

### LSP

LSP tools are served by the built-in `lsp` MCP server (see [MCPs](#mcps)). The
previous top-level `"lsp"` block in the plugin config is no longer read; the
unified config migration strips it when importing a legacy file.

To configure custom language servers, create `.opencode/lsp.json`, `.omo/lsp.json`, or `.omo/lsp-client.json` at the project root. The MCP server launches with `LSP_TOOLS_MCP_PROJECT_CONFIG` set to a platform-delimiter-separated search list of those three paths and reads the first applicable server maps. The schema lives in the
`packages/lsp-tools-mcp` vendored package (upstream:
[code-yeongyu/lsp-tools-mcp](https://github.com/code-yeongyu/lsp-tools-mcp)).

To disable the LSP MCP entirely:

```json
{ "disabled_mcps": ["lsp"] }
```

### CodeGraph

The `codegraph` MCP ships a pinned CodeGraph 1.5.0 binary; managed installs provisioned at 1.0.1 or 1.4.1 upgrade automatically, and project stores built by older versions remain compatible without a manual re-index. The OpenCode plugin block supports the full surface below:

| Option | Type | Default |
| ------ | ---- | ------- |
| `auto_init` | boolean | `true` |
| `auto_provision` | boolean | `true` |
| `daemon` | boolean | `true` |
| `enabled` | boolean | `true` |
| `excluded_roots` | string[] | - |
| `install_dir` | string | - |
| `telemetry` | boolean | - |
| `watch_debounce_ms` | number >= 0 | - |

```jsonc
{
  "codegraph": {
    "auto_init": true,
    "auto_provision": true,
    "daemon": true,
    "enabled": true,
    "excluded_roots": ["~/scratch/codegraph"],
    "install_dir": "~/.omo/codegraph/bin",
    "telemetry": false,
    "watch_debounce_ms": 500
  }
}
```

`session_start_cooldown_ms` is not an OpenCode plugin `codegraph` key. It is a Codex-only shared key, so place it under top-level `codegraph` or `[codex].codegraph` in the unified file:

```jsonc
{
  "[codex]": {
    "codegraph": { "session_start_cooldown_ms": 900000 }
  }
}
```

The Codex SessionStart bootstrap checks only `<projectRoot>/.codegraph/codegraph.db`; it never calls `codegraph status`. An ancestor database covers nested projects, while per-project locks and persistent cooldown stamps suppress duplicate or repeatedly failing background initializers. Suppressions are recorded in `~/.omo/codegraph/session-start.jsonl` as actions including `skipped-cooldown`, `skipped-locked`, and `skipped-nested-root`.

An ambient `CODEGRAPH_NO_DAEMON=1` forces daemon-off even when `codegraph.daemon` is `true`. Inspect or stop running daemons with the upstream `codegraph daemon` command, an interactive picker that lists running daemons and stops the one you select.

Process hygiene is unconditional and has no config keys: a parent-liveness watchdog exits MCP server processes when their parent dies, a newly started lsp daemon reaps older-version daemons at startup, and a best-effort family sweep removes orphaned codegraph and lsp processes at startup on every adapter (OpenCode plugin startup, the Codex `SessionStart` hook, and Senpi session start).

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
| `timeout_seconds`       | `30`                | Seconds before forcing next fallback. **Set to `0` to disable timeout-based escalation and `message.updated` provider retry signal detection.** Structured `session.status` retry events can still trigger fallback. |
| `notify_on_fallback`    | `true`              | Toast notification on model switch                                                                                             |
| `restore_primary_after_cooldown` | `false` | Return to the primary model after its cooldown expires                                                                       |

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
      "model": "anthropic/claude-opus-5",
      "fallback_models": [
        "openai/gpt-5.6-sol",
        {
          "model": "google/gemini-3.1-pro",
          "reasoning": "high"
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
      "model": "anthropic/claude-opus-5",
      "fallback_models": [
        "openai/gpt-5.6-sol",
        {
          "model": "anthropic/claude-sonnet-5",
          "reasoning": "high"
        },
        {
          "model": "openai/gpt-5.6-sol",
          "reasoning": "high",
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
| `reasoning` | string | Canonical reasoning override for this fallback entry. |
| `temperature` | number | Temperature applied if this fallback model becomes active. |
| `top_p` | number | Top-p applied if this fallback model becomes active. |
| `maxTokens` | number | Max response tokens applied if this fallback model becomes active. |
| `variant` | string | Deprecated compatibility input normalized to `reasoning`. |
| `reasoningEffort` | string | Deprecated compatibility input normalized to `reasoning`. |
| `thinking` | object | Legacy form normalized to `reasoning` plus `provider_options.thinking` in the unified shape. |

Per-model settings are **fallback-only**. They are promoted only when that specific fallback model is actually selected, so they do not override your primary model settings when the primary model resolves successfully.

`thinking` uses the same shape as the normal agent/category option:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `type` | string | `enabled` or `disabled` |
| `budgetTokens` | number | Optional Anthropic thinking budget |

Object entries can also omit the provider prefix when OmO can infer it from the current/default provider. Canonical `reasoning` takes precedence over deprecated `reasoningEffort`, which takes precedence over deprecated `variant`; an inline model suffix is normalized separately.

#### Full examples

**1. Simple string chain**

Use strings when you only need an ordered fallback chain:

```json
{
  "agents": {
    "atlas": {
      "model": "anthropic/claude-sonnet-5",
      "fallback_models": [
        "anthropic/claude-haiku-4-5",
        "openai/gpt-5.6-sol",
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
      "model": "openai/gpt-5.6-sol",
      "fallback_models": [
        "gpt-5.6-luna-fast",
        {
          "model": "gpt-5.6-sol",
          "reasoning": "medium",
          "maxTokens": 4096
        }
      ]
    }
  }
}
```

In this example OmO treats `gpt-5.6-luna-fast` and `gpt-5.6-sol` as OpenAI fallback entries because the current/default provider is already `openai`.

**3. Mixed cross-provider chain**

Mix string entries and object entries when only some fallback models need special settings:

```json
{
  "agents": {
    "sisyphus": {
      "model": "anthropic/claude-opus-5",
      "fallback_models": [
        "openai/gpt-5.6-sol",
        {
          "model": "anthropic/claude-sonnet-5",
          "reasoning": "high"
        },
        {
          "model": "google/gemini-3.1-pro",
          "reasoning": "high"
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
      "model": "openai/gpt-5.6-sol",
      "fallback_models": [
        {
          "model": "openai/gpt-5.6-sol",
          "reasoning": "xhigh",
          "maxTokens": 12000
        },
        {
          "model": "anthropic/claude-opus-5",
          "reasoning": "max",
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
      "model": "openai/gpt-5.6-sol",
      "fallback_models": [
        {
          "model": "openai/gpt-5.6-sol(low)",
          "reasoning": "high",
          "temperature": 0.3,
          "top_p": 0.9,
          "maxTokens": 8192
        }
      ]
    }
  }
}
```

In this example the explicit `"reasoning": "high"` is canonical; deprecated fields are resolved with precedence `reasoning` > `reasoningEffort` > `variant`, while the inline `(low)` suffix is normalized separately.

This final example is a **complete canonical shape reference** for `[opencode]` fallback objects. Prefer unified `reasoning` for model tuning, and use provider-specific `[opencode]` fields only when the target model requires them.

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
| `preemptive_compaction`                  | -          | Enable preemptive context compaction                                                 |
| `plugin_load_timeout_ms`                 | `10000`    | Plugin component load timeout in milliseconds (min: 1000)                            |
| `safe_hook_creation`                     | `true`     | Isolate hook creation failures at the runtime call site                              |
| `model_fallback_title`                   | `false`    | Append fallback model information to the session title                              |
| `max_tools`                              | -          | Maximum number of tools to register (min: 1)                                         |
| `disable_live_parent_wake_routing`       | `false`    | Restore pre-migration in-process parent wake dispatch                                |

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
| `OMO_CODEX_DISABLE_POSTHOG` | Set to `1`, `true`, or `yes` to disable PostHog telemetry for the `omo-codex` adapter. Global `OMO_DISABLE_POSTHOG` also disables Codex telemetry. |
| `OMO_CODEX_SEND_ANONYMOUS_TELEMETRY` | Set to `0`, `false`, `no`, or `yes` to disable anonymous telemetry for `omo-codex` |
| `OMO_CODEX_GIT_BASH_PATH` | Native Windows Codex installs only. Absolute path to Git Bash, for example `C:\Program Files\Git\bin\bash.exe`, when `where bash` cannot find it |
| `LAZYCODEX_CONFIG_MIGRATION_DISABLED` | Set to `1` to skip the Codex config migration that runs on every session start (including the `multi_agent_v2` force-disable and managed reasoning-profile sync), leaving `config.toml` untouched |
| `OMO_CODEX_CONFIG_MIGRATION_DISABLED` | Alias of `LAZYCODEX_CONFIG_MIGRATION_DISABLED` |
| `LSP_TOOLS_MCP_INSTALL_DECISIONS` | Override the LSP install-decisions path. Codex defaults to `$CODEX_HOME/lsp-install-decisions.json`; OpenCode injects its OpenCode config-directory path. |
| `POSTHOG_API_KEY` | Optional override for the built-in PostHog project API key |
| `POSTHOG_HOST` | Override the PostHog ingestion host. Defaults to `https://us.i.posthog.com` |

### LSP Install Decisions

When an LSP tool hits a language server that is not installed, it asks once per server and persists the answer to a harness-specific file: Codex uses `$CODEX_HOME/lsp-install-decisions.json`, while OpenCode injects `lsp-install-decisions.json` under its OpenCode config directory. Override either path with `LSP_TOOLS_MCP_INSTALL_DECISIONS`. A `declined` entry collapses all future diagnostics for that server to a one-line note. To get prompted again - or to re-enable a server that an agent declined on your behalf - delete the file or the server's entry in it.

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
      "model": "anthropic/claude-opus-5",
      "reasoning": "max"
    },
    "oracle": {
      "model": "anthropic/claude-opus-5"
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
