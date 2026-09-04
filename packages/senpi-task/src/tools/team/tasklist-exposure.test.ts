import { describe, expect, it } from "bun:test"
import type { ToolDefinition } from "@code-yeongyu/senpi"

import {
  createTeamTaskCreateTool,
  createTeamTaskGetTool,
  createTeamTaskListTool,
  createTeamTaskUpdateTool,
} from "./tasks"

type ToolFactory = (deps: never) => ToolDefinition

const CASES: ReadonlyArray<readonly [string, ToolFactory]> = [
  ["task_create", createTeamTaskCreateTool],
  ["task_list", createTeamTaskListTool],
  ["task_get", createTeamTaskGetTool],
  ["task_update", createTeamTaskUpdateTool],
]

describe("team tasklist tools defer to tool_search", () => {
  for (const [name, create] of CASES) {
    it(`#given the tasklist factory #when ${name} is built #then it is search-exposed and lazily activatable`, () => {
      const tool = create({ service: {} } as never)
      expect(tool.name).toBe(name)
      expect(tool.exposure).toBe("search")
      expect(tool.allowLazyActivation).toBe(true)
      expect(tool.searchGroup).toBe("team-tasklist")
      expect(tool.searchKeywords?.length ?? 0).toBeGreaterThan(0)
      expect(tool.description).toMatch(/for when the user|for when/)
    })
  }
})
