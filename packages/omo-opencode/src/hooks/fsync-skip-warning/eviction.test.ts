import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import {
  createFsyncSkipWarningHook,
  FSYNC_SKIP_START_TTL_MS,
  hasFsyncSkipStartTime,
  stopFsyncSkipWarningCleanup,
} from "./index"

function installSweepHarness() {
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const originalNow = Date.now
  let now = 1_700_000_000_000
  let sweep: (() => void) | undefined
  let unrefCalls = 0
  const handle = unsafeTestValue<ReturnType<typeof setInterval>>({
    unref: () => {
      unrefCalls += 1
    },
  })

  globalThis.setInterval = unsafeTestValue<typeof setInterval>((callback: TimerHandler) => {
    sweep = callback as () => void
    return handle
  })
  globalThis.clearInterval = unsafeTestValue<typeof clearInterval>((timer) => {
    if (timer === handle) sweep = undefined
  })
  Date.now = () => now

  return {
    advance(ms: number) {
      now += ms
    },
    runSweep() {
      sweep?.()
    },
    unrefCalls: () => unrefCalls,
    restore() {
      globalThis.setInterval = originalSetInterval
      globalThis.clearInterval = originalClearInterval
      Date.now = originalNow
    },
  }
}

describe("fsync-skip-warning startTimesByCallId eviction", () => {
  let restore: (() => void) | undefined

  beforeEach(() => {
    stopFsyncSkipWarningCleanup()
  })

  afterEach(() => {
    stopFsyncSkipWarningCleanup()
    restore?.()
    restore = undefined
  })

  test("#given a before-hook start time whose after-hook never runs #when the TTL elapses #then a background sweep drops the entry", async () => {
    //#given
    const harness = installSweepHarness()
    restore = harness.restore
    const hook = createFsyncSkipWarningHook() as ReturnType<typeof createFsyncSkipWarningHook> & {
      dispose?: () => void
    }
    const input = { tool: "write", sessionID: "ses_fsync", callID: "call_orphan" }

    await hook["tool.execute.before"](input, { args: {} })
    expect(hasFsyncSkipStartTime("call_orphan")).toBe(true)
    expect(harness.unrefCalls()).toBe(1)

    //#when
    harness.advance(FSYNC_SKIP_START_TTL_MS + 1)
    harness.runSweep()

    //#then
    expect(hasFsyncSkipStartTime("call_orphan")).toBe(false)
    hook.dispose?.()
  })

  test("#given unmatched before-hook start times #when dispose runs #then tracked call IDs are cleared", async () => {
    //#given
    const hook = createFsyncSkipWarningHook() as ReturnType<typeof createFsyncSkipWarningHook> & {
      dispose?: () => void
    }
    await hook["tool.execute.before"](
      { tool: "write", sessionID: "ses_fsync", callID: "call_dispose" },
      { args: {} },
    )
    expect(hasFsyncSkipStartTime("call_dispose")).toBe(true)

    //#when
    hook.dispose?.()

    //#then
    expect(hasFsyncSkipStartTime("call_dispose")).toBe(false)
  })
})
