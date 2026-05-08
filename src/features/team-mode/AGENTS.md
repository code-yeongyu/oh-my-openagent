# team-mode — Parallel Multi-Agent Coordination

**Generated:** 2026-05-08

## OVERVIEW

Spawns coordinated agent teams with shared mailbox, task list, optional tmux layout, and graceful lifecycle. Modeled after Claude Code Agent Teams. **OFF by default.** Enable via `team_mode.enabled` in `oh-my-opencode.jsonc`; restart OpenCode after enabling.

User docs: [`docs/guide/team-mode.md`](file:///Users/yeongyu/local-workspaces/omo/docs/guide/team-mode.md).

## CONFIG

```jsonc
{
  "team_mode": {
    "enabled": true,
    "max_parallel_members": 4,    // concurrent active members
    "max_members": 8,             // hard cap on team size
    "tmux_visualization": false   // optional tmux pane layout
  }
}
```

Schema: [`src/config/schema/team-mode.ts`](file:///Users/yeongyu/local-workspaces/omo/src/config/schema/team-mode.ts).

## 12 TEAM_* TOOLS

Registered via [`src/plugin/tool-registry.ts`](file:///Users/yeongyu/local-workspaces/omo/src/plugin/tool-registry.ts) `teamModeToolsRecord` only when enabled.

| Tool | Source File | Purpose |
|------|-------------|---------|
| `team_create` | `tools/lifecycle.ts` | Spawn team + member sessions from named or inline TeamSpec |
| `team_delete` | `tools/lifecycle.ts` | Tear down state, mailbox, tasklist, worktrees, optional tmux |
| `team_shutdown_request` | `tools/lifecycle.ts` | Member or lead requests its own shutdown |
| `team_approve_shutdown` | `tools/lifecycle.ts` | Lead acks shutdown |
| `team_reject_shutdown` | `tools/lifecycle.ts` | Lead rejects shutdown with reason |
| `team_send_message` | `tools/messaging.ts` | Send to member name or `*` broadcast |
| `team_task_create` | `tools/tasks.ts` | Create task on shared list |
| `team_task_list` | `tools/tasks.ts` | List tasks (filter by status / owner) |
| `team_task_update` | `tools/tasks.ts` | Claim / complete / delete (atomic file lock) |
| `team_task_get` | `tools/tasks.ts` | Fetch single task |
| `team_status` | `tools/query.ts` | Full team run status (members, tasks, mailbox) |
| `team_list` | `tools/query.ts` | List declared + active teams |

## ELIGIBLE AGENTS

```
ALLOWED: sisyphus, atlas, sisyphus-junior, hephaestus
REJECTED at parse: oracle, librarian, explore, multimodal-looker, metis, momus, prometheus
```

Read-only and orchestration-only agents are blocked at TeamSpec parse time. For those, the lead delegates via `task` (delegate-task) instead.

Eligibility registry: [`types.ts`](file:///Users/yeongyu/local-workspaces/omo/src/features/team-mode/types.ts) `AGENT_ELIGIBILITY_REGISTRY`.

## MEMBER KINDS

```jsonc
{
  "members": [
    { "kind": "subagent_type", "name": "scout", "subagent_type": "sisyphus" },
    { "kind": "category", "name": "writer", "category": "writing", "prompt": "Write release notes" }
  ]
}
```

- `kind: "subagent_type"` — direct agent. `prompt` optional.
- `kind: "category"` — routed through `sisyphus-junior` with the chosen category model. `prompt` REQUIRED.

## MODULE LAYOUT

```
team-mode/
├── index.ts                    # barrel
├── types.ts                    # Zod schemas: TeamSpec, Member, Message, Task, RuntimeState; AGENT_ELIGIBILITY_REGISTRY
├── deps.ts                     # checkTeamModeDependencies (git, tmux availability)
├── member-parser.ts            # member validation against eligibility registry
├── member-guidance.ts          # auto-injected guidance per member kind
├── member-session-resolution.ts
├── member-session-routing.ts
├── resolve-caller-team-lead.ts # determine if a session is acting as lead
├── team-session-registry.ts    # spawn-race-safe sessionID → team/member lookups
├── team-registry/              # team spec loading from ~/.omo/teams/{name}/config.json
│   ├── loader.ts
│   ├── paths.ts                # ensureBaseDirs, resolveBaseDir
│   └── validator.ts
├── team-state-store/           # durable runtime state.json with atomic locks
├── team-runtime/               # create/status/shutdown lifecycle
├── team-mailbox/               # async messaging (send / poll / ack / inbox)
├── team-tasklist/              # CRUD + claiming + dependencies
├── team-worktree/              # one git worktree per member; cleanup on delete
├── team-layout-tmux/           # optional pane layout — close-team-member-pane, sweep-stale-team-sessions
└── tools/                      # 12 team_* tool implementations + tests
```

## STORAGE LAYOUT

```
~/.omo/teams/{name}/                       # user scope
<project>/.omo/teams/{name}/               # project scope (wins on collision)
  ├── config.json                          # TeamSpec
  ├── state.json                           # runtime: members, sessionIDs, lifecycle
  ├── mailbox/                             # one .jsonl per recipient
  ├── tasklist.jsonl                       # shared task list
  └── worktrees/{member-name}/             # git worktree per member
```

## LIFECYCLE

```
1. team_create
   → load TeamSpec → validate eligibility → spawn member sessions
   → init mailbox + tasklist + worktrees → optional tmux layout
2. Lead delegates via team_send_message + team_task_create
3. Members claim tasks (team_task_update status="claimed") → execute → report (team_send_message)
4. team_shutdown_request → team_approve_shutdown / team_reject_shutdown
5. team_delete → cleanup state, mailbox, tasklist, worktrees, panes
```

## KEY INVARIANTS

1. **Spawn-race-safe resolution:** every team spawn calls `registerTeamSession(sessionId, entry)` synchronously when sessionID is known; every hook resolving sessionID calls `lookupTeamSession` BEFORE `loadRuntimeState` to avoid the spawn-race window.
2. **Deferred ack:** messages are fire-and-forget; recipient acks via separate call.
3. **Locked tasks:** task claiming uses atomic file locks; concurrent claims resolve safely.
4. **Atomic writes:** state changes write to temp file then rename.
5. **Eligible agents only:** rejection at parse, never at runtime.
6. **No nested teams:** members CANNOT call `team_create`.

## INTEGRATION POINTS

| Where | What |
|-------|------|
| [`src/index.ts`](file:///Users/yeongyu/local-workspaces/omo/src/index.ts) (entry) | `checkTeamModeDependencies()` + `ensureBaseDirs()` if `team_mode.enabled` |
| [`src/plugin/tool-registry.ts`](file:///Users/yeongyu/local-workspaces/omo/src/plugin/tool-registry.ts) | `teamModeToolsRecord` gate registers 12 tools |
| `src/hooks/team-mode-status-injector/` | Injects `<team_mode_status>` block into messages |
| `src/hooks/team-mailbox-injector/` | Pulls pending mailbox messages into agent context |
| `src/hooks/team-session-events/` | React to member session lifecycle |
| `src/hooks/team-tool-gating/` | Restrict `team_*` tools by member role |
| [`src/cli/doctor/checks/team-mode.ts`](file:///Users/yeongyu/local-workspaces/omo/src/cli/doctor/checks/team-mode.ts) | Doctor check for team-mode prerequisites |
| [`src/features/builtin-skills/skills/team-mode.ts`](file:///Users/yeongyu/local-workspaces/omo/src/features/builtin-skills/skills/team-mode.ts) | Built-in skill that documents the tools — only loaded when enabled |

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Add new team tool | `tools/` + register in [`src/plugin/tool-registry.ts`](file:///Users/yeongyu/local-workspaces/omo/src/plugin/tool-registry.ts) `teamModeToolsRecord` |
| Modify member eligibility | `types.ts` `AGENT_ELIGIBILITY_REGISTRY` |
| Change storage format | `types.ts` Zod schemas |
| Add worktree behavior | `team-worktree/manager.ts` |
| Modify tmux layout | `team-layout-tmux/layout.ts` |
| Task lifecycle changes | `team-tasklist/` |
| Mailbox protocol changes | `team-mailbox/` |
| Recover orphaned runs | `team-state-store/resume.ts` |

## ANTI-PATTERNS

- Never bypass `team-session-registry` — direct `loadRuntimeState` lookups will hit the spawn-race window.
- Never write team state files without the atomic lock from `team-state-store/locks.ts`.
- Never substitute `task` (delegate-task) for `team_*` tools when the user explicitly asks for team-mode work — they are not equivalent.
- Never allow members to call `team_create` (nested teams are forbidden by `team-tool-gating` hook).
