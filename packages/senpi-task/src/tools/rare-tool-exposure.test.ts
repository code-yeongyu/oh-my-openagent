import { describe, expect, it } from "bun:test"
import type { ToolDefinition } from "@code-yeongyu/senpi"

import { createTaskCancelTool } from "./control/cancel"
import { createMemberScopedTaskSendTool, createTaskSendTool } from "./control/send"
import { createTaskOutputTool } from "./output/output"
import { createMemberTaskSendTool } from "../team/member-extension/tools"
import { createTaskTool } from "./task/tool"
import { createWorkpoolTool, createWorkpoolWorkerTool } from "./workpool"

type Exposure = Pick<ToolDefinition, "name" | "exposure" | "allowLazyActivation" | "searchKeywords">

// The task family is eval-only (Q 2026-11-09): hidden from the direct tool list while an eval tool
// exists, called as tool.<name>() in a cell, direct otherwise. No search metadata: the tool_search
// catalog indexes only search-exposed tools.
const EVAL_ONLY: ReadonlyArray<readonly [string, string, () => Exposure]> = [
  ["task", "task", () => createTaskTool({ omoConfig: {}, agents: {} } as never)],
  ["task_send", "task_send", () => createTaskSendTool({} as never)],
  ["task_output", "task_output", () => createTaskOutputTool({} as never)],
  ["task_cancel", "task_cancel", () => createTaskCancelTool({} as never)],
  ["member-scoped task_send", "task_send", () => createMemberScopedTaskSendTool({} as never)],
  ["team-member task_send", "task_send", () => createMemberTaskSendTool({} as never)],
]

describe("the task family is eval-only", () => {
  for (const [label, name, create] of EVAL_ONLY) {
    it(`#given the ${label} factory #when it is built #then it is eval-exposed and carries no search metadata`, () => {
      const tool = create()
      expect(tool.name).toBe(name)
      expect(tool.exposure).toBe("eval")
      expect(tool.searchKeywords).toBeUndefined()
    })
  }
})

// #11454: a tool used in under 10% of sessions defers to tool_search; the worker's yield tool must stay direct.
describe("rarely used tools outside the task family defer to tool_search", () => {
  it("#given the workpool factory #when it is built #then it is search-exposed and lazily activatable", () => {
    const tool = createWorkpoolTool({ workpools: { setSpawnPolicy: () => undefined } } as never)
    expect(tool.name).toBe("workpool")
    expect(tool.exposure).toBe("search")
    expect(tool.allowLazyActivation).toBe(true)
    expect(tool.searchKeywords?.length ?? 0).toBeGreaterThan(0)
  })

  it("#given a workpool worker #when its yield tool is built #then it stays directly exposed", () => {
    const tool = createWorkpoolWorkerTool({ workpools: {} as never, taskId: "t", runEpoch: () => 0 })
    expect(tool.name).toBe("workpool")
    expect(tool.exposure).toBeUndefined()
  })
})
