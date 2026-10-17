# QA Evidence — issue #3228: task(subagent_type) ignores agent model config

## WHAT WAS TESTED

- Command: `bun test packages/omo-opencode/src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver-agent-overrides.test.ts`
  - Surface: `resolveSubagentExecution()` (the `task(subagent_type=...)` seam in
    `packages/omo-opencode/src/tools/delegate-task/`), driven through the
    zauc-mocks harness (`mock.module` for logger + connected-providers-cache,
    fake `client.app.agents()`).
  - Behavior proven: an agent override stored under a config-key alias
    (`agents.scribe`) binds to the runtime agent (`technical-writer`) via its
    `prompt_append` file stem or `displayName`, and the configured model
    (`gitlab/duo-chat-sonnet-4-6`) reaches `categoryModel` instead of
    `undefined` (which previously let `parentModel` win in
    `background-task.ts launch()`).
- Command: `bun test packages/omo-opencode/src/tools/delegate-task/`
  - Full delegate-task suite regression sweep (491 tests / 42 files).
- Command: `bun test packages/omo-opencode/src/tools/call-omo-agent/`
  - Adjacent consumer of the same override-lookup pattern (69 tests).
- Command: `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`

## WHAT WAS OBSERVED

- Failing-first (before fix): `before-fix-red.txt` — 2 new regression tests
  fail with `categoryModel: undefined` exactly matching the issue report;
  priority/no-false-positive guards already pass pre-fix.
- After fix: `after-fix-green.txt` — 491 pass / 0 fail across delegate-task.
  `scoped-tests.txt` — 5 pass / 0 fail in the targeted file. call-omo-agent:
  69 pass / 0 fail. Typecheck: exit 0, no output (`typecheck.txt`).
- Isolation: unit-seam only; no opencode process spawned, no real
  `~/.local/share/opencode/opencode.db` touched; all state via injected mocks.

## WHY IT IS ENOUGH

The defect is a pure lookup gap inside `findAgentOverride()`
(`subagent-model-resolution.ts`): overrides keyed by an alias were invisible to
the resolver, so no model ever reached `BackgroundManager.launch()`. The new
tests exercise the exact resolution seam end-to-end through
`resolveSubagentExecution()` and pin both directions: alias-bound overrides now
resolve, exact-key precedence is preserved, and unbound agents keep prior
(parent-inheritance) behavior. Remaining risk: real-harness drive of
`task(subagent_type)` against a live provider was not executed here.

## WHAT WAS OMITTED

- Live `opencode run` harness QA: this environment is network-restricted and
  holds no provider credentials (the issue's repro needs GitLab duo-chat
  models), so a live delegation cannot execute a real model call. The unit seam
  above covers the changed code path directly. No secrets, tokens, or env dumps
  are included in this evidence directory.
- LSP daemon diagnostics unavailable in this worktree (known env limitation);
  `tsgo --noEmit` is the authoritative typecheck per repo convention.
