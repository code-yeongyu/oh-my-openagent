# src/features/ — 20 Feature Modules

**Generated:** 2026-05-08

## OVERVIEW

Standalone feature modules wired into `plugin/` layer. Each is self-contained with own types, implementation, and co-located tests. Most expose a single factory or class via `index.ts` barrel.

## MODULE MAP

| Module | Files | Complexity | Purpose |
|--------|-------|------------|---------|
| **background-agent** | 47 | HIGH | Task lifecycle, concurrency (5/key), 3s polling, spawner pattern, circuit breaker |
| **opencode-skill-loader** | 33 | HIGH | YAML frontmatter skill discovery from 4 scopes (project > opencode > user > global) |
| **tmux-subagent** | 34 | HIGH | Tmux pane management, grid planning, session orchestration via `runTmuxCommand` |
| **team-mode** | 24 dirs / 100+ files | HIGH | Parallel multi-agent coordination — 12 `team_*` tools, mailbox, tasklist, worktrees, optional tmux layout |
| **mcp-oauth** | 18 | HIGH | OAuth 2.0 + PKCE + DCR (RFC 7591) + step-up auth for MCP servers |
| **skill-mcp-manager** | 18 | HIGH | Tier-3 MCP client lifecycle per session (stdio + HTTP + OAuth) |
| **claude-code-plugin-loader** | 16 | MEDIUM | Unified Claude Code plugin discovery (commands, agents, skills, hooks, MCPs) |
| **builtin-skills** | 17 | LOW–MED | 10 built-in skill files (git-master, playwright, frontend-ui-ux, review-work, ai-slop-remover, dev-browser, playwright-cli, **team-mode**, …) |
| **builtin-commands** | 11 | LOW | Command templates: refactor, init-deep, handoff, ulw-loop, etc. |
| **claude-tasks** | 7 | MEDIUM | Sisyphus task schema + atomic file storage + OpenCode todo API sync |
| **claude-code-mcp-loader** | 11 | MEDIUM | Tier-2 MCP loader: `.mcp.json` parse + `${VAR}` env expansion |
| **context-injector** | 6 | MEDIUM | AGENTS.md/README.md injection into session context |
| **run-continuation-state** | 5 | LOW | Persistent state for `oh-my-opencode run` continuation across invocations |
| **hook-message-injector** | 5 | MEDIUM | System message injection helper used by hooks |
| **boulder-state** | 5 | LOW | Persistent state for boulder/multi-step operations |
| **task-toast-manager** | 4 | MEDIUM | Task progress notifications |
| **tool-metadata-store** | 3 | LOW | Tool execution metadata cache |
| **claude-code-session-state** | 3 | LOW | Subagent session state tracking |
| **claude-code-command-loader** | 3 | LOW | Load `/commands` from `.opencode/commands/` and Claude Code plugins |
| **claude-code-agent-loader** | 3 | LOW | Load agents from `.opencode/agents/` and Claude Code plugins |

## KEY MODULES

### background-agent (~10k LOC)

Core orchestration engine. `BackgroundManager` manages task lifecycle:
- States: `pending → running → completed | error | cancelled | interrupt`
- Concurrency: per-key (`${providerID}/${modelID}`) limits via `ConcurrencyManager` (FIFO queue)
- Polling: 3s interval, completion detected via idle event AND stability detection (10s unchanged)
- Circuit breaker: automatic failure detection and recovery
- `spawner/`: 8 focused files composing via `SpawnerContext` interface

### team-mode (~13k LOC)

Parallel multi-agent coordination, OFF by default. Subdirs:
- `team-registry/` — load/validate `~/.omo/teams/{name}/config.json`
- `team-state-store/` — durable runtime state with atomic locks
- `team-runtime/` — `team_create`, status, shutdown lifecycle
- `team-mailbox/` — async messaging (send/poll/ack)
- `team-tasklist/` — shared tasks with atomic claiming
- `team-worktree/` — git worktree per member
- `team-layout-tmux/` — optional tmux pane visualization
- `tools/` — 12 `team_*` tool implementations

Eligible members: sisyphus, atlas, sisyphus-junior, hephaestus only. See [`team-mode/AGENTS.md`](file:///Users/yeongyu/local-workspaces/omo/src/features/team-mode/AGENTS.md).

### opencode-skill-loader (~3.2k LOC)

4-scope skill discovery (project > opencode > user > global):
- YAML frontmatter parsing from SKILL.md files
- Skill merger with priority deduplication
- Provider gating for model-specific skills

### tmux-subagent (~3.6k LOC)

State-first tmux integration. Centralized tmux command execution through `src/shared/tmux/runner.ts` (`runTmuxCommand`). Direct `Bun.spawn(["tmux", ...])` is FORBIDDEN — would drift from retry/timeout discipline.

### builtin-skills (10 skills)

| Skill | LOC | MCP | Notes |
|-------|-----|-----|-------|
| git-master | 1111 | — | Atomic commits, rebase, history search |
| playwright | 312 | @playwright/mcp | Browser automation via MCP |
| playwright-cli | 268 | — | Browser automation via CLI |
| dev-browser | 221 | — | Persistent page state browser |
| review-work | ~500 | — | 5-agent post-implementation review orchestrator |
| ai-slop-remover | ~300 | — | Remove AI code patterns |
| **team-mode** | — | — | Loaded only when `team_mode.enabled` (skill explains the 12 tools to agents) |
| frontend-ui-ux | 79 | — | Design-first UI development |
| (git-master-skill-metadata) | — | — | Companion to git-master |

Browser variant selected by `browser_automation_engine` config: `playwright` (default) | `playwright-cli` | `agent-browser`.
