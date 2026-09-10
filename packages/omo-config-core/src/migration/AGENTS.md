# migration

## OVERVIEW
Crash-resumable legacy-config migration engine: owner-aware lease locking, journaled transactions, no-clobber transforms, and comment-preserving target writes. Earned a file by being the only transactional domain in this package.

## WHERE TO LOOK

| Area | Location | Notes |
|------|----------|-------|
| Runners | `engine.ts`, `batch.ts` | Single and batched execution: lock, resume, discover plans, execute, release. |
| Locking | `lock.ts` | Lease record with pid, mutation guard file, bounded retry, and reclaim rules. |
| Journal and resume | `journal.ts`, `recovery.ts` | Durable transaction record and replay of an interrupted run before any predicate check. |
| Planning | `predicate.ts`, `merge.ts` | Marker-based skip decisions and no-clobber edit collection with `skipped:` diagnostics. |
| Commit | `commit.ts`, `backup-move.ts` | Additive and replace-target preparation, target writes, and source backup moves. |
| Contracts | `types.ts` | Injected clock/process/filesystem ports, plan and result shapes, boundary names, typed errors. |
| Tests | `*.test.ts`, `migration-test-support.ts` | In-memory filesystem plus lock, recovery, merge, in-place, and transaction coverage. |

## CONVENTIONS

- Order is fixed: acquire lock, resume any journal, then evaluate predicates. Recovery runs before a plan can decide it has nothing to do.
- Completion is recorded per target and migration id in the target's `_migrations` list, which makes a rerun after an interruption safe and idempotent.
- The lease is renewed at every boundary. A dead owner is reclaimable at expiry; a live owner must overrun its lease by a multiple of the lease window before takeover, and lock mutations are serialized through a short-lived guard file.
- Plans run in one of two modes: additive merge into an existing target, or full target replacement. Existing target values win in additive mode and conflicts are reported rather than overwritten.
- Every step emits a named boundary (`journal-written`, `target-written`, `target-recorded`, `source-moved`, `source-recorded`) so crash-point tests can interrupt exactly where it matters.
- Source and backup paths are validated up front: no duplicates, no protected paths (target, journal, lock), and no colliding backup destinations.

## ANTI-PATTERNS

- Never bypass the lock, journal, or recovery sequence, and never write a target before its journal entry exists.
- Never clobber an existing target value or treat a partially applied transaction as complete.
- Never use global clock, pid, or filesystem access inside transactional logic when an injected port exists.
- Do not remove the journal until every target write and backup move has completed.
