# PR 6043 Final Gate Evidence

## Exact Source

- Reviewed source commit: `c3a3a8ad4b0fb879c5bb023146bb563a1e7e4499`.
- Integrated `origin/dev`: `7d664b96b020b85e89c26e1be2522c258f12fc4a`.
- The source change only extracts event/session model parsing from
  `event-handler.ts` into `event-model.ts`; runtime behavior is unchanged.
- Pure-line audit: `event-handler.ts` is 215 lines and `event-model.ts` is 46
  lines, both within the repository's 250-line ceiling.

## What Was Tested

1. The focused session-status ownership, abort wire-ordering, and event-handler
   regressions.
2. The complete runtime-fallback hook suite.
3. The plugin lifecycle, model-fallback, monitor, abort-boundary, and session
   state boundary suite.
4. The OpenCode adapter strict typecheck, scoped Biome lint, TypeScript
   no-excuse audit, diff integrity, and pure-line ceiling.
5. The OpenCode QA harness self-check in an isolated XDG/HOME sandbox.
6. The real OpenCode status-retry scenario, including ownership transfer before
   fallback dispatch and the original watchdog deadline.
7. The real OpenCode production-duration silent-provider scenario, including
   active-root restoration and a later genuine user cancellation.

## What Was Observed

- Focused tests: 14 pass, 0 fail, 54 expectations across 3 files.
- Complete runtime-fallback suite: 333 pass, 0 fail, 670 expectations across
  48 files.
- Lifecycle/model boundary suite: 40 pass, 0 fail, 87 expectations across 4
  files.
- Typecheck, Biome, no-excuse, harness self-check, integrity, and line-ceiling
  gates passed.
- Live status takeover: one real `session.status` retry, fallback one exactly
  once, no stale fallback two, and the real OpenCode database unchanged.
- Live silent-provider scenario: watchdog fallback succeeded, two active roots
  were tracked, deleting the newer root restored the older root, fallback did
  not re-arm the watchdog, the later user abort remained external, and the real
  database was unchanged.
- Both live harnesses terminated their fake provider, SSE watcher, OpenCode
  server, and temporary sandbox through cleanup traps.

## Why It Is Enough

The extraction moves the exact existing parsing branches without changing their
inputs or outputs. The focused and full suites prove model normalization,
preferred-model selection, fallback indexing, status retry ownership, and abort
correlation. The two first-party live OpenCode scenarios prove the same paths
through real lifecycle events and production timers, while the static and line
audits close the reviewer-reported file-size blocker.

## What Was Omitted

No raw environment dump, credential, auth header, private database path, local
session ID, or unsanitized server log is retained. Startup connection retries
and expected cleanup termination notices remain in the live command receipts;
they occur before the final parsed `PASS` lines and do not indicate a product
failure.
