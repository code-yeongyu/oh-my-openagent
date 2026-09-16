import { agentToolPolicy } from "../../agents/agent-tool-policy"
import { readKernelToolsCapability } from "../../kernel-tools/contract"
import { resolveKernelToolGrant, type KernelToolGrant } from "../../kernel-tools/resolve"
import { taskExecutionModeFor } from "./execute-spec"
import type { ResolvedSpawnItem, TaskKernelToolsDetail, TaskToolContext, TaskToolDeps } from "./types"

export type TaskKernelToolsResolution =
  | { readonly kind: "none" }
  | { readonly kind: "granted"; readonly grant: KernelToolGrant; readonly detail: TaskKernelToolsDetail }
  | { readonly kind: "denied"; readonly detail: TaskKernelToolsDetail }

/**
 * Resolve the `tools` names ONCE for the whole call, against the live capability of the parent
 * invocation, before any child session is created. Every item is checked against its own target:
 * a batch where one item routes to a curated agent, a process-mode child, or an agent whose own
 * tool policy would make the grant a write bypass is denied whole, so neither a child session nor a
 * task record exists after a grant failure.
 */
export async function resolveTaskKernelTools(
  deps: TaskToolDeps,
  ctx: TaskToolContext,
  items: readonly ResolvedSpawnItem[],
  requested: readonly string[] | undefined,
): Promise<TaskKernelToolsResolution> {
  if (requested === undefined || requested.length === 0) return { kind: "none" }
  const capability = readKernelToolsCapability(ctx)
  // The names the child will already carry, so a colliding request and a policy-narrowed child are
  // both refused here rather than at the runner floor (which runs after the record is written).
  const childToolNames = deps.resolveChildToolNames?.()
  let grant: KernelToolGrant | undefined
  for (const item of items) {
    const target = item.kind === "category" ? { category: item.category } : { subagentType: item.subagentType }
    // A category target carries no persona, so its child keeps the full shared surface; a named
    // agent's literal allow/deny rules decide the nested-host-scope rule for this grant.
    const agent = item.kind === "subagent_type"
      ? { agentType: item.subagentType, ...agentToolPolicy(deps.agents[item.subagentType]) }
      : {}
    const resolved = await resolveKernelToolGrant({
      requestedNames: requested,
      capability,
      executionMode: taskExecutionModeFor(target, deps),
      ...(childToolNames === undefined ? {} : { existingToolNames: childToolNames }),
      ...agent,
    })
    if (resolved.kind === "denied") {
      return {
        kind: "denied",
        detail: { requested: [...requested], status: "refused", error: { code: resolved.code, message: resolved.message } },
      }
    }
    if (resolved.kind === "granted") grant = resolved.grant
  }
  if (grant === undefined) return { kind: "none" }
  return {
    kind: "granted",
    grant,
    detail: { requested: [...requested], status: "granted", granted: grant.descriptors.map((descriptor) => descriptor.name) },
  }
}
