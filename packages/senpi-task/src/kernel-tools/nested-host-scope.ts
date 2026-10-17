import type { KernelToolInvokeScope } from "./contract"
import { isChildOrchestrationExcluded } from "../runners/in-process/shared-tool-filter"
import { childStructuralToolNames, isWriteCapableHostTool } from "../runners/in-process/host-tools"

export { isWriteCapableHostTool }

/**
 * Nested host calls made INSIDE a granted parent closure run with the PARENT session's tool
 * permissions UNLESS the live capability advertises the producer's per-call execution scope
 * (senpi#1731, PR #1765, `capabilities.invokeScope === true`).
 *
 * - WITH the scope: the child's RESOLVED EFFECTIVE tool policy rides every invoke as
 *   `scope.tools`, so the closure's nested calls run CHILD-permissioned and a narrowed child is
 *   granted (`childInvokeScope`). A nested call outside the scope is refused inside the worker and
 *   lands on the child's own tool-result channel as `kernel_tool_host_denied`.
 * - WITHOUT it (an older pin): a grant must never hand a child a closure that reaches a
 *   WRITE-capable tool the child's OWN policy took away, so the grant is refused
 *   (`escalatingHostTools` + `nestedHostScopeMessage`).
 *
 * THE RULE (also stated in the changelog fragment and the PR body):
 *
 * - The child's effective host tool set is the same list the runner installs: `childStructuralToolNames`
 *   (senpi session builtins ∪ merged custom tools) minus lead-only workflow/team tools, minus the denylist,
 *   intersected with the allowlist whenever the resolved agent DEFINES one, even an empty one.
 * - The grant is REFUSED as `tools_unavailable` when that set is missing any write-capable name the
 *   parent closure can still reach on the same list.
 * - A name that is not in the host-tool table counts as WRITE-capable, so an unrecognised MCP or
 *   extension tool fails closed.
 * - Host-wide exclusions are NOT refusals. Parent-only question tools are withheld upstream from
 *   every child, while workflow/team coordination stays excluded here. Task/workpool and memory
 *   follow the process-child surface.
 */

export type NestedHostScopeRequest = {
  /**
   * Custom/parent names the child is structurally offered. Session builtins are always unioned via
   * `childStructuralToolNames` so a caller that only enumerates extension tools still fail-closes.
   */
  readonly childToolNames?: readonly string[]
  readonly toolAllowlist?: readonly string[]
  readonly toolDenylist?: readonly string[]
  readonly includeTaskTools?: boolean
}

function reachableHostTools(request: NestedHostScopeRequest): readonly string[] {
  return childStructuralToolNames(request.childToolNames ?? []).filter((name) => !isChildOrchestrationExcluded(name, request.includeTaskTools === true))
}

/**
 * The child's RESOLVED EFFECTIVE tool set: the same names the runner ends up installing, after the
 * allowlist (`tools:`) and the denylist (`excludeTools`) are applied to its structurally-visible
 * surface. A PRESENT allowlist narrows even when it is EMPTY.
 */
export function childEffectiveToolNames(request: NestedHostScopeRequest): readonly string[] {
  const allowlist = request.toolAllowlist === undefined ? undefined : new Set(request.toolAllowlist)
  const denylist = new Set(request.toolDenylist ?? [])
  return reachableHostTools(request)
    .filter((name) => !denylist.has(name) && (allowlist === undefined || allowlist.has(name)))
}

/**
 * The WRITE-capable parent tools the closure can reach that the child's effective set lacks. Empty
 * means the nested host calls cannot exceed what the child itself may cause, so the grant is safe.
 */
export function escalatingHostTools(request: NestedHostScopeRequest): readonly string[] {
  if (request.toolAllowlist === undefined && (request.toolDenylist?.length ?? 0) === 0) return []
  const effective = new Set(childEffectiveToolNames(request))
  return reachableHostTools(request).filter((name) => isWriteCapableHostTool(name) && !effective.has(name))
}

/**
 * The per-call execution scope to send with EVERY invoke made on this child's behalf: the child's
 * effective tool set as `allow`, plus its literal denylist as `deny` when it has one (the producer
 * lets `deny` win, so carrying both states the policy exactly as the child's own surface does).
 * An empty allow list is meaningful, not missing: that child may cause nothing on the host.
 */
export function childInvokeScope(request: NestedHostScopeRequest): KernelToolInvokeScope {
  const deny = request.toolDenylist ?? []
  return {
    tools: {
      allow: [...childEffectiveToolNames(request)],
      ...(deny.length === 0 ? {} : { deny: [...deny] }),
    },
  }
}

export function nestedHostScopeMessage(subject: string, escalating: readonly string[]): string {
  return `${subject} cannot receive parent kernel tools: a parent closure's nested host calls run with the PARENT's permissions, which still reach ${escalating.join(", ")} after this child's own tool policy removed ${escalating.length === 1 ? "it" : "them"}.`
}
