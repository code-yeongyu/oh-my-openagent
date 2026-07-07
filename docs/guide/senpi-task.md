# Senpi Task Delegation

The Senpi edition of omo (installed through `packages/omo-senpi`) ships a `task` component that lets the agent you are talking to spawn child agents, keep working while they run, steer them, and coordinate a named team. This guide covers the day-to-day surface. The engine internals live in [`packages/senpi-task/AGENTS.md`](../../packages/senpi-task/AGENTS.md); the config file is documented in [`docs/reference/omo-json.md`](../reference/omo-json.md).

The component is on by default. Disable it with the `--no-omo-task` flag; it also self-skips if the Senpi runtime is missing the ExtensionAPI capabilities it needs (`packages/omo-senpi/src/components/task/index.ts`).

## Spawning a child

Use the `task` tool. Only `prompt` is required, and it must be written in English (`packages/senpi-task/src/tools/task/params.ts`). Pick a target with **either** `category` (routed through Sisyphus-Junior) **or** `subagent_type` (a named agent invoked directly) - the two are mutually exclusive.

- `run_in_background: false` (default) waits and returns the child's final response inline.
- `run_in_background: true` returns a task id (prefixed `st_`) immediately so you can keep working and check back later.
- `name` gives the child a stable, human-friendly handle within the session so you can steer it by name instead of id.
- `execution_mode` overrides the runner for this child (see below); `model` overrides the resolved model; `load_skills` prepends named SKILL.md content to the child prompt.

To continue an existing child with full context instead of spawning a new one, pass its `task_id` (`task/params.ts`).

## In-process vs process

Two runners back a child (`packages/senpi-task/src/runners/`):

- **in-process (default).** The child runs inside the same Senpi runtime and executes through the SAME parent tool closures, minus the `task_*` / `team_*` family. This is the cheapest path and needs no extra process.
- **process.** The child is spawned as an isolated Senpi process. Steering (`steer` / `abort` / `prompt`) crosses a JSON-RPC boundary, the child's transcript is written under the task state directory's `sessions/`, and a killed or lost child is reconciled by the lifecycle on the next session start.

The default comes from `task.default_execution_mode` in `omo.json`; a per-agent `execution_mode` or the `task` tool's `execution_mode` argument overrides it.

## Steering, waiting, and stopping

Every control tool targets a child by `task_id` or by `name` (`packages/senpi-task/src/tools/control/`):

- **`task_send`** delivers a follow-up message or a steer. `deliver_as` is `followUp` (queued for the child's next turn) or `steer` (interrupt-and-inject). Set `all_scope: true` only to message a child owned by another session.
- **`task_wait`** blocks until the given `targets` reach a terminal state, or until `timeout_ms`. The timeout is clamped to the configured `wait` bounds (`min_ms` / `default_ms` / `max_ms`); a `1`ms wait is clamped up, not honored literally.
- **`task_interrupt`** interrupts a running child.
- **`task_cancel`** cancels a child and stops its work.

Cancel and interrupt are parent-initiated: they return their result synchronously in the tool response and never fire a completion notification.

## Inspecting children

- **`task_list`** lists tasks for the current session (or a wider scope).
- **`task_output`** returns a child's snapshot and transcript. Transcript output is capped (`TRANSCRIPT_MAX_CHARS`, `packages/senpi-task/src/tools/output/render.ts`).

## Completion notifications

When a background child finishes on its own - `completed`, `error`, or `lost` - the engine routes a completion to the parent exactly once (`packages/senpi-task/src/completion/routing.ts`):

- Parent **idle**: it is woken (or, if `task.notification.wake_idle_parent` is `false`, the completion is queued silently).
- Parent **streaming**: the completion is delivered using `task.notification.deliver_as` (`followUp` or `steer`).
- Parent **compacting / switching / shutting down**: the completion is buffered and flushed once the parent settles.

Because cancel and interrupt return synchronously, they are never delivered as notifications - only externally-caused terminals notify.

## The `/tasks` UI

The component registers two slash commands (`packages/omo-senpi/src/components/task/commands.ts`):

- **`/tasks`** lists this session's tasks; `/tasks --all` lists tasks across every session.
- **`/task-kill`** opens a selector over cancellable tasks (running / pending / interrupted) and cancels the chosen one after a confirm.

A live status footer also tracks the session's tasks as they change.

## Teams

For coordinated multi-agent work, the lead session gets 12 team tools (`packages/senpi-task/src/tools/team/index.ts`): `team_create`, `team_delete`, `team_send_message`, `team_status`, `team_list`, `team_task_create`, `team_task_list`, `team_task_update`, `team_task_get`, `team_shutdown_request`, `team_approve_shutdown`, `team_reject_shutdown`. These are lead-only; child and member sessions do not receive the `team_*` family (a member gets only a pre-scoped `team_send_message`).

Teams are defined in the `teams` block of `omo.json`. Each team has 1-8 members; a multi-member team requires `leadAgentId`. A member is either `kind: "category"` (needs `category` + `prompt`) or `kind: "subagent_type"` (needs `subagent_type`). See the [teams schema](../reference/omo-json.md#teams).

## Configuration

All defaults live in `omo.json` under `task` and `teams`. A minimal project config:

```jsonc
// .omo/omo.jsonc
{
  "task": {
    "default_execution_mode": "in-process",
    "notification": { "deliver_as": "followUp", "wake_idle_parent": true },
    "wait": { "default_ms": 90000 }
  }
}
```

Full field reference, defaults, layer precedence, and the `omo.json` vs `oh-my-openagent.json` coexistence rules are in [`docs/reference/omo-json.md`](../reference/omo-json.md).

## Follow-ups

- Team members currently run in-process in project-scoped `.omo/` teams. The `backendType: "tmux"` member option and user-global team storage are schema-reserved and not yet exercised by the Senpi runtime.
