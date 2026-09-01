import { describe, expect, it } from "bun:test"
import { DAG_VERIFICATION_DIRECTIVE, type ParentState } from "@oh-my-opencode/senpi-task"

import {
  IdleInjectionCoordinator,
  type IdleInjectionMessage,
} from "../../extension/idle-injection-coordinator"
import {
  createDagWake,
  DAG_WAKE_MESSAGE_TYPE,
  type DagWakeNodeCounts,
  type DagWakeRun,
  type DagWakeRunEvent,
} from "./dag-wake"

const SESSION_ID = "parent-session"

const counts: DagWakeNodeCounts = {
  total: 4,
  pending: 0,
  blocked: 0,
  scheduled: 0,
  running: 0,
  completed: 3,
  failed: 1,
  cancelled: 0,
  skipped: 0,
}

interface DeliveredCall {
  readonly message: IdleInjectionMessage
  readonly options: { readonly deliverAs: "steer" | "followUp" }
}

function fakeTimers() {
  const pending: Array<() => void> = []
  return {
    schedule(callback: () => void) {
      pending.push(callback)
    },
    pendingCount: () => pending.length,
    runAll() {
      while (pending.length > 0) pending.shift()?.()
    },
  }
}

function run(runId = "dag_1", name = "release-pipeline"): DagWakeRun {
  return { runId, name, parentSessionId: SESSION_ID }
}

function event(type: string, runId = "dag_1", overrides: Partial<DagWakeRunEvent> = {}): DagWakeRunEvent {
  return { runId, seq: 7, type, ...overrides }
}

function terminalEvent(
  type: "dag.run.completed" | "dag.run.failed" | "dag.run.cancelled",
  runId = "dag_1",
  overrides: Partial<DagWakeRunEvent> = {},
): DagWakeRunEvent {
  return event(type, runId, { counts, ...overrides })
}

function createHarness(initialParentState: ParentState = { kind: "streaming" }) {
  const timers = fakeTimers()
  const delivered: DeliveredCall[] = []
  let parentState = initialParentState
  const coordinator = new IdleInjectionCoordinator(
    (message, options) => void delivered.push({ message, options }),
    { scheduleFlush: timers.schedule },
  )
  const wake = createDagWake({ coordinator, parentState: () => parentState })
  return {
    coordinator,
    delivered,
    timers,
    wake,
    setParentState(next: ParentState) {
      parentState = next
    },
  }
}

