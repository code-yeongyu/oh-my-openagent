import { describe, expect, it, onTestFinished } from "bun:test"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { cleanUpReloadRun, ownsHostSocket, type ReloadCleanupClock, type ReloadHost, reloadRootParent } from "./packaged-reload-cleanup.test-support"

function fakeClock(): ReloadCleanupClock & { advance(ms: number): Promise<void> } {
  let now = 0
  const timers = new Map<() => void, number>()
  return {
    now: () => now,
    schedule(callback, delayMs) {
      timers.set(callback, now + delayMs)
      return () => { timers.delete(callback) }
    },
    async advance(ms) {
      const target = now + ms
      for (;;) {
        const next = [...timers].sort((a, b) => a[1] - b[1])[0]
        if (!next || next[1] > target) break
        now = next[1]
        timers.delete(next[0])
        next[0]()
        // Drain promise continuations before advancing to the next virtual timer.
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      now = target
    },
  }
}

function fakeHost(): { host: ReloadHost; signals: NodeJS.Signals[] } {
  const signals: NodeJS.Signals[] = []
  const exit = Promise.withResolvers<void>()
  const child = {
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill(signal: NodeJS.Signals) {
      signals.push(signal)
      child.signalCode = signal
      exit.resolve()
      return true
    },
  }
  return { host: { child, exited: exit.promise }, signals }
}

// Circuit breaker for the cleanup's own deadline: the budget is the behavior under test here.
async function settledWithin<T>(work: Promise<T>, ms: number): Promise<{ value?: T; error?: unknown }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work.then((value) => ({ value }), (error: unknown) => ({ error })),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`cleanup did not settle within ${ms} ms`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-reload-cleanup-"))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  return root
}

