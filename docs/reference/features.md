# Oh-My-OpenAgent Features Reference

## Agents

Oh-My-OpenAgent provides 11 specialized AI agents. Each has distinct expertise, optimized models, and tool permissions.

### Current Agent Model Chains

The category chains below are edition-aware. Senpi uses `kimi-coding` for Kimi rungs. The OpenCode edition uses `kimi-for-coding` for the same Kimi chain positions. The same resolved chain is used at spawn time and again if runtime retry fallback needs to recover.

| Agent | Primary | Full fallback chain |
| --- | --- | --- |
| **sisyphus** | `claude-opus-5` | `anthropic\|github-copilot\|opencode\|vercel/claude-opus-5 (max)` → `opencode-go\|kimi-for-coding\|moonshotai\|opencode\|vercel\|bailian-coding-plan\|moonshotai-cn\|firmware\|ollama-cloud\|aihubmix/kimi-k3` → `openai\|github-copilot\|opencode\|vercel/gpt-5.6-sol (medium)` → `zai-coding-plan\|opencode\|bailian-coding-plan\|vercel/glm-5.2` → `opencode/big-pickle` |
| **hephaestus** | `gpt-5.6-sol` | `openai\|github-copilot\|vercel\|opencode/gpt-5.6-sol (medium)` |
| **oracle** | `gpt-5.6-sol` | `openai\|opencode\|vercel/gpt-5.6-sol (xhigh)` → `github-copilot/gpt-5.6-sol (high)` → `google\|github-copilot\|opencode\|vercel/gemini-3.1-pro (high)` → `anthropic\|github-copilot\|opencode\|vercel/claude-opus-5 (max)` → `opencode-go\|vercel/glm-5.2` |
| **librarian** | `gpt-5.6-luna-fast` | `openai/gpt-5.6-luna-fast (low)` → `deepseek/deepseek-v4-flash (max)` → `opencode-go\|bailian-coding-plan/qwen3.7-plus` → `vercel/minimax-m2.7-highspeed` → `opencode-go\|vercel/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go\|vercel/minimax-m2.7` → `anthropic\|github-copilot\|vercel/claude-haiku-4-5` → `openai\|vercel/gpt-5.4-nano` |
| **explore** | `gpt-5.6-luna-fast` | `openai/gpt-5.6-luna-fast (low)` → `deepseek/deepseek-v4-flash (max)` → `opencode-go\|bailian-coding-plan/qwen3.7-plus` → `vercel/minimax-m2.7-highspeed` → `opencode-go\|vercel/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go\|vercel/minimax-m2.7` → `anthropic\|github-copilot\|vercel/claude-haiku-4-5` → `openai\|vercel/gpt-5.4-nano` |
| **multimodal-looker** | `gpt-5.6-sol` | `openai\|opencode\|vercel/gpt-5.6-sol (low)` → `opencode-go\|vercel/kimi-k3` → `zai-coding-plan\|vercel/glm-4.6v` → `openai\|github-copilot\|opencode\|vercel/gpt-5-nano` |
| **prometheus** | `claude-fable-5` | `anthropic\|github-copilot\|opencode\|vercel/claude-fable-5 (xhigh)` → `opencode-go\|kimi-for-coding\|moonshotai\|opencode\|vercel/kimi-k3 (max)` |
| **metis** | `claude-opus-5` | `anthropic\|github-copilot\|opencode\|vercel/claude-opus-5 (high)` → `opencode-go\|kimi-for-coding\|moonshotai\|opencode\|vercel/kimi-k3 (low)` |
| **momus** | `gpt-5.6-terra` | `openai\|vercel/gpt-5.6-terra (high)` → `github-copilot/gpt-5.6-terra (high)` → `openai\|opencode\|vercel/gpt-5.6-sol (xhigh)` → `github-copilot/gpt-5.6-sol (high)` → `anthropic\|github-copilot\|opencode\|vercel/claude-opus-5 (max)` → `google\|github-copilot\|opencode\|vercel/gemini-3.1-pro (high)` → `opencode-go\|vercel/glm-5.2` |
| **atlas** | `claude-sonnet-5` | `anthropic\|github-copilot\|opencode\|vercel/claude-sonnet-5` → `opencode-go\|vercel/kimi-k3` → `openai\|github-copilot\|opencode\|vercel/gpt-5.6-sol (medium)` → `opencode-go\|vercel/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go\|vercel/minimax-m2.7` |
| **sisyphus-junior** | `claude-sonnet-5` | `anthropic\|github-copilot\|opencode\|vercel/claude-sonnet-5` → `opencode-go\|vercel/kimi-k3` → `openai\|github-copilot\|opencode\|vercel/gpt-5.6-sol (medium)` → `opencode-go\|vercel/minimax-m3` → `minimax-coding-plan\|minimax-cn-coding-plan/MiniMax-M3` → `opencode-go\|vercel/minimax-m2.7` → `opencode/big-pickle` |

### Invoking Agents

The main agent invokes these automatically, but you can call them explicitly:

```
Ask @oracle to review this design and propose an architecture
Ask @librarian how this is implemented - why does the behavior keep changing?
Ask @explore for the policy on this feature
```

### Tool Restrictions

| Agent             | Restrictions                                                                            |
| ----------------- | --------------------------------------------------------------------------------------- |
| oracle            | Read-only: cannot write or edit (blocked: write, edit, apply_patch, task); call_omo_agent is allowed for research delegation |
| librarian         | Cannot write, edit, or delegate (blocked: write, edit, task, call_omo_agent)            |
| explore           | Cannot write, edit, or delegate (blocked: write, edit, task, call_omo_agent)            |
| multimodal-looker | Allowlist: `read` only                                                                  |
| momus             | Cannot write or edit (blocked: write, edit); `task` is not denied                       |

### Instruction Files vs Enforcement

`AGENTS.md` files are instruction context. They tell agents how to work in a
project, and OMO can inject that context into prompts, but they are not a
deterministic permission boundary.

