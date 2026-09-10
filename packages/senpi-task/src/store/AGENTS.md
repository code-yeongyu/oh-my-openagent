# store - Filesystem Task Persistence

## OVERVIEW
Persists task records, event logs, locks, parsing diagnostics, redacted payloads, and two-phase cleanup under the resolved state directory.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Store facade | `record-store.ts`, `index.ts` | Read cache, mutation lock, transitions, listing, and cleanup. |
| Record compatibility | `record-parse.ts`, `record-blocks-parse.ts`, `scalar-read.ts`, `run-stats-parse.ts` | Strict scalar validation and legacy shape support. |
| Allocation and locks | `claim.ts`, `record-lock.ts` | Create-only collision claims and per-record serialization. |
| Events and redaction | `event-log.ts`, `redaction.ts` | Separate JSONL logs and secret-field filtering. |
| State location | `state-dir.ts` | Resolves the configured state directory. |

## CONVENTIONS
- Records are JSON files under `tasks/`; events are separate JSONL files under `logs/`.
- Create uses `wx` collision detection; replacement uses temp-file/rename semantics and cache validation by mtime/size.
- `mutate` and transitions hold the per-record lock around read-modify-write.
- TTL cleanup renames to a tombstone under lock, then removes artifacts after releasing the lock.
- Record lists return diagnostics for malformed entries instead of failing the entire scan.

## ANTI-PATTERNS
- Never delete a record during a normal terminal transition; use transitions for state changes.
- Never recursively delete artifacts while holding a record lock.
- Never persist untrusted launch inputs such as extensions or member environment.
- Never let malformed scalar fields silently coerce, and never emit unredacted event payloads.

## HOTSPOTS
- `record-store.ts` (283 lines) centralizes cache, locking, transitions, tombstoning, and cleanup.
- `record-parse.ts` (170) and `record-blocks-parse.ts` (158) carry compatibility and validation logic.
- `event-log.ts` keeps a capped LRU of append file descriptors; closing them is part of record removal.

## QA
```sh
bun test packages/senpi-task/src/store
```

Parent: [`../AGENTS.md`](../AGENTS.md).
