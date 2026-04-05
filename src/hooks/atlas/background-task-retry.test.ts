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
})
