# src/features/ — 22 Feature Modules

**Generated:** 2026-06-08

## OVERVIEW

Standalone feature modules wired into `plugin/` layer. Each is self-contained with own types, implementation, and co-located tests. Several directories now provide OpenCode adapter shims over extracted Core packages; keep those shim paths stable unless the plugin wiring is moved at the same time.

## MODULE MAP

| Module | Complexity | Has sub-AGENTS.md | Purpose |
|--------|------------|-------------------|---------|
| **team-mode** | HIGH | yes | Parallel multi-agent coordination — 12 `team_*` tools; domain primitives live in `packages/team-core/` with OpenCode runtime/session wiring here |
| **background-agent** | HIGH | yes | Task lifecycle, concurrency (5/key), 3s polling, spawner pattern, circuit breaker. Newer files include `parent-wake-notifier.ts`, `loop-detector`, `error-classifier`, `fallback-retry-handler`, `process-cleanup`, `subagent-spawn-limits`, `session-status-classifier`, and `compaction-aware-message-resolver`. |
| **tmux-subagent** | HIGH | yes | Tmux pane management, grid planning, session orchestration via `runTmuxCommand`; reusable tmux primitives live in `packages/tmux-core/` |
| **opencode-skill-loader** | HIGH | yes | OpenCode adapter for YAML frontmatter skill discovery; reusable loader primitives live in `packages/skills-loader-core/` |
| **builtin-skills** | LOW–MED | yes | Built-in skill files (git-master, playwright, frontend, review-work, remove-ai-slops, init-deep, security-research, security-review, dev-browser, playwright-cli, **team-mode**, …) |
| **skill-mcp-manager** | HIGH | yes | OpenCode adapter for tier-3 MCP client lifecycle; reusable client/OAuth primitives live in `packages/mcp-client-core/` |
| **claude-code-plugin-loader** | MEDIUM | yes | OpenCode adapter for Claude Code plugin discovery; reusable compatibility loaders live in `packages/claude-code-compat-core/` |
| **builtin-commands** | LOW | yes | Command templates: refactor, init-deep, handoff, ulw-loop, etc. |
| **mcp-oauth** | HIGH | yes | OAuth 2.0 + PKCE + DCR (RFC 7591) + step-up auth for MCP servers |
| **claude-code-agent-loader** | LOW | yes | OpenCode adapter for agents from `.opencode/agents/` and Claude Code plugins; shared loader lives in `packages/claude-code-compat-core/` |
| **claude-code-mcp-loader** | MEDIUM | yes | OpenCode adapter for tier-2 MCP loader; `.mcp.json` parse + `${VAR}` env expansion live in `packages/claude-code-compat-core/` |
| **tool-metadata-store** | LOW–MED | no | Tool execution metadata cache; publish/recover lifecycle + task metadata contract |
| **boulder-state** | LOW | yes | Persistent state for boulder (active work plan tracking across sessions/worktrees) |
| **context-injector** | LOW | no | AGENTS.md/README.md injection into session context |
| **hook-message-injector** | LOW | no | System message injection helper used by hooks |
| **run-continuation-state** | LOW | no | Persistent state for `oh-my-opencode run` continuation across invocations |
| **opencode-runtime-skills** | LOW–MED | no | Runtime security-skill source — `selectRuntimeSecuritySkills()` + `createRuntimeSkillSourceServer()` serve security skills to sessions at runtime |
| **claude-code-command-loader** | LOW | no | Load `/commands` from `.opencode/commands/` and Claude Code plugins |
| **claude-tasks** | MEDIUM | yes | Sisyphus task schema + atomic file storage + OpenCode todo API sync |
| **task-toast-manager** | MEDIUM | no | Task progress notifications |
| **claude-code-session-state** | LOW | no | Subagent session state tracking |

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

Parallel multi-agent coordination, OFF by default. Harness-neutral domain primitives are extracted to `packages/team-core/`; this directory owns OpenCode-specific spawning, tool registration, and hook integration. Subdirs:
- `team-registry/` — load/validate `~/.omo/teams/{name}/config.json`
- `team-state-store/` — durable runtime state with atomic locks
- `team-runtime/` — `team_create`, status, shutdown lifecycle
- `team-mailbox/` — async messaging (send/poll/ack)
- `team-tasklist/` — shared tasks with atomic claiming
- `team-worktree/` — git worktree per member
- `team-layout-tmux/` — optional tmux pane visualization
- `tools/` — 12 `team_*` tool implementations

Eligible members: sisyphus, atlas, sisyphus-junior, hephaestus only. See [`team-mode/AGENTS.md`](team-mode/AGENTS.md).

### opencode-skill-loader (~2.8k LOC)

4-scope skill discovery (project > opencode > user > global):
- YAML frontmatter parsing from SKILL.md files
- Skill merger with priority deduplication
- Provider gating for model-specific skills

### tmux-subagent (~3.6k LOC)

State-first tmux integration. Shared tmux primitives are extracted to `packages/tmux-core/`, while this feature owns OpenCode session tracking and pane decisions. Centralized tmux command execution goes through the shared runner. Direct `Bun.spawn(["tmux", ...])` is FORBIDDEN — would drift from retry/timeout discipline.

### builtin-skills (12 skills)

| Skill | LOC | MCP | Notes |
|-------|-----|-----|-------|
| git-master | 1111 | — | Atomic commits, rebase, history search |
| playwright | 312 | @playwright/mcp | Browser automation via MCP |
| playwright-cli | 268 | — | Browser automation via CLI |
| dev-browser | 221 | — | Persistent page state browser |
| review-work | ~500 | — | 5-agent post-implementation review orchestrator |
| $omo:remove-ai-slops | — | — | Remove AI code patterns |
| init-deep | — | — | Hierarchical AGENTS.md generation |
| security-research | SKILL.md | — | Team Mode exploitability-driven security research |
| security-review | wrapper | — | Alias for security-research |
| **team-mode** | — | — | Loaded only when `team_mode.enabled` (skill explains the 12 tools to agents) |
| frontend | 79 | — | Design-first UI development |
| (git-master-skill-metadata) | — | — | Companion to git-master |

Browser variant selected by `browser_automation_engine` config: `playwright` (default) | `playwright-cli` | `agent-browser`.
