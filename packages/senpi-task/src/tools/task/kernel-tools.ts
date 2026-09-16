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
 * a batch where one item routes to a curated agent or a process-mode child is denied whole, so no
 * child of that call spawns on a grant failure.
 */
export async function resolveTaskKernelTools(
  deps: TaskToolDeps,
  ctx: TaskToolContext,
  items: readonly ResolvedSpawnItem[],
  requested: readonly string[] | undefined,
): Promise<TaskKernelToolsResolution> {
  if (requested === undefined || requested.length === 0) return { kind: "none" }
  const capability = readKernelToolsCapability(ctx)
  let grant: KernelToolGrant | undefined
  for (const item of items) {
    const target = item.kind === "category" ? { category: item.category } : { subagentType: item.subagentType }
    const resolved = await resolveKernelToolGrant({
      requestedNames: requested,
      capability,
      executionMode: taskExecutionModeFor(target, deps),
      ...(item.kind === "subagent_type" ? { agentType: item.subagentType } : {}),
    })
    if (resolved.kind === "denied") {
      return { kind: "denied", detail: { requested: [...requested], error: { code: resolved.code, message: resolved.message } } }
    }
    if (resolved.kind === "granted") grant = resolved.grant
  }
  if (grant === undefined) return { kind: "none" }
  return {
    kind: "granted",
    grant,
    detail: { requested: [...requested], granted: grant.descriptors.map((descriptor) => descriptor.name) },
  }
}
