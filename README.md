<div align="center">

<!-- HERO SECTION -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./.github/assets/hero.jpg">
  <source media="(prefers-color-scheme: light)" srcset="./.github/assets/hero.jpg">
  <img alt="Oh My OpenCode" src="./.github/assets/hero.jpg" width="100%">
</picture>

<br />

# Oh My OpenCode

### The Ultimate OpenCode Enhancement Suite

**Transform your AI coding workflow with production-tested multi-model orchestration, specialized agents, and battle-hardened reliability.**

<br />

[![GitHub Release](https://img.shields.io/github/v/release/code-yeongyu/oh-my-opencode?style=for-the-badge&logo=github&logoColor=white&labelColor=1a1a2e&color=16a34a)](https://github.com/code-yeongyu/oh-my-opencode/releases)
[![npm Downloads](https://img.shields.io/npm/dt/oh-my-opencode?style=for-the-badge&logo=npm&logoColor=white&labelColor=1a1a2e&color=ef4444)](https://www.npmjs.com/package/oh-my-opencode)
[![License](https://img.shields.io/badge/license-SUL--1.0-0ea5e9?style=for-the-badge&labelColor=1a1a2e)](https://github.com/code-yeongyu/oh-my-opencode/blob/master/LICENSE.md)

[![GitHub Stars](https://img.shields.io/github/stars/code-yeongyu/oh-my-opencode?style=flat-square&logo=github&labelColor=1a1a2e&color=fbbf24)](https://github.com/code-yeongyu/oh-my-opencode/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/code-yeongyu/oh-my-opencode?style=flat-square&logo=github&labelColor=1a1a2e&color=60a5fa)](https://github.com/code-yeongyu/oh-my-opencode/network/members)
[![Contributors](https://img.shields.io/github/contributors/code-yeongyu/oh-my-opencode?style=flat-square&logo=github&labelColor=1a1a2e&color=a78bfa)](https://github.com/code-yeongyu/oh-my-opencode/graphs/contributors)
[![Issues](https://img.shields.io/github/issues/code-yeongyu/oh-my-opencode?style=flat-square&logo=github&labelColor=1a1a2e&color=f472b6)](https://github.com/code-yeongyu/oh-my-opencode/issues)

<br />

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-cn.md)

<br />

[![Preview](./.github/assets/omo.png)](https://github.com/code-yeongyu/oh-my-opencode#oh-my-opencode)

</div>

---

<div align="center">

> *"I aim to spark a software revolution by creating a world where agent-generated code is indistinguishable from human code, yet capable of achieving vastly more."*

</div>

---

## 🚀 Quick Start

```bash
bunx oh-my-opencode install
```

That's it. Follow the interactive prompts to configure your AI providers.

**Works with your existing subscriptions**: ChatGPT Plus/Pro, Claude Pro/Max, and Google Gemini.

---

## ✨ Why Oh My OpenCode?

<table>
<tr>
<td width="50%">

### 🎯 Production-Tested Excellence
Built on **$24,000+ of token expenditure** across every major AI tool. The hard-won lessons are baked into every feature.

### 🔧 Zero Configuration Required
Batteries included. Works out of the box with sensible defaults while remaining fully customizable.

### ⚡ True Multi-Model Orchestration
Run Claude, GPT, and Gemini in parallel—each model doing what it does best.

</td>
<td width="50%">

### 🛠 Developer-First Tooling
Full LSP/AST-grep support gives your AI agents the same power tools you use in your IDE.

### 🔄 Claude Code Compatible
Drop-in compatibility layer. Your existing Claude Code configs, hooks, and commands just work.

### 🏃 Never Stops Mid-Task
Built-in persistence ensures your agents complete what they start.

</td>
</tr>
</table>

---

## 💬 What Developers Are Saying

> *"If Claude Code does in 7 days what a human does in 3 months, Sisyphus does it in 1 hour. It just works until the task is done."*
> — **B**, Quant Researcher

> *"Knocked out 8,000 ESLint warnings with Oh My OpenCode, just in a day."*
> — [**Jacob Ferrari**](https://x.com/jacobferrari_/status/2003258761952289061)

> *"You guys should pull this into core and recruit him. Seriously. It's really, really, really good."*
> — **Henning Kilset**

> *"Oh My OpenCode is king of the hill and has no contenders."*
> — [**RyanOnThePath**](https://x.com/RyanOnThePath/status/2001438321252118548)

> *"Use oh-my-opencode, you will never go back."*
> — [**d0t3ch**](https://x.com/d0t3ch/status/2001685618200580503)

---

## 📑 Table of Contents

- [Quick Start](#-quick-start)
- [Why Oh My OpenCode?](#-why-oh-my-opencode)
- [Core Concepts](#-core-concepts)
  - [Meet Sisyphus](#-meet-sisyphus)
- [Features](#-features)
  - [Specialized AI Agents](#-specialized-ai-agents)
  - [Background Agent Orchestration](#-background-agent-orchestration)
  - [Developer Power Tools](#-developer-power-tools)
  - [Intelligent Context Management](#-intelligent-context-management)
  - [Built-in MCP Integrations](#-built-in-mcp-integrations)
  - [Claude Code Compatibility Layer](#-claude-code-compatibility-layer)
  - [Productivity Enhancements](#-productivity-enhancements)
- [Installation](#-installation)
  - [Interactive Installation](#interactive-installation)
  - [Agent-Assisted Installation](#agent-assisted-installation)
  - [Manual Installation for LLM Agents](#manual-installation-for-llm-agents)
- [Configuration](#%EF%B8%8F-configuration)
  - [Configuration Files](#configuration-files)
  - [Provider Authentication](#provider-authentication)
  - [Agent Customization](#agent-customization)
  - [Sisyphus Configuration](#sisyphus-configuration)
  - [Hooks Configuration](#hooks-configuration)
  - [MCP Configuration](#mcp-configuration)
  - [LSP Configuration](#lsp-configuration)
  - [Experimental Features](#experimental-features)
- [Uninstallation](#-uninstallation)
- [Trusted By](#-trusted-by)
- [Sponsors](#-sponsors)
- [Author's Note](#-authors-note)
- [Community](#-community)

---

## 💡 Core Concepts

### 🪨 Meet Sisyphus

<div align="center">

![Meet Sisyphus](.github/assets/sisyphus.png)

</div>

In Greek mythology, Sisyphus was condemned to roll a boulder up a hill for eternity. Like Sisyphus, LLM agents persistently push forward with their tasks—day after day, token after token.

**Sisyphus** is the primary orchestrator agent in Oh My OpenCode. Powered by Claude Opus 4.5 with extended thinking capabilities, it coordinates a team of specialized agents to tackle complex development tasks.

**The Philosophy**: LLM agents can write code as brilliant as humans—*if you give them great tools and solid teammates.*

#### What Happens When You Install

1. **Gemini 3 Pro** writes your frontend as a background task while **Claude Opus 4.5** handles the backend
2. Stuck debugging? **GPT 5.2** jumps in with its stellar logical reasoning
3. Need documentation? The **Librarian** agent scours official docs, your codebase history, and public GitHub implementations
4. Your agent becomes the **dev team lead**. You become the **AI manager**.
5. **Tasks complete to the end**—no more half-finished work.

**Just want a simple boost?** Include `ultrawork` in your prompt and let the system handle everything automatically.

---

## 🎯 Features

### 👥 Specialized AI Agents

Oh My OpenCode provides a curated team of AI specialists, each optimized for specific tasks:

| Agent | Model | Specialization |
|-------|-------|----------------|
| **Sisyphus** | Claude Opus 4.5 | Primary orchestrator with 32k extended thinking budget. Plans, delegates, and executes complex tasks with aggressive parallel execution. |
| **Oracle** | GPT 5.2 | Architecture, code review, and strategic analysis. Exceptional logical reasoning for design decisions. |
| **Librarian** | Claude Sonnet 4.5 / Gemini 3 Flash | Multi-repository analysis, documentation lookup, and implementation examples with evidence-based answers. |
| **Explore** | Grok Code / Gemini 3 Flash / Claude Haiku 4.5 | Blazing-fast codebase exploration and pattern matching using contextual grep. |
| **Frontend Engineer** | Gemini 3 Pro | A designer-turned-developer that builds gorgeous, functional UIs. |
| **Document Writer** | Gemini 3 Flash | Technical writing expert that produces flowing, professional prose. |
| **Multimodal Looker** | Gemini 3 Flash | Visual content specialist for analyzing PDFs, images, and diagrams. |

**Invoke agents explicitly when needed:**

```
Ask @oracle to review this design and propose an architecture
Ask @librarian how this pattern is implemented in popular open-source projects
Ask @explore for all usages of this deprecated API
```

---

### ⚡ Background Agent Orchestration

Run multiple agents simultaneously—they work like a real team:

- **GPT debugs** while **Claude explores** different approaches to find root cause
- **Gemini builds the frontend** while **Claude handles the backend**
- **Kick off parallel searches**, continue implementation, then integrate results when ready

Background agents notify the main orchestrator upon completion. The system maximizes throughput while you focus on what matters.

---

### 🛠 Developer Power Tools

Give your AI agents the same powerful tools you use in your IDE:

#### LSP Integration (Full Language Server Protocol Support)

| Tool | Description |
|------|-------------|
| `lsp_hover` | Type information, documentation, and signatures at cursor position |
| `lsp_goto_definition` | Jump to symbol definition |
| `lsp_find_references` | Find all usages across workspace |
| `lsp_document_symbols` | Get file symbol outline |
| `lsp_workspace_symbols` | Search symbols by name across project |
| `lsp_diagnostics` | Get errors and warnings before build |
| `lsp_prepare_rename` | Validate rename operation |
| `lsp_rename` | Rename symbol across entire workspace |
| `lsp_code_actions` | Get available quick fixes and refactorings |
| `lsp_code_action_resolve` | Apply code action |

#### AST-Aware Code Operations

| Tool | Description |
|------|-------------|
| `ast_grep_search` | AST-aware code pattern search (25+ languages) |
| `ast_grep_replace` | AST-aware code replacement |

**Why are you the only one using an IDE?** Hand your best tools to your AI colleagues—watch them level up.

---

### 📚 Intelligent Context Management

#### Directory-Based Context Injection

Automatically inject relevant context when reading files. Place `AGENTS.md` files at any directory level:

```
project/
├── AGENTS.md              # Project-wide context
├── src/
│   ├── AGENTS.md          # src-specific context  
│   └── components/
│       ├── AGENTS.md      # Component-specific context
│       └── Button.tsx     # Reading this injects all 3 AGENTS.md files
```

#### Conditional Rules Injection

Load rules from `.claude/rules/` when conditions match:

```markdown
---
globs: ["*.ts", "src/**/*.js"]
description: "TypeScript/JavaScript coding rules"
---
- Use PascalCase for interface names
- Use camelCase for function names
```

Supports `globs` patterns and `alwaysApply: true` for universal rules.

---

### 🌐 Built-in MCP Integrations

Three essential MCPs enabled by default:

| MCP | Description |
|-----|-------------|
| **Context7** | Fetches up-to-date official documentation for any library |
| **Exa Search** | Real-time web search powered by Exa AI |
| **grep.app** | Ultra-fast code search across millions of public GitHub repositories |

---

### 🔄 Claude Code Compatibility Layer

**Migrate seamlessly from Claude Code**—your existing configuration just works.

#### Supported Features

| Feature | Config Locations |
|---------|------------------|
| **Hooks** | `~/.claude/settings.json`, `./.claude/settings.json`, `./.claude/settings.local.json` |
| **Commands** | `~/.claude/commands/*.md`, `./.claude/commands/*.md` |
| **Skills** | `~/.claude/skills/*/SKILL.md`, `./.claude/skills/*/SKILL.md` |
| **Agents** | `~/.claude/agents/*.md`, `./.claude/agents/*.md` |
| **MCP** | `~/.claude/.mcp.json`, `./.mcp.json`, `./.claude/.mcp.json` |

#### Supported Hook Events

| Event | Description |
|-------|-------------|
| `PreToolUse` | Runs before tool execution. Can block or modify tool input. |
| `PostToolUse` | Runs after tool execution. Can add warnings or context. |
| `UserPromptSubmit` | Runs when user submits prompt. Can block or inject messages. |
| `Stop` | Runs when session goes idle. Can inject follow-up prompts. |

**Example hook configuration:**

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

---

### 🚀 Productivity Enhancements

| Feature | Description |
|---------|-------------|
| **Keyword Detector** | Activate specialized modes with keywords: `ultrawork` (maximum performance), `search`/`find` (parallel search), `analyze` (deep analysis) |
| **Todo Continuation Enforcer** | Forces agents to complete all TODOs before stopping—no more half-finished work |
| **Comment Checker** | Prevents excessive AI comments while respecting valid patterns (BDD, docstrings, directives) |
| **Think Mode** | Auto-detects phrases like "think deeply" or "ultrathink" and adjusts model settings for maximum reasoning |
| **Context Window Monitor** | Implements [Context Window Anxiety Management](https://agentic-patterns.com/patterns/context-window-anxiety-management/)—reminds agents there's headroom at 70%+ usage |
| **Anthropic Auto Compact** | Automatically summarizes and compacts sessions when Claude hits token limits |
| **Session Recovery** | Automatically recovers from errors (missing tool results, thinking blocks, empty messages) |
| **Auto Update Checker** | Checks for new versions with optional startup notifications |
| **Background Notification** | OS notifications when background agents complete tasks |
| **Session Notification** | OS notifications when agents go idle (macOS, Linux, Windows) |
| **Smart Output Truncation** | Dynamic truncation based on context window—grep, glob, LSP tools stay within limits |

---

## 📦 Installation

### Prerequisites

- **OpenCode** v1.0.150 or higher ([Installation Guide](https://opencode.ai/docs))
- **Bun** runtime ([bun.sh](https://bun.sh))

### Interactive Installation

Run the installer and follow the prompts:

```bash
bunx oh-my-opencode install
```

The installer will:
1. Ask about your AI provider subscriptions (Claude, ChatGPT, Gemini)
2. Register the plugin in `opencode.json`
3. Configure optimal agent models based on your subscriptions
4. Guide you through authentication

### Agent-Assisted Installation

Paste this into any AI coding assistant:

```
Install and configure oh-my-opencode by following https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/refs/heads/master/README.md
```

---

<details>
<summary><h3>Manual Installation for LLM Agents</h3></summary>

If you're an LLM Agent helping set up oh-my-opencode—welcome! You're about to help your user install the best agent harness available. Greet them with: `oMoMoMoMo...`

#### Step 1: Determine User Subscriptions

Ask the user these questions:

1. **Claude Pro/Max Subscription?**
   - Yes + max20 mode → `--claude=max20`
   - Yes (no max20) → `--claude=yes`
   - No → `--claude=no`

2. **ChatGPT Plus/Pro Subscription?**
   - Yes → `--chatgpt=yes`
   - No → `--chatgpt=no`

3. **Gemini Integration?**
   - Yes → `--gemini=yes`
   - No → `--gemini=no`

#### Step 2: Verify OpenCode Installation

```bash
if command -v opencode &> /dev/null; then
    echo "OpenCode $(opencode --version) is installed"
else
    echo "OpenCode not found. Please install from https://opencode.ai/docs"
fi
```
- **lsp_hover**: Type info, docs, signatures at position
- **lsp_goto_definition**: Jump to symbol definition
- **lsp_find_references**: Find all usages across workspace
- **lsp_document_symbols**: Get file symbol outline
- **lsp_workspace_symbols**: Search symbols by name across project
- **lsp_diagnostics**: Get errors/warnings before build
- **lsp_servers**: List available LSP servers
- **lsp_prepare_rename**: Validate rename operation
- **lsp_rename**: Rename symbol across workspace
- **lsp_code_actions**: Get available quick fixes/refactorings
- **lsp_code_action_resolve**: Apply code action
- **ast_grep_search**: AST-aware code pattern search (25 languages)
- **ast_grep_replace**: AST-aware code replacement
- **call_omo_agent**: Spawn specialized explore/librarian agents. Supports `run_in_background` parameter for async execution.

#### Session Management

Tools to navigate and search your OpenCode session history:

- **session_list**: List all OpenCode sessions with filtering by date and limit
- **session_read**: Read messages and history from a specific session
- **session_search**: Full-text search across session messages
- **session_info**: Get metadata and statistics about a session

These tools enable agents to reference previous conversations and maintain continuity across sessions.

#### Step 3: Run the Installer

```bash
bunx oh-my-opencode install --no-tui --claude=<yes|no|max20> --chatgpt=<yes|no> --gemini=<yes|no>
```

**Examples:**
- All subscriptions with max20: `bunx oh-my-opencode install --no-tui --claude=max20 --chatgpt=yes --gemini=yes`
- Claude only: `bunx oh-my-opencode install --no-tui --claude=yes --chatgpt=no --gemini=no`

#### Step 4: Configure Authentication

##### Anthropic (Claude)

```bash
opencode auth login
# Provider: Select Anthropic
# Login method: Select Claude Pro/Max
# Complete OAuth flow in browser
```

##### Google Gemini (Antigravity OAuth)

Add the auth plugin to `opencode.json`:

```json
{
  "plugin": ["oh-my-opencode", "opencode-antigravity-auth@1.1.2"]
}
```

Configure model overrides in `oh-my-opencode.json`:

```json
{
  "google_auth": false,
  "agents": {
    "frontend-ui-ux-engineer": { "model": "google/gemini-3-pro-high" },
    "document-writer": { "model": "google/gemini-3-flash" },
    "multimodal-looker": { "model": "google/gemini-3-flash" }
  }
}
```

Then authenticate:

```bash
opencode auth login
# Provider: Select Google
# Login method: Select OAuth with Google (Antigravity)
```

##### OpenAI (ChatGPT Plus/Pro)

Add the auth plugin to `opencode.json`:

```json
{
  "plugin": ["oh-my-opencode", "opencode-openai-codex-auth@4.1.1"]
}
```

> **Note**: For current npm bug workaround, use the hotfix branch. See [opencode-openai-codex-auth](https://github.com/numman-ali/opencode-openai-codex-auth) documentation.

Then authenticate:

```bash
opencode auth login
# Provider: Select OpenAI
# Login method: Select ChatGPT Plus/Pro (Codex Subscription)
```

#### Step 5: Verify Setup

```bash
opencode --version  # Should be 1.0.150 or higher
cat ~/.config/opencode/opencode.json  # Should contain "oh-my-opencode"
```

#### Step 6: Complete

Say to user: **Congratulations! 🎉** You've successfully set up Oh My OpenCode! Type `opencode` in your terminal to start.

#### ⚠️ Important

**Unless explicitly requested, do not modify model settings or disable features.** The plugin works optimally with default settings.

</details>

---
- **Keyword Detector**: Automatically detects keywords in your prompts and activates specialized modes:
  - `ultrawork` / `ulw`: Maximum performance mode with parallel agent orchestration
  - `search` / `find` / `찾아` / `検索`: Maximized search effort with parallel explore and librarian agents
  - `analyze` / `investigate` / `분석` / `調査`: Deep analysis mode with multi-phase expert consultation
- **Todo Continuation Enforcer**: Makes agents finish all TODOs before stopping. Kills the chronic LLM habit of quitting halfway.
- **Comment Checker**: LLMs love comments. Too many comments. This reminds them to cut the noise. Smartly ignores valid patterns (BDD, directives, docstrings) and demands justification for the rest. Clean code wins.
- **Think Mode**: Auto-detects when extended thinking is needed and switches modes. Catches phrases like "think deeply" or "ultrathink" and dynamically adjusts model settings for maximum reasoning.
- **Context Window Monitor**: Implements [Context Window Anxiety Management](https://agentic-patterns.com/patterns/context-window-anxiety-management/).
  - At 70%+ usage, reminds agents there's still headroom—prevents rushed, sloppy work.
- **Agent Usage Reminder**: When you call search tools directly, reminds you to leverage specialized agents via background tasks for better results.
- **Anthropic Auto Compact**: When Claude models hit token limits, automatically summarizes and compacts the session—no manual intervention needed.
- **Session Recovery**: Automatically recovers from session errors (missing tool results, thinking block issues, empty messages). Sessions don't crash mid-run. Even if they do, they recover.
- **Auto Update Checker**: Automatically checks for new versions of oh-my-opencode and can auto-update your configuration. Shows startup toast notifications displaying current version and Sisyphus status ("Sisyphus on steroids is steering OpenCode" when enabled, or "OpenCode is now on Steroids. oMoMoMoMo..." otherwise). Disable all features with `"auto-update-checker"` in `disabled_hooks`, or disable just toast notifications with `"startup-toast"` in `disabled_hooks`. See [Configuration > Hooks](#hooks).
- **Background Notification**: Get notified when background agent tasks complete.
- **Session Notification**: Sends OS notifications when agents go idle. Works on macOS, Linux, and Windows—never miss when your agent needs input.
- **Empty Task Response Detector**: Catches when Task tool returns nothing. Warns you about potential agent failures so you don't wait forever for a response that already came back empty.
- **Empty Message Sanitizer**: Prevents API errors from empty chat messages by automatically sanitizing message content before sending.
- **Grep Output Truncator**: Grep can return mountains of text. This dynamically truncates output based on your remaining context window—keeps 50% headroom, caps at 50k tokens.
- **Tool Output Truncator**: Same idea, broader scope. Truncates output from Grep, Glob, LSP tools, and AST-grep. Prevents one verbose search from eating your entire context.
- **Preemptive Compaction**: Compacts session proactively before hitting hard token limits. Runs before you get into trouble.
- **Compaction Context Injector**: Preserves critical context (AGENTS.md, current directory info) during session compaction so you don't lose important state.
- **Thinking Block Validator**: Validates thinking blocks to ensure proper formatting and prevent API errors from malformed thinking content.
- **Claude Code Hooks**: Executes hooks from Claude Code's settings.json - this is the compatibility layer that runs PreToolUse/PostToolUse/UserPromptSubmit/Stop hooks.

## ⚙️ Configuration

### Configuration Files

Configuration files are loaded in priority order:

| Priority | Location | Scope |
|----------|----------|-------|
| 1 | `.opencode/oh-my-opencode.json` | Project |
| 2 | `~/.config/opencode/oh-my-opencode.json` | User (macOS/Linux) |
| 2 | `%APPDATA%\opencode\oh-my-opencode.json` | User (Windows fallback) |

**Enable schema autocomplete:**

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json"
}
```

**JSONC Support**: Both `.json` and `.jsonc` (JSON with Comments) are supported. When both exist, `.jsonc` takes priority.

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
  
  // Enable Google Gemini via Antigravity OAuth
  "google_auth": false,
  
  /* Agent overrides */
  "agents": {
    "oracle": {
      "model": "openai/gpt-5.2",  // GPT for strategic reasoning
    },
  },
}
```

---

### Provider Authentication

#### Google Auth Options

**Recommended**: Use [`opencode-antigravity-auth`](https://github.com/NoeFabris/opencode-antigravity-auth) for multi-account load balancing and more model options.

```json
{
  "google_auth": false,
  "agents": {
    "frontend-ui-ux-engineer": { "model": "google/gemini-3-pro-high" },
    "document-writer": { "model": "google/gemini-3-flash" },
    "multimodal-looker": { "model": "google/gemini-3-flash" }
  }
}
```

**Alternative**: Enable built-in Antigravity OAuth (single account, Gemini only):

```json
{
  "google_auth": true
}
```

---

### Agent Customization

Override any built-in agent:

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

**Available properties:** `model`, `temperature`, `top_p`, `prompt`, `tools`, `disable`, `description`, `mode`, `color`, `permission`

#### Permission Options

Fine-grained control over agent capabilities:

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

| Permission | Description | Values |
|------------|-------------|--------|
| `edit` | File editing permission | `ask` / `allow` / `deny` |
| `bash` | Bash command execution | `ask` / `allow` / `deny` or per-command object |
| `webfetch` | Web request permission | `ask` / `allow` / `deny` |
| `doom_loop` | Infinite loop detection override | `ask` / `allow` / `deny` |
| `external_directory` | Access files outside project root | `ask` / `allow` / `deny` |

#### Disable Agents

```json
{
  "disabled_agents": ["oracle", "frontend-ui-ux-engineer"]
}
```

**Available agents:** `oracle`, `librarian`, `explore`, `frontend-ui-ux-engineer`, `document-writer`, `multimodal-looker`

---

### Sisyphus Configuration

Control the Sisyphus orchestrator and its specialized agents:

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

| Option | Default | Description |
|--------|---------|-------------|
| `disabled` | `false` | Disables all Sisyphus orchestration; restores original build/plan as primary |
| `default_builder_enabled` | `false` | Enables Builder-Sisyphus agent (OpenCode's default build agent) |
| `planner_enabled` | `true` | Enables Planner-Sisyphus agent (OpenCode's default plan agent) |
| `replace_plan` | `true` | Demotes default plan agent to subagent mode |

**Customize Sisyphus agents:**

```json
{
  "agents": {
    "Sisyphus": {
      "model": "anthropic/claude-sonnet-4",
      "temperature": 0.3
    },
    "Builder-Sisyphus": {
      "model": "anthropic/claude-opus-4"
    },
    "Planner-Sisyphus": {
      "model": "openai/gpt-5.2"
    }
  }
}
```

---

### Hooks Configuration

Disable specific built-in hooks:

```json
{
  "disabled_hooks": ["comment-checker", "agent-usage-reminder"]
}
```

**Available hooks:**
Available hooks: `todo-continuation-enforcer`, `context-window-monitor`, `session-recovery`, `session-notification`, `comment-checker`, `grep-output-truncator`, `tool-output-truncator`, `directory-agents-injector`, `directory-readme-injector`, `empty-task-response-detector`, `think-mode`, `anthropic-auto-compact`, `rules-injector`, `background-notification`, `auto-update-checker`, `startup-toast`, `keyword-detector`, `agent-usage-reminder`, `non-interactive-env`, `interactive-bash-session`, `empty-message-sanitizer`, `preemptive-compaction`, `compaction-context-injector`, `thinking-block-validator`, `claude-code-hooks`

`todo-continuation-enforcer` · `context-window-monitor` · `session-recovery` · `session-notification` · `comment-checker` · `grep-output-truncator` · `tool-output-truncator` · `directory-agents-injector` · `directory-readme-injector` · `empty-task-response-detector` · `think-mode` · `anthropic-auto-compact` · `rules-injector` · `background-notification` · `auto-update-checker` · `startup-toast` · `keyword-detector` · `agent-usage-reminder` · `non-interactive-env` · `interactive-bash-session` · `empty-message-sanitizer`

> **Note**: `startup-toast` is a sub-feature of `auto-update-checker`. Disable `startup-toast` for toast only, or `auto-update-checker` for all update features.

---

### MCP Configuration

Disable built-in MCPs:

```json
{
  "disabled_mcps": ["context7", "websearch_exa", "grep_app"]
}
```

---

### LSP Configuration

Add or configure LSP servers:

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

**Server properties:** `command`, `extensions`, `priority`, `env`, `initialization`, `disabled`

---

### Experimental Features

> ⚠️ **Warning**: These features may cause unexpected behavior. Enable only if you understand the implications.

```json
{
  "experimental": {
    "aggressive_truncation": false,
    "auto_resume": false,
    "truncate_all_tool_outputs": true,
    "dcp_for_compaction": false
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `aggressive_truncation` | `false` | Aggressively truncates tool outputs when token limit exceeded |
| `auto_resume` | `false` | Automatically resumes after thinking block error recovery |
| `truncate_all_tool_outputs` | `true` | Dynamically truncates ALL tool outputs based on context window |
| `dcp_for_compaction` | `false` | Runs Dynamic Context Pruning before compaction on token limit errors |

---

### Claude Code Compatibility Toggles

Disable specific Claude Code compatibility features:

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

| Toggle | When `false`, stops loading from... | Unaffected |
|--------|-------------------------------------|------------|
| `mcp` | `~/.claude/.mcp.json`, `./.mcp.json`, `./.claude/.mcp.json` | Built-in MCPs (context7, websearch_exa, grep_app) |
| `commands` | `~/.claude/commands/*.md`, `./.claude/commands/*.md` | `~/.config/opencode/command/`, `./.opencode/command/` |
| `skills` | `~/.claude/skills/*/SKILL.md`, `./.claude/skills/*/SKILL.md` | — |
| `agents` | `~/.claude/agents/*.md`, `./.claude/agents/*.md` | Built-in agents (oracle, librarian, etc.) |
| `hooks` | `~/.claude/settings.json`, `./.claude/settings*.json` | — |

All toggles default to `true`. Omit the `claude_code` object for full compatibility.

---

## 🗑 Uninstallation

1. **Remove the plugin from OpenCode config:**

   ```bash
   jq '.plugin = [.plugin[] | select(. != "oh-my-opencode")]' \
       ~/.config/opencode/opencode.json > /tmp/oc.json && \
       mv /tmp/oc.json ~/.config/opencode/opencode.json
   ```

2. **Remove configuration files (optional):**

   ```bash
   rm -f ~/.config/opencode/oh-my-opencode.json
   rm -f .opencode/oh-my-opencode.json
   ```

3. **Verify removal:**

   ```bash
   opencode --version
   ```

---

## 🏢 Trusted By

<table>
<tr>
<td align="center" width="33%">
<a href="https://indentcorp.com">
<img src="https://img.shields.io/badge/Indent-4f46e5?style=for-the-badge" alt="Indent" />
</a>
<br />
<sub>Spray · Vovushop · Vreview</sub>
</td>
<td align="center" width="33%">
<a href="https://google.com">
<img src="https://img.shields.io/badge/Google-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="Google" />
</a>
</td>
<td align="center" width="33%">
<a href="https://microsoft.com">
<img src="https://img.shields.io/badge/Microsoft-5E5E5E?style=for-the-badge&logo=microsoft&logoColor=white" alt="Microsoft" />
</a>
</td>
</tr>
</table>

---

## ❤️ Sponsors

<table>
<tr>
<td>

**Numman Ali** — *The First Sponsor*

[![GitHub](https://img.shields.io/badge/GitHub-numman--ali-181717?style=flat-square&logo=github)](https://github.com/numman-ali)
[![X](https://img.shields.io/badge/X-nummanali-000000?style=flat-square&logo=x)](https://x.com/nummanali)

</td>
<td>

**Aaron Iker**

[![GitHub](https://img.shields.io/badge/GitHub-aaroniker-181717?style=flat-square&logo=github)](https://github.com/aaroniker)
[![X](https://img.shields.io/badge/X-aaroniker-000000?style=flat-square&logo=x)](https://x.com/aaroniker)

</td>
</tr>
</table>

[**Become a Sponsor →**](https://github.com/sponsors/code-yeongyu)

---

## 📝 Author's Note

I've spent $24,000+ worth of tokens on personal development, testing every tool available and configuring them extensively. **OpenCode won.**

The solutions to every problem I encountered are baked into this plugin. If OpenCode is Debian/Arch, Oh My OpenCode is Ubuntu/[Omarchy](https://omarchy.org/).

This project draws heavy inspiration from [AmpCode](https://ampcode.com) and [Claude Code](https://code.claude.com/docs/overview)—I've ported their best features here, often improved. And I'm still building. It's **Open**Code, after all.

I'll keep testing and updating. I'm this project's most obsessive user:
- Which model has the sharpest logic?
- Who's the debugging god?
- Who writes the best prose?
- Who dominates frontend vs. backend?
- Which model is fastest for daily driving?

**Stop agonizing over agent harness choices.** I'll do the research, borrow from the best, and ship updates here.

*99% of this project was built using OpenCode. I personally reviewed and largely rewrote this documentation—read with confidence.*

---

## 🌐 Community

<table>
<tr>
<td>

[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/PWpXmbhF)

Connect with contributors and fellow users

</td>
<td>

[![X Follow](https://img.shields.io/badge/X-Follow%20%40justsisyphus-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/justsisyphus)

News and updates

</td>
</tr>
</table>

---

## ⚠️ Important Notes

- **Version Requirement**: OpenCode v1.0.132 or older has a bug that may break config. Use v1.0.150+.
- **Productivity Warning**: Your productivity might spike dramatically. 😉

---

<div align="center">

*Special thanks to [@junhoyeo](https://github.com/junhoyeo) for the amazing hero image.*

<br />

**[⬆ Back to Top](#oh-my-opencode)**

<br />

Made with 🪨 by [code-yeongyu](https://github.com/code-yeongyu)

</div>
