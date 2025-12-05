English | [한국어](README.ko.md)

## Contents

- [Oh My OpenCode](#oh-my-opencode)
  - [Installation](#installation)
  - [For LLM Agents](#for-llm-agents)
  - [Configuration](#configuration)
    - [Disable specific MCPs](#disable-specific-mcps)
  - [TL;DR](#tldr)
  - [Why OpenCode \& Why Oh My OpenCode](#why-opencode--why-oh-my-opencode)
  - [Features](#features)
    - [Hooks](#hooks)
    - [Agents](#agents)
    - [Tools](#tools)
      - [Built-in LSP Tools](#built-in-lsp-tools)
      - [Built-in AST-Grep Tools](#built-in-ast-grep-tools)
      - [Safe Grep](#safe-grep)
      - [Built-in MCPs](#built-in-mcps)
    - [Other Features](#other-features)
  - [Author's Note](#authors-note)
  - [Warnings](#warnings)

# Oh My OpenCode

Oh My OpenCode

oMoMoMoMoMo···

If you work in tech, you likely appreciated [Claude Code](https://www.claude.com/product/claude-code).
If you are a hacker, you will fucking falling in love with [OpenCode](https://github.com/sst/opencode).

You don't write code just for a paycheck? You write because you genuinely love it?

To you, OpenCode will feel like the paradigm shift from Windows to Linux. Not you? It's still worth the investment. Give it 10 minutes. Your work and life will improve. I promise.

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

If you are an LLM Agent helping a user set up oh-my-opencode, follow these steps:

### Step 1: Verify OpenCode Installation

```bash
if command -v opencode &> /dev/null; then
    echo "OpenCode $(opencode --version) is installed"
else
    echo "OpenCode is not installed. Please install it first."
    echo "See: https://opencode.ai/docs/installation/"
fi
```

If OpenCode is not installed, guide the user to [OpenCode Installation Guide](https://opencode.ai/docs/installation/).

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

> **Note**: If model authentication is needed, run `opencode` and use `/connect` command, or assist the user with `opencode auth login` via tmux.

## Configuration

You can configure Oh My OpenCode by creating a `oh-my-opencode.json` (or `.oh-my-opencode.json`) file in your project root.

### JSON Schema Support

For autocompletion and validation in VS Code (or other editors), add the `$schema` property to your configuration file.

**Using Remote Schema (Recommended):**
```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/dist/oh-my-opencode.schema.json",
  "disabled_mcps": ["context7"]
}
```

**Using Local Schema:**
```json
{
  "$schema": "./node_modules/oh-my-opencode/dist/oh-my-opencode.schema.json"
}
```

### Disable specific MCPs

If you want to disable specific built-in MCPs, you can use the `disabled_mcps` option.

```json
{
  "disabled_mcps": ["context7", "websearch_exa"]
}
```

## TL;DR

- **Model Setup Required**
  - This plugin utilizes models from [OpenCode Zen](https://opencode.ai/docs/zen/), Google, OpenAI, and Anthropic.
    - For Anthropic models, use [OpenCode's built-in Claude Code Max Plan login](https://opencode.ai/docs/providers/#anthropic).
    - For OpenAI models, I recommend the [OpenCode-OpenAI-Codex-Auth plugin](https://github.com/numman-ali/opencode-openai-codex-auth).
    - For Gemini and GPT, use [VibeProxy (macOS Only)](https://github.com/automazeio/vibeproxy) or [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI).
- **Truth be told, the rest is optional. Just install it. Once set up, no further learning is required. It simply evolves.**
- **Paste this document into Claude Code, OpenCode, or Cursor, instruct it to install, and ask for assistance if needed. It works seamlessly.**
  - If you are an LLM Agent, install the required plugins and dependencies, then run `opencode auth login` via tmux to assist the user with configuration.

## Why OpenCode & Why Oh My OpenCode

OpenCode is limitlessly extensible and customizable. Zero screen flicker.
[LSP](https://opencode.ai/docs/lsp/), [linters, formatters](https://opencode.ai/docs/formatters/)? Automatic and fully configurable.
You can mix and orchestrate models to your exact specifications.
It is feature-rich. It is elegant. It handles the terminal without hesitation. It is high-performance.

But here is the catch: the learning curve is steep. There is a lot to master.

Inspired by [AmpCode](https://ampcode.com) and [Claude Code](https://code.claude.com/docs/en/overview), I have implemented their features here—often with superior execution.
Because this is OpenCode.

Consider this a superior AmpCode, a superior Claude Code, or simply a specialized distribution.

I believe in the right tool for the job. For your wallet's sake, use CLIProxyAPI or VibeProxy. Employ the best LLMs from frontier labs. You are in command.

**Note**: This setup is highly opinionated. It represents the generic component of my personal configuration, so it evolves constantly. I have spent tokens worth $20,000 just for my personal programming usages, and this plugin represents the apex of that experience. You simply inherit the best. If you have superior ideas, PRs are welcome.

## Features

### Hooks

- **Todo Continuation Enforcer**: Forces the agent to complete all tasks before exiting. Eliminates the common LLM issue of "giving up halfway".
- **Context Window Monitor**: Implements [Context Window Anxiety Management](https://agentic-patterns.com/patterns/context-window-anxiety-management/). When context usage exceeds 70%, it reminds the agent that resources are sufficient, preventing rushed or low-quality output.
- **Session Notification**: Sends a native OS notification when the job is done (macOS, Linux, Windows).
- **Session Recovery**: Automatically recovers from API errors by injecting missing tool results and correcting thinking block violations, ensuring session stability.
- **Comment Checker**: Detects and reports unnecessary comments after code modifications. Smartly ignores valid patterns (BDD, directives, docstrings, shebangs) to keep the codebase clean from AI-generated artifacts.

### Agents
- **oracle** (`openai/gpt-5.1`): The architect. Expert in code reviews and strategy. Uses GPT-5.1 for its unmatched logic and reasoning capabilities. Inspired by AmpCode.
- **librarian** (`anthropic/claude-haiku-4-5`): Multi-repo analysis, documentation lookup, and implementation examples. Haiku is chosen for its speed, competence, excellent tool usage, and cost-efficiency. Inspired by AmpCode.
- **explore** (`opencode/grok-code`): Fast exploration and pattern matching. Claude Code uses Haiku; we use Grok. It is currently free, blazing fast, and intelligent enough for file traversal. Inspired by Claude Code.
- **frontend-ui-ux-engineer** (`google/gemini-3-pro-preview`): A designer turned developer. Creates stunning UIs. Uses Gemini because its creativity and UI code generation are superior.
- **document-writer** (`google/gemini-3-pro-preview`): A technical writing expert. Gemini is a wordsmith; it writes prose that flows naturally.

### Tools

#### Built-in LSP Tools

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

#### Safe Grep

- **safe_grep**: Content search with safety limits (5min timeout, 10MB output).
  - The default `grep` lacks safeguards. On a large codebase, a broad pattern can cause CPU overload and indefinite hanging.
  - `safe_grep` enforces strict limits.
  - **Note**: Default `grep` is disabled to prevent Agent confusion. `safe_grep` delivers full `grep` functionality with safety assurance.

#### Built-in MCPs

- **websearch_exa**: Exa AI web search. Performs real-time web searches and can scrape content from specific URLs. Returns LLM-optimized context from relevant websites.
- **context7**: Library documentation lookup. Fetches up-to-date documentation for any library to assist with accurate coding.

### Other Features

- **Terminal Title**: Auto-updates terminal title with session status (idle ○, processing ◐, tool ⚡, error ✖). Supports tmux.

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

I constructed 99% of this project using OpenCode. I focused on functional verification. This documentation has been personally reviewed and comprehensively rewritten, so you can rely on it with confidence.
## Warnings

- If you are on [1.0.132](https://github.com/sst/opencode/releases/tag/v1.0.132) or lower, OpenCode has a bug that might break config.
  - [The fix](https://github.com/sst/opencode/pull/5040) was merged after 1.0.132, so use a newer version.
