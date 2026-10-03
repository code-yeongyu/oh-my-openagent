QA Evidence - 20260824 - issue #7226 main-session fallback_models

## WHAT WAS TESTED

- Surface: the main/interactive session `chat.message` path in
  `packages/omo-opencode/src/plugin/chat-message.ts` plus the new
  `chat-message/main-session-fallback.ts` resolver, which reuses the delegated
  task resolution primitive (`resolveModelForDelegateTask` from
  `packages/delegate-core`) to promote a reachable per-agent
  `fallback_models` entry when the requested primary model is unavailable.
- Commands:
  - `bun test packages/omo-opencode/src/plugin/chat-message/main-session-fallback.test.ts`
    (new co-located given/when/then regression suite, written FIRST)
  - `bun test packages/omo-opencode/src/plugin/chat-message packages/omo-opencode/src/hooks/runtime-fallback packages/omo-opencode/src/tools/delegate-task`
    (scoped suites around every touched import edge)
  - `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`
- Fails-before proof: the new module was first committed to disk as a stub that
  reproduces current behavior (never promotes). The new suite ran against the
  stub and produced assertion-level RED (before-fix-red.txt), proving the tests
  detect the missing behavior rather than a missing file. The real
  implementation then turned the same suite GREEN (after-fix-green.txt).

## WHAT WAS OBSERVED

- before-fix-red.txt: 6 pass / 4 fail - all four promotion-path assertions fail
  against pre-fix behavior (no model promoted, no notification, output.message
  untouched); the six negative cases (reachable primary, cold cache, no chain,
  unreachable chain, subagent session, no-op wiring) correctly pass both before
  and after.
- after-fix-green.txt: 10 pass / 0 fail. The issue scenario is covered
  directly: sisyphus configured with `fallback_models:
  [{github-copilot/claude-sonnet-5, variant max}, {opencode/kimi-k2.5}]` and a
  requested primary `opencode/claude-opus-4-8` absent from the available set
  promotes `github-copilot/claude-sonnet-5` with variant `max`.
- scoped-tests.txt: 818 pass / 0 fail across 74 files (chat-message handlers,
  runtime-fallback reactive system, delegate-task resolution) - no regression on
  any neighboring fallback path.
- typecheck.txt: tsgo --noEmit for packages/omo-opencode exits 0.

## WHY IT IS ENOUGH

- Root cause was verified by source reading before any edit: per-agent
  `fallback_models` were consumed only by (1) delegated dispatch
  (`tools/delegate-task/subagent-model-resolution.ts:39-60` ->
  `delegate-core/model-selection.ts:88-118`) and (2) the reactive runtime
  fallback (`hooks/runtime-fallback/fallback-models.ts:39-99`), which is gated
  behind `runtime_fallback.enabled` (default false,
  `plugin/chat-message.ts:42-53`) and only fires after a retryable provider
  error. The main session's chat.message path applied only the stored-model
  replay (`plugin/chat-message/session-model.ts:22-48`) and never walked the
  agent's chain, so an unreachable primary at startup required a manual model
  switch while delegated task() calls sailed through.
- The fix wires the same delegate resolution primitive into the main-session
  chat.message handler, so parity with subagent behavior is literal reuse, not
  a parallel reimplementation. Guards keep it conservative: subagent sessions
  are skipped, agents without configured chains are untouched, empty/cold
  availability data defers without guessing, promotion only happens when the
  delegate resolver reports `matchedFallback`, and `input` is never mutated so
  downstream runtime-fallback state tracking keeps seeing the originally
  requested model.
- Remaining regression risk is limited to the wiring seam in chat-message.ts;
  the scoped suites cover that file's existing behavior (818 tests) and the
  new suite pins the wiring contract (mutation shape, input immutability,
  single notification per promoted model).

## WHAT WAS OMITTED

- No live TUI drive: this environment cannot run the real opencode harness
  against real providers (no provider credentials in the QA sandbox), so the
  startup scenario was verified at the unit/wiring level where the model
  override decision is fully deterministic. The override lands through the same
  `output.message.model` mutation channel already used by stored-model replay
  and ultrawork overrides, whose transport into the live request is exercised
  by existing opencode runs daily.
- Environment limitation (pre-existing, unrelated to this change):
  `bun install`'s prepare hook fails because the bundled build step
  (`build:materialize-frontend`) cannot complete in this worktree; dependency
  installation itself succeeded and source tests + tsgo typecheck do not need
  the built dist. Submodule objects under packages/shared-skills/upstreams/
  live in the main checkout's .git, which task constraints forbid touching.
- Raw bun/test output tails are recorded verbatim; no secrets, tokens, or env
  dumps were produced or recorded.
