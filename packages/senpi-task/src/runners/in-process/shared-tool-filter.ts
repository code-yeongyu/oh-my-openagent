import type { ToolDefinition } from "@code-yeongyu/senpi"

// The shared-MCP-client mechanism: sharedParentTools are the parent extension's own
// registered ToolDefinitions (same process, same execute closures, same client instances).
// The task/team tool family is excluded so a child cannot spawn or coordinate its own
// task/team graph; memberScopedTools (merged afterwards) are the ONLY sanctioned bypass.

export type SharedToolFilterOptions = {
  readonly uiOnlyToolNames?: Iterable<string>
}

export function isTaskOrTeamFamilyTool(name: string): boolean {
  return name === "task" || name.startsWith("task_") || name.startsWith("team_")
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
