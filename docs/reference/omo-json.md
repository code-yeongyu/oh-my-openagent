# omo.json Configuration Reference

`omo.json` (or `omo.jsonc`) is the harness-neutral configuration surface owned by [`@oh-my-opencode/omo-config-core`](../../packages/omo-config-core/AGENTS.md). Today it is read by the Senpi adapter's `task` component only; the schema, loader, and writer are shared code so other harnesses can adopt it later (see [Coexistence](#coexistence-omojson-vs-oh-my-openagentjson) and [`ROADMAP.md`](../../ROADMAP.md)).

Files may be JSONC: `//` comments and trailing commas are allowed. Every schema object is `.strict()`, so unknown keys are rejected and reported as a diagnostic rather than silently ignored.

## File locations and precedence

The loader resolves layers in `resolveOmoConfigPaths` and folds them lowest-to-highest, so the **last** layer merged wins (`packages/omo-config-core/src/loader/paths.ts`, `loader.ts`).

1. **User layer (lowest precedence).** `omo.jsonc`, falling back to `omo.json`, under:
   - `%APPDATA%\omo` on Windows,
   - else `$XDG_CONFIG_HOME/omo`,
   - else `~/.config/omo`.
2. **Project layers.** `.omo/omo.jsonc` (then `.omo/omo.json`) in every directory from the current working directory up to `$HOME`. Farther ancestors are merged first; the **nearest** project file has the highest precedence and beats the user layer.

Merge rules (`loader/merge.ts`):

- Plain objects deep-merge recursively.
- Scalars and arrays replace the lower layer wholesale.
- `__proto__`, `prototype`, and `constructor` keys are stripped from both merge keys and nested values (prototype-pollution guard).

Safety and failure handling:

- A symlinked project `.omo` directory or a symlinked project config file is skipped as a load source (`loader/paths.ts`).
- A missing, unreadable, or invalid layer becomes an entry in the result's `diagnostics` and is skipped; loading continues.
- If the merged config fails final validation, the loader returns the all-default config plus one `validation` diagnostic instead of throwing (`loader/loader.ts`).

## `$schema`

The root schema accepts an optional `$schema` string key (`packages/omo-config-core/src/schema/config.ts:8,16`); both the per-layer parse and the final merged parse (`packages/omo-config-core/src/loader/loader.ts:76,116`) carry it through and otherwise ignore it, so an editor pointer is safe to add.

A generated JSON schema artifact ships at `assets/omo.schema.json`, produced from `OmoConfigSchema` by the root `build:omo-schema` script (`script/build-omo-schema.ts`, `script/build-omo-schema-document.ts`); run `bun run build:omo-schema` to regenerate it. Point your editor at the raw dev-branch URL:

```
https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json
```

