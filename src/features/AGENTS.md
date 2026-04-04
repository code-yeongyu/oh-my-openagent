# src/features/ — 19 Feature Modules

**Generated:** 2026-03-06

## OVERVIEW

Standalone feature modules wired into plugin/ layer. Each is self-contained with own types, implementation, and tests.

## MODULE MAP

| Module | Files | Complexity | Purpose |
|--------|-------|------------|---------|
| **opencode-skill-loader** | 33 | HIGH | YAML frontmatter skill loading from 4 scopes |
| **background-agent** | 31 | HIGH | Task lifecycle, concurrency (5/model), polling, spawner pattern |
| **tmux-subagent** | 30 | HIGH | Tmux pane management, grid planning, session orchestration |
| **mcp-oauth** | 18 | HIGH | OAuth 2.0 + PKCE + DCR (RFC 7591) for MCP servers |
| **builtin-skills** | 17 | LOW | 6 skills: git-master, playwright, playwright-cli, agent-browser, dev-browser, frontend-ui-ux |
| **skill-mcp-manager** | 12 | MEDIUM | MCP client lifecycle per session (stdio + HTTP) |
| **claude-code-plugin-loader** | 10 | MEDIUM | Unified plugin discovery from .opencode/plugins/ |
| **builtin-commands** | 11 | LOW | Command templates: refactor, init-deep, handoff, etc. |
| **claude-tasks** | 7 | MEDIUM | Task schema + file storage + OpenCode todo sync |
| **claude-code-mcp-loader** | 6 | MEDIUM | .mcp.json loading with ${VAR} env expansion |
| **context-injector** | 6 | MEDIUM | AGENTS.md/README.md injection into context |
| **run-continuation-state** | 5 | LOW | Persistent state for `run` command continuation across sessions |
| **hook-message-injector** | 5 | MEDIUM | System message injection for hooks |
| **boulder-state** | 5 | LOW | Persistent state for multi-step operations |
| **task-toast-manager** | 4 | MEDIUM | Task progress notifications |
| **tool-metadata-store** | 3 | LOW | Tool execution metadata cache |
| **claude-code-session-state** | 3 | LOW | Subagent session state tracking |
| **claude-code-command-loader** | 3 | LOW | Load commands from .opencode/commands/ |
| **claude-code-agent-loader** | 3 | LOW | Load agents from .opencode/agents/ |

## KEY MODULES

### background-agent (31 files, ~10k LOC)

Core orchestration engine. `BackgroundManager` manages task lifecycle:
- States: pending → running → completed/error/cancelled/interrupt
- Concurrency: per-model/provider limits via `ConcurrencyManager` (FIFO queue)
- Polling: 3s interval, completion via idle events + stability detection (10s unchanged)
- spawner/: 8 focused files composing via `SpawnerContext` interface

### opencode-skill-loader (33 files, ~3.2k LOC)

4-scope skill discovery (project > opencode > user > global):
- YAML frontmatter parsing from SKILL.md files
- Skill merger with priority deduplication
- Template resolution with variable substitution
- Provider gating for model-specific skills

### tmux-subagent (30 files, ~3.6k LOC)

State-first tmux integration:
- `TmuxSessionManager`: pane lifecycle, grid planning
- Spawn action decider + target finder
- Polling manager for session health
- Event handlers for pane creation/destruction

### builtin-skills (6 skill objects)

| Skill | Size | MCP | Tools |
|-------|------|-----|-------|
| git-master | 1111 LOC | — | Bash |
| playwright | 312 LOC | @playwright/mcp | — |
| agent-browser | (in playwright.ts) | — | Bash(agent-browser:*) |
| playwright-cli | 268 LOC | — | Bash(playwright-cli:*) |
| dev-browser | 221 LOC | — | Bash |
| frontend-ui-ux | 79 LOC | — | — |

Browser variant selected by `browserProvider` config: playwright (default) | playwright-cli | agent-browser.
