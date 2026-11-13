import { describe, expect, it } from "bun:test"
import type { ToolDefinition } from "@code-yeongyu/senpi"

import { createTaskCancelTool } from "./control/cancel"
import { createWorkpoolTool, createWorkpoolWorkerTool } from "./workpool"

type Exposure = Pick<ToolDefinition, "name" | "exposure" | "allowLazyActivation" | "searchKeywords">

// #11454: tools used in under 10% of sessions defer to tool_search; the worker's yield tool must stay direct.
const DEFERRED: ReadonlyArray<readonly [string, () => Exposure]> = [
  ["task_cancel", () => createTaskCancelTool({} as never)],
  ["workpool", () => createWorkpoolTool({ workpools: { setSpawnPolicy: () => undefined } } as never)],
]

describe("rarely used task tools defer to tool_search", () => {
  for (const [name, create] of DEFERRED) {
    it(`#given the ${name} factory #when it is built #then it is search-exposed and lazily activatable`, () => {
      const tool = create()
      expect(tool.name).toBe(name)
      expect(tool.exposure).toBe("search")
      expect(tool.allowLazyActivation).toBe(true)
      expect(tool.searchKeywords?.length ?? 0).toBeGreaterThan(0)
    })
  }

  it("#given a workpool worker #when its yield tool is built #then it stays directly exposed", () => {
    const tool = createWorkpoolWorkerTool({ workpools: {} as never, taskId: "t", runEpoch: () => 0 })
    expect(tool.name).toBe("workpool")
    expect(tool.exposure).toBeUndefined()
  })
})
