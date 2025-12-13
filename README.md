[English](README.md) | [한국어](README.ko.md)

## Contents

- [Oh My OpenCode](#oh-my-opencode)
  - [Skip Reading This](#skip-reading-this)
    - [It's the Age of Agents](#its-the-age-of-agents)
    - [10 Minutes to Unlock](#10-minutes-to-unlock)
  - [Installation](#installation)
    - [For Humans](#for-humans)
    - [For LLM Agents](#for-llm-agents)
    - [Step 1: Verify OpenCode Installation](#step-1-verify-opencode-installation)
    - [Step 2: Configure oh-my-opencode Plugin](#step-2-configure-oh-my-opencode-plugin)
    - [Step 3: Verify Setup](#step-3-verify-setup)
    - [Step 4: Configure Authentication](#step-4-configure-authentication)
      - [4.1 Anthropic (Claude)](#41-anthropic-claude)
      - [4.2 Google Gemini (Antigravity OAuth)](#42-google-gemini-antigravity-oauth)
      - [4.3 OpenAI (ChatGPT Plus/Pro)](#43-openai-chatgpt-pluspro)
      - [4.3.1 Model Configuration](#431-model-configuration)
    - [⚠️ Warning](#️-warning)
  - [Features](#features)
    - [Agents: Your Teammates](#agents-your-teammates)
    - [Background Agents: Work Like a Team](#background-agents-work-like-a-team)
    - [The Tools: Your Teammates Deserve Better](#the-tools-your-teammates-deserve-better)
      - [Why Are You the Only One Using an IDE?](#why-are-you-the-only-one-using-an-ide)
      - [Context Is All You Need](#context-is-all-you-need)
      - [Be Multimodal. Save Tokens.](#be-multimodal-save-tokens)
      - [I Removed Their Blockers](#i-removed-their-blockers)
    - [Goodbye Claude Code. Hello Oh My OpenCode.](#goodbye-claude-code-hello-oh-my-opencode)
      - [Hooks Integration](#hooks-integration)
      - [Config Loaders](#config-loaders)
      - [Data Storage](#data-storage)
      - [Compatibility Toggles](#compatibility-toggles)
    - [Not Just for the Agents](#not-just-for-the-agents)
  - [Configuration](#configuration)
    - [Google Auth](#google-auth)
    - [Agents](#agents)
    - [MCPs](#mcps)
    - [LSP](#lsp)
  - [Author's Note](#authors-note)
  - [Warnings](#warnings)

# Oh My OpenCode

oMoMoMoMoMo···


[Claude Code](https://www.claude.com/product/claude-code) is great.
But if you're a hacker, you'll fall head over heels for [OpenCode](https://github.com/sst/opencode).

- Endlessly extensible. Endlessly customizable.
- Zero screen flicker.
- [LSP](https://opencode.ai/docs/lsp/), [linters, formatters](https://opencode.ai/docs/formatters/) activate automatically per file—and you can tweak everything.
- Mix and match models. **Orchestrate them by purpose.**
- Feature-rich. Beautiful. The terminal doesn't choke. High performance.

Remember the first time you switched from Windows to Linux? That rush of configuring everything exactly how you wanted?
In an age where that magic seems lost, OpenCode brings it back.
If you love coding and computers, OpenCode is that Linux-after-Windows moment.

**But here's the catch: there's a lot to learn, it's complex, and your time is expensive.**

I've fixed that.
Even if you're not a hacker, invest a few minutes. Multiply your skills and productivity.
Hand this doc to an agent and let them set it up.

## Skip Reading This

### It's the Age of Agents
- **Just paste this link into Claude Code / AmpCode / Factory Droid / Cursor and ask it to explain.**
  - Ask why it's good, why it's not just another boilerplate setup, what actually gets better.
  - If you're an LLM agent, explain to the user what becomes possible right now with this project.

### 10 Minutes to Unlock

1. **While Gemini 3 Pro writes the frontend as a background task, Claude Opus 4.5 handles the backend. Stuck debugging? Call GPT 5.2 for help. When the frontend reports done, verify and ship.**
2. Need to look something up? It scours official docs, your entire codebase history, and public GitHub implementations—using not just grep but built-in LSP tools and AST-Grep.
3. Stop worrying about context management when delegating to LLMs. I've got it covered.
    - OhMyOpenCode aggressively leverages multiple agents to lighten the context load.
    - **Your agent is now the dev team lead. You're the AI Manager.**
4. It doesn't stop until the job is done.


- Throw complex, massive tasks at it.
  - Drop the "ultrawork" keyword in your prompt and it handles everything automatically.

## Installation


### For Humans

Let the LLM Agent handle the grunt work. Paste this link and ask it to install and configure.

### For LLM Agents

<details>
<summary>Instructions for LLM Agents (click to expand)</summary>

If you're an LLM Agent helping set up oh-my-opencode, follow these steps:


### Step 1: Verify OpenCode Installation

```bash
if command -v opencode &> /dev/null; then
    echo "OpenCode $(opencode --version) is installed"
else
    echo "OpenCode is not installed. Please install it first."
    echo "Ref: https://opencode.ai/docs"
fi
```

If OpenCode isn't installed, check the [OpenCode Installation Guide](https://opencode.ai/docs). To save context, spawn a subagent to handle installation and report back.

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
        echo "Please add \"oh-my-opencode\" to the plugin array in ~/.config/opencode/opencode.json"
    fi
else
    # Create new config
    echo '{"plugin":["oh-my-opencode"]}' > ~/.config/opencode/opencode.json
fi
```

### Step 3: Verify Setup

```bash
opencode --version  # Should be 1.0.132 or higher
cat ~/.config/opencode/opencode.json  # Should contain "oh-my-opencode" in plugin array
```

### Step 4: Configure Authentication

Once oh-my-opencode is in the plugin list, use tmux to walk the user through authentication. Complete all steps below.

#### 4.1 Anthropic (Claude)

```bash
opencode auth login
# Provider: Select Anthropic
# Login method: Select Claude Pro/Max
# Guide user through OAuth flow in browser
# Wait for completion
# Verify success and confirm with user
```

#### 4.2 Google Gemini (Antigravity OAuth)

First, enable Google auth in `~/.config/opencode/oh-my-opencode.json`:

```json
{
  "google_auth": true
}
```

Then authenticate:

```bash
opencode auth login
# Provider: Select Google
# Login method: Select OAuth with Google (Antigravity)
# Guide user through OAuth flow in browser
# Wait for completion
# Verify success and confirm with user
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

**Important**: The official npm package currently has a bug causing 400 errors (`"No tool call found for function call output with call_id"`). **Use the hotfix branch** until fixed. Edit `~/.config/opencode/package.json`:

```json
{
  "dependencies": {
    "opencode-openai-codex-auth": "code-yeongyu/opencode-openai-codex-auth#fix/orphaned-function-call-output-with-tools"
  }
}
```

Then run `cd ~/.config/opencode && bun i`. In `opencode.json`, use `"opencode-openai-codex-auth"` without the version suffix.

#### 4.3.1 Model Configuration
You'll also need full model settings in `opencode.json`.
Read the [opencode-openai-codex-auth documentation](https://github.com/numman-ali/opencode-openai-codex-auth), copy provider/models config from [`config/full-opencode.json`](https://github.com/numman-ali/opencode-openai-codex-auth/blob/main/config/full-opencode.json), and merge carefully to avoid breaking the user's existing setup.

Then authenticate:

```bash
opencode auth login
# Provider: Select OpenAI
# Login method: Select ChatGPT Plus/Pro (Codex Subscription)
# Guide user through OAuth flow in browser
# Wait for completion
# Verify success and confirm with user
```


### ⚠️ Warning

**Don't change model settings or disable features (agents, hooks, MCPs) unless explicitly requested.**

The plugin works perfectly with defaults. Aside from the recommended `google_auth: true`, don't touch other settings without a specific ask.

</details>


## Features

### Agents: Your Teammates

- **oracle** (`openai/gpt-5.2`): Architecture, code review, strategy. Uses GPT-5.2 for its stellar logical reasoning and deep analysis. Inspired by AmpCode.
- **librarian** (`anthropic/claude-haiku-4-5`): Multi-repo analysis, doc lookup, implementation examples. Haiku is fast, smart enough, great at tool calls, and cheap. Inspired by AmpCode.
- **explore** (`opencode/grok-code`): Fast codebase exploration and pattern matching. Claude Code uses Haiku; we use Grok—it's free, blazing fast, and plenty smart for file traversal. Inspired by Claude Code.
- **frontend-ui-ux-engineer** (`google/gemini-3-pro-preview`): A designer turned developer. Builds gorgeous UIs. Gemini excels at creative, beautiful UI code.
- **document-writer** (`google/gemini-3-pro-preview`): Technical writing expert. Gemini is a wordsmith—writes prose that flows.
- **multimodal-looker** (`google/gemini-2.5-flash`): Visual content specialist. Analyzes PDFs, images, diagrams to extract information.

The main agent invokes these automatically, but you can call them explicitly:

```
Ask @oracle to review this design and propose an architecture
Ask @librarian how this is implemented—why does the behavior keep changing?
Ask @explore for the policy on this feature
```

Customize agent models, prompts, and permissions in `oh-my-opencode.json`. See [Configuration](#configuration).

### Background Agents: Work Like a Team

What if you could run these agents relentlessly, never letting them idle?

- Have GPT debug while Claude tries different approaches to find the root cause
- Gemini writes the frontend while Claude handles the backend
- Kick off massive parallel searches, continue implementation on other parts, then finish using the search results

These workflows are possible with OhMyOpenCode.

Run subagents in the background. The main agent gets notified on completion. Wait for results if needed.

**Make your agents work like your team works.**

### The Tools: Your Teammates Deserve Better

#### Why Are You the Only One Using an IDE?

Syntax highlighting, autocomplete, refactoring, navigation, analysis—and now agents writing code...

**Why are you the only one with these tools?**
**Give them to your agents and watch them level up.**

[OpenCode provides LSP](https://opencode.ai/docs/lsp/), but only for analysis.

The features in your editor? Other agents can't touch them.
Hand your best tools to your best colleagues. Now they can properly refactor, navigate, and analyze.

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

#### Context Is All You Need
- **Directory AGENTS.md / README.md Injector**: Auto-injects `AGENTS.md` and `README.md` when reading files. Walks from file directory to project root, collecting **all** `AGENTS.md` files along the path. Supports nested directory-specific instructions:
  ```
  project/
  ├── AGENTS.md              # Project-wide context
  ├── src/
  │   ├── AGENTS.md          # src-specific context
  │   └── components/
  │       ├── AGENTS.md      # Component-specific context
  │       └── Button.tsx     # Reading this injects all 3 AGENTS.md files
  ```
  Reading `Button.tsx` injects in order: `project/AGENTS.md` → `src/AGENTS.md` → `components/AGENTS.md`. Each directory's context is injected once per session.
- **Conditional Rules Injector**: Not all rules apply all the time. Injects rules from `.claude/rules/` when conditions match.
  - Walks upward from file directory to project root, plus `~/.claude/rules/` (user).
  - Supports `.md` and `.mdc` files.
  - Matches via `globs` field in frontmatter.
  - `alwaysApply: true` for rules that should always fire.
  - Example rule file:
    ```markdown
    ---
    globs: ["*.ts", "src/**/*.js"]
    description: "TypeScript/JavaScript coding rules"
    ---
    - Use PascalCase for interface names
    - Use camelCase for function names
    ```
- **Online**: Project rules aren't everything. Built-in MCPs for extended capabilities:
  - **context7**: Official documentation lookup
  - **websearch_exa**: Real-time web search
  - **grep_app**: Ultra-fast code search across public GitHub repos (great for finding implementation examples)

#### Be Multimodal. Save Tokens.

The look_at tool from AmpCode, now in OhMyOpenCode.
Instead of the agent reading massive files and bloating context, it internally leverages another agent to extract just what it needs.

#### I Removed Their Blockers
- Replaces built-in grep and glob tools. Default implementation has no timeout—can hang forever.


### Goodbye Claude Code. Hello Oh My OpenCode.

Oh My OpenCode has a Claude Code compatibility layer.
If you were using Claude Code, your existing config just works.

#### Hooks Integration

Run custom scripts via Claude Code's `settings.json` hook system.
Oh My OpenCode reads and executes hooks from:

- `~/.claude/settings.json` (user)
- `./.claude/settings.json` (project)
- `./.claude/settings.local.json` (local, git-ignored)

Supported hook events:
- **PreToolUse**: Runs before tool execution. Can block or modify tool input.
- **PostToolUse**: Runs after tool execution. Can add warnings or context.
- **UserPromptSubmit**: Runs when user submits prompt. Can block or inject messages.
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

#### Config Loaders

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

**MCP Loader**: Loads MCP server configs from `.mcp.json` files:
- `~/.claude/.mcp.json` (user)
- `./.mcp.json` (project)
- `./.claude/.mcp.json` (local)
- Supports environment variable expansion (`${VAR}` syntax)

#### Data Storage

**Todo Management**: Session todos stored in `~/.claude/todos/` in Claude Code compatible format.

**Transcript**: Session activity logged to `~/.claude/transcripts/` in JSONL format for replay and analysis.

#### Compatibility Toggles

Disable specific Claude Code compatibility features with the `claude_code` config object:

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

| Toggle     | When `false`, stops loading from...                                                   | Unaffected                                            |
| ---------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `mcp`      | `~/.claude/.mcp.json`, `./.mcp.json`, `./.claude/.mcp.json`                           | Built-in MCP (context7, websearch_exa)                |
| `commands` | `~/.claude/commands/*.md`, `./.claude/commands/*.md`                                  | `~/.config/opencode/command/`, `./.opencode/command/` |
| `skills`   | `~/.claude/skills/*/SKILL.md`, `./.claude/skills/*/SKILL.md`                          | -                                                     |
| `agents`   | `~/.claude/agents/*.md`, `./.claude/agents/*.md`                                      | Built-in agents (oracle, librarian, etc.)             |
| `hooks`    | `~/.claude/settings.json`, `./.claude/settings.json`, `./.claude/settings.local.json` | -                                                     |

All toggles default to `true` (enabled). Omit the `claude_code` object for full Claude Code compatibility.

### Not Just for the Agents

When agents thrive, you thrive. But I want to help you directly too.

- **Ultrawork Mode**: Type "ultrawork" or "ulw" and agent orchestration kicks in. Forces the main agent to max out all available specialists (explore, librarian, plan, UI) via background tasks in parallel, with strict TODO tracking and verification. Just ultrawork. Everything fires at full capacity.
- **Todo Continuation Enforcer**: Makes agents finish all TODOs before stopping. Kills the chronic LLM habit of quitting halfway.
- **Comment Checker**: LLMs love comments. Too many comments. This reminds them to cut the noise. Smartly ignores valid patterns (BDD, directives, docstrings) and demands justification for the rest. Clean code wins.
- **Think Mode**: Auto-detects when extended thinking is needed and switches modes. Catches phrases like "think deeply" or "ultrathink" and dynamically adjusts model settings for maximum reasoning.
- **Context Window Monitor**: Implements [Context Window Anxiety Management](https://agentic-patterns.com/patterns/context-window-anxiety-management/).
  - At 70%+ usage, reminds agents there's still headroom—prevents rushed, sloppy work.
- Stability features that felt missing in OpenCode are built in. The Claude Code experience, transplanted. Sessions don't crash mid-run. Even if they do, they recover.

## Configuration

Highly opinionated, but adjustable to taste.

Config file locations (priority order):
1. `.opencode/oh-my-opencode.json` (project)
2. `~/.config/opencode/oh-my-opencode.json` (user)

Schema autocomplete supported:

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

When enabled, `opencode auth login` shows "OAuth with Google (Antigravity)" for the Google provider.

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

Or disable via `disabled_agents` in `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.json`:

```json
{
  "disabled_agents": ["oracle", "frontend-ui-ux-engineer"]
}
```

Available agents: `oracle`, `librarian`, `explore`, `frontend-ui-ux-engineer`, `document-writer`

### MCPs

Context7, Exa, and grep.app MCP enabled by default.

- **context7**: Fetches up-to-date official documentation for libraries
- **websearch_exa**: Real-time web search powered by Exa AI
- **grep_app**: Ultra-fast code search across millions of public GitHub repositories via [grep.app](https://grep.app)

Don't want them? Disable via `disabled_mcps` in `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.json`:

```json
{
  "disabled_mcps": ["context7", "websearch_exa", "grep_app"]
}
```

### LSP

OpenCode provides LSP tools for analysis.
Oh My OpenCode adds refactoring tools (rename, code actions).
All OpenCode LSP configs and custom settings (from opencode.json) are supported, plus additional Oh My OpenCode-specific settings.

Add LSP servers via the `lsp` option in `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.json`:

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

Install Oh My OpenCode.

I've used LLMs worth $24,000 tokens purely for personal development.
Tried every tool out there, configured them to death. OpenCode won.

The answers to every problem I hit are baked into this plugin. Just install and go.
If OpenCode is Debian/Arch, Oh My OpenCode is Ubuntu/[Omarchy](https://omarchy.org/).


Heavily influenced by [AmpCode](https://ampcode.com) and [Claude Code](https://code.claude.com/docs/overview)—I've ported their features here, often improved. And I'm still building.
It's **Open**Code, after all.

Enjoy multi-model orchestration, stability, and rich features that other harnesses promise but can't deliver.
I'll keep testing and updating. I'm this project's most obsessive user.
- Which model has the sharpest logic?
- Who's the debugging god?
- Who writes the best prose?
- Who dominates frontend?
- Who owns backend?
- Which model is fastest for daily driving?
- What new features are other harnesses shipping?

This plugin is the distillation of that experience. Just take the best. Got a better idea? PRs are welcome.

**Stop agonizing over agent harness choices.**
**I'll do the research, borrow from the best, and ship updates here.**

If this sounds arrogant and you have a better answer, please contribute. You're welcome.

I have no affiliation with any project or model mentioned here. This is purely personal experimentation and preference.

99% of this project was built using OpenCode. I tested for functionality—I don't really know how to write proper TypeScript. **But I personally reviewed and largely rewrote this doc, so read with confidence.**

## Warnings

- Productivity might spike too hard. Don't let your coworker notice.
  - Actually, I'll spread the word. Let's see who wins.
- If you're on [1.0.132](https://github.com/sst/opencode/releases/tag/v1.0.132) or older, an OpenCode bug may break config.
  - [The fix](https://github.com/sst/opencode/pull/5040) was merged after 1.0.132—use a newer version.
    - Fun fact: That PR was discovered and fixed thanks to OhMyOpenCode's Librarian, Explore, and Oracle setup.
