# Oh-My-OpenCode Features

## Agents: Your Teammates

- **Sisyphus** (`anthropic/claude-opus-4-5`): **The default agent.** A powerful AI orchestrator for OpenCode. Plans, delegates, and executes complex tasks using specialized subagents with aggressive parallel execution. Emphasizes background task delegation and todo-driven workflow. Uses Claude Opus 4.5 with extended thinking (32k budget) for maximum reasoning capability.
- **oracle** (`openai/gpt-5.2`): Architecture, code review, strategy. Uses GPT-5.2 for its stellar logical reasoning and deep analysis. Inspired by AmpCode.
- **librarian** (`opencode/glm-4.7-free`): Multi-repo analysis, doc lookup, implementation examples. Uses GLM-4.7 Free for deep codebase understanding and GitHub research with evidence-based answers. Inspired by AmpCode.
- **explore** (`opencode/grok-code`, `google/gemini-3-flash`, or `anthropic/claude-haiku-4-5`): Fast codebase exploration and pattern matching. Uses Gemini 3 Flash when Antigravity auth is configured, Haiku when Claude max20 is available, otherwise Grok. Inspired by Claude Code.
- **frontend-ui-ux-engineer** (`google/gemini-3-pro-preview`): A designer turned developer. Builds gorgeous UIs. Gemini excels at creative, beautiful UI code.
- **document-writer** (`google/gemini-3-flash`): Technical writing expert. Gemini is a wordsmith—writes prose that flows.
- **multimodal-looker** (`google/gemini-3-flash`): Visual content specialist. Analyzes PDFs, images, diagrams to extract information.

The main agent invokes these automatically, but you can call them explicitly:

```
Ask @oracle to review this design and propose an architecture
Ask @librarian how this is implemented—why does the behavior keep changing?
Ask @explore for the policy on this feature
```

