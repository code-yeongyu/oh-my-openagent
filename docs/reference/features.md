# Oh-My-OpenCode Features Reference

## Agents

Oh-My-OpenCode provides 11 specialized AI agents. Each has distinct expertise, optimized models, and tool permissions.

### Core Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| **Sisyphus** | `claude-opus-4-6` | The default orchestrator. Plans, delegates, and executes complex tasks using specialized subagents with aggressive parallel execution. Todo-driven workflow with extended thinking (32k budget). Fallback: gpt-5.3-codex → deep quality chain. |
| **Hephaestus** | `gpt-5.3-codex` | The Legitimate Craftsman. Autonomous deep worker inspired by AmpCode's deep mode. Goal-oriented execution with thorough research before action. Explores codebase patterns, completes tasks end-to-end without premature stopping. Named after the Greek god of forge and craftsmanship. Fallback: deep quality chain (claude-opus-4-6-thinking → step-3.5-flash → glm-5 → ...). Requires at least one model in the chain to be available. |
| **Oracle** | `gpt-5.3-codex` | Architecture decisions, code review, debugging. Read-only consultation with stellar logical reasoning and deep analysis. Inspired by AmpCode. Fallback: claude-opus-4-6-thinking → claude-sonnet-4-5-thinking → deep quality chain. |
| **Librarian** | `claude-sonnet-4-5` | Multi-repo analysis, documentation lookup, OSS implementation examples. Deep codebase understanding with evidence-based answers. Fallback: speed chain (claude-haiku-4-5 → gpt-5-mini → ...) → quality chain. |
| **Explore** | `claude-haiku-4-5` | Fast codebase exploration and contextual grep. Fallback: oswe-vscode-prime → gpt-5-mini → gpt-4.1 → extended speed chain. |
| **Multimodal-Looker** | `gemini-3-pro-image` | Visual content specialist. Analyzes PDFs, images, diagrams to extract information. Fallback: gemini-3-pro-high → gemini-3-flash → kimi-k2.5 → claude-opus-4-6-thinking → claude-sonnet-4-5-thinking → claude-haiku-4-5 → gpt-5-nano. |

### Planning Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| **Prometheus** | `claude-opus-4-6-thinking` | Strategic planner with interview mode. Creates detailed work plans through iterative questioning. Fallback: gpt-5.3-codex → claude-sonnet-4-5-thinking → deep quality chain. |
| **Metis** | `claude-opus-4-6-thinking` | Plan consultant — pre-planning analysis. Identifies hidden intentions, ambiguities, and AI failure points. Fallback: gpt-5.3-codex → claude-sonnet-4-5-thinking → deep quality chain. |
| **Momus** | `gpt-5.3-codex` | Plan reviewer — validates plans against clarity, verifiability, and completeness standards. Fallback: claude-opus-4-6-thinking → deep quality chain. |

### Orchestration Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| **Atlas** | `claude-sonnet-4-5-thinking` | Todo-list orchestrator. Executes planned tasks systematically, managing todo items and coordinating work. Fallback: claude-opus-4-6-thinking → gpt-5.3-codex → deep quality chain. |
| **Sisyphus-Junior** | *(category-dependent)* | Category-spawned executor. Model is selected automatically based on the task category (visual-engineering, quick, deep, etc.). Used when the main agent delegates work via the `task` tool. |

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
| oracle | Read-only: cannot write, edit, or delegate (blocked: write, edit, task, call_omo_agent) |
| librarian | Cannot write, edit, or delegate (blocked: write, edit, task, call_omo_agent) |
| explore | Cannot write, edit, or delegate (blocked: write, edit, task, call_omo_agent) |
| multimodal-looker | Allowlist: `read` only |
| atlas | Cannot delegate (blocked: task, call_omo_agent) |
| momus | Cannot write, edit, or delegate (blocked: write, edit, task) |

### Background Agents

Run agents in the background and continue working:

- Have GPT debug while Claude tries different approaches
- Gemini writes frontend while Claude handles backend
- Fire massive parallel searches, continue implementation, use results when ready

