# Oh-My-OpenCode Configuration

Highly opinionated, but adjustable to taste.

## Quick Start

**Most users don't need to configure anything manually.** Run the interactive installer:

```bash
bunx oh-my-opencode install
```

It asks about your providers (Claude, OpenAI, Gemini, etc.) and generates optimal config automatically.

**Want to customize?** Here's the common patterns:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
  
  // Override specific agent models
  "agents": {
    "oracle": { "model": "openai/gpt-5.2" },           // Use GPT for debugging
    "librarian": { "model": "zai-coding-plan/glm-4.7" }, // Cheap model for research
    "explore": { "model": "opencode/gpt-5-nano" }        // Free model for grep
  },
  
  // Override category models (used by task)
  "categories": {
    "quick": { "model": "opencode/gpt-5-nano" },         // Fast/cheap for trivial tasks
    "visual-engineering": { "model": "google/gemini-3-pro" } // Gemini for UI
  }
}
```

**Find available models:** Run `opencode models` to see all models in your environment.

## Config File Locations

Config file locations (priority order):
1. `.opencode/oh-my-opencode.jsonc` or `.opencode/oh-my-opencode.json` (project; prefers `.jsonc` when both exist)
2. User config (platform-specific; prefers `.jsonc` when both exist):

| Platform        | User Config Path                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Windows**     | `~/.config/opencode/oh-my-opencode.jsonc` (preferred) or `~/.config/opencode/oh-my-opencode.json` (fallback); `%APPDATA%\opencode\oh-my-opencode.jsonc` / `%APPDATA%\opencode\oh-my-opencode.json` (fallback) |
| **macOS/Linux** | `~/.config/opencode/oh-my-opencode.jsonc` (preferred) or `~/.config/opencode/oh-my-opencode.json` (fallback)                |

Schema autocomplete supported:

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json"
}
```

## JSONC Support

The `oh-my-opencode` configuration file supports JSONC (JSON with Comments):
- Line comments: `// comment`
- Block comments: `/* comment */`
- Trailing commas: `{ "key": "value", }`

When both `oh-my-opencode.jsonc` and `oh-my-opencode.json` files exist, `.jsonc` takes priority.

**Example with comments:**

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",

  /* Agent overrides - customize models for specific tasks */
  "agents": {
    "oracle": {
      "model": "openai/gpt-5.2"  // GPT for strategic reasoning
    },
    "explore": {
      "model": "opencode/gpt-5-nano"  // Free & fast for exploration
    },
  },
}
```

## Google Auth

**Recommended**: For Google Gemini authentication, install the [`opencode-antigravity-auth`](https://github.com/NoeFabris/opencode-antigravity-auth) plugin (`@latest`). It provides multi-account load balancing, variant-based thinking levels, dual quota system (Antigravity + Gemini CLI), and active maintenance. See [Installation > Google Gemini](guide/installation.md#google-gemini-antigravity-oauth).

## Ollama Provider

**IMPORTANT**: When using Ollama as a provider, you **must** disable streaming to avoid JSON parsing errors.

### Required Configuration

```json
{
  "agents": {
    "explore": {
      "model": "ollama/qwen3-coder",
      "stream": false
    }
  }
}
```

### Why `stream: false` is Required

Ollama returns NDJSON (newline-delimited JSON) when streaming is enabled, but Claude Code SDK expects a single JSON object. This causes `JSON Parse error: Unexpected EOF` when agents attempt tool calls.

**Example of the problem**:
```json
// Ollama streaming response (NDJSON - multiple lines)
{"message":{"tool_calls":[...]}, "done":false}
{"message":{"content":""}, "done":true}

// Claude Code SDK expects (single JSON object)
{"message":{"tool_calls":[...], "content":""}, "done":true}
```

### Supported Models

Common Ollama models that work with oh-my-opencode:

| Model | Best For | Configuration |
|-------|----------|---------------|
| `ollama/qwen3-coder` | Code generation, build fixes | `{"model": "ollama/qwen3-coder", "stream": false}` |
| `ollama/ministral-3:14b` | Exploration, codebase search | `{"model": "ollama/ministral-3:14b", "stream": false}` |
| `ollama/lfm2.5-thinking` | Documentation, writing | `{"model": "ollama/lfm2.5-thinking", "stream": false}` |

### Troubleshooting

If you encounter `JSON Parse error: Unexpected EOF`:

1. **Verify `stream: false` is set** in your agent configuration
2. **Check Ollama is running**: `curl http://localhost:11434/api/tags`
3. **Test with curl**:
   ```bash
   curl -s http://localhost:11434/api/chat \
     -d '{"model": "qwen3-coder", "messages": [{"role": "user", "content": "Hello"}], "stream": false}'
   ```
4. **See detailed troubleshooting**: [docs/troubleshooting/ollama-streaming-issue.md](troubleshooting/ollama-streaming-issue.md)

### Future SDK Fix

The proper long-term fix requires Claude Code SDK to parse NDJSON responses correctly. Until then, use `stream: false` as a workaround.

**Tracking**: https://github.com/code-yeongyu/oh-my-opencode/issues/1124

## Agents

Override built-in agent settings:

