import { afterEach, describe, expect, test } from "bun:test"

import { baseSpec, cleanupProjects, makeManager } from "../../manager/__fixtures__/manager-fakes"
import { runTaskInterrupt } from "./interrupt"

afterEach(cleanupProjects)

describe("runTaskInterrupt", () => {
  test("#given a running child #when interrupted #then previous_status running is reported", async () => {
    // given
    const { manager } = makeManager({})
    const started = await manager.start(baseSpec({ parent_session_id: "p1" }))
    if (started.kind !== "started") throw new Error("expected started")

    // when
    const result = await runTaskInterrupt(manager, { task_id: started.task_id })

    // then
    expect(result.details.kind).toBe("interrupted")
    if (result.details.kind !== "interrupted") throw new Error("expected interrupted")
    expect(result.details.previous_status).toBe("running")
  })

  test("#given an already-terminal child #when interrupted again #then it is an idempotent no-op with the unchanged status", async () => {
    // given
    const { manager } = makeManager({})
    const started = await manager.start(baseSpec({ parent_session_id: "p1" }))
    if (started.kind !== "started") throw new Error("expected started")
    await runTaskInterrupt(manager, { task_id: started.task_id })

    // when
    const result = await runTaskInterrupt(manager, { task_id: started.task_id })

    // then
    expect(result.details.kind).toBe("noop")
    if (result.details.kind !== "noop") throw new Error("expected noop")
    expect(result.details.previous_status).toBe("interrupted")
  })

  test("#given an unknown id #when interrupted #then not_found is returned", async () => {
    // given
    const { manager } = makeManager({})

    // when
    const result = await runTaskInterrupt(manager, { task_id: "st_deadbeef" })

    // then
    expect(result.details.kind).toBe("not_found")
  })

  test("#given no identifier #when interrupted #then invalid_arguments is returned", async () => {
    // given
    const { manager } = makeManager({})

    // when
    const result = await runTaskInterrupt(manager, {})

    // then
    expect(result.details.kind).toBe("invalid_arguments")
  })
})
