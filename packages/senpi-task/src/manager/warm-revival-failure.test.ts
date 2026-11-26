import { afterEach, describe, expect, spyOn, test } from "bun:test"

import { FakeRunner, baseSpec, cleanupProjects, makeManager } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

async function finishedResidentChild() {
  const inProcess = new FakeRunner()
  const { manager, store } = makeManager({ inProcess })
  const started = await manager.start(baseSpec({ run_in_background: true }))
  if (started.kind !== "started") throw new Error("expected started")
  const fake = inProcess.handles.get(started.task_id)
  if (fake === undefined) throw new Error("missing child handle")
  const first = manager.waitFor(started.task_id, { signal: AbortSignal.timeout(5000) })
  fake.settle({ status: "completed", finalResponse: "first" })
  await first
  return { manager, store, fake, taskId: started.task_id }
}

const COMPACTING = "Cannot submit a prompt while compaction is in progress."

// A resident child that already finished refused the revival prompt (the engine was compacting).
// The send reported not_continuable but left the record on a new running epoch with no outcome
// tracker and no slot: the next send went in as a plain steer, the child ran to completion, and
// nothing ever settled the record, so the parent waited on a "starting" child for days.
describe("warm revival whose prompt the live child refuses", () => {
  test("#given a completed resident child #when its revival prompt is refused #then the record is restored to its terminal run and the next send revives and settles normally", async () => {
    // given
    const inProcess = new FakeRunner()
    const { manager, store } = makeManager({ inProcess })
    const started = await manager.start(baseSpec({ run_in_background: true }))
    if (started.kind !== "started") throw new Error("expected started")
    const fake = inProcess.handles.get(started.task_id)
    if (fake === undefined) throw new Error("missing child handle")
    const first = manager.waitFor(started.task_id, { signal: AbortSignal.timeout(5000) })
    fake.settle({ status: "completed", finalResponse: "first" })
    await first
    const refusal = spyOn(fake.handle, "followUp").mockImplementationOnce(() =>
      Promise.reject(
        new Error("Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry."),
      ),
    )

    // when
    const refused = await manager.sendToTask({ idOrName: started.task_id, message: "continue" })

    // then
    expect(refused.kind).toBe("not_continuable")
    expect(refusal).toHaveBeenCalledTimes(1)
    expect(store.load(started.task_id)).toMatchObject({
      status: "completed",
      final_response: "first",
      notification: { run_epoch: 0 },
    })

    // when
    const retried = await manager.sendToTask({ idOrName: started.task_id, message: "continue" })

    // then
    expect(retried).toMatchObject({ kind: "revived", run_epoch: 1 })
    const second = manager.waitFor(started.task_id, { signal: AbortSignal.timeout(5000) })
    fake.settle({ status: "completed", finalResponse: "second" })
    expect(await second).toMatchObject({ status: "completed", final_response: "second" })
  })

  // The restore is fenced on the epoch and host this revival wrote: whatever lands while the prompt is
  // in flight wins over the finished snapshot.
  const intruders = [
    { name: "a cancel", change: { status: "cancelled" as const }, expected: { status: "cancelled" } },
    { name: "a new owner", change: { host_pid: 777_001 }, expected: { status: "running", host_pid: 777_001 } },
    {
      name: "a newer epoch on the same host",
      change: { notification: { run_epoch: 2 } },
      expected: { status: "running" },
      epoch: 2,
    },
  ]
  for (const intruder of intruders) {
    test(`#given ${intruder.name} lands while the refused revival prompt is in flight #when the refusal returns #then the finished run is not restored over it`, async () => {
      // given
      const inProcess = new FakeRunner()
      const { manager, store } = makeManager({ inProcess })
      const started = await manager.start(baseSpec({ run_in_background: true }))
      if (started.kind !== "started") throw new Error("expected started")
      const fake = inProcess.handles.get(started.task_id)
      if (fake === undefined) throw new Error("missing child handle")
      const first = manager.waitFor(started.task_id, { signal: AbortSignal.timeout(5000) })
      fake.settle({ status: "completed", finalResponse: "first" })
      await first
      spyOn(fake.handle, "followUp").mockImplementationOnce(() => {
        store.mutate(started.task_id, (fresh) => {
          const { notification, ...rest } = intruder.change as { notification?: { run_epoch: number } }
          return {
            ...fresh,
            ...rest,
            ...(notification === undefined ? {} : { notification: { ...fresh.notification, ...notification } }),
          }
        })
        return Promise.reject(new Error("Cannot submit a prompt while compaction is in progress."))
      })

      // when
      const refused = await manager.sendToTask({ idOrName: started.task_id, message: "continue" })

      // then
      expect(refused.kind).toBe("not_continuable")
      expect(store.load(started.task_id)).toMatchObject({
        ...intruder.expected,
        notification: { run_epoch: intruder.epoch ?? 1 },
      })
    })
  }

  // The refusal undoes only the revival's own run. A stop accepted for that run (durable before its
  // terminal) owns how the run ends, and a message queued meanwhile is still owed to the child.
  test("#given a stop is accepted for an unreachable child while the refused revival prompt is in flight #when the refusal returns #then the run keeps its pending stop and ends cancelled when the stop lands", async () => {
    // given
    const { manager, store, fake, taskId } = await finishedResidentChild()
    let landStop: () => void = () => undefined
    const stopLanded = new Promise<void>((resolve) => {
      landStop = resolve
    })
    Object.assign(fake.handle, { transportRecovering: () => true, stopWhenReachable: () => stopLanded })
    let stop: Awaited<ReturnType<typeof manager.cancelTask>> | undefined
    spyOn(fake.handle, "followUp").mockImplementationOnce(async () => {
      stop = await manager.cancelTask(taskId)
      throw new Error(COMPACTING)
    })

    // when
    const refused = await manager.sendToTask({ idOrName: taskId, message: "continue" })

    // then
    expect(refused.kind).toBe("not_continuable")
    expect(stop?.kind).toBe("cancel_pending")
    expect(store.load(taskId)).toMatchObject({ status: "running", notification: { run_epoch: 1 } })
    expect(store.load(taskId)?.cancel_requested).toBeDefined()

    // when
    const ended = manager.waitFor(taskId, { signal: AbortSignal.timeout(5000) })
    landStop()

    // then
    expect(await ended).toMatchObject({ status: "cancelled" })
  })

  test("#given a message is queued for the child while the refused revival prompt is in flight #when the finished run is restored #then the queued message survives and the next revival delivers it", async () => {
    // given
    const { manager, store, fake, taskId } = await finishedResidentChild()
    spyOn(fake.handle, "followUp").mockImplementationOnce(() => {
      store.mutate(taskId, (fresh) => ({
        ...fresh,
        pending_steering: [
          ...(fresh.pending_steering ?? []),
          { id: "ps-queued", message: "queued", deliver_as: "followUp" },
        ],
      }))
      return Promise.reject(new Error(COMPACTING))
    })

    // when
    const refused = await manager.sendToTask({ idOrName: taskId, message: "continue" })

    // then
    expect(refused.kind).toBe("not_continuable")
    expect(store.load(taskId)).toMatchObject({
      status: "completed",
      final_response: "first",
      pending_steering: [{ id: "ps-queued", message: "queued" }],
    })

    // when
    const retried = await manager.sendToTask({ idOrName: taskId, message: "again" })

    // then
    expect(retried.kind).toBe("revived")
    expect(fake.followUpCalls.at(-1)).toBe("queued\n\nagain")
  })
})