```
# Launch in background
task(subagent_type="explore", load_skills=[], prompt="Find auth implementations", run_in_background=true)

# Continue working...
# System notifies on completion

# Retrieve results when needed
background_output(task_id="bg_abc123")
```

#### Visual Multi-Agent with Tmux

Enable `tmux.enabled` to see background agents in separate tmux panes:

```json
{
  "tmux": {
    "enabled": true,
    "layout": "main-vertical"
  }
}
```

When running inside tmux:
- Background agents spawn in new panes
- Watch multiple agents work in real-time
- Each pane shows agent output live
- Auto-cleanup when agents complete

Customize agent models, prompts, and permissions in `oh-my-opencode.json`.

## Category System

A Category is an agent configuration preset optimized for specific domains. Instead of delegating everything to a single AI agent, it is far more efficient to invoke specialists tailored to the nature of the task.

### What Categories Are and Why They Matter

- **Category**: "What kind of work is this?" (determines model, temperature, prompt mindset)
- **Skill**: "What tools and knowledge are needed?" (injects specialized knowledge, MCP tools, workflows)

By combining these two concepts, you can generate optimal agents through `task`.

### Built-in Categories

| Category | Default Model | Use Cases |
|----------|---------------|-----------|
| `visual-engineering` | `google/gemini-3-pro` | Frontend, UI/UX, design, styling, animation |
| `ultrabrain` | `openai/gpt-5.3-codex` (xhigh) | Deep logical reasoning, complex architecture decisions requiring extensive analysis |
| `deep` | `openai/gpt-5.3-codex` (medium) | Goal-oriented autonomous problem-solving. Thorough research before action. For hairy problems requiring deep understanding. |
| `artistry` | `google/gemini-3-pro` (max) | Highly creative/artistic tasks, novel ideas |
| `quick` | `anthropic/claude-haiku-4-5` | Trivial tasks - single file changes, typo fixes, simple modifications |
| `unspecified-low` | `anthropic/claude-sonnet-4-6` | Tasks that don't fit other categories, low effort required |
| `unspecified-high` | `anthropic/claude-opus-4-6` (max) | Tasks that don't fit other categories, high effort required |
| `writing` | `kimi-for-coding/k2p5` | Documentation, prose, technical writing |

### Usage

Specify the `category` parameter when invoking the `task` tool.

```typescript
task(
  category="visual-engineering",
  prompt="Add a responsive chart component to the dashboard page"
)
```

### Custom Categories

You can define custom categories in `oh-my-opencode.json`.

#### Category Configuration Schema

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Human-readable description of the category's purpose. Shown in task prompt. |
| `model` | string | AI model ID to use (e.g., `anthropic/claude-opus-4-6`) |
| `variant` | string | Model variant (e.g., `max`, `xhigh`) |
| `temperature` | number | Creativity level (0.0 ~ 2.0). Lower is more deterministic. |
| `top_p` | number | Nucleus sampling parameter (0.0 ~ 1.0) |
| `prompt_append` | string | Content to append to system prompt when this category is selected |
| `thinking` | object | Thinking model configuration (`{ type: "enabled", budgetTokens: 16000 }`) |
| `reasoningEffort` | string | Reasoning effort level (`low`, `medium`, `high`) |
| `textVerbosity` | string | Text verbosity level (`low`, `medium`, `high`) |
| `tools` | object | Tool usage control (disable with `{ "tool_name": false }`) |
| `maxTokens` | number | Maximum response token count |
| `is_unstable_agent` | boolean | Mark agent as unstable - forces background mode for monitoring |

#### Example Configuration

```jsonc
{
  "categories": {
    // 1. Define new custom category
    "korean-writer": {
      "model": "google/gemini-3-flash",
      "temperature": 0.5,
      "prompt_append": "You are a Korean technical writer. Maintain a friendly and clear tone."
    },
    
    // 2. Override existing category (change model)
    "visual-engineering": {
      "model": "openai/gpt-5.2",
      "temperature": 0.8
    },

    // 3. Configure thinking model and restrict tools
    "deep-reasoning": {
      "model": "anthropic/claude-opus-4-6",
      "thinking": {
        "type": "enabled",
        "budgetTokens": 32000
      },
      "tools": {
        "websearch_web_search_exa": false
      }
    }
  }
}
```