Customize agent models, prompts, and permissions in `oh-my-opencode.json`. See [Configuration](../README.md#configuration).

---

## Background Agents: Work Like a Team

What if you could run these agents relentlessly, never letting them idle?

- Have GPT debug while Claude tries different approaches to find the root cause
- Gemini writes the frontend while Claude handles the backend
- Kick off massive parallel searches, continue implementation on other parts, then finish using the search results

These workflows are possible with OhMyOpenCode.

Run subagents in the background. The main agent gets notified on completion. Wait for results if needed.

**Make your agents work like your team works.**

---

## The Tools: Your Teammates Deserve Better

### Why Are You the Only One Using an IDE?

Syntax highlighting, autocomplete, refactoring, navigation, analysis—and now agents writing code...

**Why are you the only one with these tools?**
**Give them to your agents and watch them level up.**

[OpenCode provides LSP](https://opencode.ai/docs/lsp/), but only for analysis.

The features in your editor? Other agents can't touch them.
Hand your best tools to your best colleagues. Now they can properly refactor, navigate, and analyze.

- **lsp_diagnostics**: Get errors/warnings before build
- **lsp_prepare_rename**: Validate rename operation
- **lsp_rename**: Rename symbol across workspace
- **ast_grep_search**: AST-aware code pattern search (25 languages)
- **ast_grep_replace**: AST-aware code replacement
- **call_omo_agent**: Spawn specialized explore/librarian agents. Supports `run_in_background` parameter for async execution.
- **delegate_task**: Category-based task delegation with specialized agents. Supports pre-configured categories (visual, business-logic) or direct agent targeting. Use `background_output` to retrieve results and `background_cancel` to cancel tasks. See [Categories](../README.md#categories).

### Session Management

Tools to navigate and search your OpenCode session history:

- **session_list**: List all OpenCode sessions with filtering by date and limit
- **session_read**: Read messages and history from a specific session
- **session_search**: Full-text search across session messages
- **session_info**: Get metadata and statistics about a session

These tools enable agents to reference previous conversations and maintain continuity across sessions.

### Context Is All You Need

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
  - **websearch**: Real-time web search powered by [Exa AI](https://exa.ai)
  - **context7**: Official documentation lookup
  - **grep_app**: Ultra-fast code search across public GitHub repos (great for finding implementation examples)

### Be Multimodal. Save Tokens.

The look_at tool from AmpCode, now in OhMyOpenCode.
Instead of the agent reading massive files and bloating context, it internally leverages another agent to extract just what it needs.

### I Removed Their Blockers

- Replaces built-in grep and glob tools. Default implementation has no timeout—can hang forever.

### Skill-Embedded MCP Support

Skills can now bring their own MCP servers. Define MCP configurations directly in skill frontmatter or via `mcp.json` files:

```yaml
---
description: Browser automation skill
mcp:
  playwright:
    command: npx
    args: ["-y", "@anthropic-ai/mcp-playwright"]
---
```

When you load a skill with embedded MCP, its tools become available automatically. The `skill_mcp` tool lets you invoke these MCP operations with full schema discovery.

**Built-in Skills:**
- **playwright**: Browser automation, web scraping, testing, and screenshots out of the box

Disable built-in skills via `disabled_skills: ["playwright"]` in your config.

---

## Goodbye Claude Code. Hello Oh My OpenCode.

Oh My OpenCode has a Claude Code compatibility layer.
If you were using Claude Code, your existing config just works.

### Hooks Integration

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

### Config Loaders

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

### Data Storage

**Todo Management**: Session todos stored in `~/.claude/todos/` in Claude Code compatible format.

**Transcript**: Session activity logged to `~/.claude/transcripts/` in JSONL format for replay and analysis.

### Compatibility Toggles

Disable specific Claude Code compatibility features with the `claude_code` config object:

```json
{
  "claude_code": {
    "mcp": false,
    "commands": false,
    "skills": false,
    "agents": false,
    "hooks": false,
    "plugins": false
  }
}
```

| Toggle     | When `false`, stops loading from...                                                   | Unaffected                                            |
| ---------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `mcp`      | `~/.claude/.mcp.json`, `./.mcp.json`, `./.claude/.mcp.json`                           | Built-in MCP (context7, grep_app)                     |
| `commands` | `~/.claude/commands/*.md`, `./.claude/commands/*.md`                                  | `~/.config/opencode/command/`, `./.opencode/command/` |
| `skills`   | `~/.claude/skills/*/SKILL.md`, `./.claude/skills/*/SKILL.md`                          | -                                                     |
| `agents`   | `~/.claude/agents/*.md`, `./.claude/agents/*.md`                                      | Built-in agents (oracle, librarian, etc.)             |
| `hooks`    | `~/.claude/settings.json`, `./.claude/settings.json`, `./.claude/settings.local.json` | -                                                     |
| `plugins`  | `~/.claude/plugins/` (Claude Code marketplace plugins)                                | -                                                     |

All toggles default to `true` (enabled). Omit the `claude_code` object for full Claude Code compatibility.

**Selectively disable specific plugins** using `plugins_override`:

```json
{
  "claude_code": {
    "plugins_override": {
      "claude-mem@thedotmack": false,
      "some-other-plugin@marketplace": false
    }
  }
}
```

This allows you to keep the plugin system enabled while disabling specific plugins by their full identifier (`plugin-name@marketplace-name`).

---

## Not Just for the Agents

When agents thrive, you thrive. But I want to help you directly too.

- **Ralph Loop**: Self-referential development loop that runs until task completion. Inspired by Anthropic's Ralph Wiggum plugin. **Supports all programming languages.**
  - Start with `/ralph-loop "Build a REST API"` and let the agent work continuously
  - Loop detects `<promise>DONE</promise>` to know when complete
  - Auto-continues if agent stops without completion promise
  - Ends when: completion detected, max iterations reached (default 100), or `/cancel-ralph`
  - Configure in `oh-my-opencode.json`: `{ "ralph_loop": { "enabled": true, "default_max_iterations": 100 } }`
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
- **Auto Update Checker**: Automatically checks for new versions of oh-my-opencode and can auto-update your configuration. Shows startup toast notifications displaying current version and Sisyphus status ("Sisyphus on steroids is steering OpenCode" when enabled, or "OpenCode is now on Steroids. oMoMoMoMo..." otherwise). Disable all features with `"auto-update-checker"` in `disabled_hooks`, or disable just toast notifications with `"startup-toast"` in `disabled_hooks`. See [Configuration > Hooks](../README.md#hooks).
- **Background Notification**: Get notified when background agent tasks complete.
- **Session Notification**: Sends OS notifications when agents go idle. Works on macOS, Linux, and Windows—never miss when your agent needs input.
- **Empty Task Response Detector**: Catches when Task tool returns nothing. Warns you about potential agent failures so you don't wait forever for a response that already came back empty.
- **Empty Message Sanitizer**: Prevents API errors from empty chat messages by automatically sanitizing message content before sending.
- **Grep Output Truncator**: Grep can return mountains of text. This dynamically truncates output based on your remaining context window—keeps 50% headroom, caps at 50k tokens.
- **Tool Output Truncator**: Same idea, broader scope. Truncates output from Grep, Glob, LSP tools, and AST-grep. Prevents one verbose search from eating your entire context.
- **Preemptive Compaction**: Compacts session proactively before hitting hard token limits. Runs at 85% context window usage. **Enabled by default.** Disable via `disabled_hooks: ["preemptive-compaction"]`.
- **Compaction Context Injector**: Preserves critical context (AGENTS.md, current directory info) during session compaction so you don't lose important state.
- **Thinking Block Validator**: Validates thinking blocks to ensure proper formatting and prevent API errors from malformed thinking content.
- **Claude Code Hooks**: Executes hooks from Claude Code's settings.json - this is the compatibility layer that runs PreToolUse/PostToolUse/UserPromptSubmit/Stop hooks.
