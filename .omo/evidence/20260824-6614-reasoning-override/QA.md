# QA Evidence - #6614 reasoning-effort override by stale provider options

Branch: `issue/6614-reasoning-provider-options` (base `dev` @ 8833800ae)

## WHAT WAS TESTED

- Failing-first regression tests (RED before fix, GREEN after):
  - `bun test packages/omo-opencode/src/shared/session-prompt-params-helpers.test.ts packages/omo-opencode/src/plugin/chat-params.test.ts`
    - New test "marks variant-routed reasoning so stale provider efforts cannot override it (#6614)": proves `applySessionPromptParams` records `reasoningViaVariant: true` when explicit user reasoning routes to a variant preset.
    - New test "clears stale provider reasoningEffort when session reasoning rides the variant channel (#6614)": drives the real `chat.params` handler (`createChatParamsHandler`) with stored variant-routed intent and a stale OpenCode default `options.reasoningEffort: "medium"`; asserts the effort is stripped and the requested `xhigh` variant survives to the outgoing message.
- Scoped regression suite over every consumer of the session-prompt-params path:
  - `bun test packages/omo-opencode/src/shared/session-prompt-params-state.test.ts ... session-prompt-params-helpers.test.ts ... agent-variant.test.ts ... plugin/chat-params.test.ts ... plugin/chat-message.test.ts ... plugin-interface.test.ts ... tools/delegate-task ... tools/call-omo-agent ... features/team-mode/member-session-routing.test.ts ... features/background-agent`
- Repo type gate: `bun run typecheck` (tsgo --noEmit root + script + all workspace packages).
- Environment prep: `bun install` (hit only the pre-existing/harmless `prepare` submodule fetch failure documented in the task brief; artifact `bun-install-6614.log`).

## WHAT WAS OBSERVED

- RED (before fix): exactly the two new #6614 tests failed; all 8 pre-existing tests in both files passed. Artifact: `red-run.txt` ("2 fail / 8 pass").
- GREEN (after fix): 13 pass / 0 fail across helpers + chat-params + state test files. Artifact: `green-run.txt`.
- Scoped suite: 1376 pass / 0 fail across 119 files. Artifact: `scoped-run.txt`.
- Typecheck: exit 0 for tsgo root project, script project, and all 30 package projects including `packages/omo-opencode`. Artifact: `typecheck.txt`.
- Root cause reproduced by the RED run: for a variant-capable model, `lowerReasoningForModel("xhigh")` returns `{ variant: "xhigh" }` with no `reasoningEffort`, so `applySessionPromptParams` (`session-prompt-params-helpers.ts`) stored no `options`, the merge in `chat-params.ts` was skipped entirely, and OpenCode's pre-populated default `reasoningEffort: "medium"` survived into the outgoing provider request alongside the correct `variant`.

## WHY IT IS ENOUGH

- The regression test exercises the real hook handler (`createChatParamsHandler`) end-to-end through input normalization, stored-param merge, capability lookup, compatibility resolution, and option write-back - not a mock of the merge.
- Both halves of the contract are pinned: intent recording at prompt time (helpers) and stale-effort enforcement at request time (chat.params), so neither side can regress silently.
- The scoped suite covers every caller that writes session prompt params (delegate-task sync sender, call-omo-agent sync executor, team-mode member routing, background-agent spawner/manager) plus the plugin-interface chat.params wiring, confirming no behavioral drift for non-variant sessions (stored `reasoningEffort` options still win the merge as before).
- Residual risk: live-provider serialization was not driven (see OMITTED); however the serialized shape is determined exactly by `output.options` / `message.variant`, which are asserted directly.

## WHAT WAS OMITTED

- No real OpenCode harness / live model call: observing the final serialized provider body requires a credentialed live provider; no API keys are provisioned in this environment. The unit-level integration test asserts the exact `output.options` and `message.variant` values that OpenCode serializes, which is the full observable surface of this change.
- LSP daemon diagnostics unavailable in this sandbox (daemon socket never came up); repo-authoritative `tsgo --noEmit` typecheck passed instead.
- No secrets, tokens, or env dumps appear in these artifacts; logs contain only test output paths and counts.