### Sisyphus-Junior as Delegated Executor

When you use a Category, a special agent called **Sisyphus-Junior** performs the work.

- **Characteristic**: Cannot **re-delegate** tasks to other agents.
- **Purpose**: Prevents infinite delegation loops and ensures focus on the assigned task.

## Skills

Skills provide specialized workflows with embedded MCP servers and detailed instructions. A Skill is a mechanism that injects **specialized knowledge (Context)** and **tools (MCP)** for specific domains into agents.

### Built-in Skills

| Skill | Trigger | Description |
|-------|---------|-------------|
| **git-master** | commit, rebase, squash, "who wrote", "when was X added" | Git expert. Detects commit styles, splits atomic commits, formulates rebase strategies. Three specializations: Commit Architect (atomic commits, dependency ordering, style detection), Rebase Surgeon (history rewriting, conflict resolution, branch cleanup), History Archaeologist (finding when/where specific changes were introduced). |
| **playwright** | Browser tasks, testing, screenshots | Browser automation via Playwright MCP. MUST USE for any browser-related tasks - verification, browsing, web scraping, testing, screenshots. |
| **frontend-ui-ux** | UI/UX tasks, styling | Designer-turned-developer persona. Crafts stunning UI/UX even without design mockups. Emphasizes bold aesthetic direction, distinctive typography, cohesive color palettes. |

#### git-master Core Principles

**Multiple Commits by Default**:
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

#### frontend-ui-ux Design Process

- **Design Process**: Purpose, Tone, Constraints, Differentiation
- **Aesthetic Direction**: Choose extreme - brutalist, maximalist, retro-futuristic, luxury, playful
- **Typography**: Distinctive fonts, avoid generic (Inter, Roboto, Arial)
- **Color**: Cohesive palettes with sharp accents, avoid purple-on-white AI slop
- **Motion**: High-impact staggered reveals, scroll-triggering, surprising hover states
- **Anti-Patterns**: Generic fonts, predictable layouts, cookie-cutter design

### Browser Automation Options

Oh-My-OpenCode provides two browser automation providers, configurable via `browser_automation_engine.provider`.

#### Option 1: Playwright MCP (Default)

```yaml
mcp:
  playwright:
    command: npx
    args: ["@playwright/mcp@latest"]
```

**Usage**:
```
/playwright Navigate to example.com and take a screenshot
```

#### Option 2: Agent Browser CLI (Vercel)

```json
{
  "browser_automation_engine": {
    "provider": "agent-browser"
  }
}
```

**Requires installation**:
```bash
bun add -g agent-browser
```

**Usage**:
```
Use agent-browser to navigate to example.com and extract the main heading
```

**Capabilities (Both Providers)**:
- Navigate and interact with web pages
- Take screenshots and PDFs
- Fill forms and click elements
- Wait for network requests
- Scrape content

### Custom Skill Creation (SKILL.md)

You can add custom skills directly to `.opencode/skills/` in your project root or `~/.claude/skills/` in your home directory.

**Example: `.opencode/skills/my-skill/SKILL.md`**

```markdown
---
name: my-skill
description: My special custom skill
mcp:
  my-mcp:
    command: npx
    args: ["-y", "my-mcp-server"]
---

# My Skill Prompt

This content will be injected into the agent's system prompt.
...
```

**Skill Load Locations** (priority order, highest first):
- `.opencode/skills/*/SKILL.md` (project, OpenCode native)
- `~/.config/opencode/skills/*/SKILL.md` (user, OpenCode native)
- `.claude/skills/*/SKILL.md` (project, Claude Code compat)
- `.agents/skills/*/SKILL.md` (project, Agents convention)
- `~/.agents/skills/*/SKILL.md` (user, Agents convention)

Same-named skill at higher priority overrides lower.

Disable built-in skills via `disabled_skills: ["playwright"]` in config.

### Category + Skill Combo Strategies

You can create powerful specialized agents by combining Categories and Skills.

#### The Designer (UI Implementation)

