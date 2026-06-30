# Windows Async Test Timeouts Evidence

## Scope

Release-blocking Windows CI run `28348775396` timed out in four async tests:

- `Atlas final verification approval gate > pauses for escalation when a final-wave reviewer rejects`
- `createTeamIdleWakeHint leader delivery > #given repeated member completions to an idle leader #when each cycle idles after delivery #then every completion wakes the leader`
- `createTeamIdleWakeHint > acks pending messages on idle, moves files to processed, and clears pending ids`
- `createTeamMemberErrorHandler > injects a member_error announcement into the lead inbox when a non-lead member errors`

## Sanitization

No raw secrets, auth headers, cookies, environment dumps, or private credentials are included. The committed logs are command output and CI status artifacts only. Fake test fixture values in `green-root-bun-test.log` were redacted from `xoxp-scope-token` to `[fake-test-token-redacted]`, and blank fixture authorization markers were redacted to `[redacted-empty-fixture]`, so the evidence tree does not contain token-shaped strings.

## RED / Source Failure Understanding

Scenario: inspect the failed Windows CI run logs for run `28348775396`.

Invocation: `gh run view 28348775396 --log-failed` filtered to the four failing tests.

Observable: Windows `test (windows-latest)` was the only failed lane; the four tests exceeded Bun's 5000ms timeout. The team idle/member error failures also showed cleanup/file-system fallout such as missing inbox files after the timeout window, consistent with the test harness racing teardown after async work failed to finish on Windows.

Artifact: `.omo/evidence/20260629-windows-async-test-timeouts/red-windows-ci-run-28348775396-filtered.log`

Scenario: baseline local focused test run after dependency bootstrap.

Invocation: `bun test packages/omo-opencode/src/hooks/atlas/final-wave-approval-gate.test.ts packages/omo-opencode/src/hooks/team-session-events/team-idle-wake-hint-leader.test.ts packages/omo-opencode/src/hooks/team-session-events/team-idle-wake-hint.test.ts packages/omo-opencode/src/hooks/team-session-events/team-member-error-handler.test.ts --timeout 5000`

Observable: 34 pass, 0 fail on macOS. This confirms the failure is Windows/timing-specific and not locally reproducible on macOS.

Artifact: `.omo/evidence/20260629-windows-async-test-timeouts/red-focused-local-base-after-install.log`

## GREEN / Focused Tests

Scenario: exact focused failure set after the fix, with the same 5000ms circuit breaker.

Invocation: `bun test packages/omo-opencode/src/hooks/atlas/final-wave-approval-gate.test.ts packages/omo-opencode/src/hooks/team-session-events/team-idle-wake-hint-leader.test.ts packages/omo-opencode/src/hooks/team-session-events/team-idle-wake-hint.test.ts packages/omo-opencode/src/hooks/team-session-events/team-member-error-handler.test.ts --timeout 5000`

Observable: 34 pass, 0 fail. The formerly failing cases completed in milliseconds locally after deterministic test fixtures:

- Atlas reject case: 12.85ms
- Leader wake loop: 12.90ms
- Idle ack case: 27.25ms
- Member error announcement: 3.42ms

Artifact: `.omo/evidence/20260629-windows-async-test-timeouts/green-focused-local-after-fix.log`

Scenario: broader touched-area regression suite.

Invocation: `bun test packages/omo-opencode/src/hooks/atlas/*.test.ts packages/omo-opencode/src/hooks/team-session-events/*.test.ts --timeout 5000`

Observable: 258 pass, 0 fail, 611 assertions across 33 files.

Artifact: `.omo/evidence/20260629-windows-async-test-timeouts/green-broader-atlas-team-session-events.log`

## Repository Gates

Scenario: TypeScript gate after adding the wake-hint test timing option.

Invocation: `bun run typecheck`

Observable: root, script, package, and adapter TypeScript checks completed successfully.

Artifact: `.omo/evidence/20260629-windows-async-test-timeouts/green-typecheck.log`

Scenario: full repository Bun test gate.

Invocation: `bun test`

Observable: 10290 pass, 2 skip, 0 fail, 25003 assertions across 1266 files.

Artifact: `.omo/evidence/20260629-windows-async-test-timeouts/green-root-bun-test.log`

Scenario: build gate.

Invocation: `bun run build`

Observable: Git Bash MCP, LSP MCP/daemon, Codex plugin, OpenCode bundle, CLI bundles, Codex installer, and schema generation all completed successfully.

Artifact: `.omo/evidence/20260629-windows-async-test-timeouts/green-build.log`

## OpenCode QA

Scenario: OpenCode QA helper preflight.

Invocation: `bash /Users/yeongyu/local-workspaces/omo/.agents/skills/opencode-qa/scripts/lib/common.sh --self-check`

Observable: required dependencies present; isolated XDG sandbox self-check passed.

Artifact: `.omo/evidence/20260629-windows-async-test-timeouts/opencode-qa-common-self-check.log`

Scenario: isolated OpenCode SSE event stream probe.

Invocation: `bash /Users/yeongyu/local-workspaces/omo/.agents/skills/opencode-qa/scripts/sse-hook-probe.sh --self-test`

Observable: `/event` opened and delivered `server.connected`.

Artifact: `.omo/evidence/20260629-windows-async-test-timeouts/opencode-qa-sse-hook-probe-self-test.log`

Scenario: explicit live DB isolation proof around the isolated SSE probe.

Invocation: capture `sqlite3 "$(opencode db path)" 'SELECT count(*) FROM session;'` before and after `sse-hook-probe.sh --self-test`.

Observable: real OpenCode DB session count stayed `5737 -> 5737`.

Artifact: `.omo/evidence/20260629-windows-async-test-timeouts/opencode-qa-sse-isolation-proof.log`

## Windows Proof Status

Windows was not run locally.

Scenario: PR #5740 CI rerun for branch `code-yeongyu/fix-windows-async-test-timeouts`.

Invocation: `gh pr checks 5740 --json name,state,workflow,startedAt,completedAt,link`

Observable: CI run `28349704505` reported `test (windows-latest)` as `SUCCESS` with job link `https://github.com/code-yeongyu/oh-my-openagent/actions/runs/28349704505/job/83979971583`. The same snapshot also shows Windows typecheck and Windows codex compatibility as `SUCCESS`.

Artifacts:

- `.omo/evidence/20260629-windows-async-test-timeouts/pr-5740-ci-initial-checks.json`
- `.omo/evidence/20260629-windows-async-test-timeouts/pr-5740-ci-watch.log`
- `.omo/evidence/20260629-windows-async-test-timeouts/pr-5740-ci-current-checks.json`
