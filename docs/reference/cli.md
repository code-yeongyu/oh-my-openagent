# CLI Reference

Complete reference for the published CLI package. During the rename transition, both package names work:

- `oh-my-openagent` (preferred package name)
- `oh-my-opencode` (compatibility package name)

Plugin registration inside `opencode.json` prefers `oh-my-openagent`.

## Bin Commands

All published packages expose the same compiled CLI with these bin entries:

- `omo-agent-toolkit` (short name, recommended in docs and prompts)
- `oh-my-openagent` (preferred package-matching name)
- `oh-my-opencode` (legacy compatibility name)
- `lazycodex` (Light edition shortcut; install defaults to `--platform=codex`)
- `lazycodex-ai` (Light edition shortcut; install defaults to `--platform=codex`)

The former `omo` bin was removed from these packages in this major release. The name now belongs to the OmO Native edition:

| Bin | Package | Channel | What it is |
| --- | --- | --- | --- |
| `omo` | `omo-ai` | bun (recommended): `bun add -g omo-ai`; npm fallback: `npm i -g omo-ai` | Launches the pinned senpi release with the full OMO extension loaded. Prerelease builds live on `omo-ai@beta`; see the [omo-ai publishing runbook](./omo-ai-publishing.md). |

The `omo-agent-toolkit` npm bin stays with the wrapper packages above; `omo-ai` never declares it.

### `omo account` (OmO Native)

`omo account show [--account <id>]`, `adopt [--replace]`, `token`, `export`, and
`forget` share the OS-keychain sign-in used by `omo login`. This machine interface
accepts credentials on stdin for `adopt` and writes JSON replies on stdout;
diagnostics go to stderr.

| Exit | Outcome |
| --- | --- |
| 0 | Success |
| 1 | Other operation failure |
| 2 | Invalid arguments or credential input |
| 3 | Adopting a different device requires `--replace` |
| 4 | Signed out |
| 5 | Session ended; the JSON reply includes the refusal code |
| 6 | Refresh outcome uncertain; retained credentials must not be replayed |
| 7 | Keychain locked: `{"keychain":"locked"}` |
| 8 | Keychain unavailable: `{"keychain":"unavailable"}` |
| 9 | Native storage failure or timeout: `{"error":"store-unavailable"}` |

After a storage failure, the command reports that failure without another store
read. Native operations are still awaited: there is no additional command
deadline or forced process termination. A native timeout can therefore still
take approximately 25 seconds, but the error handler does not repeat that wait.

## Basic Usage

```bash
# Display help (preferred package)
bunx oh-my-openagent

# Compatibility package
bunx oh-my-opencode
```

## Commands

| Command | Description |
| --- | --- |
| `install` / `setup` | Interactive setup wizard |
| `uninstall` / `cleanup` | Remove managed Codex Light state |
| `doctor` | Installation health diagnostics |
| `run <message>` | Non-interactive OpenCode session runner with completion enforcement |
| `get-local-version` | Show current installed version and check for updates |
| `refresh-model-capabilities` | Refresh cached model capabilities snapshot from models.dev |
| `config edit` | Interactive unified configuration editor; select a file and shared/harness/profile view, edit models and settings, then save with a backup |
| `config migrate` | Migrate legacy OMO configuration into the unified config at `~/.omo/omo.jsonc` (`--dry-run` prints the transform/backup plan without writing, `--json` emits a machine-readable report) |
| `worktree-sweep` | Report (and optionally remove) stale linked git worktrees: SWEEP when merged into the default branch and clean, KEEP when locked/external/unmerged/dirty or when it is the worktree the sweep was started from, PRUNE when the path is gone. Dry-run by default; `--apply` removes with `git worktree remove` (never forced) and prunes; `--older-than <days>` adds an age fallback, `--repo <path>` is repeatable, `--json` emits machine-readable output |
| `ulw-loop [args...]` | Pass arguments through to the Codex LazyCodex ulw-loop CLI |
| `update` | `lazycodex` / `lazycodex-ai` bins only: refresh the installed Codex Light edition in place (`--dry-run`, `--repo-root <path>`) |
| `boulder` | Inspect boulder work-state (active plan, current-task timing, session count); supports `-d/--directory`, `-w/--work-id`, and `--json` |
| `version` | Show CLI version |
| `mcp oauth` | OAuth token management for MCP servers |

