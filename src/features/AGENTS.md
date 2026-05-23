# src/features/ — 20 Feature Modules

**Generated:** 2026-05-20

## OVERVIEW

Standalone feature modules wired into `plugin/` layer. Each is self-contained with own types, implementation, and co-located tests. Most expose a single factory or class via `index.ts` barrel.

## MODULE MAP

File counts are NON-TEST `.ts` files only (test files co-located but excluded from the count).

| Module | Files | Complexity | Has sub-AGENTS.md | Purpose |
|--------|-------|------------|-------------------|---------|
| **team-mode** | 60 / 8 subdirs | HIGH | yes | Parallel multi-agent coordination — 12 `team_*` tools, mailbox, tasklist, worktrees, optional tmux layout |
| **background-agent** | 30 / 1 subdir (spawner/) | HIGH | yes | Task lifecycle, concurrency (5/key), 3s polling, spawner pattern, circuit breaker. Newer files: `parent-wake-notifier.ts` (587 LOC), `loop-detector`, `error-classifier`, `fallback-retry-handler`, `process-cleanup`, `subagent-spawn-limits`, `session-status-classifier`, `compaction-aware-message-resolver`. |
| **tmux-subagent** | 27 | HIGH | yes | Tmux pane management, grid planning, session orchestration via `runTmuxCommand` |
| **opencode-skill-loader** | 25 / 1 subdir (merger/) | HIGH | yes | YAML frontmatter skill discovery from 4 scopes (project > opencode > user > global) |
| **builtin-skills** | 18 / 5 subdirs | LOW–MED | yes | 10 built-in skill files (git-master, playwright, frontend-ui-ux, review-work, ai-slop-remover, dev-browser, playwright-cli, **team-mode**, …) |
| **skill-mcp-manager** | 11 | HIGH | yes | Tier-3 MCP client lifecycle per session (stdio + HTTP + OAuth) |
| **claude-code-plugin-loader** | 11 | MEDIUM | yes | Unified Claude Code plugin discovery (commands, agents, skills, hooks, MCPs) |
| **builtin-commands** | 11 / 1 subdir (templates/) | LOW | yes | Command templates: refactor, init-deep, handoff, ulw-loop, etc. |
| **mcp-oauth** | 10 | HIGH | yes | OAuth 2.0 + PKCE + DCR (RFC 7591) + step-up auth for MCP servers |
| **claude-code-agent-loader** | 7 | LOW | yes | Load agents from `.opencode/agents/` and Claude Code plugins |
| **claude-code-mcp-loader** | 7 | MEDIUM | yes | Tier-2 MCP loader: `.mcp.json` parse + `${VAR}` env expansion |
| **tool-metadata-store** | 6 | LOW–MED | no | Tool execution metadata cache; publish/recover lifecycle + task metadata contract |
| **boulder-state** | 6 | LOW | yes | Persistent state for boulder (active work plan tracking across sessions/worktrees) |
| **context-injector** | 4 | LOW | no | AGENTS.md/README.md injection into session context |
| **hook-message-injector** | 4 | LOW | no | System message injection helper used by hooks |
| **run-continuation-state** | 4 | LOW | no | Persistent state for `oh-my-opencode run` continuation across invocations |
| **claude-code-command-loader** | 4 | LOW | no | Load `/commands` from `.opencode/commands/` and Claude Code plugins |
| **claude-tasks** | 3 | MEDIUM | yes | Sisyphus task schema + atomic file storage + OpenCode todo API sync |
| **task-toast-manager** | 3 | MEDIUM | no | Task progress notifications |
| **claude-code-session-state** | 2 | LOW | no | Subagent session state tracking |

## KEY MODULES

### background-agent

Core orchestration engine. `BackgroundManager` manages task lifecycle:
- States: `pending → running → completed | error | cancelled | interrupt`
- Concurrency: per-key (`${providerID}/${modelID}`) limits via `ConcurrencyManager` (FIFO queue)
- Polling: 3s interval, completion detected via idle event AND stability detection (10s unchanged)
- Circuit breaker: automatic failure detection and recovery in `manager-circuit-breaker.test.ts`
- `spawner/`: focused files composing via `SpawnerContext` interface
- Parent-wake state extracted to `parent-wake-notifier.ts` (587 LOC, dependency-injected client + enqueue callback)

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
