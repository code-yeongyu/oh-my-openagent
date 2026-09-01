import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "bun:test"

import { spawnFakeChild } from "./__fixtures__/spawn-fake"
import { terminateRpcChild } from "./terminate"

const isWin32 = process.platform === "win32"
const PROCESS_TREE_PATH = fileURLToPath(new URL("./__fixtures__/process-tree.mjs", import.meta.url))

function onExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }))
  })
}

describe("terminateRpcChild", () => {
  test.skipIf(isWin32)("#given a cooperating child #when terminating #then SIGTERM ends it without escalation", async () => {
    // given
    const child = spawnFakeChild()
    const exited = onExit(child)

    // when
    await terminateRpcChild(child, { sigkillDelayMs: 5_000 })

    // then
    const { signal } = await exited
    expect(signal).toBe("SIGTERM")
  })

  test.skipIf(isWin32)(
    "#given a TERM-ignoring child #when terminating #then it escalates to SIGKILL within the budget",
    async () => {
      // given
      const child = spawnFakeChild({ ...process.env, FAKE_IGNORE_TERM: "1" })
      await new Promise<void>((resolve) => child.stdout?.once("data", () => resolve()))
      const exited = onExit(child)

      // when
      await terminateRpcChild(child, { sigkillDelayMs: 150 })

      // then
      const { signal } = await exited
      expect(signal).toBe("SIGKILL")
    },
  )

  test.skipIf(isWin32)("#given a non-group-leader child #when terminating #then direct escalation remains available", async () => {
    // given
    const child = spawn(process.execPath, [PROCESS_TREE_PATH, "descendant"], {
      detached: false,
      stdio: ["ignore", "pipe", "ignore"],
    })
    await once(child.stdout!, "data")
    const pid = child.pid
    if (pid === undefined) throw new Error("non-group-leader child did not receive a pid")

    try {
      // when
      await terminateRpcChild(child, { sigkillDelayMs: 150 })

      // then
      expect(isRunning(pid)).toBe(false)
    } finally {
      if (isRunning(pid)) {
        child.kill("SIGKILL")
      }
    }
  })

  test("#given an already-exited child #when terminating #then it resolves without throwing", async () => {
    // given
    const child = spawnFakeChild()
    await terminateRpcChild(child, { sigkillDelayMs: 200 })

    // when / then
    await terminateRpcChild(child, { sigkillDelayMs: 200 })
  })

  test("#given a child with a TERM-ignoring descendant #when terminating #then the whole process tree exits", async () => {
    // given
    const child = spawn(process.execPath, [PROCESS_TREE_PATH], {
      detached: !isWin32,
      stdio: ["ignore", "pipe", "ignore"],
    })
    const [chunk] = await once(child.stdout!, "data")
    const descendantPid = Number.parseInt(String(chunk).trim(), 10)
    expect(Number.isSafeInteger(descendantPid)).toBe(true)

    try {
      // when
      await terminateRpcChild(child, { sigkillDelayMs: 150 })

      // then
      expect(isRunning(descendantPid)).toBe(false)
    } finally {
      if (isRunning(descendantPid)) {
        process.kill(descendantPid, "SIGKILL")
      }
    }
  })
})

function isRunning(pid: number): boolean {
  if (!isWin32) {
    const result = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], {
      encoding: "utf8",
    })
    return result.status === 0 && !result.stdout.trim().startsWith("Z")
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