- **Category**: `visual-engineering`
- **load_skills**: `["frontend-ui-ux", "playwright"]`
- **Effect**: Implements aesthetic UI and verifies rendering results directly in browser.

#### The Architect (Design Review)

- **Category**: `ultrabrain`
- **load_skills**: `[]` (pure reasoning)
- **Effect**: Leverages GPT-5.3 Codex's logical reasoning for in-depth system architecture analysis.

#### The Maintainer (Quick Fixes)

- **Category**: `quick`
- **load_skills**: `["git-master"]`
- **Effect**: Uses cost-effective models to quickly fix code and generate clean commits.

### task Prompt Guide

When delegating, **clear and specific** prompts are essential. Include these 7 elements:

1. **TASK**: What needs to be done? (single objective)
2. **EXPECTED OUTCOME**: What is the deliverable?
3. **REQUIRED SKILLS**: Which skills should be loaded via `load_skills`?
4. **REQUIRED TOOLS**: Which tools must be used? (whitelist)
5. **MUST DO**: What must be done (constraints)
6. **MUST NOT DO**: What must never be done
7. **CONTEXT**: File paths, existing patterns, reference materials

**Bad Example**:
> "Fix this"

**Good Example**:
> **TASK**: Fix mobile layout breaking issue in `LoginButton.tsx`
> **CONTEXT**: `src/components/LoginButton.tsx`, using Tailwind CSS
> **MUST DO**: Change flex-direction at `md:` breakpoint
> **MUST NOT DO**: Modify existing desktop layout
> **EXPECTED**: Buttons align vertically on mobile

## Commands

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
| `/stop-continuation` | Stop all continuation mechanisms (ralph loop, todo continuation, boulder) for this session |
| `/handoff` | Create a detailed context summary for continuing work in a new session |

### /init-deep

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

### /ralph-loop

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

### /ulw-loop

**Purpose**: Same as ralph-loop but with ultrawork mode active

Everything runs at maximum intensity - parallel agents, background tasks, aggressive exploration.

### /refactor

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

### /start-work

**Purpose**: Start execution from a Prometheus-generated plan

**Usage**:
```
/start-work [plan-name]
```

Uses atlas agent to execute planned tasks systematically.

### /stop-continuation

**Purpose**: Stop all continuation mechanisms for this session

Stops ralph loop, todo continuation, and boulder state. Use when you want the agent to stop its current multi-step workflow.

### /handoff

**Purpose**: Create a detailed context summary for continuing work in a new session

Generates a structured handoff document capturing the current state, what was done, what remains, and relevant file paths — enabling seamless continuation in a fresh session.

### Custom Commands

Load custom commands from:
- `.opencode/command/*.md` (project, OpenCode native)
- `~/.config/opencode/command/*.md` (user, OpenCode native)
- `.claude/commands/*.md` (project, Claude Code compat)
- `~/.config/opencode/commands/*.md` (user, Claude Code compat)

## Tools

### Code Search Tools

| Tool | Description |
|------|-------------|
| **grep** | Content search using regular expressions. Filter by file pattern. |
| **glob** | Fast file pattern matching. Find files by name patterns. |

### Edit Tools

| Tool | Description |
|------|-------------|
| **edit** | Hash-anchored edit tool. Uses `LINE#ID` format for precise, safe modifications. Validates content hashes before applying changes — zero stale-line errors. |

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
| **task** | Category-based task delegation. Supports categories (visual-engineering, deep, quick, ultrabrain) or direct agent targeting via `subagent_type`. |
| **background_output** | Retrieve background task results |
| **background_cancel** | Cancel running background tasks |

### Visual Analysis Tools

| Tool | Description |
|------|-------------|
| **look_at** | Analyze media files (PDFs, images, diagrams) via Multimodal-Looker agent. Extracts specific information or summaries from documents, describes visual content. |

### Skill Tools

| Tool | Description |
|------|-------------|
| **skill** | Load and execute a skill or slash command by name. Returns detailed instructions with context applied. |
| **skill_mcp** | Invoke MCP server operations from skill-embedded MCPs. |

### Session Tools

| Tool | Description |
|------|-------------|
| **session_list** | List all OpenCode sessions |
| **session_read** | Read messages and history from a session |
| **session_search** | Full-text search across session messages |
| **session_info** | Get session metadata and statistics |

