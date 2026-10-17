import type { KernelToolBindingRegistry } from "../kernel-tools/bindings"
import { readKernelToolsCapability } from "../kernel-tools/contract"
import { resolveKernelToolGrant, type KernelToolGrant } from "../kernel-tools/resolve"
import { WorkpoolError, type WorkpoolErrorCode, type WorkpoolRecord, type WorkpoolSpec } from "./types"

const CODES: ReadonlySet<string> = new Set([
  "tools_unavailable",
  "policy_denied",
  "reserved_tool_name",
  "tool_name_collision",
  "kernel_tool_missing",
  "kernel_tool_stale",
])

function workpoolCode(code: string): WorkpoolErrorCode {
  if (code === "curated_policy_denied") return "policy_denied"
  return (CODES.has(code) ? code : "tools_unavailable") as WorkpoolErrorCode
}

/** Resolve a pool's kernel-tool names against the live parent capability held for that pool. */
export async function resolvePoolKernelTools(input: {
  readonly names: readonly string[]
  readonly capability: unknown
  readonly spec: WorkpoolSpec
  readonly existingToolNames?: readonly string[]
}): Promise<KernelToolGrant | undefined> {
  if (input.names.length === 0) return undefined
  const agentType = input.spec.start.subagent_type ?? input.spec.plan.agentType
  const resolved = await resolveKernelToolGrant({
    requestedNames: input.names,
    capability: readKernelToolsCapability({ kernelTools: input.capability }),
    executionMode: input.spec.start.execution_mode ?? "in-process",
    ...(agentType === undefined ? {} : { agentType }),
    ...(input.existingToolNames === undefined ? {} : { existingToolNames: input.existingToolNames }),
    ...(input.spec.plan.toolAllowlist === undefined ? {} : { toolAllowlist: input.spec.plan.toolAllowlist }),
    ...(input.spec.plan.toolDenylist === undefined ? {} : { toolDenylist: input.spec.plan.toolDenylist }),
  })
  if (resolved.kind === "denied") throw new WorkpoolError(workpoolCode(resolved.code), resolved.message)
  return resolved.kind === "granted" ? resolved.grant : undefined
}

/**
 * Every NEW worker spawn re-resolves the pool's plain-data names against the pool's LIVE binding.
 * A pool whose parent kernel is gone (host restart, disposed engine) yields a typed tools_unavailable
 * for that worker instead of silently spawning a worker without the tools its items expect.
 */
export async function resolveWorkerKernelTools(
  pool: WorkpoolRecord,
  bindings: KernelToolBindingRegistry | undefined,
  existingToolNames?: readonly string[],
): Promise<KernelToolGrant | undefined> {
  const names = pool.kernel_tool_names ?? []
  if (names.length === 0) return undefined
  const binding = bindings?.get(pool.pool_id)
  if (binding === undefined) {
    throw new WorkpoolError(
      "tools_unavailable",
      `Pool ${pool.pool_id} has no live parent kernel binding for its worker tools; recreate the pool from a live JavaScript cell.`,
    )
  }
  return await resolvePoolKernelTools({
    names,
    capability: binding.capability,
    spec: pool.worker_spec,
    ...(existingToolNames === undefined ? {} : { existingToolNames }),
  })
}