---

## Interactive configuration editor

Run `omo-agent-toolkit config edit` in an interactive terminal. Use `--directory /path/to/project` to discover that project's user and ancestor configuration layers, or `--file /path/to/omo.jsonc` to select a file explicitly. New files are created only when you save changes. `config migrate` remains a separate command; opening the editor does not migrate legacy files.

Choose a shared, OpenCode, OmO Native, or Codex view, or a view inside an existing named profile. The editor changes only that file and view; values from other layers or an active profile can still take precedence. The menus show declared overrides, rather than claiming a cached model is available or showing the final runtime resolution. Navigate with the arrow keys and Enter; each nested menu has an explicit Back option. New entries are added only after their first field is accepted. Selecting Keep or appending an existing model leaves the configuration unchanged.

- **Agents:** edit the ordered model chain, permissions, descriptions and schema fields. In the OpenCode view, assign a category or set the default run agent.
- **Categories:** edit models, fallbacks, descriptions and schema fields, including custom categories.
- **Model picker:** enter `provider/model` directly or search cached models by provider. Model chains keep per-model metadata when reordered; removing one model retains the rest. Bulk assignment changes selected entries' primary models and keeps their secondary fallbacks.
- **Profiles in this file:** list, create an empty profile, copy a declaration, edit it, or stage deletion after confirmation. Creation and copying open the new profile's shared view; **Change configuration view** also offers its harness views. Empty profiles inherit shared/harness settings. Copying retains only the selected file's declared values, including model metadata, without flattening defaults or other files. Deleting the current profile returns to Shared. Other layers may still declare a deleted name.
- **Other configuration fields:** select a field and enter a JSON value (`"text"`, `true`, an array, or an object), or remove the override to inherit defaults. Nested settings such as detailed command permissions can be edited as JSON objects. New field values are checked against the current schema.

Changes stay in memory until **Save changes and exit**. Cancelling prompts with unsaved changes offers **Keep editing** or **Discard changes and exit**. Saving preserves unrelated JSONC comments and data, creates a backup, keeps the original file permissions, and refuses to overwrite a file changed by another process. A save error keeps the staged edits available for retry or discard.

The editor's internal Node/TypeScript backend is available separately at `packages/omo-opencode/src/cli/config-editor/backend.ts`. It exposes file discovery, session reads, nonmutating structured value validation, staged edits/transactions, named-profile listing/creation/copy/deletion, dirty-state inspection, and safe save without importing terminal prompts. The CLI uses that same validation and persistence API, allowing a future server-side WebUI adapter to reuse it; this change adds no HTTP API or WebUI. A server adapter must authenticate requests and restrict clients to server-owned source identifiers mapped to an allowed set of discovered files, rather than accepting arbitrary filesystem paths such as the trusted local CLI's `--file` option. Sessions must remain server-owned; never deserialize a client-supplied mutable `EditorSession` as trusted state. A future HTTP adapter must also redact sensitive configuration values and error details before sending them to clients or logs. File revision checks remain optimistic and do not provide a cross-process lock. A successful safe save and selected-field schema check do not prove that a runtime consumes the selected scope, accepts the resulting configuration, can access the chosen model, or has reloaded it.

**Custom model presets:** create a profile named `budget`, assign models to its agents/categories, then copy it to `balanced` and adjust its model chains. These names are user choices, with no special runtime meaning. This editor does not ship built-in cost presets, estimate spend, verify provider access or guarantee that one model is cheaper; review your provider's current prices and fallback chains. Shared settings and declarations in other files still apply. Selecting an editor view edits declarations; it does not activate a profile or reconfigure a running session. To select a saved profile for a new process, use the existing `OMO_PROFILE=budget` selector (for example, `OMO_PROFILE=budget opencode`). This is distinct from OmO Native's separate `model_profiles` / `model_profile` feature.