### Task Management Tools

Requires `experimental.task_system: true` in config.

| Tool | Description |
|------|-------------|
| **task_create** | Create a new task with auto-generated ID |
| **task_get** | Retrieve a task by ID |
| **task_list** | List all active tasks |
| **task_update** | Update an existing task |

#### Task System Details

**Note on Claude Code Alignment**: This implementation follows Claude Code's internal Task tool signatures (`TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`) and field naming conventions (`subject`, `blockedBy`, `blocks`, etc.). However, Anthropic has not published official documentation for these tools. This is Oh My OpenCode's own implementation based on observed Claude Code behavior and internal specifications.

**Task Schema**:
```ts
interface Task {
  id: string              // T-{uuid}
  subject: string         // Imperative: "Run tests"
  description: string
  status: "pending" | "in_progress" | "completed" | "deleted"
  activeForm?: string     // Present continuous: "Running tests"
  blocks: string[]        // Tasks this blocks
  blockedBy: string[]     // Tasks blocking this
  owner?: string          // Agent name
  metadata?: Record<string, unknown>
  threadID: string        // Session ID (auto-set)
}
```

**Dependencies and Parallel Execution**:

```
[Build Frontend]    ──┐
                      ├──→ [Integration Tests] ──→ [Deploy]
[Build Backend]     ──┘
```

- Tasks with empty `blockedBy` run in parallel
- Dependent tasks wait until blockers complete

**Example Workflow**:
```ts
TaskCreate({ subject: "Build frontend" })                    // T-001
TaskCreate({ subject: "Build backend" })                     // T-002
TaskCreate({ subject: "Run integration tests",
             blockedBy: ["T-001", "T-002"] })                 // T-003

TaskList()
// T-001 [pending] Build frontend        blockedBy: []
// T-002 [pending] Build backend         blockedBy: []
// T-003 [pending] Integration tests     blockedBy: [T-001, T-002]

TaskUpdate({ id: "T-001", status: "completed" })
TaskUpdate({ id: "T-002", status: "completed" })
// T-003 now unblocked
```

**Storage**: Tasks are stored as JSON files in `.sisyphus/tasks/`.

**Difference from TodoWrite**:

| Feature | TodoWrite | Task System |
|---------|-----------|-------------|
| Storage | Session memory | File system |
| Persistence | Lost on close | Survives restart |
| Dependencies | None | Full support (`blockedBy`) |
| Parallel execution | Manual | Automatic optimization |

**When to Use**: Use Tasks when work has multiple steps with dependencies, multiple subagents will collaborate, or progress should persist across sessions.

### Interactive Terminal Tools

| Tool | Description |
|------|-------------|
| **interactive_bash** | Tmux-based terminal for TUI apps (vim, htop, pudb). Pass tmux subcommands directly without prefix. |

**Usage Examples**:
```bash
# Create a new session
interactive_bash(tmux_command="new-session -d -s dev-app")

# Send keystrokes to a session
interactive_bash(tmux_command="send-keys -t dev-app 'vim main.py' Enter")

# Capture pane output
interactive_bash(tmux_command="capture-pane -p -t dev-app")
```

**Key Points**:
- Commands are tmux subcommands (no `tmux` prefix)
- Use for interactive apps that need persistent sessions
- One-shot commands should use regular `Bash` tool with `&`

## Hooks

Hooks intercept and modify behavior at key points in the agent lifecycle. 44 hooks across 5 tiers.

### Hook Events

| Event | When | Can |
|-------|------|-----|
| **PreToolUse** | Before tool execution | Block, modify input, inject context |
| **PostToolUse** | After tool execution | Add warnings, modify output, inject messages |
| **Message** | During message processing | Transform content, detect keywords, activate modes |
| **Event** | On session lifecycle changes | Recovery, fallback, notifications |
| **Transform** | During context transformation | Inject context, validate blocks |
| **Params** | When setting API parameters | Adjust model settings, effort level |

### Built-in Hooks

#### Context & Injection

