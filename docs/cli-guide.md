# Matrixx CLI Guide

This document provides a comprehensive guide to using the Matrixx CLI tools.

## 1. Overview

Matrixx provides CLI tools accessible via the `bunx opencode-matrixx` command (or `bunx matrixx` once installed locally — the binary is named `matrixx`, but the npm package is `opencode-matrixx`). The CLI supports various features including plugin installation, environment diagnostics, and session execution.

```bash
# Basic execution (displays help)
bunx opencode-matrixx

# Or run with npx
npx opencode-matrixx
```

---

## 2. Available Commands

| Command | Description |
|---------|-------------|
| `install` | Interactive Setup Wizard |
| `doctor` | Environment diagnostics and health checks |
| `run` | OpenCode session runner |
| `auth` | Google Antigravity authentication management |
| `version` | Display version information |

---

## 3. `install` - Interactive Setup Wizard

An interactive installation tool for initial Matrixx setup. Provides a beautiful TUI (Text User Interface) based on `@clack/prompts`.

### Usage

```bash
bunx opencode-matrixx install
```

### Installation Process

1. **Provider Selection**: Choose your AI provider from Claude, ChatGPT, or Gemini.
2. **API Key Input**: Enter the API key for your selected provider.
3. **Configuration File Creation**: Generates `opencode.json` or `matrixx.json` files.
4. **Plugin Registration**: Automatically registers the matrixx plugin in OpenCode settings.

### Options

| Option | Description |
|--------|-------------|
| `--no-tui` | Run in non-interactive mode without TUI (for CI/CD environments) |
| `--verbose` | Display detailed logs |

---

## 4. `doctor` - Environment Diagnostics

Diagnoses your environment to ensure Matrixx is functioning correctly. Performs 17+ health checks.

### Usage

```bash
bunx opencode-matrixx doctor
```

### Diagnostic Categories

| Category | Check Items |
|----------|-------------|
| **Installation** | OpenCode version (>= 1.0.150), plugin registration status |
| **Configuration** | Configuration file validity, JSONC parsing |
| **Authentication** | Anthropic, OpenAI, Google API key validity |
| **Dependencies** | Bun, Node.js, Git installation status |
| **Tools** | LSP server status, MCP server status |
| **Updates** | Latest version check |

### Options

| Option | Description |
|--------|-------------|
| `--category <name>` | Check specific category only (e.g., `--category authentication`) |
| `--json` | Output results in JSON format |
| `--verbose` | Include detailed information |

### Example Output

```
matrixx doctor

┌──────────────────────────────────────────────────┐
│  Matrixx Doctor                           │
└──────────────────────────────────────────────────┘

Installation
  ✓ OpenCode version: 1.0.155 (>= 1.0.150)
  ✓ Plugin registered in opencode.json

Configuration
  ✓ matrixx.json is valid
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

## 5. `run` - OpenCode Session Runner

Executes OpenCode sessions and monitors task completion.

### Usage

```bash
bunx opencode-matrixx run [prompt]
```

### Options

| Option | Description |
|--------|-------------|
| `--enforce-completion` | Keep session active until all TODOs are completed |
| `--timeout <seconds>` | Set maximum execution time |

---

## 6. `mcp oauth` - MCP OAuth Management

Manages OAuth 2.1 authentication for remote MCP servers.

### Usage

```bash
# Login to an OAuth-protected MCP server
bunx opencode-matrixx mcp oauth login <server-name> --server-url https://api.example.com

# Login with explicit client ID and scopes
bunx opencode-matrixx mcp oauth login my-api --server-url https://api.example.com --client-id my-client --scopes "read,write"

# Remove stored OAuth tokens
bunx opencode-matrixx mcp oauth logout <server-name>

