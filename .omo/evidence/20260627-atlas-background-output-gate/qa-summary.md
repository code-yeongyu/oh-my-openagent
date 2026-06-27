# Atlas background_output completion gate QA

## Scope

Changed Atlas `tool.execute.after` handling so a tracked background task session no longer counts as task verification for plugin retrievals such as `background_output`. A tracked session remains available as the reuse session id, but the completion gate is suppressed only when the plan checkbox is checked or the in-session gate has already fired.

## Evidence

- RED: `red-background-output-gate.txt` captured the new focused regression failing before the production fix with `exit_code=1`.
- GREEN: `green-background-output-gate.txt` captured the same focused regression passing after the predicate fix with `exit_code=0`.
- Focused Atlas suite: `focused-atlas-tests.txt` passed 98 tests across 5 Atlas files with `exit_code=0`.
- Typecheck: `typecheck.txt` ran `bun run typecheck` successfully with `exit_code=0`.
- OpenCode hook QA: `opencode-hook-qa.txt` ran `opencode-qa` common self-check and `sse-hook-probe.sh --self-test`; the isolated SSE probe observed `server.connected`, and the real OpenCode DB session count stayed `5737 -> 5737`.
- Atlas hook behavior QA: `opencode-hook-behavior-qa.txt` imported the real Atlas `tool.execute.after` handler, drove `background_output` with `metadata.sessionId`, verified an unchecked tracked task session emits `COMPLETION GATE`, verified the same session's second retrieval is suppressed by `verifiedTaskKeys`, and removed the temp `.omo` state directory.
- Windows CI follow-up RED: `windows-ci-red-timeout.txt` captured PR #5653 failing in `test (windows-latest)` because the `pollAndBuildInjection` concurrent mailbox injection test hit Bun's default 5000 ms test timeout.
- Windows CI follow-up GREEN: `windows-mailbox-lock-timeout-fix.txt` captured the mailbox poll and lock suites passing after giving that filesystem-lock concurrency test a 15000 ms circuit breaker.
- Windows CI follow-up typecheck: `typecheck-packages-after-windows-fix.txt` captured `bun run typecheck:packages` passing after the test timeout fix.
- OpenCode follow-up QA: `opencode-common-self-check-after-windows-fix.txt` and `opencode-sse-self-test-after-windows-fix.txt` re-ran the opencode-qa common self-check and isolated SSE probe after the Windows timeout fix.

## Omitted

No secret-bearing logs, auth headers, launchd environments, or raw credentials were copied. The OpenCode QA used the skill's isolated sandbox helper for spawned OpenCode state.
