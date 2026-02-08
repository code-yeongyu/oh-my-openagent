import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { BackgroundManager } from "../features/background-agent"
import { setMainSession, subagentSessions, _resetForTesting } from "../features/claude-code-session-state"
import type { OhMyOpenCodeConfig } from "../config/schema"
import { TaskObjectSchema } from "../tools/task/types"
import type { TaskObject } from "../tools/task/types"
import { createTaskContinuationEnforcer } from "./task-continuation-enforcer"

type TimerCallback = (...args: any[]) => void

interface FakeTimers {
  advanceBy: (ms: number, advanceClock?: boolean) => Promise<void>
  restore: () => void
}

function createFakeTimers(): FakeTimers {
  const originalNow = Date.now()
  let clockNow = originalNow
  let timerNow = 0
  let nextId = 1
  const timers = new Map<number, { id: number; time: number; interval: number | null; callback: TimerCallback; args: any[] }>()
  const cleared = new Set<number>()

  const original = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    dateNow: Date.now,
  }

  const normalizeDelay = (delay?: number) => {
    if (typeof delay !== "number" || !Number.isFinite(delay)) return 0
    return delay < 0 ? 0 : delay
  }

  const schedule = (callback: TimerCallback, delay: number | undefined, interval: number | null, args: any[]) => {
    const id = nextId++
    timers.set(id, {
      id,
      time: timerNow + normalizeDelay(delay),
      interval,
      callback,
      args,
    })
    return id
  }

  const clear = (id: number | undefined) => {
    if (typeof id !== "number") return
    cleared.add(id)
    timers.delete(id)
  }

  globalThis.setTimeout = ((callback: TimerCallback, delay?: number, ...args: any[]) => {
    return schedule(callback, delay, null, args) as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout

  globalThis.setInterval = ((callback: TimerCallback, delay?: number, ...args: any[]) => {
    const interval = normalizeDelay(delay)
    return schedule(callback, delay, interval, args) as unknown as ReturnType<typeof setInterval>
  }) as typeof setInterval

  globalThis.clearTimeout = ((id?: number) => {
    clear(id)
  }) as typeof clearTimeout

  globalThis.clearInterval = ((id?: number) => {
    clear(id)
  }) as typeof clearInterval

  Date.now = () => clockNow

  const advanceBy = async (ms: number, advanceClock: boolean = false) => {
    const clamped = Math.max(0, ms)
    const target = timerNow + clamped
    if (advanceClock) {
      clockNow += clamped
    }
    while (true) {
      let next: { id: number; time: number; interval: number | null; callback: TimerCallback; args: any[] } | undefined
      for (const timer of timers.values()) {
        if (timer.time <= target && (!next || timer.time < next.time)) {
          next = timer
        }
      }
      if (!next) break

      timerNow = next.time
      timers.delete(next.id)
      next.callback(...next.args)

      if (next.interval !== null && !cleared.has(next.id)) {
        timers.set(next.id, {
          id: next.id,
          time: timerNow + next.interval,
          interval: next.interval,
          callback: next.callback,
          args: next.args,
        })
      } else {
        cleared.delete(next.id)
      }

      await Promise.resolve()
    }
    timerNow = target
    await Promise.resolve()
  }

  const restore = () => {
    globalThis.setTimeout = original.setTimeout
    globalThis.clearTimeout = original.clearTimeout
    globalThis.setInterval = original.setInterval
    globalThis.clearInterval = original.clearInterval
    Date.now = original.dateNow
  }

  return { advanceBy, restore }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe("task-continuation-enforcer", () => {
  let promptCalls: Array<{ sessionID: string; agent?: string; model?: { providerID?: string; modelID?: string }; text: string }>
  let toastCalls: Array<{ title: string; message: string }>
  let fakeTimers: FakeTimers
  let taskDir: string

  interface MockMessage {
    info: {
      id: string
      role: "user" | "assistant"
      error?: { name: string; data?: { message: string } }
    }
  }

  let mockMessages: MockMessage[] = []

  function createMockPluginInput() {
    return {
      client: {
        session: {
          messages: async () => ({ data: mockMessages }),
          prompt: async (opts: any) => {
            promptCalls.push({
              sessionID: opts.path.id,
              agent: opts.body.agent,
              model: opts.body.model,
              text: opts.body.parts[0].text,
            })
            return {}
          },
        },
        tui: {
          showToast: async (opts: any) => {
            toastCalls.push({
              title: opts.body.title,
              message: opts.body.message,
            })
            return {}
          },
        },
      },
      directory: "/tmp/test",
    } as any
  }

  function createTempTaskDir(): string {
    return mkdtempSync(join(tmpdir(), "omo-task-continuation-"))
  }

  function writeTaskFile(dir: string, task: TaskObject): void {
    const parsed = TaskObjectSchema.safeParse(task)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    writeFileSync(join(dir, `${parsed.data.id}.json`), JSON.stringify(parsed.data), "utf-8")
  }

  function writeCorruptedTaskFile(dir: string, taskId: string): void {
    writeFileSync(join(dir, `${taskId}.json`), "{ this is not valid json", "utf-8")
  }

  function createConfig(dir: string): Partial<OhMyOpenCodeConfig> {
    return {
      sisyphus: {
        tasks: {
          claude_code_compat: true,
          storage_path: dir,
        },
      },
    }
  }

  function createMockBackgroundManager(runningTasks: boolean = false): BackgroundManager {
    return {
      getTasksByParentSession: () => (runningTasks ? [{ status: "running" }] : []),
    } as any
  }

  beforeEach(() => {
    fakeTimers = createFakeTimers()
    _resetForTesting()
    promptCalls = []
    toastCalls = []
    mockMessages = []
    taskDir = createTempTaskDir()
  })

  afterEach(() => {
    fakeTimers.restore()
    _resetForTesting()
    rmSync(taskDir, { recursive: true, force: true })
  })

  test("should inject continuation when idle with incomplete tasks on disk", async () => {
    fakeTimers.restore()
    // given - main session with incomplete tasks
    const sessionID = "main-123"
    setMainSession(sessionID)

    writeTaskFile(taskDir, {
      id: "T-1",
      subject: "Task 1",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "test",
    })
    writeTaskFile(taskDir, {
      id: "T-2",
      subject: "Task 2",
      description: "",
      status: "completed",
      blocks: [],
      blockedBy: [],
      threadID: "test",
    })

    const hook = createTaskContinuationEnforcer(createMockPluginInput(), createConfig(taskDir), {
      backgroundManager: new BackgroundManager(createMockPluginInput()),
    })

    // when - session goes idle
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })

    // then - countdown toast shown
    await wait(50)
    expect(toastCalls.length).toBeGreaterThanOrEqual(1)
    expect(toastCalls[0].title).toBe("Task Continuation")

    // then - after countdown, continuation injected
    await wait(2500)
    expect(promptCalls.length).toBe(1)
    expect(promptCalls[0].text).toContain("TASK CONTINUATION")
  }, { timeout: 15000 })

  test("should NOT inject when all tasks are completed", async () => {
    // given - session with all tasks completed
    const sessionID = "main-456"
    setMainSession(sessionID)

    writeTaskFile(taskDir, {
      id: "T-1",
      subject: "Task 1",
      description: "",
      status: "completed",
      blocks: [],
      blockedBy: [],
      threadID: "test",
    })

    const hook = createTaskContinuationEnforcer(createMockPluginInput(), createConfig(taskDir), {})

    // when - session goes idle
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await fakeTimers.advanceBy(3000)

    // then - no continuation injected
    expect(promptCalls).toHaveLength(0)
  })

  test("should NOT inject when all tasks are deleted", async () => {
    // given - session with all tasks deleted
    const sessionID = "main-deleted"
    setMainSession(sessionID)

    writeTaskFile(taskDir, {
      id: "T-1",
      subject: "Task 1",
      description: "",
      status: "deleted",
      blocks: [],
      blockedBy: [],
      threadID: "test",
    })

    const hook = createTaskContinuationEnforcer(createMockPluginInput(), createConfig(taskDir), {})

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await fakeTimers.advanceBy(3000)

    // then
    expect(promptCalls).toHaveLength(0)
  })

  test("should NOT inject when no task files exist", async () => {
    // given - empty task directory
    const sessionID = "main-none"
    setMainSession(sessionID)

    const hook = createTaskContinuationEnforcer(createMockPluginInput(), createConfig(taskDir), {})

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await fakeTimers.advanceBy(3000)

    // then
    expect(promptCalls).toHaveLength(0)
  })

  test("should NOT inject when background tasks are running", async () => {
    // given - session with incomplete tasks and running background tasks
    const sessionID = "main-bg-running"
    setMainSession(sessionID)

    writeTaskFile(taskDir, {
      id: "T-1",
      subject: "Task 1",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "test",
    })

    const hook = createTaskContinuationEnforcer(createMockPluginInput(), createConfig(taskDir), {
      backgroundManager: createMockBackgroundManager(true),
    })

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await fakeTimers.advanceBy(3000)

    // then
    expect(promptCalls).toHaveLength(0)
  })

  test("should NOT inject for non-main session", async () => {
    // given - main session set, different session goes idle
    setMainSession("main-session")
    const otherSession = "other-session"

    writeTaskFile(taskDir, {
      id: "T-1",
      subject: "Task 1",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "test",
    })

    const hook = createTaskContinuationEnforcer(createMockPluginInput(), createConfig(taskDir), {})

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID: otherSession } } })
    await fakeTimers.advanceBy(3000)

    // then
    expect(promptCalls).toHaveLength(0)
  })

  test("should inject for background task session (subagent)", async () => {
    fakeTimers.restore()
    // given - main session set, background task session registered
    setMainSession("main-session")
    const bgTaskSession = "bg-task-session"
    subagentSessions.add(bgTaskSession)

    writeTaskFile(taskDir, {
      id: "T-1",
      subject: "Task 1",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "test",
    })

    const hook = createTaskContinuationEnforcer(createMockPluginInput(), createConfig(taskDir), {})

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID: bgTaskSession } } })

    // then
    await wait(2500)
    expect(promptCalls.length).toBe(1)
    expect(promptCalls[0].sessionID).toBe(bgTaskSession)
  }, { timeout: 15000 })

  test("should cancel countdown on user message after grace period", async () => {
    // given
    const sessionID = "main-cancel"
    setMainSession(sessionID)

    writeTaskFile(taskDir, {
      id: "T-1",
      subject: "Task 1",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "test",
    })

    const hook = createTaskContinuationEnforcer(createMockPluginInput(), createConfig(taskDir), {})

    // when - session goes idle
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })

    // when - wait past grace period (500ms), then user sends message
    await fakeTimers.advanceBy(600, true)
    await hook.handler({
      event: {
        type: "message.updated",
        properties: { info: { sessionID, role: "user" } },
      },
    })

    // then
    await fakeTimers.advanceBy(2500)
    expect(promptCalls).toHaveLength(0)
  })

  test("should ignore user message within grace period", async () => {
    fakeTimers.restore()
    // given
    const sessionID = "main-grace"
    setMainSession(sessionID)

    writeTaskFile(taskDir, {
      id: "T-1",
      subject: "Task 1",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "test",
    })

    const hook = createTaskContinuationEnforcer(createMockPluginInput(), createConfig(taskDir), {})

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await hook.handler({
      event: {
        type: "message.updated",
        properties: { info: { sessionID, role: "user" } },
      },
    })

    // then - countdown should continue
    await wait(2500)
    expect(promptCalls).toHaveLength(1)
  }, { timeout: 15000 })

  test("should cancel countdown on assistant activity", async () => {
    // given
    const sessionID = "main-assistant"
    setMainSession(sessionID)

    writeTaskFile(taskDir, {
      id: "T-1",
      subject: "Task 1",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "test",
    })

    const hook = createTaskContinuationEnforcer(createMockPluginInput(), createConfig(taskDir), {})

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await fakeTimers.advanceBy(500)
    await hook.handler({
      event: {
        type: "message.part.updated",
        properties: { info: { sessionID, role: "assistant" } },
      },
    })

    // then
    await fakeTimers.advanceBy(3000)
    expect(promptCalls).toHaveLength(0)
  })

  test("should cancel countdown on tool execution", async () => {
    // given
    const sessionID = "main-tool"
    setMainSession(sessionID)

    writeTaskFile(taskDir, {
      id: "T-1",
      subject: "Task 1",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "test",
    })

    const hook = createTaskContinuationEnforcer(createMockPluginInput(), createConfig(taskDir), {})

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await fakeTimers.advanceBy(500)
    await hook.handler({ event: { type: "tool.execute.before", properties: { sessionID } } })

    // then
    await fakeTimers.advanceBy(3000)
    expect(promptCalls).toHaveLength(0)
  })

  test("should skip injection during recovery mode", async () => {
    // given
    const sessionID = "main-recovery"
    setMainSession(sessionID)

    writeTaskFile(taskDir, {
      id: "T-1",
      subject: "Task 1",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "test",
    })

    const hook = createTaskContinuationEnforcer(createMockPluginInput(), createConfig(taskDir), {})

    // when
    hook.markRecovering(sessionID)
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await fakeTimers.advanceBy(3000)

    // then
    expect(promptCalls).toHaveLength(0)
  })

  test("should inject after recovery complete", async () => {
    fakeTimers.restore()
    // given
    const sessionID = "main-recovery-done"
    setMainSession(sessionID)

    writeTaskFile(taskDir, {
      id: "T-1",
      subject: "Task 1",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "test",
    })

    const hook = createTaskContinuationEnforcer(createMockPluginInput(), createConfig(taskDir), {})

    // when
    hook.markRecovering(sessionID)
    hook.markRecoveryComplete(sessionID)
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })

    // then
    await wait(3000)
    expect(promptCalls.length).toBe(1)
  }, { timeout: 15000 })

  test("should cleanup on session deleted", async () => {
    // given
    const sessionID = "main-delete"
    setMainSession(sessionID)

    writeTaskFile(taskDir, {
      id: "T-1",
      subject: "Task 1",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "test",
    })

    const hook = createTaskContinuationEnforcer(createMockPluginInput(), createConfig(taskDir), {})

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await fakeTimers.advanceBy(500)
    await hook.handler({ event: { type: "session.deleted", properties: { info: { id: sessionID } } } })
    await fakeTimers.advanceBy(3000)

    // then
    expect(promptCalls).toHaveLength(0)
  })

  test("should skip when last assistant message was aborted (API fallback)", async () => {
    // given
    const sessionID = "main-api-abort"
    setMainSession(sessionID)

    writeTaskFile(taskDir, {
      id: "T-1",
      subject: "Task 1",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "test",
    })

    mockMessages = [
      { info: { id: "msg-1", role: "user" } },
      { info: { id: "msg-2", role: "assistant", error: { name: "MessageAbortedError", data: { message: "aborted" } } } },
    ]

    const hook = createTaskContinuationEnforcer(createMockPluginInput(), createConfig(taskDir), {})

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await fakeTimers.advanceBy(3000)

    // then
    expect(promptCalls).toHaveLength(0)
  })

  test("should skip when abort detected via session.error event", async () => {
    // given
    const sessionID = "main-event-abort"
    setMainSession(sessionID)

    writeTaskFile(taskDir, {
      id: "T-1",
      subject: "Task 1",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "test",
    })

    mockMessages = [
      { info: { id: "msg-1", role: "user" } },
      { info: { id: "msg-2", role: "assistant" } },
    ]

    const hook = createTaskContinuationEnforcer(createMockPluginInput(), createConfig(taskDir), {})

    // when - abort error event fires
    await hook.handler({
      event: {
        type: "session.error",
        properties: { sessionID, error: { name: "MessageAbortedError" } },
      },
    })

    // when - session goes idle immediately after
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await fakeTimers.advanceBy(3000)

    // then
    expect(promptCalls).toHaveLength(0)
  })

  test("should handle corrupted task files gracefully (readJsonSafe returns null)", async () => {
    fakeTimers.restore()
    // given
    const sessionID = "main-corrupt"
    setMainSession(sessionID)

    writeCorruptedTaskFile(taskDir, "T-corrupt")
    writeTaskFile(taskDir, {
      id: "T-ok",
      subject: "Task OK",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "test",
    })

    const hook = createTaskContinuationEnforcer(createMockPluginInput(), createConfig(taskDir), {})

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await wait(2500)

    // then
    expect(promptCalls).toHaveLength(1)
  }, { timeout: 15000 })

  test("should NOT inject when isContinuationStopped returns true", async () => {
    // given
    const sessionID = "main-stopped"
    setMainSession(sessionID)

    writeTaskFile(taskDir, {
      id: "T-1",
      subject: "Task 1",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "test",
    })

    const hook = createTaskContinuationEnforcer(createMockPluginInput(), createConfig(taskDir), {
      isContinuationStopped: (id) => id === sessionID,
    })

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await fakeTimers.advanceBy(3000)

    // then
    expect(promptCalls).toHaveLength(0)
  })

  test("should cancel all countdowns via cancelAllCountdowns", async () => {
    // given
    const sessionID = "main-cancel-all"
    setMainSession(sessionID)

    writeTaskFile(taskDir, {
      id: "T-1",
      subject: "Task 1",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: "test",
    })

    const hook = createTaskContinuationEnforcer(createMockPluginInput(), createConfig(taskDir), {})

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await fakeTimers.advanceBy(500)
    hook.cancelAllCountdowns()
    await fakeTimers.advanceBy(3000)

    // then
    expect(promptCalls).toHaveLength(0)
  })
})
