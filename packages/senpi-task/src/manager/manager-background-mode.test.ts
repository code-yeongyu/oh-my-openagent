import { afterEach, describe, expect, test } from "bun:test"

import { baseSpec, cleanupProjects, makeManager } from "./__fixtures__/manager-fakes"

afterEach(() => {
  cleanupProjects()
})

describe("manager background_mode persistence", () => {
  test("#given a foreground task promoted to background #when promoteToBackground runs #then background_mode becomes \"promoted\" and notify_on_terminal stays true", async () => {
    // given
    const { manager, store } = makeManager()
    const started = await manager.start(baseSpec({ run_in_background: false }))
    if (started.kind !== "started") throw new Error("expected started")
    expect(store.load(started.task_id)?.background_mode).toBe("foreground")

    // when
    manager.promoteToBackground(started.task_id)

    // then
    const promoted = store.load(started.task_id)
    expect(promoted?.background_mode).toBe("promoted")
    expect(promoted?.notify_on_terminal).toBe(true)
  })

  test("#given a background spawn #when promoteToBackground runs #then background_mode stays \"background\"", async () => {
    // given
    const { manager, store } = makeManager()
    const started = await manager.start(baseSpec({ run_in_background: true }))
    if (started.kind !== "started") throw new Error("expected started")

    // when
    manager.promoteToBackground(started.task_id)

    // then
    expect(store.load(started.task_id)?.background_mode).toBe("background")
  })

  test("#given two spawns in one parent session #when both are started #then their task_seq ordinals count from zero in spawn order", async () => {
    // given
    const { manager, store } = makeManager()

    // when
    const first = await manager.start(baseSpec({ name: "first" }))
    const second = await manager.start(baseSpec({ name: "second" }))
    const otherSession = await manager.start(baseSpec({ parent_session_id: "parent-2", name: "other" }))
    if (first.kind !== "started" || second.kind !== "started" || otherSession.kind !== "started") {
      throw new Error("expected started")
    }

    // then
    expect(store.load(first.task_id)?.task_seq).toBe(0)
    expect(store.load(second.task_id)?.task_seq).toBe(1)
    expect(store.load(otherSession.task_id)?.task_seq).toBe(0)
  })
})
