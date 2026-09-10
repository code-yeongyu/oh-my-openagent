# output - Read-Only Task Inspection

## OVERVIEW
Resolves caller-scoped children and returns status snapshots or bounded transcript views without reviving or steering tasks.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Tool entry | `output.ts`, `index.ts` | Input validation, scoped lookup, and tool adapter. |
| Snapshot and formatting | `snapshot.ts`, `render.ts`, `renderers.ts` | Status details, transcript caps, and UI output. |
| Transcript sources | `transcript/` | Event-log and session JSONL readers. |
| Contracts | `types.ts` | Reader, snapshot, and result unions. |

## CONVENTIONS
- `status` is default; `tail` and `full` read transcripts, with `full` bounded and elided when necessary.
- Transcript source is explicit (`event-log`, `session-jsonl`, or `none`) and source reads are capped at 1,000,000 bytes.
- A missing caller session exposes no candidates; lookup is fail-closed to that session's children.
- Lost records return status plus breadcrumbs rather than attempting revival.

## ANTI-PATTERNS
- Never make this tool revive, steer, cancel, or otherwise mutate a child.
- Do not reintroduce blocking or timeout arguments; completion arrives through notification.
- Do not read another session's records merely because a task id is known.
- Keep transcript parsing bounded and source-specific.

## HOTSPOTS
- `output.ts` (141 lines) coordinates lookup, scoping, snapshot building, and result formatting.
- `renderers.ts` (127) owns call/result presentation including run-stat text.
- Transcript reading is delegated; see [`transcript/AGENTS.md`](transcript/AGENTS.md).

## QA
```sh
bun test packages/senpi-task/src/tools/output
```

Parent: [`../../AGENTS.md`](../../AGENTS.md).