```json
{
  "agents": {
    "explore": {
      "model": "anthropic/claude-haiku-4-5",
      "temperature": 0.5
    },
    "multimodal-looker": {
      "disable": true
    }
  }
}
```

Each agent supports: `model`, `temperature`, `top_p`, `prompt`, `prompt_append`, `tools`, `disable`, `description`, `mode`, `color`, `permission`, `category`, `variant`, `maxTokens`, `thinking`, `reasoningEffort`, `textVerbosity`, `providerOptions`.

### Additional Agent Options

| Option              | Type    | Description                                                                                     |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `category`          | string  | Category name to inherit model and other settings from category defaults                             |
| `variant`           | string  | Model variant (e.g., `max`, `high`, `medium`, `low`, `xhigh`)                                 |
| `maxTokens`         | number  | Maximum tokens for response. Passed directly to OpenCode SDK.                                      |
| `thinking`          | object  | Extended thinking configuration for Anthropic models. See [Thinking Options](#thinking-options) below. |
| `reasoningEffort`   | string  | OpenAI reasoning effort level. Values: `low`, `medium`, `high`, `xhigh`.                         |
| `textVerbosity`      | string  | Text verbosity level. Values: `low`, `medium`, `high`.                                        |
| `providerOptions`    | object  | Provider-specific options passed directly to OpenCode SDK.                                      |

#### Thinking Options (Anthropic)

```json
{
  "agents": {
    "oracle": {
      "thinking": {
        "type": "enabled",
        "budgetTokens": 200000
      }
    }
  }
}
```

| Option        | Type    | Default | Description                                  |
| ------------- | ------- | ------- | -------------------------------------------- |
| `type`        | string  | -       | `enabled` or `disabled`                      |
| `budgetTokens`| number  | -       | Maximum budget tokens for extended thinking  |

Use `prompt_append` to add extra instructions without replacing the default system prompt:

```json
{
  "agents": {
    "librarian": {
      "prompt_append": "Always use the elisp-dev-mcp for Emacs Lisp documentation lookups."
    }
  }
}
```

You can also override settings for `Sisyphus` (the main orchestrator) and `build` (the default agent) using the same options.

### Permission Options

Fine-grained control over what agents can do:

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

| Permission           | Description                            | Values                                                                      |
| -------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `edit`               | File editing permission                | `ask` / `allow` / `deny`                                                    |
| `bash`               | Bash command execution                 | `ask` / `allow` / `deny` or per-command: `{ "git": "allow", "rm": "deny" }` |
| `webfetch`           | Web request permission                 | `ask` / `allow` / `deny`                                                    |
| `doom_loop`          | Allow infinite loop detection override | `ask` / `allow` / `deny`                                                    |
| `external_directory` | Access files outside project root      | `ask` / `allow` / `deny`                                                    |

Or disable via `disabled_agents` in `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.json`:

```json
{
  "disabled_agents": ["oracle", "multimodal-looker"]
}
```

Available agents: `sisyphus`, `prometheus`, `oracle`, `librarian`, `explore`, `multimodal-looker`, `metis`, `momus`, `atlas`

## Built-in Skills

Oh My OpenCode includes built-in skills that provide additional capabilities:

- **playwright** (default) / **agent-browser**: Browser automation for web scraping, testing, screenshots, and browser interactions. See [Browser Automation](#browser-automation) for switching between providers.
- **git-master**: Git expert for atomic commits, rebase/squash, and history search (blame, bisect, log -S). STRONGLY RECOMMENDED: Use with `task(category='quick', load_skills=['git-master'], ...)` to save context.

Disable built-in skills via `disabled_skills` in `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.json`:

```json
{
  "disabled_skills": ["playwright"]
}
```

Available built-in skills: `playwright`, `agent-browser`, `git-master`

## Skills Configuration

Configure advanced skills settings including custom skill sources, enabling/disabling specific skills, and defining custom skills.

```json
{
  "skills": {
    "sources": [
      { "path": "./custom-skills", "recursive": true },
      "https://example.com/skill.yaml"
    ],
    "enable": ["my-custom-skill"],
    "disable": ["other-skill"],
    "my-skill": {
      "description": "Custom skill description",
      "template": "Custom prompt template",
      "from": "source-file.ts",
      "model": "custom/model",
      "agent": "custom-agent",
      "subtask": true,
      "argument-hint": "usage hint",
      "license": "MIT",
      "compatibility": ">= 3.0.0",
      "metadata": {
        "author": "Your Name"
      },
      "allowed-tools": ["tool1", "tool2"]
    }
  }
}
```

### Sources

Load skills from local directories or remote URLs:

```json
{
  "skills": {
    "sources": [
      { "path": "./custom-skills", "recursive": true },
      { "path": "./single-skill.yaml" },
      "https://example.com/skill.yaml",
      "https://raw.githubusercontent.com/user/repo/main/skills/*"
    ]
  }
}
```

| Option      | Default | Description                                    |
| ----------- | ------- | ---------------------------------------------- |
| `path`      | -       | Local file/directory path or remote URL            |
| `recursive`  | `false`  | Recursively load from directory                 |
| `glob`      | -       | Glob pattern for file selection                 |

### Enable/Disable Skills

```json
{
  "skills": {
    "enable": ["skill-1", "skill-2"],
    "disable": ["disabled-skill"]
  }
}
```

### Custom Skill Definition

Define custom skills directly in your config:

| Option           | Default | Description                                                                          |
| ---------------- | ------- | ------------------------------------------------------------------------------------ |
| `description`     | -       | Human-readable description of the skill                                                 |
| `template`        | -       | Custom prompt template for the skill                                                    |
| `from`           | -       | Source file to load template from                                                     |
| `model`           | -       | Override model for this skill                                                         |
| `agent`           | -       | Override agent for this skill                                                         |
| `subtask`         | `false`  | Whether to run as a subtask                                                           |
| `argument-hint`   | -       | Hint for how to use the skill                                                        |
| `license`          | -       | Skill license                                                                       |
| `compatibility`    | -       | Required oh-my-opencode version compatibility                                           |
| `metadata`         | -       | Additional metadata as key-value pairs                                                |
| `allowed-tools`    | -       | Array of tools this skill is allowed to use                                            |

**Example: Custom skill**

```json
{
  "skills": {
    "data-analyst": {
      "description": "Specialized for data analysis tasks",
      "template": "You are a data analyst. Focus on statistical analysis, visualization, and data interpretation.",
      "model": "openai/gpt-5.2",
      "allowed-tools": ["read", "bash", "lsp_diagnostics"]
    }
  }
}
```

## Browser Automation

Choose between two browser automation providers:

| Provider | Interface | Features | Installation |
|----------|-----------|----------|--------------|
| **playwright** (default) | MCP tools | Playwright MCP server with structured tool calls | Auto-installed via npx |
| **agent-browser** | Bash CLI | Vercel's CLI with session management, parallel browsers | Requires `bun add -g agent-browser` |

**Switch providers** via `browser_automation_engine` in `oh-my-opencode.json`:

```json
{
  "browser_automation_engine": {
    "provider": "agent-browser"
  }
}
```

### Playwright (Default)

Uses the official Playwright MCP server (`@playwright/mcp`). Browser automation happens through structured MCP tool calls.

### agent-browser

Uses [Vercel's agent-browser CLI](https://github.com/vercel-labs/agent-browser). Key advantages:
- **Session management**: Run multiple isolated browser instances with `--session` flag
- **Persistent profiles**: Keep browser state across restarts with `--profile`
- **Snapshot-based workflow**: Get element refs via `snapshot -i`, interact with `@e1`, `@e2`, etc.
- **CLI-first**: All commands via Bash - great for scripting

**Installation required**:
```bash
bun add -g agent-browser
agent-browser install  # Download Chromium
```

**Example workflow**:
```bash
agent-browser open https://example.com
agent-browser snapshot -i  # Get interactive elements with refs
agent-browser fill @e1 "user@example.com"
agent-browser click @e2
agent-browser screenshot result.png
agent-browser close
```

## Tmux Integration

Run background subagents in separate tmux panes for **visual multi-agent execution**. See your agents working in parallel, each in their own terminal pane.

**Enable tmux integration** via `tmux` in `oh-my-opencode.json`:

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

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `false` | Enable tmux subagent pane spawning. Only works when running inside an existing tmux session. |
| `layout` | `main-vertical` | Tmux layout for agent panes. See [Layout Options](#layout-options) below. |
| `main_pane_size` | `60` | Main pane size as percentage (20-80). |
| `main_pane_min_width` | `120` | Minimum width for main pane in columns. |
| `agent_pane_min_width` | `40` | Minimum width for each agent pane in columns. |

### Layout Options

| Layout | Description |
|--------|-------------|
| `main-vertical` | Main pane left, agent panes stacked on right (default) |
| `main-horizontal` | Main pane top, agent panes stacked bottom |
| `tiled` | All panes in equal-sized grid |
| `even-horizontal` | All panes in horizontal row |
| `even-vertical` | All panes in vertical stack |

### Requirements

1. **Must run inside tmux**: The feature only activates when OpenCode is already running inside a tmux session
2. **Tmux installed**: Requires tmux to be available in PATH
3. **Server mode**: OpenCode must run with `--port` flag to enable subagent pane spawning

### How It Works

When `tmux.enabled` is `true` and you're inside a tmux session:
- Background agents (via `task(run_in_background=true)`) spawn in new tmux panes
- Each pane shows the subagent's real-time output
- Panes are automatically closed when the subagent completes
- Layout is automatically adjusted based on your configuration

### Running OpenCode with Tmux Subagent Support

To enable tmux subagent panes, OpenCode must run in **server mode** with the `--port` flag. This starts an HTTP server that subagent panes connect to via `opencode attach`.

**Basic setup**:
```bash
# Start tmux session
tmux new -s dev

# Run OpenCode with server mode (port 4096)
opencode --port 4096

# Now background agents will appear in separate panes
```

**Recommended: Shell Function**

For convenience, create a shell function that automatically handles tmux sessions and port allocation. Here's an example for Fish shell:

```fish
# ~/.config/fish/config.fish
function oc
    set base_name (basename (pwd))
    set path_hash (echo (pwd) | md5 | cut -c1-4)
    set session_name "$base_name-$path_hash"
    
    # Find available port starting from 4096
    function __oc_find_port
        set port 4096
        while test $port -lt 5096
            if not lsof -i :$port >/dev/null 2>&1
                echo $port
                return 0
            end
            set port (math $port + 1)
        end
        echo 4096
    end
    
    set oc_port (__oc_find_port)
    set -x OPENCODE_PORT $oc_port
    
    if set -q TMUX
        # Already inside tmux - just run with port
        opencode --port $oc_port $argv
    else
        # Create tmux session and run opencode
        set oc_cmd "OPENCODE_PORT=$oc_port opencode --port $oc_port $argv; exec fish"
        if tmux has-session -t "$session_name" 2>/dev/null
            tmux new-window -t "$session_name" -c (pwd) "$oc_cmd"
            tmux attach-session -t "$session_name"
        else
            tmux new-session -s "$session_name" -c (pwd) "$oc_cmd"
        end
    end
    
    functions -e __oc_find_port
end
```

**Bash/Zsh equivalent**:

```bash
# ~/.bashrc or ~/.zshrc
oc() {
    local base_name=$(basename "$PWD")
    local path_hash=$(echo "$PWD" | md5sum | cut -c1-4)
    local session_name="${base_name}-${path_hash}"
    
    # Find available port
    local port=4096
    while [ $port -lt 5096 ]; do
        if ! lsof -i :$port >/dev/null 2>&1; then
            break
        fi
        port=$((port + 1))
    done
    
    export OPENCODE_PORT=$port
    
    if [ -n "$TMUX" ]; then
        opencode --port $port "$@"
    else
        local oc_cmd="OPENCODE_PORT=$port opencode --port $port $*; exec $SHELL"
        if tmux has-session -t "$session_name" 2>/dev/null; then
            tmux new-window -t "$session_name" -c "$PWD" "$oc_cmd"
            tmux attach-session -t "$session_name"
        else
            tmux new-session -s "$session_name" -c "$PWD" "$oc_cmd"
        fi
    fi
}
```

**How subagent panes work**:

1. Main OpenCode starts HTTP server on specified port (e.g., `http://localhost:4096`)
2. When a background agent spawns, Oh My OpenCode creates a new tmux pane
3. The pane runs: `opencode attach http://localhost:4096 --session <session-id>`
4. Each subagent pane shows real-time streaming output
5. Panes are automatically closed when the subagent completes

**Environment variables**:

| Variable | Description |
|----------|-------------|
| `OPENCODE_PORT` | Default port for the HTTP server (used if `--port` not specified) |

### Server Mode Reference

OpenCode's server mode exposes an HTTP API for programmatic interaction:

```bash
# Standalone server (no TUI)
opencode serve --port 4096

# TUI with server (recommended for tmux integration)
opencode --port 4096
```

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | `4096` | Port for HTTP server |
| `--hostname` | `127.0.0.1` | Hostname to listen on |

For more details, see the [OpenCode Server documentation](https://opencode.ai/docs/server/).

## Git Master

Configure git-master skill behavior:

```json
{
  "git_master": {
    "commit_footer": true,
    "include_co_authored_by": true
  }
}
```

| Option                   | Default | Description                                                                      |
| ------------------------ | ------- | -------------------------------------------------------------------------------- |
| `commit_footer`          | `true`  | Adds "Ultraworked with Sisyphus" footer to commit messages.                      |
| `include_co_authored_by` | `true`  | Adds `Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>` trailer to commits. |

## Sisyphus Agent

When enabled (default), Sisyphus provides a powerful orchestrator with optional specialized agents:

- **Sisyphus**: Primary orchestrator agent (Claude Opus 4.5)
- **OpenCode-Builder**: OpenCode's default build agent, renamed due to SDK limitations (disabled by default)
- **Prometheus (Planner)**: OpenCode's default plan agent with work-planner methodology (enabled by default)
- **Metis (Plan Consultant)**: Pre-planning analysis agent that identifies hidden requirements and AI failure points

**Configuration Options:**

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

**Example: Enable OpenCode-Builder:**

```json
{
  "sisyphus_agent": {
    "default_builder_enabled": true
  }
}
```

This enables OpenCode-Builder agent alongside Sisyphus. The default build agent is always demoted to subagent mode when Sisyphus is enabled.

**Example: Disable all Sisyphus orchestration:**

```json
{
  "sisyphus_agent": {
    "disabled": true
  }
}
```

You can also customize Sisyphus agents like other agents:

```json
{
  "agents": {
    "Sisyphus": {
      "model": "anthropic/claude-sonnet-4",
      "temperature": 0.3
    },
    "OpenCode-Builder": {
      "model": "anthropic/claude-opus-4"
    },
    "Prometheus (Planner)": {
      "model": "openai/gpt-5.2"
    },
    "Metis (Plan Consultant)": {
      "model": "anthropic/claude-sonnet-4-5"
    }
  }
}
```

| Option                    | Default | Description                                                                                                                            |
| ------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `disabled`                | `false` | When `true`, disables all Sisyphus orchestration and restores original build/plan as primary.                                          |
| `default_builder_enabled` | `false` | When `true`, enables OpenCode-Builder agent (same as OpenCode build, renamed due to SDK limitations). Disabled by default.             |
| `planner_enabled`         | `true`  | When `true`, enables Prometheus (Planner) agent with work-planner methodology. Enabled by default.                                     |
| `replace_plan`            | `true`  | When `true`, demotes default plan agent to subagent mode. Set to `false` to keep both Prometheus (Planner) and default plan available. |

## Background Tasks

Configure concurrency limits for background agent tasks. This controls how many parallel background agents can run simultaneously.

```json
{
  "background_task": {
    "defaultConcurrency": 5,
    "staleTimeoutMs": 180000,
    "providerConcurrency": {
      "anthropic": 3,
      "openai": 5,
      "google": 10
    },
    "modelConcurrency": {
      "anthropic/claude-opus-4-6": 2,
      "google/gemini-3-flash": 10
    }
  }
}
```

| Option                | Default | Description                                                                                                             |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `defaultConcurrency`  | -       | Default maximum concurrent background tasks for all providers/models                                                    |
| `staleTimeoutMs`      | `180000` | Stale timeout in milliseconds - interrupt tasks with no activity for this duration (minimum: 60000 = 1 minute)             |
| `providerConcurrency` | -       | Per-provider concurrency limits. Keys are provider names (e.g., `anthropic`, `openai`, `google`)                        |
| `modelConcurrency`    | -       | Per-model concurrency limits. Keys are full model names (e.g., `anthropic/claude-opus-4-6`). Overrides provider limits. |

**Priority Order**: `modelConcurrency` > `providerConcurrency` > `defaultConcurrency`

**Use Cases**:
- Limit expensive models (e.g., Opus) to prevent cost spikes
- Allow more concurrent tasks for fast/cheap models (e.g., Gemini Flash)
- Respect provider rate limits by setting provider-level caps

## Categories

Categories enable domain-specific task delegation via the `task` tool. Each category applies runtime presets (model, temperature, prompt additions) when calling the `Sisyphus-Junior` agent.

### Built-in Categories

All 7 categories come with optimal model defaults, but **you must configure them to use those defaults**:

| Category             | Built-in Default Model             | Description                                                          |
| -------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| `visual-engineering` | `google/gemini-3-pro-preview`      | Frontend, UI/UX, design, styling, animation                          |
| `ultrabrain`         | `openai/gpt-5.3-codex` (xhigh)     | Deep logical reasoning, complex architecture decisions               |
| `artistry`           | `google/gemini-3-pro-preview` (max)| Highly creative/artistic tasks, novel ideas                          |
| `quick`              | `anthropic/claude-haiku-4-5`       | Trivial tasks - single file changes, typo fixes, simple modifications|
| `unspecified-low`    | `anthropic/claude-sonnet-4-5`      | Tasks that don't fit other categories, low effort required           |
| `unspecified-high`   | `anthropic/claude-opus-4-6` (max)  | Tasks that don't fit other categories, high effort required          |
| `writing`            | `google/gemini-3-flash-preview`    | Documentation, prose, technical writing                              |

### ⚠️ Critical: Model Resolution Priority

**Categories DO NOT use their built-in defaults unless configured.** Model resolution follows this priority:

```
1. User-configured model (in oh-my-opencode.json)
2. Category's built-in default (if you add category to config)
3. System default model (from opencode.json)
```

**Example Problem:**

```json
// opencode.json
{ "model": "anthropic/claude-sonnet-4-5" }

// oh-my-opencode.json (empty categories section)
{}

// Result: ALL categories use claude-sonnet-4-5 (wasteful!)
// - quick tasks use Sonnet instead of Haiku (expensive)
// - ultrabrain uses Sonnet instead of GPT-5.2 (inferior reasoning)
// - visual tasks use Sonnet instead of Gemini (suboptimal for UI)
```

### Recommended Configuration

**To use optimal models for each category, add them to your config:**

```json
{
  "categories": {
    "visual-engineering": { 
      "model": "google/gemini-3-pro-preview"
    },
    "ultrabrain": { 
      "model": "openai/gpt-5.3-codex",
      "variant": "xhigh"
    },
    "artistry": { 
      "model": "google/gemini-3-pro-preview",
      "variant": "max"
    },
    "quick": { 
      "model": "anthropic/claude-haiku-4-5"  // Fast + cheap for trivial tasks
    },
    "unspecified-low": { 
      "model": "anthropic/claude-sonnet-4-5"
    },
    "unspecified-high": { 
      "model": "anthropic/claude-opus-4-6",
      "variant": "max"
    },
    "writing": { 
      "model": "google/gemini-3-flash-preview"
    }
  }
}
```

**Only configure categories you have access to.** Unconfigured categories fall back to your system default model.

### Usage

```javascript
// Via task tool
task(category="visual-engineering", prompt="Create a responsive dashboard component")
task(category="ultrabrain", prompt="Design the payment processing flow")

// Or target a specific agent directly (bypasses categories)
task(agent="oracle", prompt="Review this architecture")
```

### Custom Categories

Add your own categories or override built-in ones:

```json
{
  "categories": {
    "data-science": {
      "model": "anthropic/claude-sonnet-4-5",
      "temperature": 0.2,
      "prompt_append": "Focus on data analysis, ML pipelines, and statistical methods."
    },
    "visual-engineering": {
      "model": "google/gemini-3-pro-preview",
      "prompt_append": "Use shadcn/ui components and Tailwind CSS."
    }
  }
}
```

Each category supports: `model`, `temperature`, `top_p`, `maxTokens`, `thinking`, `reasoningEffort`, `textVerbosity`, `tools`, `prompt_append`, `variant`, `description`, `is_unstable_agent`.

### Additional Category Options

| Option             | Type    | Default | Description                                                                                         |
| ------------------ | ------- | ------- | --------------------------------------------------------------------------------------------------- |
| `description`       | string  | -       | Human-readable description of the category's purpose. Shown in task prompt.                     |
| `is_unstable_agent`| boolean | `false`  | Mark agent as unstable - forces background mode for monitoring. Auto-enabled for gemini models. |

## Model Resolution System

At runtime, Oh My OpenCode uses a 3-step resolution process to determine which model to use for each agent and category. This happens dynamically based on your configuration and available models.

### Overview

**Problem**: Users have different provider configurations. The system needs to select the best available model for each task at runtime.

**Solution**: A simple 3-step resolution flow:
1. **Step 1: User Override** — If you specify a model in `oh-my-opencode.json`, use exactly that
2. **Step 2: Provider Fallback** — Try each provider in the requirement's priority order until one is available
3. **Step 3: System Default** — Fall back to OpenCode's configured default model

### Resolution Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     MODEL RESOLUTION FLOW                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Step 1: USER OVERRIDE                                         │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ User specified model in oh-my-opencode.json?            │   │
│   │         YES → Use exactly as specified                  │   │
│   │         NO  → Continue to Step 2                        │   │
│   └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│   Step 2: PROVIDER PRIORITY FALLBACK                            │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ For each provider in requirement.providers order:       │   │
│   │                                                         │   │
│   │ Example for Sisyphus:                                   │   │
│   │ anthropic → github-copilot → opencode → antigravity     │   │
│   │     │            │              │            │          │   │
│   │     ▼            ▼              ▼            ▼          │   │
│   │ Try: anthropic/claude-opus-4-6                          │   │
│   │ Try: github-copilot/claude-opus-4-6                     │   │
│   │ Try: opencode/claude-opus-4-6                           │   │
│   │ ...                                                     │   │
│   │                                                         │   │
│   │ Found in available models? → Return matched model       │   │
│   │ Not found? → Try next provider                          │   │
│   └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼ (all providers exhausted)        │
│   Step 3: SYSTEM DEFAULT                                        │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ Return systemDefaultModel (from opencode.json)          │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Agent Provider Chains

Each agent has a defined provider priority chain. The system tries providers in order until it finds an available model:

| Agent | Model (no prefix) | Provider Priority Chain |
|-------|-------------------|-------------------------|
| **Sisyphus** | `claude-opus-4-6` | anthropic → kimi-for-coding → zai-coding-plan → openai → google |
| **oracle** | `gpt-5.2` | openai → google → anthropic |
| **librarian** | `glm-4.7` | zai-coding-plan → opencode → anthropic |
| **explore** | `claude-haiku-4-5` | anthropic → github-copilot → opencode |
| **multimodal-looker** | `gemini-3-flash` | google → openai → zai-coding-plan → kimi-for-coding → anthropic → opencode |
| **Prometheus (Planner)** | `claude-opus-4-6` | anthropic → kimi-for-coding → openai → google |
| **Metis (Plan Consultant)** | `claude-opus-4-6` | anthropic → kimi-for-coding → openai → google |
| **Momus (Plan Reviewer)** | `gpt-5.2` | openai → anthropic → google |
| **Atlas** | `claude-sonnet-4-5` | anthropic → kimi-for-coding → openai → google |

### Category Provider Chains

Categories follow the same resolution logic:

| Category | Model (no prefix) | Provider Priority Chain |
|----------|-------------------|-------------------------|
| **visual-engineering** | `gemini-3-pro` | google → anthropic → zai-coding-plan |
| **ultrabrain** | `gpt-5.3-codex` | openai → google → anthropic |
| **deep** | `gpt-5.3-codex` | openai → anthropic → google |
| **artistry** | `gemini-3-pro` | google → anthropic → openai |
| **quick** | `claude-haiku-4-5` | anthropic → google → opencode |
| **unspecified-low** | `claude-sonnet-4-5` | anthropic → openai → google |
| **unspecified-high** | `claude-opus-4-6` | anthropic → openai → google |
| **writing** | `gemini-3-flash` | google → anthropic → zai-coding-plan → openai |

### Checking Your Configuration

Use the `doctor` command to see how models resolve with your current configuration:

```bash
bunx oh-my-opencode doctor --verbose
```

The "Model Resolution" check shows:
- Each agent/category's model requirement
- Provider fallback chain
- User overrides (if configured)
- Effective resolution path

### Manual Override

Override any agent or category model in `oh-my-opencode.json`:

```json
{
  "agents": {
    "Sisyphus": {
      "model": "anthropic/claude-sonnet-4-5"
    },
    "oracle": {
      "model": "openai/o3"
    }
  },
  "categories": {
    "visual-engineering": {
      "model": "anthropic/claude-opus-4-6"
    }
  }
}
```

When you specify a model override, it takes precedence (Step 1) and the provider fallback chain is skipped entirely.

## Hooks

Disable specific built-in hooks via `disabled_hooks` in `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.json`:

```json
{
  "disabled_hooks": ["comment-checker", "agent-usage-reminder"]
}
```

Available hooks: `todo-continuation-enforcer`, `context-window-monitor`, `session-recovery`, `session-notification`, `comment-checker`, `grep-output-truncator`, `tool-output-truncator`, `directory-agents-injector`, `directory-readme-injector`, `empty-task-response-detector`, `think-mode`, `anthropic-context-window-limit-recovery`, `rules-injector`, `background-notification`, `auto-update-checker`, `startup-toast`, `keyword-detector`, `agent-usage-reminder`, `non-interactive-env`, `interactive-bash-session`, `compaction-context-injector`, `thinking-block-validator`, `claude-code-hooks`, `ralph-loop`, `preemptive-compaction`, `auto-slash-command`, `sisyphus-junior-notepad`, `start-work`

**Note on `directory-agents-injector`**: This hook is **automatically disabled** when running on OpenCode 1.1.37+ because OpenCode now has native support for dynamically resolving AGENTS.md files from subdirectories (PR #10678). This prevents duplicate AGENTS.md injection. For older OpenCode versions, the hook remains active to provide the same functionality.

**Note on `auto-update-checker` and `startup-toast`**: The `startup-toast` hook is a sub-feature of `auto-update-checker`. To disable only the startup toast notification while keeping update checking enabled, add `"startup-toast"` to `disabled_hooks`. To disable all update checking features (including the toast), add `"auto-update-checker"` to `disabled_hooks`.

## Disabled Commands

Disable specific built-in commands via `disabled_commands` in `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.json`:

```json
{
  "disabled_commands": ["init-deep", "start-work"]
}
```

Available commands: `init-deep`, `start-work`

## Comment Checker

Configure comment-checker hook behavior. The comment checker warns when excessive comments are added to code.

```json
{
  "comment_checker": {
    "custom_prompt": "Your custom warning message. Use {{comments}} placeholder for detected comments XML."
  }
}
```

| Option        | Default | Description                                                                |
| ------------- | ------- | -------------------------------------------------------------------------- |
| `custom_prompt` | -       | Custom warning message to replace the default. Use `{{comments}}` placeholder. |

## Notification

Configure notification behavior for background task completion.

```json
{
  "notification": {
    "force_enable": true
  }
}
```

| Option         | Default | Description                                                                                   |
| -------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `force_enable` | `false` | Force enable session-notification even if external notification plugins are detected. Default: `false`. |

## Sisyphus Tasks

Configure Sisyphus Tasks system for advanced task management.

```json
{
  "sisyphus": {
    "tasks": {
      "enabled": false,
      "storage_path": ".sisyphus/tasks",
      "claude_code_compat": false
    }
  }
}
```

### Tasks Configuration

| Option               | Default            | Description                                                               |
| -------------------- | ------------------ | ------------------------------------------------------------------------- |
| `enabled`            | `false`            | Enable Sisyphus Tasks system                                               |
| `storage_path`       | `.sisyphus/tasks`  | Storage path for tasks (relative to project root)                           |
| `claude_code_compat` | `false`            | Enable Claude Code path compatibility mode                                   |

## MCPs

Exa, Context7 and grep.app MCP enabled by default.

- **websearch**: Real-time web search powered by [Exa AI](https://exa.ai) - searches the web and returns relevant content
- **context7**: Fetches up-to-date official documentation for libraries
- **grep_app**: Ultra-fast code search across millions of public GitHub repositories via [grep.app](https://grep.app)

Don't want them? Disable via `disabled_mcps` in `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.json`:

```json
{
  "disabled_mcps": ["websearch", "context7", "grep_app"]
}
```

## LSP

OpenCode provides LSP tools for analysis.
Oh My OpenCode adds refactoring tools (rename, code actions).
All OpenCode LSP configs and custom settings (from `opencode.jsonc` / `opencode.json`) are supported, plus additional Oh My OpenCode-specific settings.
For config discovery, `.jsonc` takes precedence over `.json` when both exist (applies to both `opencode.*` and `oh-my-opencode.*`).

Add LSP servers via the `lsp` option in `~/.config/opencode/oh-my-opencode.jsonc` / `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.jsonc` / `.opencode/oh-my-opencode.json`:

```json
{
  "lsp": {
    "typescript-language-server": {
      "command": ["typescript-language-server", "--stdio"],
      "extensions": [".ts", ".tsx"],
      "priority": 10
    },
    "pylsp": {
      "disabled": true
    }
  }
}
```

Each server supports: `command`, `extensions`, `priority`, `env`, `initialization`, `disabled`.

| Option         | Type     | Default | Description                                                            |
| -------------- | -------- | ------- | ---------------------------------------------------------------------- |
| `command`       | array    | -       | Command to start the LSP server (executable + args)                          |
| `extensions`    | array    | -       | File extensions this server handles (e.g., `[".ts", ".tsx"]`)               |
| `priority`      | number   | -       | Server priority when multiple servers match a file                               |
| `env`           | object   | -       | Environment variables for the LSP server (key-value pairs)                     |
| `initialization`| object   | -       | Custom initialization options passed to the LSP server                        |
| `disabled`      | boolean  | `false`  | Whether to disable this LSP server                                         |

**Example with advanced options:**

```json
{
  "lsp": {
    "typescript-language-server": {
      "command": ["typescript-language-server", "--stdio"],
      "extensions": [".ts", ".tsx"],
      "priority": 10,
      "env": {
        "NODE_OPTIONS": "--max-old-space-size=4096"
      },
      "initialization": {
        "preferences": {
          "includeInlayParameterNameHints": "all",
          "includeInlayFunctionParameterTypeHints": true
        }
      }
    }
  }
}
```

## Experimental

Opt-in experimental features that may change or be removed in future versions. Use with caution.

```json
{
  "experimental": {
    "truncate_all_tool_outputs": true,
    "aggressive_truncation": true,
    "auto_resume": true,
    "dynamic_context_pruning": {
      "enabled": false,
      "notification": "detailed",
      "turn_protection": {
        "enabled": true,
        "turns": 3
      },
      "protected_tools": ["task", "todowrite", "lsp_rename"],
      "strategies": {
        "deduplication": {
          "enabled": true
        },
        "supersede_writes": {
          "enabled": true,
          "aggressive": false
        },
        "purge_errors": {
          "enabled": true,
          "turns": 5
        }
      }
    }
  }
}
```

| Option                      | Default | Description                                                                                                                                                                                   |
| --------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `truncate_all_tool_outputs` | `false` | Truncates ALL tool outputs instead of just whitelisted tools (Grep, Glob, LSP, AST-grep). Tool output truncator is enabled by default - disable via `disabled_hooks`.                         |
| `aggressive_truncation`     | `false` | When token limit is exceeded, aggressively truncates tool outputs to fit within limits. More aggressive than the default truncation behavior. Falls back to summarize/revert if insufficient. |
| `auto_resume`               | `false` | Automatically resumes session after successful recovery from thinking block errors or thinking disabled violations. Extracts last user message and continues.                             |
| `dynamic_context_pruning`    | See below | Dynamic context pruning configuration for managing context window usage automatically. See [Dynamic Context Pruning](#dynamic-context-pruning) below.                              |

### Dynamic Context Pruning

Dynamic context pruning automatically manages context window by intelligently pruning old tool outputs. This feature helps maintain performance in long sessions.

```json
{
  "experimental": {
    "dynamic_context_pruning": {
      "enabled": false,
      "notification": "detailed",
      "turn_protection": {
        "enabled": true,
        "turns": 3
      },
      "protected_tools": ["task", "todowrite", "todoread", "lsp_rename", "session_read", "session_write", "session_search"],
      "strategies": {
        "deduplication": {
          "enabled": true
        },
        "supersede_writes": {
          "enabled": true,
          "aggressive": false
        },
        "purge_errors": {
          "enabled": true,
          "turns": 5
        }
      }
    }
  }
}
```

| Option            | Default | Description                                                                               |
| ----------------- | ------- | ----------------------------------------------------------------------------------------- |
| `enabled`         | `false`  | Enable dynamic context pruning                                                               |
| `notification`     | `detailed` | Notification level: `off`, `minimal`, or `detailed`                                        |
| `turn_protection` | See below | Turn protection settings - prevent pruning recent tool outputs                                 |

#### Turn Protection

| Option    | Default | Description                                                  |
| --------- | ------- | ------------------------------------------------------------ |
| `enabled` | `true`  | Enable turn protection                                         |
| `turns`   | `3`     | Number of recent turns to protect from pruning (1-10)           |

#### Protected Tools

Tools that should never be pruned (default):

```json
["task", "todowrite", "todoread", "lsp_rename", "session_read", "session_write", "session_search"]
```

#### Pruning Strategies

| Strategy            | Option       | Default | Description                                                                  |
| ------------------- | ------------ | ------- | ---------------------------------------------------------------------------- |
| **deduplication**   | `enabled`    | `true`  | Remove duplicate tool calls (same tool + same args)                              |
| **supersede_writes**| `enabled`    | `true`  | Prune write inputs when file subsequently read                                   |
|                     | `aggressive` | `false` | Aggressive mode: prune any write if ANY subsequent read                         |
| **purge_errors**   | `enabled`    | `true`  | Prune errored tool inputs after N turns                                        |
|                     | `turns`      | `5`     | Number of turns before pruning errors (1-20)                                    |

**Warning**: These features are experimental and may cause unexpected behavior. Enable only if you understand the implications.

## Environment Variables

| Variable              | Description                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENCODE_CONFIG_DIR` | Override the OpenCode configuration directory. Useful for profile isolation with tools like [OCX](https://github.com/kdcokenny/ocx) ghost mode. |
