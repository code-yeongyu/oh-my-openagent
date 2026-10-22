import { describe, expect, it, onTestFinished } from "bun:test"
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { cleanUpReloadRun, ownsHostSocket, type ReloadHost } from "./packaged-reload-cleanup.test-support"

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

  it("#given a real host that ignores SIGTERM #when cleanup runs #then it is killed inside the budget and no process is left", async () => {
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
    expect(outcome.error).toBeUndefined()
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

  it("#given a host whose exit arrives 13 s after SIGKILL (a loaded Linux host) #when cleanup runs with the default budget #then it waits for that exit and succeeds", async () => {
    // given - SIGTERM is ignored; the exit event follows SIGKILL only after the reap a saturated disk delays (#10870)
    const REAP_DELAY_MS = 13_000
    const root = tempRoot()
    const exit = Promise.withResolvers<void>()
    const signals: NodeJS.Signals[] = []
    let reap: ReturnType<typeof setTimeout> | undefined
    onTestFinished(() => clearTimeout(reap))
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill(signal: NodeJS.Signals) {
        signals.push(signal)
        if (signal === "SIGKILL") reap = setTimeout(() => exit.resolve(), REAP_DELAY_MS)
        return true
      },
    }
    let restored = 0

    // when
    const outcome = await settledWithin(cleanUpReloadRun({
      root,
      shutdowns: [],
      hosts: [{ child, exited: exit.promise }],
      restore: () => { restored += 1 },
    }), 30_000)

    // then
    expect(outcome.error).toBeUndefined()
    expect(signals).toEqual(["SIGTERM", "SIGKILL"])
    expect(existsSync(root)).toBe(false)
    expect(restored).toBe(1)
  }, 35_000)

  it("#given a host that ignores SIGTERM #when its grace ends #then it escalates to SIGKILL, succeeds and still restores the state", async () => {
    // given
    const root = tempRoot()
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
    await expect(cleanup).resolves.toBeUndefined()
    expect(signals).toEqual(["SIGTERM", "SIGKILL"])
    expect(existsSync(root)).toBe(false)
    expect(restored).toBe(1)
  })
  it("#given a host that never exits even after SIGKILL #when the budget runs out #then it fails with its own diagnosis, restores the state and keeps the root", async () => {
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
    expect((outcome.error as Error | undefined)?.message).toBe("packaged reload task host did not exit")
    expect(signals).toEqual(["SIGTERM", "SIGKILL"])
    expect(restored).toBe(1)
    expect(existsSync(root)).toBe(true)
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
