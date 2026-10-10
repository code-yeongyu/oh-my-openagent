import { describe, expect, it } from "bun:test"
import type { ToolDefinition } from "@code-yeongyu/senpi"

import {
  createTeamCreateTool,
  createTeamDeleteTool,
} from "./lifecycle"
import {
  createTeamTaskCreateTool,
  createTeamTaskGetTool,
  createTeamTaskListTool,
  createTeamTaskUpdateTool,
} from "./tasks"

type ToolFactory = (deps: never) => Pick<ToolDefinition, "name" | "exposure" | "allowLazyActivation" | "searchGroup" | "searchKeywords" | "description">

const CASES: ReadonlyArray<readonly [string, ToolFactory, string]> = [
  ["task_create", createTeamTaskCreateTool, "team-tasklist"],
  ["task_list", createTeamTaskListTool, "team-tasklist"],
  ["task_get", createTeamTaskGetTool, "team-tasklist"],
  ["task_update", createTeamTaskUpdateTool, "team-tasklist"],
  ["team_create", createTeamCreateTool, "team"],
  ["team_delete", createTeamDeleteTool, "team"],
]

describe("team tasklist tools defer to tool_search", () => {
  for (const [name, create, group] of CASES) {
    it(`#given the tasklist factory #when ${name} is built #then it is search-exposed and lazily activatable`, () => {
      const tool = create({ service: {} } as never)
      expect(tool.name).toBe(name)
      expect(tool.exposure).toBe("search")
      expect(tool.allowLazyActivation).toBe(true)
      expect(tool.searchGroup).toBe(group)
      expect(tool.searchKeywords?.length ?? 0).toBeGreaterThan(0)
      expect(tool.description.length).toBeGreaterThan(0)
    })
  }
})
