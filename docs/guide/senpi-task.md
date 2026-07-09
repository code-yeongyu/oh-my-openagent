# Senpi Task Delegation

The Senpi edition of omo (installed through `packages/omo-senpi`) ships a `task` component that lets the agent you are talking to spawn child agents, keep working while they run, steer them, and coordinate a named team. This guide covers the day-to-day surface. The engine internals live in [`packages/senpi-task/AGENTS.md`](../../packages/senpi-task/AGENTS.md); the config file is documented in [`docs/reference/omo-json.md`](../reference/omo-json.md).

The component is on by default. Disable it with the `--no-omo-task` flag; it also self-skips if the Senpi runtime is missing the ExtensionAPI capabilities it needs (`packages/omo-senpi/src/components/task/index.ts`).

## Spawning a child

Use the `task` tool. Only `prompt` is required, and it must be written in English (`packages/senpi-task/src/tools/task/params.ts`). Pick a target with **either** `category` (routed through Sisyphus-Junior) **or** `subagent_type` (a named agent invoked directly) - the two are mutually exclusive.

- `run_in_background: false` (default) waits and returns the child's final response inline.
- `run_in_background: true` returns a task id (prefixed `st_`) immediately so you can keep working and check back later.
- `name` gives the child a stable, human-friendly handle within the session so you can steer it by name instead of id.
- `model` overrides the resolved model; `load_skills` prepends named SKILL.md content to the child prompt.

To continue an existing child with full context instead of spawning a new one, use `task_send` with `to` set to the child id or name.

## In-process vs process

Two runners back a child (`packages/senpi-task/src/runners/`):

- **in-process (default).** The child runs inside the same Senpi runtime and executes through the SAME parent tool closures, minus the `task_*` / `team_*` family. This is the cheapest path and needs no extra process.
- **process.** The child is spawned as an isolated Senpi process. Steering (`steer` / `abort` / `prompt`) crosses a JSON-RPC boundary, the child's transcript is written under the task state directory's `sessions/`, and a killed or lost child is reconciled by the lifecycle on the next session start.

The default comes from `task.default_execution_mode` in `omo.json`; a per-agent `execution_mode` can override it.

## Steering, waiting, and stopping

Every control/read tool targets a child by id or by name:

- **`task_send`** delivers a follow-up message or a steer. `to` accepts a child id/name or a team member name. `deliver_as` is `followUp` (queued for the child's next turn), `steer` (interrupt-and-inject), or `interrupt` (park a running resident child without ending it). Structured shutdown messages also route through this tool for lead sessions.
- **`task_output`** returns a child's snapshot and transcript. `block` defaults to `true`, so a read waits for a running child until it finishes or `timeout_ms` is reached; pass `block:false` for an immediate peek. The timeout is clamped to the configured `wait` bounds (`min_ms` / `default_ms` / `max_ms`).
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

For coordinated multi-agent work, the lead session gets 6 team tools (`packages/senpi-task/src/tools/team/index.ts`): `team_create`, `team_delete`, `task_create`, `task_get`, `task_list`, `task_update`. These are lead-only; child and member sessions do not receive the lead family. Member sessions receive only a pre-scoped `task_send`, while lead team messages and shutdown request/response payloads also route through `task_send`.

Teams are defined in the `teams` block of `omo.json`. Each team has 1-8 members; a multi-member team requires `leadAgentId`. A member is either `kind: "category"` (needs `category` + `prompt`) or `kind: "subagent_type"` (needs `subagent_type`). See the [teams schema](../reference/omo-json.md#teams).

## Configuration

All defaults live in `omo.json` under `task` and `teams`. A minimal project config:

```jsonc
// .omo/omo.jsonc
{
  "task": {
    "default_execution_mode": "in-process",
    "wait": { "default_ms": 90000 }
  }
}
```

Full field reference, defaults, layer precedence, and the `omo.json` vs `oh-my-openagent.json` coexistence rules are in [`docs/reference/omo-json.md`](../reference/omo-json.md).

`packages/omo-opencode` is a separate build that still uses its prior task/team names; cross-edition parity is a deliberate follow-up outside this Senpi guide.

## Follow-ups

- Team members currently run in-process in project-scoped `.omo/` teams. The `backendType: "tmux"` member option and user-global team storage are schema-reserved and not yet exercised by the Senpi runtime.
