# PR #6043 Final LOC Repair Evidence

Exact runtime commit: `783ee580b514256079be9ff69324247e6947c4e3`.

This final repair splits two touched runtime-fallback modules that exceeded the
strict 250 pure-LOC ceiling. Reserved prompt retries now live in
`reserved-retry-dispatch.ts`; watchdog cancellation and disposal now live in
`first-prompt-watchdog-state.ts`. The extraction is behavior-preserving.

Acceptance requires:

- all touched production TypeScript files at or below 250 pure LOC;
- the full runtime-fallback suite, repository typecheck, scoped Biome lint,
  no-excuse scan, and diff check passing;
- isolated real OpenCode HTTP/SSE QA proving fallback, no fallback re-arm,
  later external user abort, multi-root restoration, unchanged real DB count,
  and process/sandbox cleanup;
- the live harness source hash matching the committed runtime source before
  and after execution.

## Observed

- `runtime-fallback-suite.txt`: 372 tests passed with 776 expectations.
- `typecheck.txt`: repository `bun run typecheck` passed.
- `biome.txt`: Biome 2.4.16 checked all four refactor files with no findings.
- `no-excuse.txt`: no violations in the four refactor files.
- `static-integrity.txt`: pure LOC is 245, 37, 247, and 50; diff check passed;
  real OpenCode DB count was 5,751 before the live run.
- `live-watchdog-qa.txt`: isolated real OpenCode HTTP/SSE QA passed with one
  fallback, no fallback-owned re-arm, a later external user abort, two active
  roots, deletion restoring the older root, and an unchanged real DB.
- `live-committed-source.txt`: source hashes were identical before and after
  the live run at exact runtime commit
  `783ee580b514256079be9ff69324247e6947c4e3`.

## Why This Is Enough

The extraction changes module ownership only. Existing unit coverage exercises
reserved dispatch retries, watchdog cancellation, disposal, generation races,
and fallback ownership. The live harness drives the real OpenCode hook and
event surfaces in an isolated sandbox, covering the user-visible behavior and
the concurrency boundaries that motivated the preceding repairs.

## Omitted

No secret-bearing environment dumps, authorization headers, or raw private
configuration are included. Temporary server roots and processes are removed
by the harness cleanup trap.
