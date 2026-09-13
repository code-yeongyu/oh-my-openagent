# Team Mode

Parallel multi-agent coordination for omo, modeled after Claude Code's experimental Agent Teams.

## Status

OFF by default. Enable via JSONC config.

## When to use

- Parallel exploration with bounded coordination.
- Long-running multi-step refactors split across specialised agents.
- Research + implementation pipelines that need shared task lists.

## Enable

Add to the `[opencode]` block of `~/.omo/omo.jsonc` (user) or `.omo/omo.jsonc` (project):

```jsonc
{
  "team_mode": {
    "enabled": true,
    "max_parallel_members": 4,
    "max_members": 8,
    "tmux_visualization": false
  }
}
```

After enabling, restart opencode. The 12 `team_*` tools become available.

> Bug-fix note: a fresh-install regression test covers this minimal config and startup logs the resolved `team_mode` state plus team tool count (`[tool-registry] Built tool registry`). If the tools still do not appear after restart, inspect `oh-my-opencode.log` for the loaded config path and `[tool-registry] Built tool registry` entry.

## Config schema (11 fields)

All fields live under `team_mode`:

- `enabled` (boolean, default `false`)
- `tmux_visualization` (boolean, default `false`)
- `max_parallel_members` (int, `1..8`, default `4`)
- `max_members` (int, `1..8`, default `8`)
- `max_messages_per_run` (int, `>=1`, default `10000`)
- `max_wall_clock_minutes` (int, `>=1`, default `120`)
- `max_member_turns` (int, `>=1`, default `500`)
- `base_dir` (optional string; default resolves to `~/.omo`)
- `message_payload_max_bytes` (int, `>=1024`, default `32768`)
- `recipient_unread_max_bytes` (int, `>=1024`, default `262144`)
- `mailbox_poll_interval_ms` (int, `>=500`, default `3000`)

## Define a team

Team specs live under `~/.omo/teams/{name}/config.json` (user scope) or `<project>/.omo/teams/{name}/config.json` (project scope):

```json
{
  "name": "ccapi-explorers",
  "description": "Explore the ccapi project structure.",
  "members": [
    { "kind": "category", "name": "scout-1", "category": "deep", "prompt": "Scout the source directory for auth patterns." },
    { "kind": "category", "name": "scout-2", "category": "quick", "prompt": "Scout tests for auth coverage." },
    { "kind": "subagent_type", "name": "auditor", "subagent_type": "my-security-auditor", "prompt": "Audit the auth findings the scouts report." }
  ]
}
```

When both scopes define the same team name, project scope wins.

`version` and `createdAt` are optional in config files; the loader fills them automatically. The lead is always the current session, so there is no lead member to declare. `team_create` also accepts the same shape inline: `{ name, members: [{ name, category|subagent_type, prompt? }] }`.

## Member kinds

- **`kind: "category"`**: routed to the category worker, a fresh worker session configured by the category's model and skills. `prompt` REQUIRED. Unknown categories fail with `UNRESOLVABLE_CATEGORY` and the error lists the available ones.
- **`kind: "subagent_type"`** (alias `"agent"`): a user-defined agent from `omo.json` `agents`, invoked directly. `prompt` optional. The kind is inferred from whichever field you set, so you can omit it.

## Who can be a member

- **Eligible:** any resolvable category, and any user-defined agent.
- **Rejected at parse:** the curated read-only agents (`explore`, `librarian`, `plan-consultant`, `plan-reviewer`) and the ulw-loop reviewer trio (`omo-senpi-code-reviewer`, `omo-senpi-qa-executor`, `omo-senpi-gate-reviewer`).

The curated agents are read-only and in-process, so they can't write mailbox state. The reviewer trio is rejected because process-mode members drop reviewer instructions and tool allowlists. Route both groups through the `task` tool instead (`packages/senpi-task/src/team/member-validator.ts`).

## Lifecycle

1. `team_create` — spawns team and member sessions.
2. Lead delegates work via `team_send_message`, `team_task_create`.
3. Members claim tasks (`team_task_update` with `status: "claimed"`), report back via `team_send_message`.
4. `team_shutdown_request` → member or lead acks via `team_approve_shutdown` / `team_reject_shutdown`.
5. `team_delete` — removes runtime state, worktrees, optional tmux layout.

## 12 tools

| Tool | Purpose |
|------|---------|
| `team_create` | Spawn a team. |
| `team_delete` | Tear down (lead only; rejects active members unless `force: true`). |
| `team_shutdown_request` | Lead asks a member to wrap up. |
| `team_approve_shutdown` / `team_reject_shutdown` | Member or lead responds. |
| `team_send_message` | Peer-to-peer mailbox; lead-only broadcast. |
| `team_task_create` / `_list` / `_update` / `_get` | Shared task list. |
| `team_status` | Aggregate runtime view. |
| `team_list` | Declared + active teams. |

## Bounds (defaults)

- 8 members max, 4 in flight.
- 32 KB per message body, 256 KB per recipient unread.
- 10 000 messages per run, 120 minutes wall clock, 500 turns per member.

## Worktrees (optional per member)

Add `"worktreePath": "../wt-scout"` to a member entry. Path is filesystem-relative or absolute; bare branch names are rejected. Requires `git`.

## tmux visualization (optional)

Set `tmux_visualization: true`. Requires running inside a tmux session and tmux on PATH. Failures are isolated - a missing tmux never blocks team creation.

When enabled, each member gets a dedicated tmux pane attached to that member's session via `opencode attach`. The pane runs the full interactive opencode TUI for the member so you can watch streaming output in real time. Panes start in each member worktree when configured, otherwise `process.cwd()`.

`team_delete` closes the panes and tears down the team layout. Per-member shutdown closes just that pane and rebalances the remaining layout.

## What team mode does NOT do

- No nested teams (members cannot call `team_create`).
- No synchronous reply waits (`team_send_message` is fire-and-forget).
- Members are asked not to spawn further children (member guidance prompt); the `task` tool is not budget-gated to 0. Nested `team_create` is denied.
- `team_delete` rejects active members unless `force: true`.

## Diagnostics

`bunx oh-my-openagent doctor` includes a `team-mode` check showing tmux/git availability, declared team count, and active runtime dirs.

## Storage layout

```
~/.omo/
├── teams/{name}/config.json                      # declared specs
└── runtime/{teamRunId}/
    ├── state.json                                # durable runtime state
    ├── inboxes/{member}/{uuid}.json              # mailbox (atomic per-message files)
    ├── inboxes/{member}/.delivering-{uuid}.json  # transient live-delivery reservation
    ├── inboxes/{member}/processed/               # acked messages
    ├── tasks/{id}.json                           # shared task list
    ├── tasks/claims/                             # task claim records
    └── tasks/.highwatermark                      # tasklist id allocator
```

`.delivering-{uuid}.json` files exist only while a message is being live-delivered via `promptAsync`. They are committed to `processed/` on delivery success, released back to `{uuid}.json` on failure, or reclaimed on team resume if stranded by a crash (10 minute TTL). `listUnreadMessages` ignores dotfile entries so the fallback poll never double-injects a reserved message.

## Reference

Implementation notes: `packages/omo-opencode/src/features/team-mode/AGENTS.md` and `packages/team-core/AGENTS.md`.
