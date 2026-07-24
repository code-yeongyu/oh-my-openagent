import { afterEach, describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { cleanupProjects, makeManager } from "../../manager/__fixtures__/manager-fakes"
import type { ChildPlanner, TaskManager } from "../../manager"
import { buildTaskExecute } from "./execute"
import type { TaskToolContext, TaskToolDeps } from "./types"

const OMO_CONFIG: OmoConfig = { categories: {}, agents: {} }

const CTX: TaskToolContext = {
  cwd: "/work/project",
  sessionManager: { getSessionId: () => "parent-session-1" },
}

function deps(manager: TaskManager): TaskToolDeps {
  return {
    manager,
    omoConfig: OMO_CONFIG,
    agents: {},
    resolveAncestry: (sessionId) => ({ depth: 0, rootSessionId: sessionId, lineage: "known", callerRole: "coordinator" }),
    loadSkills: () => ({ prepend: "", resolved: [], missing: [] }),
  }
}

afterEach(() => {
  cleanupProjects()
})

describe("task tool over the real TaskManager", () => {
  test("#given a background spawn #when driven end to end #then the engine start API persists a running record and returns its st_ id", async () => {
    // given the real manager + real store (no raw store writes from the tool layer)
    const { manager, store, inProcess } = makeManager()
    const execute = buildTaskExecute(deps(manager))

    // when
    const result = await execute(
      "call-1",
      { prompt: "explore", category: "quick", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then the tool drove manager.start with the caller session, and the record landed in the store
    const taskId = result.details.task_id
    expect(taskId.startsWith("st_")).toBe(true)
    expect(inProcess.startedSpecs[0]?.parentSessionId).toBe("parent-session-1")
    expect(inProcess.startedSpecs[0]?.prompt).toBe("explore")
    const record = store.load(taskId)
    expect(record).not.toBeNull()
    if (record === null) throw new Error("expected a persisted record")
    expect(record.status).toBe("running")
    expect(record.category).toBe("quick")
  })

  test("#given both targets #when driven #then the engine start API is never reached", async () => {
    // given
    const { manager, inProcess } = makeManager()
    const execute = buildTaskExecute(deps(manager))

    // when
    const result = await execute(
      "call-2",
      { prompt: "p", category: "quick", subagent_type: "oracle" },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(result.details.status).toBe("invalid_arguments")
    expect(inProcess.startedSpecs).toHaveLength(0)
  })

  test("#given an unknown category #when the planner rejects it #then the tool reports the available categories", async () => {
    // given a planner that rejects the target with the available list
    const planner: ChildPlanner = () => ({
      kind: "error",
      error: { code: "unknown_target", message: 'Category "ghost" not found', availableCategories: ["quick", "deep"] },
    })
    const { manager } = makeManager({ planner })
    const execute = buildTaskExecute(deps(manager))

    // when
    const result = await execute("call-3", { prompt: "p", category: "ghost" }, undefined, undefined, CTX)

    // then
    expect(result.details.status).toBe("plan_error")
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("quick")
    expect(text).toContain("deep")
  })
})
