# PR #6451 review-fix verification (macOS)

## What was tested

Review fixes for the four blockers and five high findings from the PR #6451 review
(https://github.com/code-yeongyu/oh-my-openagent/pull/6451#pullrequestreview-4807027594):
durable liveness acknowledgement via session-JSONL marker observation, lead-ownership fencing of
liveness replay, serialized conditional task-record patching, delivery-failure receipts with bounded
retry, win32 path semantics in the QA shim resolver, ordered crash-kill evidence, owned-process
cleanup, and post-restart reserved-message recovery with an exactly-once replacement delivery.

Commands (all on this macOS host, from the worktree root):

- `bun test` full root suite, four consecutive runs
- `bun test packages/omo-senpi/scripts/qa/team-e2e-runtime.test.ts`
- `bun test packages/omo-senpi/src/components/task/ packages/omo-senpi/src/extension/`
- `bun test packages/senpi-task/src/`
- `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json` and `-p packages/senpi-task/tsconfig.json`
- `node packages/omo-senpi/scripts/qa/team-e2e.mjs --self-test`
- `HOME=<temp> TEAM_E2E_OUT_DIR=<retained> SENPI_BIN=<real senpi> node packages/omo-senpi/scripts/qa/team-e2e.mjs`
- `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check`
- `git diff --check`

## What was observed

- Live Team E2E against the real Senpi binary: **PASS 16/16** (`team-e2e-macos.json`), including the
  strengthened gates `crashKilledMemberAtHold` (ordered alive-member-terminal-parent-terminated),
  `crashReservationRestoredUnread`, `crashReservationNoResidue`,
  `crashReservedMessageDeliveredExactlyOnce`, and `crashLivenessAcknowledged`.
- `credentialIsolationClean: true`, `wholeDirUnchanged: true`, `leakedPids: 0` under an isolated HOME.
- Full root suite: 12,42x pass / 3 skip / **0 fail** on four consecutive runs after the fixes
  (one earlier run showed 2 unreproducible transient failures that never recurred and predate no
  identified regression; the only deterministic failure, the Codex installer version sync, is fixed
  by regenerating the installer dist).
- Focused suites and both package typechecks: all green.
- Plugin bundle check: current.

## Why it is enough

The live driver exercises the real launcher, real process kill/restart, real mailbox reservation
recovery, and real liveness replay against the durable store on POSIX. The deterministic unit and
orchestration tests cover the Windows-only branches through injected win32 seams. The Windows live
path itself still requires a fresh Windows run before the historical Windows evidence directory is
replaced (tracked in the PR body).

## What was omitted

Raw run logs stay in the retained local out-dir; only the machine-evaluable verdict JSON is
committed. No credentials, tokens, environment dumps, or absolute user paths are included.
