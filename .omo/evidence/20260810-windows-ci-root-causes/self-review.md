# Self-review against the success criteria

Tier: HEAVY. No `ulw-plan` plan file exists for this run, so the verification gate records a
self-review here instead of summoning a plan-gated reviewer; Momus is excluded by instruction.

## Criterion 1 - clean Windows dependency/setup path

- RED: `dev` run 31365002433 failed `bun install --frozen-lockfile` with `TAR_ENTRY_ERROR` /
  `ENOTEMPTY` under `packages/omo-codex/plugin/node_modules` and `npm --prefix packages/omo-codex/plugin ci failed`,
  then skipped `Run vendored lsp-daemon tests` and `Run tests` (`red-install.md`).
- Root cause: `script/build.ts` scheduled `codex-plugin` and `senpi-plugin` as concurrent graph nodes
  while both provision the same `packages/omo-codex/plugin` npm tree (`stage-agent-toolkit.mjs`
  runs `npm ci` there when the lock or compiler is missing).
- Fix: `senpi-plugin` now declares `codex-plugin` as a dependency, so one owner provisions that tree.
- Proof: failing-first AST invariant test captured RED (`red-build-graph.md`), GREEN after the fix
  (`green-build-graph.md`), and the real build shows `build:codex-plugin` completing before
  `build:senpi-plugin` with exit 0 (`green-build-graph-ordering.md`).
- Remaining: the PR's own `windows-latest` job is the final artifact (criterion 3).

## Criterion 2 - renewable admission lease is scheduler-safe

- RED: `acquireSessionAdmissionLease` "holder that keeps renewing" failed on Windows at 437 ms
  (`red-admission-lease.md`).
- Root cause: the stale window (120 ms) was shorter than the waiter's 300 ms bounded wait, so a
  delayed renewal tick let a waiter reclaim a live holder. The sibling "racing waiters" case had the
  same defect at 150 ms vs 1500 ms and failed on the newest `dev` run.
- Fix: both cases now run on virtual time (`jest.useFakeTimers`), so ownership is decided by the
  takeover CAS. Real renewal, real `withTaskRecordLock`, real atomic write and every ownership
  assertion are unchanged; nothing is mocked, skipped, retried or weakened.
- Proof: mutation probes force each regression and both assertions fail as required
  (`red-admission-lease-mutation.md`, `red-green-windows-remaining.md`), then pass after revert.
  Full file: 4 pass / 0 fail; whole `senpi-task/src/lifecycle`: 103 pass / 0 fail.

## Criterion 3 - complete cross-platform regression gate

- Not yet satisfied. Local gates are green: LSP diagnostics 0 errors on all five changed files,
  focused suites green, CI-pinned `bun install --frozen-lockfile` + `bun run typecheck` exit 0
  (`typecheck.md`), CI-pinned `bun run build` exit 0. The full root `bun test` gate and the PR's
  required checks are the outstanding evidence.
- Newly discovered baseline failures were taken in scope, not deferred: the two memory failures on
  `dev` run 31375080844 are fixed in this branch (`red-green-windows-remaining.md`).

## Criterion 4 - durable no-bypass guidance

- `AGENTS.md` gained an ANTI-PATTERNS entry plus three PR MERGE POLICY rules. QA-by-read confirmed
  all eight required behaviors are stated unambiguously: no `--admin`, no required-check override,
  red-on-base is a defect, inspect the latest `dev` run, reproduce on the matching platform and
  toolchain, root-fix in this PR or a separate atomic PR, rebase and rerun with recorded evidence,
  and "reducing the failure count is not a green result" (`agents-policy-qa.md`).
- Prose has no machine consumer, so no sentence-pinning test was added, per the test-discipline rule.

## Scope discipline

PR #6708's `rm -rf` before `npm ci` stayed untouched: it landed on `dev` with its own evidence and
addresses npm's failure to clear a locked tree on Windows, which is a different failure mode from the
concurrency this PR removes. Reverting it would be unrelated scope.

## Residual risk

Windows behavior cannot be executed on this workstation, so the mirror `file://` URL and the two
retrying unlinks are proven locally plus by matching the already-passing `memory-core` mirror test;
the PR's `test (windows-latest)` job is the deciding evidence.
