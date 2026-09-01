# tools/task - The `task` Tool

Single or `tasks:[...]` batch spawn of child tasks routed by category or agent. Tool contracts, plan-gated agents, and batch semantics live in the package AGENTS.md; this file maps the modules and the validation rules. 54 files, the largest tool subtree.

## Anatomy

| Path | Purpose |
|------|---------|
| `tool.ts` | `createTaskTool` / `TASK_TOOL_NAME` (`"task"`). |
| `params.ts` | TypeBox `TaskToolParams`; `MAX_TASK_BATCH_ITEMS = 16` (schema `maxItems` + execution cap). Prompts MUST be English; `prompt` XOR `tasks`. |
| `argument-normalization.ts` | Batch item inheritance from top-level params; empty provider padding normalized before validation. |
| `validation.ts` | `validateTaskTarget`, `resolveSpawnItems`, `validateBatchShape`; codes `both_targets` / `no_target` / `category_with_model`. |
| `categories.ts` / `description.ts` | Category/agent discovery and prompt description builders (plan-gated names get their own line). |
| `execute.ts` | Entry: shape validation -> item resolution -> single/batch dispatch. |
| `execute-single.ts` / `execute-batch.ts` / `execute-spec.ts` | Single spawn, batch aggregation (start/error/background/foreground), start-spec construction. |
| `foreground-wait.ts` | Foreground wait surface. |
| `invocation-gate.ts` / `plan-review-contract.ts` | metis/momus plan-gate consult before `manager.start` (single: `denied`; batch item: `plan_unresolved` / `invalid_target`). |
| `spawn-policy.ts` | `evaluateSpawnPolicy` verdicts. |
| `skills.ts` / `skill-result.ts` | Skill loading/prepend + task skill summaries. |
| `renderers.ts` / `call-renderer.ts` / `start-presentation.ts` / `result-details.ts` | Result rendering and details; package subpath `./task-renderers` points at `renderers.ts`. |
| `types.ts` | Contract hub: `TaskToolContext`, `TaskAncestry`, `TaskToolDeps`, `ResolvedSpawnItem`, `TaskToolDetails`. |

## Conventions

- Pure-ish `run*` functions + `create*Tool` adapters; runtime seams injected via `TaskToolDeps` / `TaskToolContext` (tests use `__fixtures__/task-tool-fakes.ts`).
- Every effective spawn has exactly one target after batch inheritance; an effective category item carries no own or inherited model.
- Validation hard-fails invalid targets with the fix named in the message; fields are never silently ignored.

## Anti-patterns

- NEVER combine `category` with `subagent_type`; NEVER combine category routing with `model` (a call-site override would bypass `categories.<name>.models` routing).
- The batch cap (16) is enforced on both the schema and the execution path; keep them in sync.
- New spawn paths must consult the invocation gate; both single and batch routes do.

## QA

```sh
bun test packages/senpi-task/src/tools/task
```

Parent: [`../../../AGENTS.md`](../../../AGENTS.md).
