import { expect, test } from "bun:test"
import type { ParentState } from "@oh-my-opencode/senpi-task"
import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import { createDagWake } from "./dag-wake"

const counts = { total: 1, pending: 0, blocked: 0, scheduled: 0, running: 0, completed: 1, failed: 0, cancelled: 0, skipped: 0 }

test("M4: a run's later wake buffered during compaction replaces its paused wake, so only the terminal summary is delivered", async () => {
  const delivered: string[] = []
  const coordinator = new IdleInjectionCoordinator(message => { delivered.push(message.content) })
  let parentState: ParentState = { kind: "compacting" }
  const wake = createDagWake({ coordinator, parentState: () => parentState })
  const run = { runId: "dag_1", name: "release", parentSessionId: "parent" }
  wake.onRunEvent(run, { runId: "dag_1", seq: 1, type: "dag.run.paused", reason: "user_stop" })
  wake.onRunEvent(run, { runId: "dag_1", seq: 2, type: "dag.run.completed", counts })
  expect(wake.bufferedCount("parent")).toBe(1)
  parentState = { kind: "idle" }
  wake.onSessionStart("parent")
  await Promise.resolve()
  await Promise.resolve()
  expect(delivered).toHaveLength(1)
  expect(delivered[0]).toContain("DAG \"release\" completed")
  expect(delivered[0]).not.toContain("paused by your Stop")
})
