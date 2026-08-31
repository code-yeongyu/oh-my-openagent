# Evidence: issue #6877 - restricted subagent permission/tools overrides silently ignored

Date: 2026-08-24
Branch: issue/6877-restricted-subagent-overrides (base: dev @8833800ae)

## WHAT WAS TESTED

1. Failing-first proof of the regression tests against the unpatched base:
   - `git stash push` of all 9 non-test source files, keeping
     `packages/omo-opencode/src/shared/agent-tool-restrictions.test.ts` and the
     updated `packages/omo-opencode/src/tools/delegate-task/tools.test.ts`.
   - `bun test packages/omo-opencode/src/shared/agent-tool-restrictions.test.ts`
   - `bun test packages/omo-opencode/src/tools/delegate-task/tools.test.ts -t "#6877"`
   - `git stash pop` to restore the fix.
2. Scoped unit suites after the fix:
   - `bun test packages/omo-opencode/src/shared/agent-tool-restrictions.test.ts`
   - `bun test packages/omo-opencode/src/tools/delegate-task/tools.test.ts`
   - `bun test packages/omo-opencode/src/agents/tool-restrictions.test.ts`
   - `bun test packages/omo-opencode/src/features/background-agent packages/omo-opencode/src/tools/call-omo-agent`
3. Repo typecheck gate: `bun run typecheck` (tsgo --noEmit + typecheck:script + typecheck:packages).

## WHAT WAS OBSERVED

- Failing-first (fix stashed): agent-tool-restrictions.test.ts -> 0 pass / 1 fail / 1 error
  (`buildAgentSpawnTools` does not exist on base); delegate-task #6877 filter -> 1 fail
  (`result.session_read` undefined on base because allows were dropped).
- After fix: agent-tool-restrictions.test.ts 9 pass / 0 fail; delegate-task tools.test.ts
  136 pass / 0 fail; agents/tool-restrictions.test.ts 14 pass / 0 fail;
  background-agent + call-omo-agent 812 pass / 0 fail (71 files).
- `bun run typecheck`: all three stages completed with no errors.
- One crash-recovery defect was found and fixed before verification: the e2e test
  "categories.<name>.tools propagates to session tools end-to-end" asserted
  `storedTools.read === true` without `read: true` in its fixture; fixture corrected.

## WHY IT IS ENOUGH

- The failing-first run proves both new test files detect the bug on the unpatched base
  (missing export + dropped allow), so they are genuine regression guards, not tautologies.
- The merge-order contract is pinned at three layers: the pure builder
  (`buildAgentSpawnTools`: defaults < fixed restrictions < explicit user entries, with
  task/question harness pins intact), the delegate-task sync path end-to-end through
  `sendSyncPrompt`, and the call-omo-agent path via override extraction in tools.ts.
- The 812-test background-agent + call-omo-agent sweep covers every consumer of the
  changed launch-tools construction (manager launch, resume, fallback retry) for
  regressions in the deny baseline.
- Full repo typecheck proves no consumer of `LaunchInput.userPermission` (widened to
  `AgentSpawnUserPermission`) was broken by the type change.

## WHAT WAS OMITTED

- Live OpenCode harness QA (opencode-qa skill: TUI smoke, SSE hook probe, DB isolation)
  was not driven for this change; coverage is unit + typecheck level per the task's
  expected outcome. Residual risk: runtime behavior of session.prompt `tools` maps is
  covered indirectly by existing integration tests only.
- No secrets, tokens, env dumps, or auth headers are present in this evidence; test
  output contained none.
