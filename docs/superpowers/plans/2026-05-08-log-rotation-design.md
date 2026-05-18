# Log file rotation — design (#3772)

**Issue:** [oh-my-openagent#3772](https://github.com/code-yeongyu/oh-my-openagent/issues/3772) — `oh-my-opencode.log` grows unbounded; long-running or busy projects accumulate multi-GB log files in `%TEMP%` (Windows) and `/tmp` (Unix).

## Problem

`src/shared/logger.ts` writes every log entry to `os.tmpdir()/oh-my-opencode.log` via `fs.appendFileSync` with no size cap. There is no rotation, no truncation threshold, and no automatic cleanup. A single bug pattern that emits a few extra log lines per shutdown can — over many sessions — fill `/tmp` with multi-gigabyte files. The bug report on a real machine showed a 4.5 GB `oh-my-opencode.log.1` from 46.6 million accumulated noise lines.

The issue also calls out a specific EPIPE-on-shutdown error as a contributor to the noise. That noise is *one* source of bloat among several (e.g. `unhandledRejection received during shutdown cleanup: {}` was the dominant pattern in real-world reproduction). Capping file size addresses the disk-pressure symptom regardless of which noise pattern is generating volume on a given machine, and lets specific message-suppression land separately if and when they're needed.

## Approach

Mirror the size-based rotation pattern already used in `src/openclaw/reply-listener-log.ts` (rotate when over a size threshold), but with two backup slots instead of one to give a usable history window when debugging.

- Constant `MAX_LOG_FILE_SIZE_BYTES` = 50 MB. Caps disk usage while still preserving a session's diagnostic context.
- Rotation: `oh-my-opencode.log` → `oh-my-opencode.log.1` → `oh-my-opencode.log.2` (oldest dropped). Worst-case on-disk footprint is ~150 MB.
- The size check runs inside `flush()` — the existing batched-write path — not on every `log()` call. Cost is amortized over `BUFFER_SIZE_LIMIT` (50 entries) or the 500 ms flush timer. Order is **append-then-rotate**: each batch is appended to the primary first, then the size threshold is checked. The in-flight batch therefore lands in the rotated file rather than the fresh primary, which guarantees the post-flush primary is bounded to ≤ cap.
- All filesystem ops stay wrapped in try/catch (consistent with the existing logger's defensive style — logging must never throw). A failed rotation leaves the existing on-disk state intact rather than crashing the agent.

No config knobs in this iteration. The issue proposes `logs.max_size_mb` / `logs.max_files`, but adding config schema is more surface area than the bug warrants — the constants are reasonable defaults and can be promoted later if a user needs to tune them. YAGNI.

## Components touched

| File | Change |
|------|--------|
| `src/shared/logger.ts` | Add size-based rotation in `flush()`; expose `_setLoggerForTesting` / `_resetLoggerForTesting` / `_flushForTesting` seams |
| `src/shared/logger.test.ts` | New tests: rotation triggers at threshold, keeps N backups, never throws |
| `AGENTS.md`, `src/shared/AGENTS.md` | Note rotation policy so the auto-generated codebase map points readers at `.1`/`.2` siblings |

## Testing strategy

TDD per superpowers conventions:

- Stub `MAX_LOG_FILE_SIZE_BYTES` and `MAX_LOG_FILE_BACKUPS` via the `_setLoggerForTesting` seam, then exercise: (a) under threshold → no rotation, (b) over threshold → primary file moved to `.1`, (c) repeated rotation → `.1` → `.2`, `.2` dropped, (d) rotation failure (e.g. EROFS) does not throw.
- Tests live in `src/shared/logger.test.ts`. The file uses a `mock.module(...)` substring marker so `script/run-ci-tests.ts` routes it to its own bun process — the logger module's singleton state otherwise gets contaminated by sibling tests that mock `./shared` (the barrel that re-exports `./logger`).

## Out of scope

- Suppressing specific shutdown-noise messages (e.g. EPIPE, `unhandledRejection received during shutdown cleanup`). The rotation cap bounds the disk impact regardless. If a particular message pattern proves chronically noisy, suppressing it is a follow-up that can stand on its own merits.
- Config-driven `logs.max_size_mb` etc. — defer until requested.
- Time-based rotation. The growth driver is volume per session, not session age.
- Compressing rotated logs. Diminishing return for ~150 MB worst-case.
- Reworking `reply-listener-log.ts` to share the rotation helper. Different file, different threshold (1 MB vs 50 MB), different backup count — extracting now would be premature DRY.
