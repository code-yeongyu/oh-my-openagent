import { afterEach, describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { cleanupProjects, makeManager } from "../../manager/__fixtures__/manager-fakes"
import type { TaskManager } from "../../manager"
import { buildTaskExecute } from "./execute"
import type { TaskToolContext, TaskToolDeps } from "./types"

const OMO_CONFIG: OmoConfig = { categories: {}, agents: {} }

function ctxFor(sessionId: string): TaskToolContext {
  return { cwd: "/work/project", sessionManager: { getSessionId: () => sessionId } }
}

function deps(manager: TaskManager): TaskToolDeps {
  return { manager, omoConfig: OMO_CONFIG, agents: {}, loadSkills: () => ({ prepend: "", resolved: [], missing: [] }) }
}

afterEach(() => {
  cleanupProjects()
})

describe("task tool spawn-only manager seam", () => {
  test("#given a real manager #when the task tool executes in two sessions #then both calls spawn children", async () => {
    const { manager, inProcess } = makeManager()
    const execute = buildTaskExecute(deps(manager))

    const first = await execute(
      "spawn-A",
      { prompt: "own work", category: "quick", run_in_background: true },
      undefined,
      undefined,
      ctxFor("session-A"),
    )
    const second = await execute(
      "spawn-B",
      { prompt: "more work", category: "quick", run_in_background: true },
      undefined,
      undefined,
      ctxFor("session-B"),
    )

    expect(first.details.mode).toBe("spawn")
    expect(second.details.mode).toBe("spawn")
    expect(first.details.task_id).not.toBe(second.details.task_id)
    expect(inProcess.handles.get(first.details.task_id)?.followUpCalls ?? []).toEqual([])
    expect(inProcess.handles.get(second.details.task_id)?.followUpCalls ?? []).toEqual([])
  })
})