| Hook | Event | Description |
|------|-------|-------------|
| **directory-agents-injector** | PreToolUse + PostToolUse | Auto-injects AGENTS.md when reading files. Walks from file to project root, collecting all AGENTS.md files. Deprecated for OpenCode 1.1.37+ — Auto-disabled when native AGENTS.md injection is available. |
| **directory-readme-injector** | PreToolUse + PostToolUse | Auto-injects README.md for directory context. |
| **rules-injector** | PreToolUse + PostToolUse | Injects rules from `.claude/rules/` when conditions match. Supports globs and alwaysApply. |
| **compaction-context-injector** | Event | Preserves critical context during session compaction. |
| **context-window-monitor** | Event | Monitors context window usage and tracks token consumption. |
| **preemptive-compaction** | Event | Proactively compacts sessions before hitting token limits. |

#### Productivity & Control

| Hook | Event | Description |
|------|-------|-------------|
| **keyword-detector** | Message + Transform | Detects keywords and activates modes: `ultrawork`/`ulw` (max performance), `search`/`find` (parallel exploration), `analyze`/`investigate` (deep analysis). |
| **think-mode** | Params | Auto-detects extended thinking needs. Catches "think deeply", "ultrathink" and adjusts model settings. |
| **ralph-loop** | Event + Message | Manages self-referential loop continuation. |
| **start-work** | Message | Handles /start-work command execution. |
| **auto-slash-command** | Message | Automatically executes slash commands from prompts. |
| **stop-continuation-guard** | Event + Message | Guards the stop-continuation mechanism. |
| **category-skill-reminder** | Event + PostToolUse | Reminds agents about available category skills for delegation. |
| **anthropic-effort** | Params | Adjusts Anthropic API effort level based on context. |

#### Quality & Safety

| Hook | Event | Description |
|------|-------|-------------|
| **comment-checker** | PostToolUse | Reminds agents to reduce excessive comments. Smartly ignores BDD, directives, docstrings. |
| **thinking-block-validator** | Transform | Validates thinking blocks to prevent API errors. |
| **edit-error-recovery** | PostToolUse + Event | Recovers from edit tool failures. |
| **write-existing-file-guard** | PreToolUse | Prevents accidental overwrites of existing files without reading them first. |
| **hashline-read-enhancer** | PostToolUse | Enhances read output with hash-anchored line markers for the hashline edit tool. |
| **hashline-edit-diff-enhancer** | PreToolUse + PostToolUse | Enhances edit operations with diff markers for the hashline edit tool. |

#### Recovery & Stability

| Hook | Event | Description |
|------|-------|-------------|
| **session-recovery** | Event | Recovers from session errors — missing tool results, thinking block issues, empty messages. |
| **anthropic-context-window-limit-recovery** | Event | Handles Claude context window limits gracefully. |
| **runtime-fallback** | Event + Message | Automatically switches to backup models on retryable API errors (e.g., 429, 503, 529), provider key misconfiguration errors (e.g., missing API key), and auto-retry signals (when `timeout_seconds > 0`). Configurable retry logic with per-model cooldown. |
| **model-fallback** | Event + Message | Manages model fallback chain when primary model is unavailable. |
| **json-error-recovery** | PostToolUse | Recovers from JSON parse errors in tool outputs. |

#### Truncation & Context Management

| Hook | Event | Description |
|------|-------|-------------|
| **tool-output-truncator** | PostToolUse | Truncates output from Grep, Glob, LSP, AST-grep tools. Dynamically adjusts based on context window. |

#### Notifications & UX

| Hook | Event | Description |
|------|-------|-------------|
| **auto-update-checker** | Event | Checks for new versions on session creation, shows startup toast with version and Sisyphus status. |
| **background-notification** | Event | Notifies when background agent tasks complete. |
| **session-notification** | Event | OS notifications when agents go idle. Works on macOS, Linux, Windows. |
| **agent-usage-reminder** | PostToolUse + Event | Reminds you to leverage specialized agents for better results. |
| **question-label-truncator** | PreToolUse | Truncates long question labels in the Question tool UI. |

#### Task Management

