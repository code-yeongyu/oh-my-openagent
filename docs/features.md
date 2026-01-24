# Oh-My-OpenCode Features

---

## Agents: Your AI Team

Oh-My-OpenCode provides 10 specialized AI agents. Each has distinct expertise, optimized models, and tool permissions.

### Core Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| **Sisyphus** | `anthropic/claude-opus-4-5` | **The default orchestrator.** Plans, delegates, and executes complex tasks using specialized subagents with aggressive parallel execution. Todo-driven workflow with extended thinking (32k budget). |
| **oracle** | `openai/gpt-5.2` | Architecture decisions, code review, debugging. Read-only consultation - stellar logical reasoning and deep analysis. Inspired by AmpCode. |
| **librarian** | `opencode/big-pickle` | Multi-repo analysis, documentation lookup, OSS implementation examples. Deep codebase understanding with evidence-based answers. Inspired by AmpCode. |
| **explore** | `opencode/gpt-5-nano` | Fast codebase exploration and contextual grep. Uses Gemini 3 Flash when Antigravity auth is configured, Haiku when Claude max20 is available, otherwise Grok. Inspired by Claude Code. |
| **multimodal-looker** | `google/gemini-3-flash` | Visual content specialist. Analyzes PDFs, images, diagrams to extract information. Saves tokens by having another agent process media. |

### Planning Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| **Prometheus** | `anthropic/claude-opus-4-5` | Strategic planner with interview mode. Creates detailed work plans through iterative questioning. |
| **Metis** | `anthropic/claude-sonnet-4-5` | Plan consultant - pre-planning analysis. Identifies hidden intentions, ambiguities, and AI failure points. |
| **Momus** | `anthropic/claude-sonnet-4-5` | Plan reviewer - validates plans against clarity, verifiability, and completeness standards. |

### Invoking Agents

The main agent invokes these automatically, but you can call them explicitly:

```
Ask @oracle to review this design and propose an architecture
Ask @librarian how this is implemented - why does the behavior keep changing?
Ask @explore for the policy on this feature
```

### Tool Restrictions

| Agent | Restrictions |
|-------|-------------|
| oracle | Read-only: cannot write, edit, or delegate |
| librarian | Cannot write, edit, or delegate |
| explore | Cannot write, edit, or delegate |
| multimodal-looker | Allowlist only: read, glob, grep |

### Background Agents

Run agents in the background and continue working:

- Have GPT debug while Claude tries different approaches
- Gemini writes frontend while Claude handles backend
- Fire massive parallel searches, continue implementation, use results when ready

```
# Launch in background
delegate_task(agent="explore", background=true, prompt="Find auth implementations")

# Continue working...
# System notifies on completion

# Retrieve results when needed
background_output(task_id="bg_abc123")
```

