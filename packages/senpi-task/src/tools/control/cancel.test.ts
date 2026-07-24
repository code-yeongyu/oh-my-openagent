import { afterEach, describe, expect, test } from "bun:test"

import { baseSpec, cleanupProjects, makeManager } from "../../manager/__fixtures__/manager-fakes"
import { createTaskCancelTool, runTaskCancel } from "./cancel"
import { runTaskSend } from "./send"

afterEach(cleanupProjects)

describe("runTaskCancel", () => {
  test("#given the task_cancel tool #when created #then it exposes custom call and result renderers", () => {
    const { manager } = makeManager({})

    const tool = createTaskCancelTool({ manager })

    expect(typeof tool.renderCall).toBe("function")
    expect(typeof tool.renderResult).toBe("function")
  })

  test("#given a running child #when cancelled with a reason #then the exact post-state is reported", async () => {
    const { manager } = makeManager({})
    const started = await manager.start(baseSpec({ parent_session_id: "p1" }))
    if (started.kind !== "started") throw new Error("expected started")

    const result = await runTaskCancel(manager, { task_id: started.task_id, reason: "no longer needed" }, "p1")

    expect(result.details.kind).toBe("cancelled")
    if (result.details.kind !== "cancelled") throw new Error("expected cancelled")
    expect(result.details.previous_status).toBe("running")
    expect(result.details.status).toBe("cancelled")
    expect(manager.get(started.task_id)?.status).toBe("cancelled")
  })

  test("#given a cancelled child #when task_send follows up #then the child is not continuable", async () => {
    const { manager } = makeManager({})
    const started = await manager.start(baseSpec({ parent_session_id: "p1" }))
    if (started.kind !== "started") throw new Error("expected started")
    const cancelled = await runTaskCancel(manager, { task_id: started.task_id }, "p1")
    expect(cancelled.details.kind).toBe("cancelled")

    const result = await runTaskSend(manager, { to: started.task_id, message: "continue anyway" }, "p1")

    expect(result.details.kind).toBe("not_continuable")
    if (result.details.kind !== "not_continuable") throw new Error("expected not_continuable")
    expect(manager.get(started.task_id)?.status).toBe("cancelled")
  })

  test("#given an already-cancelled child #when cancelled again #then it is a no-op with the cancelled status", async () => {
    const { manager } = makeManager({})
    const started = await manager.start(baseSpec({ parent_session_id: "p1" }))
    if (started.kind !== "started") throw new Error("expected started")
    await runTaskCancel(manager, { task_id: started.task_id }, "p1")

    const result = await runTaskCancel(manager, { task_id: started.task_id }, "p1")

    expect(result.details.kind).toBe("noop")
    if (result.details.kind !== "noop") throw new Error("expected noop")
    expect(result.details.status).toBe("cancelled")
  })

  test("#given an unknown id #when cancelled #then not_found is returned", async () => {
    const { manager } = makeManager({})

    const result = await runTaskCancel(manager, { task_id: "st_deadbeef" })

    expect(result.details.kind).toBe("not_found")
  })

  test.each([undefined, "root-only", "foreign"])(
    "#given caller %s #when cancelling another session child #then denial occurs before mutation",
    async (callerSessionId) => {
      // given
      const { manager, inProcess } = makeManager({})
      const started = await manager.start(baseSpec({ parent_session_id: "p1", root_session_id: "root-only" }))
      if (started.kind !== "started") throw new Error("expected started")
      const handle = inProcess.handles.get(started.task_id)

      // when
      const result = await runTaskCancel(manager, { task_id: started.task_id }, callerSessionId)

      // then
      expect(result.details.kind).toBe("scope_denied")
      expect(manager.get(started.task_id)?.status).toBe("running")
      expect(handle).toBeDefined()
    },
  )

  test("#given no identifier #when cancelled #then invalid_arguments is returned", async () => {
    const { manager } = makeManager({})

    const result = await runTaskCancel(manager, {})

    expect(result.details.kind).toBe("invalid_arguments")
  })

  test("#given the task_cancel tool #when reading its description #then it names the terminal contract without stale revive wording", () => {
    const { manager } = makeManager({})

    const description = createTaskCancelTool({ manager }).description

    expect(description).toContain("NOT resumable")
    expect(description).not.toContain("task_interrupt")
    expect(description).not.toMatch(/revive/i)
  })
})
