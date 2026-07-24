# CLI Reference

Complete reference for the published CLI package. During the rename transition, both package names work:

- `oh-my-openagent` (preferred package name)
- `oh-my-opencode` (compatibility package name)

Plugin registration inside `opencode.json` prefers `oh-my-openagent`.

## Bin Commands

All published packages expose the same compiled CLI with these bin entries:

- `oh-my-openagent` (preferred name)
- `oh-my-opencode` (legacy compatibility name)
- `omo` (short alias, recommended in docs and prompts)
- `lazycodex-ai` (Light edition shortcut; `lazycodex-ai install` is equivalent to `omo install --platform=codex`; any explicit `--platform` value must be `codex`)

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
| `install` | Interactive setup wizard |
| `uninstall` / `cleanup` | Remove managed Codex Light state |
| `doctor` | Installation health diagnostics |
| `run <message>` | Non-interactive OpenCode session runner with completion enforcement |
| `get-local-version` | Show current installed version and check for updates |
| `refresh-model-capabilities` | Refresh cached model capabilities snapshot from models.dev |
| `boulder` | Inspect Sisyphus boulder work-state (active plan, per-task timers, session lineage) |
| `version` | Show CLI version |
| `mcp oauth` | OAuth token management for MCP servers |

---

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
| `--vercel-ai-gateway <value>` | Vercel AI Gateway: `no`, `yes` (Ultimate only) |
| `--codex-autonomous` | Configure Codex with `approval_policy = "never"`, `sandbox_mode = "danger-full-access"`, and `network_access = "enabled"` when installing Light or Both |
| `--no-codex-autonomous` | Leave existing Codex permission settings unchanged when installing Light or Both |
| `--skip-auth` | Skip authentication setup hints |

When using the `lazycodex-ai` bin alias, `install` defaults to `--platform=codex`. `lazycodex-ai` is only the npm/bin alias; `lazycodex` is the marketplace repository name. The Codex config uses marketplace `sisyphuslabs` and plugin `omo`, enabled as `omo@sisyphuslabs`, with the marketplace source set to the local built cache under `~/.codex/plugins/cache/sisyphuslabs`.

Subscription flags (`--claude`, `--openai`, etc.) only apply when `--platform` is `opencode` or `both`. They are rejected under `--platform=codex` because the Light edition does not write OpenCode model config. `--codex-autonomous` and `--no-codex-autonomous` only affect installs where the selected platform includes Codex.

### Telemetry and opt-out

Anonymous telemetry uses PostHog with a hashed installation identifier. Two streams exist:

- `omo_daily_active`: fired by the main plugin when it loads (`reason: "plugin_loaded"`) and by `oh-my-openagent run` (`reason: "run_started"`).
- `omo_codex_daily_active`: fired by `omo install --platform=codex` or `--platform=both` (`reason: "install_completed"`) and by the Codex plugin's `SessionStart` hook on every Codex session (`reason: "session_start"`). Both sources share the same UTC-day deduplication, so daily/weekly/monthly active counts reflect real Codex usage, not just install events.

Opt-out env vars:

- Global opt-out for oh-my-openagent and omo-codex: `OMO_SEND_ANONYMOUS_TELEMETRY=0` or `OMO_DISABLE_POSTHOG=1`
- Codex-only opt-out for `omo_codex_daily_active`: `OMO_CODEX_SEND_ANONYMOUS_TELEMETRY=0` or `OMO_CODEX_DISABLE_POSTHOG=1`

The OpenCode plugin can also opt out through oh-my-openagent config with `"telemetry": false`.

For the full Codex Light event inventory, collected properties, local state path, and lazycodex marketplace copy path, see [Codex Light telemetry](./codex-telemetry.md).

---

## uninstall / cleanup

Removes managed Codex Light state. `cleanup` remains available as a backward-compatible alias.

For the OpenCode plugin, temporary disable is just a config edit: remove `"oh-my-openagent"` or legacy `"oh-my-opencode"` from the `plugin` arrays in `~/.config/opencode/opencode.json[c]` and, when present, `~/.config/opencode/tui.json`, then restart OpenCode. Keep the plugin config files if you plan to re-enable later.

### Usage

```bash
npx lazycodex-ai uninstall
omo uninstall --platform=codex
```

### Options

| Option | Description |
| --- | --- |
| `--platform codex` | Required when using the shared `omo` CLI unless `OMO_INVOCATION_NAME` is `lazycodex-ai` |
| `--codex-home <path>` | Codex home to clean, defaulting to `CODEX_HOME` or `~/.codex` |
| `--project <path>` | Project directory to inspect for project-local legacy Codex artifacts |
| `--json` | Output structured JSON result |

The command removes the managed `sisyphuslabs` plugin cache and marketplace snapshot, strips `omo@sisyphuslabs` plugin, hook-state, and managed agent blocks from `~/.codex/config.toml` after writing a backup, and removes managed agent TOML files from `~/.codex/agents/`, including orphaned files whose install manifest is already gone. Project-owned `.codex` artifacts are reported, not deleted.

### Verify Removal

```bash
bunx oh-my-openagent doctor --status
grep -R "oh-my-openagent\|oh-my-opencode" \
  ~/.config/opencode/opencode.json ~/.config/opencode/opencode.jsonc ~/.config/opencode/tui.json 2>/dev/null
grep -R "sisyphuslabs\|omo@sisyphuslabs" ~/.codex/config.toml 2>/dev/null
```

The OpenCode grep should print no active server or TUI plugin entry after disabling or uninstalling the OpenCode plugin. The Codex grep should print no managed `sisyphuslabs` plugin state after `uninstall` / `cleanup`. If project-local Codex config still fails with a legacy `multi_agent_v2` conflict, rerun cleanup from that project or pass `--project <path>`.

---

## doctor

Diagnoses your environment and configuration. Checks are grouped into four categories: **System**, **Config**, **Tools**, and **Models**.

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

### Notes

- The current minimum OpenCode version check is `>= 1.4.0`.
- The doctor command warns when legacy plugin registration (`oh-my-opencode`) is still present in `opencode.json`.

---

## run

Runs a non-interactive session and exits only when both conditions are true:

- all todos are completed or cancelled
- all background child sessions are idle

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
4. `Sisyphus`

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

`run`, `install`, `doctor`, `get-local-version`, `refresh-model-capabilities`, and `mcp oauth` subcommands return explicit numeric exit codes.
