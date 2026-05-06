# team-mode — Parallel Multi-Agent Coordination

**Generated:** 2026-04-18

## OVERVIEW

Parity with Claude Code Agent Teams. OFF by default. Enable via `team_mode.enabled` in config.

Spawns coordinated agent teams with shared mailbox, task list, and lifecycle management. Lead delegates, members claim tasks, graceful shutdown with acks.

## MODULE LAYOUT

```
team-mode/
├── index.ts                    # barrel exports (types, worktree)
├── types.ts                    # Zod schemas: TeamSpec, Member, Message, Task, RuntimeState
├── member-parser.ts            # member validation with eligibility registry
├── deps.ts                     # dependency injection types
├── team-session-registry.ts    # in-memory sessionId -> team/member map for spawn-race-safe lookups
├── team-registry/              # team spec loading from ~/.omo/teams/
│   ├── index.ts
│   ├── loader.ts               # load from user + project scopes
│   ├── paths.ts                # path resolution
│   └── validator.ts            # TeamSpec validation
├── team-state-store/           # durable runtime state
│   ├── index.ts
│   ├── store.ts                # CRUD for state.json
│   ├── resume.ts               # resume orphaned runs
│   └── locks.ts                # atomic file locks
├── team-runtime/               # team lifecycle
│   ├── index.ts
│   ├── create.ts               # team_create implementation
│   ├── status.ts               # team_status implementation
│   ├── shutdown.ts             # shutdown request/approve/reject
│   ├── resolve-member.ts       # member agent resolution
│   └── resolve-member-dependencies.ts
├── team-mailbox/               # async messaging
│   ├── index.ts
│   ├── send.ts                 # team_send_message
│   ├── poll.ts                 # inbox polling
│   ├── ack.ts                  # message ack
│   └── inbox.ts                # inbox file ops
├── team-tasklist/              # shared task list
│   ├── index.ts
│   ├── store.ts                # task CRUD
│   ├── list.ts                 # team_task_list
│   ├── get.ts                  # team_task_get
│   ├── update.ts               # team_task_update (claim, complete)
│   ├── claim.ts                # task claiming with locks
│   └── dependencies.ts         # task dependency graph
├── team-worktree/              # git worktree per member
│   ├── index.ts
│   ├── manager.ts              # worktree lifecycle
│   └── cleanup.ts              # worktree removal
├── team-layout-tmux/           # optional tmux visualization
│   ├── index.ts
│   ├── layout.ts               # pane layout management
│   ├── close-team-member-pane.ts # close member pane + rebalance window
│   ├── rebalance-team-window.ts  # redistribute layout after pane changes
│   └── sweep-stale-team-sessions.ts # garbage-collect orphaned team tmux sessions
└── tools/                      # 12 team_* tools
    ├── index.ts                # tool registration
    ├── lifecycle.ts            # create, delete, shutdown
    ├── messaging.ts            # send_message
    ├── tasks.ts                # task_create, list, update, get
    └── query.ts                # status, list
```

## STORAGE LAYOUT

See user guide: `docs/guide/team-mode.md`

## KEY INVARIANTS

1. **Deferred ack**: Messages are fire-and-forget; recipient acks via separate call.
2. **Locked tasks**: Task claiming uses atomic file locks; concurrent claims resolve safely.
3. **Atomic writes**: All state changes write to temp file then rename.
4. **Eligible agents only**: sisyphus, atlas, sisyphus-junior, hephaestus allowed. Read-only agents rejected at parse.
5. **No nested teams**: Members cannot call `team_create`.
6. **Spawn-race-safe session resolution**: Every team session spawn MUST call `registerTeamSession(sessionId, entry)` synchronously when the sessionID becomes known; every hook that resolves a sessionID to a team/member MUST call `lookupTeamSession` before falling back to `loadRuntimeState` to avoid the spawn-race window.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Add new team tool | `tools/` + register in `index.ts` |
| Modify member eligibility | `types.ts` AGENT_ELIGIBILITY_REGISTRY |
| Change storage format | `types.ts` Zod schemas |
| Add worktree features | `team-worktree/manager.ts` |
| Modify tmux layout | `team-layout-tmux/layout.ts` |
| Task lifecycle changes | `team-tasklist/` |
| Mailbox protocol changes | `team-mailbox/` |
