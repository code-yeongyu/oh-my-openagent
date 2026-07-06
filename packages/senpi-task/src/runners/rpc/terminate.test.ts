import type { ChildProcess } from "node:child_process"
import { describe, expect, test } from "bun:test"

import { spawnFakeChild } from "./__fixtures__/spawn-fake"
import { terminateRpcChild } from "./terminate"

const isWin32 = process.platform === "win32"

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

  test("#given an already-exited child #when terminating #then it resolves without throwing", async () => {
    // given
    const child = spawnFakeChild()
    await terminateRpcChild(child, { sigkillDelayMs: 200 })

    // when / then
    await terminateRpcChild(child, { sigkillDelayMs: 200 })
  })
})
