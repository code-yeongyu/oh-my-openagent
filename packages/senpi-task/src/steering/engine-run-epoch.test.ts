import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import type { TaskRecordStore } from "../store"
import { cleanupSteering, makeFakeHandle, makeHarness, type SteeringHarness } from "./__fixtures__/steering-fakes"
import type { TaskRecord } from "../state"

afterEach(cleanupSteering)

function toRunning(harness: SteeringHarness, record: TaskRecord): void {
  harness.store.transition(record.task_id, { type: "start", timestamp: new Date().toISOString() })
}

function toCompleted(harness: SteeringHarness, record: TaskRecord): void {
  toRunning(harness, record)
  harness.store.transition(record.task_id, { type: "complete", timestamp: new Date().toISOString(), final_response: "first pass" })
}

type LoggedEvent = { readonly type: string; readonly payload?: Record<string, unknown> }

function readEventLog(store: TaskRecordStore, taskId: string): readonly LoggedEvent[] {
  const raw = readFileSync(join(store.stateDir, "logs", `${taskId}.jsonl`), "utf8")
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as LoggedEvent)
}

describe("steering event log run epochs", () => {
  test("#given a steer delivered during run_epoch 2 #when the event is appended #then the payload carries run_epoch 2 and survives redaction", async () => {
    // given: two revives lift the record to run_epoch 2
    const harness = makeHarness()
    const record = harness.seedRecord()
    toCompleted(harness, record)
    const fake = makeFakeHandle(record.task_id, "in-process")
    harness.setLive(record.task_id, fake.handle)
    await harness.engine.sendToTask({ idOrName: record.task_id, message: "again" })
    harness.store.transition(record.task_id, {
      type: "complete",
      timestamp: new Date().toISOString(),
      final_response: "second pass",
    })
    await harness.engine.sendToTask({ idOrName: record.task_id, message: "once more" })
    expect(harness.store.load(record.task_id)?.notification.run_epoch).toBe(2)

    // when
    const outcome = await harness.engine.sendToTask({ idOrName: record.task_id, message: "keep going", deliverAs: "steer" })

    // then
    expect(outcome.kind).toBe("steered")
    const steered = readEventLog(harness.store, record.task_id).filter((event) => event.type === "steered")
    expect(steered).toHaveLength(1)
    expect(steered[0]?.payload).toEqual({ delivered: "steer", run_epoch: 2 })
  })

  test("#given a prelaunch send to a pending child #when queued #then the steer_queued payload carries the current run_epoch", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord()

    // when
    const outcome = await harness.engine.sendToTask({ idOrName: record.task_id, message: "context first" })

    // then
    expect(outcome.kind).toBe("queued")
    const queued = readEventLog(harness.store, record.task_id).filter((event) => event.type === "steer_queued")
    expect(queued).toHaveLength(1)
    expect(queued[0]?.payload).toEqual({ queue_position: 1, deliverAs: "followUp", run_epoch: 0 })
  })

  test("#given a queued prelaunch message drained at launch #when delivered #then the steered event carries the launching run_epoch", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord()
    await harness.engine.sendToTask({ idOrName: record.task_id, message: "context first" })
    toRunning(harness, record)
    harness.setLive(record.task_id, makeFakeHandle(record.task_id, "in-process").handle)

    // when
    await harness.engine.notifyStarted(record.task_id)

    // then
    const steered = readEventLog(harness.store, record.task_id).filter((event) => event.type === "steered")
    expect(steered).toHaveLength(1)
    expect(steered[0]?.payload).toEqual({ delivered: "followUp", queued: true, run_epoch: 0 })
  })
})