Customize agent models, prompts, and permissions in `oh-my-opencode.json`. See [Configuration](configurations.md#agents).

---

## Skills: Specialized Knowledge

Skills provide specialized workflows with embedded MCP servers and detailed instructions.

### Built-in Skills

| Skill | Trigger | Description |
|-------|---------|-------------|
| **playwright** | Browser tasks, testing, screenshots | Browser automation via Playwright MCP. MUST USE for any browser-related tasks - verification, browsing, web scraping, testing, screenshots. |
| **frontend-ui-ux** | UI/UX tasks, styling | Designer-turned-developer persona. Crafts stunning UI/UX even without design mockups. Emphasizes bold aesthetic direction, distinctive typography, cohesive color palettes. |
| **git-master** | commit, rebase, squash, blame | MUST USE for ANY git operations. Atomic commits with automatic splitting, rebase/squash workflows, history search (blame, bisect, log -S). |

### Skill: playwright

**Trigger**: Any browser-related request

Provides browser automation via Playwright MCP server:

```yaml
mcp:
  playwright:
    command: npx
    args: ["@playwright/mcp@latest"]
```

**Capabilities**:
- Navigate and interact with web pages
- Take screenshots and PDFs
- Fill forms and click elements
- Wait for network requests
- Scrape content

**Usage**:
```
/playwright Navigate to example.com and take a screenshot
```

### Skill: frontend-ui-ux

**Trigger**: UI design tasks, visual changes

A designer-turned-developer who crafts stunning interfaces:

- **Design Process**: Purpose, Tone, Constraints, Differentiation
- **Aesthetic Direction**: Choose extreme - brutalist, maximalist, retro-futuristic, luxury, playful
- **Typography**: Distinctive fonts, avoid generic (Inter, Roboto, Arial)
- **Color**: Cohesive palettes with sharp accents, avoid purple-on-white AI slop
- **Motion**: High-impact staggered reveals, scroll-triggering, surprising hover states
- **Anti-Patterns**: Generic fonts, predictable layouts, cookie-cutter design

### Skill: git-master

**Trigger**: commit, rebase, squash, "who wrote", "when was X added"

Three specializations in one:

1. **Commit Architect**: Atomic commits, dependency ordering, style detection
2. **Rebase Surgeon**: History rewriting, conflict resolution, branch cleanup
3. **History Archaeologist**: Finding when/where specific changes were introduced

**Core Principle - Multiple Commits by Default**:
```
3+ files -> MUST be 2+ commits
5+ files -> MUST be 3+ commits
10+ files -> MUST be 5+ commits
```

**Automatic Style Detection**:
- Analyzes last 30 commits for language (Korean/English) and style (semantic/plain/short)
- Matches your repo's commit conventions automatically

**Usage**:
```
/git-master commit these changes
/git-master rebase onto main
/git-master who wrote this authentication code?
```

### Custom Skills

Load custom skills from:
- `.opencode/skills/*/SKILL.md` (project)
- `~/.config/opencode/skills/*/SKILL.md` (user)
- `.claude/skills/*/SKILL.md` (Claude Code compat)
- `~/.claude/skills/*/SKILL.md` (Claude Code user)

Disable built-in skills via `disabled_skills: ["playwright"]` in config.

---

## Commands: Slash Workflows

Commands are slash-triggered workflows that execute predefined templates.

### Built-in Commands

| Command | Description |
|---------|-------------|
| `/init-deep` | Initialize hierarchical AGENTS.md knowledge base |
| `/ralph-loop` | Start self-referential development loop until completion |
| `/ulw-loop` | Start ultrawork loop - continues with ultrawork mode |
| `/cancel-ralph` | Cancel active Ralph Loop |
| `/refactor` | Intelligent refactoring with LSP, AST-grep, architecture analysis, and TDD verification |
| `/start-work` | Start Sisyphus work session from Prometheus plan |

### Command: /init-deep

**Purpose**: Generate hierarchical AGENTS.md files throughout your project

**Usage**:
```
/init-deep [--create-new] [--max-depth=N]
```

Creates directory-specific context files that agents automatically read:
```
project/
├── AGENTS.md              # Project-wide context
├── src/
│   ├── AGENTS.md          # src-specific context
│   └── components/
│       └── AGENTS.md      # Component-specific context
```

### Command: /ralph-loop

**Purpose**: Self-referential development loop that runs until task completion

**Named after**: Anthropic's Ralph Wiggum plugin

**Usage**:
```
/ralph-loop "Build a REST API with authentication"
/ralph-loop "Refactor the payment module" --max-iterations=50
```

**Behavior**:
- Agent works continuously toward the goal
- Detects `<promise>DONE</promise>` to know when complete
- Auto-continues if agent stops without completion
- Ends when: completion detected, max iterations reached (default 100), or `/cancel-ralph`

**Configure**: `{ "ralph_loop": { "enabled": true, "default_max_iterations": 100 } }`

### Command: /ulw-loop

**Purpose**: Same as ralph-loop but with ultrawork mode active

Everything runs at maximum intensity - parallel agents, background tasks, aggressive exploration.

### Command: /refactor

**Purpose**: Intelligent refactoring with full toolchain

**Usage**:
```
/refactor <target> [--scope=<file|module|project>] [--strategy=<safe|aggressive>]
```

**Features**:
- LSP-powered rename and navigation
- AST-grep for pattern matching
- Architecture analysis before changes
- TDD verification after changes
- Codemap generation

### Command: /start-work

**Purpose**: Start execution from a Prometheus-generated plan

**Usage**:
```
/start-work [plan-name]
```

Uses atlas agent to execute planned tasks systematically.

### Custom Commands

Load custom commands from:
- `.opencode/command/*.md` (project)
- `~/.config/opencode/command/*.md` (user)
- `.claude/commands/*.md` (Claude Code compat)
- `~/.claude/commands/*.md` (Claude Code user)

---

## Hooks: Lifecycle Automation

Hooks intercept and modify behavior at key points in the agent lifecycle.

### Hook Events

| Event | When | Can |
|-------|------|-----|
| **PreToolUse** | Before tool execution | Block, modify input, inject context |
| **PostToolUse** | After tool execution | Add warnings, modify output, inject messages |
| **UserPromptSubmit** | When user submits prompt | Block, inject messages, transform prompt |
| **Stop** | When session goes idle | Inject follow-up prompts |

### Built-in Hooks

#### Context & Injection

| Hook | Event | Description |
|------|-------|-------------|
| **directory-agents-injector** | PostToolUse | Auto-injects AGENTS.md when reading files. Walks from file to project root, collecting all AGENTS.md files. |
| **directory-readme-injector** | PostToolUse | Auto-injects README.md for directory context. |
| **rules-injector** | PostToolUse | Injects rules from `.claude/rules/` when conditions match. Supports globs and alwaysApply. |
| **compaction-context-injector** | Stop | Preserves critical context during session compaction. |

#### Productivity & Control

| Hook | Event | Description |
|------|-------|-------------|
| **keyword-detector** | UserPromptSubmit | Detects keywords and activates modes: `ultrawork`/`ulw` (max performance), `search`/`find` (parallel exploration), `analyze`/`investigate` (deep analysis). |
| **think-mode** | UserPromptSubmit | Auto-detects extended thinking needs. Catches "think deeply", "ultrathink" and adjusts model settings. |
| **ralph-loop** | Stop | Manages self-referential loop continuation. |
| **start-work** | PostToolUse | Handles /start-work command execution. |
| **auto-slash-command** | UserPromptSubmit | Automatically executes slash commands from prompts. |

#### Quality & Safety

| Hook | Event | Description |
|------|-------|-------------|
| **comment-checker** | PostToolUse | Reminds agents to reduce excessive comments. Smartly ignores BDD, directives, docstrings. |
| **thinking-block-validator** | PreToolUse | Validates thinking blocks to prevent API errors. |
| **empty-message-sanitizer** | PreToolUse | Prevents API errors from empty chat messages. |
| **edit-error-recovery** | PostToolUse | Recovers from edit tool failures. |

#### Recovery & Stability

| Hook | Event | Description |
|------|-------|-------------|
| **session-recovery** | Stop | Recovers from session errors - missing tool results, thinking block issues, empty messages. |
| **anthropic-context-window-limit-recovery** | Stop | Handles Claude context window limits gracefully. |
| **background-compaction** | Stop | Auto-compacts sessions hitting token limits. |

#### Truncation & Context Management

| Hook | Event | Description |
|------|-------|-------------|
| **grep-output-truncator** | PostToolUse | Dynamically truncates grep output based on context window. Keeps 50% headroom, caps at 50k tokens. |
| **tool-output-truncator** | PostToolUse | Truncates output from Grep, Glob, LSP, AST-grep tools. |

#### Notifications & UX

| Hook | Event | Description |
|------|-------|-------------|
| **auto-update-checker** | UserPromptSubmit | Checks for new versions, shows startup toast with version and Sisyphus status. |
| **background-notification** | Stop | Notifies when background agent tasks complete. |
| **session-notification** | Stop | OS notifications when agents go idle. Works on macOS, Linux, Windows. |
| **agent-usage-reminder** | PostToolUse | Reminds you to leverage specialized agents for better results. |

#### Task Management

| Hook | Event | Description |
|------|-------|-------------|
| **task-resume-info** | PostToolUse | Provides task resume information for continuity. |
| **delegate-task-retry** | PostToolUse | Retries failed delegate_task calls. |

#### Integration

| Hook | Event | Description |
|------|-------|-------------|
| **claude-code-hooks** | All | Executes hooks from Claude Code's settings.json. |
| **atlas** | All | Main orchestration logic (771 lines). |
| **interactive-bash-session** | PreToolUse | Manages tmux sessions for interactive CLI. |
| **non-interactive-env** | PreToolUse | Handles non-interactive environment constraints. |

#### Specialized

| Hook | Event | Description |
|------|-------|-------------|
| **prometheus-md-only** | PostToolUse | Enforces markdown-only output for Prometheus planner. |

### Claude Code Hooks Integration

Run custom scripts via Claude Code's `settings.json`:

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

**Hook locations**:
- `~/.claude/settings.json` (user)
- `./.claude/settings.json` (project)
- `./.claude/settings.local.json` (local, git-ignored)

### Disabling Hooks

Disable specific hooks in config:

```json
{
  "disabled_hooks": [
    "comment-checker",
    "auto-update-checker",
    "startup-toast"
  ]
}
```

---

## Tools: Agent Capabilities

### LSP Tools (IDE Features for Agents)

| Tool | Description |
|------|-------------|
| **lsp_diagnostics** | Get errors/warnings before build |
| **lsp_prepare_rename** | Validate rename operation |
| **lsp_rename** | Rename symbol across workspace |
| **lsp_goto_definition** | Jump to symbol definition |
| **lsp_find_references** | Find all usages across workspace |
| **lsp_symbols** | Get file outline or workspace symbol search |

### AST-Grep Tools

| Tool | Description |
|------|-------------|
| **ast_grep_search** | AST-aware code pattern search (25 languages) |
| **ast_grep_replace** | AST-aware code replacement |

### Delegation Tools

| Tool | Description |
|------|-------------|
| **call_omo_agent** | Spawn explore/librarian agents. Supports `run_in_background`. |
| **delegate_task** | Category-based task delegation. Supports categories (visual, business-logic) or direct agent targeting. |
| **background_output** | Retrieve background task results |
| **background_cancel** | Cancel running background tasks |

### Session Tools

| Tool | Description |
|------|-------------|
| **session_list** | List all OpenCode sessions |
| **session_read** | Read messages and history from a session |
| **session_search** | Full-text search across session messages |
| **session_info** | Get session metadata and statistics |

---

## MCPs: Built-in Servers

### websearch (Exa AI)

Real-time web search powered by [Exa AI](https://exa.ai).

### context7

Official documentation lookup for any library/framework.

### grep_app

Ultra-fast code search across public GitHub repos. Great for finding implementation examples.

### Skill-Embedded MCPs

Skills can bring their own MCP servers:

```yaml
---
description: Browser automation skill
mcp:
  playwright:
    command: npx
    args: ["-y", "@anthropic-ai/mcp-playwright"]
---
```

The `skill_mcp` tool invokes these operations with full schema discovery.

---

## Context Injection

### Directory AGENTS.md

Auto-injects AGENTS.md when reading files. Walks from file directory to project root:

```
project/
├── AGENTS.md              # Injected first
├── src/
│   ├── AGENTS.md          # Injected second
│   └── components/
│       ├── AGENTS.md      # Injected third
│       └── Button.tsx     # Reading this injects all 3
```

### Conditional Rules

Inject rules from `.claude/rules/` when conditions match:

```markdown
---
globs: ["*.ts", "src/**/*.js"]
description: "TypeScript/JavaScript coding rules"
---
- Use PascalCase for interface names
- Use camelCase for function names
```

Supports:
- `.md` and `.mdc` files
- `globs` field for pattern matching
- `alwaysApply: true` for unconditional rules
- Walks upward from file to project root, plus `~/.claude/rules/`

---

## Claude Code Compatibility

Full compatibility layer for Claude Code configurations.

### Config Loaders

| Type | Locations |
|------|-----------|
| **Commands** | `~/.claude/commands/`, `.claude/commands/` |
| **Skills** | `~/.claude/skills/*/SKILL.md`, `.claude/skills/*/SKILL.md` |
| **Agents** | `~/.claude/agents/*.md`, `.claude/agents/*.md` |
| **MCPs** | `~/.claude/.mcp.json`, `.mcp.json`, `.claude/.mcp.json` |

MCP configs support environment variable expansion: `${VAR}`.

### Data Storage

| Data | Location | Format |
|------|----------|--------|
| Todos | `~/.claude/todos/` | Claude Code compatible |
| Transcripts | `~/.claude/transcripts/` | JSONL |

### Compatibility Toggles

Disable specific features:

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

| Toggle | Disables |
|--------|----------|
| `mcp` | `.mcp.json` files (keeps built-in MCPs) |
| `commands` | `~/.claude/commands/`, `.claude/commands/` |
| `skills` | `~/.claude/skills/`, `.claude/skills/` |
| `agents` | `~/.claude/agents/` (keeps built-in agents) |
| `hooks` | settings.json hooks |
| `plugins` | Claude Code marketplace plugins |

Disable specific plugins:

```json
{
  "claude_code": {
    "plugins_override": {
      "claude-mem@thedotmack": false
    }
  }
}
```
