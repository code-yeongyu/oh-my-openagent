# memory-core/src/journal — Transcript Journal

## OVERVIEW

Persists conversation entries, cursor/reflection snapshots, and local journal locks for deterministic incremental reflection input. Distinct domain (score 8): the append-side counterpart to `reflection/`. Parent: [`packages/memory-core/AGENTS.md`](../../AGENTS.md).

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Append and snapshot orchestration | `store.ts` |
| Entry validation/projection | `entries.ts` |
| Cursor and reflection state | `cursor.ts` |
| Local lock | `lock.ts` |
| Durable flush | `fsync.ts` |
| Public barrel | `index.ts` |

## CONVENTIONS

- Entries are validated by kind and required capture/source identifiers before projection.
- Reflection payloads are bounded by `REFLECTION_SNAPSHOT_MAX_BYTES`; remainder is carried to a later capture.
- Journal flush uses fsync helpers and must not hold the journal lock while flushing, allowing append progress.
- Filesystem calls use `../fs/resilient`; persistence is append/snapshot oriented rather than in-place record mutation.

## ANTI-PATTERNS

- Do not treat a concurrent snapshot miss as journal corruption.
- Do not accept empty transcript IDs or silently discard malformed entries.
- Do not add timing sleeps to cross-process journal tests; await exact process/file events.

## QA

```bash
bun test packages/memory-core/src/journal/
```

Concurrent append/snapshot cases are the point of this suite; await the exact
file or state transition with a bounded timeout.
