import { describe, expect, it } from "bun:test"

import type {
  ListedTask,
  ManagedChildEvent,
  ManagedChildListener,
  TaskManager,
  TaskRecord,
  TaskStatus,
} from "@oh-my-opencode/senpi-task"

import type { HerdrReportedTask, HerdrTaskClient } from "./herdr-command-client"
import { createHerdrTaskProjection } from "./herdr-task-projection"

const PARENT_SESSION_ID = "session-parent"

function record(overrides: Partial<TaskRecord> & { task_id: string; status: TaskStatus }): TaskRecord {
  return {
    parent_session_id: PARENT_SESSION_ID,
    root_session_id: PARENT_SESSION_ID,
    depth: 1,
    execution_mode: "in-process",
    model: "openai/gpt-5.6-mini",
    residency_state: "resident",
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:01.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
    notify_on_terminal: true,
    agent_type: "explore",
    name: "Inspect auth",
    ...overrides,
  }
}

function createHarness(
  initialRecords: readonly TaskRecord[],
  onWriteLine: (line: string) => Promise<void> = async () => {},
  includeAssistantOutput = false,
  startPaused = false,
  onReport: (report: HerdrReportedTask) => Promise<void> = async () => {},
) {
  let records = [...initialRecords]
  const listeners = new Map<string, ManagedChildListener>()
  const reports: HerdrReportedTask[] = []
  let created = 0
  const lines: string[] = []
  const viewerLines: string[][] = []
  const released: Array<{ paneId: string; taskId: string; sequence: number }> = []
  const closed: string[] = []
  const errors: unknown[] = []

  const manager: Pick<TaskManager, "list" | "subscribeChild"> = {
    list(scope): readonly ListedTask[] {
      expect(scope).toEqual({ scope: "parent-session", session_id: PARENT_SESSION_ID })
      return records.map((taskRecord) => ({ record: taskRecord }))
    },
    subscribeChild(taskId, listener) {
      listeners.set(taskId, listener)
      return () => listeners.delete(taskId)
    },
  }

  const client: HerdrTaskClient = {
    async createTaskPane() {
      created += 1
      return { tabId: "w1:t2", paneId: "w1:p2" }
    },
    async startViewer() {
      viewerLines.push([...lines])
    },
    async reportTask(input) {
      reports.push(input)
      await onReport(input)
    },
    async writeLine(_paneId, line) {
      lines.push(line)
      await onWriteLine(line)
    },
    async releaseTask(paneId, taskId, sequence) {
      released.push({ paneId, taskId, sequence })
    },
    async closeTab(tabId) {
      closed.push(tabId)
    },
  }

  const projection = createHerdrTaskProjection({
    manager,
    client,
    workspaceId: "w1",
    cwd: "C:\\repo",
    parentSessionId: () => PARENT_SESSION_ID,
    onError: (error) => errors.push(error),
    includeAssistantOutput,
  })
  if (!startPaused) projection.resume()

  return {
    closed,
    created: () => created,
    errors,
    lines,
    listeners,
    projection,
    released,
    reports,
    setRecords(next: readonly TaskRecord[]) {
      records = [...next]
    },
    viewerLines,
  }
}

