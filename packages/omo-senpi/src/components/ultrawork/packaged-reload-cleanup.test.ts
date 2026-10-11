import { describe, expect, it, onTestFinished } from "bun:test"
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

  it("#given a host that never exits #when cleanup times out #then it escalates to SIGKILL and still restores the state", async () => {
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
      exitTimeoutMs: 1,
    })

    // then
    await expect(cleanup).rejects.toThrow("did not exit")
    expect(signals).toEqual(["SIGTERM", "SIGKILL"])
    expect(restored).toBe(1)
  })
})

describe("ownsHostSocket", () => {
  it("#given a socket under the test root #when matched #then it is owned", () => {
    expect(ownsHostSocket(["--socket", join("/tmp/omo-ulw-reload-abc", "p-1.sock")], "/tmp/omo-ulw-reload-abc")).toBe(true)
  })

  it("#given a sibling root that shares the prefix #when matched #then it is not owned", () => {
    expect(ownsHostSocket(["--socket", join("/tmp/omo-ulw-reload-abcX", "p-1.sock")], "/tmp/omo-ulw-reload-abc")).toBe(false)
  })

  it("#given the root only in another argument #when matched #then it is not owned", () => {
    expect(ownsHostSocket(["--cwd", join("/tmp/omo-ulw-reload-abc", "x"), "--socket", "/var/run/other.sock"], "/tmp/omo-ulw-reload-abc")).toBe(false)
  })
})
