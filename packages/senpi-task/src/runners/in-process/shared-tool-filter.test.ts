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
    // given / when / then
    expect(isTaskOrTeamFamilyTool("task")).toBe(true)
    expect(isTaskOrTeamFamilyTool("task_create")).toBe(true)
    expect(isTaskOrTeamFamilyTool("team_send_message")).toBe(true)
    expect(isTaskOrTeamFamilyTool("grep")).toBe(false)
    expect(isTaskOrTeamFamilyTool("taskmaster")).toBe(false)
  })

  test("#given shared tools with family and ui-only entries #when filtered #then family and ui-only removed", () => {
    // given
    const shared = [makeTool("grep"), makeTool("task_create"), makeTool("team_status"), makeTool("render_widget")]

    // when
    const filtered = filterSharedParentTools(shared, { uiOnlyToolNames: ["render_widget"] })

    // then
    expect(filtered.map((tool) => tool.name)).toEqual(["grep"])
  })

  test("#given family tool in shared and in member-scoped #when merged #then only member-scoped family crosses the exclusion", () => {
    // given
    const shared = [makeTool("grep"), makeTool("task")]
    const memberScoped = [makeTool("team_send_message")]

    // when
    const merged = mergeChildCustomTools(shared, memberScoped)

    // then
    expect(merged.map((tool) => tool.name)).toEqual(["grep", "team_send_message"])
    for (const tool of merged) {
      expect(typeof tool.execute).toBe("function")
    }
  })

  test("#given no member-scoped tools #when merged #then result is only the filtered shared set", () => {
    // given
    const shared = [makeTool("glob"), makeTool("task_update")]

    // when
    const merged = mergeChildCustomTools(shared, undefined)

    // then
    expect(merged.map((tool) => tool.name)).toEqual(["glob"])
  })
})