Deterministic enforcement today comes from OMO config (`agents.*.permission`,
agent `tools`, disabled tools/agents), built-in agent restrictions, OpenCode's
own permission gate when it is available, and guard hooks such as
`team-tool-gating`, `write-existing-file-guard`, and `prometheus-md-only`.

OMO does not currently read an `AGENTOWNERS.yml` file or run a generic
AGENTOWNERS policy-enforcer hook. If a project needs hard agent boundaries,
encode them in config permissions, tool allowlists, repository protections, or
review gates rather than relying on prose-only instructions.

### Background Agents

Run agents in the background and continue working:

- Have GPT debug while Claude tries different approaches
- Opus 5 handles visual work while GPT-5.6 Sol tackles deep reasoning
- Fire massive parallel searches, continue implementation, use results when ready

```
# Launch in background
task(subagent_type="explore", load_skills=[], prompt="Find auth implementations", run_in_background=true)

# Continue working...
# System notifies on completion

# Retrieve results when needed
background_output(task_id="bg_abc123")
```

#### Background Agent Work Directories

Background agents inherit the session working directory from OpenCode and OMO when
the task tool starts them. OMO does not force the model's own shell commands to
stay inside that directory after launch. If a model decides to clone a repo,
download docs, or create scratch files under `/tmp` or macOS `/var/folders/...`,
the filesystem prompt comes from that command, not from a separate OMO storage
root.

`APP_DIR` is an OpenCode process environment value. Treat it as process context,
not as a guarantee that every background agent artifact will land there.

For projects that must keep all agent scratch work under the repository, add a
project `AGENTS.md` rule with an explicit writable path:

```md
Use ./.omo/session-work/ for clones, downloaded docs, scratch files, and
temporary outputs. Do not write under /tmp, /var, or other OS temp directories
unless the user approves it.
```

If you use tmux panes for background agents, each pane still follows the same
model instructions. A project rule is more reliable than repeating the
constraint in one prompt, because every subagent receives the rule with the
project context.

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
- **Stable agent ordering**: core-agent tab cycling defaults to Sisyphus, Hephaestus, Prometheus, Atlas, and can be customized with `agent_order`

When running inside cmux (`cmux omo-agent-toolkit`), the same pane integration is routed through cmux's tmux compatibility command. OMO detects the cmux environment from `CMUX_SOCKET_PATH` or a cmux-provided `TMUX` value, so `tmux.enabled` can create cmux panes even when a real `tmux` binary is not installed.

Customize agent models, prompts, and permissions in the `[opencode]` block of `~/.omo/omo.jsonc`.

### Team Mode (experimental, OFF by default)

Parallel multi-agent coordination modeled after Claude Code's experimental Agent Teams. Enable via `team_mode.enabled: true`. Exposes 12 `team_*` tools for spawning a lead + up to 8 members, a shared deferred-ack mailbox, a shared task list with file-locked claims, optional per-member git worktrees, and an optional tmux layout that streams each member's session output into dedicated panes.

See the **[Team Mode Guide](../guide/team-mode.md)** for configuration, team spec format, lifecycle, bounds, and storage layout.

### Architecture Snapshot (current)

- **Feature modules**: `packages/omo-opencode/src/features/` has 23 modules.
- **Tool system**: `packages/omo-opencode/src/tools/` has 14 tool-producing directories plus a shared helper directory. The registry exposes **12 to 38 tools** depending on config gates. The 8 LSP aliases are served by the built-in `lsp` MCP, not by the tool registry.
- **Hook system**: the 5-tier composers define **58 slots** (Session 24 + Tool Guard 18 + Transform 7 + Continuation 7 + Skill 2). Default config activates about 50-51; the maximum is 62 when the 4 direct Team Mode event handlers are included.
- **MCP system**: 3 tiers: built-in MCPs with 3 remote servers (`websearch`, `context7`, `grep_app`) plus local stdio `lsp` and `codegraph`, `.mcp.json` loader, and skill-embedded MCP from `SKILL.md` frontmatter. `codegraph` can be disabled with `codegraph.enabled: false`.
- **Managers and controllers**: startup creates TmuxSessionManager, BackgroundManager, SkillMcpManager, ConfigHandler, and ModelFallbackControllerAccessor fields, plus optional TuiStateMirror and MonitorManager fields.
- **Config pipeline**: 6 phases in order: provider, plugin-components, agents, tools, MCPs, commands.
- **Canonical core agent order**: Sisyphus, Hephaestus, Prometheus, Atlas.
- **OpenClaw**: bidirectional integrations for Discord, Telegram, HTTP, and shell with reply listener daemon.

## Category System

A Category is an agent configuration preset optimized for specific domains. Instead of delegating everything to a single AI agent, it is far more efficient to invoke specialists tailored to the nature of the task.

### What Categories Are and Why They Matter

- **Category**: "What kind of work is this?" (determines model, temperature, prompt mindset)
- **Skill**: "What tools and knowledge are needed?" (injects specialized knowledge, MCP tools, workflows)

By combining these two concepts, you can generate optimal agents through `task`.

### Built-in Categories

| Category             | Default Model                   | Use Cases                                                                                                                   |
| -------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `visual-engineering` | `anthropic/claude-opus-5` (max) | Frontend, UI/UX, design, styling, animation                                                                                |
| `ultrabrain`         | `openai/gpt-5.6-sol` (xhigh)    | Deep logical reasoning, complex architecture decisions requiring extensive analysis                                         |
| `deep`               | `openai/gpt-5.6-sol` (medium)   | Goal-oriented autonomous problem-solving on hairy problems requiring deep research. ONE goal + ONE deliverable per call — multiple goals must fan out as parallel `deep` calls, never bundled into one. |
| `artistry`           | `anthropic/claude-fable-5` (xhigh) | Highly creative/artistic tasks, novel ideas                                                                                 |
| `quick`              | `kimi-for-coding/kimi-for-coding-highspeed` | Trivial tasks - single file changes, typo fixes, simple modifications                                                  |
| `unspecified-low`    | `xai/grok-4.6` (xhigh)          | Tasks that don't fit other categories, low effort required                                                                  |
| `unspecified-high`   | `kimi-for-coding/kimi-k3` (max) | Tasks that don't fit other categories, high effort required                                                               |
| `writing`            | `kimi-for-coding/kimi-k3` (low) | Documentation, prose, technical writing                                                                                     |

