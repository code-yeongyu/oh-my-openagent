# WHAT WAS TESTED

Issue #6291: `prometheus-md-only` logs "[prometheus-md-only] Injected planning
warning to task" but the child agent receives the original delegated prompt
without `<planning-context source="prometheus-read-only">`.

## Root cause

- `packages/omo-opencode/src/hooks/prometheus-md-only/hook.ts:30` injects via
  `replaceToolArgs(output, { prompt: ... })` and logs success at hook.ts:31.
- `packages/omo-opencode/src/shared/replace-tool-args.ts` REPLACES the wrapper
  property (`output.args = { ...output.args, ...patch }`), creating a new args
  object. OpenCode executes the tool with its own original args reference, so
  the replacement never reaches the executed arguments. Log says injected;
  dispatched child prompt is unchanged.

## Surfaces driven

1. Unit: new pure helper `injectPlanningContextIfMissing`
   (hooks/prometheus-md-only/planning-context-injection.test.ts).
2. Dispatch seam `task` (delegate-task): background-mode delegation with a
   prometheus parent; asserted the prompt object handed to
   `BackgroundManager.launch()` (the actual dispatched child prompt) contains
   the planning-context marker
   (tools/delegate-task/prometheus-planning-context.test.ts).
3. Dispatch seam `call_omo_agent`: same assertion on the launch payload
   (tools/call-omo-agent/prometheus-planning-context.test.ts).

Commands:

```
bun test packages/omo-opencode/src/hooks/prometheus-md-only/planning-context-injection.test.ts \
  packages/omo-opencode/src/tools/delegate-task/prometheus-planning-context.test.ts \
  packages/omo-opencode/src/tools/call-omo-agent/prometheus-planning-context.test.ts
bun test packages/omo-opencode/src/hooks/prometheus-md-only \
  packages/omo-opencode/src/tools/delegate-task packages/omo-opencode/src/tools/call-omo-agent
bun run typecheck
```
