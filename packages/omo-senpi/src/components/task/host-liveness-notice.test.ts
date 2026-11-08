import { expect, test } from "bun:test"
import { makeRecord } from "../../../../senpi-task/src/tools/output/__fixtures__/records"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import { notifyHostLiveness } from "./host-liveness-notice"

test("a newer parent liveness status replaces the older pending status", async () => {
  const delivered: unknown[] = []
  const flushed = Promise.withResolvers<undefined>()
  const coordinator = new IdleInjectionCoordinator((_message, options) => {
    delivered.push(...options.items.map(item => ({
      source: item.producer, type: item.customType, details: item.details,
    })))
    flushed.resolve(undefined)
  })
  const record = makeRecord({ task_id: "st_live", status: "running" })
  notifyHostLiveness(new FakeExtensionAPI(), coordinator, record, { state: "unresponsive", since: 40_000 })
  notifyHostLiveness(new FakeExtensionAPI(), coordinator, record, { state: "running" })
  await flushed.promise
  expect(delivered).toEqual([
    { source: "task-status", type: "senpi-task.status", details: { task_id: "st_live", run_epoch: record.notification.run_epoch, state: "running" } },
  ])
  expect(coordinator.pendingCount()).toBe(0)
  coordinator.retire()
})

test("a streaming parent receives liveness through its scheduled batch window", async () => {
  // Given a streaming parent's coordinator with a controlled batch scheduler.
  const scheduled: Array<() => void> = []
  const delivered: unknown[] = []
  const coordinator = new IdleInjectionCoordinator((_message, options) => {
    delivered.push(...options.items)
  }, { scheduleFlush: flush => { scheduled.push(flush) } })
  const record = makeRecord({ task_id: "st_streaming", status: "running" })
  // When a liveness notice arrives during the turn, no immediate flush bypasses that window.
  notifyHostLiveness(new FakeExtensionAPI(), coordinator, record, { state: "unresponsive", since: 40_000 }, () => true)
  await Promise.resolve()
  expect(delivered).toHaveLength(0)
  expect(scheduled).toHaveLength(1)
  // Then the coordinator owns when the batch is delivered.
  scheduled[0]?.()
  expect(delivered).toHaveLength(1)
  coordinator.retire()
})
