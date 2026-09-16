import type { ToolDefinition } from "@code-yeongyu/senpi"

import { CURATED_READONLY_AGENT_NAMES } from "../../agents/builtin"
import type { KernelToolBindingRegistry } from "../../kernel-tools/bindings"
import { kernelToolKey } from "../../kernel-tools/names"
import { escalatingHostTools, nestedHostScopeMessage } from "../../kernel-tools/nested-host-scope"
import { recordedKernelToolNames } from "../../kernel-tools/transcript-names"
import {
  createKernelToolWrappers,
  createUnavailableKernelToolStubs,
  type KernelToolWrapperOptions,
} from "../../kernel-tools/wrapper"
import type { ChildSpec } from "../in-process"
import { RunnerError } from "./runner-error"

const REVIVED_WITHOUT_BINDING =
  "This parent JavaScript tool was granted by a kernel that is no longer live in this session, so it cannot be called. Ask the parent to define and grant it again from a live JavaScript cell."

/**
 * The child's parent-kernel tool surface. The tool layer already refused every unauthorised grant
 * before a session existed; this is the runner-side floor, so an in-process rebuild can never widen
 * a curated child or shadow a tool the child already has.
 */
export function buildChildKernelTools(
  spec: ChildSpec,
  existingToolNames: readonly string[],
  options: KernelToolWrapperOptions = {},
): ToolDefinition[] {
  const grant = spec.kernelTools
  if (grant === undefined) return []
  if (spec.agentType !== undefined && CURATED_READONLY_AGENT_NAMES.has(spec.agentType)) {
    throw new RunnerError({
      kind: "tools_unavailable",
      message: `Curated read-only agent "${spec.agentType}" must not receive parent kernel tools.`,
    })
  }
  // The runner floor re-runs the nested-host-scope rule against the child's REAL tool surface: the
  // tool layer decided it from the resolved agent definition, and a category child's plan is only
  // known here. A closure whose nested host calls would exceed what this child may itself cause is
  // refused before the session exists (nested-host-scope.ts documents the rule).
  const escalating = escalatingHostTools({
    childToolNames: existingToolNames,
    ...(spec.toolAllowlist === undefined ? {} : { toolAllowlist: spec.toolAllowlist }),
    ...(spec.toolDenylist === undefined ? {} : { toolDenylist: spec.toolDenylist }),
  })
  if (escalating.length > 0) {
    throw new RunnerError({
      kind: "tools_unavailable",
      message: nestedHostScopeMessage(`Child ${spec.taskId}`, escalating),
    })
  }
  const existing = new Set(existingToolNames.map(kernelToolKey))
  for (const descriptor of grant.descriptors) {
    if (existing.has(kernelToolKey(descriptor.name))) {
      throw new RunnerError({
        kind: "tools_unavailable",
        message: `Parent kernel tool "${descriptor.name}" collides with an existing tool of child ${spec.taskId}.`,
      })
    }
  }
  return createKernelToolWrappers(grant, options)
}

/**
 * The revived child's parent-tool surface.
 *
 * A binding that survived same-host idle parking rebuilds the live wrappers (still fenced by the
 * ORIGINAL generation/revision, re-checked by the parent kernel on every call). Without a binding -
 * a host restart, a new parent kernel, or a deliberately released child - nothing can reconstruct
 * authority from a transcript, so only ERROR STUBS for the tool names this child already used are
 * restored. A stub never invokes a closure and never shadows a tool the child still has live.
 */
export function buildRevivedChildKernelTools(input: {
  readonly spec: ChildSpec
  readonly sessionPath: string
  readonly existingToolNames: readonly string[]
  readonly bindings: KernelToolBindingRegistry | undefined
}): ToolDefinition[] {
  const { spec, bindings } = input
  const binding = bindings?.get(spec.taskId)
  if (binding !== undefined) {
    return buildChildKernelTools({ ...spec, kernelTools: binding }, input.existingToolNames, {
      isCurrent: () => bindings?.get(spec.taskId) === binding,
    })
  }
  const existing = new Set(input.existingToolNames.map(kernelToolKey))
  const restored = recordedKernelToolNames(input.sessionPath).filter((name) => !existing.has(kernelToolKey(name)))
  return createUnavailableKernelToolStubs(restored, REVIVED_WITHOUT_BINDING)
}
