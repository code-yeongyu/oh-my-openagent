import { afterEach, describe, expect, test } from "bun:test"

import { baseSpec, cleanupProjects, makeManager } from "../../manager/__fixtures__/manager-fakes"
import { runTaskCancel } from "./cancel"

afterEach(cleanupProjects)

describe("runTaskCancel", () => {
  test("#given a running child #when cancelled with a reason #then the exact post-state is reported", async () => {
    // given
    const { manager } = makeManager({})
    const started = await manager.start(baseSpec({ parent_session_id: "p1" }))
    if (started.kind !== "started") throw new Error("expected started")

    // when
    const result = await runTaskCancel(manager, { task_id: started.task_id, reason: "no longer needed" })

    // then
    expect(result.details.kind).toBe("cancelled")
    if (result.details.kind !== "cancelled") throw new Error("expected cancelled")
    expect(result.details.previous_status).toBe("running")
    expect(result.details.status).toBe("cancelled")
    expect(manager.get(started.task_id)?.status).toBe("cancelled")
  })

  test("#given an already-cancelled child #when cancelled again #then it is a no-op with the cancelled status", async () => {
    // given
    const { manager } = makeManager({})
    const started = await manager.start(baseSpec({ parent_session_id: "p1" }))
    if (started.kind !== "started") throw new Error("expected started")
    await runTaskCancel(manager, { task_id: started.task_id })

    // when
    const result = await runTaskCancel(manager, { task_id: started.task_id })

    // then
    expect(result.details.kind).toBe("noop")
    if (result.details.kind !== "noop") throw new Error("expected noop")
    expect(result.details.status).toBe("cancelled")
  })

  test("#given an unknown id #when cancelled #then not_found is returned", async () => {
    // given
    const { manager } = makeManager({})

    // when
    const result = await runTaskCancel(manager, { task_id: "st_deadbeef" })

    // then
    expect(result.details.kind).toBe("not_found")
  })

  test("#given no identifier #when cancelled #then invalid_arguments is returned", async () => {
    // given
    const { manager } = makeManager({})

    // when
    const result = await runTaskCancel(manager, {})

    // then
    expect(result.details.kind).toBe("invalid_arguments")
  })
})
