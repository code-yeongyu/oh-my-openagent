import type { ToolDefinition } from "@code-yeongyu/senpi"

// The shared-MCP-client mechanism: sharedParentTools are the parent extension's own
// registered ToolDefinitions (same process, same execute closures, same client instances).
// Team tools and the lead-only `workflow` orchestrator stay excluded. Task/workpool tools remain
// available, matching process children and relying on the existing depth and allow/deny policy.

export const CHILD_DIRECT_EXPOSURE_TOOL_NAMES: ReadonlySet<string> = new Set(["x_search"])

export type SharedToolFilterOptions = {
  readonly uiOnlyToolNames?: Iterable<string>
  // Ordinary task children match process mode. DAG/workpool/member policies leave this false so
  // nested orchestration tools remain unavailable unless explicitly member-scoped.
  readonly includeTaskTools?: boolean
}

export function isTaskOrTeamFamilyTool(name: string): boolean {
  return name === "workpool" || name.startsWith("workpool_") || name === "workflow" || name === "task" || name.startsWith("task_") || name.startsWith("team_")
}

export function isChildOrchestrationExcluded(name: string, includeTaskTools = false): boolean {
  if (name === "workflow" || name.startsWith("team_")) return true
  return !includeTaskTools && (name === "workpool" || name.startsWith("workpool_") || name === "task" || name.startsWith("task_"))
}

/**
 * The names a child ends up with before its OWN allow/deny applies: the shared parent tools minus
 * the task/team family and the UI-only names. The kernel-tool grant needs this set at the TOOL
 * layer - before any child session exists - to refuse a colliding name and to decide the
 * nested-host-scope rule (kernel-tools/nested-host-scope.ts).
 */
export function childVisibleToolNames(
  names: readonly string[],
  uiOnlyToolNames: Iterable<string> = [],
): string[] {
  const uiOnly = new Set(uiOnlyToolNames)
  return names.filter((name) => !isChildOrchestrationExcluded(name, false) && !uiOnly.has(name))
}

// Only `name` and `exposure` are read, and every tool is passed through unchanged, so the element
// type stays generic: a fully-typed ToolDefinition (whose renderCall pins its own arg type) is
// invariant against the bare ToolDefinition element type and would not fit a widened parameter.
export function filterSharedParentTools<TTool extends Pick<ToolDefinition, "name" | "exposure">>(
  tools: readonly TTool[],
  options: SharedToolFilterOptions = {},
): TTool[] {
  const uiOnly = new Set(options.uiOnlyToolNames ?? [])
  return tools
    .filter((tool) => !isChildOrchestrationExcluded(tool.name, options.includeTaskTools === true) && !uiOnly.has(tool.name))
    .map((tool) =>
      CHILD_DIRECT_EXPOSURE_TOOL_NAMES.has(tool.name) && tool.exposure === "search"
        ? { ...tool, exposure: "direct" }
        : tool,
    )
}

export function mergeChildCustomTools<
  TShared extends Pick<ToolDefinition, "name" | "exposure">,
  TMember extends Pick<ToolDefinition, "name" | "exposure">,
>(
  sharedParentTools: readonly TShared[],
  memberScopedTools: readonly TMember[] | undefined,
  options: SharedToolFilterOptions = {},
): (TShared | TMember)[] {
  return [...filterSharedParentTools(sharedParentTools, options), ...(memberScopedTools ?? [])]
}