| Hook | Event | Description |
|------|-------|-------------|
| **task-resume-info** | PostToolUse | Provides task resume information for continuity. |
| **delegate-task-retry** | PostToolUse + Event | Retries failed task delegation calls. |
| **empty-task-response-detector** | PostToolUse | Detects empty responses from delegated tasks. |
| **tasks-todowrite-disabler** | PreToolUse | Disables TodoWrite tool when task system is active. |

#### Continuation

| Hook | Event | Description |
|------|-------|-------------|
| **todo-continuation-enforcer** | Event | Enforces todo completion — yanks idle agents back to work. |
| **compaction-todo-preserver** | Event | Preserves todo state during session compaction. |
| **unstable-agent-babysitter** | Event | Handles unstable agent behavior with recovery strategies. |

#### Integration

| Hook | Event | Description |
|------|-------|-------------|
| **claude-code-hooks** | All | Executes hooks from Claude Code's settings.json. |
| **atlas** | Multiple | Main orchestration logic for todo-driven work sessions. |
| **interactive-bash-session** | PostToolUse + Event | Manages tmux sessions for interactive CLI. |
| **non-interactive-env** | PreToolUse | Handles non-interactive environment constraints. |

#### Specialized

| Hook | Event | Description |
|------|-------|-------------|
| **prometheus-md-only** | PreToolUse | Enforces markdown-only output for Prometheus planner. |
| **no-sisyphus-gpt** | Message | Prevents Sisyphus from running on incompatible GPT models. |
| **no-hephaestus-non-gpt** | Message | Prevents Hephaestus from running on non-GPT models. |
| **sisyphus-junior-notepad** | PreToolUse | Manages notepad state for Sisyphus-Junior agents. |

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
    "auto-update-checker"
  ]
}
```

## MCPs

### Built-in MCPs

| MCP | Description |
|-----|-------------|
| **websearch** | Real-time web search powered by Exa AI |
| **context7** | Official documentation lookup for any library/framework |
| **grep_app** | Ultra-fast code search across public GitHub repos. Great for finding implementation examples. |

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

#### OAuth-Enabled MCPs

Skills can define OAuth-protected remote MCP servers. OAuth 2.1 with full RFC compliance (RFC 9728, 8414, 8707, 7591) is supported:

```yaml
---
description: My API skill
mcp:
  my-api:
    url: https://api.example.com/mcp
    oauth:
      clientId: ${CLIENT_ID}
      scopes: ["read", "write"]
---
```

When a skill MCP has `oauth` configured:
- **Auto-discovery**: Fetches `/.well-known/oauth-protected-resource` (RFC 9728), falls back to `/.well-known/oauth-authorization-server` (RFC 8414)
- **Dynamic Client Registration**: Auto-registers with servers supporting RFC 7591 (clientId becomes optional)
- **PKCE**: Mandatory for all flows
- **Resource Indicators**: Auto-generated from MCP URL per RFC 8707
- **Token Storage**: Persisted in `~/.config/opencode/mcp-oauth.json` (chmod 0600)
- **Auto-refresh**: Tokens refresh on 401; step-up authorization on 403 with `WWW-Authenticate`
- **Dynamic Port**: OAuth callback server uses an auto-discovered available port

Pre-authenticate via CLI:

```bash
bunx oh-my-opencode mcp oauth login <server-name> --server-url https://api.example.com
```

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

## Claude Code Compatibility

Full compatibility layer for Claude Code configurations.

### Config Loaders

| Type | Locations |
|------|-----------|
| **Commands** | `~/.config/opencode/commands/`, `.claude/commands/` |
| **Skills** | `~/.config/opencode/skills/*/SKILL.md`, `.claude/skills/*/SKILL.md` |
| **Agents** | `~/.config/opencode/agents/*.md`, `.claude/agents/*.md` |
| **MCPs** | `~/.claude.json`, `~/.config/opencode/.mcp.json`, `.mcp.json`, `.claude/.mcp.json` |

MCP configs support environment variable expansion: `${VAR}`.

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
| `commands` | Command loading from Claude Code paths |
| `skills` | Skill loading from Claude Code paths |
| `agents` | Agent loading from Claude Code paths (keeps built-in agents) |
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
