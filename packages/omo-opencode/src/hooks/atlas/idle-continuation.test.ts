import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBoulderState, writeBoulderState } from "../../features/boulder-state"
import { scheduleRetry } from "./idle-continuation"
import type { SessionState } from "./types"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

type SetTimeoutParameters = Parameters<typeof setTimeout>
type SetTimeoutRestParameters = SetTimeoutParameters extends [
  SetTimeoutParameters[0],
  SetTimeoutParameters[1]?,
  ...infer Rest,
] ? Rest : never

describe("scheduleRetry", () => {
  const sessionID = "session-main-1"
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const originalDateNow = Date.now
  const capturedTimers = new Map<number, { readonly callback: () => void | Promise<void> }>()
  let testDirectory = ""
  let nextTimerId = 1000

  beforeEach(() => {
    testDirectory = join(tmpdir(), `atlas-idle-continuation-${randomUUID()}`)
    if (!existsSync(testDirectory)) {
      mkdirSync(testDirectory, { recursive: true })
    }

    capturedTimers.clear()
    nextTimerId = 1000
    Date.now = () => 10_000

    const fakeSetTimeout = Object.assign(
      (
        callback: SetTimeoutParameters[0],
        delay?: SetTimeoutParameters[1],
        ...args: SetTimeoutRestParameters
      ): ReturnType<typeof setTimeout> => {
        if (typeof callback !== "function") {
          return originalSetTimeout(callback, delay, ...args)
        }

        const timerId = nextTimerId
        nextTimerId += 1
        capturedTimers.set(timerId, { callback: () => callback(...args) })
        return unsafeTestValue<ReturnType<typeof setTimeout>>(timerId)
      },
      { __promisify__: originalSetTimeout.__promisify__ },
    )
    globalThis.setTimeout = fakeSetTimeout

    const fakeClearTimeout = (timerId?: Parameters<typeof clearTimeout>[0]): void => {
      if (typeof timerId === "number") {
        capturedTimers.delete(timerId)
        return
      }

      originalClearTimeout(unsafeTestValue<Parameters<typeof originalClearTimeout>[0]>(timerId))
    }
    globalThis.clearTimeout = unsafeTestValue<typeof clearTimeout>(fakeClearTimeout)
  })

  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
    Date.now = originalDateNow
    if (existsSync(testDirectory)) {
      rmSync(testDirectory, { recursive: true, force: true })
    }
  })

  test("#given retry timer callback throws #when retry fires #then failure is recorded and retry is rearmed", async () => {
    // given
    const planPath = join(testDirectory, "plan.md")
    writeFileSync(planPath, "## TODOs\n- [ ] 1. Parse input\n")
    writeBoulderState(testDirectory, createBoulderState(planPath, sessionID, "atlas"))

    const sessionState: SessionState = { promptFailureCount: 0 }
    const ctx = unsafeTestValue<PluginInput>({
      directory: testDirectory,
      client: {
        session: {
          promptAsync: mock(async () => ({ data: {} })),
        },
      },
    })

    scheduleRetry({
      ctx,
      sessionID,
      sessionState,
      options: {
        directory: testDirectory,
        backgroundManager: {
          getTasksByParentSession: () => {
            throw new Error("background status unavailable")
          },
        },
      },
    })

    const firstTimer = capturedTimers.get(1000)
    if (!firstTimer) {
      throw new Error("Expected retry timer")
    }

    // when
    await firstTimer.callback()

    // then
    expect(sessionState.promptFailureCount).toBe(1)
    expect(sessionState.lastFailureAt).toBe(10_000)
    expect(sessionState.pendingRetryTimer).toBeDefined()
    expect(capturedTimers.has(1001)).toBe(true)
  })
})
