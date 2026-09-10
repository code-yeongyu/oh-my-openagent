# transcript - Bounded Child Transcript Readers

## OVERVIEW
Reads event-log and session JSONL transcript sources through a common bounded reader contract.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Source selection | `reader.ts`, `index.ts` | Chooses event-log, session JSONL, or no source. |
| Event logs | `event-log.ts` | Parses persisted task events into transcript entries. |
| Session JSONL | `session-dir.ts`, `session-jsonl.ts` | Locates and parses child session records. |
| Bounds | `read-bounded.ts` | Enforces `MAX_TRANSCRIPT_SOURCE_BYTES`. |

## CONVENTIONS
- Reader results preserve source identity and truncation state for the output renderer.
- Event and session formats are parsed separately; do not merge their schemas into a permissive parser.
- Relative paths are derived from the task state directory and task id.
- Malformed or absent sources produce an explicit empty/diagnostic result as defined by the reader contract.

## ANTI-PATTERNS
- Never read an unbounded transcript file.
- Never claim a session transcript when the source was the event log or no source existed.
- Do not make transcript inspection mutate task state.

## HOTSPOTS
- `event-log.ts` (61 lines) has the most branching of the readers because event payload shapes vary.
- `session-dir.ts` (49) resolves child session paths before parsing.
- Every module here is small by design; keep new source support in its own file.

## QA
```sh
bun test packages/senpi-task/src/tools/output/transcript
```

Parent: [`../AGENTS.md`](../AGENTS.md).
