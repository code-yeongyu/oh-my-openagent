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

describe("task tool continuation scope guard (W1-V seam obligation #1)", () => {
  test("#given a task owned by session A #when session B continues it #then the send is scope_denied and never delivered", async () => {
    // given a running task spawned by session A over the real manager + steering
    const { manager, inProcess } = makeManager()
    const spawnExecute = buildTaskExecute(deps(manager))
    const spawn = await spawnExecute(
      "spawn-A",
      { prompt: "own work", category: "quick", run_in_background: true },
      undefined,
      undefined,
      ctxFor("session-A"),
    )
    const taskId = spawn.details.task_id
    expect(taskId.startsWith("st_")).toBe(true)

    // when session B tries to continue session A's task
    const result = await buildTaskExecute(deps(manager))(
      "continue-B",
      { prompt: "leak into A", task_id: taskId, run_in_background: true },
      undefined,
      undefined,
      ctxFor("session-B"),
    )

    // then the cross-session steer is refused, not delivered into session A's child
    expect(result.details.status).toBe("scope_denied")
    expect(inProcess.handles.get(taskId)?.followUpCalls ?? []).toEqual([])
    expect(inProcess.handles.get(taskId)?.steerCalls ?? []).toEqual([])
  })

  test("#given a task owned by session A #when session A itself continues it #then the send is delivered as a follow-up", async () => {
    // given a running task spawned by session A
    const { manager, inProcess } = makeManager()
    const execute = buildTaskExecute(deps(manager))
    const spawn = await execute(
      "spawn-A2",
      { prompt: "own work", category: "quick", run_in_background: true },
      undefined,
      undefined,
      ctxFor("session-A"),
    )
    const taskId = spawn.details.task_id

    // when the owning session continues its own task
    const result = await execute(
      "continue-A2",
      { prompt: "keep going", task_id: taskId, run_in_background: true },
      undefined,
      undefined,
      ctxFor("session-A"),
    )

    // then the follow-up lands on the child and the scope guard permits it
    expect(result.details.status).not.toBe("scope_denied")
    expect(inProcess.handles.get(taskId)?.followUpCalls ?? []).toEqual(["keep going"])
  })
})
