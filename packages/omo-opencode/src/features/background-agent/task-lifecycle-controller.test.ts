import { describe, expect, test } from "bun:test"
import { createTaskLifecycleController, evaluateTodoCompletionPolicy } from "./task-lifecycle-controller"
import type { BackgroundTask } from "./types"

type LifecycleCalls = {
  readonly cleanup: string[]
  readonly history: string[]
  readonly releases: string[]
  readonly warnings: string[]
}

function createTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: overrides.id ?? "task-1",
    sessionId: overrides.sessionId ?? "session-1",
    parentSessionId: overrides.parentSessionId ?? "parent-1",
    parentMessageId: overrides.parentMessageId ?? "message-1",
    description: overrides.description ?? "Lifecycle task",
    prompt: overrides.prompt ?? "Do the lifecycle work",
    agent: overrides.agent ?? "sisyphus-junior",
    status: overrides.status ?? "running",
    startedAt: overrides.startedAt ?? new Date("2026-06-28T00:00:00.000Z"),
    completedAt: overrides.completedAt,
    error: overrides.error,
    category: overrides.category,
    concurrencyKey: overrides.concurrencyKey,
    attempts: overrides.attempts,
    currentAttemptID: overrides.currentAttemptID,
  }
}

function createController(calls: LifecycleCalls) {
  return createTaskLifecycleController({
    now: () => new Date("2026-06-28T00:01:00.000Z"),
    releaseConcurrency: (key) => calls.releases.push(key),
    cleanupTerminalTask: (task) => calls.cleanup.push(task.id),
    recordHistory: (task) => calls.history.push(`${task.id}:${task.status}`),
    logInvalidTransition: (event) => calls.warnings.push(`${event.taskId}:${event.from}:${event.to}`),
  })
}

function createCalls(): LifecycleCalls {
  return {
    cleanup: [],
    history: [],
    releases: [],
    warnings: [],
  }
}

describe("task lifecycle controller", () => {
  test("#given pending task #when completed transition requested #then invalid transition is rejected without cleanup", () => {
    // given
    const calls = createCalls()
    const controller = createController(calls)
    const task = createTask({ status: "pending", completedAt: undefined, sessionId: undefined })

    // when
    const result = controller.terminalize({ task, status: "completed" })

    // then
    expect(result.kind).toBe("unchanged")
    expect(result.reason).toBe("invalid-transition")
    expect(task.status).toBe("pending")
    expect(calls.cleanup).toEqual([])
    expect(calls.history).toEqual([])
    expect(calls.warnings).toEqual(["task-1:pending:completed"])
  })

  test("#given running task with concurrency #when terminalized twice #then cleanup and release run once", () => {
    // given
    const calls = createCalls()
    const controller = createController(calls)
    const task = createTask({ concurrencyKey: "provider/model" })

    // when
    const first = controller.terminalize({ task, status: "completed" })
    const second = controller.terminalize({ task, status: "completed" })

    // then
    expect(first.kind).toBe("changed")
    expect(second.kind).toBe("unchanged")
    expect(second.reason).toBe("already-terminal")
    expect(task.status).toBe("completed")
    expect(task.concurrencyKey).toBeUndefined()
    expect(calls.cleanup).toEqual(["task-1"])
    expect(calls.releases).toEqual(["provider/model"])
    expect(calls.warnings).toEqual(["task-1:completed:completed"])
  })

  test("#given running task #when terminalized twice #then task history is recorded once", () => {
    // given
    const calls = createCalls()
    const controller = createController(calls)
    const task = createTask()

    // when
    controller.terminalize({ task, status: "error", error: "worker crashed" })
    controller.terminalize({ task, status: "error", error: "worker crashed" })

    // then
    expect(task.status).toBe("error")
    expect(task.error).toBe("worker crashed")
    expect(task.completedAt).toEqual(new Date("2026-06-28T00:01:00.000Z"))
    expect(calls.history).toEqual(["task-1:error"])
    expect(calls.cleanup).toEqual(["task-1"])
  })

  test("#given final assistant text and incomplete stale todos #when evaluating todo completion policy #then completion is allowed", () => {
    // given
    const messages = [{
      info: { role: "assistant", finish: "stop", time: { created: 90_000, completed: 91_000 } },
      parts: [{ type: "text", text: "Final result" }],
    }]

    // when
    const result = evaluateTodoCompletionPolicy({ hasIncompleteTodos: true, messages, nowMs: 100_000 })

    // then
    expect(result.kind).toBe("allow")
  })

  test("#given fresh running tool activity and incomplete todos #when evaluating todo completion policy #then completion is blocked", () => {
    // given
    const messages = [{
      info: { role: "assistant", finish: "tool-calls", time: { created: 99_900 } },
      parts: [{ type: "tool", state: { status: "running" } }],
    }]

    // when
    const result = evaluateTodoCompletionPolicy({ hasIncompleteTodos: true, messages, nowMs: 100_000 })

    // then
    expect(result).toEqual({ kind: "block", reason: "fresh-tool-activity" })
  })

  test("#given unfinished assistant turn and incomplete todos #when evaluating todo completion policy #then completion is blocked", () => {
    // given
    const messages = [{
      info: { role: "assistant", finish: "unknown", time: { created: 99_900 } },
      parts: [{ type: "text", text: "still working" }],
    }]

    // when
    const result = evaluateTodoCompletionPolicy({ hasIncompleteTodos: true, messages, nowMs: 100_000 })

    // then
    expect(result).toEqual({ kind: "block", reason: "in-progress-assistant-turn" })
  })
})
