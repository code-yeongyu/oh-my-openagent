# Senpi Task Delegation

The Senpi edition of omo (installed through `packages/omo-senpi`) ships a `task` component that lets the agent you are talking to spawn child agents, keep working while they run, steer them, and coordinate a named team. This guide covers the day-to-day surface. The engine internals live in [`packages/senpi-task/AGENTS.md`](../../packages/senpi-task/AGENTS.md); the config file is documented in [`docs/reference/omo-json.md`](../reference/omo-json.md).

The component is on by default. Disable it with the `--no-omo-task` flag; it also self-skips if the Senpi runtime is missing the ExtensionAPI capabilities it needs (`packages/omo-senpi/src/components/task/index.ts`).

## Spawning a child

Use the `task` tool. Only `prompt` is required, and it must be written in English (`packages/senpi-task/src/tools/task/params.ts`). Pick a target with **either** `category` (routed through Sisyphus-Junior) **or** `subagent_type` (a named agent invoked directly) - the two are mutually exclusive.

- `run_in_background: false` (default) waits and returns the child's final response inline.
- `run_in_background: true` returns a task id (prefixed `st_`) immediately so you can keep working and check back later.
- `name` gives the child a stable, human-friendly handle within the session so you can steer it by name instead of id.
- `model` overrides the resolved model; `load_skills` prepends named SKILL.md content to the child prompt.

Spawn admission uses trusted runtime lineage and caller identity. Unknown lineage fails closed, reviewer and specialist sessions cannot spawn, and target allowlists only narrow access. Senpi currently permits one child level; `task.max_depth: 2` remains valid in the shared schema but is capped to `1` by this adapter because child runtimes do not receive general spawn tools.

To continue an existing child with full context instead of spawning a new one, use `task_send` with `to` set to the child id or name.

For fanout, pass `tasks:[...]` instead of the top-level `prompt`/target fields. Each item chooses its own `category` or `subagent_type` and may set `name`, `model`, and `load_skills`:

```jsonc
{
  "tasks": [
    { "category": "quick", "prompt": "Check the API contract.", "name": "contract" },
    { "subagent_type": "oracle", "prompt": "Review the migration risk.", "name": "risk" }
  ],
  "run_in_background": true
}
```

A synchronous batch waits for every started child and returns one aggregate result. A background batch returns each child id and queue position immediately. If one child cannot start after the batch has been validated, its failure is reported alongside successfully started siblings.

## In-process vs process

Two runners back a child (`packages/senpi-task/src/runners/`):

- **in-process (default).** The child runs inside the same Senpi runtime and executes through the SAME parent tool closures, minus the `task_*` / `team_*` family. This is the cheapest path and needs no extra process.
- **process.** The child is spawned as an isolated Senpi process. Steering (`steer` / `abort` / `prompt`) crosses a JSON-RPC boundary, and the child's transcript is written below `children/<taskId>/sessions/<taskId>/`. On the next session start, a dead process child with a persisted session can be respawned without replaying its original prompt and rebound with `switch_session`.

Before a persisted child is respawned, the adapter resolves its target, model, variant, working directory, extensions, environment, caller, lineage, and depth from current configuration and runtime state. Persisted launch fields do not control recovery. Disabling or removing a target prevents recovery from reviving it.

The default comes from `task.default_execution_mode` in `omo.json`; a per-agent `execution_mode` can override it.

Team members always use process mode. Their child process loads a small member extension that owns the member inbox poller and exposes only team-scoped `task_send` and `team_wait`.

## Steering, waiting, and stopping

Every control/read tool targets a child by id or by name:

