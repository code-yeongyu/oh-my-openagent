# team-mode — Parallel Multi-Agent Coordination

**Generated:** 2026-05-08

## OVERVIEW

Spawns coordinated agent teams with shared mailbox, task list, optional tmux layout, and graceful lifecycle. Modeled after Claude Code Agent Teams. **OFF by default.** Enable via `team_mode.enabled` in `oh-my-opencode.jsonc`; restart OpenCode after enabling.

User docs: [`docs/guide/team-mode.md`](file:///Users/yeongyu/local-workspaces/omo/docs/guide/team-mode.md).

## CONFIG

Full schema: [`src/config/schema/team-mode.ts`](file:///Users/yeongyu/local-workspaces/omo/src/config/schema/team-mode.ts).

```jsonc
{
  "team_mode": {
    "enabled": false,                       // gate
    "tmux_visualization": false,            // optional tmux pane layout
    "max_parallel_members": 4,              // 1..8
    "max_members": 8,                       // 1..8 hard cap
    "max_messages_per_run": 10000,          // 1..∞
    "max_wall_clock_minutes": 120,          // 1..∞
    "max_member_turns": 500,                // 1..∞
    "base_dir": null,                       // optional override of ~/.omo/teams or <project>/.omo/teams
    "message_payload_max_bytes": 32768,     // 1024..∞ — per-message payload cap
    "recipient_unread_max_bytes": 262144,   // 1024..∞ — per-recipient inbox cap
    "mailbox_poll_interval_ms": 3000        // 500..∞ — recipient poll cadence
  }
}
```

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

[`AGENT_ELIGIBILITY_REGISTRY`](file:///Users/yeongyu/local-workspaces/omo/src/features/team-mode/types.ts) in `types.ts` — three verdict tiers, each with its own rejection message:

| Verdict | Agents | Notes |
|---------|--------|-------|
| `eligible` | sisyphus, atlas, sisyphus-junior | Three only |
| `conditional` | hephaestus | Lacks `teammate: "allow"` permission by default. Either apply D-36 patch (add `teammate: "allow"` in `tool-config-handler.ts`) or use `subagent_type: "sisyphus"` instead |
| `hard-reject` | oracle, librarian, explore, multimodal-looker, metis, momus, prometheus | Read-only or plan-mode-only — cannot write to mailbox; use `task` (delegate-task) instead |

Hard-reject agents throw at TeamSpec parse with a specific message ("Agent 'X' is read-only…"). The error message points members at delegate-task as the right escape hatch.

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
| [`src/plugin/tool-registry.ts`](file:///Users/yeongyu/local-workspaces/omo/src/plugin/tool-registry.ts) `teamModeToolsRecord` | Registers 12 `team_*` tools |
| [`create-transform-hooks.ts`](file:///Users/yeongyu/local-workspaces/omo/src/plugin/hooks/create-transform-hooks.ts) | Conditionally builds `teamModeStatusInjector` (`team-mode-status-injector` hook) and `teamMailboxInjector` (`team-mailbox-injector` hook) — both Transform tier |
| [`create-tool-guard-hooks.ts`](file:///Users/yeongyu/local-workspaces/omo/src/plugin/hooks/create-tool-guard-hooks.ts) | Conditionally builds `teamToolGating` (`team-tool-gating` hook) — Tool Guard tier |
| [`src/plugin/event.ts`](file:///Users/yeongyu/local-workspaces/omo/src/plugin/event.ts) | Registers 4 team-session-event handlers from `src/hooks/team-session-events/`: `team-idle-wake-hint`, `team-lead-orphan-handler`, `team-member-error-handler`, `team-member-status-handler` |
| [`src/cli/doctor/checks/team-mode.ts`](file:///Users/yeongyu/local-workspaces/omo/src/cli/doctor/checks/team-mode.ts) | Doctor check for team-mode prerequisites |
| [`src/features/builtin-skills/skills/team-mode.ts`](file:///Users/yeongyu/local-workspaces/omo/src/features/builtin-skills/skills/team-mode.ts) | Built-in skill documenting the 12 tools — gated on `team_mode.enabled` |

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
