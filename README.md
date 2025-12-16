<!-- <CENTERED SECTION FOR GITHUB DISPLAY> -->

<div align="center">

[![Oh My OpenCode](./.github/assets/hero.jpg)](https://github.com/code-yeongyu/oh-my-opencode#oh-my-opencode)

[![Preview](./.github/assets/preview.png)](https://github.com/code-yeongyu/oh-my-opencode#oh-my-opencode)


</div>

> This is coding on steroids—`oh-my-opencode` in action. Run background agents, call specialized agents like oracle, librarian, and frontend engineer. Use crafted LSP/AST tools, curated MCPs, and a full Claude Code compatibility layer.

**START WITH YOUR ChatGPT, Claude, Gemini SUBSCRIPTIONS. WE ALL COVER THEM.**

<div align="center">

[![GitHub Release](https://img.shields.io/github/v/release/code-yeongyu/oh-my-opencode?color=369eff&labelColor=black&logo=github&style=flat-square)](https://github.com/code-yeongyu/oh-my-opencode/releases)
[![GitHub Contributors](https://img.shields.io/github/contributors/code-yeongyu/oh-my-opencode?color=c4f042&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-opencode/graphs/contributors)
[![GitHub Forks](https://img.shields.io/github/forks/code-yeongyu/oh-my-opencode?color=8ae8ff&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-opencode/network/members)
[![GitHub Stars](https://img.shields.io/github/stars/code-yeongyu/oh-my-opencode?color=ffcb47&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-opencode/stargazers)
[![GitHub Issues](https://img.shields.io/github/issues/code-yeongyu/oh-my-opencode?color=ff80eb&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-opencode/issues)
[![License](https://img.shields.io/badge/license-MIT-white?labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-opencode/blob/master/LICENSE)

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md)

</div>

<!-- </CENTERED SECTION FOR GITHUB DISPLAY> -->

## Contents

- [Oh My OpenCode](#oh-my-opencode)
  - [Just Skip Reading This Readme](#just-skip-reading-this-readme)
    - [It's the Age of Agents](#its-the-age-of-agents)
    - [For Those Who Want to Read](#for-those-who-want-to-read)
      - [Just Install It.](#just-install-it)
  - [Installation](#installation)
    - [For Humans](#for-humans)
    - [For LLM Agents](#for-llm-agents)
    - [Step 0: Ask user about the setup.](#step-0-ask-user-about-the-setup)
    - [Step 1: Install OpenCode, if not](#step-1-install-opencode-if-not)
    - [Step 2: Configure oh-my-opencode Plugin](#step-2-configure-oh-my-opencode-plugin)
      - [JSONC](#jsonc)
      - [JSON](#json)
    - [Step 3: Verify Setup](#step-3-verify-setup)
    - [Step 4: Configure Authentication](#step-4-configure-authentication)
      - [Anthropic (Claude)](#anthropic-claude)
      - [Google Gemini (Antigravity OAuth)](#google-gemini-antigravity-oauth)
      - [OpenAI (ChatGPT Plus/Pro)](#openai-chatgpt-pluspro)
        - [Model Configuration](#model-configuration)
    - [⚠️ Warning](#️-warning)
    - [Verify the setup](#verify-the-setup)
    - [Say 'Congratulations! 🎉' to the user](#say-congratulations--to-the-user)
    - [Too Complicated?](#too-complicated)
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
      - [Permission Options](#permission-options)
    - [OmO Agent](#omo-agent)
    - [Hooks](#hooks)
    - [MCPs](#mcps)
    - [LSP](#lsp)
  - [Author's Note](#authors-note)
  - [Warnings](#warnings)

# Oh My OpenCode

oMoMoMoMoMo···


[Claude Code](https://www.claude.com/product/claude-code) is great.
But if you're a hacker, you'll fall head over heels for [OpenCode](https://github.com/sst/opencode).
**START WITH YOUR ChatGPT, Claude, Gemini SUBSCRIPTIONS. WE ALL COVER THEM.**

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

## Just Skip Reading This Readme

### It's the Age of Agents
- **Just paste this link into Claude Code / AmpCode / Factory Droid / Cursor and ask it to explain.**
  - Ask why it's good, why it's not just another boilerplate setup, what actually gets better.
  - If you're an LLM agent, explain to the user what becomes possible right now with this project.

### For Those Who Want to Read

Welcome. Introducing OmO (Oh-Mo).
Everything below is customizable. Take what you want. All features are enabled by default. You don't have to do anything.

- Claude Code Compatibility: Command, Agent, Skill, MCP, Hook(PreToolUse, PostToolUse, UserPromptSubmit, Stop)
- Full LSP / AstGrep Support: Refactor with confidence.
- Todo Continuation Enforcer: Forces the agent to continue if it quits halfway.
- Comment Checker: Prevents AI from adding excessive comments.
- Curated Agents
  - OmO: Super smart main agent (Opus 4.5 High)
  - Oracle: Design, debugging (GPT 5.2 Medium)
  - Frontend UI/UX Engineer: Frontend development (Gemini 3 Pro)
  - Librarian: Official docs, open source implementations, codebase exploration (Claude Sonnet 4.5)
  - Explore: Blazing fast codebase exploration (Contextual Grep) (Grok Code)
- Curated MCPs:
  - Exa (Web Search)
  - Context7 (Official Documentation)
  - Grep.app (GitHub Code Search)
- Interactive Terminal Supported - Tmux Integration
- Async Agents
- ...

#### Just Install It.

Just by installing this, you make your agents to work like:

1. While Gemini 3 Pro writes the frontend as a background task, Claude Opus 4.5 handles the backend. Stuck debugging? Call GPT 5.2 for help. When the frontend reports done, verify and ship.
2. Need to look something up? It scours official docs, your entire codebase history, and public GitHub implementations—using not just grep but built-in LSP tools and AST-Grep.
3. Stop worrying about context management when delegating to LLMs. I've got it covered.
    - OhMyOpenCode aggressively leverages multiple agents to lighten the context load.
    - **Your agent is now the dev team lead. You're the AI Manager.**
4. It doesn't stop until the job is done.
5. Don't want to dive deep into this project? No problem. Just type 'ultrathink'.

If you don't want all this, as mentioned, you can just pick and choose specific features.

## Installation


### For Humans

Let the LLM Agent handle the grunt work. Paste this link and ask it to install and configure.

### For LLM Agents

<details>
<summary>Instructions for LLM Agents (click to expand)</summary>

If you're an LLM Agent helping set up oh-my-opencode, Welcome! You'll now help your user to install the best agent harness, OhMyOpenCode. Tell user this with greetings, with test 'oMoMoMoMo...'

follow these steps:

### Step 0: Ask user about the setup.

Since OpenCode Supports various models, and our plugin suggests various frontier LLMs. Thus, you must ask user, following questions:
1. Do you have a Claude Pro/Max Subscription? Otherwise, we'll use 'opencode/big-pickle' (known for glm 4.6) as a main orchestrator model (not recommended)
  -> If user said yes, add ToDo: "Setup user Claude Pro/Max Auth"
  -> If user said no, add ToDo: "Override OmO agent model on oh-my-opencode.json as opencode/big-pickle"
2. Do you have a ChatGPT Subscription? Otherwise, we'll use 'claude-opus-4-5' with 32k thinking option for oracle agent.
  -> If user said yes, add ToDo: "Setup user ChatGPT Auth"
  -> If user said no, add ToDo: "Override oracle agent model on oh-my-opencode.json as claude-opus-4-5 with 32k thinking"
3. Will you integrate Gemini models? Otherwise, you cannot enjoy the beautiful design.
  -> If user said yes, add ToDo: "Setup Google OAuth"
  -> If user said no, add ToDo: "Override frontend-ui-ux-engineer agent model on oh-my-opencode.json as claude-opus-4-5 with 32k thinking"

### Step 1: Install OpenCode, if not

Run following command to verify OpenCode Installation:

```bash
if command -v opencode &> /dev/null; then
    echo "OpenCode $(opencode --version) is installed"
else
    echo "OpenCode is not installed. Please install it first."
    echo "Ref: https://opencode.ai/docs"
fi
```

If OpenCode isn't installed, check the [OpenCode Installation Guide](https://opencode.ai/docs).
Spawn a subagent to handle installation and report back - to save context.

### Step 2: Configure oh-my-opencode Plugin

#### JSONC
- If `~/.config/opencode/opencode.jsonc` exists, work in there to add `oh-my-opencode` plugin

#### JSON
- If no opencode.jsonc exists, run following command to create and register it.

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
cat ~/.config/opencode/opencode.json  # Should contain "oh-my-opencode" in plugin array, or maybe check jsonc
```

### Step 4: Configure Authentication

As your todo, please configure authentication as user have answered to you.
Following is the configuration guides for each providers. Please use interactive terminal like tmux to do following:

#### Anthropic (Claude)

```bash
opencode auth login
# Interactive Terminal: find Provider: Select Anthropic
# Interactive Terminal: find Login method: Select Claude Pro/Max
# Guide user through OAuth flow in browser
# Wait for completion
# Verify success and confirm with user
```

#### Google Gemini (Antigravity OAuth)

Then authenticate:

```bash
opencode auth login
# Interactive Terminal: find Provider: Select Google
# Interactive Terminal: find Login method: Select Google
# Guide user through OAuth flow in browser. You use tools like pbcopy or other equivalents depending on your OS, and tell user that you have copied the link and paste it to the browser
# Wait for completion
# Verify success and confirm with user
```

#### OpenAI (ChatGPT Plus/Pro)

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

##### Model Configuration
You'll also need full model settings in `opencode.json`.
Read the [opencode-openai-codex-auth documentation](https://github.com/numman-ali/opencode-openai-codex-auth), copy provider/models config from [`config/full-opencode.json`](https://github.com/numman-ali/opencode-openai-codex-auth/blob/main/config/full-opencode.json), and merge carefully to avoid breaking the user's existing setup.

Then authenticate:

```bash
opencode auth login
# Interactive Terminal: Provider: Select OpenAI
# Interactive Terminal: Login method: Select ChatGPT Plus/Pro (Codex Subscription)
# Interactive Terminal: Guide user through OAuth flow in browser
# Wait for completion
# Verify success and confirm with user
```


### ⚠️ Warning

**Unless the user explicitly requests it, do not change model settings or disable features (agents, hooks, MCPs).**

The plugin works perfectly by default. Except for the recommended `google_auth: true` setting, do not change other settings or turn off features without an explicit request.

### Verify the setup

Read this document again, think about you have done everything correctly.

### Say 'Congratulations! 🎉' to the user

Say to user: Congratulations! 🎉 You have successfully set up OhMyOpenCode! Type `opencode` in your terminal to start using it.

And as our readme suggests, list some catalogs and the features that our plugin suggests- with some great usecase examples that you can imagine.

### Too Complicated?

If this all seems overwhelming, just remember one thing: **include the word `ultrawork` in your prompt**.

That's it. The agent will figure out the rest and handle everything automatically.

</details>


## Features

### Agents: Your Teammates

- **OmO** (`anthropic/claude-opus-4-5`): **The default agent.** A powerful AI orchestrator for OpenCode. Plans, delegates, and executes complex tasks using specialized subagents with aggressive parallel execution. Emphasizes background task delegation and todo-driven workflow. Uses Claude Opus 4.5 with extended thinking (32k budget) for maximum reasoning capability.
- **oracle** (`openai/gpt-5.2`): Architecture, code review, strategy. Uses GPT-5.2 for its stellar logical reasoning and deep analysis. Inspired by AmpCode.
- **librarian** (`anthropic/claude-sonnet-4-5`): Multi-repo analysis, doc lookup, implementation examples. Uses Claude Sonnet 4.5 for deep codebase understanding and GitHub research with evidence-based answers. Inspired by AmpCode.
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
- **Auto Update Checker**: Notifies you when a new version of oh-my-opencode is available.
- **Startup Toast**: Shows a welcome message when OhMyOpenCode loads. A little "oMoMoMo" to start your session right.
- **Background Notification**: Get notified when background agent tasks complete.
- **Session Notification**: Sends OS notifications when agents go idle. Works on macOS, Linux, and Windows—never miss when your agent needs input.
- **Empty Task Response Detector**: Catches when Task tool returns nothing. Warns you about potential agent failures so you don't wait forever for a response that already came back empty.
- **Empty Message Sanitizer**: Prevents API errors from empty chat messages by automatically sanitizing message content before sending.
- **Grep Output Truncator**: Grep can return mountains of text. This dynamically truncates output based on your remaining context window—keeps 50% headroom, caps at 50k tokens.
- **Tool Output Truncator**: Same idea, broader scope. Truncates output from Grep, Glob, LSP tools, and AST-grep. Prevents one verbose search from eating your entire context.

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

You can also override settings for `OmO` (the main orchestrator) and `build` (the default agent) using the same options.

#### Permission Options

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
  "disabled_agents": ["oracle", "frontend-ui-ux-engineer"]
}
```

Available agents: `oracle`, `librarian`, `explore`, `frontend-ui-ux-engineer`, `document-writer`, `multimodal-looker`

### OmO Agent

When enabled (default), OmO adds two primary agents and demotes the built-in agents to subagents:

- **OmO**: Primary orchestrator agent (Claude Opus 4.5)
- **OmO-Plan**: Inherits all settings from OpenCode's plan agent at runtime (description appended with "OhMyOpenCode version")
- **build**: Demoted to subagent
- **plan**: Demoted to subagent

To disable OmO and restore the original build/plan agents:

```json
{
  "omo_agent": {
    "disabled": true
  }
}
```

You can also customize OmO and OmO-Plan like other agents:

```json
{
  "agents": {
    "OmO": {
      "model": "anthropic/claude-sonnet-4",
      "temperature": 0.3
    },
    "OmO-Plan": {
      "model": "openai/gpt-5.2"
    }
  }
}
```

| Option     | Default | Description                                                                                                                                   |
| ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `disabled` | `false` | When `true`, disables OmO agents and restores original build/plan as primary. When `false` (default), OmO and OmO-Plan become primary agents. |

### Hooks

Disable specific built-in hooks via `disabled_hooks` in `~/.config/opencode/oh-my-opencode.json` or `.opencode/oh-my-opencode.json`:

```json
{
  "disabled_hooks": ["comment-checker", "agent-usage-reminder"]
}
```

Available hooks: `todo-continuation-enforcer`, `context-window-monitor`, `session-recovery`, `session-notification`, `comment-checker`, `grep-output-truncator`, `tool-output-truncator`, `directory-agents-injector`, `directory-readme-injector`, `empty-task-response-detector`, `think-mode`, `anthropic-auto-compact`, `rules-injector`, `background-notification`, `auto-update-checker`, `startup-toast`, `keyword-detector`, `agent-usage-reminder`, `non-interactive-env`, `interactive-bash-session`, `empty-message-sanitizer`

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

*Special thanks to [@junhoyeo](https://github.com/junhoyeo) for this amazing hero image.*