- **`task_send`** delivers a follow-up message or a steer. `to` accepts a child id/name or a team member name. `deliver_as` is `followUp` (queued for the child's next turn), `steer` (interrupt-and-inject), or `interrupt` (park a running resident child without ending it). Structured shutdown messages also route through this tool for lead sessions.
- **`task_output`** returns a child's snapshot and transcript. `block` defaults to `true`, so a read waits for a running child until it finishes or `timeout_ms` is reached; pass `block:false` for an immediate peek. The timeout is clamped to the configured `wait` bounds (`min_ms` / `default_ms` / `max_ms`). Committed `team_wait` recoveries appear as `[team message from <from>] <body>` lines.
- **`task_cancel`** cancels a child terminally and stops its work.

Parent-initiated park and cancel return their result synchronously in the tool response and never fire a completion notification.

## Inspecting children

- Use **`/tasks`** to list child tasks for the current session or a wider scope.
- Transcript output is capped (`TRANSCRIPT_MAX_CHARS`, `packages/senpi-task/src/tools/output/render.ts`).

## Completion notifications

When a background child finishes on its own - `completed`, `error`, or `lost` - the engine routes a completion to the parent exactly once (`packages/senpi-task/src/completion/routing.ts`):

- Parent **idle**: it is always woken so the completion injects on the parent's next turn. No setting can suppress this.
- Parent **streaming**: the completion is steered into the running turn at the next tool-call boundary. Multiple notifications that become ready in the same batch window (about 200ms) are combined into one injection.
- Parent **compacting / switching / shutting down**: the completion is buffered and flushed once the parent settles.

Because cancel and park return synchronously, they are never delivered as notifications - only externally-caused terminals notify.

## The `/tasks` UI

The component registers two slash commands (`packages/omo-senpi/src/components/task/commands.ts`):

- **`/tasks`** lists this session's tasks; `/tasks --all` lists tasks across every session.
- **`/task-kill`** opens a selector over cancellable tasks (running / pending / interrupted) and cancels the chosen one after a confirm.

A live status footer also tracks the session's tasks as they change.

## Teams

For coordinated multi-agent work, the lead session gets 7 team tools (`packages/senpi-task/src/tools/team/index.ts`): `team_create`, `team_delete`, `task_create`, `task_get`, `task_list`, `task_update`, and `team_wait`. These are lead-only. Member sessions receive only team-scoped `task_send` and `team_wait`; they never receive team lifecycle or tasklist tools. Lead team messages and shutdown request/response payloads route through `task_send`.

Teams are defined in the `teams` block of `omo.json`. Each team has 1-8 members; a multi-member team requires `leadAgentId`. A member is either `kind: "category"` (needs `category` + `prompt`) or `kind: "subagent_type"` (needs `subagent_type`). See the [teams schema](../reference/omo-json.md#teams).

### Pull messaging and `team_wait`

Team sends are file-only: `task_send` appends a message to the recipient's durable inbox and returns immediately. It does not push into, steer, or revive the recipient. Each member process polls its own inbox; the lead adapter polls only teams whose persisted `leadSessionId` belongs to the current session. Lead polling runs on session start and every second while the parent is idle or streaming, and pauses during compaction, session switching, and shutdown.

Use `team_wait` when the next step depends on a reply:

```jsonc
{ "team_run_id": "<run-id>", "from": "reviewer", "timeout_ms": 30000 }
```

`from` is optional. A lead with exactly one owned team may omit `team_run_id`; a lead with multiple teams must provide it. Members omit `team_run_id` because their extension is already scoped to one team. The wait registers before polling, so an already-unread message and a newly arriving message follow the same path.

Inbox delivery uses a reservation and a durable `processed/<messageId>.json` ledger. A message is committed only after its envelope is visible in the recipient session or a waiting tool claims it. If the process dies between injection and commit, restart reconciliation checks the persisted session before deciding whether to commit or redeliver, preventing duplicate envelopes. If the immediate `team_wait` result is lost after commit, read that member's `task_output`; the committed `team_message_waited` event preserves the sender and body.

## Configuration

All defaults live in `omo.json` under `task` and `teams`. A minimal project config:

```jsonc
// .omo/omo.jsonc
{
  "task": {
    "default_execution_mode": "in-process",
    "reattach_on_reconcile": true,
    "wait": { "default_ms": 90000 }
  }
}
```

Full field reference, defaults, layer precedence, and the `omo.json` vs `oh-my-openagent.json` coexistence rules are in [`docs/reference/omo-json.md`](../reference/omo-json.md).

`packages/omo-opencode` is a separate build that still uses its prior task/team names; cross-edition parity is a deliberate follow-up outside this Senpi guide.

## Follow-ups

- The `backendType: "tmux"` member option and user-global team storage are schema-reserved and not yet exercised by the Senpi runtime.
