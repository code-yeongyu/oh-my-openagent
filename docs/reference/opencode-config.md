# OpenCode edition configuration (legacy)

This page documents the `[opencode]` keys and hooks that only the OpenCode edition reads; omo-senpi ignores every one of them. The sections below were moved verbatim from [configuration.md](./configuration.md) and [features.md](./features.md).

---

## Agents

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

- **Stable agent ordering**: core-agent tab cycling defaults to Sisyphus, Hephaestus, Prometheus, Atlas, and can be customized with `agent_order`
- **Canonical core agent order**: Sisyphus, Hephaestus, Prometheus, Atlas.

### Prometheus prompt handling

Prometheus is the exception for prompt replacement: its mandatory planner prompt always remains active so it can load `ulw-plan` first. For `agents.prometheus`, both `prompt` and `prompt_append` are appended to the mandatory base prompt instead of replacing it.

For Prometheus, file-backed `prompt` content is appended after the mandatory base prompt; it does not replace the base prompt.

### Quick Start agent block

The `agents` block of the OpenCode edition quick start, with the per-agent overrides for its core agents:

```jsonc
{
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
  },
}
```

### Per-agent override examples

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

#### File URIs for Prompts

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

#### Runtime fallback: `fallback_models` per agent

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

**1. Simple string chain**

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

**3. Mixed cross-provider chain**

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

**5. Full object entry with every supported field**

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

#### Split Claude Routing (Antigravity)

```jsonc
{
  "agents": {
    // Google Antigravity Claude.
    "explore": {
      "model": "google/antigravity-claude-sonnet-4-6"
    },
    "librarian": {
      "model": "google/antigravity-claude-sonnet-4-6"
    },

    // Direct Anthropic, only for eligible long-context accounts/models.
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

#### features.md examples

```jsonc
{
  "agents": {
    "sisyphus": {
      "fallback_models": [
        "opencode/glm-5.2",
        { "model": "openai/gpt-5.6-sol", "variant": "high" },
        { "model": "anthropic/claude-sonnet-5", "thinking": { "type": "enabled", "budgetTokens": 64000 } }
      ]
    }
  }
}
```

```jsonc
{
  "agents": {
    "sisyphus": {
      "prompt": "file:///path/to/custom-prompt.md"
    },
    "oracle": {
      "prompt_append": "file:///path/to/additional-context.md"
    }
  },
  "categories": {
    "deep": {
      "prompt_append": "file:///path/to/deep-category-append.md"
    }
  }
}
```

### Agent Provider Chains

| Agent | Default Model | Provider Priority |
| --- | --- | --- |
| **Sisyphus** | `claude-opus-5` | `anthropic\|github-copilot\|opencode/claude-opus-5 (max)` → `opencode-go\|kimi-for-coding\|moonshotai\|opencode\|bailian-coding-plan\|moonshotai-cn\|firmware\|ollama-cloud\|aihubmix/kimi-k3` → `openai\|openai-codex\|github-copilot\|opencode/gpt-5.6-sol (medium)` → `zai-coding-plan\|opencode\|bailian-coding-plan/glm-5.2` → `opencode/big-pickle`
| **Hephaestus** | `gpt-5.6-sol` | `openai\|openai-codex\|github-copilot\|opencode/gpt-5.6-sol (medium)`
| **Oracle** | `gpt-5.6-sol` | `openai\|openai-codex\|opencode/gpt-5.6-sol (xhigh)` → `github-copilot/gpt-5.6-sol (high)` → `google\|github-copilot\|opencode/gemini-3.1-pro (high)` → `anthropic\|github-copilot\|opencode/claude-opus-5 (max)` → `opencode-go/glm-5.2`
| **Librarian** | `gpt-5.6-luna-fast` | `openai\|openai-codex/gpt-5.6-luna-fast (low)` → `deepseek/deepseek-v4-flash (max)` → `opencode-go\|bailian-coding-plan/qwen3.7-plus` → `opencode-go/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go/minimax-m2.7` → `anthropic\|github-copilot/claude-haiku-4-5` → `openai\|openai-codex/gpt-5.4-nano`
| **Explore** | `gpt-5.6-luna-fast` | `openai\|openai-codex/gpt-5.6-luna-fast (low)` → `deepseek/deepseek-v4-flash (max)` → `opencode-go\|bailian-coding-plan/qwen3.7-plus` → `opencode-go/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go/minimax-m2.7` → `anthropic\|github-copilot/claude-haiku-4-5` → `openai\|openai-codex/gpt-5.4-nano`
| **Multimodal Looker** | `gpt-5.6-sol` | `openai\|openai-codex\|opencode/gpt-5.6-sol (low)` → `opencode-go/kimi-k3` → `zai-coding-plan/glm-4.6v` → `openai\|openai-codex\|github-copilot\|opencode/gpt-5-nano`
| **Prometheus** | `claude-fable-5-1` | `anthropic\|github-copilot\|opencode/claude-fable-5-1 (xhigh)` → `opencode-go\|kimi-for-coding\|moonshotai\|opencode/kimi-k3 (max)`
| **Metis** | `claude-opus-5` | `anthropic\|github-copilot\|opencode/claude-opus-5 (high)` → `opencode-go\|kimi-for-coding\|moonshotai\|opencode/kimi-k3 (low)`
| **Momus** | `gpt-6-astra` | `openai\|openai-codex/gpt-6-astra (xhigh)` → `github-copilot/gpt-6-astra (high)` → `openai\|openai-codex\|opencode/gpt-6-astra (high)` → `anthropic\|github-copilot\|opencode/claude-opus-5 (max)` → `google\|github-copilot\|opencode/gemini-3.1-pro (high)` → `opencode-go/glm-5.2`
| **Atlas** | `claude-sonnet-5` | `anthropic\|github-copilot\|opencode/claude-sonnet-5` → `opencode-go/kimi-k3` → `openai\|openai-codex\|github-copilot\|opencode/gpt-5.6-sol (medium)` → `opencode-go/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go/minimax-m2.7`
| **Sisyphus Junior** | `claude-sonnet-5` | `anthropic\|github-copilot\|opencode/claude-sonnet-5` → `opencode-go/kimi-k3` → `openai\|openai-codex\|github-copilot\|opencode/gpt-5.6-sol (medium)` → `opencode-go/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go/minimax-m2.7` → `opencode/big-pickle`

### Invoking Agents

```
Ask @oracle to review this design and propose an architecture
Ask @librarian how this is implemented - why does the behavior keep changing?
Ask @explore for the policy on this feature
```

### Tool Restrictions

| Agent             | Restrictions                                                                            |
| ----------------- | --------------------------------------------------------------------------------------- |
| oracle            | Read-only: cannot write or edit (blocked: write, edit, apply_patch, task, call_omo_agent)            |
| librarian         | Cannot write, edit, or delegate (blocked: write, edit, task, call_omo_agent)            |
| explore           | Cannot write, edit, or delegate (blocked: write, edit, task, call_omo_agent)            |
| multimodal-looker | Allowlist: `read` only                                                                  |
| momus             | Cannot write or edit (blocked: write, edit); `task` is not denied                       |

---

## Task System

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
| `tdd`                     | `true`  | TDD mode for Sisyphus orchestration                             |
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
      "claude_code_compat": false
    }
  }
}
```

