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
  ["team_create", createTeamCreateTool, "team"],
  ["team_delete", createTeamDeleteTool, "team"],
]

// The four task_* tasklist tools joined the eval-only task family (Q 2026-11-09).
const EVAL_ONLY: ReadonlyArray<readonly [string, ToolFactory]> = [
  ["task_create", createTeamTaskCreateTool],
  ["task_list", createTeamTaskListTool],
  ["task_get", createTeamTaskGetTool],
  ["task_update", createTeamTaskUpdateTool],
]

describe("team tasklist tools are eval-only", () => {
  for (const [name, create] of EVAL_ONLY) {
    it(`#given the tasklist factory #when ${name} is built #then it is eval-exposed without search metadata`, () => {
      const tool = create({ service: {} } as never)
      expect(tool.name).toBe(name)
      expect(tool.exposure).toBe("eval")
      expect(tool.searchGroup).toBeUndefined()
      expect(tool.searchKeywords).toBeUndefined()
      expect(tool.description.length).toBeGreaterThan(0)
    })
  }
})

describe("team lifecycle tools defer to tool_search", () => {
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
