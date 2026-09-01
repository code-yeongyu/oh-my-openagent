import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createHashlineEditDiffEnhancerHook } from "./hook"
import { stopPendingCaptureCleanup } from "./pending-captures"

const STALE_TIMEOUT_MS = 5 * 60 * 1000

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

function writeTempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "hashline-capture-"))
  const filePath = join(dir, "target.txt")
  writeFileSync(filePath, "old-file-body\n")
  return filePath
}

describe("hashline pendingCaptures eviction", () => {
  let restore: (() => void) | undefined

  afterEach(() => {
    stopPendingCaptureCleanup()
    restore?.()
    restore = undefined
  })

  test("#given a captured Write old-file body #when the TTL elapses without another Write #then a background sweep drops the capture", async () => {
    //#given
    const harness = installSweepHarness()
    restore = harness.restore
    const filePath = writeTempFile()
    const hook = createHashlineEditDiffEnhancerHook({ hashline_edit: { enabled: true } })
    const input = { tool: "write", sessionID: "ses_hashline", callID: "call_stale" }

    await hook["tool.execute.before"](input, { args: { path: filePath } })
    expect(harness.unrefCalls()).toBe(1)

    //#when
    harness.advance(STALE_TIMEOUT_MS + 1)
    harness.runSweep()

    const afterOutput = { title: "write", output: "ok", metadata: {} as Record<string, unknown> }
    await hook["tool.execute.after"](input, afterOutput)

    //#then
    expect(afterOutput.metadata).not.toHaveProperty("diff")
  })

  test("#given a captured Write old-file body #when dispose runs #then the after hook has nothing left to enhance", async () => {
    //#given
    const filePath = writeTempFile()
    const hook = createHashlineEditDiffEnhancerHook({ hashline_edit: { enabled: true } })
    const input = { tool: "write", sessionID: "ses_hashline_dispose", callID: "call_dispose" }
    await hook["tool.execute.before"](input, { args: { path: filePath } })

    //#when
    const disposable = hook as { dispose?: () => void }
    disposable.dispose?.()

    const afterOutput = { title: "write", output: "ok", metadata: {} as Record<string, unknown> }
    await hook["tool.execute.after"](input, afterOutput)

    //#then
    expect(afterOutput.metadata).not.toHaveProperty("diff")
  })
})
