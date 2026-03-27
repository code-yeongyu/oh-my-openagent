# CLI Reference

Complete reference for the published `oh-my-opencode` CLI. During the rename transition, OpenCode plugin registration now prefers `oh-my-openagent` inside `opencode.json`.

## Basic Usage

```bash
# Display help
bunx oh-my-opencode

# Or with npx
npx oh-my-opencode
```

## Commands

| Command             | Description                               |
| ------------------- | ----------------------------------------- |
| `install`           | Interactive setup wizard                  |
| `doctor`            | Environment diagnostics and health checks |
| `run`               | OpenCode session runner                   |
| `mcp oauth`         | MCP OAuth authentication management       |
| `auth`              | Google Antigravity OAuth authentication   |
| `get-local-version` | Display local version information         |

---

## install

Interactive installation tool for initial Oh My OpenCode setup. Provides a TUI based on `@clack/prompts`.

### Usage

```bash
bunx oh-my-opencode install
```

### Installation Process

1. **Provider Selection**: Choose your AI provider (Claude, ChatGPT, or Gemini)
2. **API Key Input**: Enter the API key for your selected provider
3. **Configuration File Creation**: Writes the plugin config file used by the current install path. Existing installs still commonly use `oh-my-opencode.json`, while renamed `oh-my-openagent.json[c]` files are also recognized.
4. **Plugin Registration**: Registers `oh-my-openagent` in OpenCode settings, or upgrades a legacy `oh-my-opencode` entry during the compatibility window

### Options

| Option      | Description                                                      |
| ----------- | ---------------------------------------------------------------- |
| `--no-tui`  | Run in non-interactive mode without TUI (for CI/CD environments) |
| `--verbose` | Display detailed logs                                            |

---

## doctor

Diagnoses your environment to ensure Oh My OpenCode is functioning correctly. Performs 17+ health checks covering installation, configuration, authentication, dependencies, and tools.

The doctor command detects common issues including:
- Legacy plugin entry references in `opencode.json` (warns when `oh-my-opencode` is still used instead of `oh-my-openagent`)
- Configuration file validity and JSONC parsing errors
- Model resolution and fallback chain verification
- API key validity for configured providers
- Missing or misconfigured MCP servers
### Usage

```bash
bunx oh-my-opencode doctor
```

### Diagnostic Categories

| Category           | Check Items                                               |
| ------------------ | --------------------------------------------------------- |
| **Installation**   | OpenCode version (>= 1.0.150), plugin registration status |
| **Configuration**  | Configuration file validity, JSONC parsing                |
| **Authentication** | Anthropic, OpenAI, Google API key validity                |
| **Dependencies**   | Bun, Node.js, Git installation status                     |
| **Tools**          | LSP server status, MCP server status                      |
| **Updates**        | Latest version check                                      |

### Options

| Option              | Description                                                      |
| ------------------- | ---------------------------------------------------------------- |
| `--category <name>` | Check specific category only (e.g., `--category authentication`) |
| `--json`            | Output results in JSON format                                    |
| `--verbose`         | Include detailed information                                     |

### Example Output

```
oh-my-opencode doctor

┌──────────────────────────────────────────────────┐
│  Oh-My-OpenAgent Doctor                           │
└──────────────────────────────────────────────────┘

Installation
  ✓ OpenCode version: 1.0.155 (>= 1.0.150)
  ✓ Plugin registered in opencode.json

Configuration
  ✓ oh-my-opencode.jsonc is valid
  ✓ Model resolution: all agents have valid fallback chains
  ⚠ categories.visual-engineering: using default model

Authentication
  ✓ Anthropic API key configured
  ✓ OpenAI API key configured
  ✗ Google API key not found

Dependencies
  ✓ Bun 1.2.5 installed
  ✓ Node.js 22.0.0 installed
  ✓ Git 2.45.0 installed

Summary: 10 passed, 1 warning, 1 failed
```
---

## run

Executes OpenCode sessions and monitors task completion.

### Usage

```bash
bunx oh-my-opencode run [prompt]
```

### Options

| Option                   | Description                                       |
| ------------------------ | ------------------------------------------------- |
| `--enforce-completion`   | Keep session active until all TODOs are completed |
| `--timeout <seconds>`    | Set maximum execution time                        |
| `--agent <name>`         | Specify agent to use                              |
| `--directory <path>`     | Set working directory                             |
| `--port <number>`        | Set port for session                              |
| `--attach`               | Attach to existing session                        |
| `--json`                 | Output in JSON format                             |
| `--no-timestamp`         | Disable timestamped output                        |
| `--session-id <id>`      | Resume existing session                           |
| `--on-complete <action>` | Action on completion                              |
| `--verbose`              | Enable verbose logging                            |

---

## mcp oauth

Manages OAuth 2.1 authentication for remote MCP servers.

### Usage