describe("dag wake", () => {
  it("#given one failed run and an idle parent #when its terminal event arrives #then exactly one dag-run steer contains counts and the first failure", async () => {
    // given
    const harness = createHarness({ kind: "idle" })

    // when
    harness.wake.onRunEvent(run(), terminalEvent("dag.run.failed", "dag_1", {
      error: { code: "task_error", message: "compile failed", nodeId: "build" },
    }))

    // then the terminal owns one queued injection without using the streaming timer
    expect(harness.coordinator.pendingCount()).toBe(1)
    expect(harness.timers.pendingCount()).toBe(0)

    // when the deterministic idle microtask runs
    await Promise.resolve()

    // then one steer carries the compact terminal summary and structured DAG details
    expect(harness.delivered).toHaveLength(1)
    expect(harness.delivered[0]?.options).toEqual({ deliverAs: "steer" })
    expect(harness.delivered[0]?.message.content).toBe(
      "DAG \"release-pipeline\" failed: 3 completed, 1 failed, 0 cancelled, 0 skipped (4 total). First failure at build [task_error]: compile failed"
      + `\n\n${DAG_VERIFICATION_DIRECTIVE}`,
    )
    expect(harness.delivered[0]?.message.details).toEqual([{
      customType: DAG_WAKE_MESSAGE_TYPE,
      details: {
        runId: "dag_1",
        name: "release-pipeline",
        status: "failed",
        counts,
        firstFailure: { code: "task_error", message: "compile failed", nodeId: "build" },
      },
    }])
  })

  it("#given two terminal runs in one window #when the fake timer flushes #then one coordinator steer carries both summaries", () => {
    // given
    const harness = createHarness()

    // when
    harness.wake.onRunEvent(run("dag_1", "release"), terminalEvent("dag.run.completed", "dag_1"))
    harness.wake.onRunEvent(run("dag_2", "docs"), terminalEvent("dag.run.cancelled", "dag_2"))

    // then repeated flush requests coalesce behind one deterministic timer
    expect(harness.coordinator.pendingCount()).toBe(2)
    expect(harness.timers.pendingCount()).toBe(1)

    // when
    harness.timers.runAll()

    // then
    expect(harness.delivered).toHaveLength(1)
    expect(harness.delivered[0]?.message.content).toBe(
      `DAG "release" completed: 3 completed, 1 failed, 0 cancelled, 0 skipped (4 total)\n\n${DAG_VERIFICATION_DIRECTIVE}\n\n`
      + `DAG "docs" cancelled: 3 completed, 1 failed, 0 cancelled, 0 skipped (4 total)\n\n${DAG_VERIFICATION_DIRECTIVE}`,
    )
    expect(harness.delivered[0]?.options).toEqual({ deliverAs: "steer" })
  })

  it("#given a terminal during compaction #when session_start resumes the same session #then the buffered notification is redelivered", async () => {
    // given
    const harness = createHarness({ kind: "compacting" })

    // when
    harness.wake.onRunEvent(run(), terminalEvent("dag.run.completed"))

    // then compaction produces no immediate coordinator wake
    expect(harness.wake.bufferedCount(SESSION_ID)).toBe(1)
    expect(harness.coordinator.pendingCount()).toBe(0)
    expect(harness.delivered).toHaveLength(0)

    // when the same session starts again
    harness.setParentState({ kind: "idle" })
    harness.wake.onSessionStart(SESSION_ID)
    await Promise.resolve()

    // then the buffer drains once through the coordinator's idle steer path
    expect(harness.wake.bufferedCount(SESSION_ID)).toBe(0)
    expect(harness.delivered).toHaveLength(1)
    expect(harness.delivered[0]?.message.content).toContain("DAG \"release-pipeline\" completed")
    expect(harness.delivered[0]?.options).toEqual({ deliverAs: "steer" })
  })

  it("#given mid-run wave and node events #when every fake timer runs #then wake call count remains exactly zero", async () => {
    // given
    const harness = createHarness()

    // when
    harness.wake.onRunEvent(run(), event("dag.wave.started"))
    harness.wake.onRunEvent(run(), event("dag.wave.completed"))
    harness.wake.onRunEvent(run(), event("dag.node.transitioned"))
    harness.timers.runAll()
    await Promise.resolve()

    // then
    expect(harness.delivered).toHaveLength(0)
    expect(harness.coordinator.pendingCount()).toBe(0)
    expect(harness.timers.pendingCount()).toBe(0)
  })

  it("#given a DAG terminal and task completion in one window #when flushed #then the task completion is ordered first", () => {
    // given
    const harness = createHarness()
    harness.wake.onRunEvent(run(), terminalEvent("dag.run.completed"))
    harness.coordinator.enqueue({
      key: "task-completion:st_1",
      source: "task-completion",
      content: "task st_1 completed",
    })

    // when
    harness.timers.runAll()

    // then
    expect(harness.delivered).toHaveLength(1)
    expect(harness.delivered[0]?.message.content).toBe(
      "task st_1 completed\n\nDAG \"release-pipeline\" completed: 3 completed, 1 failed, 0 cancelled, 0 skipped (4 total)"
      + `\n\n${DAG_VERIFICATION_DIRECTIVE}`,
    )
  })

  it("#given a run paused by session shutdown and an idle parent #when the pause event arrives #then one steer tells the main session the dag was paused", async () => {
    // given
    const harness = createHarness({ kind: "idle" })

    // when
    harness.wake.onRunEvent(run(), event("dag.run.paused", "dag_1", { reason: "session_shutdown" }))
    await Promise.resolve()

    // then
    expect(harness.delivered).toHaveLength(1)
    expect(harness.delivered[0]?.options).toEqual({ deliverAs: "steer" })
    expect(harness.delivered[0]?.message.content).toBe(
      "DAG \"release-pipeline\" paused (session_shutdown): it will resume when the session restarts.",
    )
    expect(harness.delivered[0]?.message.details).toEqual([{
      customType: DAG_WAKE_MESSAGE_TYPE,
      details: { runId: "dag_1", name: "release-pipeline", status: "paused", reason: "session_shutdown" },
    }])
  })

  it("#given a pause during session shutdown #when the session starts again #then the buffered pause notice is redelivered", async () => {
    // given
    const harness = createHarness({ kind: "session_shutdown" })

    // when
    harness.wake.onRunEvent(run(), event("dag.run.paused", "dag_1", { reason: "session_shutdown" }))

    // then the shutdown window buffers instead of dropping it
    expect(harness.wake.bufferedCount(SESSION_ID)).toBe(1)
    expect(harness.delivered).toHaveLength(0)

    // when the same session comes back
    harness.setParentState({ kind: "idle" })
    harness.wake.onSessionStart(SESSION_ID)
    await Promise.resolve()

    // then
    expect(harness.wake.bufferedCount(SESSION_ID)).toBe(0)
    expect(harness.delivered).toHaveLength(1)
    expect(harness.delivered[0]?.message.content).toContain("DAG \"release-pipeline\" paused")
  })

  it("#given a terminal run event and an idle parent #when the injection is delivered #then its content carries the dag verification directive", async () => {
    // given
    const harness = createHarness({ kind: "idle" })

    // when
    harness.wake.onRunEvent(run(), terminalEvent("dag.run.completed"))
    await Promise.resolve()

    // then
    const content = harness.delivered[0]?.message.content ?? ""
    expect(content).toContain(DAG_VERIFICATION_DIRECTIVE)
    expect(content).toContain(`\n\n${DAG_VERIFICATION_DIRECTIVE}`)
    expect(content).toStartWith("DAG \"release-pipeline\" completed")
  })

  it("#given a paused run event #when the injection is delivered #then its content omits the dag verification directive", async () => {
    // given
    const harness = createHarness({ kind: "idle" })

    // when
    harness.wake.onRunEvent(run(), event("dag.run.paused", "dag_1", { reason: "session_shutdown" }))
    await Promise.resolve()

    // then
    expect(harness.delivered[0]?.message.content).not.toContain(DAG_VERIFICATION_DIRECTIVE)
  })

  it("#given a pause with no reason #when the event arrives #then the summary omits the reason clause", async () => {
    // given
    const harness = createHarness({ kind: "idle" })

    // when
    harness.wake.onRunEvent(run(), event("dag.run.paused"))
    await Promise.resolve()

    // then
    expect(harness.delivered[0]?.message.content).toBe(
      "DAG \"release-pipeline\" paused: it will resume when the session restarts.",
    )
  })
})
