import { afterEach, describe, expect, test } from "bun:test"

import { buildCompletionDetails } from "../completion/notification"
import { FakeRunner, baseSpec, cleanupProjects, flush, makeManager } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

async function startedChild() {
  const processRunner = new FakeRunner()
  const { manager, store } = makeManager({ process: processRunner })
  const started = await manager.start(baseSpec({ execution_mode: "process" }))
  if (started.kind !== "started") throw new Error("expected started")
  const fake = processRunner.handles.get(started.task_id)
  if (fake === undefined) throw new Error("the runner produced no handle")
  return { manager, store, fake, taskId: started.task_id }
}

describe("a child that resumes on its own after its turn settled (omo#9069)", () => {
  test("#given a completed resident child #when its monitor wakes it #then the record runs again under the next epoch and its end is a second completion marked as a resumed turn", async () => {
    // given
    const { store, fake, taskId } = await startedChild()
    fake.settle({ status: "completed", finalResponse: "waiting for the test run monitor" })
    await flush()
    expect(store.load(taskId)?.status).toBe("completed")

    // when
    fake.selfResume()
    await flush()
    const resumed = store.load(taskId)
    fake.settle({ status: "completed", finalResponse: "tests passed, fixed the last failure" })
    await flush()

    // then
    expect(resumed?.status).toBe("running")
    expect(resumed?.notification.run_epoch).toBe(1)
    const settled = store.load(taskId)
    if (settled === null || settled === undefined) throw new Error("record vanished")
    expect(settled.status).toBe("completed")
    expect(settled.final_response).toBe("tests passed, fixed the last failure")
    expect(settled.notification.run_epoch).toBe(1)
    expect(buildCompletionDetails(settled).resumed_turn).toBe(true)
  })

  test("#given a child resumed on its own #when a task_send later revives it #then that revival's completion is not marked as a resumed turn", async () => {
    // given
    const { manager, store, fake, taskId } = await startedChild()
    fake.settle({ status: "completed", finalResponse: "first" })
    await flush()
    fake.selfResume()
    await flush()
    fake.settle({ status: "completed", finalResponse: "resumed" })
    await flush()

    // when
    await manager.continueTask(taskId, "one more thing")
    fake.settle({ status: "completed", finalResponse: "asked for" })
    await flush()

    // then
    const settled = store.load(taskId)
    if (settled === null || settled === undefined) throw new Error("record vanished")
    expect(settled.notification.run_epoch).toBe(2)
    expect(buildCompletionDetails(settled).resumed_turn).toBeUndefined()
  })

  test("#given a cancelled child #when a late self-resume fires #then the record stays cancelled", async () => {
    // given
    const { manager, store, fake, taskId } = await startedChild()
    await manager.cancelTask(taskId)
    await flush()

    // when
    fake.selfResume()
    await flush()

    // then
    expect(store.load(taskId)?.status).toBe("cancelled")
  })
})
