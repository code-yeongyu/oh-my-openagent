# Plan: Fix #6291 prometheus-md-only logs injection but child receives original prompt

## Root cause (file:line)

- `packages/omo-opencode/src/hooks/prometheus-md-only/hook.ts:30` injects the planning
  warning via `replaceToolArgs(output, { prompt: PLANNING_CONSULT_WARNING + prompt })`
  and then logs success at `hook.ts:31`.
- `packages/omo-opencode/src/shared/replace-tool-args.ts` REPLACES the wrapper property:
  `output.args = { ...output.args, ...patch }`. This creates a NEW args object.
- OpenCode's tool execution passes `{ args: taskArgs }` (a wrapper around its own
  original `taskArgs` reference) into `tool.execute.before`, then executes the tool
  with the ORIGINAL `taskArgs`. Replacing the wrapper's `args` property therefore
  never reaches the executed arguments. Log says injected; dispatched child prompt is
  unchanged. That is the log-vs-reality divergence.

## Fix direction (per issue's "Possible fix direction")

Construct the final prompt inside OMO's own task dispatch path, before launch,
instead of relying only on `tool.execute.before` arg replacement:

1. New pure helper `packages/omo-opencode/src/hooks/prometheus-md-only/planning-context-injection.ts`:
   `injectPlanningContextIfMissing(prompt)` prepends `PLANNING_CONSULT_WARNING`
   iff `PLANNING_CONTEXT_OPEN` marker is absent (idempotent).
2. Export from `prometheus-md-only/index.ts` barrel.
3. `tools/delegate-task/tools.ts`: new option `planningWarningInjectionDisabled?: boolean`;
   in `execute()` right after `resolveParentContext()`, if parent agent is Prometheus
   (`isPrometheusAgent(parentContext.agent)`) and prompt lacks the marker, rewrite
   `delegateTaskArgs.prompt` before ANY executor routing (covers background, sync,
   continuation, unstable-agent paths). Log the dispatch-side injection.
4. `tools/call-omo-agent/tools.ts`: same injection in `execute()` before executor
   routing; parent agent from `toolCtx.agent` with `getAgentFromSession` fallback;
   new optional trailing param `planningWarningInjectionDisabled = false`.
5. `plugin/tool-registry-core-tools.ts`: compute
   `(pluginConfig.disabled_hooks ?? []).includes("prometheus-md-only")` and pass it to
   both factories so `disabled_hooks` parity is preserved.

The hook-level injection branch stays as defense-in-depth; marker idempotence
prevents double injection if a future OpenCode propagates hook arg replacement.

## Tests (failing first)

- `hooks/prometheus-md-only/planning-context-injection.test.ts`: helper unit
  (prepend when missing; unchanged when marker present).
- `tools/delegate-task/prometheus-planning-context.test.ts`:
  - #given prometheus parent, background task -> #then `manager.launch` prompt contains
    `<planning-context source="prometheus-read-only">` (FAILS before fix)
  - non-prometheus parent -> prompt untouched
  - prompt already containing marker -> not doubled
- `tools/call-omo-agent/prometheus-planning-context.test.ts`:
  - prometheus parent background launch prompt contains marker (FAILS before fix)
  - non-prometheus parent untouched

## Verification

- Scoped: `bun test packages/omo-opencode/src/hooks/prometheus-md-only packages/omo-opencode/src/tools/delegate-task/prometheus-planning-context.test.ts packages/omo-opencode/src/tools/call-omo-agent/prometheus-planning-context.test.ts`
- Typecheck: `bun run typecheck` (tsgo authoritative; LSP may be unreachable in worktrees)
- Evidence recorded in this dir.
