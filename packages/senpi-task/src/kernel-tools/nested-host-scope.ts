import { isTaskOrTeamFamilyTool } from "../runners/in-process/shared-tool-filter"
import { childStructuralToolNames, isWriteCapableHostTool } from "../runners/in-process/host-tools"

export { isWriteCapableHostTool }

/**
 * Nested host calls made INSIDE a granted parent closure run with the PARENT session's tool
 * permissions: the merged producer exposes no scoped-execution hook for them (backlog senpi#1731).
 * Until it does, a grant must never hand a child a closure that reaches a WRITE-capable tool the
 * child's OWN policy took away.
 *
 * THE RULE (also stated in the changelog fragment and the PR body):
 *
 * - The child's effective host tool set is the same list the runner installs: `childStructuralToolNames`
 *   (senpi session builtins ∪ merged custom tools) minus the task/team family, minus the denylist,
 *   intersected with the allowlist whenever the resolved agent DEFINES one, even an empty one.
 * - The grant is REFUSED as `tools_unavailable` when that set is missing any write-capable name the
 *   parent closure can still reach on the same list.
 * - A name that is not in the host-tool table counts as WRITE-capable, so an unrecognised MCP or
 *   extension tool fails closed.
 * - Host-wide exclusions are NOT refusals. The UI/identity-bound tools (`memory`,
 *   `ask_user_question`, `request_user_input`) and the task/team family are withheld from EVERY
 *   child because they bind to the parent session's identity/UI or would let a child spawn its own
 *   graph - never as a reduction of what the child is permitted to cause.
 */

export type NestedHostScopeRequest = {
  /**
   * Custom/parent names the child is structurally offered. Session builtins are always unioned via
   * `childStructuralToolNames` so a caller that only enumerates extension tools still fail-closes.
   */
  readonly childToolNames?: readonly string[]
  readonly toolAllowlist?: readonly string[]
  readonly toolDenylist?: readonly string[]
}

function reachableHostTools(request: NestedHostScopeRequest): readonly string[] {
  return childStructuralToolNames(request.childToolNames ?? []).filter((name) => !isTaskOrTeamFamilyTool(name))
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

export function nestedHostScopeMessage(subject: string, escalating: readonly string[]): string {
  return `${subject} cannot receive parent kernel tools: a parent closure's nested host calls run with the PARENT's permissions, which still reach ${escalating.join(", ")} after this child's own tool policy removed ${escalating.length === 1 ? "it" : "them"}.`
}
