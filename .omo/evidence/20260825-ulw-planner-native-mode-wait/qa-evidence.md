# QA Evidence: ulw planner native plan mode leaves parent waiting (#5850)

Date: 2026-08-25 | Branch: issue/5850-ulw-planner-native-mode-wait | Base: c7094b8ac

## WHAT WAS TESTED

1. Failing-first unit test `source-detector.test.ts` (co-located, new): pins that OpenCode's
   native built-in `plan` agent name is NOT classified as an OMO planner while remaining
   non-OMO (`isNonOmoAgent("plan") === true`), and that custom planner-named agents
   ("prometheus", "deep-planner", "Plan Agent") keep planner classification.
2. New ToolGuard hook `plan-exit-subagent-guard` co-located tests: denies native
   `plan_exit`/`plan_enter` inside delegated subagent sessions with parent-return guidance;
   passes through in primary sessions and for unrelated tools.
3. Regression suites: keyword-detector (92 tests incl. hyperplan + agent-specific ultrawork
   skip cases), create-tool-guard-hooks composer test, config schema test.
4. Typecheck: `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`.

Commands:
- `bun test packages/omo-opencode/src/hooks/plan-exit-subagent-guard/ packages/omo-opencode/src/hooks/keyword-detector/ packages/omo-opencode/src/plugin/hooks/create-tool-guard-hooks.test.ts packages/omo-opencode/src/config/schema.test.ts`
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`

## WHAT WAS OBSERVED

- Red first: `isPlannerAgent("plan")` returned true before the fix; test failed with
  `Expected: false / Received: true`. Two existing keyword-detector tests also caught the
  first over-broad fix attempt (bare-word "plan" removal broke "Plan Agent" filtering),
  which drove the final exact-name exclusion design.
- After fix: 178 pass / 0 fail across the 11 scoped files (test-output.txt).
- tsgo clean, exit 0 (tsgo-output.txt).

## WHY IT IS ENOUGH

- The routing contradiction named in the issue and maintainer triage (same "plan" name
  classified as both planner and non-OMO) is now pinned by machine-consumed classifier
  assertions, not prose.
- The lifecycle hang is cut at the seam that matters: a delegated subagent can no longer
  execute `plan_exit`/`plan_enter`, so neither the "switch to build" hijack (Yes) nor the
  RejectedError strand-the-parent path (No/Esc) can occur. Primary-session native plan mode
  is untouched (pass-through test).
- Rerouting prompts to prometheus was evaluated and rejected with evidence: the delegate-task
  preflight hard-blocks coordinator agents (`subagent-request-preflight.ts`,
  COORDINATOR_AGENT_NAMES = ["prometheus"], issue #4027), so prompt rerouting would break
  planning delegation entirely. Prompt files were reverted to base.

## WHAT WAS OMITTED

- Live OpenCode TUI drive of a delegated native-plan subagent answering the plan_exit prompt:
  requires a real model backend and interactive TUI, unavailable in this network-restricted
  environment within the task timebox. The denied-tool behavior is covered at the hook seam
  (same tool.execute.before contract prometheus-md-only uses for blocking) plus composer
  registration via the typed ToolGuardHooks return object.
- Full root `bun test` suite and submodule-including gates were not run (known to hang on
  git submodule materialization in this environment); scoped suites cover every touched file.
- No secrets or env dumps in captured artifacts.