describe("cleanUpReloadRun", () => {
  it("#given a supervisor needing four seconds to reap its child #when cleanup uses the default grace #then it removes its internal dir without SIGKILL", async () => {
    const root = tempRoot()
    const internalDir = join(root, "senpi-rpc-host-internal-delayed")
    mkdirSync(internalDir)
    const clock = fakeClock()
    const exit = Promise.withResolvers<void>()
    const signals: NodeJS.Signals[] = []
    let cancelShutdown: (() => void) | undefined
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill(signal: NodeJS.Signals) {
        signals.push(signal)
        if (signal === "SIGTERM") {
          cancelShutdown = clock.schedule(() => {
            rmSync(internalDir, { recursive: true })
            child.exitCode = 0
            exit.resolve()
          }, 4_000)
        } else {
          cancelShutdown?.()
          child.signalCode = signal
          exit.resolve()
        }
        return true
      },
    }
    const cleanup = cleanUpReloadRun({
      root, shutdowns: [], hosts: [{ child, exited: exit.promise }], restore: () => {}, clock,
    })
    const outcome = cleanup.then(() => undefined, (error: unknown) => error)

    await clock.advance(4_000)

    expect(await outcome).toBeUndefined()
    expect(signals).toEqual(["SIGTERM"])
    expect(existsSync(root)).toBe(false)
  })

  it("#given a plugin shutdown handler that throws #when cleanup runs #then the hosts are still stopped, the root removed and the state restored", async () => {
    // given
    const root = tempRoot()
    const { host, signals } = fakeHost()
    let restored = 0

    // when
    const cleanup = cleanUpReloadRun({
      root,
      shutdowns: [async () => { throw new Error("plugin shutdown failed") }],
      hosts: [host],
      restore: () => { restored += 1 },
    })

    // then
    await expect(cleanup).rejects.toThrow("plugin shutdown failed")
    expect(signals).toEqual(["SIGTERM"])
    expect(existsSync(root)).toBe(false)
    expect(restored).toBe(1)
  })

  it("#given a real host that ignores SIGTERM where the platform lets it (win32 terminates on SIGTERM) #when cleanup runs #then it is gone inside the budget and no process is left", async () => {
    // given
    const root = tempRoot()
    const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1000)"], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true })
    onTestFinished(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL") })
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
    await settledWithin(new Promise<void>((resolve) => child.stdout?.once("data", () => resolve())), 10_000)
    let restored = 0

    // when
    const outcome = await settledWithin(cleanUpReloadRun({
      root,
      shutdowns: [],
      hosts: [{ child, exited }],
      restore: () => { restored += 1 },
      budgetMs: 4_000,
      termGraceMs: 200,
      killWaitMs: 3_000,
    }), 5_000)

    // then
    // Windows has no catchable SIGTERM: kill() terminates the child at once, so no grace overrun is reported there.
    const graceError = process.platform === "win32" ? undefined : "supervisor did not finish graceful shutdown within 200ms"
    expect((outcome.error as Error | undefined)?.message).toBe(graceError)
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    expect(() => process.kill(child.pid ?? -1, 0)).toThrow()
    expect(existsSync(root)).toBe(false)
    expect(restored).toBe(1)
  })

  it("#given a plugin shutdown that never settles #when cleanup runs #then the hosts are still stopped inside the budget and the failure is named", async () => {
    // given
    const root = tempRoot()
    const { host, signals } = fakeHost()
    let restored = 0

    // when
    const outcome = await settledWithin(cleanUpReloadRun({
      root,
      shutdowns: [() => new Promise<never>(() => {})],
      hosts: [host],
      restore: () => { restored += 1 },
      budgetMs: 600,
      termGraceMs: 100,
      killWaitMs: 100,
    }), 2_000)

    // then
    expect((outcome.error as Error | undefined)?.message).toBe("packaged reload plugin shutdown did not settle in time")
    expect(signals).toEqual(["SIGTERM"])
    expect(existsSync(root)).toBe(false)
    expect(restored).toBe(1)
  })

  it("#given a host whose exit arrives 13 s after SIGKILL (a loaded Linux host) #when cleanup runs with the default budget #then it waits for that exit and reports escalation", async () => {
    // given - SIGTERM is ignored; the exit event follows SIGKILL only after the reap a saturated disk delays (#10870)
    const REAP_DELAY_MS = 13_000
    const root = tempRoot()
    const exit = Promise.withResolvers<void>()
    const signals: NodeJS.Signals[] = []
    const clock = fakeClock()
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill(signal: NodeJS.Signals) {
        signals.push(signal)
        if (signal === "SIGKILL") clock.schedule(() => exit.resolve(), REAP_DELAY_MS)
        return true
      },
    }
    let restored = 0

    // when
    const cleanup = cleanUpReloadRun({
      root,
      shutdowns: [],
      hosts: [{ child, exited: exit.promise }],
      restore: () => { restored += 1 },
      clock,
    })
    const outcome = cleanup.then(() => undefined, (error: unknown) => error)
    await clock.advance(152_000)

    // then
    expect((await outcome as Error).message).toBe("supervisor did not finish graceful shutdown within 95000ms")
    expect(signals).toEqual(["SIGTERM", "SIGKILL"])
    expect(existsSync(root)).toBe(false)
    expect(restored).toBe(1)
  })

  it("#given a host that ignores SIGTERM #when its grace ends #then it reports escalation and still restores the state", async () => {
    // given
    const root = tempRoot()
    mkdirSync(join(root, "senpi-rpc-host-internal-killed"))
    const exit = Promise.withResolvers<void>()
    const signals: NodeJS.Signals[] = []
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill(signal: NodeJS.Signals) {
        signals.push(signal)
        if (signal === "SIGKILL") exit.resolve()
        return true
      },
    }
    let restored = 0

    // when
    const cleanup = cleanUpReloadRun({
      root,
      shutdowns: [],
      hosts: [{ child, exited: exit.promise }],
      restore: () => { restored += 1 },
      termGraceMs: 1,
    })

    // then
    await expect(cleanup).rejects.toThrow("supervisor did not finish graceful shutdown within 1ms")
    expect(signals).toEqual(["SIGTERM", "SIGKILL"])
    expect(existsSync(root)).toBe(false)
    expect(restored).toBe(1)
  })
  it("#given a host that never exits even after SIGKILL #when the budget runs out #then it names both failures, restores the state and removes the root", async () => {
    // given
    const root = tempRoot()
    const signals: NodeJS.Signals[] = []
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill(signal: NodeJS.Signals) {
        signals.push(signal)
        return true
      },
    }
    let restored = 0

    // when
    const cleanup = cleanUpReloadRun({
      root,
      shutdowns: [],
      hosts: [{ child, exited: new Promise<void>(() => {}) }],
      restore: () => { restored += 1 },
      budgetMs: 300,
      termGraceMs: 50,
      killWaitMs: 100,
    })

    // then
    const outcome = await settledWithin(cleanup, 2_000)
    expect(outcome.error).toBeInstanceOf(AggregateError)
    expect((outcome.error as AggregateError).errors.map((error: Error) => error.message)).toEqual([
      "supervisor did not finish graceful shutdown within 50ms",
      "packaged reload task host did not exit",
    ])
    expect(signals).toEqual(["SIGTERM", "SIGKILL"])
    expect(restored).toBe(1)
    expect(existsSync(root)).toBe(false)
  })
})

describe("ownsHostSocket", () => {
  const root = join(tmpdir(), "omo-ulw-reload-abc")

  it("#given a socket under the test root #when matched #then it is owned", () => {
    expect(ownsHostSocket(["--socket", join(root, "p-1.sock")], root)).toBe(true)
  })

  it("#given a sibling root that shares the prefix #when matched #then it is not owned", () => {
    expect(ownsHostSocket(["--socket", join(`${root}X`, "p-1.sock")], root)).toBe(false)
  })

  it("#given the root only in another argument #when matched #then it is not owned", () => {
    expect(ownsHostSocket(["--cwd", join(root, "x"), "--socket", join(tmpdir(), "other.sock")], root)).toBe(false)
  })
})

describe("reloadRootParent", () => {
  it.skipIf(process.platform === "win32")("#given a short runner TMPDIR #when the reload root parent is chosen #then the runner's TMPDIR is used", () => {
    expect(reloadRootParent("/tmp/lr.Ab12Cd")).toBe("/tmp/lr.Ab12Cd")
  })

  it.skipIf(process.platform === "win32")("#given a darwin-length TMPDIR #when the host's shard socket would not fit sun_path there #then it falls back to /tmp", () => {
    expect(reloadRootParent("/var/folders/zz/zyxvpxvq6csfxvn_n0000000000000/T")).toBe("/tmp")
  })
})
