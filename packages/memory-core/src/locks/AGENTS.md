# memory-core/src/locks — Domain Locking

## OVERVIEW

Implements domain-specific cross-process locks with ownership records, process identity checks, stale-candidate sweeping, and contention-aware acquisition. Distinct domain (score 8): the arbitration layer every memory write and reflection run depends on. Parent: [`packages/memory-core/AGENTS.md`](../../AGENTS.md).

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Acquire/release/status | `acquire.ts` |
| Domain paths and names | `domains.ts` |
| Owner record schema | `lock-record.ts` |
| PID/start identity | `process-identity.ts` |
| Leaked/stale candidates | `candidate-sweep.ts` |
| Public barrel | `index.ts` |

## CONVENTIONS

- Lock domains are explicit (`memory-write`, `reflection-scheduler`, and transcript-specific locking) and paths are derived by builders.
- Acquisition uses unique candidates and ownership metadata; stale candidates are swept opportunistically and cleanup failure is advisory.
- Reclaiming a lock requires both PID liveness and process start identity, so a recycled PID cannot steal a live lock; Windows sharing errors (`EBUSY`/`EPERM`/`EACCES`) get bounded unlink retries.
- Wait and abort behavior is injected/configured through `AcquireLockOptions` for deterministic tests.

## ANTI-PATTERNS

- Do not replace domain locks with one global lock.
- Do not retry exclusive creates blindly after EINTR or reclaim a live owner.
- Do not let advisory cleanup errors erase the original contention or acquisition result.

## QA

```bash
bun test packages/memory-core/src/locks/
```

Contention is exercised with real subprocesses (see `../concurrency/`); a test
that passes by timing luck is a bug, not a flake.
