# QA Summary: fix-4420

## Scope

- PR #4421 is pure and scoped to two files:
  - `packages/omo-opencode/src/hooks/team-session-events/team-member-error-handler.ts`
  - `packages/omo-opencode/src/hooks/team-session-events/team-member-error-handler.test.ts`
- Contributor PR already targeted the stale session-error guard. Follow-up work completed guard coverage by moving the decision into the locked runtime-state transition and gating side effects on the same decision.

## RED -> GREEN

- RED: `red-guard-reverted-team-session-events.txt`
  - Command: `PATH="$HOME/.bun/bin:$PATH" bun test packages/omo-opencode/src/hooks/team-session-events`
  - Setup: guard temporarily reverted to the old name-only errored transition.
  - Observed: the new regression failed because worker session `replacement-session` was clobbered to status `errored`.
- GREEN: `green-team-session-events.txt`
  - Command: same focused suite with the guard restored.
  - Observed: `40 pass`, including `#given fallback retry replaces a member sessionId #when stale session.error settles #then replacement stays running without a member_error announcement`.

## Type And Static Checks

- `typecheck-after-install.txt`: `bun run typecheck` passed after refreshing dependencies post-merge.
- `typecheck-omo-opencode.txt`: targeted `tsgo --noEmit -p packages/omo-opencode/tsconfig.json` passed.
- `no-excuse-typescript.txt`: TypeScript no-excuse scan passed for both changed files.
- `loc-check.txt`: handler is 222 pure LOC; existing test file is 387 pure LOC. The test file-size smell is carried because the required fork takeover is a mechanical two-file bug fix and splitting the existing suite would be unrelated architecture churn.

## OpenCode QA

- `opencode-qa-common-self-check.txt`: opencode-qa harness dependencies and isolated XDG sandbox behavior passed.
- `opencode-qa-sse-self-test.txt`: isolated OpenCode SSE `/event` surface opened and delivered `server.connected`.
- `session-error-sse-proof.txt`: isolated OpenCode server loaded the local plugin, drove `prompt_async` against a local provider returning a non-retryable context error, observed `session.error` on `/event`, and proved the real OpenCode DB session count stayed unchanged (`21744` before and after).
- `session-error-event.json`: captured first matching `session.error` event with `ContextOverflowError` from the local failing provider.
- Live two-member provider-quota race reproduction was intentionally omitted: it would require real provider quota exhaustion and timing a concurrent fallback retry. The deterministic test is the faithful channel because it controls the exact `session.error` interleaving: the fake OpenCode status call swaps the member to a replacement running session before the error handler resumes, then asserts state, pending-delivery reservation, and lead inbox side effects.

## Cleanup

- opencode-qa scripts self-cleaned their isolated sandbox.
- Test temp directories are registered in `afterEach` and removed with `rm(..., { recursive: true, force: true })`.
