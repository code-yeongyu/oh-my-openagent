import { expect, test } from "bun:test"
import type { TaskRecord } from "../state"
import { createPendingSteering } from "./pending-steering"
import type { SteeringPort } from "./types"

// #10399: every launch ends with notifyStarted. A drain registered over an empty queue still reads as
// "draining" for a few ticks, and the steer-ordering guard then queued a send to the live child behind
// nothing instead of steering it. With nothing persisted to deliver, no drain may be registered.
test("#given a started task with no queued steers #when notifyStarted runs #then the task is not draining", async () => {
  // given
  const record = { task_id: "task-empty", status: "running", pending_steering: [] } as unknown as TaskRecord
  const port = { now: () => 0, store: {} } as unknown as SteeringPort
  const steering = createPendingSteering(port, (taskId) => (taskId === record.task_id ? record : undefined))

  // when
  const settled = steering.notifyStarted(record.task_id)

  // then
  expect(steering.isDraining(record.task_id)).toBe(false)
  await settled
})
