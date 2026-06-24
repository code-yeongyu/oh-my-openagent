import { describe, expect, test } from "bun:test"
import { toBackgroundTaskSnapshots } from "./task-snapshot"
import type { BackgroundTask, BackgroundTaskSnapshot, BackgroundTaskStatus } from "./types"

const ALL_BACKGROUND_TASK_STATUSES = [
  "pending",
  "running",
  "completed",
  "error",
  "cancelled",
  "interrupt",
] as const satisfies readonly BackgroundTaskStatus[]

function createTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-1",
    parentSessionId: "parent-session",
    parentMessageId: "parent-message",
    description: "summarize code",
    prompt: "Please summarize the code",
    agent: "sisyphus",
    status: "running",
    ...overrides,
  }
}

function firstSnapshot(snapshots: readonly BackgroundTaskSnapshot[]): BackgroundTaskSnapshot {
  const snapshot = snapshots[0]
  if (!snapshot) {
    throw new Error("expected first background task snapshot")
  }
  return snapshot
}

describe("toBackgroundTaskSnapshots", () => {
  test("returns an empty array when there are no tasks", () => {
    //#given
    const tasks: readonly BackgroundTask[] = []

    //#when
    const snapshots = toBackgroundTaskSnapshots(tasks)

    //#then
    expect(snapshots).toEqual([])
  })

  test("passes through every background task status", () => {
    //#given
    const tasks = ALL_BACKGROUND_TASK_STATUSES.map((status) => createTask({
      id: `task-${status}`,
      status,
    }))

    //#when
    const snapshots = toBackgroundTaskSnapshots(tasks)

    //#then
    expect(snapshots.map((snapshot) => snapshot.status)).toEqual(ALL_BACKGROUND_TASK_STATUSES)
  })

  test("returns frozen plain snapshots detached from task references", () => {
    //#given
    const task = createTask({
      prompt: "fallback prompt",
      progress: {
        toolCalls: 3,
        lastTool: "grep",
        lastUpdate: new Date("2026-06-15T00:00:00.000Z"),
      },
    })

    //#when
    const snapshots = toBackgroundTaskSnapshots([task])
    const first = firstSnapshot(snapshots)
    task.prompt = "changed after snapshot"
    snapshots.push({
      title: "array mutation",
      status: "pending",
      toolCalls: null,
      lastTool: null,
      agent: "atlas",
    })

    //#then
    expect(first).toEqual({
      title: "summarize code",
      status: "running",
      toolCalls: 3,
      lastTool: "grep",
      agent: "sisyphus",
    })
    expect(Object.getPrototypeOf(first)).toBe(Object.prototype)
    expect(Object.isFrozen(first)).toBe(true)
    expect(() => {
      Object.assign(first, { title: "mutated" })
    }).toThrow()
    expect(toBackgroundTaskSnapshots([task])).toEqual([{
      title: "summarize code",
      status: "running",
      toolCalls: 3,
      lastTool: "grep",
      agent: "sisyphus",
    }])
  })

  test("does not expose prompt text when description is empty", () => {
    //#given
    const task = createTask({
      id: "task-secret",
      description: "",
      prompt: "SECRET_TOKEN=never-write-this",
      agent: "atlas",
    })

    //#when
    const snapshots = toBackgroundTaskSnapshots([task])

    //#then
    expect(firstSnapshot(snapshots)).toEqual({
      title: "atlas background task",
      status: "running",
      toolCalls: null,
      lastTool: null,
      agent: "atlas",
    })
    expect(JSON.stringify(snapshots)).not.toContain("SECRET_TOKEN")
  })
})
