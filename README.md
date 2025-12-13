English | [한국어](README.ko.md)

## Contents

- [Oh My OpenCode](#oh-my-opencode)
  - [TL;DR](#tldr)
  - [Installation](#installation)
  - [For LLM Agents](#for-llm-agents)
  - [Why OpenCode & Why Oh My OpenCode](#why-opencode--why-oh-my-opencode)
  - [Features](#features)
    - [Agents](#agents)
    - [Tools](#tools)
      - [Built-in LSP Tools](#built-in-lsp-tools)
      - [Built-in AST-Grep Tools](#built-in-ast-grep-tools)
      - [Grep](#grep)
      - [Built-in MCPs](#built-in-mcps)
      - [Background Task](#background-task)
    - [Hooks](#hooks)
    - [Claude Code Compatibility](#claude-code-compatibility)
    - [Other Features](#other-features)
  - [Configuration](#configuration)
  - [Author's Note](#authors-note)
  - [Warnings](#warnings)

# Oh My OpenCode

Oh My OpenCode

oMoMoMoMoMo···

If you work in tech, you likely appreciated [Claude Code](https://www.claude.com/product/claude-code).
If you are a hacker, you will fucking fall in love with [OpenCode](https://github.com/sst/opencode).

Do you remember the first time you switched from Windows to Linux? The excitement of configuring everything just the way you wanted?
In an era where that romance feels lost, OpenCode will be that project for you.
If you love coding and computers, OpenCode will feel exactly like that moment you first touched Linux after years of Windows.
Even if you don't, invest a little time. Boost your skills and productivity by multipliers.

## TL;DR

- **Model Setup Required**
  - This plugin utilizes models from [OpenCode Zen](https://opencode.ai/docs/zen/), Google, OpenAI, and Anthropic.
    - For Anthropic models, use [OpenCode's built-in Claude Code Max Plan login](https://opencode.ai/docs/providers/#anthropic).
    - For OpenAI models (ChatGPT Plus/Pro), install the [OpenCode-OpenAI-Codex-Auth plugin](https://github.com/numman-ali/opencode-openai-codex-auth).
    - For Google Gemini models, enable `google_auth: true` in `oh-my-opencode.json` for **built-in Antigravity OAuth**.
    - For other providers, [VibeProxy (macOS Only)](https://github.com/automazeio/vibeproxy) or [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) remain available as alternatives.
- **Truth be told, the rest is optional. Just install it. Once set up, no further learning is required. It simply evolves.**
- **Paste this document into Claude Code, OpenCode, or Cursor, instruct it to install, and ask for assistance if needed. It just installs.**
  - If you are an LLM Agent, install the required plugins and dependencies, then run `opencode auth login` via tmux to assist the user with configuration.

## Installation

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "oh-my-opencode"
  ]
}
```

## For LLM Agents

<details>
<summary>For LLM Agents (Click to expand)</summary>

If you are an LLM Agent helping a user set up oh-my-opencode, follow these steps:

### Step 1: Verify OpenCode Installation

```bash
if command -v opencode &> /dev/null; then
    echo "OpenCode $(opencode --version) is installed"
else
    echo "OpenCode is not installed. Please install it first."
    echo "See: https://opencode.ai/docs"
fi
```

If OpenCode is not installed, guide the user to [OpenCode Installation Guide](https://opencode.ai/docs).

### Step 2: Configure oh-my-opencode Plugin

```bash
mkdir -p ~/.config/opencode

if [ -f ~/.config/opencode/opencode.json ]; then
    # Existing config: add plugin using jq or python
    if command -v jq &> /dev/null; then
        jq '.plugin = ((.plugin // []) + ["oh-my-opencode"] | unique)' \
            ~/.config/opencode/opencode.json > /tmp/oc.json && \
            mv /tmp/oc.json ~/.config/opencode/opencode.json
    else
        echo "Add \"oh-my-opencode\" to plugin array in ~/.config/opencode/opencode.json"
    fi
else
    # New config
    echo '{"plugin":["oh-my-opencode"]}' > ~/.config/opencode/opencode.json
fi
```

### Step 3: Verify Setup

```bash
opencode --version  # Should be >= 1.0.132
cat ~/.config/opencode/opencode.json  # Should contain "oh-my-opencode" in plugin array
```

### Step 4: Configure Authentication

Once `oh-my-opencode` is added to the plugin list, use `tmux` to assist the user with authentication setup.

#### 4.1 Anthropic (Claude)

```bash
opencode auth login
# Select Provider: Anthropic
# Select Login method: Claude Pro/Max
# Complete OAuth flow in browser
```

#### 4.2 Google Gemini (Built-in Antigravity OAuth)

First, enable Google auth in `~/.config/opencode/oh-my-opencode.json` (or `.opencode/oh-my-opencode.json` for project-level):

```json
{
  "google_auth": true
}
```

Then authenticate:

```bash
opencode auth login
# Select Provider: Google
# Select Login method: OAuth with Google (Antigravity)
# Complete OAuth flow in browser
```

#### 4.3 OpenAI (ChatGPT Plus/Pro)

First, add the opencode-openai-codex-auth plugin:

```json
{
  "plugin": [
    "oh-my-opencode",
    "opencode-openai-codex-auth@4.1.0"
  ]
}
```

**Important**: You must also configure the full model settings in your `opencode.json`. Copy the provider/models configuration from [`config/full-opencode.json`](https://github.com/numman-ali/opencode-openai-codex-auth/blob/main/config/full-opencode.json). See the [opencode-openai-codex-auth documentation](https://github.com/numman-ali/opencode-openai-codex-auth) for detailed setup instructions.

Then authenticate:

```bash
opencode auth login
# Select Provider: OpenAI
# Select Login method: ChatGPT Plus/Pro (Codex Subscription)
# Complete OAuth flow in browser
```

#### 4.4 Alternative: Proxy-based Authentication

For users who prefer proxy-based authentication, [VibeProxy](https://github.com/automazeio/vibeproxy) (macOS) or [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) remain available as alternatives.

### ⚠️ Warning

**Do NOT create or modify the `oh-my-opencode.json` configuration file unless the user explicitly requests it.**

The plugin works perfectly with default settings without any configuration file. The configuration file is only needed when the user wants customization.

</details>

## Why OpenCode & Why Oh My OpenCode

OpenCode is limitlessly extensible and customizable. Zero screen flicker.
[LSP](https://opencode.ai/docs/lsp/), [linters, formatters](https://opencode.ai/docs/formatters/)? Automatic and fully configurable.
You can mix and orchestrate models to your exact specifications.
It is feature-rich. It is elegant. It handles the terminal without hesitation. It is high-performance.

But here is the catch: the learning curve is steep. There is a lot to master. And your time is expensive.

Inspired by [AmpCode](https://ampcode.com) and [Claude Code](https://code.claude.com/docs/en/overview), I have implemented their features here—often with superior execution.
Because this is OpenCode.

Consider this a superior AmpCode, a superior Claude Code, or simply a specialized distribution.

I believe in the right tool for the job. For your wallet's sake, use CLIProxyAPI or VibeProxy. Employ the best LLMs from frontier labs. You are in command.

**Note**: This setup is highly opinionated. It represents the generic component of my personal configuration, so it evolves constantly. I have spent tokens worth $20,000 just for my personal programming usages, and this plugin represents the apex of that experience. You simply inherit the best. If you have superior ideas, PRs are welcome.

## Features

### Agents
- **oracle** (`openai/gpt-5.2`): The architect. Expert in code reviews and strategy. Uses GPT-5.2 for its unmatched logic and reasoning capabilities. Inspired by AmpCode.
- **librarian** (`anthropic/claude-haiku-4-5`): Multi-repo analysis, documentation lookup, and implementation examples. Haiku is chosen for its speed, competence, excellent tool usage, and cost-efficiency. Inspired by AmpCode.
- **explore** (`opencode/grok-code`): Fast exploration and pattern matching. Claude Code uses Haiku; we use Grok. It is currently free, blazing fast, and intelligent enough for file traversal. Inspired by Claude Code.
- **frontend-ui-ux-engineer** (`google/gemini-3-pro-preview`): A designer turned developer. Creates stunning UIs. Uses Gemini because its creativity and UI code generation are superior.
- **document-writer** (`google/gemini-3-pro-preview`): A technical writing expert. Gemini is a wordsmith; it writes prose that flows naturally.

Each agent is automatically invoked by the main agent, but you can also explicitly request them:

```
@oracle Please think through the design of this part and suggest an architecture.
@librarian Tell me how this is implemented — why does the behavior keep changing internally?
@explore Tell me about the policy for this feature.
```

Agent models, prompts, and permissions can be customized via `oh-my-opencode.json`. See [Configuration](#configuration) for details.

#### Subagent Orchestration (omo_task)

The `omo_task` tool allows agents (like `oracle`, `frontend-ui-ux-engineer`) to spawn `explore` or `librarian` as subagents to delegate specific tasks. This enables powerful workflows where an agent can "ask" another specialized agent to gather information before proceeding.

> **Note**: To prevent infinite recursion, `explore` and `librarian` agents cannot use the `omo_task` tool themselves.

### Tools

#### Built-in LSP Tools

The features you use in your editor—other agents cannot access them. Oh My OpenCode hands those very tools to your LLM Agent. Refactoring, navigation, and analysis are all supported using the same OpenCode configuration.

[OpenCode provides LSP](https://opencode.ai/docs/lsp/), but only for analysis. Oh My OpenCode equips you with navigation and refactoring tools matching the same specification.

- **lsp_hover**: Get type info, docs, signatures at position
- **lsp_goto_definition**: Jump to symbol definition
- **lsp_find_references**: Find all usages across workspace
- **lsp_document_symbols**: Get file's symbol outline
- **lsp_workspace_symbols**: Search symbols by name across project
- **lsp_diagnostics**: Get errors/warnings before build
- **lsp_servers**: List available LSP servers
- **lsp_prepare_rename**: Validate rename operation
- **lsp_rename**: Rename symbol across workspace
- **lsp_code_actions**: Get available quick fixes/refactorings
- **lsp_code_action_resolve**: Apply a code action

#### Built-in AST-Grep Tools

- **ast_grep_search**: AST-aware code pattern search (25 languages)
- **ast_grep_replace**: AST-aware code replacement

#### Grep

- **grep**: Content search with safety limits (5min timeout, 10MB output). Overrides OpenCode's built-in `grep` tool.
  - The default `grep` lacks safeguards. On a large codebase, a broad pattern can cause CPU overload and indefinite hanging.
  - This tool enforces strict limits and completely replaces the built-in `grep`.

#### Glob

- **glob**: File pattern matching with timeout protection (60s). Overrides OpenCode's built-in `glob` tool.
  - The default `glob` lacks timeout. If ripgrep hangs, it waits indefinitely.
  - This tool enforces timeouts and kills the process on expiration.

#### Built-in MCPs

- **websearch_exa**: Exa AI web search. Performs real-time web searches and can scrape content from specific URLs. Returns LLM-optimized context from relevant websites.
- **context7**: Library documentation lookup. Fetches up-to-date documentation for any library to assist with accurate coding.

Don't need these? Disable them via `oh-my-opencode.json`:

```json
{
  "disabled_mcps": ["websearch_exa"]
}
```

#### Background Task

Run long-running or complex tasks in the background without blocking your main session. The system automatically notifies you when tasks complete.

- **background_task**: Launch a background agent task. Specify description, prompt, and agent type. Returns immediately with a task ID.
- **background_output**: Check task progress (`block=false`) or wait for results (`block=true`). Supports custom timeout up to 10 minutes.
- **background_cancel**: Cancel a running background task by task ID.

Key capabilities:
- **Async Execution**: Offload complex analysis or research while you continue working
- **Auto Notification**: System notifies the main session when background tasks complete
- **Status Tracking**: Real-time progress with tool call counts and last tool used
- **Session Isolation**: Each task runs in an independent session

Example workflow:
```
1. Launch: background_task → returns task_id="bg_abc123"
2. Continue working on other tasks
3. System notification: "Task bg_abc123 completed"
4. Retrieve: background_output(task_id="bg_abc123") → get full results
```

### Hooks

- **Todo Continuation Enforcer**: Forces the agent to complete all tasks before exiting. Eliminates the common LLM issue of "giving up halfway".
- **Context Window Monitor**: Implements [Context Window Anxiety Management](https://agentic-patterns.com/patterns/context-window-anxiety-management/). When context usage exceeds 70%, it reminds the agent that resources are sufficient, preventing rushed or low-quality output.
- **Session Notification**: Sends a native OS notification when the job is done (macOS, Linux, Windows).
- **Session Recovery**: Automatically recovers from API errors, ensuring session stability. Handles four scenarios:
  - **Tool Result Missing**: When `tool_use` block exists without `tool_result` (ESC interrupt) → injects "cancelled" tool results
  - **Thinking Block Order**: When thinking block must be first but isn't → prepends empty thinking block
  - **Thinking Disabled Violation**: When thinking blocks exist but thinking is disabled → strips thinking blocks
  - **Empty Content Message**: When message has only thinking/meta blocks without actual content → injects "(interrupted)" text via filesystem
- **Comment Checker**: Detects and reports unnecessary comments after code modifications. Smartly ignores valid patterns (BDD, directives, docstrings, shebangs) to keep the codebase clean from AI-generated artifacts.
- **Directory AGENTS.md Injector**: Automatically injects `AGENTS.md` contents when reading files. Searches upward from the file's directory to project root, collecting **all** `AGENTS.md` files along the path hierarchy. This enables nested, directory-specific instructions:
  ```
  project/
  ├── AGENTS.md              # Project-wide context
  ├── src/
  │   ├── AGENTS.md          # src-specific context
  │   └── components/
  │       ├── AGENTS.md      # Component-specific context
  │       └── Button.tsx     # Reading this injects ALL 3 AGENTS.md files
  ```
  When reading `Button.tsx`, the hook injects contexts in order: `project/AGENTS.md` → `src/AGENTS.md` → `components/AGENTS.md`. Each directory's context is injected only once per session. Inspired by Claude Code's CLAUDE.md feature.
- **Directory README.md Injector**: Automatically injects `README.md` contents when reading files. Works identically to the AGENTS.md Injector, searching upward from the file's directory to project root. Provides project documentation context to the LLM agent. Each directory's README is injected only once per session.
- **Rules Injector**: Automatically injects rules from `.claude/rules/` directory when reading files.
  - Searches upward from the file's directory to project root, plus `~/.claude/rules/` (user).
  - Supports `.md` and `.mdc` files.
  - Frontmatter-based matching with `globs` field (glob patterns).
  - `alwaysApply: true` option for rules that should always apply.
  - Example rule file structure:
    ```markdown
    ---
    globs: ["*.ts", "src/**/*.js"]
    description: "TypeScript/JavaScript coding rules"
    ---
    - Use PascalCase for interface names
    - Use camelCase for function names
    ```
- **Think Mode**: Automatic extended thinking detection and mode switching. Detects when user requests deep thinking (e.g., "think deeply", "ultrathink") and dynamically adjusts model settings for enhanced reasoning.
- **Anthropic Auto Compact**: Automatically compacts conversation history when approaching context limits for Anthropic models.
- **Empty Task Response Detector**: Detects when subagent tasks return empty or meaningless responses and handles gracefully.
- **Grep Output Truncator**: Prevents grep output from overwhelming the context by truncating excessively long results.

You can disable specific built-in hooks using `disabled_hooks` in `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.json`:

```json
{
  "disabled_hooks": ["session-notification", "comment-checker"]
}
```

Available hooks: `todo-continuation-enforcer`, `context-window-monitor`, `session-recovery`, `session-notification`, `comment-checker`, `grep-output-truncator`, `directory-agents-injector`, `directory-readme-injector`, `empty-task-response-detector`, `think-mode`, `anthropic-auto-compact`, `rules-injector`, `background-notification`, `auto-update-checker`

> **Note**: `disabled_hooks` controls Oh My OpenCode's built-in hooks. To disable Claude Code's `settings.json` hooks, use `claude_code.hooks: false` instead (see [Compatibility Toggles](#compatibility-toggles)).

### Claude Code Compatibility

Oh My OpenCode provides seamless Claude Code configuration compatibility. If you've been using Claude Code, your existing setup works out of the box.

#### Compatibility Toggles

If you want to disable specific Claude Code compatibility features, use the `claude_code` configuration object:

```json
{
  "claude_code": {
    "mcp": false,
    "commands": false,
    "skills": false,
    "agents": false,
    "hooks": false
  }
}
```

| Toggle | When `false`, disables loading from... | NOT affected |
|--------|----------------------------------------|--------------|
| `mcp` | `~/.claude/.mcp.json`, `./.mcp.json`, `./.claude/.mcp.json` | Built-in MCPs (context7, websearch_exa) |
| `commands` | `~/.claude/commands/*.md`, `./.claude/commands/*.md` | `~/.config/opencode/command/`, `./.opencode/command/` |
| `skills` | `~/.claude/skills/*/SKILL.md`, `./.claude/skills/*/SKILL.md` | - |
| `agents` | `~/.claude/agents/*.md`, `./.claude/agents/*.md` | Built-in agents (oracle, librarian, etc.) |
| `hooks` | `~/.claude/settings.json`, `./.claude/settings.json`, `./.claude/settings.local.json` | - |

All toggles default to `true` (enabled). Omit the entire `claude_code` object for full Claude Code compatibility.

#### Hooks Integration

Execute custom scripts via Claude Code's `settings.json` hook system. Oh My OpenCode reads and executes hooks defined in:

- `~/.claude/settings.json` (user)
- `./.claude/settings.json` (project)
- `./.claude/settings.local.json` (local, git-ignored)

Supported hook events:
- **PreToolUse**: Runs before tool execution. Can block or modify tool input.
- **PostToolUse**: Runs after tool execution. Can add warnings or context.
- **UserPromptSubmit**: Runs when user submits a prompt. Can block or inject messages.
- **Stop**: Runs when session goes idle. Can inject follow-up prompts.

Example `settings.json`:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{ "type": "command", "command": "eslint --fix $FILE" }]
      }
    ]
  }
}
```

#### Configuration Loaders

**Command Loader**: Loads markdown-based slash commands from 4 directories:
- `~/.claude/commands/` (user)
- `./.claude/commands/` (project)
- `~/.config/opencode/command/` (opencode global)
- `./.opencode/command/` (opencode project)

**Skill Loader**: Loads directory-based skills with `SKILL.md`:
- `~/.claude/skills/` (user)
- `./.claude/skills/` (project)

**Agent Loader**: Loads custom agent definitions from markdown files:
- `~/.claude/agents/*.md` (user)
- `./.claude/agents/*.md` (project)

**MCP Loader**: Loads MCP server configurations from `.mcp.json` files:
- `~/.claude/.mcp.json` (user)
- `./.mcp.json` (project)
- `./.claude/.mcp.json` (local)
- Supports environment variable expansion (`${VAR}` syntax)

#### Data Storage

**Todo Management**: Session todos are stored in Claude Code compatible format at `~/.claude/todos/`.

**Transcript**: Session activity is logged to `~/.claude/transcripts/` in JSONL format, enabling replay and analysis.

> **Note on `claude-code-*` naming**: Features under `src/features/claude-code-*/` are migrated from Claude Code's configuration system. This naming convention clearly identifies which features originated from Claude Code.

### Other Features

- **Terminal Title**: Auto-updates terminal title with session status (idle ○, processing ◐, tool ⚡, error ✖). Supports tmux.
- **Session State**: Centralized session tracking module used by event hooks and terminal title updates.

## Configuration

Configuration file locations (in priority order):
1. `.opencode/oh-my-opencode.json` (project)
2. `~/.config/opencode/oh-my-opencode.json` (user)

Schema autocomplete is supported:

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json"
}
```

### Google Auth

Enable built-in Antigravity OAuth for Google Gemini models:

```json
{
  "google_auth": true
}
```

When enabled, `opencode auth login` will show "OAuth with Google (Antigravity)" as a login option for the Google provider.

### Agents

Override built-in agent settings:

```json
{
  "agents": {
    "explore": {
      "model": "anthropic/claude-haiku-4-5",
      "temperature": 0.5
    },
    "frontend-ui-ux-engineer": {
      "disable": true
    }
  }
}
```

Each agent supports: `model`, `temperature`, `top_p`, `prompt`, `tools`, `disable`, `description`, `mode`, `color`, `permission`.

Or you can disable them using `disabled_agents` in `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.json`:

```json
{
  "disabled_agents": ["oracle", "frontend-ui-ux-engineer"]
}
```

Available agents: `oracle`, `librarian`, `explore`, `frontend-ui-ux-engineer`, `document-writer`

### MCPs

By default, Context7 and Exa MCP are supported.

If you don't want these, you can disable them using `disabled_mcps` in `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.json`:

```json
{
  "disabled_mcps": ["context7", "websearch_exa"]
}
```

### LSP

OpenCode provides LSP tools for analysis.
Oh My OpenCode provides LSP tools for refactoring (rename, code actions).
It supports all LSP configurations and custom settings supported by OpenCode (those configured in opencode.json), and you can also configure additional settings specifically for Oh My OpenCode as shown below.

You can configure additional LSP servers via the `lsp` option in `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.json`:

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

## Author's Note

Install Oh My OpenCode. Do not waste time configuring OpenCode from scratch.
I have resolved the friction so you don't have to. The answers are in this plugin. If OpenCode is Arch Linux, Oh My OpenCode is [Omarchy](https://omarchy.org/).

Enjoy the multi-model stability and rich feature set that other harnesses promise but fail to deliver.
I will continue testing and updating here. I am the primary user of this project.

- Who possesses the best raw logic?
- Who is the debugging god?
- Who writes the best prose?
- Who dominates frontend?
- Who owns backend?
- Which model is fastest for daily driving?
- What new features are other harnesses shipping?

Do not overthink it. I have done the thinking. I will integrate the best practices. I will update this.
If this sounds arrogant and you have a superior solution, send a PR. You are welcome.

As of now, I have no affiliation with any of the projects or models mentioned here. This plugin is purely based on personal experimentation and preference.

I constructed 99% of this project using OpenCode. I focused on functional verification, and honestly, I don't know how to write proper TypeScript. **But I personally reviewed and comprehensively rewritten this documentation, so you can rely on it with confidence.**
## Warnings

- If you are on [1.0.132](https://github.com/sst/opencode/releases/tag/v1.0.132) or lower, OpenCode has a bug that might break config.
  - [The fix](https://github.com/sst/opencode/pull/5040) was merged after 1.0.132, so use a newer version.
