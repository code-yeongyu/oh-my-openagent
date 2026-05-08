# CLI Reference

Complete reference for the published CLI package. During the rename transition, both package names work:

- `oh-my-openagent` (preferred package name)
- `oh-my-opencode` (compatibility package name)

Plugin registration inside `opencode.json` prefers `oh-my-openagent`.

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
| `doctor` | Installation health diagnostics |
| `run <message>` | Non-interactive OpenCode session runner with completion enforcement |
| `get-local-version` | Show current installed version and check for updates |
| `refresh-model-capabilities` | Refresh cached model capabilities snapshot from models.dev |
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
| `--claude <value>` | Claude subscription: `no`, `yes`, `max20` |
| `--openai <value>` | OpenAI/ChatGPT subscription: `no`, `yes` |
| `--gemini <value>` | Gemini integration: `no`, `yes` |
| `--copilot <value>` | GitHub Copilot subscription: `no`, `yes` |
| `--opencode-zen <value>` | OpenCode Zen access: `no`, `yes` |
| `--zai-coding-plan <value>` | Z.ai Coding Plan subscription: `no`, `yes` |
| `--kimi-for-coding <value>` | Kimi For Coding subscription: `no`, `yes` |
| `--opencode-go <value>` | OpenCode Go subscription: `no`, `yes` |
| `--vercel-ai-gateway <value>` | Vercel AI Gateway: `no`, `yes` |
| `--skip-auth` | Skip authentication setup hints |

Anonymous telemetry uses PostHog with a hashed installation identifier. Disable with `OMO_SEND_ANONYMOUS_TELEMETRY=0` or `OMO_DISABLE_POSTHOG=1`.

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
