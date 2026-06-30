# Ralph prompt-gate QA evidence

## Branch and PR

- Base branch: `dev`
- Local branch: `dogfood/latest-dev-ralph-fix`
- Existing PR: <https://github.com/code-yeongyu/oh-my-openagent/pull/5750>

## What changed from the previous PR revision

The updated branch keeps the original Ralph ownership fix and adds the follow-up protections requested by automated review:

- avoids disk-backed loop-state reads for streamed activity unless the activity has a relevant runtime-retry or Ralph-owned prompt-reservation marker;
- avoids releasing verification-session prompt holds owned by `model-suggestion-retry` or other non-Ralph routes;
- clears stale Ralph runtime-retry markers without releasing another route's prompt reservation;
- throttles repeated prompt-gate mismatched-release warnings and bounds the throttle cache.

## Automated gates

- `bun run typecheck`
  - Result: pass.

- `bun test packages/omo-opencode/src/hooks/ralph-loop packages/utils/src/prompt-async-gate.test.ts --bail`
  - Result: `210 pass`, `0 fail`.

- `bun test packages/omo-opencode/src/hooks/shared/prompt-async-gate.test.ts packages/omo-opencode/src/hooks/shared/prompt-async-gate-semantic-dedupe-edge.test.ts packages/utils/src/prompt-async-gate*.test.ts --bail`
  - Result: `95 pass`, `0 fail`.

- `bun run test:codex`
  - Result: pass; final Node test summary reported `440 pass`, `0 fail`.

- `bun run build`
  - Result: pass.

- `git diff --check`
  - Result: pass.

## Full root test suite

- `bun test`
  - Result: full-suite mode reported `10239 pass`, `2 skip`, `5 fail`.
  - Failing files:
    - `packages/omo-opencode/src/hooks/anthropic-context-window-limit-recovery/empty-content-recovery-sdk.test.ts`
    - `packages/omo-opencode/src/hooks/claude-code-hooks/handlers/session-event-handler-retry.test.ts`

The failing files are outside the changed Ralph/prompt-gate surface and passed when rerun in isolation:

- `bun test packages/omo-opencode/src/hooks/anthropic-context-window-limit-recovery/empty-content-recovery-sdk.test.ts`
  - Result: `7 pass`, `0 fail`.

- `bun test packages/omo-opencode/src/hooks/claude-code-hooks/handlers/session-event-handler-retry.test.ts`
  - Result: `3 pass`, `0 fail`.

## OpenCode harness QA

The repo-local `.agents/skills/opencode-qa` scripts were used.

- `bash scripts/lib/common.sh --self-check`
  - Result: pass.

- `bash scripts/sse-hook-probe.sh --self-test`
  - Result: pass; observed `server.connected` on the SSE `/event` stream.

- Isolated real-hook probe against `opencode serve` with the repo-local plugin loaded from `packages/omo-opencode/src/index.ts` and a fake OpenAI-compatible provider
  - Result: pass; observed `message.part.delta` on the SSE `/event` stream for session `ses_0e515b7dbffeqeewkVW1sTyr86`.
  - Why it matters: `message.part.delta` is the lifecycle event that reaches the changed Ralph `event` hook activity path.
  - Isolation proof: real OpenCode DB session count was unchanged (`3046 -> 3046`); the generated session lived only in the sandbox DB.
  - Evidence files: `.omo/evidence/20260630-ralph-prompt-gate-full-qa/real-hook-probe/`.

- `bash scripts/tui-smoke.sh --self-test`
  - Result: pass; TUI rendered under tmux, the test key sequence reached the composer, and the tmux session was torn down.
  - Isolation proof: real OpenCode DB session count was unchanged before and after the smoke.

- Isolated local-dist smoke using the built plugin at `dist/index.js` and `opencode agent list --print-logs --log-level DEBUG`
  - Result: pass, exit 0.
  - Isolation proof: real OpenCode DB session count was unchanged before and after the smoke.
  - The sandbox DB had zero sessions after the command.
  - No `promptAsync reservation release skipped for different source` lines appeared in the smoke stdout/stderr.

## Residual risk

The root suite still has unrelated full-suite/order-dependent failures in this checkout. The failing files pass in isolation and are outside the changed Ralph-loop and prompt-gate files, so this is recorded as pre-existing suite instability rather than a regression from this PR.
