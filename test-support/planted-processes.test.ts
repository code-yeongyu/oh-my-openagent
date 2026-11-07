import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { connect, type Socket } from "node:net"
import { PlantedProcesses, runTeardown, stopChildRun, TEARDOWN_HOOK_TIMEOUT_MS } from "./planted-processes"

// The teardown of test-hermetic-home-teardown.test.ts must signal only its own planted processes, never a reused
// pid, and must name every one it leaves behind (#11695). Each row drives one recorded pid through stop().
interface Row {
  readonly name: string
  readonly announce: boolean
  readonly closeBeforeStop: boolean
  readonly exitsOnKill: boolean
  readonly alive: boolean
  readonly killed: boolean
  readonly error?: RegExp
}

const ROWS: readonly Row[] = [
  { name: "announced and still connected, exits on kill", announce: true, closeBeforeStop: false, exitsOnKill: true, alive: true, killed: true },
  { name: "announced, already exited, pid reused by another process", announce: true, closeBeforeStop: true, exitsOnKill: false, alive: true, killed: false },
  { name: "announced and still connected, ignores the kill", announce: true, closeBeforeStop: false, exitsOnKill: false, alive: true, killed: true, error: /did not exit within/ },
  { name: "never announced, still alive", announce: false, closeBeforeStop: false, exitsOnKill: false, alive: true, killed: false, error: /never announced itself and is still alive/ },
  { name: "never announced, already gone", announce: false, closeBeforeStop: false, exitsOnKill: false, alive: false, killed: false },
]

const FAKE_PID = 2_000_000_001

describe("PlantedProcesses.stop signals only planted processes it can prove are its own (#11695)", () => {
  const cleanups: (() => Promise<void>)[] = []
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  })

  for (const row of ROWS) {
    test(`#given a pid that is ${row.name} #when stopped #then ${row.error === undefined ? "it resolves" : "it fails by name"}${row.killed ? " after killing it" : " without signalling it"}`, async () => {
      const planted = await PlantedProcesses.listen()
      cleanups.push(() => planted.close())
      let socket: Socket | undefined
      if (row.announce) {
        socket = connect(planted.port, "127.0.0.1")
        const connection = socket
        cleanups.push(async () => { connection.destroy() })
        socket.on("error", () => undefined)
        socket.write(`${FAKE_PID}\n`)
        expect(await planted.announced([FAKE_PID], 5_000)).toBe(true)
      }
      if (row.closeBeforeStop) {
        const exited = planted.exited(FAKE_PID)
        socket?.destroy()
        await exited
      }
      const killed: number[] = []
      const stopping = planted.stop([FAKE_PID], {
        waitMs: 200,
        isAlive: () => row.alive,
        kill: (pid) => {
          killed.push(pid)
          if (row.exitsOnKill) socket?.destroy()
        },
      })
      if (row.error === undefined) await stopping
      else await expect(stopping).rejects.toThrow(row.error)
      expect(killed).toEqual(row.killed ? [FAKE_PID] : [])
    })
  }
})

describe("runTeardown keeps the named stop error when a planted process survives SIGKILL (#11695)", () => {
  test("#given a connected process that ignores the kill #when the teardown stops then closes #then it settles within its bound with the stop error", async () => {
    const planted = await PlantedProcesses.listen()
    const socket = connect(planted.port, "127.0.0.1")
    socket.on("error", () => undefined)
    socket.write(`${FAKE_PID}\n`)
    try {
      expect(await planted.announced([FAKE_PID], 5_000)).toBe(true)
      const teardown = runTeardown({
        stopChildRun: async () => undefined,
        stop: (waitMs) => planted.stop([FAKE_PID], { waitMs: Math.min(waitMs, 200), isAlive: () => true, kill: () => undefined }),
        close: (waitMs) => planted.close(waitMs),
      })
      let breaker: ReturnType<typeof setTimeout> | undefined
      const hung = new Promise<"hung">((resolve) => {
        breaker = setTimeout(() => resolve("hung"), 5_000)
      })
      const outcome = await Promise.race([teardown.then(() => "resolved", (error: unknown) => error), hung])
        .finally(() => clearTimeout(breaker))
      expect(String(outcome)).toContain(`pid ${FAKE_PID} did not exit within 200ms`)
    } finally {
      socket.destroy()
    }
  })
})

describe("runTeardown fits in the hook budget it is given (#11695)", () => {
  test("#given every teardown step waits its full bound #when summed #then the hook timeout still exceeds them", async () => {
    const requested: number[] = []
    const record = async (waitMs: number) => { requested.push(waitMs) }
    await runTeardown({ stopChildRun: record, stop: record, close: record })
    expect(requested.length).toBeGreaterThan(0)
    expect(requested.reduce((sum, ms) => sum + ms, 0)).toBeLessThan(TEARDOWN_HOOK_TIMEOUT_MS)
  })
})

describe("stopChildRun leaves no child test run behind (#11695)", () => {
  test("#given a child run that hangs #when stopped #then it is killed and has exited", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve())
      child.once("error", reject)
    })
    await stopChildRun(child, 5_000)
    expect({ exitCode: child.exitCode, signal: child.signalCode }).not.toEqual({ exitCode: null, signal: null })
  })

  test("#given a child run that already exited #when stopped #then nothing is signalled", async () => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" })
    await new Promise<void>((resolve) => child.once("exit", () => resolve()))
    const kill = child.kill.bind(child)
    let signalled = false
    child.kill = (signal) => {
      signalled = true
      return kill(signal)
    }
    await stopChildRun(child, 5_000)
    expect(signalled).toBe(false)
  })
})