The terminal editor does not provide a graphical configuration/source visualization or merged runtime resolution. Profile lists are scoped to the selected file and include staged changes. Copying a malformed or unknown-field profile may fail schema validation; the original declaration and staged state remain intact. Creating, copying and deleting all use the existing staged save/discard workflow and backup/concurrent-change checks.

The interactive workflow continues WietRob's original [TUI configuration editor proposal (#1529)](https://github.com/code-yeongyu/oh-my-openagent/pull/1529), adapted to the current unified `omo.jsonc` configuration and CLI.

## install

Interactive installation tool for initial setup.

### Usage

```bash
bunx oh-my-openagent install
```

### Options

| Option | Description |
| --- | --- |
| `--no-tui` | Run in non-interactive mode (requires all needed options) |
| `--platform <value>` | Install target edition: `opencode` (Ultimate, default), `codex` (Light), or `both` |
| `--claude <value>` | Claude subscription: `no`, `yes`, `max20` (Ultimate only) |
| `--openai <value>` | OpenAI/ChatGPT subscription: `no`, `yes` (Ultimate only) |
| `--gemini <value>` | Gemini integration: `no`, `yes` (Ultimate only) |
| `--copilot <value>` | GitHub Copilot subscription: `no`, `yes` (Ultimate only) |
| `--opencode-zen <value>` | OpenCode Zen access: `no`, `yes` (Ultimate only) |
| `--zai-coding-plan <value>` | Z.ai Coding Plan subscription: `no`, `yes` (Ultimate only) |
| `--kimi-for-coding <value>` | Kimi For Coding subscription: `no`, `yes` (Ultimate only) |
| `--opencode-go <value>` | OpenCode Go subscription: `no`, `yes` (Ultimate only) |
| `--bailian-coding-plan <value>` | Bailian Coding Plan subscription: `no`, `yes` (Ultimate only) |
| `--minimax-cn-coding-plan <value>` | MiniMax Coding Plan through minimaxi.com: `no`, `yes` (Ultimate only) |
| `--minimax-coding-plan <value>` | MiniMax Coding Plan through minimax.io: `no`, `yes` (Ultimate only) |
| `--vercel-ai-gateway <value>` | Vercel AI Gateway: `no`, `yes` (Ultimate only) |
| `--codex-autonomous` | Default for Light/Both installs: writes `approval_policy = "never"` and `sandbox_mode = "danger-full-access"` (and removes a legacy top-level `network_access` key) unless `--no-codex-autonomous` is passed; passing this flag explicitly is redundant |
| `--no-codex-autonomous` | Leave existing Codex permission settings unchanged when installing Light or Both |
| `--skip-auth` | Skip authentication setup hints |

When using either the `lazycodex` or `lazycodex-ai` bin alias, `install` defaults to `--platform=codex`. These are npm bin aliases. The separate LazyCodex repository identity does not change the Codex config, which uses marketplace `sisyphuslabs` and plugin `omo`, enabled as `omo@sisyphuslabs`, with the marketplace source set to the local built cache under `~/.codex/plugins/cache/sisyphuslabs`.

Subscription flags (`--claude`, `--openai`, etc.) only apply when `--platform` is `opencode` or `both`. They are rejected under `--platform=codex` because the Light edition does not write OpenCode model config. `--codex-autonomous` and `--no-codex-autonomous` only affect installs where the selected platform includes Codex.

### Telemetry and opt-out

Anonymous telemetry uses PostHog with a SHA-256 hash of a random install id created on the computer. Two streams exist:

