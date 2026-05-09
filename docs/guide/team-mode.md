# Team Mode

Parallel multi-agent coordination for omo, modeled after Claude Code's experimental Agent Teams.

## Status

OFF by default. Enable via JSONC config.

## When to use

- Parallel exploration with bounded coordination.
- Long-running multi-step refactors split across specialised agents.
- Research + implementation pipelines that need shared task lists.

## Enable

Add to user config `~/.config/opencode/oh-my-openagent.jsonc` or project config `.opencode/oh-my-openagent.jsonc`:

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
  "lead": { "kind": "subagent_type", "subagent_type": "sisyphus" },
  "members": [
    { "kind": "category", "name": "scout-1", "category": "deep", "prompt": "Scout the src/ dir for auth patterns." },
    { "kind": "category", "name": "scout-2", "category": "quick", "prompt": "Scout tests for auth coverage." }
  ]
}
```

When both scopes define the same team name, project scope wins.

`version`, `createdAt`, and `leadAgentId` are optional in config files. The loader fills them automatically. You can either write a top-level `lead: {...}` shorthand, mark one member with `isLead: true`, or omit both when the team has exactly one member.

## Member kinds

- **`kind: "subagent_type"`** — direct agent (atlas, sisyphus, sisyphus-junior, hephaestus). `prompt` optional.
- **`kind: "category"`** — routed through `sisyphus-junior` with the chosen category model. `prompt` REQUIRED.

## Eligible agents

- **Eligible:** `sisyphus`, `atlas`, `sisyphus-junior`.
- **Conditional:** `hephaestus` (needs teammate permission `teammate: "allow"`; otherwise use `subagent_type: "sisyphus"`).
- **Hard-reject:** `oracle`, `librarian`, `explore`, `multimodal-looker`, `metis`, `momus`, `prometheus`.

Hard-reject agents fail TeamSpec parsing because they cannot write mailbox state. Use `delegate-task` for those agents.

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

### How to invoke team mode

From inside opencode running inside tmux, ask the lead agent to call `team_create` — either by team name or with an inline spec:

```
team_create({ teamName: "ccapi-explorers" })
team_create({ inline_spec: { name: "scratch", members: [{ name: "scout", category: "quick", prompt: "..." }] } })
```

Both `opencode` and `omo` (oh-my-openagent) expose the same 12 `team_*` tools — there is no separate command-line entrypoint. The skill prompts (`/team-mode`) document the exact tool calls a lead and member should make.

### Window layout you'll see

When `tmux_visualization` is on, `team_create` builds two regions inside your existing tmux session:

| Region | Where | Contents |
|--------|-------|----------|
| Focus window | The window you ran `opencode` in (your current window — usually window `0`) | Your lead pane on the left (~30% width) plus one attached pane per teammate, tiled with `main-vertical` |
| Live-tail window | A new sibling window named `team-live-<id>` | One pane per teammate streaming the `omo-team-pane-live-tail.py` event feed for that member's session |

`team_create` keeps the active window/pane fixed on your caller window and pane after building the layout, so you do not get yanked into the live-tail window. Earlier versions could jump to the live-tail window — that is fixed: every `new-window` and `split-window` is launched with `-d`, and a final `select-window`/`select-pane` restores the caller view.

### Switching between windows

Standard tmux key chords (default prefix `Ctrl+B`):

- `prefix + 0` — back to your focus window (lead + member panes).
- `prefix + n` / `prefix + p` — next / previous window.
- `prefix + w` — interactive window picker (the live-tail window is named `team-live-<id>`).
- `prefix + l` — toggle to the previously visible window.
- Inside the focus window, `prefix + arrow` moves between the lead pane and teammate panes.

If you ever land in an unexpected window after `team_create`, run `prefix + 0` (or `prefix + l`) to return — and please file a bug with the team-run id, since restoration is now explicit.

### Cleanup behaviour

- `team_delete` (lead-only) tears down panes, the live-tail window, worktrees, mailbox, and tasklist. When the team was created in your existing window (the common path), `team_delete` only kills the live-tail window and the teammate panes — it never kills your caller window — and then `select-window`'s back to your caller window so you are not stranded if you happened to be viewing the live-tail.
- Per-member `team_shutdown_request` + `team_approve_shutdown` closes only that member's focus pane (and its live-tail pane) and rebalances the remaining layout in place.

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
