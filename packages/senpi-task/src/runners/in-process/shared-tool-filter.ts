import type { ToolDefinition } from "@code-yeongyu/senpi"

// The shared-MCP-client mechanism: sharedParentTools are the parent extension's own
// registered ToolDefinitions (same process, same execute closures, same client instances).
// The task/team tool family and the lead-only `workflow` orchestrator are excluded so a child cannot
// spawn or coordinate its own graph; memberScopedTools (merged afterwards) are the ONLY sanctioned
// bypass. This predicate matches on the REGISTERED TOOL NAME, so it must track any rename of that
// tool - it was `dag` before the workflow rename.

// Children have no tool_search builtin; thread_* tools are intentionally excluded.
export const CHILD_DIRECT_EXPOSURE_TOOL_NAMES: ReadonlySet<string> = new Set(["x_search"])

export type SharedToolFilterOptions = {
  readonly uiOnlyToolNames?: Iterable<string>
}

export function isTaskOrTeamFamilyTool(name: string): boolean {
  return name === "workflow" || name === "task" || name.startsWith("task_") || name.startsWith("team_")
}

export function filterSharedParentTools(
  tools: readonly ToolDefinition[],
  options: SharedToolFilterOptions = {},
): ToolDefinition[] {
  const uiOnly = new Set(options.uiOnlyToolNames ?? [])
  return tools
    .filter((tool) => !isTaskOrTeamFamilyTool(tool.name) && !uiOnly.has(tool.name))
    .map((tool) =>
      CHILD_DIRECT_EXPOSURE_TOOL_NAMES.has(tool.name) && tool.exposure === "search"
        ? { ...tool, exposure: "direct" }
        : tool,
    )
}

export function mergeChildCustomTools(
  sharedParentTools: readonly ToolDefinition[],
  memberScopedTools: readonly ToolDefinition[] | undefined,
  options: SharedToolFilterOptions = {},
): ToolDefinition[] {
  return [...filterSharedParentTools(sharedParentTools, options), ...(memberScopedTools ?? [])]
}
