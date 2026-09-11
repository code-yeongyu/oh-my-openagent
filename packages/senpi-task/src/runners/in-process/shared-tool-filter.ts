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

// Only `name` and `exposure` are read, and every tool is passed through unchanged, so the element
// type stays generic: a fully-typed ToolDefinition (whose renderCall pins its own arg type) is
// invariant against the bare ToolDefinition element type and would not fit a widened parameter.
export function filterSharedParentTools<TTool extends Pick<ToolDefinition, "name" | "exposure">>(
  tools: readonly TTool[],
  options: SharedToolFilterOptions = {},
): TTool[] {
  const uiOnly = new Set(options.uiOnlyToolNames ?? [])
  return tools
    .filter((tool) => !isTaskOrTeamFamilyTool(tool.name) && !uiOnly.has(tool.name))
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