| Option               | Default           | Description                                |
| -------------------- | ----------------- | ------------------------------------------ |
| `storage_path`       | OpenCode config dir `/tasks/<list-id>` | Optional override; relative paths join the working directory |
| `task_list_id`       | -                 | Force task list ID (alternative to env `ULTRAWORK_TASK_LIST_ID`) |
| `claude_code_compat` | `false`           | Enable Claude Code path compatibility mode |

To disable the task system entirely, set `experimental.task_system` to `false`:

```json
{
  "experimental": { "task_system": false }
}
```

---

## Hooks

Hook names in `disabled_hooks` that exist only in the OpenCode edition: `prometheus-md-only`, `sisyphus-junior-notepad`, `no-sisyphus-gpt`, `no-hephaestus-non-gpt`, `hephaestus-agents-md-injector`, `atlas`.

**Notes:**

- `no-sisyphus-gpt` - **do not disable**. It blocks incompatible GPT models for Sisyphus while allowing GPT-5.4 and the shared model-aware GPT-5.5/GPT-5.6 Sol prompt paths.

### /ulw-execute (OpenCode edition)

Switches the session to Atlas (Sisyphus if Atlas is unregistered), injects Prometheus plan + boulder + worktree/PR context, then Atlas executes. First actions are `create_goal` and todo registration, not immediate coding.

#### Productivity & Control

| Hook                        | Event               | Description                                                                                                                                                 |
| --------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ulw-execute**              | Message + command.execute.before | After /ulw-execute is expanded, selects a Prometheus plan, initializes boulder state, scaffolds notepads, switches the session to Atlas, and injects plan context. |

#### Integration

| Hook                         | Event               | Description                                             |
| ---------------------------- | ------------------- | ------------------------------------------------------- |
| **atlas**                    | Event + PreToolUse + PostToolUse | Continuation-tier boulder orchestrator: on session.idle continues incomplete boulder work; enforces write/edit policy for subagent sessions; first-prompt watchdog. |

#### Specialized

| Hook                        | Event      | Description                                                |
| --------------------------- | ---------- | ---------------------------------------------------------- |
| **prometheus-md-only**      | PreToolUse | Restricts Prometheus write/edit tools to `.omo/*.md` plan files.      |
| **no-sisyphus-gpt**         | Message    | Prevents Sisyphus from running on incompatible GPT models. |
| **no-hephaestus-non-gpt**   | Message    | Prevents Hephaestus from running on non-GPT models.        |
| **sisyphus-junior-notepad** | PreToolUse | Manages notepad state for Sisyphus-Junior agents.          |
