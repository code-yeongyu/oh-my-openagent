import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "fs"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import {
  buildTranscriptFromSession,
  hasTranscriptCacheEntry,
  stopTranscriptCacheCleanup,
} from "./transcript"

const TRANSCRIPT_CACHE_TTL_MS = 5 * 60 * 1000

function createMockClient() {
  return {
    session: {
      messages: () => Promise.resolve({ data: [] }),
    },
  }
}

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

describe("transcript cache idle prune", () => {
  let restore: (() => void) | undefined

  afterEach(() => {
    stopTranscriptCacheCleanup()
    restore?.()
    restore = undefined
  })

  test("#given a cached transcript snapshot #when the TTL elapses without another build #then a background sweep drops the entry and temp file", async () => {
    //#given
    const harness = installSweepHarness()
    restore = harness.restore
    const path = await buildTranscriptFromSession(
      createMockClient(),
      "ses_idle_prune",
      "/tmp",
      "write",
      { filePath: "/tmp/idle.txt", content: "stale-body" },
    )

    expect(path).not.toBeNull()
    expect(hasTranscriptCacheEntry("ses_idle_prune")).toBe(true)
    expect(path && existsSync(path)).toBe(true)
    expect(harness.unrefCalls()).toBe(1)

    //#when
    harness.advance(TRANSCRIPT_CACHE_TTL_MS + 1)
    harness.runSweep()

    //#then
    expect(hasTranscriptCacheEntry("ses_idle_prune")).toBe(false)
    expect(path && existsSync(path)).toBe(false)
  })
})
