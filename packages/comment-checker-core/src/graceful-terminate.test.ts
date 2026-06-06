import { describe, expect, test } from "bun:test"
import { gracefulTerminate } from "./graceful-terminate"
import type { SpawnProcess, SpawnSignal } from "./types"

function fakeProc(): {
  proc: SpawnProcess
  resolveExit: () => void
  kills: SpawnSignal[]
} {
  const kills: SpawnSignal[] = []
  let exitedResolver: (value?: unknown) => void = () => {}
  const exited = new Promise<unknown>((resolve) => {
    exitedResolver = resolve
  })
  return {
    proc: {
      pid: 12345,
      kill: (signal: SpawnSignal) => {
        kills.push(signal)
      },
      stdin: { write: () => {}, end: () => {} } as unknown as SpawnProcess["stdin"],
      stdout: new Response("").body as unknown as SpawnProcess["stdout"],
      stderr: new Response("").body as unknown as SpawnProcess["stderr"],
      exited,
    } as unknown as SpawnProcess,
    resolveExit: () => exitedResolver(),
    kills,
  }
}

describe("gracefulTerminate", () => {
  test("#given timer fires #when grace elapses #then SIGKILL is sent after SIGTERM", () => {
    const { proc, kills } = fakeProc()
    const scheduled: Array<() => void> = []
    const fakeSet = (cb: () => void, _ms: number) => {
      scheduled.push(cb)
      return scheduled.length as unknown as ReturnType<typeof setTimeout>
    }
    gracefulTerminate(proc, {
      gracePeriodMs: 100,
      setTimer: fakeSet as unknown as typeof setTimeout,
      clearTimer: (() => {}) as unknown as typeof clearTimeout,
    })

    expect(kills).toEqual(["SIGTERM"])
    expect(scheduled.length).toBe(1)
    scheduled[0]!()
    expect(kills).toEqual(["SIGTERM", "SIGKILL"])
  })

  test("#given proc exits early #when exited resolves #then grace timer is cleared and SIGKILL is NOT sent", async () => {
    const { proc, resolveExit, kills } = fakeProc()
    let cleared = false
    const scheduled: Array<() => void> = []
    const fakeSet = (cb: () => void, _ms: number) => {
      scheduled.push(cb)
      return scheduled.length as unknown as ReturnType<typeof setTimeout>
    }
    const fakeClear = () => {
      cleared = true
    }
    gracefulTerminate(proc, {
      gracePeriodMs: 100,
      setTimer: fakeSet as unknown as typeof setTimeout,
      clearTimer: fakeClear as unknown as typeof clearTimeout,
    })

    expect(kills).toEqual(["SIGTERM"])
    resolveExit()
    await new Promise((r) => setImmediate(r))
    expect(cleared).toBe(true)
    expect(kills).toEqual(["SIGTERM"])
  })
})
