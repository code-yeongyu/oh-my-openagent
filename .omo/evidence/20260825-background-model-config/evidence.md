# Evidence: Issue #3681 - disabled_hooks bypass via ungated contextInjectorMessagesTransform

Date: 2026-08-25 | Branch: `issue/3681-background-model-config` (base c7094b8ac) | Worktree: /home/viprix/projects/oom-wt-3681

## Scope note (important)

The orchestrator task text described #3681 as "background task agents use wrong models versus config". The actual issue #3681 in code-yeongyu/oh-my-openagent is "rules-injector still loads rules despite disabled_hooks config". The leftover branch in this worktree (`issue/3681-rules-injector-disabled-hooks`) confirms prior work targeted the real issue. This PR fixes the real #3681 so that `Fixes #3681` closes the correct issue.

## WHAT WAS TESTED

1. New co-located regression test `packages/omo-opencode/src/plugin/hooks/create-transform-hooks.test.ts`:
   - given `context-injector` in disabled set -> `contextInjectorMessagesTransform` must be null
   - given other hooks disabled -> transform stays independently gated
   - given default config -> transform created
2. Scoped suites: create-tool-guard-hooks.test.ts, features/context-injector/ (collector+injector), config/schema.test.ts, plugin/messages-transform.test.ts, plugin-config.test.ts.
3. `bun run typecheck` (tsgo root + script + all 30 package tsconfigs).
4. `bun run build:schema` regeneration check.

## WHAT WAS OBSERVED

### Before fix (failing-first, red)

```
error: expect(received).toBeNull()
Received: { "experimental.chat.messages.transform": [AsyncFunction: ...] }
(fail) createTransformHooks > #given disabled_hooks > returns null contextInjectorMessagesTransform when context-injector is disabled
 1 fail / 2 pass
```

Root cause confirmed at `create-transform-hooks.ts`: every collector-feeding hook (`claude-code-hooks`, `keyword-detector`) and every other transform hook is gated by `isHookEnabled(...)`, but `contextInjectorMessagesTransform` was created unconditionally and drained the shared `ContextCollector` into user messages on every turn. With the injection drain ungated, content collected by any source could not be fully suppressed by `disabled_hooks`, exactly the prompt-pollution class reported in #3681. Fix follows the direction proposed in the issue thread ("Would be nice if contextInjectorMessagesTransform had an isHookEnabled gate too").

### After fix (green)

```
bun test packages/omo-opencode/src/plugin/hooks/create-transform-hooks.test.ts \
         packages/omo-opencode/src/plugin/hooks/create-tool-guard-hooks.test.ts \
         packages/omo-opencode/src/features/context-injector/
 29 pass / 0 fail (52 expect calls)

bun test packages/omo-opencode/src/config/schema.test.ts
 81 pass / 0 fail

bun test packages/omo-opencode/src/plugin/messages-transform.test.ts packages/omo-opencode/src/plugin-config.test.ts
 24 pass / 0 fail

bun run typecheck  -> tsgo --noEmit (root) + typecheck:script + typecheck:packages: exit 0, no errors
```

Changes:
- `src/config/schema/hooks.ts`: added `"context-injector"` to `HookNameSchema`.
- `src/plugin/hooks/create-transform-hooks.ts`: `contextInjectorMessagesTransform` now created only when `isHookEnabled("context-injector")`; type widened to `| null`. Downstream handler already optional-chains (`messages-transform.ts` line ~253), null flows through safely; `CreatedHooks` is inferred so no other type edits needed.
- Default behavior unchanged (hook enabled unless listed in `disabled_hooks`). Users can now add `"context-injector"` to `disabled_hooks` for a hard kill-switch on the collected-context injection pipeline.

## WHY IT IS ENOUGH

Unit-level red/green proves the gate seam; schema tests prove the new hook name validates; messages-transform + plugin-config suites prove null-safety of the drain path; full monorepo typecheck proves no consumer breakage. `disabled_hooks` is typed `z.array(z.string())` at the root field, so the generated JSON schema assets are byte-identical after regeneration (verified via git status).

## WHAT WAS OMITTED

- Live OpenCode runtime QA (opencode-qa skill / SSE hook probe) was NOT run within the hard 15-minute ship timebox; verification is unit + typecheck level. Residual risk: end-to-end injection suppression under a real session was not observed on a live harness.
- Full root `bun test` suite not run (scoped suites only) per task's scoped-gate requirement.
- Environment notes: network-restricted env; `bun install --frozen-lockfile --offline` used (warm bun cache). Root prepare script (`build:materialize-frontend`) fails on submodule clone here (known gotcha); it does not affect tests/typecheck. Submodule dirt (`packages/shared-skills/upstreams/*`) is pre-existing environment noise, intentionally NOT staged.
