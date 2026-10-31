import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBoulderState, writeBoulderState } from "../../features/boulder-state"
import { scheduleRetry } from "./idle-continuation"
import type { AtlasRetryScheduler, SessionState } from "./types"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

describe("scheduleRetry", () => {
  const sessionID = "session-main-1"
  const originalDateNow = Date.now
  const capturedTimers = new Map<number, { readonly callback: () => void | Promise<void> }>()
  let testDirectory = ""
  let nextTimerId = 1000
  const retryScheduler: AtlasRetryScheduler = (callback) => {
    const timerId = nextTimerId
    nextTimerId += 1
    capturedTimers.set(timerId, { callback })
    return { cancel: () => { capturedTimers.delete(timerId) } }
  }

  beforeEach(() => {
    testDirectory = join(tmpdir(), `atlas-idle-continuation-${randomUUID()}`)
    if (!existsSync(testDirectory)) {
      mkdirSync(testDirectory, { recursive: true })
    }

    capturedTimers.clear()
    nextTimerId = 1000
    Date.now = () => 10_000
  })

  afterEach(() => {
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
        retryScheduler,
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

  test("#given the active plan has no countable tasks #when a pending retry fires #then it stops without re-arming", async () => {
    // given
    const planPath = join(testDirectory, "plan.md")
    writeFileSync(planPath, "# Plan\nProse only, no checkboxes.\n")
    writeBoulderState(testDirectory, createBoulderState(planPath, sessionID, "atlas"))

    const sessionState: SessionState = { promptFailureCount: 0 }
    const promptAsync = mock(async () => ({ data: {} }))
    const ctx = unsafeTestValue<PluginInput>({
      directory: testDirectory,
      client: { session: { promptAsync } },
    })

    scheduleRetry({
      ctx,
      sessionID,
      sessionState,
      options: {
        directory: testDirectory,
        retryScheduler,
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
    expect(promptAsync).not.toHaveBeenCalled()
    expect(sessionState.promptFailureCount).toBe(0)
    expect(sessionState.pendingRetryTimer).toBeUndefined()
    expect(capturedTimers.has(1001)).toBe(false)
  })
})