- `omo_daily_active`: fired by the main plugin when it loads (`reason: "plugin_loaded"`) and by `oh-my-openagent run` (`reason: "run_started"`).
- `omo_codex_daily_active`: fired by `omo-agent-toolkit install --platform=codex` or `--platform=both` (`reason: "install_completed"`) and by the Codex plugin's `SessionStart` hook on every Codex session (`reason: "session_start"`). Both sources share the same UTC-day deduplication, so daily/weekly/monthly active counts reflect real Codex usage, not just install events.

Opt-out env vars:

- Global opt-out for oh-my-openagent and omo-codex: `OMO_SEND_ANONYMOUS_TELEMETRY=0` or `OMO_DISABLE_POSTHOG=1`
- Codex-only opt-out for `omo_codex_daily_active`: `OMO_CODEX_SEND_ANONYMOUS_TELEMETRY=0` or `OMO_CODEX_DISABLE_POSTHOG=1`

The OpenCode plugin can also opt out through oh-my-openagent config with `"telemetry": false`.

For the full Codex Light event inventory, collected properties, local state path, and lazycodex marketplace copy path, see [Codex Light telemetry](./codex-telemetry.md).

---

## uninstall / cleanup

Removes managed Codex Light state. `cleanup` is the underlying command name; `uninstall` is the user-facing alias. Both invoke the same Codex Light cleanup.

### Usage

```bash
npx lazycodex-ai uninstall
omo-agent-toolkit uninstall --platform=codex
```

### Options

| Option | Description |
| --- | --- |
| `--platform codex` | Required when using the shared `omo-agent-toolkit` CLI unless `OMO_INVOCATION_NAME` is `lazycodex` or `lazycodex-ai` |
| `--codex-home <path>` | Codex home to clean, defaulting to `CODEX_HOME` or `~/.codex` |
| `--project <path>` | Project directory to inspect for project-local legacy Codex artifacts |
| `--json` | Output structured JSON result |

The command removes the managed plugin cache and marketplace snapshot, strips managed marketplace, plugin, hook-state, and agent blocks for `sisyphuslabs` and the legacy `lazycodex` / `code-yeongyu-codex-plugins` marketplaces from `~/.codex/config.toml` after writing a backup, and removes managed agent TOML files from `~/.codex/agents/` (including orphaned files whose install manifest is already gone), managed bins, and managed runtime trees. Project-owned `.codex` artifacts are reported, not deleted.

---

## doctor

Diagnoses your environment and configuration. OpenCode checks are grouped as **System**, **Configuration**, **TUI Plugin**, **Deprecated Reasoning Keys**, **Tools**, **Models**, **Telemetry**, and **Team Mode**. The Codex target runs a separate set of Codex checks.

### Usage

```bash
bunx oh-my-openagent doctor
```

### Options

| Option | Description |
| --- | --- |
| `--status` | Show compact system dashboard |
| `--verbose` | Show detailed diagnostic information |
| `--json` | Output results in JSON format |
| `--platform <opencode|codex>` | Select the doctor target platform |

### Notes

- The current minimum OpenCode version check is `>= 1.4.0`.
- The doctor command warns when legacy plugin registration (`oh-my-opencode`) is still present in `opencode.json`.
- OmO Native's `doctor` subcommand also reports computer use (experimental) without opening a desktop session or requesting OS permissions. It prints:
  - whether the effective Native config enables computer use and whether the host is supported;
  - the selected engine path and its version, protocol, and ABI, or the engine-location diagnostic and every path tried;
  - the backend plus capture, input, and accessibility permission state;
  - display count and screen-lock state;
  - the stop path, reported as not armed until computer use starts input, because the engine arms the stop chord only then.
  The probe sends only the read-only `engine.hello` and `capabilities` requests and is bounded by the doctor's timeout.
