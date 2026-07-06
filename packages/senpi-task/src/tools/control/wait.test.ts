import { afterEach, describe, expect, test } from "bun:test"

import { baseSpec, cleanupProjects, flush, makeManager, settings } from "../../manager/__fixtures__/manager-fakes"
import type { ScheduleTimeout, WaitTimer } from "./types"
import { runTaskWait } from "./wait"

afterEach(cleanupProjects)

const WAIT = settings({}).wait

const neverFire: ScheduleTimeout = () => ({ fired: new Promise<void>(() => {}), cancel: () => {} })

function controllableTimer(): { schedule: ScheduleTimeout; fire: () => void; cancelled: () => boolean } {
  let fire: () => void = () => {}
  let cancelled = false
  const timer: WaitTimer = {
    fired: new Promise<void>((resolve) => {
      fire = resolve
    }),
    cancel: () => {
      cancelled = true
    },
  }
  return { schedule: () => timer, fire, cancelled: () => cancelled }
}

describe("runTaskWait", () => {
  test("#given two running children #when the first completes #then wait returns it while the other still runs", async () => {
    // given
    const { manager, inProcess } = makeManager({})
    const a = await manager.start(baseSpec({ parent_session_id: "p1", name: "a" }))
    const b = await manager.start(baseSpec({ parent_session_id: "p1", name: "b" }))
    if (a.kind !== "started" || b.kind !== "started") throw new Error("expected started")

    // when the first child completes while the wait is in flight
    const pending = runTaskWait(manager, { targets: [a.task_id, b.task_id] }, "p1", WAIT, neverFire)
    inProcess.handles.get(a.task_id)?.settle({ status: "completed", finalResponse: "result A" })
    const result = await pending

    // then
    expect(result.details.timed_out).toBe(false)
    expect(result.details.completed).toHaveLength(1)
    expect(result.details.completed[0]?.task_id).toBe(a.task_id)
    expect(result.details.completed[0]?.final_response_head).toBe("result A")
    expect(result.details.still_running).toHaveLength(1)
    expect(result.details.still_running[0]?.task_id).toBe(b.task_id)
  })

  test("#given running children that never finish #when the deadline elapses #then wait reports timed_out with all still running", async () => {
    // given
    const { manager } = makeManager({})
    const a = await manager.start(baseSpec({ parent_session_id: "p1", name: "a" }))
    const b = await manager.start(baseSpec({ parent_session_id: "p1", name: "b" }))
    if (a.kind !== "started" || b.kind !== "started") throw new Error("expected started")
    const timer = controllableTimer()

    // when the timeout fires before any completion
    const pending = runTaskWait(manager, {}, "p1", WAIT, timer.schedule)
    timer.fire()
    const result = await pending

    // then
    expect(result.details.timed_out).toBe(true)
    expect(result.details.completed).toHaveLength(0)
    expect(result.details.still_running).toHaveLength(2)
  })

  test("#given a completion wins the race #when wait returns #then the timeout timer is cancelled", async () => {
    // given
    const { manager, inProcess } = makeManager({})
    const a = await manager.start(baseSpec({ parent_session_id: "p1", name: "a" }))
    if (a.kind !== "started") throw new Error("expected started")
    const timer = controllableTimer()

    // when
    const pending = runTaskWait(manager, { targets: [a.task_id] }, "p1", WAIT, timer.schedule)
    inProcess.handles.get(a.task_id)?.settle({ status: "completed", finalResponse: "done" })
    await pending

    // then
    expect(timer.cancelled()).toBe(true)
  })

  test("#given an already-terminal target #when waited #then it returns immediately without blocking", async () => {
    // given
    const { manager, inProcess } = makeManager({})
    const a = await manager.start(baseSpec({ parent_session_id: "p1", name: "a" }))
    const b = await manager.start(baseSpec({ parent_session_id: "p1", name: "b" }))
    if (a.kind !== "started" || b.kind !== "started") throw new Error("expected started")
    inProcess.handles.get(a.task_id)?.settle({ status: "completed", finalResponse: "already done" })
    await flush()

    // when
    const result = await runTaskWait(manager, { targets: [a.task_id, b.task_id] }, "p1", WAIT, neverFire)

    // then
    expect(result.details.timed_out).toBe(false)
    expect(result.details.completed).toHaveLength(1)
    expect(result.details.completed[0]?.task_id).toBe(a.task_id)
    expect(result.details.still_running).toHaveLength(1)
  })

  test("#given default targets #when waiting #then only the current session's children are considered", async () => {
    // given
    const { manager, inProcess } = makeManager({})
    const mine = await manager.start(baseSpec({ parent_session_id: "p1", name: "mine" }))
    await manager.start(baseSpec({ parent_session_id: "p2", name: "theirs" }))
    if (mine.kind !== "started") throw new Error("expected started")
    inProcess.handles.get(mine.task_id)?.settle({ status: "completed", finalResponse: "ok" })
    await flush()

    // when omitting targets, scoped to session p1
    const result = await runTaskWait(manager, {}, "p1", WAIT, neverFire)

    // then only p1's child is present
    expect(result.details.completed).toHaveLength(1)
    expect(result.details.completed[0]?.task_id).toBe(mine.task_id)
    expect(result.details.still_running).toHaveLength(0)
  })

  test("#given unknown targets #when waited #then they are reported as unknown with no completions", async () => {
    // given
    const { manager } = makeManager({})
    await manager.start(baseSpec({ parent_session_id: "p1", name: "real" }))

    // when
    const result = await runTaskWait(manager, { targets: ["st_ffffffff", "ghost-name"] }, "p1", WAIT, neverFire)

    // then
    expect(result.details.completed).toHaveLength(0)
    expect(result.details.unknown_targets).toEqual(["st_ffffffff", "ghost-name"])
  })
})
