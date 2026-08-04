import { EventEmitter } from "node:events"
import { describe, expect, test } from "bun:test"

import { isCmuxEnvironment, resolveCmuxExecutable, sendCmuxNotification, type CmuxSpawnImpl } from "./cmux-notifier"

class FakeChild extends EventEmitter {
  killed = false
  unrefCalls = 0

  kill(): boolean {
    this.killed = true
    return true
  }

  unref(): void {
    this.unrefCalls += 1
  }
}

type SpawnCall = {
  readonly command: string
  readonly args: readonly string[]
  readonly options: Parameters<CmuxSpawnImpl>[2]
}

function fakeSpawn(exitCode = 0, emitClose = true): {
  readonly calls: SpawnCall[]
  readonly children: FakeChild[]
  readonly spawnImpl: CmuxSpawnImpl
} {
  const calls: SpawnCall[] = []
  const children: FakeChild[] = []
  const spawnImpl: CmuxSpawnImpl = (command, args, options) => {
    calls.push({ command, args, options })
    const child = new FakeChild()
    children.push(child)
    if (emitClose) queueMicrotask(() => child.emit("close", exitCode))
    return child
  }
  return { calls, children, spawnImpl }
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

  test("#given cmux environment variables #when detecting cmux #then socket, cmux TMUX, launch kind, and explicit opt-in qualify", () => {
    expect(isCmuxEnvironment({ CMUX_SOCKET_PATH: "/tmp/cmux.sock" })).toBe(true)
    expect(isCmuxEnvironment({ TMUX: "/tmp/cmuxterm-12345.sock,1234,0" })).toBe(true)
    expect(isCmuxEnvironment({ TMUX: "/tmp/tmux-12345.sock,1234,0" })).toBe(false)
    expect(isCmuxEnvironment({ CMUX_AGENT_LAUNCH_KIND: "workspace" })).toBe(true)
    expect(isCmuxEnvironment({ OMO_SENPI_CMUX_NOTIFY: "1" })).toBe(true)
    expect(isCmuxEnvironment({})).toBe(false)
  })

  test("#given cmux spawn rejects synchronously #when notification is requested #then it reports false", async () => {
    const spawnImpl: CmuxSpawnImpl = () => {
      throw new TypeError("argument must be a string without null bytes")
    }

    await expect(sendCmuxNotification("title", "body\0with-nul", {
      env: {
        OMO_CMUX_BIN: "/tmp/fake-cmux",
        CMUX_SOCKET_PATH: "/tmp/cmux.sock",
        TMUX: "/tmp/cmuxterm-12345.sock,1234,0",
      },
      platform: "darwin",
      spawnImpl,
    })).resolves.toBe(false)
  })

  test("#given cmux notify stalls #when timeout elapses #then it is best-effort and cannot keep Senpi alive", async () => {
    const spawn = fakeSpawn(0, false)

    await expect(sendCmuxNotification("title", "body", {
      env: {
        OMO_CMUX_BIN: "/tmp/fake-cmux",
        TMUX: "/tmp/cmuxterm-12345.sock,1234,0",
      },
      platform: "darwin",
      spawnImpl: spawn.spawnImpl,
      timeoutMs: 1,
    })).resolves.toBe(false)

    const child = spawn.children[0]
    if (child === undefined) throw new Error("fake spawn should create one child process")
    expect(child.unrefCalls).toBe(1)
    expect(child.killed).toBe(true)
  })

  test("#given executable overrides #when resolving cmux #then explicit override wins", () => {
    expect(resolveCmuxExecutable({ OMO_CMUX_BIN: " /Applications/cmux.app/cmux " })).toBe("/Applications/cmux.app/cmux")
    expect(resolveCmuxExecutable({ CMUX_OMO_CMUX_BIN: "/custom/cmux" })).toBe("/custom/cmux")
  })
})
