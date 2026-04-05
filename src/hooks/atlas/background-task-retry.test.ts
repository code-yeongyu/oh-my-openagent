import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import type { PluginInput } from "@opencode-ai/plugin"
import { createAtlasHook } from "./atlas-hook"
import { clearBoulderState, writeBoulderState } from "../../features/boulder-state"
import { _resetForTesting, registerAgentName } from "../../features/claude-code-session-state"

type LongTimerCallback = (...args: unknown[]) => void | Promise<void>

describe("atlas background task retry", () => {
  let testDir: string
  const sessionID = "main-session-123"
  const capturedTimers = new Map<number, { callback: () => Promise<void> | void; cleared: boolean }>()
  let nextFakeTimerId = 1000
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout

  async function flushMicrotasks(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
  }

  function createDeferred<T>(): {
    promise: Promise<T>
    resolve: (value: T | PromiseLike<T>) => void
    reject: (reason?: unknown) => void
  } {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    return { promise, resolve, reject }
  }

  async function firePendingTimers(): Promise<void> {
    const entries = [...capturedTimers.entries()]
    for (const [id, entry] of entries) {
      if (entry.cleared) {
        continue
      }

      capturedTimers.delete(id)
      await entry.callback()
    }
    await flushMicrotasks()
  }

  beforeEach(() => {
    _resetForTesting()
    registerAgentName("atlas")
    registerAgentName("sisyphus")

    testDir = join(tmpdir(), `atlas-background-retry-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })

    capturedTimers.clear()
    nextFakeTimerId = 1000

    globalThis.setTimeout = ((callback: Parameters<typeof setTimeout>[0], delay?: number, ...args: unknown[]) => {
      const normalizedDelay = typeof delay === "number" ? delay : 0
      if (typeof callback !== "function") {
        return originalSetTimeout(callback, delay, ...args)
      }

      if (normalizedDelay >= 5000) {
        const id = nextFakeTimerId++
        capturedTimers.set(id, {
          callback: () => (callback as LongTimerCallback)(...args),
          cleared: false,
        })
        return id as unknown as ReturnType<typeof setTimeout>
      }

      return originalSetTimeout(callback, delay, ...args)
    }) as typeof setTimeout

    globalThis.clearTimeout = ((id?: number | ReturnType<typeof setTimeout>) => {
      if (typeof id === "number" && capturedTimers.has(id)) {
        capturedTimers.get(id)!.cleared = true
        capturedTimers.delete(id)
        return
      }

      originalClearTimeout(id as Parameters<typeof clearTimeout>[0])
    }) as typeof clearTimeout
  })

  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
    _resetForTesting()
    clearBoulderState(testDir)
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test("#given background tasks are still running #when retry fires before they finish #then atlas keeps retrying until continuation can resume", async () => {
    // given
    const planPath = join(testDir, "test-plan.md")
    writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")
    writeBoulderState(testDir, {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [sessionID],
      plan_name: "test-plan",
      agent: "atlas",
    })

    let backgroundRunning = true
    const promptMock = mock(async () => ({}))
    const hook = createAtlasHook({
      directory: testDir,
      client: {
        session: {
          promptAsync: promptMock,
          messages: async () => ({ data: [] }),
        },
      },
    } as unknown as PluginInput, {
      directory: testDir,
      backgroundManager: {
        getTasksByParentSession: () => backgroundRunning ? [{ status: "running" }] : [],
      } as unknown as NonNullable<Parameters<typeof createAtlasHook>[1]>["backgroundManager"] & {
        getTasksByParentSession: (sessionID: string) => Array<{ status: string }>
      },
    })

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await firePendingTimers()
    backgroundRunning = false
    await firePendingTimers()

    // then
    expect(promptMock).toHaveBeenCalledTimes(1)
  })

  test("#given multiple idle events arrive while background retry is already pending #when tasks are still running #then atlas keeps only one retry timer active", async () => {
    // given
    const planPath = join(testDir, "test-plan.md")
    writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")
    writeBoulderState(testDir, {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [sessionID],
      plan_name: "test-plan",
      agent: "atlas",
    })

    let backgroundRunning = true
    const promptMock = mock(async () => ({}))
    const hook = createAtlasHook({
      directory: testDir,
      client: {
        session: {
          promptAsync: promptMock,
          messages: async () => ({ data: [] }),
        },
      },
    } as unknown as PluginInput, {
      directory: testDir,
      backgroundManager: {
        getTasksByParentSession: () => backgroundRunning ? [{ status: "running" }] : [],
      } as unknown as NonNullable<Parameters<typeof createAtlasHook>[1]>["backgroundManager"] & {
        getTasksByParentSession: (sessionID: string) => Array<{ status: string }>
      },
    })

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })

    // then
    expect(capturedTimers.size).toBe(1)
    backgroundRunning = false
    await firePendingTimers()
    expect(promptMock).toHaveBeenCalledTimes(1)
  })

  test("#given background tasks keep running across multiple retries #when they finally finish on a later retry #then atlas resumes exactly once", async () => {
    // given
    const planPath = join(testDir, "test-plan.md")
    writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")
    writeBoulderState(testDir, {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [sessionID],
      plan_name: "test-plan",
      agent: "atlas",
    })

    let remainingRunningRetries = 2
    const promptMock = mock(async () => ({}))
    const hook = createAtlasHook({
      directory: testDir,
      client: {
        session: {
          promptAsync: promptMock,
          messages: async () => ({ data: [] }),
        },
      },
    } as unknown as PluginInput, {
      directory: testDir,
      backgroundManager: {
        getTasksByParentSession: () => {
          if (remainingRunningRetries > 0) {
            remainingRunningRetries -= 1
            return [{ status: "running" }]
          }

          return []
        },
      } as unknown as NonNullable<Parameters<typeof createAtlasHook>[1]>["backgroundManager"] & {
        getTasksByParentSession: (sessionID: string) => Array<{ status: string }>
      },
    })

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    expect(capturedTimers.size).toBe(1)

    await firePendingTimers()
    expect(promptMock).toHaveBeenCalledTimes(0)
    expect(capturedTimers.size).toBe(1)

    await firePendingTimers()

    // then
    expect(promptMock).toHaveBeenCalledTimes(1)
    expect(capturedTimers.size).toBe(0)
  })

  test("#given retry gate sees no running task but injector still does #when retry fires #then atlas schedules another retry and does not advance cooldown", async () => {
    // given
    const planPath = join(testDir, "test-plan.md")
    writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")
    writeBoulderState(testDir, {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [sessionID],
      plan_name: "test-plan",
      agent: "atlas",
    })

    const promptAsyncMock = mock(async () => ({}))
    let backgroundCheckCount = 0

    const hook = createAtlasHook({
      directory: testDir,
      client: {
        session: {
          promptAsync: promptAsyncMock,
          messages: async () => ({ data: [] }),
        },
      },
    } as unknown as PluginInput, {
      directory: testDir,
      backgroundManager: {
        getTasksByParentSession: () => {
          backgroundCheckCount += 1
          if (backgroundCheckCount === 1) {
            return []
          }

          if (backgroundCheckCount === 2) {
            return [{ status: "running" }]
          }

          return []
        },
      } as unknown as NonNullable<Parameters<typeof createAtlasHook>[1]>["backgroundManager"] & {
        getTasksByParentSession: (sessionID: string) => Array<{ status: string }>
      },
    })

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    expect(capturedTimers.size).toBe(1)
    expect(promptAsyncMock).toHaveBeenCalledTimes(0)

    await firePendingTimers()

    // then
    expect(backgroundCheckCount).toBe(4)
    expect(capturedTimers.size).toBe(0)
    expect(promptAsyncMock).toHaveBeenCalledTimes(1)
  })

  test("#given a retry timer is pending #when a normal idle event resumes work first #then the stale retry timer does not inject again", async () => {
    // given
    const planPath = join(testDir, "test-plan.md")
    writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")
    writeBoulderState(testDir, {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [sessionID],
      plan_name: "test-plan",
      agent: "atlas",
    })

    let backgroundRunning = true
    const promptAsyncMock = mock(async () => ({}))
    const hook = createAtlasHook({
      directory: testDir,
      client: {
        session: {
          promptAsync: promptAsyncMock,
          messages: async () => ({ data: [] }),
        },
      },
    } as unknown as PluginInput, {
      directory: testDir,
      backgroundManager: {
        getTasksByParentSession: () => backgroundRunning ? [{ status: "running" }] : [],
      } as unknown as NonNullable<Parameters<typeof createAtlasHook>[1]>["backgroundManager"] & {
        getTasksByParentSession: (sessionID: string) => Array<{ status: string }>
      },
    })

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    expect(capturedTimers.size).toBe(1)

    backgroundRunning = false
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    expect(promptAsyncMock).toHaveBeenCalledTimes(1)
    expect(capturedTimers.size).toBe(0)

    await firePendingTimers()

    // then
    expect(promptAsyncMock).toHaveBeenCalledTimes(1)
  })

  test("#given a persisted descendant becomes ineligible before retry fires #when retry runs #then atlas re-checks descendant eligibility and does not inject", async () => {
    // given
    const descendantSessionID = "ses_descendant_retry_mismatch"
    const planPath = join(testDir, "test-plan.md")
    writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")
    writeBoulderState(testDir, {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [sessionID, descendantSessionID],
      session_origins: {
        [sessionID]: "direct",
        [descendantSessionID]: "appended",
      },
      plan_name: "test-plan",
      agent: "atlas",
    })

    let backgroundRunning = true
    let descendantAgent = "atlas"
    const promptAsyncMock = mock(async () => ({}))
    const hook = createAtlasHook({
      directory: testDir,
      client: {
        session: {
          get: async ({ path }: { path: { id: string } }) => ({
            data: {
              id: path.id,
              parentID: path.id === descendantSessionID ? sessionID : undefined,
            },
          }),
          promptAsync: promptAsyncMock,
          messages: async ({ path }: { path: { id: string } }) => ({
            data: path.id === descendantSessionID
              ? [{ info: { agent: descendantAgent, providerID: "openai", modelID: "gpt-5.4" } }]
              : [],
          }),
        },
      },
    } as unknown as PluginInput, {
      directory: testDir,
      backgroundManager: {
        getTasksByParentSession: (currentSessionID: string) => {
          if (currentSessionID !== descendantSessionID) {
            return []
          }
          return backgroundRunning ? [{ status: "running" }] : []
        },
      } as unknown as NonNullable<Parameters<typeof createAtlasHook>[1]>["backgroundManager"] & {
        getTasksByParentSession: (sessionID: string) => Array<{ status: string }>
      },
    })

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID: descendantSessionID } } })
    expect(capturedTimers.size).toBe(1)
    descendantAgent = "sisyphus-junior"
    backgroundRunning = false
    await firePendingTimers()

    // then
    expect(promptAsyncMock).toHaveBeenCalledTimes(0)
  })

  test("#given continuation injection is already in flight #when another idle event arrives #then atlas does not inject twice", async () => {
    // given
    const planPath = join(testDir, "test-plan.md")
    writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")
    writeBoulderState(testDir, {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [sessionID],
      plan_name: "test-plan",
      agent: "atlas",
    })

    const deferredPrompt = createDeferred<{}>()
    const promptAsyncMock = mock(() => deferredPrompt.promise)
    const hook = createAtlasHook({
      directory: testDir,
      client: {
        session: {
          promptAsync: promptAsyncMock,
          messages: async () => ({ data: [] }),
        },
      },
    } as unknown as PluginInput)

    // when
    const firstIdle = hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await flushMicrotasks()
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    deferredPrompt.resolve({})
    await firstIdle

    // then
    expect(promptAsyncMock).toHaveBeenCalledTimes(1)
  })

  test("#given a retry timer fires during an in-flight continuation that later fails #when the in-flight guard re-arms retry #then atlas can recover on the next retry", async () => {
    // given
    const planPath = join(testDir, "test-plan.md")
    writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")
    writeBoulderState(testDir, {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [sessionID],
      plan_name: "test-plan",
      agent: "atlas",
    })

    const deferredPrompt = createDeferred<unknown>()
    const promptAsyncMock = mock(() => deferredPrompt.promise)
    promptAsyncMock.mockImplementationOnce(() => deferredPrompt.promise)
    promptAsyncMock.mockImplementationOnce(async () => ({}))

    const hook = createAtlasHook({
      directory: testDir,
      client: {
        session: {
          promptAsync: promptAsyncMock,
          messages: async () => ({ data: [] }),
        },
      },
    } as unknown as PluginInput, {
      directory: testDir,
      backgroundManager: {
        getTasksByParentSession: () => [],
      } as unknown as NonNullable<Parameters<typeof createAtlasHook>[1]>["backgroundManager"] & {
        getTasksByParentSession: (sessionID: string) => Array<{ status: string }>
      },
    })

    // when
    const firstIdle = hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    await flushMicrotasks()
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    expect(capturedTimers.size).toBe(1)

    await firePendingTimers()
    expect(capturedTimers.size).toBe(1)

    deferredPrompt.reject(new Error("slow failure"))
    await firstIdle
    await firePendingTimers()

    // then
    expect(promptAsyncMock).toHaveBeenCalledTimes(2)
  })

  test("#given a retry-driven continuation fails once #when retry handling re-arms the chain #then atlas recovers on the next retry", async () => {
    // given
    const planPath = join(testDir, "test-plan.md")
    writeFileSync(planPath, "# Plan\n- [ ] Task 1\n- [ ] Task 2")
    writeBoulderState(testDir, {
      active_plan: planPath,
      started_at: "2026-01-02T10:00:00Z",
      session_ids: [sessionID],
      plan_name: "test-plan",
      agent: "atlas",
    })

    let backgroundRunning = true
    const promptAsyncMock = mock(async () => ({}))
    promptAsyncMock.mockImplementationOnce(async () => {
      throw new Error("retry failed once")
    })
    promptAsyncMock.mockImplementationOnce(async () => ({}))

    const hook = createAtlasHook({
      directory: testDir,
      client: {
        session: {
          promptAsync: promptAsyncMock,
          messages: async () => ({ data: [] }),
        },
      },
    } as unknown as PluginInput, {
      directory: testDir,
      backgroundManager: {
        getTasksByParentSession: () => backgroundRunning ? [{ status: "running" }] : [],
      } as unknown as NonNullable<Parameters<typeof createAtlasHook>[1]>["backgroundManager"] & {
        getTasksByParentSession: (sessionID: string) => Array<{ status: string }>
      },
    })

    // when
    await hook.handler({ event: { type: "session.idle", properties: { sessionID } } })
    backgroundRunning = false

    await firePendingTimers()
    expect(promptAsyncMock).toHaveBeenCalledTimes(1)
    expect(capturedTimers.size).toBe(1)

    await firePendingTimers()

    // then
    expect(promptAsyncMock).toHaveBeenCalledTimes(2)
    expect(capturedTimers.size).toBe(0)
  })
})