```bash
# Login to an OAuth-protected MCP server
bunx oh-my-opencode mcp oauth login <server-name> --server-url https://api.example.com

# Login with explicit client ID and scopes
bunx oh-my-opencode mcp oauth login my-api --server-url https://api.example.com --client-id my-client --scopes "read,write"

# Remove stored OAuth tokens
bunx oh-my-opencode mcp oauth logout <server-name>

# Check OAuth token status
bunx oh-my-opencode mcp oauth status [server-name]
```

### Options

| Option               | Description                                                               |
| -------------------- | ------------------------------------------------------------------------- |
| `--server-url <url>` | MCP server URL (required for login)                                       |
| `--client-id <id>`   | OAuth client ID (optional if server supports Dynamic Client Registration) |
| `--scopes <scopes>`  | Comma-separated OAuth scopes                                              |

### Token Storage

Tokens are stored in `~/.config/opencode/mcp-oauth.json` with `0600` permissions (owner read/write only). Key format: `{serverHost}/{resource}`.

---

## Configuration Files

The CLI searches for configuration files in the following locations (in priority order):

1. **Project Level**: `.opencode/oh-my-openagent.jsonc`, `.opencode/oh-my-openagent.json`, `.opencode/oh-my-opencode.jsonc`, or `.opencode/oh-my-opencode.json`
2. **User Level**: `~/.config/opencode/oh-my-openagent.jsonc`, `~/.config/opencode/oh-my-openagent.json`, `~/.config/opencode/oh-my-opencode.jsonc`, or `~/.config/opencode/oh-my-opencode.json`

**Naming Note**: The published package and binary are still `oh-my-opencode`. Inside `opencode.json`, the compatibility layer now prefers the plugin entry `oh-my-openagent`. Plugin config loading recognizes both `oh-my-openagent.*` and legacy `oh-my-opencode.*` basenames. If both basenames exist in the same directory, the legacy `oh-my-opencode.*` file currently wins.

### Filename Compatibility

Both `.jsonc` and `.json` extensions are supported. JSONC (JSON with Comments) is preferred as it allows:
- Comments (both `//` and `/* */` styles)
- Trailing commas in arrays and objects

If both `.jsonc` and `.json` exist in the same directory, the `.jsonc` file takes precedence.

### JSONC Support

Configuration files support **JSONC (JSON with Comments)** format. You can use comments and trailing commas.

```jsonc
{
  // Agent configuration
  "sisyphus_agent": {
    "disabled": false,
    "planner_enabled": true,
  },

  /* Category customization */
  "categories": {
    "visual-engineering": {
      "model": "google/gemini-3.1-pro",
    },
  },
}
```

---

## Troubleshooting

### "OpenCode version too old" Error

```bash
# Update OpenCode
npm install -g opencode@latest
# or
bun install -g opencode@latest
```

### "Plugin not registered" Error

```bash
# Reinstall plugin
bunx oh-my-opencode install
```

### Doctor Check Failures

```bash
# Diagnose with detailed information
bunx oh-my-opencode doctor --verbose

# Check specific category only
bunx oh-my-opencode doctor --category authentication
```

### "Using legacy package name" Warning

The doctor warns if it finds the legacy plugin entry `oh-my-opencode` in `opencode.json`. Update the plugin array to the canonical `oh-my-openagent` entry:

```bash
# Replace the legacy plugin entry in user config
jq '.plugin = (.plugin // [] | map(if . == "oh-my-opencode" then "oh-my-openagent" else . end))' \
  ~/.config/opencode/opencode.json > /tmp/opencode.json && mv /tmp/opencode.json ~/.config/opencode/opencode.json
```
---

## Non-Interactive Mode

Use JSON output for CI or scripted diagnostics.

```bash
# Run doctor in CI environment
bunx oh-my-opencode doctor --json

# Save results to file
bunx oh-my-opencode doctor --json > doctor-report.json
```

---

## Developer Information

### CLI Structure

```
src/cli/
├── cli-program.ts        # Commander.js-based main entry
├── install.ts            # @clack/prompts-based TUI installer
├── config-manager/       # JSONC parsing, multi-source config management
│   └── *.ts
├── doctor/               # Health check system
│   ├── index.ts          # Doctor command entry
│   └── checks/           # 17+ individual check modules
├── run/                  # Session runner
│   └── *.ts
└── mcp-oauth/            # OAuth management commands
    └── *.ts
```

### Adding New Doctor Checks

Create `src/cli/doctor/checks/my-check.ts`:

```typescript
import type { DoctorCheck } from "../types";

export const myCheck: DoctorCheck = {
  name: "my-check",
  category: "environment",
  check: async () => {
    // Check logic
    const isOk = await someValidation();

    return {
      status: isOk ? "pass" : "fail",
      message: isOk ? "Everything looks good" : "Something is wrong",
    };
  },
};
```

Register in `src/cli/doctor/checks/index.ts`:

```typescript
export { myCheck } from "./my-check";
```
