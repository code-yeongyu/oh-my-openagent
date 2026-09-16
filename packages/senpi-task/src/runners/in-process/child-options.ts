import type { CreateAgentSessionOptions, SessionManager, ToolDefinition } from "@code-yeongyu/senpi"

import { BUILTIN_AGENTS, CURATED_READONLY_AGENT_NAMES } from "../../agents/builtin"
import type { KernelToolBindingRegistry } from "../../kernel-tools/bindings"
import { isWorkpoolYieldTool } from "../../workpool/worker-tool-identity"
import type { ChildSpec } from "../in-process"
import { createChildResourceLoader } from "./child-loader"
import { createCuratedReadonlyBashTool } from "./curated-readonly-bash"
import { buildChildKernelTools, buildRevivedChildKernelTools } from "./kernel-tool-surface"
import { RunnerError } from "./runner-error"
import { createRuntimeFallbackSettings } from "./runtime-fallback-settings"
import { childStructuralToolNames } from "./host-tools"
import { mergeChildCustomTools } from "./shared-tool-filter"

export type BuildChildSessionOptionsInput = {
  readonly spec: ChildSpec
  // Resume only: the child's recorded transcript, used to restore typed error stubs for parent
  // kernel tools whose runtime binding did not survive (never to reconstruct authority).
  readonly revivedSessionPath?: string
  readonly kernelToolBindings?: KernelToolBindingRegistry
  // The caller owns session-lifecycle: start passes SessionManager.create(cwd, spec.sessionDir),
  // resume (todo 10) passes SessionManager.open(sessionPath, spec.sessionDir, cwd). Everything else
  // about the child's construction is assembled here so both modes share ONE option builder.
  readonly sessionManager: SessionManager
  readonly sharedParentTools: readonly ToolDefinition[]
  readonly uiOnlyToolNames: readonly string[]
}

/**
 * The child session dir is MANDATORY: a legacy spec without one must fail typed, never fall back
 * to senpi's default (~/.senpi) location or an in-memory session - either would strand the
 * transcript outside stateDir/children/<taskId>/ where reconcile discovery looks.
 */
export function requireChildSessionDir(spec: ChildSpec): string {
  if (typeof spec.sessionDir !== "string" || spec.sessionDir.length === 0) {
    throw new RunnerError({
      kind: "session-create-failed",
      message: `Child ${spec.taskId} has no sessionDir; refusing to fall back to a default session location.`,
    })
  }
  return spec.sessionDir
}

/**
 * Re-resolve persisted member-scoped tool NAMES against the live shared parent tools on resume.
 * The raw (unfiltered) shared set is searched because member-scoped tools are the sanctioned
 * bypass of the task/team-family exclusion. A name that is duplicated in the spec, missing from
 * the live set, or ambiguous in it is a TYPED tools_unavailable failure (retryable) - never a
 * silently weakened tool surface.
 */
export function resolveMemberScopedToolNames(
  names: readonly string[],
  sharedParentTools: readonly ToolDefinition[],
): ToolDefinition[] {
  const resolved: ToolDefinition[] = []
  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) {
      throw new RunnerError({
        kind: "tools_unavailable",
        message: `Member-scoped tool name "${name}" is duplicated in the persisted spec.`,
      })
    }
    seen.add(name)
    const matches = sharedParentTools.filter((tool) => tool.name === name)
    const tool = matches[0]
    if (matches.length !== 1 || tool === undefined) {
      throw new RunnerError({
        kind: "tools_unavailable",
        message: matches.length === 0
          ? `Member-scoped tool "${name}" is not available in the live parent tools.`
          : `Member-scoped tool "${name}" matches ${matches.length} live parent tools.`,
      })
    }
    resolved.push(tool)
  }
  return resolved
}

/**
 * The identity gate a STARTED child's wrappers evaluate on every call: a grant that is no longer
 * this child's current binding (released on destruction, expunge or shutdown) must fail closed
 * instead of reaching a kernel it no longer belongs to during the teardown window.
 */
function liveBindingGuard(
  spec: ChildSpec,
  bindings: KernelToolBindingRegistry | undefined,
): { readonly isCurrent?: () => boolean } {
  const granted = spec.kernelTools
  if (bindings === undefined || granted === undefined) return {}
  return { isCurrent: () => bindings.get(spec.taskId) === granted }
}

/**
 * Assemble the full CreateAgentSessionOptions for an in-process child: shared parent tools minus
 * the task/team family, member-scoped tools (the sanctioned bypass), the curated read-only bash
 * override, the allowlist on `tools`, the denylist on senpi's real deny field `excludeTools`
 * (`tools:` alone does NOT deny), runtime fallback settings, and model/auth/runtime passthroughs.
 */
export function buildChildSessionOptions(input: BuildChildSessionOptionsInput): CreateAgentSessionOptions {
  const { spec, sessionManager, uiOnlyToolNames } = input
  const mergedCustomTools = mergeChildCustomTools(input.sharedParentTools, spec.memberScopedTools, {
    uiOnlyToolNames,
  })
  const existingToolNames = childStructuralToolNames(mergedCustomTools.map((tool) => tool.name))
  const curated = spec.agentType !== undefined && CURATED_READONLY_AGENT_NAMES.has(spec.agentType)
  const floor = curated ? (BUILTIN_AGENTS[spec.agentType ?? ""]?.tools ?? []).filter((rule) => rule.allow).map((rule) => rule.pattern) : undefined
  const toolAllowlist = floor === undefined ? spec.toolAllowlist : floor.filter((name) => spec.toolAllowlist === undefined || spec.toolAllowlist.includes(name))
  const kernelTools = input.revivedSessionPath === undefined
    ? buildChildKernelTools(spec, existingToolNames, liveBindingGuard(spec, input.kernelToolBindings))
    : buildRevivedChildKernelTools({
      spec,
      sessionPath: input.revivedSessionPath,
      existingToolNames,
      bindings: input.kernelToolBindings,
    })
  const customTools = curated
    ? [...mergedCustomTools.filter((tool) => tool.name !== "bash" && (toolAllowlist?.includes(tool.name) || isWorkpoolYieldTool(tool))), createCuratedReadonlyBashTool(spec.cwd)]
    : [...mergedCustomTools, ...kernelTools]
  const settingsManager = createRuntimeFallbackSettings(spec.selectedModel, spec.fallbackModels, spec.retry)
  return {
    cwd: spec.cwd,
    sessionManager,
    resourceLoader: createChildResourceLoader(
      spec.systemPrompt === undefined ? {} : { systemPrompt: spec.systemPrompt },
    ),
    customTools,
    ...(spec.agentDir !== undefined && { agentDir: spec.agentDir }),
    ...(spec.authStorage !== undefined && { authStorage: spec.authStorage }),
    ...(spec.modelRegistry !== undefined && { modelRegistry: spec.modelRegistry }),
    ...(spec.modelRuntime !== undefined && { modelRuntime: spec.modelRuntime }),
    ...(spec.model !== undefined && { model: spec.model }),
    ...(spec.thinkingLevel !== undefined && { thinkingLevel: spec.thinkingLevel }),
    settingsManager,
    ...(toolAllowlist !== undefined && { tools: [...toolAllowlist, ...mergedCustomTools.filter(isWorkpoolYieldTool).map(tool => tool.name), ...kernelTools.map(tool => tool.name)] }),
    ...(spec.toolDenylist !== undefined && { excludeTools: [...spec.toolDenylist] }),
  }
}
