import { PassThrough } from "node:stream"
import { afterAll, mock, describe, expect, test } from "bun:test"

const spawnCalls: Array<{ options?: { windowsHide?: boolean } }> = []

mock.module("node:child_process", () => ({
  spawn: (_command: string, options: { windowsHide?: boolean }) => {
    spawnCalls.push({ options })
    const proc = new PassThrough() as PassThrough & {
      pid: number
      stdout: PassThrough
      stderr: PassThrough
      stdin: PassThrough
    }
    proc.pid = 1234
    proc.stdout = new PassThrough()
    proc.stderr = new PassThrough()
    proc.stdin = new PassThrough()
    queueMicrotask(() => proc.emit("close", 0))
    return proc
  },
}))

afterAll(() => { mock.restore() })

const { executeHookCommand } = await import("./execute-hook-command")

describe("executeHookCommand Windows console visibility", () => {
  test("passes windowsHide to the hook process", async () => {
    await executeHookCommand("echo hook", "", process.cwd(), { timeoutMs: 1000 })

    expect(spawnCalls[0]?.options?.windowsHide).toBe(true)
  })
})

export {}