### Example

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",
  "categories": {
    "deep": {
      "description": "Deep analysis",
      "model": "anthropic/claude",
      "reasoningEffort": "high"
    }
  },
  "agents": {
    "reviewer": {
      "description": "Reviews code",
      "model": "openai/gpt-5",
      "execution_mode": "in-process"
    }
  },
  "task": {
    "default_execution_mode": "in-process",
    "default_concurrency": 5
  },
  "teams": {
    "builders": {
      "description": "Build team",
      "members": [
        { "name": "quick-one", "kind": "category", "category": "quick", "prompt": "Help" }
      ]
    }
  }
}
```

## Top-level schema

```jsonc
{
  "$schema": "…",        // optional editor pointer
  "categories": { … },   // record<string, CategoryConfig>
  "agents": { … },       // record<string, AgentDef>
  "task": { … },         // task engine settings
  "teams": { … }         // record<string, TeamSpec>
}
```

Source: `packages/omo-config-core/src/schema/config.ts`.

### `categories`

A record of category name to config (`schema/category.ts`). Category keys intentionally keep the OpenCode key set, including the camelCase exceptions `maxTokens`, `reasoningEffort`, `textVerbosity`, and `thinking.budgetTokens`; every other key is snake_case.

| Field | Type | Notes |
|-------|------|-------|
| `description` | string | |
| `model` | string | |
| `fallback_models` | fallback models | see [fallback models](#fallback-models) |
| `variant` | string | |
| `temperature` | number 0..2 | |
| `top_p` | number 0..1 | |
| `maxTokens` | number | camelCase for parity |
| `thinking` | `{ type: "enabled" \| "disabled", budgetTokens?: number }` | |
| `reasoningEffort` | `none \| minimal \| low \| medium \| high \| xhigh \| max` | camelCase for parity |
| `textVerbosity` | `low \| medium \| high` | camelCase for parity |
| `tools` | record<string, boolean> | per-tool allow/deny |
| `prompt_append` | string | |
| `max_prompt_tokens` | positive int | |
| `is_unstable_agent` | boolean | |
| `disable` | boolean | |

### `agents`

A record of agent name to definition (`schema/agent.ts`).

| Field | Type | Notes |
|-------|------|-------|
| `description` | string | |
| `prompt` | string | |
| `model` | string | |
| `models` | string[] | |
| `tools` | record<string, boolean> | |
| `execution_mode` | `in-process \| process` | overrides `task.default_execution_mode`; curated builtin agents remain in-process |
| `background` | boolean | |
| `max_depth` | int 0..2 | caller-specific narrowing; Senpi effective ceiling is currently `1` |
| `allowed_subagents` | string[] | |
| `temperature` | number 0..2 | |
| `disable` | boolean | |

#### Builtin agents

The Senpi task engine ships five builtin curated agents. Any Senpi session can delegate to them by name through the task tool with zero configuration, for example `task(subagent_type: "explore", ...)`. They are read-only research and review specialists; implementation and orchestration agents stay category-routed.

| Name | Purpose |
|------|---------|
| `explore` | Codebase search specialist. Answers "Where is X?", "Which file has Y?", "Find the code that does Z". Supports thoroughness levels from quick to very thorough. |
| `librarian` | Remote codebase and documentation research: searches open-source repositories, retrieves official documentation, and finds implementation examples via the GitHub CLI and direct documentation retrieval. |
| `oracle` | Read-only consultation agent for debugging hard problems and high-difficulty architecture design. |
| `metis` | Pre-planning consultant that analyzes requests to surface hidden intentions, ambiguities, and AI failure points. |
| `momus` | Expert reviewer that evaluates work plans against clarity, verifiability, and completeness standards. |

Each builtin carries its own persona prompt, a read-only tool policy, and a per-agent model fallback chain, and is pinned to `execution_mode: "in-process"`. The nine-name allowlist includes a curated `bash` override, but it is not Senpi's general shell: it directly runs only validated read-only `gh` queries and HTTPS `curl` retrievals, with no shell parsing, redirects, output files, uploads, request bodies, or mutating HTTP methods. Direct `edit`, `write`, and mutating LSP tools are excluded.

Overriding a builtin. An `agents.<name>` entry matching a builtin overlays the builtin definition field by field: only the fields you set replace the builtin values, and every unset field keeps the builtin default. Names that do not match a builtin are appended as user-defined agents. To pin `explore` to a different model while keeping its builtin prompt and tool policy:

```jsonc
{
  "agents": {
    "explore": { "model": "anthropic/claude-sonnet-4-5" }
  }
}
```

To hide a builtin from the task tool description and from spawn resolution, disable it:

```jsonc
{
  "agents": {
    "oracle": { "disable": true }
  }
}
```

Overriding `execution_mode` on a curated agent is ignored. All other configured fields retain normal field-level overlay behavior, but curated agents remain in-process because the process runner cannot carry their persona instructions or tool policy. User-defined agents keep the configured execution mode.

Curated agents and teams. A team member spec naming a curated read-only agent (`kind: "subagent_type"`) is rejected at member validation with this error:

```
curated read-only agent "oracle" cannot be a team member; delegate via the task tool instead
```

Team members always spawn in `process` mode, which cannot carry the curated persona or tool policy, so delegate to these agents through the task tool instead of naming them as team members.

### `task`

Task engine settings; every field has a default, so the whole object is optional (`schema/task.ts`).

| Field | Type | Default |
|-------|------|---------|
| `default_execution_mode` | `in-process \| process` | `in-process` |
| `default_concurrency` | positive int | `5` |
| `provider_concurrency` | record<string, positive int> | unset |
| `model_concurrency` | record<string, positive int> | unset |
| `max_depth` | int 0..2 | `1` |
| `residency_max_children` | positive int | `8` |
| `ttl_ms` | positive int | `86400000` (24h) |
| `state_dir` | string | unset (defaults to `<project>/.omo/senpi-task`) |
| `wait.min_ms` | positive int | `5000` |
| `wait.default_ms` | positive int | `60000` |
| `wait.max_ms` | positive int | `600000` |
| `team.max_members` | int 1..8 | `8` |
| `team.max_parallel_members` | int 1..8 | `4` |
| `team.max_wall_clock_minutes` | positive int | `120` |

`state_dir` defaults to `<project_dir>/.omo/senpi-task` when unset (`packages/senpi-task/src/store/state-dir.ts`). Completion delivery is not configurable: every child completion is batched with any other ready notifications and steered into the parent's running turn at the next tool-call boundary; see the completion routing table in [`packages/senpi-task/AGENTS.md`](../../packages/senpi-task/AGENTS.md).

The shared spawn-policy ceiling is `2`, but the Senpi adapter currently caps effective depth at `1` because delegated child runtimes do not expose general spawn tools. `allowed_subagents` narrows target names only and cannot expand caller-role, lineage, or depth permission. Process recovery rebuilds launch inputs from current target resolution, runtime paths, extensions, environment, and caller policy; persisted launch fields never control a respawn.

### `teams`

A record of team name to spec (`schema/team.ts`). Each spec:

| Field | Type | Notes |
|-------|------|-------|
| `version` | literal `1` | default `1` |
| `name` | string matching `^[a-z0-9-]+$` | optional |
| `description` | string | |
| `createdAt` | positive int | epoch ms |
| `leadAgentId` | string | required when `members` has more than one entry |
| `teamAllowedPaths` | string[] | |
| `sessionPermission` | string | |
| `members` | 1..8 members | discriminated on `kind` |

Each member shares a base (`name` matching `^[a-z0-9-]+$`, optional `cwd`, `worktreePath`, `subscriptions`, `color`, `isActive` default `true`, `backendType` default `in-process`) and one of two `kind`s:

- `kind: "category"` requires `category` and `prompt`.
- `kind: "subagent_type"` requires `subagent_type`; `prompt` is optional.

### Fallback models

`fallback_models` (on a category) and per-model fallback entries accept a union (`schema/fallback-models.ts`): a single model string, an array of model strings, an array of objects, or a mixed array. Each object is `{ model, variant?, reasoningEffort?, temperature?, top_p?, maxTokens?, thinking? }`.

## Example

```jsonc
// .omo/omo.jsonc
{
  "task": {
    "default_execution_mode": "in-process",
    "default_concurrency": 4,
    "wait": { "default_ms": 90000 }
  },
  "categories": {
    "deep": {
      "model": "anthropic/claude-opus-4-8",
      "reasoningEffort": "high",
      "fallback_models": ["anthropic/claude-sonnet-4-5"]
    }
  },
  "agents": {
    "researcher": {
      "description": "Read-only investigator",
      "execution_mode": "process",
      "tools": { "task": false }
    }
  },
  "teams": {
    "reviewers": {
      "leadAgentId": "lead",
      "members": [
        { "kind": "category", "name": "quick", "category": "deep", "prompt": "Review the diff." }
      ]
    }
  }
}
```

## Coexistence: `omo.json` vs `oh-my-openagent.json`

`omo.json` and the OpenCode-family config (`oh-my-openagent.json` / `oh-my-opencode.json`) have **zero interaction today**. They are separate files read by separate loaders:

- The OpenCode plugin reads the walked `oh-my-openagent.json[c]` chain (see [`docs/reference/configuration.md`](./configuration.md)).
- The Senpi `task` component reads `omo.json` only, through `@oh-my-opencode/omo-config-core`.

There is no automatic migration or field bridging between the two. When a project contains BOTH an OpenCode-family config and an `omo.json` that contributed `categories`/`agents`, the Senpi task component emits a one-time warning on first session start noting that senpi reads `omo.json` only and ignores the OpenCode config for tasks (`packages/omo-senpi/src/components/task/coexistence.ts`).

This is deliberate: `omo.json` landed **senpi-first**. Adopting it in the OpenCode edition, and any migration path from `oh-my-openagent.json`, is a later phase tracked in [`ROADMAP.md`](../../ROADMAP.md).

## Follow-ups

- `member.backendType: "tmux"` and non-project (user-global) team storage are schema-level only and are not exercised by the current Senpi runtime; use `in-process` members in project `.omo/` teams.
- OpenCode-edition adoption of `omo.json` and a `oh-my-openagent.json` migration path are not implemented.