# Check OAuth token status
bunx opencode-matrixx mcp oauth status [server-name]
```

### Options

| Option | Description |
|--------|-------------|
| `--server-url <url>` | MCP server URL (required for login) |
| `--client-id <id>` | OAuth client ID (optional if server supports Dynamic Client Registration) |
| `--scopes <scopes>` | Comma-separated OAuth scopes |

### Token Storage

Tokens are stored in `~/.config/opencode/mcp-oauth.json` with `0600` permissions (owner read/write only). Key format: `{serverHost}/{resource}`.

---

## 7. `auth` - Authentication Management

Manages Google Antigravity OAuth authentication. Required for using Gemini models.

### Usage

```bash
# Login
bunx opencode-matrixx auth login

# Logout
bunx opencode-matrixx auth logout

# Check current status
bunx opencode-matrixx auth status
```

---

## 8. In-Session Slash Commands

These are slash commands used within OpenCode sessions during active conversations.

### `/end-ultrawork`

Deactivates ultrawork mode and returns to default Matrixx behavior for the current session.

```
Usage: /end-ultrawork
Effect: Disables ultrawork mode, stops parallel background agent execution,
        reverts to standard single-threaded processing
```

This is useful when ultrawork mode was activated (via `ulw` keyword or auto-detection) and you want to continue the session in normal mode without starting over.

### `/handoff`

Creates a structured context handoff with YAML frontmatter for continuing work in a new session.

```
Usage: /handoff
Effect: Creates .matrixx/handoff.md with structured metadata including:
        - topics, goal, work_completed
        - current_state, pending_tasks
        - key_files, important_decisions
        - explicit_constraints, context_for_continuation
```

Use this when you need to preserve session state for continuation later. The handoff file can be consumed in a fresh session using `/pickup`.

### `/pickup`

Loads handoff context from a previous session.

```
Usage: /pickup
Effect: Reads .matrixx/handoff.md and injects the stored context
        into the current session, including pending tasks, key files,
        and important decisions
```

This enables seamless session-to-session continuity without losing context.

---

## 9. Configuration Files

The CLI searches for configuration files in the following locations (in priority order):

1. **Project Level**: `.opencode/matrixx.json`
2. **User Level**: `~/.config/opencode/matrixx.json`

### JSONC Support

Configuration files support **JSONC (JSON with Comments)** format. You can use comments and trailing commas.

```jsonc
{
  // Agent configuration
  "morpheus_agent": {
    "disabled": false,
    "planner_enabled": true,
  },
  
  /* Category customization */
  "categories": {
    "visual-engineering": {
      "model": "google/gemini-3-pro",
    },
  },
}
```

---

## 10. Troubleshooting

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
bunx opencode-matrixx install
```

### Doctor Check Failures

```bash
# Diagnose with detailed information
bunx opencode-matrixx doctor --verbose

# Check specific category only
bunx opencode-matrixx doctor --category authentication
```

---

## 11. Non-Interactive Mode

Use the `--no-tui` option for CI/CD environments.

```bash
# Run doctor in CI environment
bunx opencode-matrixx doctor --no-tui --json

# Save results to file
bunx opencode-matrixx doctor --json > doctor-report.json
```

---

## 12. Developer Information

### CLI Structure

```
src/cli/
├── index.ts              # Commander.js-based main entry
├── install.ts            # @clack/prompts-based TUI installer
├── config-manager.ts     # JSONC parsing, multi-source config management
├── doctor/               # Health check system
│   ├── index.ts          # Doctor command entry
│   └── checks/           # 17+ individual check modules
├── run/                  # Session runner
└── commands/auth.ts      # Authentication management
```

### Adding New Doctor Checks

1. Create `src/cli/doctor/checks/my-check.ts`:

```typescript
import type { DoctorCheck } from "../types"

export const myCheck: DoctorCheck = {
  name: "my-check",
  category: "environment",
  check: async () => {
    // Check logic
    const isOk = await someValidation()
    
    return {
      status: isOk ? "pass" : "fail",
      message: isOk ? "Everything looks good" : "Something is wrong",
    }
  },
}
```

2. Register in `src/cli/doctor/checks/index.ts`:

```typescript
export { myCheck } from "./my-check"
```
