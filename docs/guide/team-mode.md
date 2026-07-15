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

> Bug-fix note: v4.2.1 adds a fresh-install regression test for this minimal config and logs the resolved `team_mode` state plus team tool count during startup. If the tools still do not appear after restart, inspect `oh-my-opencode.log` for the loaded config path and `[tool-registry] Built tool registry` entry.

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
    { "kind": "category", "name": "scout-1", "category": "deep", "prompt": "Scout the source directory for auth patterns." },
    { "kind": "category", "name": "scout-2", "category": "quick", "prompt": "Scout tests for auth coverage." }
  ]
}
```

When both scopes define the same team name, project scope wins.

`version`, `createdAt`, and `leadAgentId` are optional in config files. The loader fills them automatically. You can either write a top-level `lead: {...}` shorthand, mark one member with `isLead: true`, or omit both when the team has exactly one member.

## Member kinds

- **`kind: "subagent_type"`**: direct OMO built-in or an exact project-defined agent. For a project agent, Team Mode resolves `subagent_type` from OpenCode's final directory-scoped registry for that member's worktree. Its registry name, model, variant, prompt, and permissions stay intact. Team Mode does not substitute a category or generic agent. `prompt` is optional.
- **`kind: "category"`**: routed through `sisyphus-junior` with the chosen category model. `prompt` REQUIRED.

## Eligible agents

- **OMO built-ins:** The static eligibility list still applies. `sisyphus`, `atlas`, and `sisyphus-junior` are eligible. `hephaestus` is conditional on its teammate permission. `oracle`, `librarian`, `explore`, `multimodal-looker`, `metis`, `momus`, and `prometheus` are hard-rejected. Use `task` for hard-rejected built-ins.
- **Project agents:** A project-defined `.opencode/agents/*.md` agent is resolved separately by its exact final-registry identity, not by a generic static substitution. It must have mode `subagent` or `all`, `native: false`, not be hidden, and have effective `allow` for exactly `team_send_message`, `team_task_list`, `team_task_get`, `team_task_update`, and `team_status`. Missing, `ask`, or `deny` for any required tool rejects admission. `question` remains denied.
- **Inherited restrictions:** OpenCode applies agent permissions and then parent-session permissions, with the last matching rule winning. Team Mode never grants or elevates permissions, so a parent restriction that makes a required tool `ask` or `deny` rejects the project agent.

Project agents are members only. The caller or lead of `team_create` must be a provenance-verified eligible OMO built-in. A project agent cannot lead, even if its name resembles a built-in, has a display alias, or includes a list-order prefix.

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

Add `"worktreePath": "../wt-scout"` to a member entry. The path may be explicitly relative to the project root or absolute. Bare branch names are rejected. Requires `git`.

The member session and project-agent registry probes stay routed to that resolved directory. If Team Mode creates the exact leaf directory, it atomically assigns a private ownership token. Another active owner of that leaf conflicts. A pre-existing directory is usable but remains unowned and is preserved.

Normal cleanup, force cleanup, and rollback remove only owned leaves whose adjacent and internal `.omo-team-owner.json` markers match the saved token. Shared ancestors, pre-existing directories, and legacy unowned paths remain in place. Explicit worktree paths can be anywhere, not only under `~/.omo`.

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

`bunx oh-my-openagent doctor` includes a `team-mode` check showing tmux/git availability, declared team count, and active runtime dirs.

## Storage layout

```
~/.omo/
├── teams/{name}/config.json                      # user declaration scope
├── .highwatermark                                # runtime parity marker
└── runtime/{teamRunId}/                          # active runtime
    ├── state.json                                # durable runtime state
    ├── inboxes/{member}/{uuid}.json              # mailbox (atomic per-message files)
    ├── inboxes/{member}/.delivering-{uuid}.json  # transient live-delivery reservation
    ├── inboxes/{member}/processed/               # acked messages
    └── tasks/{id}.json                           # shared task list

<project>/.omo/teams/{name}/config.json           # project declaration scope, wins on name collision
<worktree-leaf>.omo-team-owner.json                # adjacent marker for an OMO-created leaf
<worktree-leaf>/.omo-team-owner.json               # internal marker with the same ownership token
```

`.delivering-{uuid}.json` files exist only while a message is being live-delivered via `promptAsync`. They are committed to `processed/` on delivery success, released back to `{uuid}.json` on failure, or reclaimed on team resume if stranded by a crash (10 minute TTL). `listUnreadMessages` ignores dotfile entries so the fallback poll never double-injects a reserved message.

For Team Mode behavior and configuration, use this guide as the reference.
