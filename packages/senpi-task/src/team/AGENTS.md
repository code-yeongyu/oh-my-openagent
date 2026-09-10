# team - Named Team Runtime

## OVERVIEW
Implements team specification normalization, durable runtime registries, process members, mailboxes, tasklists, messaging, and shutdown handshakes.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Spec and registry | `normalize.ts`, `registry.ts`, `storage.ts`, `runtime-config.ts` | Discovery versus runtime paths and team identity. |
| Runtime lifecycle | `runtime.ts`, `spawn-members.ts`, `member-respawn.ts`, `shutdown.ts` | Create/delete, process launch, recovery, and shutdown. |
| Member projection | `member-map.ts`, `member-projection.ts`, `member-validator.ts` | Canonical member state and spawn validation. |
| Mail delivery | `messaging/` | Lead polling, reservation journal, reconciliation, and reclaim. |
| In-child behavior | `member-extension/` | Member self-poller and scoped `task_send`. |
| Lead task tools | `../tools/team/` | Six lead-only tool definitions and runners. |

## CONVENTIONS
- Project `.omo/teams/<name>/config.json` is read-only discovery; mutable runtime state is under the resolved state directory.
- Team members are process-mode children and use `lead` only as the current-session sentinel, never as a spawnable member.
- Specs normalize JSON strings, singleton members, the `agent` alias, and task-summary limits before `TeamSpecSchema` parsing.
- Runtime directories and inboxes are created with restrictive permissions; service ports are injected into tools.
- Mail delivery is reservation-based and commits only after the recipient session durably observes the envelope.

## ANTI-PATTERNS
- Never call team-core validation/loading paths that invoke opencode-roster eligibility.
- Never import forbidden team-core root, tmux, opencode, or team-mode surfaces; only allowlisted team-core subpaths are valid.
- Tools must use manager/service ports, not the task record store directly.
- Do not treat `lead` as a worker or write runtime state into the project team config.

## HOTSPOTS
- `runtime.ts` (271 lines) owns team creation, directories, and deletion cleanup.
- `spawn-members.ts` (181) and `shutdown.ts` (176) carry member launch and retirement handshakes.
- `import-discipline.test.ts` enforces the allowlisted team-core subpaths recursively; update it deliberately.

## QA
```sh
bun test packages/senpi-task/src/team
```

Parent: [`../AGENTS.md`](../AGENTS.md).
