/// <reference types="bun-types" />

import { expect, test } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { executeNotificationScript } from "./session-notification-script-executor"

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error)) throw error
    if (error.code === "ESRCH") return false
    throw error
  }
}

test.skipIf(process.platform === "win32")("notification script timeout kills a TERM-resistant process tree", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "omo-notification-timeout-"))
  const scriptPath = join(tempDir, "notify.sh")
  const pidPath = join(tempDir, "pids")
  const previousPidPath = process.env.NOTIFICATION_TEST_PID_FILE
  let pids: number[] = []
  writeFileSync(scriptPath, [
    "#!/bin/sh",
    "trap '' TERM",
    "sh -c \"trap '' TERM; while :; do :; done\" &",
    "printf '%s %s\\n' \"$$\" \"$!\" > \"$NOTIFICATION_TEST_PID_FILE\"",
    "wait",
  ].join("\n"))
  chmodSync(scriptPath, 0o755)
  process.env.NOTIFICATION_TEST_PID_FILE = pidPath

  try {
    const startedAt = Date.now()
    await executeNotificationScript(
      { scriptPath, hookType: "idle", sessionID: "session-1" },
      "Done",
      "Task completed",
      10
    )
    pids = readFileSync(pidPath, "utf8").trim().split(/\s+/).map(Number)

    expect(Date.now() - startedAt).toBeLessThan(1000)
    expect(pids).toHaveLength(2)
    expect(pids.some(isProcessAlive)).toBe(false)
  } finally {
    for (const pid of pids) {
      if (isProcessAlive(pid)) process.kill(pid, "SIGKILL")
    }
    if (previousPidPath === undefined) delete process.env.NOTIFICATION_TEST_PID_FILE
    else process.env.NOTIFICATION_TEST_PID_FILE = previousPidPath
    rmSync(tempDir, { recursive: true, force: true })
  }
})
