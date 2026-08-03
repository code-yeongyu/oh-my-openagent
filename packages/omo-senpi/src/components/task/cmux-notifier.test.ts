import { EventEmitter } from "node:events"
import { describe, expect, test } from "bun:test"

import { isCmuxEnvironment, resolveCmuxExecutable, sendCmuxNotification } from "./cmux-notifier"

class FakeChild extends EventEmitter {}

type SpawnCall = {
  readonly command: string
  readonly args: readonly string[]
  readonly options: Record<string, unknown>
}

function fakeSpawn(exitCode = 0): { readonly calls: SpawnCall[]; readonly spawnImpl: typeof import("node:child_process").spawn } {
  const calls: SpawnCall[] = []
  const spawnImpl = ((command: string, args: readonly string[], options: Record<string, unknown>) => {
    calls.push({ command, args, options })
    const child = new FakeChild()
    queueMicrotask(() => child.emit("close", exitCode))
    return child
  }) as typeof import("node:child_process").spawn
  return { calls, spawnImpl }
}

describe("OMO Senpi cmux notification bridge", () => {
  test("#given cmux is forced on macOS #when a task completes #then it invokes cmux notify without blocking", async () => {
    const spawn = fakeSpawn()

    await expect(sendCmuxNotification("OMO task completed", "done", {
      env: {
        OMO_CMUX_BIN: "/tmp/fake-cmux",
        OMO_SENPI_CMUX_NOTIFY: "1",
      },
      platform: "darwin",
      spawnImpl: spawn.spawnImpl,
    })).resolves.toBe(true)

    expect(spawn.calls).toEqual([{
      command: "/tmp/fake-cmux",
      args: ["notify", "--title", "OMO task completed", "--body", "done"],
      options: { stdio: "ignore", windowsHide: true },
    }])
  })

  test("#given cmux is unavailable #when notification is requested #then it skips without spawning", async () => {
    const spawn = fakeSpawn()

    await expect(sendCmuxNotification("title", "body", {
      env: { PATH: "" },
      platform: "darwin",
      spawnImpl: spawn.spawnImpl,
    })).resolves.toBe(false)

    expect(spawn.calls).toEqual([])
  })

  test("#given non-macOS or disabled configuration #when notification is requested #then it skips", async () => {
    const spawn = fakeSpawn()

    await expect(sendCmuxNotification("title", "body", {
      env: {
        OMO_CMUX_BIN: "/tmp/fake-cmux",
        OMO_SENPI_CMUX_NOTIFY: "1",
      },
      platform: "linux",
      spawnImpl: spawn.spawnImpl,
    })).resolves.toBe(false)

    await expect(sendCmuxNotification("title", "body", {
      env: {
        OMO_CMUX_BIN: "/tmp/fake-cmux",
        OMO_SENPI_CMUX_NOTIFY: "0",
        CMUX_SOCKET_PATH: "/tmp/cmux.sock",
      },
      platform: "darwin",
      spawnImpl: spawn.spawnImpl,
    })).resolves.toBe(false)

    expect(spawn.calls).toEqual([])
  })

  test("#given cmux exits unsuccessfully #when notification is requested #then it reports false", async () => {
    const spawn = fakeSpawn(1)

    await expect(sendCmuxNotification("title", "body", {
      env: {
        OMO_CMUX_BIN: "/tmp/fake-cmux",
        CMUX_SOCKET_PATH: "/tmp/cmux.sock",
      },
      platform: "darwin",
      spawnImpl: spawn.spawnImpl,
    })).resolves.toBe(false)
  })

  test("#given cmux environment variables #when detecting cmux #then socket, launch kind, and explicit opt-in qualify", () => {
    expect(isCmuxEnvironment({ CMUX_SOCKET_PATH: "/tmp/cmux.sock" })).toBe(true)
    expect(isCmuxEnvironment({ CMUX_AGENT_LAUNCH_KIND: "workspace" })).toBe(true)
    expect(isCmuxEnvironment({ OMO_SENPI_CMUX_NOTIFY: "1" })).toBe(true)
    expect(isCmuxEnvironment({})).toBe(false)
  })

  test("#given executable overrides #when resolving cmux #then explicit override wins", () => {
    expect(resolveCmuxExecutable({ OMO_CMUX_BIN: " /Applications/cmux.app/cmux " })).toBe("/Applications/cmux.app/cmux")
    expect(resolveCmuxExecutable({ CMUX_OMO_CMUX_BIN: "/custom/cmux" })).toBe("/custom/cmux")
  })
})
