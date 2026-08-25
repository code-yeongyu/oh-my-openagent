# Evidence - Issue #6831 DeepSeek V4 planner/executor role eligibility

Date: 2026-08-24 | Branch: issue/6831-deepseek-planner-executor | Base: dev @8833800ae

## WHAT WAS TESTED

Commands (run from repo root of the task worktree):

1. Failing-first probe: `git stash push` of the 4 source files only
   (agent-model-requirements.ts, model-family-detectors.ts,
   sisyphus-junior/agent.ts, agents/types.ts) keeping every test file, then
   `bun test packages/model-core/src/deepseek-planner-executor-chain-policy.test.ts
   packages/omo-opencode/src/agents/sisyphus-junior/deepseek.test.ts
   packages/model-core/src/model-requirements-agents.test.ts`, then `git stash pop`.
2. Scoped regression suite after implementation:
   `bun test packages/model-core/src/deepseek-planner-executor-chain-policy.test.ts
   packages/model-core/src/model-family-detectors.test.ts
   packages/model-core/src/model-requirements-agents.test.ts
   packages/omo-opencode/src/agents/sisyphus-agent-factory.test.ts
   packages/omo-opencode/src/plugin/sisyphus-runtime-prompt-reconciler.test.ts
   packages/omo-opencode/src/agents/sisyphus-junior/`
   (captured in scoped-tests.log)
3. Type gate: `bun run typecheck` at repo root (tsgo --noEmit root +
   typecheck:script + typecheck:packages over 30 package tsconfigs), plus
   per-package `bunx tsgo --noEmit` for packages/model-core and
   packages/omo-opencode (captured in typecheck.log).

Surfaces driven: model-core fallback-chain policy data (planner = sisyphus,
executor = sisyphus-junior eligibility), model-family detector, sisyphus
agent factory config routing (fallback case), sisyphus-junior prompt routing
and thinking suppression, runtime prompt reconciler contract.

## WHAT WAS OBSERVED

- Failing-first: with source stashed and tests kept, the suite went RED with
  exactly the new assertions failing:
  - "sisyphus places max-reasoning DeepSeek V4 Pro immediately after Kimi K3"
  - "sisyphus-junior places max-reasoning DeepSeek V4 Flash immediately after Kimi K3"
  - chain-length assertions in model-requirements-agents.test.ts (5 vs 6 rungs)
  After `git stash pop`, working tree restored intact.
- After implementation: 110 pass / 0 fail / 377 expect() across 7 files
  (scoped-tests.log). Includes the pre-existing #6966 pin that deepseek-v4-pro
  keeps the plain fallback prompt body identical to MiniMax's, and the full
  sisyphus-runtime-prompt-reconciler suite.
- New planner-side behavior: createSisyphusAgent("deepseek/deepseek-v4-pro")
  and ("deepseek/deepseek-v4-flash") now return reasoningEffort "high" and no
  `thinking` field; before this change they inherited the Claude branch with
  thinking {type:"enabled", budgetTokens:32000} injected into a non-Anthropic
  model.
- Type gate: root typecheck EXIT=0; model-core OK; omo-opencode OK
  (typecheck.log).

## WHY IT IS ENOUGH

The issue's implementable core on base dev @8833800ae is role eligibility:
which DeepSeek models may fill the planner role (sisyphus chain) vs the
executor role (sisyphus-junior chain). That policy is pure data plus two
config-routing seams, both now covered by co-located given/when/then tests
that were proven to fail on base and pass with the change:

- Chain membership + tier separation pinned by
  deepseek-planner-executor-chain-policy.test.ts (Pro = planner only,
  Flash = executor only).
- Family detection pinned by model-family-detectors.test.ts.
- Executor runtime shape (prompt source, no Claude thinking, permissions,
  task-system sentinels) pinned by sisyphus-junior/deepseek.test.ts.
- Planner runtime shape (plain fallback body preserved per #6966, effort high,
  no Anthropic thinking) pinned by the new block in
  sisyphus-agent-factory.test.ts; reconciler suite guards the shared family
  resolver.

Remaining regression risk is limited to live-provider behavior (whether a real
DeepSeek V4 endpoint accepts reasoningEffort high), which unit tests cannot
observe; the value stays inside the deepseek family caps (high|max) enforced
by model-settings-compatibility, so out-of-contract values are clamped at
runtime regardless.

## WHAT WAS OMITTED

- Live OpenCode harness QA (opencode-qa skill) was not run: this environment
  has no provider credentials for a real DeepSeek V4 session and the operator
  contract for this task scoped verification to scoped bun tests + typecheck.
  Recorded here explicitly rather than implied green.
- Full root `bun test` suite was not run; verification is scoped to the
  packages touched (model-core, omo-opencode agents + plugin reconciler),
  matching the change blast radius.
- No secrets, tokens, or env dumps are contained in this directory; logs hold
  only bun/tsgo output.
