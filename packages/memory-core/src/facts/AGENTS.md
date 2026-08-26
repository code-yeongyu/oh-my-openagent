# src/facts/ — Durable Fact-Extraction Pipeline

## OVERVIEW

Queues extracted facts durably, caps payloads, routes them to people cards, and
recovers from crashes — all with monotonic watermarks and fail-closed parsing.
Largest memory-core subsystem (33 files, ~5.1k LOC); earned its own file for
that plus strict wire contracts. Parent: [`packages/memory-core/AGENTS.md`](../../AGENTS.md).

## WHERE TO LOOK

| File | Role |
|------|------|
| `queue.ts` | `FactsQueue` — atomic enqueue/publish with monotonic watermarks |
| `schema.ts` | Versioned queue/cursor/consumed record shapes; fail-closed validation |
| `extraction.ts` | `applyFactsBatch()`, `parseFactsExtractionJsonl()` validation |
| `payload-cap.ts` | `selectCappedFactsBatch()` — 128 KiB envelope budget (`MAX_FACTS_PAYLOAD_BYTES`) |
| `failures-{schema,backoff,store,selection}.ts` | Failure records, backoff/clear-on-success, starvation-aware `selectLaunchable()` |
| `person-routing.ts` | `planFactsRouting()` — alias resolution, observation normalization, render targets |
| `mutation-plan.ts` | `planFactsMutation()` + `factsRecordsHash()` — dirty-parent guard, deterministic ops |
| `recovery*.ts` | `applyFactsRecovery()`, ownership/reservation finalization, setter-race handling |
| `person-index.ts`, `assets/facts-persona.md` | Person index + extraction persona prompt |

## CONVENTIONS

- **Wire contracts are exported on purpose** — queue/cursor/consumed records,
  extraction unions, failure states, and recovery paths are versioned public
  shapes; changing them is a cross-package event, not a refactor.
- **Durability is structural:** every durable write goes `.tmp` → rename,
  mode `0o600`, under an identity-scoped lock. No in-place mutation.
- **Filenames are Windows-safe:** colon-free UTC timestamps plus hashed
  conversation/message identifiers (opaque IDs, never lexical anchors).
- **Ordering is by canonical journal position / snapshot boundary**, not
  message-ID ordering; queue publication accounts for retained queue files to
  close crash windows.

## ANTI-PATTERNS

- NEVER regress enqueue or consumed watermarks when an older batch settles.
- Do NOT compare opaque message IDs lexically or anchor position on
  non-canonical trailing entries.
- Do NOT truncate an oversized single entry — report it as oversized and leave
  it unconsumed (caps apply to batches, not surgery on entries).
- Do NOT bypass atomic publication, identity-scoped locking, or fail-closed
  parsing when touching durable facts state.

## QA

```bash
bun test packages/memory-core/src/facts/
```

Integration-heavy: temp identity/git repos and explicit race/recovery
scenarios. No fixed sleeps — await exact state transitions.
