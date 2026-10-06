import { CURATED_READONLY_AGENT_NAMES } from "../agents/builtin"
import type { ExecutionMode } from "../manager/execution-mode"
import {
  kernelToolErrorCode,
  kernelToolErrorMessage,
  parseDescribeResults,
  supportsInvokeScope,
  type KernelToolDescriptor,
  type KernelToolErrorCode,
  type KernelToolInvokeScope,
  type KernelToolsCapability,
} from "./contract"
import { isReservedKernelToolName, kernelToolKey, normalizeKernelToolName } from "./names"
import { childInvokeScope, escalatingHostTools, nestedHostScopeMessage } from "./nested-host-scope"

export type KernelToolGrantRequest = {
  readonly requestedNames: readonly string[]
  readonly capability: KernelToolsCapability | undefined
  readonly executionMode: ExecutionMode
  readonly agentType?: string
  readonly teamRole?: "member"
  // Names already occupied on the child's tool surface (shared parent tools, member-scoped tools).
  readonly existingToolNames?: readonly string[]
  readonly toolAllowlist?: readonly string[]
  readonly toolDenylist?: readonly string[]
}

export type KernelToolGrant = {
  readonly capability: KernelToolsCapability
  readonly descriptors: readonly KernelToolDescriptor[]
  readonly requestedNames: readonly string[]
  /**
   * The per-call execution scope every invoke on this child's behalf carries. Present only when the
   * live capability advertises `capabilities.invokeScope`; its absence is what makes the wrapper
   * post exactly the frame it always did. The runner recomputes it against the child's REAL tool
   * surface before installing the wrappers.
   */
  readonly scope?: KernelToolInvokeScope
}

export type KernelToolGrantResolution =
  | { readonly kind: "none" }
  | { readonly kind: "granted"; readonly grant: KernelToolGrant }
  | { readonly kind: "denied"; readonly code: KernelToolErrorCode; readonly message: string }

function denied(code: KernelToolErrorCode, message: string): KernelToolGrantResolution {
  return { kind: "denied", code, message }
}

/**
 * Spawn-time resolution of the requested parent kernel-tool names against the parent invocation's
 * LIVE capability. Every rejection is typed and happens BEFORE a child session exists; nothing here
 * ever partially grants.
 *
 * Nested host calls made by a parent closure execute with the PARENT's permissions UNLESS the live
 * capability advertises the per-call execution scope (`capabilities.invokeScope`, senpi#1731).
 * When it does, the child's resolved effective policy rides every invoke as the scope, so a
 * narrowed child is GRANTED and its closure's nested calls run child-permissioned. When it does
 * not, a child whose own allow/deny policy takes a WRITE-capable parent tool away cannot receive
 * kernel tools (see nested-host-scope.ts for the exact rule): granting one would be a write bypass
 * of that policy, so the grant fails closed as tools_unavailable instead.
 */
export async function resolveKernelToolGrant(request: KernelToolGrantRequest): Promise<KernelToolGrantResolution> {
  if (request.requestedNames.length === 0) return { kind: "none" }

  if (request.agentType !== undefined && CURATED_READONLY_AGENT_NAMES.has(request.agentType)) {
    return denied(
      "curated_policy_denied",
      `Curated read-only agent "${request.agentType}" never receives parent kernel tools, including read-only ones.`,
    )
  }
  if (request.teamRole === "member") {
    return denied("tools_unavailable", "Team members run out of process and cannot reach a parent JavaScript kernel.")
  }
  if (request.executionMode !== "in-process") {
    return denied(
      "tools_unavailable",
      `Parent kernel tools require an in-process child; this child runs in ${request.executionMode} mode.`,
    )
  }
  const scopeRequest = {
    ...(request.existingToolNames === undefined ? {} : { childToolNames: request.existingToolNames }),
    ...(request.toolAllowlist === undefined ? {} : { toolAllowlist: request.toolAllowlist }),
    ...(request.toolDenylist === undefined ? {} : { toolDenylist: request.toolDenylist }),
  }
  const scoped = supportsInvokeScope(request.capability)
  if (!scoped) {
    const escalating = escalatingHostTools(scopeRequest)
    if (escalating.length > 0) {
      return denied("tools_unavailable", nestedHostScopeMessage("This child", escalating))
    }
  }

  const existing = new Set((request.existingToolNames ?? []).map(kernelToolKey))
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const requested of request.requestedNames) {
    const name = normalizeKernelToolName(requested)
    const key = kernelToolKey(name)
    if (isReservedKernelToolName(name)) {
      return denied("reserved_tool_name", `Parent kernel tool name "${requested}" is reserved by the host.`)
    }
    if (seen.has(key)) {
      return denied("tool_name_collision", `Parent kernel tool name "${requested}" is requested more than once.`)
    }
    if (existing.has(key)) {
      return denied("tool_name_collision", `Parent kernel tool name "${requested}" collides with an existing child tool.`)
    }
    seen.add(key)
    normalized.push(name)
  }

  const capability = request.capability
  if (capability === undefined) {
    return denied(
      "tools_unavailable",
      "Kernel tools require a live JavaScript worker context; this parent invocation has none.",
    )
  }

  let entries: ReturnType<typeof parseDescribeResults>
  try {
    entries = parseDescribeResults(await capability.describe(normalized))
  } catch (error) {
    return denied("tools_unavailable", kernelToolErrorMessage(error))
  }

  const descriptors: KernelToolDescriptor[] = []
  for (const entry of entries) {
    if (!entry.ok) {
      const code = kernelToolErrorCode(entry.error, "kernel_tool_missing")
      return denied(
        code,
        `Parent kernel tool "${entry.name}" is not defined: ${entry.error.message}. Define it first in a parent cell: JavaScript tool(function ${entry.name}(...) { ... }) or Python @tool def ${entry.name}(...), then request it again.`,
      )
    }
    descriptors.push(entry.descriptor)
  }

  return {
    kind: "granted",
    grant: {
      capability,
      descriptors,
      requestedNames: normalized,
      ...(scoped ? { scope: childInvokeScope(scopeRequest) } : {}),
    },
  }
}
