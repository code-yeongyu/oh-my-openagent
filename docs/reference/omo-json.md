# omo.json Configuration Reference

`omo.json` (or `omo.jsonc`) is the single harness-spanning configuration surface owned by [`@oh-my-opencode/omo-config-core`](../../packages/omo-config-core/AGENTS.md). It is the only config file read by the OpenCode plugin, by the Senpi adapter (task, config-watch), and by Codex. The legacy OpenCode-family files (`oh-my-openagent.json[c]` / `oh-my-opencode.json[c]`) and `~/.omo/config.jsonc` are read by nothing but the migration engine (see [Migration from legacy files](#migration-from-legacy-files)).

Files may be JSONC: `//` comments and trailing commas are allowed. Strict typed blocks reject malformed values and report a diagnostic rather than silently accepting them; unknown keys are ignored with an `unknown-keys` diagnostic (see [Safety and failure handling](#file-locations-and-precedence)) so a retired or mistyped key never costs you the rest of the layer. The `[opencode]` block is intentionally a freeform record so it can carry the full plugin configuration.

## File locations and precedence

The loader resolves layers in `resolveOmoConfigPaths` and folds them lowest-to-highest, so the **last** layer merged wins (`packages/omo-config-core/src/loader/paths.ts`, `loader.ts`).

1. **User layer (lowest precedence).** `omo.jsonc`, falling back to `omo.json`, under `~/.omo` on every platform. This is the same root that already holds omo runtime state (`teams/`, `rules/`, `plans/`, `lsp-daemon/`), so there is one user-scope omo directory and one only.
2. **Project layers.** `.omo/omo.jsonc` (then `.omo/omo.json`) in every directory from the current working directory up to `$HOME`. Farther ancestors are merged first; the **nearest** project file has the highest precedence and beats the user layer. `$HOME` itself is skipped by this walk, because `~/.omo` is already the user layer and must not be counted twice.

Merge rules (`loader/merge.ts`):

- Plain objects deep-merge recursively.
- Scalars and arrays replace the lower layer wholesale.
- `__proto__`, `prototype`, and `constructor` keys are stripped from both merge keys and nested values (prototype-pollution guard).

Safety and failure handling:

- A symlinked project `.omo` directory or a symlinked project config file is skipped as a load source (`loader/paths.ts`).
- A missing, unreadable, or invalid layer becomes an entry in the result's `diagnostics` and is skipped; loading continues.
- Unrecognized keys anywhere in a layer are ignored and reported through an `unknown-keys` diagnostic that names each dotted key path (for example `profiles.opus.retired_key`), while malformed values still reject that layer.
- If the merged config fails final validation, the loader returns the all-default config plus one `validation` diagnostic instead of throwing (`loader/loader.ts`).

## `$schema`

The root schema accepts an optional `$schema` string key (`packages/omo-config-core/src/schema/config.ts`, on both `OmoConfigSchema` and `OmoConfigLayerSchema`); both the per-layer parse (`OmoConfigLayerSchema.safeParse`) and the final merged parse (`OmoConfigSchema.safeParse` in `packages/omo-config-core/src/loader/loader.ts`) carry it through and otherwise ignore it, so an editor pointer is safe to add.

A generated JSON schema artifact ships at `assets/omo.schema.json`, produced from `OmoConfigSchema` by the root `build:omo-schema` script (`script/build-omo-schema.ts`, `script/build-omo-schema-document.ts`); run `bun run build:omo-schema` to regenerate it. Point your editor at the raw dev-branch URL:

```
https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json
```

## Resolution order

After the file layers merge, each harness resolves its own view out of the merged document (`packages/omo-config-core/src/loader/resolution.ts`). Later layers win:

1. **Shared base keys** (every top-level key except `profiles` and the bracketed harness blocks).
2. **The `[harness]` block** for the current harness: `[opencode]`, `[senpi]`, or `[codex]`.
3. **`profiles.<name>`** for the active profile.
4. **`profiles.<name>.[harness]`** for the active profile.

Schema defaults apply once at the very end, after all four layers fold. Control keys (`profiles`, `[opencode]`, `[senpi]`, `[codex]`) never leak into the resolved view. Activating a profile that does not exist yields a `profile` diagnostic and the base configuration.

### Profile activation

The active profile name comes from (`resolveOmoProfileName`), highest priority first:

1. `OMO_PROFILE`
2. `OCX_PROFILE` (set by `ocx oc -p <name>`)
3. An `OPENCODE_CONFIG_DIR` whose lexical tail is `profiles/<name>`
4. None (no profile layer applied)

No default profiles ship. A profile exists only when you write one under `profiles.<name>` or the migration derives one from a legacy OpenCode profile directory.

### Example

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",
  "categories": {
    "deep": {
      "description": "Deep analysis",
      "model": "anthropic/claude",
      "reasoning": "high"
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
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json", // optional editor pointer
  "categories": {},     // record<string, CategoryConfig>
  "agents": {},         // record<string, AgentDef>
  "task": {},           // task engine settings
  "teams": {},          // record<string, TeamSpec>
  "models": {},         // record<string, ModelCatalogEntry>, shared model catalog
  "memory": {},         // MemorySettings, Senpi memory subsystem
  "git_master": { "commit_footer": true, "include_co_authored_by": true }, // commit attribution (Senpi harness)
  "telemetry": { "enabled": true }, // Senpi telemetry, enabled by default
  "[opencode]": {},     // OpenCode plugin config, freeform (see configuration.md)
  "[senpi]": {},        // Senpi-only overrides, typed base keys
  "[codex]": {},        // Codex-only overrides, typed base keys
  "profiles": {},       // record<string, Profile>, opt-in named profiles
  "_migrations": [],    // applied migration ids, written by the migration engine
  "legacy_migrations": {} // imported legacy migration history, engine-managed
}
```

Source: `packages/omo-config-core/src/schema/config.ts`.

### Harness blocks

`[opencode]` is a freeform record: it carries the full OpenCode plugin configuration documented in [`docs/reference/configuration.md`](./configuration.md) (background tasks, tmux, hooks, skills, and every other plugin key), and the strict schema does not validate its contents. `[senpi]` and `[codex]` are typed blocks accepting the shared base keys (`categories`, `agents`, `git_master`, `task`, `teams`, `models`, `memory`, `telemetry`), so a harness-specific override stays schema-checked.

Security invariant: the OpenCode plugin honors `mcp_env_allowlist` and `browser_automation_engine.playwright_mcp_args` only from the user layer, including the user layer's own active profile block. Project layers cannot extend them.

### `telemetry` (Senpi harness)

The optional `telemetry` block controls OmO Native product telemetry in Senpi. `telemetry.enabled` is a boolean and defaults to `true`, so telemetry ships enabled. Set it to `false` to turn telemetry off. This setting applies only to Senpi.

```jsonc
{
  "[senpi]": {
    "telemetry": {
      "enabled": false
    }
  }
}
```

The block may also appear at the shared top level or in profile layers and follows the normal resolution order. Because typed config objects are strict, an older `@oh-my-opencode/omo-config-core` version that predates this key rejects a file containing `telemetry` instead of ignoring it. See [Mixed-version compatibility](#mixed-version-compatibility) before sharing one config across versions.

### `memory` (Senpi harness)

The optional `memory` block configures the Senpi memory subsystem (`schema/memory.ts` `OmoMemorySettingsSchema`). Keys: `enabled` (default `true`), `agent` (default `"auto"`), `tool_exposure` (`"direct"` or `"search"`, default `"direct"`), the sub-blocks `reflection`, `nudge`, `facts`, `dream`, `people`, `soul`, `write_notice`, `sync`, `search`, plus `compile_warn_tokens` and per-agent overrides under `agents`.

### `git_master` (Senpi harness)

The optional `git_master` block controls commit attribution in Senpi (`schema/git-master.ts`). When the agent works with the `git-master` skill — reading it in the main session or loading it into a task child via `load_skills` — omo appends a commit-attribution directive to the skill content based on these settings.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `commit_footer` | boolean \| string | `true` | Adds the "Ultraworked with [omo](https://github.com/code-yeongyu/oh-my-openagent)" footer to commit messages. A string replaces the builtin footer text; `false` disables the footer. |
| `include_co_authored_by` | boolean | `true` | Adds the `Co-authored-by: sisyphus-dev-ai <sisyphus-dev-ai@users.noreply.github.com>` trailer ([sisyphus-dev-ai](https://github.com/sisyphus-dev-ai)) to commit messages. |

Both attributions ship enabled by default. To opt out of the co-author trailer:

```jsonc
{
  "git_master": {
    "include_co_authored_by": false
  }
}
```

The block may live at the shared top level, in `[senpi]`, or in profile layers, and follows the normal resolution order. The OpenCode plugin keeps its own `git_master` key inside the freeform `[opencode]` block (see [configuration.md](./configuration.md)); this typed section applies to the Senpi harness.

### `models` (shared catalog)

A record of short name to catalog entry (`schema/model-catalog.ts`). The canonical strict shape is `{ model, reasoning? }`. Deprecated `variant` and `reasoningEffort` inputs remain accepted and are normalized to `reasoning`; other tuning fields are not catalog-entry keys.

```jsonc
{
  "models": {
    "opus": { "model": "anthropic/claude-opus-5", "reasoning": "max" },
    "fast": { "model": "anthropic/claude-haiku-4-5" }
  },
  "categories": {
    "deep": { "model": "opus" },              // resolves to anthropic/claude-opus-5 at reasoning max
    "quick": { "model": "fast", "reasoning": "high" } // site tuning wins over the entry
  }
}
```

When an agent or category `model` string matches a catalog key, resolution (`models/model-reference-resolution.ts`) swaps in the entry's model id and fills any unset `reasoning` from the entry. Tuning written at the use site always wins. A `[harness]` block (or a profile) can override individual catalog entries for its own view. Catalog cycles are detected and reported as `model_catalog_cycle` diagnostics instead of looping.

### `agents`

A record of agent name to definition (`schema/agent.ts`).

| Field | Type | Notes |
|-------|------|-------|
| `description` | string | |
| `prompt` | string | |
| `model` | string | Sugar for a single-entry `models` list. |
| `models` | model entries | Ordered chain; each entry is a bare string or `{ model, reasoning?, temperature?, top_p?, max_tokens?, provider_options? }`. |
| `reasoning` | `off \| minimal \| low \| medium \| high \| xhigh \| max \| auto` \| string | Canonical reasoning field. |
| `tools` | record<string, boolean> | |
| `execution_mode` | `in-process \| process` | overrides `task.default_execution_mode`; curated builtin agents remain in-process |
| `background` | boolean | |
| `max_depth` | int >= 0 | |
| `allowed_subagents` | string[] | |
| `disallowed_tools` | string[] | |
| `max_turns` | int >= 0 | |
| `temperature` | number 0..2 | |
| `disable` | boolean | |

Deprecated keys accepted for back-compat and rewritten by migration:

| Old key | Replacement | Notes |
|---------|-------------|-------|
| `variant` | `reasoning` | Reasoning level or harness-native preset token. |
| `reasoningEffort` | `reasoning` | `none` normalizes to `off`. |

These are the only deprecated keys the strict agent schema accepts. `textVerbosity`, `fallback_models`, `thinking`, and `maxTokens` are category / model-entry keys, not agent keys (see [Model references and model strings](#model-references-and-model-strings)).

#### Builtin agents

The Senpi task engine ships four builtin curated agents: `explore` and `librarian` are always spawnable through the task tool with zero configuration, for example `task(subagent_type: "explore", ...)`, while `metis` and `momus` are plan-gated: spawnable only after the user requests the `ulw-plan` workflow, a `.omo/plans/*.md` artifact was touched, and `ulw-execute` was never invoked. They are read-only research and review specialists; implementation and orchestration agents stay category-routed. (`oracle` is an OpenCode plugin agent, not a Senpi builtin.)

| Name | Purpose |
|------|---------|
| `explore` | Codebase search specialist. Answers "Where is X?", "Which file has Y?", "Find the code that does Z". Supports thoroughness levels from quick to very thorough. |
| `librarian` | Remote codebase and documentation research: searches open-source repositories, retrieves official documentation, and finds implementation examples via the GitHub CLI and direct documentation retrieval. |
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
    "momus": { "disable": true }
  }
}
```

Overriding `execution_mode` on a curated agent is ignored. All other configured fields retain normal field-level overlay behavior, but curated agents remain in-process because the process runner cannot carry their persona instructions or tool policy. User-defined agents keep the configured execution mode.

Curated agents and teams. A team member spec naming a curated read-only agent (`kind: "subagent_type"`) is rejected at member validation with this error:

```
curated read-only agent "momus" cannot be a team member; delegate via the task tool instead
```

Team members always spawn in `process` mode, which cannot carry the curated persona or tool policy, so delegate to these agents through the task tool instead of naming them as team members.

### `task`

Task engine settings. The whole object is optional, but `provider_concurrency`, `model_concurrency`, `state_dir`, and `reattach_on_reconcile` are optional and remain unset when omitted (`schema/task.ts`).

| Field | Type | Default |
|-------|------|---------|
| `default_execution_mode` | `in-process \| process` | `in-process` |
| `default_concurrency` | non-negative int (0 = unlimited) | `5` |
| `provider_concurrency` | record<string, non-negative int (0 = unlimited)> | unset |
| `model_concurrency` | record<string, non-negative int (0 = unlimited)> | unset |
| `global_concurrency` | non-negative int (0 = unlimited) | effective default `max(8, availableParallelism() * 2)` |
| `max_depth` | int >= 0 | `1` |
| `residency_max_children` | non-negative int or `"unlimited"` (0 = unlimited) | effective default `max(8, availableParallelism() * 3)` |
| `ttl_ms` | positive int | `86400000` (24h) |
| `state_dir` | string | unset (runtime uses `<project>/.omo/senpi-task`) |
| `reattach_on_reconcile` | boolean | unset |
| `resume_children` | boolean | `true` |
| `warnings.unavailable_categories` | boolean | `true` |
| `wait.min_ms` | positive int | `5000` |
| `wait.default_ms` | positive int | `60000` |
| `wait.max_ms` | positive int | `600000` |
| `team.max_members` | int 1..8 | `8` |
| `team.max_parallel_members` | int 1..8 | `4` |
| `team.max_wall_clock_minutes` | positive int | `120` |
| `dag` | object | unset |

`task.dag` is an optional block bounding the DAG orchestration subsystem (`schema/task.ts`): `max_nodes_per_run` (`64`), `max_runs_per_session` (`16`), `subscriber_ring` (`1000`), `heartbeat_ms` (`15000`), `history_default_limit` (`256`), `history_max_limit` (`1000`), `retention_days` (`7`), `max_prompt_bytes` (`262144`).

`global_concurrency` caps how many tasks run at once per senpi process, across all model and provider lanes combined. It applies only to senpi; OpenCode `background_task` is unaffected (parity is a follow-up). The cap is per process, not cross-process or machine-wide: two senpi processes each get their own budget. A task spills to a later entry in its fallback chain whenever admission cannot seat it in the preferred model's lane — the per-model/provider/default lane limit is reached or its queue is occupied (the common case), or this global cap is full — even though the preferred model never failed. That later entry can be a DIFFERENT provider, with different pricing and different data handling. If that matters to you, remove cross-provider entries from your fallback chains or use single-model chains. No new storage or telemetry is introduced by this setting.

`state_dir` defaults to `<project_dir>/.omo/senpi-task` when unset (`packages/senpi-task/src/store/state-dir.ts`). Completion delivery is not configurable: every child completion is batched with any other ready notifications and steered into the parent's running turn at the next tool-call boundary; see the completion routing table in [`packages/senpi-task/AGENTS.md`](../../packages/senpi-task/AGENTS.md).

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

### `profiles`

A record of profile name to a partial view (`schema/config.ts` `OmoConfigProfileSchema`). Each profile accepts the shared base keys (`categories`, `agents`, `task`, `teams`, `models`, `memory`, `telemetry`) plus `[opencode]`, `[senpi]`, and `[codex]` blocks of its own:

```jsonc
{
  "profiles": {
    "kimi": {
      "categories": {
        "deep": { "model": "kimi-for-coding/kimi-k3" }
      },
      "[opencode]": {
        "agents": {
          "sisyphus": { "model": "kimi-for-coding/kimi-k3" }
        }
      }
    }
  }
}
```

Profiles are inert until activated (see [Profile activation](#profile-activation)). When active, the profile's base keys fold over the shared base, and the profile's harness block folds over the top-level harness block.

### Model references and model strings

`model` accepts either a catalog alias or a provider-prefixed string. Reasoning levels can be written inline with a `:level` suffix, for example `openai/gpt-5.6-sol:xhigh`. The suffix is canonical; the older `model(xhigh)` and `model xhigh` forms remain accepted during the back-compat window and are normalized by migration.

`models` is the shared ordered chain shape used by categories, agents, and harness blocks. Each entry may be a string or a model object. Object entries use the canonical fields documented above, including `reasoning` and `provider_options`.

Deprecated chain keys are still accepted for now, but they map to `models` and the canonical `reasoning` field:

| Old key | Replacement |
|---------|-------------|
| `fallback_models` | `models` |
| `variant` | `reasoning` |
| `reasoningEffort` | `reasoning` |
| `thinking` | `reasoning` + `provider_options` |
| `textVerbosity` | `provider_options.textVerbosity` |
| `maxTokens` | `max_tokens` |

The migration engine rewrites the persisted config in place, and doctor reports any leftover deprecated keys with their exact file and key path.

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
      "models": [
        { "model": "anthropic/claude-opus-5", "reasoning": "high" },
        "anthropic/claude-sonnet-4-5"
      ]
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

## Migration from legacy files

Before the unification, the OpenCode plugin read a walked `oh-my-openagent.json[c]` / `oh-my-opencode.json[c]` chain and the Codex/Senpi harnesses read `~/.omo/config.jsonc`. Those files are history: a lock-and-journal migration engine imports them into `omo.jsonc` once, and nothing reads them at runtime afterward.

- The legacy OpenCode user file imports into `~/.omo/omo.jsonc` under `[opencode]`; each legacy `profiles/<name>/` directory becomes `profiles.<name>."[opencode]"` holding only the keys that differ from the user file; project `.opencode/` files import into that project's `.omo/omo.jsonc`.
- `~/.omo/config.jsonc` imports its `[opencode]` / `[codex]` blocks; a legacy `[omo]` block maps to `[senpi]`.
- No-clobber: a value already present in the target wins, and skipped legacy values surface as diagnostics. Legacy migration history is preserved under `legacy_migrations`, and applied migrations are marked in the target's `_migrations` array (`2026-07-opencode-config-unification` for the `oh-my-*` files, `2026-07-codex-config-jsonc` for `~/.omo/config.jsonc`, and `2026-08-reasoning-unification` for persisted model and reasoning fields).
- Sources move to `~/.omo/migration-backup-<UTC timestamp>-opencode-config/` (project sources to `<project>/.omo/migration-backup-<UTC timestamp>/`).
- Triggers: OpenCode plugin startup, Senpi startup, and install run both migration groups; Codex startup runs only the `config.jsonc` group; `oh-my-openagent config migrate` runs both on demand (`--dry-run`, `--json`).

Full user-facing detail: [`docs/reference/configuration.md`](./configuration.md#migration).

## Mixed-version compatibility

The unified file is read starting with oh-my-openagent 5.0.0 (current `5.0.0-beta.13`): the OpenCode plugin, the Senpi adapter, and the Codex plugin at 5.0.0 or later all load `~/.omo/omo.jsonc` plus walked project `.omo/omo.jsonc` and nothing else. Harnesses from 4.x still read the legacy files, which the migration has moved into the backup directory.

One sharp edge when mixing versions: every schema object is `.strict()`. A pre-unification copy of `@oh-my-opencode/omo-config-core` rejects an `omo.jsonc` that contains keys it does not know, which includes `models`, `profiles`, and the `[opencode]` / `[senpi]` / `[codex]` harness blocks. An older strict core handed a newer unified file fails validation on those keys instead of ignoring them.

To downgrade:

1. Quit every running harness so no migration or config write is in flight.
2. Restore the legacy files from the newest `~/.omo/migration-backup-<UTC timestamp>-opencode-config/` directory (and `<project>/.omo/migration-backup-<UTC timestamp>/` for project files): each backup holds the legacy sources at their original relative paths, so copy them back to where the backup tree mirrors them.
3. Remove or rename `~/.omo/omo.jsonc` if the older harness must not see it, then install the older version.

To re-upgrade later, delete the restored legacy files or let the migration re-import them; existing values in `omo.jsonc` still win under the no-clobber policy.

## Follow-ups

- `member.backendType: "tmux"` and non-project (user-global) team storage are schema-level only and are not exercised by the current Senpi runtime; use `in-process` members in project `.omo/` teams.
