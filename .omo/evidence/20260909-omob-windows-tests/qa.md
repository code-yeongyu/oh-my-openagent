# Omob Windows test portability QA

## Root cause and scope
PR #7991 intentionally resolves cache/install paths and installs a POSIX auto-update launcher only on supported hosts. Dev run https://github.com/code-yeongyu/oh-my-openagent/actions/runs/34302507008 failed 13 Windows shard-2 tests because their path expectations omitted Windows drive resolution and their executable fixtures assumed POSIX shebang/signal support.

Only test code changes: resolved default/feature path expectations; explicit Windows gates for five shell-backed launcher cases and the seven-case POSIX refresh integration suite. Parsing, host targeting, locks, tarball selection, version derivation, submodule ordering and runtime-prune coverage remain enabled on Windows. The prune child fixture now uses a subscribed stdin/stdout handshake and bounded exit cleanup instead of a 30-second lifetime that could expire during process enumeration.

Production builder, launcher and prune behavior are unchanged. Existing docs already distinguish Windows bare-binary installs from macOS/Linux POSIX launchers, so no user documentation or adapter bundle regeneration is needed.

## Pre-commit observations
- `bun install --frozen-lockfile --ignore-scripts`: exit 0, 595 packages installed; lockfile unchanged.
- `bun run typecheck:script`: exit 0, no compiler diagnostics, including all four omob test files.
- Language-server diagnostics were requested for all four changed files. The existing language-server session reports unresolved Node built-ins/process globals despite the successful configured Bun-typed compiler check; these environment diagnostics were not suppressed or repaired by changing project configuration.
- Real builder CLI smoke via Bun/spawnSync: invalid flag rejected with exit 1 and the expected argument error before any cache/build side effect.
- `git diff --check`: exit 0.
- Bunshin round trip to mengmotaMac: Darwin arm64, Bun 1.4.0; the task's remote directory did not exist before use.

## Remote POSIX regression
Machine: mengmotaMac via bunshin, Darwin arm64, Bun 1.4.0. Fresh branch clone at b92d0f09f55067226d0de28577fca941c47227ac; dependencies installed with `bun install --frozen-lockfile --ignore-scripts`.

Command: `bun test script/build-omob.test.ts script/omob-launcher.test.ts script/omob-refresh.test.ts script/omob-runtime-prune.test.ts`

Observed in one execution: **42 pass, 0 fail, 125 expect() calls, 4 files, 103.03 seconds**, exit 0. This includes real git submodule transitions, ordinary repeated installation, same/changed SHA refresh, compile/network/lock failure handling, feature-checkout preservation, argv/exit/signal propagation and live-process enumeration. Exact captured test output is in `posix-test.log`.

Remote cleanup used `rm -rf /tmp/omob-win-fix-20260909` followed by `test ! -e /tmp/omob-win-fix-20260909`; exit 0, receipt: `REMOVED /tmp/omob-win-fix-20260909 on mengmotaMac`.

## CI gate
PR https://github.com/code-yeongyu/oh-my-openagent/pull/7996 targets dev and carries `ci:full-matrix`. Full-matrix CI is pending at this evidence commit; final run URL and per-job conclusions will be recorded in the PR's Verification section after completion. No local `bun test` was run. Windows cannot be proven by the local host; no simulated-platform result is presented as Windows execution.

## Coverage and omissions
This is test portability, not a shipped runtime change. The remote integration invokes the real parser, git/cache state, builder CLI and installed POSIX launcher; its existing compiler/package boundary fixture avoids building the full engine. Full repository build, adapter compatibility, typechecks and actual Windows execution are CI gates. No live model/harness session is needed for an unchanged adapter. No credentials, environment dumps, or secret-bearing logs are included.
