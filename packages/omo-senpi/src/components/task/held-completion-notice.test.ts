import { expect, test } from "bun:test"
import { deliverItems } from "../../extension/deliver-items"
import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { RunRef } from "../../../../senpi-task/src/pause/ports"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createParentNotifier } from "./parent-notifier"

const completion = (taskId: string, runId: string) => ({
  customType: "senpi-task.completion" as const, content: `task ${taskId} completed`, display: true,
  details: [{
    task_id: taskId, name: taskId, status: "completed" as const, model: "m", duration_ms: 1,
    final_response: "done", continuation_hint: "", runRef: { kind: "dag", id: runId } as RunRef,
  }],
})

test("design 25: a run-tagged completion held as a notice while paused is engine custody, never a failed or repeated delivery", async () => {
  const stoppedRuns = new Set(["run-1"])
  const sends: { readonly runRefs: readonly (RunRef | undefined)[] }[] = []
  const failures: string[] = []
  const coordinator = new IdleInjectionCoordinator((message, options) => deliverItems((_native, delivery) => {
    sends.push({ runRefs: delivery.items.map(item => item.runRef) })
    return delivery.items.map(item => item.runRef !== undefined && stoppedRuns.has(item.runRef.id)
      ? { itemId: item.itemId, entryId: "held-batch", noticeId: `notice:${item.itemId}`, disposition: "notice_persisted" as const }
      : { itemId: item.itemId, entryId: `entry:${item.itemId}`, disposition: "message_persisted" as const })
  }, { ...options, message }))
  const notifier = createParentNotifier(new FakeExtensionAPI(), coordinator, () => false, taskIds => { failures.push(...taskIds) })

  notifier.enqueue(completion("st_1", "run-1"))
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  expect(sends).toEqual([{ runRefs: [{ kind: "dag", id: "run-1" }] }])
  expect(failures).toEqual([])
  expect(coordinator.pendingCount()).toBe(0)

  stoppedRuns.delete("run-1")
  notifier.enqueue(completion("st_2", "run-2"))
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  expect(sends).toHaveLength(2)
  expect(sends[1]?.runRefs).toEqual([{ kind: "dag", id: "run-2" }])
  expect(failures).toEqual([])
})
