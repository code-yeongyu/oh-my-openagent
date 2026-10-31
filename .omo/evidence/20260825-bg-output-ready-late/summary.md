# QA Evidence: #4169 background output ready arrives too late

Date: 2026-08-25 | Branch: `issue/4169-bg-output-ready-late` | Base: c7094b8ac

## WHAT WAS TESTED

Surface: `ParentWakeFlushRunner.flushPendingParentWake()` active-session branch
(`packages/omo-opencode/src/features/background-agent/parent-wake-flush-runner.ts`).

Command: `bun test packages/omo-opencode/src/features/background-agent/`
Command: `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`

Behavior proven: when a background task completes while the parent session is
mid-turn (status busy), the pending parent wake is admitted as a noReply
promptAsync deposit so the live turn consumes it on its next step, instead of
being pure-deferred until the turn ended (the reported token waste).

## WHAT WAS OBSERVED

- RED (before fix), new regression test
  `parent-wake-midturn-admit.test.ts`: partial-completion wake during busy
  parent produced 0 promptAsync calls (expected 1 noReply); reply-required wake
  likewise 0 calls. Failure-wake deferral control passed.
  Key output: `Expected length: 1 / Received length: 0` at
  parent-wake-midturn-admit.test.ts (see red-run.txt).
- GREEN (after fix): full background-agent suite 746 pass / 0 fail across 60
  files, including updated old-contract tests in
  `parent-wake-active-turn-event.test.ts` which previously pinned the buggy
  defer-always behavior (0 prompts while busy). New contract: exactly one
  coalesced noReply admission; reply obligation retained; failure wakes still
  deferred until safe.
- Typecheck: tsgo clean, no output.

## WHY IT IS ENOUGH

The changed branch is fully covered by co-located bun tests exercising the real
flush pipeline with a stubbed SDK client (promptAsync capture), covering:
partial completion mid-turn, reply-required completion mid-turn, failure wake
mid-turn, duplicate completions coalescing, aged-wake force dispatch
(pre-existing `parent-wake-active-defer-ceiling.test.ts` still green), and
admitted-wake consumption drop paths. The dispatch route is the existing
gated `sendParentWakePrompt` -> `dispatchInternalPrompt` path; no new prompt
route was introduced. Remaining risk: live OpenCode timing differences are not
covered by unit tests; mitigated by reusing the exact admission mechanics
already shipped for the fresh-activity and user-message-in-progress paths.

## WHAT WAS OMITTED

No secrets, tokens, or env dumps appear in captured outputs. Live opencode
TUI/SSE driving was omitted: the change is confined to the background-agent
wake flush decision logic and is covered by the hermetic suite above;
no config schema, tool surface, or hook registration changed.
