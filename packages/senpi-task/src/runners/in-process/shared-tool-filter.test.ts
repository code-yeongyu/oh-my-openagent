import { describe, expect, test } from "bun:test"

import { createReadToolDefinition, type ToolDefinition } from "@code-yeongyu/senpi"

import {
  filterSharedParentTools,
  isTaskOrTeamFamilyTool,
  mergeChildCustomTools,
} from "./shared-tool-filter"

const sampleParameters = createReadToolDefinition(process.cwd()).parameters

function makeTool(name: string): ToolDefinition {
  return {
    name,
    label: name,
    description: `test tool ${name}`,
    parameters: sampleParameters,
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
  }
}

describe("shared parent tool family filter", () => {
  test("#given task and team family names #when classified #then only family names match", () => {
    expect(isTaskOrTeamFamilyTool("task")).toBe(true)
    expect(isTaskOrTeamFamilyTool("task_create")).toBe(true)
    expect(isTaskOrTeamFamilyTool("task_send")).toBe(true)
    expect(isTaskOrTeamFamilyTool("team_create")).toBe(true)
    expect(isTaskOrTeamFamilyTool("grep")).toBe(false)
    expect(isTaskOrTeamFamilyTool("taskmaster")).toBe(false)
  })

  test("#given shared tools with family and ui-only entries #when filtered #then family and ui-only removed", () => {
    const shared = [makeTool("grep"), makeTool("task_create"), makeTool("team_create"), makeTool("render_widget")]

    const filtered = filterSharedParentTools(shared, { uiOnlyToolNames: ["render_widget"] })

    expect(filtered.map((tool) => tool.name)).toEqual(["grep"])
  })

  test("#given family tool in shared and in member-scoped #when merged #then only member-scoped family crosses the exclusion", () => {
    const shared = [makeTool("grep"), makeTool("task")]
    const memberScoped = [makeTool("task_send")]

    const merged = mergeChildCustomTools(shared, memberScoped)

    expect(merged.map((tool) => tool.name)).toEqual(["grep", "task_send"])
    for (const tool of merged) {
      expect(typeof tool.execute).toBe("function")
    }
  })

  test("#given no member-scoped tools #when merged #then result is only the filtered shared set", () => {
    const shared = [makeTool("glob"), makeTool("task_update")]

    const merged = mergeChildCustomTools(shared, undefined)

    expect(merged.map((tool) => tool.name)).toEqual(["glob"])
  })
})
