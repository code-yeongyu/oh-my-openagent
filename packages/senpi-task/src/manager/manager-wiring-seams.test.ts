import { afterEach, describe, expect, test } from "bun:test"

import { baseSpec, cleanupProjects, flush, makeManager } from "./__fixtures__/manager-fakes"
import type { SpawnAdmission } from "./types"

afterEach(() => {
  cleanupProjects()
})

describe("manager wiring seams (W1-V F3/F7)", () => {
  test("#given a launched task #when forget is called #then the live handle is pruned", async () => {
    // given
    const { manager } = makeManager()
    const started = await manager.start(baseSpec({ run_in_background: true }))
    if (started.kind !== "started") throw new Error("expected started")
    await flush()
    expect(manager.residentTaskIds()).toContain(started.task_id)
    expect(manager.getResidentHandle(started.task_id)).not.toBeUndefined()

    // when
    manager.forget(started.task_id)

    // then
    expect(manager.residentTaskIds()).not.toContain(started.task_id)
    expect(manager.getResidentHandle(started.task_id)).toBeUndefined()
  })

  test("#given a background spawn #when queried #then wasBackground reflects the spec", async () => {
    // given
    const { manager } = makeManager()
    const bg = await manager.start(baseSpec({ run_in_background: true, name: "bg" }))
    const sync = await manager.start(baseSpec({ run_in_background: false, name: "sync" }))
    if (bg.kind !== "started" || sync.kind !== "started") throw new Error("expected started")

    // then
    expect(manager.wasBackground(bg.task_id)).toBe(true)
    expect(manager.wasBackground(sync.task_id)).toBe(false)
  })

  test("#given an admit gate that rejects #when starting #then start returns residency_denied and never launches", async () => {
    // given
    const admit = (): Promise<SpawnAdmission> => Promise.resolve({ kind: "rejected", message: "cap reached" })
    const { manager, inProcess } = makeManager({ admit })

    // when
    const started = await manager.start(baseSpec({ run_in_background: true }))

    // then
    expect(started.kind).toBe("residency_denied")
    if (started.kind !== "residency_denied") throw new Error("expected residency_denied")
    expect(started.reason).toContain("cap reached")
    expect(inProcess.startedSpecs).toHaveLength(0)
  })

  test("#given an admit gate that evicts #when starting #then start proceeds", async () => {
    // given
    const evicted: string[] = []
    const admit = (): Promise<SpawnAdmission> => Promise.resolve({ kind: "evicted", evicted_task_id: "st_old" })
    const { manager, inProcess } = makeManager({ admit })

    // when
    const started = await manager.start(baseSpec({ run_in_background: true }))

    // then
    expect(started.kind).toBe("started")
    expect(inProcess.startedSpecs).toHaveLength(1)
    expect(evicted).toEqual([])
  })
})
