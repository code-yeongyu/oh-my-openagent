# Team Mode

Parallel multi-agent coordination for omo, modeled after Claude Code's experimental Agent Teams.

## Status

OFF by default. Enable via JSONC config.

## When to use

- Parallel exploration with bounded coordination.
- Long-running multi-step refactors split across specialised agents.
- Research + implementation pipelines that need shared task lists.

## Enable

Add to `~/.config/opencode/oh-my-opencode.jsonc` (or project `.opencode/oh-my-opencode.jsonc`):

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

## Define a team

Teams live as directories under `~/.omo/teams/{name}/config.json`:

```json
{
  "name": "ccapi-explorers",
  "description": "Explore the ccapi project structure.",
  "lead": { "kind": "subagent_type", "subagent_type": "sisyphus" },
  "members": [
    { "kind": "category", "name": "scout-1", "category": "deep", "prompt": "Scout the src/ dir for auth patterns." },
    { "kind": "category", "name": "scout-2", "category": "quick", "prompt": "Scout tests for auth coverage." }
  ]
}
```

Project-scoped variant: `<project>/.omo/teams/{name}/config.json` (project beats user on collisions).

`version`, `createdAt`, and `leadAgentId` are optional in config files. The loader fills them automatically. You can either write a top-level `lead: {...}` shorthand, mark one member with `isLead: true`, or omit both when the team has exactly one member.

## Member kinds

- **`kind: "subagent_type"`** — direct agent (atlas, sisyphus, sisyphus-junior, hephaestus). `prompt` optional.
- **`kind: "category"`** — routed through `sisyphus-junior` with the chosen category model. `prompt` REQUIRED.

## Eligible agents

Only **sisyphus, atlas, sisyphus-junior, hephaestus** can be members. Read-only and orchestration-only agents (`oracle`, `librarian`, `explore`, `multimodal-looker`, `metis`, `momus`, `prometheus`) are rejected at parse time. Use `delegate-task` for those.

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
| `team_delete` | Tear down (lead only, no active members). |
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

When enabled, each member gets a dedicated tmux pane attached to that member's session via `opencode attach`. The pane runs the full interactive opencode TUI for the member so you can watch streaming output in real time. Panes start in each member worktree when configured, otherwise the repo root.

`team_delete` closes the panes and tears down the team layout. Per-member shutdown closes just that pane and rebalances the remaining layout.

## What team mode does NOT do

- No nested teams (members cannot call `team_create`).
- No synchronous reply waits (`team_send_message` is fire-and-forget).
- No member-driven `delegate-task` (budget defaults to 0).
- No shutdown bypass — `team_delete` rejects active members.

## Diagnostics

`bunx oh-my-opencode doctor` includes a `team-mode` check showing tmux/git availability, declared team count, and active runtime dirs.

## Storage layout

```
~/.omo/
├── teams/{name}/config.json                      # declared specs
├── .highwatermark                                # parity marker for runtime state
└── runtime/{teamRunId}/
    ├── state.json                                # durable runtime state
    ├── inboxes/{member}/{uuid}.json              # mailbox (atomic per-message files)
    ├── inboxes/{member}/.delivering-{uuid}.json  # transient live-delivery reservation
    ├── inboxes/{member}/processed/               # acked messages
    └── tasks/{id}.json                           # shared task list
```

`.delivering-{uuid}.json` files exist only while a message is being live-delivered via `promptAsync`. They are committed to `processed/` on delivery success, released back to `{uuid}.json` on failure, or reclaimed on team resume if stranded by a crash (10 minute TTL). `listUnreadMessages` ignores dotfile entries so the fallback poll never double-injects a reserved message.

## Reference

Full design: `.sisyphus/plans/team-mode.md`.