### Usage

Specify the `category` parameter when invoking the `task` tool.

```typescript
task({
  category: "visual-engineering",
  prompt: "Add a responsive chart component to the dashboard page",
});
```

### Custom Categories

You can define custom categories in the `[opencode]` block of the unified config file (`~/.omo/omo.jsonc` or a project `.omo/omo.jsonc`). Legacy `oh-my-openagent.json[c]` / `oh-my-opencode.json[c]` files are imported once by the migration engine and are no longer read at runtime.

#### Category Configuration Schema

| Field               | Type    | Description                                                                 |
| ------------------- | ------- | --------------------------------------------------------------------------- |
| `description`       | string  | Human-readable description of the category's purpose. Shown in task prompt. |
| `model`             | string  | AI model ID to use (e.g., `anthropic/claude-opus-5`)                        |
| `models`            | array   | Ordered model chain; the first entry is the primary model and the rest are fallbacks. Entries are strings or objects with per-model settings |
| `reasoning`         | string  | Canonical reasoning level (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `auto`) |
| `fallback_models`   | string\|array | Deprecated: use `models`. Fallback models on API errors. Supports strings or mixed arrays of strings and object entries with per-model settings |
| `variant`           | string  | Deprecated: use `reasoning`. Model variant (e.g., `max`, `xhigh`)           |
| `temperature`       | number  | Creativity level (0.0 ~ 2.0). Lower is more deterministic.                  |
| `top_p`             | number  | Nucleus sampling parameter (0.0 ~ 1.0)                                      |
| `prompt_append`     | string  | Content to append to system prompt when this category is selected           |
| `thinking`          | object  | Deprecated: use `reasoning` plus provider options. Thinking model configuration (`{ type: "enabled", budgetTokens: 16000 }`) |
| `reasoningEffort`   | string  | Deprecated: use `reasoning`. Reasoning effort level (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`) |
| `textVerbosity`     | string  | Text verbosity level (`low`, `medium`, `high`)                              |
| `provider_options`  | object  | Provider-specific request options passed through to the harness             |
| `max_tokens`        | number  | Maximum response token count (positive integer)                             |
| `maxTokens`         | number  | Deprecated: use `max_tokens`. Maximum response token count                  |
| `tools`             | object  | Tool usage control (disable with `{ "tool_name": false }`)                  |
| `max_prompt_tokens` | number  | Maximum prompt tokens for delegated tasks                                   |
| `is_unstable_agent` | boolean | Mark agent as unstable - forces background mode for monitoring              |
| `disable`           | boolean | Disable this category and exclude it from task delegation                   |
| `warn_unavailable`  | boolean | Suppress or emit unavailable-chain warnings for this category               |

#### Example Configuration

```jsonc
{
  "categories": {
    // 1. Define new custom category
    "korean-writer": {
      "model": "google/gemini-3.6-flash",
      "temperature": 0.5,
      "prompt_append": "You are a Korean technical writer. Maintain a friendly and clear tone.",
    },

    // 2. Override existing category (change model)
    "visual-engineering": {
      "model": "openai/gpt-5.6-sol",
      "temperature": 0.8,
    },

    // 3. Configure thinking model and restrict tools
    "deep-reasoning": {
      "model": "anthropic/claude-opus-5",
      "thinking": {
        "type": "enabled",
        "budgetTokens": 32000,
      },
      "tools": {
        "websearch_web_search_exa": false,
      },
    },
  },
}
```

### Sisyphus-Junior as Delegated Executor

When you use a Category, a special agent called **Sisyphus-Junior** performs the work.

- **Characteristic**: Cannot **re-delegate** tasks to other agents.
- **Purpose**: Prevents infinite delegation loops and ensures focus on the assigned task.

## Advanced Configuration

### Rename Compatibility

The published package and binary remain `oh-my-opencode`. Inside `opencode.json`, the compatibility layer now prefers the plugin entry `oh-my-openagent`, while legacy `oh-my-opencode` entries still load with a warning. Plugin configuration lives in the unified `omo.jsonc`; legacy `oh-my-openagent.json[c]` / `oh-my-opencode.json[c]` config files are imported once by the migration engine and no longer read at runtime. Run `bunx oh-my-openagent doctor` to check for legacy package name warnings.

### Fallback Models

Configure per-agent fallback chains with arrays that can mix plain model strings and per-model objects:

```jsonc
{
  "agents": {
    "sisyphus": {
      "fallback_models": [
        "opencode/glm-5.2",
        { "model": "openai/gpt-5.6-sol", "variant": "high" },
        { "model": "anthropic/claude-sonnet-5", "thinking": { "type": "enabled", "budgetTokens": 64000 } }
      ]
    }
  }
}
```

When a model errors, the runtime can move through the configured fallback array. Object entries let you tune the backup model itself instead of only swapping the model name.

The plugin uses two independent fallback systems:

- **model-fallback**: proactive model chain selection in chat params.
- **runtime-fallback**: reactive recovery after runtime failures from provider/API behavior.

### File-Based Prompts

Load agent system prompts from external files using `file://` URLs in the `prompt` field, or append additional content with `prompt_append`. The `prompt_append` field also works on categories.

```jsonc
{
  "agents": {
    "sisyphus": {
      "prompt": "file:///path/to/custom-prompt.md"
    },
    "oracle": {
      "prompt_append": "file:///path/to/additional-context.md"
    }
  },
  "categories": {
    "deep": {
      "prompt_append": "file:///path/to/deep-category-append.md"
    }
  }
}
```

Supports `~` expansion for home directory and relative `file://` paths.

Useful for:
- Version controlling prompts separately from config
- Sharing prompts across projects
- Keeping configuration files concise
- Adding category-specific context without duplicating base prompts

The file content is loaded at runtime and injected into the agent's system prompt.

### Session Recovery

The system automatically recovers from common session failures without user intervention:

- **Missing tool results**: reconstructs recoverable tool state and skips invalid tool-part IDs instead of failing the whole recovery pass
- **Thinking block violations**: Recovers from API thinking block mismatches
- **Empty messages**: Reconstructs message history when content is missing
- **Context window limits**: Gracefully handles Claude context window exceeded errors with intelligent compaction
- **JSON parse errors**: Recovers from malformed tool outputs

Recovery happens transparently during agent execution. You see the result, not the failure.
## Commands

Commands are slash-triggered workflows that execute predefined templates.

### Built-in Commands

| Command              | Description                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `/goal`              | Set, show, pause, resume, or clear the active thread goal                                  |
| `/refactor`          | Intelligent refactoring with LSP, AST-grep, architecture analysis, and TDD verification    |
| `/start-work`        | Start Atlas work session from Prometheus plan                                              |
| `/stop-continuation` | Stop all continuation mechanisms (todo continuation, Goal, boulder) for this session       |
| `/remove-ai-slops`   | Remove AI-generated code smells from branch changes and review the result                   |
| `/handoff`           | Create a detailed context summary for continuing work in a new session                     |
| `/hyperplan`         | Load the `hyperplan` skill and run an adversarial `team_create` planning workflow (requires `team_mode.enabled: true`)      |

### /goal

**Purpose**: Set a persistent thread objective the agent pursues across turns until paused, cleared, or completed.

**Usage**:

```
/goal "Build a REST API with authentication"
/goal                    # show the current goal
/goal pause              # stop idle continuations
/goal resume             # resume a paused goal
/goal clear              # clear the current goal
```

**Behavior**:

- The goal persists for the session and is shown in the TUI.
- While a goal is active, every `session.idle` re-injects a continuation prompt that includes the stored `tokensUsed` and `timeUsedSeconds` fields (currently unused; they remain 0).
- The agent calls `update_goal({ status: "complete" })` only after a completion audit confirms the objective is achieved.
- `pause` stops idle continuations without clearing the goal; `clear` removes it. `session.deleted` also clears the goal.
- Goal state is stored in `.omo/goal/<sessionID>.json`.

**Tools** (registered only when `goal.enabled` is true):

- `create_goal` - create or replace the active goal objective.
- `update_goal` - pause, resume, mark complete, or change the objective.
- `get_goal` - read the current objective, status, and usage accounting.

**Configure**:

```jsonc
{
  "goal": {
    "enabled": true,
    "auto_start": false,
    "default_max_iterations": 100
  }
}
```

- `enabled` (default `false`) gates the Goal subsystem and its tools.
- `auto_start` (default `false`) is accepted in config but not wired; first-message auto-create is intended to follow `default_mode.goal`, and that path is currently inert.
- `default_max_iterations` (1-1000, default `100`) is retained on the `goal` schema for Ralph Loop config migration; the Goal hook doesn't enforce an iteration cap.

**Migration**: the legacy top-level `ralph_loop` config auto-migrates to `goal` at load time and logs a deprecation warning; explicit `goal` config wins over migrated values. `default_mode.ralph_loop` was renamed to `default_mode.goal`.

### /ulw-loop

The `/ulw-loop` slash command has been removed; continuous goal pursuit is now handled by `/goal`. The `omo-agent-toolkit ulw-loop` CLI subcommand remains as a passthrough to the Codex LazyCodex ulw-loop CLI.

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
/start-work [plan-name] [--worktree <path>] [--make-pr] [--ship]
```

Switches the session to Atlas (Sisyphus if Atlas is unregistered), injects Prometheus plan + boulder + worktree/PR context, then Atlas executes. First actions are `create_goal` and todo registration, not immediate coding.

- `--worktree <path>`: use this git worktree (create it if needed). Omit it to work in the current repo.
- `--make-pr`: deliver the work as a pull request; implies worktree mode (a task-owned worktree is created when `--worktree` is omitted) and hands off with the PR URL.
- `--ship`: implies `--make-pr`, then keeps working until the PR passes CI/review gates and is merged, before cleaning up the worktree.

### /stop-continuation

**Purpose**: Stop all continuation mechanisms for this session

Stops todo continuation, clears the active Goal, and clears boulder state. Use when you want the agent to stop its current multi-step workflow.

### /handoff

**Purpose**: Create a detailed context summary for continuing work in a new session

Generates a structured handoff document capturing the current state, what was done, what remains, and relevant file paths — enabling seamless continuation in a fresh session.

### Custom Commands

Load custom commands from:

- `.opencode/commands/*.md` and `.opencode/command/*.md` (project, OpenCode native)
- `~/.config/opencode/commands/*.md` and `~/.config/opencode/command/*.md` (user, OpenCode native)
- `.claude/commands/*.md` (project, Claude Code compat)
- `~/.claude/commands/*.md` (user, Claude Code compat)

## Skill Sets

Skill sets provide specialized workflows with embedded MCP servers and detailed instructions. They are automatically activated by matching task intent, so you do not need to study or preload everything before working. When you want to force one deliberately, call it by name in the prompt, slash command, or `load_skills` list.

### Built-in Skill Sets

The built-in skill registry contains `agent-browser`, `debugging`, `dev-browser`, `frontend`, `git-master`, `init-deep`, `playwright`, `playwright-cli`, `remove-ai-slops`, `review-work`, `security-research`, `security-review`, `team-mode`, and `visual-qa`. Browser provider selection activates one browser skill, and `team-mode` is available only when Team Mode is enabled. The table below highlights selected skills.

#### init-deep

`init-deep` is a built-in skill, not a built-in command. Invoke it through the `skill` surface or load it by name. It generates hierarchical `AGENTS.md` files throughout the project and supports `--create-new` and `--max-depth=N` arguments.

| Skill set              | Trigger                                                 | Description                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **git-master**         | commit, rebase, squash, "who wrote", "when was X added" | Git expert. Detects commit styles, splits atomic commits, formulates rebase strategies. Three specializations: Commit Architect (atomic commits, dependency ordering), Rebase Surgeon (history rewriting, conflict resolution), and History Archaeologist (finding when/where specific changes were introduced).                              |
| **playwright**         | Browser tasks, testing, screenshots                     | Browser automation via Playwright MCP. MUST USE for browser verification, browsing, web scraping, testing, and screenshots.                                                                                                                                                                                                                   |
| **agent-browser**      | Browser tasks on agent-browser                          | Browser automation via the `agent-browser` CLI. Covers navigation, snapshots, screenshots, network inspection, and scripted interactions.                                                                                                                                                                                                     |
| **dev-browser**        | Stateful browser scripting                              | Browser automation with persistent page state for iterative workflows and authenticated sessions.                                                                                                                                                                                                                                             |
| **frontend**           | UI/UX tasks, styling                                    | Designer-turned-developer persona. Crafts strong UI/UX even without design mockups. Emphasizes bold aesthetic direction, distinctive typography, cohesive color palettes.                                                                                                                                                                     |
| **review-work**        | "review work", "review my work", "QA my work"          | Post-implementation review orchestrator. Launches 5 parallel background sub-agents for comprehensive review: goal verification, code quality, security, hands-on QA, and context mining. All must pass for review to pass.                                                                                                                     |
| **ulw-research**       | `ulw-research`, deep research requests | Maximum-saturation research. Runs parallel explore/librarian swarms across code, docs, web, and OSS repos; recursively follows `EXPAND` leads until convergence; proves contested claims by running code; and returns cited synthesis. Epistemic instrumentation covers intent-vs-reality diffing, claim graph, observation manifest, independent-observation convergence, temporal evidence, verification economics, and cause-disappearance records. |
| **remove-ai-slops** | "remove AI slop", "de-AI", "humanize"                 | Removes AI-generated code smells from files while preserving functionality. Invoke as `skill(name="remove-ai-slops")`. Identifies and eliminates verbose comments, redundant error handling, over-engineered patterns, and generic AI phrasing.                                                                                                                                           |

`ulw-research` is intentionally explicit. Ordinary questions and normal implementation context-gathering will not trigger a saturation swarm. Use `ulw-research` when the research itself is the deliverable and every claim needs a citation, a proof artifact, or an execution-backed verdict.

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

#### frontend Design Process

- **Design Process**: Purpose, Tone, Constraints, Differentiation
- **Aesthetic Direction**: Choose extreme - brutalist, maximalist, retro-futuristic, luxury, playful
- **Typography**: Distinctive fonts, avoid generic (Inter, Roboto, Arial)
- **Color**: Cohesive palettes with sharp accents, avoid purple-on-white AI slop
- **Motion**: High-impact staggered reveals, scroll-triggering, surprising hover states
- **Anti-Patterns**: Generic fonts, predictable layouts, cookie-cutter design

### Browser Automation Options

Oh-My-OpenAgent provides two browser automation providers, configurable via `browser_automation_engine.provider`.

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

Loaded skill display priority follows this order: `project > user > opencode > builtin/plugin`.

Disable built-in skills via `disabled_skills: ["playwright"]` in config.

### Category + Skill Combo Strategies

You can create powerful specialized agents by combining Categories and Skills.

#### The Designer (UI Implementation)

- **Category**: `visual-engineering`
- **load_skills**: `["frontend", "playwright"]`
- **Effect**: Implements aesthetic UI and verifies rendering results directly in browser.

#### The Architect (Design Review)

- **Category**: `ultrabrain`
- **load_skills**: `[]` (pure reasoning)
- **Effect**: Uses GPT-5.6 Sol at xhigh effort through OpenAI or Vercel when available, at high effort through GitHub Copilot, and retains an xhigh Sol rung through OpenAI, OpenCode, or Vercel before non-GPT fallbacks.

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

> **TASK**: Fix mobile layout breaking issue in the navbar component
> **CONTEXT**: `packages/web/components/Navbar.tsx`, using Tailwind CSS
> **MUST DO**: Change flex-direction at `md:` breakpoint
> **MUST NOT DO**: Modify existing desktop layout
> **EXPECTED**: Buttons align vertically on mobile

## Tools

Tool registration is config-gated. The registry exposes **12 to 38 tools**.

### Code Search Tools

| Tool     | Description                                                       |
| -------- | ----------------------------------------------------------------- |
| **grep** | Content search using regular expressions. Filter by file pattern. |
| **glob** | Fast file pattern matching. Find files by name patterns.          |

### Edit Tools

| Tool     | Description                                                                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **edit** | Hash-anchored edit tool (`LINE#ID`), registered only when `hashline_edit: true` (default false). Validates content hashes before applying changes and rejects stale hash edits. |

Hashline IDs use characters from `ZPMQVRWSNKTXJBYH`.

### LSP Tools (IDE Features for Agents)

All 8 aliases below are served by the built-in `lsp` MCP rather than the native tool registry.

| Tool                    | Description                                 |
| ----------------------- | ------------------------------------------- |
| **lsp_status**          | List configured and active LSP servers      |
| **lsp_diagnostics**     | Get errors/warnings before build            |
| **lsp_prepare_rename**  | Validate rename operation                   |
| **lsp_rename**          | Rename symbol across workspace              |
| **lsp_goto_definition** | Jump to symbol definition                   |
| **lsp_find_references** | Find all usages across workspace            |
| **lsp_symbols**         | Get file outline or workspace symbol search |
| **lsp_install_decision** | Record allow/decline decisions for missing LSP installation |

### AST-Grep Skill

AST-aware search and rewrite now lives in the `ast-grep` skill. Load it with the `skill` tool when you need structural matching, then use its `sg` helper commands for search or rewrite workflows.

### Delegation Tools

| Tool                  | Description                                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **call_omo_agent**    | Spawn explore/librarian agents. Supports `run_in_background`.                                                                                                                                                                           |
| **task**              | Category-based task delegation. Supports built-in categories like `visual-engineering`, `ultrabrain`, `deep`, `artistry`, `quick`, `unspecified-low`, `unspecified-high`, and `writing`, or direct agent targeting via `subagent_type`. |
| **background_output** | Retrieve background task results                                                                                                                                                                                                        |
| **background_cancel** | Cancel running background tasks                                                                                                                                                                                                         |

### Visual Analysis Tools

| Tool        | Description                                                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **look_at** | Analyze media files (PDFs, images, diagrams) via Multimodal-Looker agent. Extracts specific information or summaries from documents, describes visual content. |

### Skill Tools

| Tool          | Description                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| **skill**     | Load and execute a skill or slash command by name. Returns detailed instructions with context applied. |
| **skill_mcp** | Invoke MCP server operations from skill-embedded MCPs.                                                 |

### Session Tools

| Tool               | Description                              |
| ------------------ | ---------------------------------------- |
| **session_list**   | List OpenCode sessions for a project (defaults to the current working directory); optional date and limit filters |
| **session_read**   | Read messages and history from a session |
| **session_search** | Full-text search across session messages |
| **session_info**   | Get session metadata and statistics      |

#### Finding older sessions hidden by `/sessions`

OpenCode's built-in `/sessions` picker can omit older sessions even when they still exist in the local session store. Use OMO's session tools to find the ID, then continue it from the TUI.

```ts
session_list({
  from_date: "2026-01-01T00:00:00Z",
  to_date: "2026-02-11T00:00:00Z",
  project_path: "/absolute/path/to/project",
  limit: 50,
})
```

After you find the session ID, type this in OpenCode:

```text
/continue <session_id>
```

If you remember text from the conversation but not the date, search first and then read the matching session:

```ts
session_search({ query: "migration bug", limit: 20 })
session_read({ session_id: "ses_...", limit: 200 })
```

### Task Management Tools

Requires `experimental.task_system: true` in config.

| Tool            | Description                              |
| --------------- | ---------------------------------------- |
| **task_create** | Create a new task with auto-generated ID |
| **task_get**    | Retrieve a task by ID                    |
| **task_list**   | List all active tasks                    |
| **task_update** | Update an existing task                  |

#### Task System Details

**Note on Claude Code Alignment**: This implementation follows Claude Code's internal Task tool signatures (`TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`) and field naming conventions (`subject`, `blockedBy`, `blocks`, etc.). However, Anthropic has not published official documentation for these tools. This is Oh My OpenAgent's own implementation based on observed Claude Code behavior and internal specifications.

**Task Schema**:

```ts
interface Task {
  id: string; // T-{uuid}
  subject: string; // Imperative: "Run tests"
  description: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  activeForm?: string; // Present continuous: "Running tests"
  blocks: string[]; // Tasks this blocks
  blockedBy: string[]; // Tasks blocking this
  owner?: string; // Agent name
  metadata?: Record<string, unknown>;
  repoURL?: string;
  parentID?: string;
  threadID: string; // Session ID (auto-set)
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
TaskCreate({ subject: "Build frontend" }); // T-001
TaskCreate({ subject: "Build backend" }); // T-002
TaskCreate({ subject: "Run integration tests", blockedBy: ["T-001", "T-002"] }); // T-003

TaskList();
// T-001 [pending] Build frontend        blockedBy: []
// T-002 [pending] Build backend         blockedBy: []
// T-003 [pending] Integration tests     blockedBy: [T-001, T-002]

TaskUpdate({ id: "T-001", status: "completed" });
TaskUpdate({ id: "T-002", status: "completed" });
// T-003 now unblocked
```

**Storage**: By default, tasks are stored as JSON files under the OpenCode config directory at `tasks/<list-id>`. Override the directory with `sisyphus.tasks.storage_path`.

**Difference from TodoWrite**:

| Feature            | TodoWrite      | Task System                |
| ------------------ | -------------- | -------------------------- |
| Storage            | Session memory | File system                |
| Persistence        | Lost on close  | Survives restart           |
| Dependencies       | None           | Full support (`blockedBy`) |
| Parallel execution | Manual         | Automatic optimization     |

**When to Use**: Use Tasks when work has multiple steps with dependencies, multiple subagents will collaborate, or progress should persist across sessions.

### Interactive Terminal Tools

| Tool                 | Description                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------- |
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
- Use the managed background-session or Monitor mechanism (`monitor_start`) for one-shot commands that must continue in the background; do not rely on shell `&` as the managed contract

## Hooks

Hooks intercept and modify behavior at key points in the agent lifecycle across the full session, message, tool, and parameter pipeline.

Current composition counts:

- Session: 24
- Tool Guard: 18 (17 non-Team slots plus `teamToolGating`)
- Transform: 7
- Continuation: 7
- Skill: 2
- Total composed slots: 58
- About 50-51 are active with default config; the maximum is 62 when the 4 direct Team Mode event handlers are included

### Hook Events

| Event           | When                          | Can                                                |
| --------------- | ----------------------------- | -------------------------------------------------- |
| **PreToolUse**  | Before tool execution         | Block, modify input, inject context                |
| **PostToolUse** | After tool execution          | Add warnings, modify output, inject messages       |
| **Message**     | During message processing     | Transform content, detect keywords, activate modes |
| **Event**       | On session lifecycle changes  | Recovery, fallback, notifications                  |
| **Transform**   | During context transformation | Inject context, validate blocks                    |
| **Params**      | When setting API parameters   | Adjust model settings, effort level                |

### Built-in Hooks

#### Context & Injection

| Hook                            | Event                    | Description                                                                                                                                                                                               |
| ------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **directory-agents-injector**   | PostToolUse + Event | Auto-injects AGENTS.md after Read. Walks from file to project root, collecting all AGENTS.md files. Auto-disabled on OpenCode 1.1.37+ when native AGENTS.md injection is available. |
| **directory-readme-injector**   | PostToolUse + Event | Auto-injects README.md after Read for directory context.                                                                                                                                                  |
| **rules-injector**              | PreToolUse + PostToolUse | Injects rules from `.claude/rules/` when conditions match. Supports globs and alwaysApply.                                                                                                                |
| **compaction-context-injector** | Event                    | Preserves critical context during session compaction.                                                                                                                                                     |
| **preemptive-compaction**       | Event                    | Proactively compacts sessions before hitting token limits.                                                                                                                                                |

#### Productivity & Control

| Hook                        | Event               | Description                                                                                                                                                 |
| --------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **keyword-detector**        | Message             | IntentGate detector. Activates `ultrawork`/`ulw`, `team`, `hyperplan`, and `hyperplan-ultrawork` from message keywords. |
| **think-mode**              | Message             | On "think"/"ultrathink" in the user message, sets the message variant to `high` unless already a high variant.                                              |
| **goal**                    | Event               | Re-injects a goal continuation prompt on session.idle while a goal is active; clears the goal on session.deleted.                                           |
| **start-work**              | Message + command.execute.before | After /start-work is expanded, selects a Prometheus plan, initializes boulder state, scaffolds notepads, switches the session to Atlas, and injects plan context. |
| **auto-slash-command**      | Message + command.execute.before | Expands detected slash commands into their command templates in the prompt.                                                                    |
| **stop-continuation-guard** | Event + Message     | Guards the stop-continuation mechanism.                                                                                                                     |
| **category-skill-reminder** | PostToolUse + Message Transform + Event | Reminds agents about available category skills for delegation.                                                                                              |

#### Quality & Safety

| Hook                            | Event                    | Description                                                                               |
| ------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------- |
| **comment-checker**             | PostToolUse              | Runs `@code-yeongyu/comment-checker` to block AI-slop comment patterns. Bypass options: `// @allow` for a line, `// comment-checker-disable-file` at file top. |
| **tool-pair-validator**         | Message Transform        | Validates tool call/result pairs during chat message transformation.                       |
| **edit-error-recovery**         | PostToolUse              | Recovers from edit tool failures.                                                         |
| **write-existing-file-guard**   | PreToolUse               | Prevents accidental overwrites of existing files without reading them first.              |
| **hashline-read-enhancer**      | PostToolUse              | Enhances read output with hash-anchored line markers for the hashline edit tool.          |

#### Recovery & Stability

| Hook                                        | Event           | Description                                                                                                                                                                                                                                                 |
| ------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **anthropic-context-window-limit-recovery** | Event           | Handles Claude context window limits gracefully.                                                                                                                                                                                                            |
| **runtime-fallback**                        | Event + Message | Automatically switches to backup models on retryable API errors (e.g., 429, 500, 502, 503, 504), provider key misconfiguration errors (e.g., missing API key), and provider retry signals. `message.updated` retry-signal detection requires `timeout_seconds > 0`; structured `session.status` retry events can still trigger fallback. |
| **model-fallback**                          | Message         | Applies the pending model-fallback chain to the next chat.message when a fallback is queued.                                                                                                                                                                                             |
| **json-error-recovery**                     | PostToolUse     | Recovers from JSON parse errors in tool outputs.                                                                                                                                                                                                            |

#### Truncation & Context Management

| Hook                      | Event       | Description                                                                                         |
| ------------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| **tool-output-truncator** | PostToolUse | Truncates output from grep, glob, lsp_diagnostics, interactive_bash, skill_mcp, and webfetch. Dynamically adjusts based on context window. |

#### Notifications & UX

| Hook                         | Event               | Description                                                                                        |
| ---------------------------- | ------------------- | -------------------------------------------------------------------------------------------------- |
| **auto-update-checker**      | Event               | Checks for new versions on session creation, shows startup toast with version and Sisyphus status. |
| **background-notification**  | Event               | Notifies when background agent tasks complete.                                                     |
| **session-notification**     | Event               | OS notifications when agents go idle. Works on macOS, Linux, Windows.                              |
| **agent-usage-reminder**     | PostToolUse + Event | Reminds you to leverage specialized agents for better results.                                     |
| **question-label-truncator** | PreToolUse          | Truncates long question labels in the Question tool UI.                                            |

#### Task Management

| Hook                             | Event               | Description                                         |
| -------------------------------- | ------------------- | --------------------------------------------------- |
| **task-resume-info**             | PostToolUse         | Provides task resume information for continuity.    |
| **delegate-task-retry**          | PostToolUse         | Retries failed task delegation calls.               |
| **empty-task-response-detector** | PostToolUse         | Detects empty responses from delegated tasks.       |
| **tasks-todowrite-disabler**     | PreToolUse          | Disables TodoWrite tool when task system is active. |

#### Continuation

| Hook                           | Event | Description                                                |
| ------------------------------ | ----- | ---------------------------------------------------------- |
| **todo-continuation-enforcer** | Event | Enforces todo completion — yanks idle agents back to work. |
| **compaction-todo-preserver**  | Event | Preserves todo state during session compaction.            |
| **unstable-agent-babysitter**  | Event | Handles unstable agent behavior with recovery strategies.  |

#### Integration

| Hook                         | Event               | Description                                             |
| ---------------------------- | ------------------- | ------------------------------------------------------- |
| **claude-code-hooks**        | Message + PreToolUse + PostToolUse | Executes supported Claude Code hook handlers for `chat.message` and `tool.execute.before`/`tool.execute.after`; it does not run on every OMO hook event. |
| **atlas**                    | Multiple            | Main orchestration logic for todo-driven work sessions. |
| **interactive-bash-session** | PostToolUse + Event | Manages tmux sessions for interactive CLI.              |
| **non-interactive-env**      | PreToolUse          | Handles non-interactive environment constraints.        |

#### Specialized

| Hook                        | Event      | Description                                                |
| --------------------------- | ---------- | ---------------------------------------------------------- |
| **prometheus-md-only**      | PreToolUse | Restricts Prometheus write/edit tools to `.omo/*.md` plan files.      |
| **no-sisyphus-gpt**         | Message    | Prevents Sisyphus from running on incompatible GPT models. |
| **no-hephaestus-non-gpt**   | Message    | Prevents Hephaestus from running on non-GPT models.        |
| **sisyphus-junior-notepad** | PreToolUse | Manages notepad state for Sisyphus-Junior agents.          |

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
  "disabled_hooks": ["comment-checker"]
}
```

## MCPs

The plugin uses a three-tier MCP architecture:

1. Built-in MCPs from `packages/omo-opencode/src/mcp/` (remote plus local stdio)
2. Claude Code `.mcp.json` loader with `${VAR}` expansion
3. Skill-embedded MCP servers declared in `SKILL.md` frontmatter

### Native vs plugin-injected MCPs

oh-my-openagent injects MCP servers at **runtime** through the OpenCode plugin API. This is fundamentally different from MCP servers you configure directly in `opencode.json`.

Because `opencode mcp list` reads OpenCode's static configuration only, it **cannot see** MCPs that the plugin injects at runtime. This is expected behavior, not a bug:

```
# These are plugin-injected — they will NOT appear here
$ opencode mcp list
No MCP servers configured
```

To inspect which MCP servers oh-my-openagent is actually providing, run the doctor command:

```bash
bunx oh-my-openagent doctor --verbose
```

The three tiers of MCP servers and where they come from:

| Tier | Source | Visible in `opencode mcp list`? |
| ---- | ------ | ------------------------------- |
| 1 — Built-in | Injected at runtime by oh-my-openagent (`websearch`, `context7`, `grep_app`, `lsp`, `codegraph`) | No |
| 2 — Claude Code `.mcp.json` | Loaded from `.mcp.json` files and merged in by oh-my-openagent at runtime | No |
| 3 — Skill-embedded | Declared in `SKILL.md` frontmatter, spun up on demand per session | No |
| — Native OpenCode | Configured directly in `opencode.json` under the `mcp` key, without the plugin | Yes |

**Disabling built-in MCPs**: Use `disabled_mcps` in your plugin config:

```jsonc
{
  "disabled_mcps": ["websearch", "grep_app"]
}
```

### Built-in MCPs

| MCP           | Description                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------- |
| **websearch** | Real-time web search powered by Exa AI                                                        |
| **context7**  | Official documentation lookup for any library/framework                                       |
| **grep_app**  | Ultra-fast code search across public GitHub repos. Great for finding implementation examples. |
| **lsp**       | Local LSP tools for diagnostics, symbols, references, and renames                             |
| **codegraph** | Local code graph stdio server; enabled unless `codegraph.enabled` is `false`                  |

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

Skill MCP clients are isolated per session by key `${sessionID}:${skillName}:${serverName}`.

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
bunx oh-my-openagent mcp oauth login <server-name> --server-url https://api.example.com
```

## Model Capabilities

Model capabilities are models.dev-backed, with a refreshable cache and compatibility diagnostics. The system combines bundled models.dev snapshot data, optional refreshed cache data, provider runtime metadata, and heuristics when exact metadata is unavailable.

### Refreshing Capabilities

Update the local cache with the latest model information:

```bash
bunx oh-my-openagent refresh-model-capabilities
```

Configure automatic refresh at startup:

```jsonc
{
  "model_capabilities": {
    "enabled": true,
    "auto_refresh_on_start": true,
    "refresh_timeout_ms": 5000,
    "source_url": "https://models.dev/api.json"
  }
}
```

### Capability Diagnostics

Run `bunx oh-my-openagent doctor` to see capability diagnostics including:
- effective model resolution for agents and categories
- warnings when configured models rely on compatibility fallback
- override compatibility details alongside model resolution output

## Context Injection

### Directory AGENTS.md

Auto-injects AGENTS.md when reading files. Walks from file directory to project root:

```
project/
├── AGENTS.md                        # Injected first
├── packages/omo-opencode/src/
│   ├── AGENTS.md                    # Injected second
│   └── components/
│       ├── AGENTS.md                # Injected third
│       └── Button.tsx               # Reading this injects all 3
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

| Type         | Locations                                                                          |
| ------------ | ---------------------------------------------------------------------------------- |
| **Commands** | OpenCode: `~/.config/opencode/command(s)/`, `.opencode/command(s)/`. Claude: `~/.claude/commands/`, `.claude/commands/` (gated by `claude_code.commands`) |
| **Skills**   | `~/.config/opencode/skills/*/SKILL.md`, `.claude/skills/*/SKILL.md`                |
| **Agents**   | `~/.config/opencode/agents/*.md`, `.claude/agents/*.md`                            |
| **MCPs**     | `~/.claude.json`, `~/.config/opencode/.mcp.json`, `.mcp.json`, `.claude/.mcp.json` |

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

| Toggle     | Disables                                                     |
| ---------- | ------------------------------------------------------------ |
| `mcp`      | `.mcp.json` files (keeps built-in MCPs)                      |
| `commands` | Command loading from Claude Code paths                       |
| `skills`   | Skill loading from Claude Code paths                         |
| `agents`   | Agent loading from Claude Code paths (keeps built-in agents) |
| `hooks`    | settings.json hooks                                          |
| `plugins`  | Claude Code marketplace plugins                              |

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
