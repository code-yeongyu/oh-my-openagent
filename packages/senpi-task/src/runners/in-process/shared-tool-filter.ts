import type { ToolDefinition } from "@code-yeongyu/senpi"

// The shared-MCP-client mechanism: sharedParentTools are the parent extension's own
// registered ToolDefinitions (same process, same execute closures, same client instances).
// The task/team tool family and the lead-only `workflow` orchestrator are excluded so a child cannot
// spawn or coordinate its own graph; memberScopedTools (merged afterwards) are the ONLY sanctioned
// bypass. This predicate matches on the REGISTERED TOOL NAME, so it must track any rename of that
// tool - it was `dag` before the workflow rename.

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
  return tools.filter((tool) => !isTaskOrTeamFamilyTool(tool.name) && !uiOnly.has(tool.name))
}

export function mergeChildCustomTools(
  sharedParentTools: readonly ToolDefinition[],
  memberScopedTools: readonly ToolDefinition[] | undefined,
  options: SharedToolFilterOptions = {},
): ToolDefinition[] {
  return [...filterSharedParentTools(sharedParentTools, options), ...(memberScopedTools ?? [])]
}