describe("HerdrTaskProjection", () => {
  it("keeps startup child listeners current when session resume arrives", async () => {
    const running = record({
      task_id: "st_child",
      status: "running",
      child_session_id: "session-child",
    })
    const harness = createHarness([running], async () => {}, false, true)

    await harness.projection.syncNow()
    expect(harness.created()).toBe(1)
    harness.projection.resume()
    await harness.projection.flush()
    harness.listeners.get("st_child")?.({
      type: "tool_execution_start",
      toolName: "bash",
    })
    await harness.projection.flush()

    expect(harness.lines).toContain("[tool] bash started")
  })

  it("projects a running native task with stable child session identity", async () => {
    const running = record({
      task_id: "st_child",
      status: "running",
      child_session_id: "session-child",
    })
    const harness = createHarness([running])

    await harness.projection.syncNow()

    expect(harness.reports).toEqual([
      {
        paneId: "w1:p2",
        taskId: "st_child",
        agentType: "explore",
        title: "Inspect auth",
        state: "working",
        stateLabel: "running",
        message: "running",
        sessionId: "session-child",
        sequence: 1,
      },
    ])
    expect(harness.lines).toContain("[running] explore st_child - Inspect auth")
    expect(harness.viewerLines[0]).toContain("[running] explore st_child - Inspect auth")
    expect(harness.listeners.has("st_child")).toBe(true)
  })

  it("projects before session identity arrives and adds it later", async () => {
    const running = record({ task_id: "st_child", status: "running" })
    const harness = createHarness([running])

    await harness.projection.syncNow()
    expect(harness.reports.at(-1)?.sessionId).toBeUndefined()

    harness.setRecords([{ ...running, child_session_id: "session-child" }])
    await harness.projection.syncNow()

    expect(harness.reports.at(-1)?.sessionId).toBe("session-child")
  })

  it("streams bounded child events and retains the pane in terminal state", async () => {
    const running = record({
      task_id: "st_child",
      status: "running",
      child_session_id: "session-child",
    })
    const harness = createHarness([running], async () => {}, true)
    await harness.projection.syncNow()

    const event: ManagedChildEvent = {
      type: "tool_execution_start",
      toolName: "bash",
    }
    harness.listeners.get("st_child")?.(event)
    harness.listeners.get("st_child")?.({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "HERDR_NATIVE_CHILD_SENTINEL" }],
      },
    })
    await harness.projection.flush()

    harness.setRecords([{ ...running, status: "completed" }])
    await harness.projection.syncNow()

    expect(harness.lines).toContain("[tool] bash started")
    expect(harness.lines).toContain("[message] HERDR_NATIVE_CHILD_SENTINEL")
    expect(harness.reports.at(-1)).toMatchObject({
      state: "idle",
      stateLabel: "completed",
      message: "completed",
      sequence: 2,
    })
    expect(harness.closed).toEqual([])
  })

  it("retries an unchanged terminal snapshot after report failure", async () => {
    const running = record({
      task_id: "st_child",
      status: "running",
      child_session_id: "session-child",
    })
    let failTerminal = true
    const harness = createHarness(
      [running],
      async () => {},
      false,
      false,
      async (report) => {
        if (report.state === "idle" && failTerminal) {
          failTerminal = false
          throw new Error("transient report failure")
        }
      },
    )
    await harness.projection.syncNow()

    harness.setRecords([{ ...running, status: "completed" }])
    await harness.projection.syncNow()
    await harness.projection.flush()

    expect(harness.errors).toHaveLength(1)
    expect(harness.reports.at(-1)).toMatchObject({
      state: "idle",
      sequence: 3,
    })
  })

  it("does not expose assistant message bodies by default", async () => {
    const harness = createHarness([
      record({
        task_id: "st_child",
        status: "running",
        child_session_id: "session-child",
      }),
    ])
    await harness.projection.syncNow()

    harness.listeners.get("st_child")?.({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "SECRET_SENTINEL" }],
      },
    })
    await harness.projection.flush()

    expect(harness.lines.join("\n")).not.toContain("SECRET_SENTINEL")
  })

  it("releases authority and closes only owned tabs on disposal", async () => {
    const harness = createHarness([
      record({
        task_id: "st_child",
        status: "running",
        child_session_id: "session-child",
      }),
    ])
    await harness.projection.syncNow()

    await harness.projection.dispose()

    expect(harness.released).toEqual([{ paneId: "w1:p2", taskId: "st_child", sequence: 2 }])
    expect(harness.closed).toEqual(["w1:t2"])
    expect(harness.listeners.size).toBe(0)
  })

  it("does not recreate old-session panes after clear until resumed", async () => {
    const harness = createHarness([
      record({
        task_id: "st_child",
        status: "running",
        child_session_id: "session-child",
      }),
    ])
    await harness.projection.syncNow()

    await harness.projection.clear()
    await harness.projection.syncNow()

    expect(harness.closed).toEqual(["w1:t2"])
    expect(harness.reports).toHaveLength(1)

    harness.projection.resume()
    await harness.projection.syncNow()

    expect(harness.reports).toHaveLength(2)
  })

  it("serializes clear behind in-flight writes and drops paused child events", async () => {
    const writeStarted = Promise.withResolvers<void>()
    const releaseWrite = Promise.withResolvers<void>()
    let blockWrites = false
    const harness = createHarness([
      record({
        task_id: "st_child",
        status: "running",
        child_session_id: "session-child",
      }),
    ], async () => {
      if (!blockWrites) return
      writeStarted.resolve()
      await releaseWrite.promise
    })
    await harness.projection.syncNow()
    blockWrites = true

    harness.listeners.get("st_child")?.({ type: "tool_execution_start", toolName: "bash" })
    await writeStarted.promise
    const clearing = harness.projection.clear()
    harness.listeners.get("st_child")?.({ type: "tool_execution_start", toolName: "read" })
    releaseWrite.resolve()
    await clearing
    await harness.projection.flush()

    expect(harness.lines).toContain("[tool] bash started")
    expect(harness.lines).not.toContain("[tool] read started")
    expect(harness.released).toHaveLength(1)
    expect(harness.closed).toEqual(["w1:t2"])
  })

  it("isolates Herdr command failures from task lifecycle", async () => {
    const harness = createHarness([
      record({
        task_id: "st_child",
        status: "running",
        child_session_id: "session-child",
      }),
    ])
    const projection = createHerdrTaskProjection({
      manager: {
        list: () => [{
          record: record({
            task_id: "st_child",
            status: "running",
            child_session_id: "session-child",
          }),
        }],
        subscribeChild: () => () => undefined,
      },
      client: {
        ...({
          async createTaskPane() {
            throw new Error("Herdr unavailable")
          },
        } satisfies Pick<HerdrTaskClient, "createTaskPane">),
        async startViewer() {},
        async reportTask() {},
        async writeLine() {},
        async releaseTask() {},
        async closeTab() {},
      },
      workspaceId: "w1",
      cwd: "C:\\repo",
      parentSessionId: () => PARENT_SESSION_ID,
      onError: (error) => harness.errors.push(error),
    })
    projection.resume()

    await expect(projection.flush()).resolves.toBeUndefined()
    expect(harness.errors).toHaveLength(1)
  })

  it("projects only direct in-process children owned by the current session", async () => {
    const harness = createHarness([
      record({
        task_id: "st_direct",
        status: "running",
        child_session_id: "session-direct",
      }),
      record({
        task_id: "st_nested",
        status: "running",
        parent_session_id: "session-other",
        root_session_id: PARENT_SESSION_ID,
        child_session_id: "session-nested",
      }),
      record({
        task_id: "st_process",
        status: "running",
        execution_mode: "process",
        child_session_id: "session-process",
      }),
    ])

    await harness.projection.syncNow()

    expect(harness.reports.map((item) => item.taskId)).toEqual(["st_direct"])
  })

  it("captures running and terminal snapshots without coalescing fast tasks away", async () => {
    const running = record({
      task_id: "st_fast",
      status: "running",
      child_session_id: "session-fast",
    })
    const harness = createHarness([running])

    harness.projection.scheduleSync()
    harness.setRecords([{ ...running, status: "completed" }])
    harness.projection.scheduleSync()
    await Promise.resolve()
    await harness.projection.flush()

    expect(harness.reports.map((item) => item.state)).toEqual(["working", "idle"])
  })

  it("drops queued old-generation snapshots across clear and resume", async () => {
    const harness = createHarness([
      record({
        task_id: "st_stale",
        status: "running",
        child_session_id: "session-stale",
      }),
    ])

    harness.projection.scheduleSync()
    harness.projection.scheduleSync()
    const clearing = harness.projection.clear()
    harness.projection.resume()
    await clearing
    await harness.projection.flush()

    expect(harness.created()).toBe(1)
    expect(harness.reports).toHaveLength(1)
    expect(harness.closed).toEqual([])
  })

  it("removes partial creation state so a later mutation can retry", async () => {
    const listeners = new Map<string, ManagedChildListener>()
    let creates = 0
    let reports = 0
    const closed: string[] = []
    const running = record({
      task_id: "st_retry",
      status: "running",
      child_session_id: "session-retry",
    })
    const projection = createHerdrTaskProjection({
      manager: {
        list: () => [{ record: running }],
        subscribeChild: (taskId, listener) => {
          listeners.set(taskId, listener)
          return () => listeners.delete(taskId)
        },
      },
      client: {
        async createTaskPane() {
          creates += 1
          return { paneId: `w1:p${creates}`, tabId: `w1:t${creates}` }
        },
        async startViewer() {},
        async reportTask() {
          reports += 1
          if (reports === 1) throw new Error("transient report failure")
        },
        async writeLine() {},
        async releaseTask() {},
        async closeTab(tabId) {
          closed.push(tabId)
        },
      },
      workspaceId: "w1",
      cwd: "C:\\repo",
      parentSessionId: () => PARENT_SESSION_ID,
      onError: () => {},
    })
    projection.resume()

    await projection.syncNow()
    await projection.syncNow()

    expect(creates).toBe(2)
    expect(reports).toBe(2)
    expect(closed).toEqual(["w1:t1"])
    expect(listeners.has("st_retry")).toBe(true)
  })

  it("buffers child events emitted while the pane is being created", async () => {
    const paneCreationStarted = Promise.withResolvers<void>()
    const releaseCreation = Promise.withResolvers<void>()
    const listeners = new Map<string, ManagedChildListener>()
    const lines: string[] = []
    const running = record({
      task_id: "st_buffered",
      status: "running",
      child_session_id: "session-buffered",
    })
    const projection = createHerdrTaskProjection({
      manager: {
        list: () => [{ record: running }],
        subscribeChild: (taskId, listener) => {
          listeners.set(taskId, listener)
          return () => listeners.delete(taskId)
        },
      },
      client: {
        async createTaskPane() {
          paneCreationStarted.resolve()
          await releaseCreation.promise
          return { paneId: "w1:p2", tabId: "w1:t2" }
        },
        async startViewer() {},
        async reportTask() {},
        async writeLine(_paneId, line) {
          lines.push(line)
        },
        async releaseTask() {},
        async closeTab() {},
      },
      workspaceId: "w1",
      cwd: "C:\\repo",
      parentSessionId: () => PARENT_SESSION_ID,
      onError: () => {},
      includeAssistantOutput: true,
    })
    projection.resume()

    const syncing = projection.syncNow()
    await paneCreationStarted.promise
    expect(listeners.has("st_buffered")).toBe(true)
    listeners.get("st_buffered")?.({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "BUFFERED_SENTINEL" }],
      },
    })
    releaseCreation.resolve()
    await syncing
    await projection.flush()

    expect(lines).toContain("[message] BUFFERED_SENTINEL")
  })
})
