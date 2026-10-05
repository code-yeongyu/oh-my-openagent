// #8396: a caller denied for residency (a DAG scheduler that has attached nothing yet) needs a
// SESSION-scoped wake, not its own bookkeeping, to know when a resident slot may have freed. The
// manager owns every event that changes a session's residency picture, so it owns the signal.
import { afterEach, describe, expect, test } from "bun:test"

import { FakeRunner, baseSpec, cleanupProjects, flush, makeManager } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

// Every notify path under test is synchronous, so draining the microtask queue once (flush = one
// macrotask boundary) gives a definitive answer for BOTH the fired and the silent case.
async function firedYet(signal: Promise<void>): Promise<"fired" | "silent"> {
  let fired = false
  void signal.then(() => {
    fired = true
  })
  await flush()
  return fired ? "fired" : "silent"
}

async function startedChild(runner: FakeRunner, parentSessionId: string, name: string) {
  const { manager } = makeManager({ inProcess: runner, admit: async () => ({ kind: "admitted" }) })
  const started = await manager.start(baseSpec({ name, parent_session_id: parentSessionId }))
  if (started.kind !== "started") throw new Error(`expected a started child, got ${started.kind}`)
  return { manager, taskId: started.task_id }
}

describe("TaskManager.residencyChanged", () => {
  test("#given a resident child of the session #when it reaches a terminal status #then the armed session wake resolves", async () => {
    // given
    const runner = new FakeRunner()
    const { manager, taskId } = await startedChild(runner, "parent-1", "worker")
    const wake = manager.residencyChanged("parent-1")
    expect(await firedYet(wake)).toBe("silent")

    // when
    runner.handles.get(taskId)?.settle({ status: "completed", finalResponse: "done" })
    await manager.waitFor(taskId)

    // then
    expect(await firedYet(wake)).toBe("fired")
  })

  test("#given an armed wake #when the resident is forgotten (evicted or suspended) #then the wake resolves", async () => {
    // given
    const runner = new FakeRunner()
    const { manager, taskId } = await startedChild(runner, "parent-1", "worker")
    const wake = manager.residencyChanged("parent-1")

    // when
    manager.forget(taskId)

    // then
    expect(await firedYet(wake)).toBe("fired")
  })

  test("#given a terminal resident pinned by a pending send #when the last send drains #then the wake resolves", async () => {
    // given - a pending send makes a terminal resident unevictable; draining it frees the slot.
    const runner = new FakeRunner()
    const { manager, taskId } = await startedChild(runner, "parent-1", "worker")
    expect(manager.tryBeginSend?.(taskId)).toBe(true)
    const wake = manager.residencyChanged("parent-1")

    // when
    manager.endSend?.(taskId)

    // then
    expect(await firedYet(wake)).toBe("fired")
  })

  test("#given wakes armed for two sessions #when only one session's child settles #then the other session's wake stays silent and re-arming yields a fresh promise", async () => {
    // given
    const runner = new FakeRunner()
    const { manager, taskId } = await startedChild(runner, "parent-1", "worker")
    const own = manager.residencyChanged("parent-1")
    const other = manager.residencyChanged("parent-2")

    // when
    runner.handles.get(taskId)?.settle({ status: "completed", finalResponse: "done" })
    await manager.waitFor(taskId)

    // then - session scoping holds, and the signal is repeatable (the next arm is a new wait).
    expect(await firedYet(own)).toBe("fired")
    expect(await firedYet(other)).toBe("silent")
    const rearmed = manager.residencyChanged("parent-1")
    expect(rearmed).not.toBe(own)
    expect(await firedYet(rearmed)).toBe("silent")
  })
})
