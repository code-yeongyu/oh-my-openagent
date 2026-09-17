# QA Evidence: fix(opencode) session title becomes timestamp (#5544)

## WHAT WAS TESTED

OpenCode names a session after the task via `SessionPrompt.ensureTitle`
(packages/opencode/src/session/prompt.ts). It runs only when the session title is
still the default placeholder AND history holds EXACTLY ONE "real" user message,
where real excludes only messages whose parts are all `synthetic: true`. Two
oh-my-openagent behaviors defeat this:

1. `cli/run/session-resolver.ts` created every `omo run` session pre-titled
   `"oh-my-openagent run"`, so OpenCode's isDefaultTitle gate skipped titling
   forever (deterministic for all CLI/automation sessions).
2. Internal control dispatches into main sessions sent text parts WITHOUT
   `synthetic: true` (marker text alone, which OpenCode core does not know):
   - background-agent parent wakes (`parent-wake-prompt-dispatch.ts`)
   - monitor output injection (`output-injector.ts`)
   - team live delivery (`member-session-routing.ts` `buildMemberPromptBody`,
     previously plain unmarked text)

Commands (failing-first):
- `bun test packages/omo-opencode/src/cli/run/session-resolver.test.ts
  packages/omo-opencode/src/features/background-agent/parent-wake-prompt-dispatch.test.ts
  packages/omo-opencode/src/features/team-mode/member-session-routing.test.ts
  packages/omo-opencode/src/features/monitor/injection-route.test.ts`

## WHAT WAS OBSERVED

- RED before the fix (`tests-red.txt`): 10 pass / 8 fail. All 8 failures are the
  new assertions: create body still carried `title`, and dispatched wake /
  monitor / member parts had `synthetic === undefined`.
- GREEN after the fix (`tests-green-scoped.txt`): 18 pass / 0 fail.
- Scoped regression suites (`tests-green-*.txt`): cli-run 197 pass,
  background-agent 745 pass, monitor 96 pass, team-mode 288 pass / 1 skip,
  0 failures anywhere.
- Typecheck (`typecheck-root.txt`, `typecheck-omo-opencode.txt`): tsgo --noEmit
  exit 0 at repo root and for packages/omo-opencode.

Fix shape:
- CLI sessions are now created untitled; OpenCode seeds its default placeholder
  and ensureTitle renames it from the first real user message (the task).
- The three internal dispatch routes now build parts with
  `createInternalAgentContinuationTextPart` (`synthetic: true` + unchanged
  `<!-- OMO_INTERNAL_INITIATOR -->` marker), matching the convention already used
  by runtime-fallback retries, todo continuation, and compaction recovery.

## WHY IT IS ENOUGH

- The assertions pin the exact contract OpenCode core consumes
  (`part.synthetic === true` is what excludes a user message from ensureTitle's
  real-user count; absence of a custom title is what lets isDefaultTitle pass).
- Delivery is unaffected: OpenCode's `MessageV2.toModelMessagesEffect` includes
  non-empty non-ignored text parts regardless of the synthetic flag, and every
  OMO-side detector keys on the marker TEXT, which is byte-identical
  (`createInternalAgentContinuationTextPart` spreads
  `createInternalAgentTextPart`). The 1040+ scoped tests across the four touched
  subsystems (including all parent-wake race/dedupe suites and monitor delivery
  suites) exercise those paths and stay green.
- Child-session dispatches (delegate-task sync, background task launch/resume)
  were deliberately left marker-only: their sessions carry parentID, so
  ensureTitle skips them anyway.

## WHAT WAS OMITTED

- No live `opencode run` harness drive in this environment (network-restricted;
  no provider credentials): the title LLM call itself was not exercised end to
  end. The unit pins target the precise gates OpenCode applies around that call.
- Raw test logs contain no secrets; paths are local workspace paths.