- `omo doctor --models [--json]` (OmO Native) prints every task category and agent as a spawn resolves it right now: the model it runs first, the runtime retry chain in order, and every declared rung with its source (`built-in`, `omo.json`, `category:<name>`) and state (`runs first`, `fallback N`, `excluded by exclude_models`, `no login`, `not reached`), then the main session's `model_profile` lane. It uses the spawn resolvers and the engine's offline model list (credentials are not probed). It exits 1 when the resolver runtime cannot load and 2 on an option other than `--json`. See [`exclude_models`](./omo-json.md#exclude_models-native-harness) to keep a model out of every chain.

---

## run

Runs a non-interactive session and exits only when all of these conditions are true:

- the main session is idle
- all todos are completed or cancelled
- all descendant sessions are idle
- no continuation hooks (boulder, ralph-loop, or todo-hook markers) are active

### Usage

```bash
bunx oh-my-openagent run <message>
```

### Options

| Option | Description |
| --- | --- |
| `-a, --agent <name>` | Agent to use (default resolution chain applies) |
| `-m, --model <provider/model>` | Model override (example: `anthropic/claude-sonnet-4`) |
| `-d, --directory <path>` | Working directory |
| `-p, --port <port>` | Server port (attaches if already in use) |
| `--attach <url>` | Attach to an existing OpenCode server URL |
| `--on-complete <command>` | Run shell command after completion |
| `--json` | Output structured JSON result |
| `--no-timestamp` | Disable timestamp prefix in output |
| `--verbose` | Show full event stream (default: messages/tools only) |
| `--session-id <id>` | Resume an existing session |

### Agent Resolution Order

1. `--agent`
2. `OPENCODE_DEFAULT_AGENT`
3. `default_run_agent` in plugin config

`--agent` accepts config keys (`sisyphus`, `prometheus`) and remapped display names (`Sisyphus - ultraworker`). Builtin categories (`quick`, `deep`, `ultrabrain`, `unspecified-high`, and the others used by `task(category=...)`) are not CLI agents; `oh-my-openagent run --agent quick` errors with the runnable names.

`opencode run --agent` does exact-key lookup in the host. Prefer `oh-my-openagent run --agent`, or pass the remapped display name. Unknown host `--agent` values should fail closed (see the OpenCode CLI).

---

## get-local-version

Shows local plugin version state and update status.

### Usage

```bash
bunx oh-my-openagent get-local-version
```

### Options

| Option | Description |
| --- | --- |
| `-d, --directory <path>` | Working directory used for plugin/config detection |
| `--json` | Output JSON for scripting |

---

## refresh-model-capabilities

Refreshes the cached model capabilities snapshot from models.dev.

### Usage

```bash
bunx oh-my-openagent refresh-model-capabilities
```

### Options

| Option | Description |
| --- | --- |
| `-d, --directory <path>` | Working directory used to read plugin config |
| `--source-url <url>` | Override models.dev source URL |
| `--json` | Output refresh summary as JSON |

### Configuration

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

---

## version

Shows CLI package version.

### Usage

```bash
bunx oh-my-openagent version
```

---

## mcp oauth

OAuth token management for MCP servers (Tier-3 MCP OAuth flow, including PKCE and dynamic client registration when supported by the server).

### Usage

```bash
# Authenticate
bunx oh-my-openagent mcp oauth login <server-name> --server-url https://api.example.com

# Authenticate with explicit client ID and scopes
bunx oh-my-openagent mcp oauth login <server-name> --server-url https://api.example.com --client-id my-client --scopes read write

# Remove stored tokens
bunx oh-my-openagent mcp oauth logout <server-name> --server-url https://api.example.com

# Show token status
bunx oh-my-openagent mcp oauth status [server-name]
```

### Options

| Option | Description |
| --- | --- |
| `--server-url <url>` | OAuth server URL (required by `login`, and required by `logout`) |
| `--client-id <id>` | OAuth client ID (optional if server supports DCR) |
| `--scopes <scopes...>` | OAuth scopes as variadic values |

---

## Exit Codes

- `0` on success
- `1` on failure
- `2` when the boulder state file exists but can't be read
- `130` when `run` is aborted

`run`, `install`, `uninstall`/`cleanup`, `doctor`, `get-local-version`, `refresh-model-capabilities`, `config migrate`, `config edit`, `boulder`, `ulw-loop`, and `mcp oauth` subcommands return explicit numeric exit codes.
