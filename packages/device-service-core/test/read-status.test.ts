import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  type DeviceService,
  deviceServiceEndpointPath,
  readDeviceServiceDevices,
  readDeviceServiceStatus,
} from "../src/index.ts"

const withStateDir = async (endpoint: boolean, use: (stateDir: string) => Promise<void>): Promise<void> => {
  const stateDir = mkdtempSync(join(tmpdir(), "omo-read-status-"))
  try {
    if (endpoint) {
      const path = deviceServiceEndpointPath(stateDir)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, "{}")
    }
    await use(stateDir)
  } finally {
    rmSync(stateDir, { recursive: true, force: true })
  }
}

test("#given a state dir with no endpoint file #when the status is read #then it answers not_running without connecting", async () => {
  await withStateDir(false, async (stateDir) => {
    let connects = 0
    const connect = async (): Promise<DeviceService> => {
      connects++
      throw new Error("must not connect")
    }
    expect(await readDeviceServiceStatus({ stateDir, version: "0.0.0-test", connect })).toBe("not_running")
    expect(connects).toBe(0)
  })
})

test("#given a pre-aborted signal #when the status is read #then it answers no_answer without connecting", async () => {
  await withStateDir(true, async (stateDir) => {
    let connects = 0
    const connect = async (): Promise<DeviceService> => {
      connects++
      throw new Error("must not connect")
    }
    const signal = AbortSignal.abort()
    expect(await readDeviceServiceStatus({ stateDir, version: "0.0.0-test", signal, connect })).toBe("no_answer")
    expect(connects).toBe(0)
  })
})

test("#given a connection that opens after the caller aborts #when the status is read #then no_answer and the late connection is closed", async () => {
  await withStateDir(true, async (stateDir) => {
    const controller = new AbortController()
    const late = Promise.withResolvers<DeviceService>()
    const closed = Promise.withResolvers<void>()
    const service = { close: () => closed.resolve() } as unknown as DeviceService
    const answer = readDeviceServiceStatus({
      stateDir,
      version: "0.0.0-test",
      signal: controller.signal,
      connect: () => late.promise,
    })
    controller.abort()
    expect(await answer).toBe("no_answer")
    late.resolve(service)
    await closed.promise
  })
})

test("#given a running service #when its devices are read #then each row answers its id and online state and the connection is closed", async () => {
  await withStateDir(true, async (stateDir) => {
    let closed = 0
    const service = {
      devices: async () => [
        { device: "dev-a", label: "device-a", kind: "cli", platform: "linux", last_seen_ms: 1, online: true },
        { device: "dev-b", label: "device-b", kind: "cli", platform: "macos", last_seen_ms: null, online: false },
      ],
      close: () => {
        closed++
      },
    } as unknown as DeviceService
    expect(await readDeviceServiceDevices({ stateDir, version: "0.0.0-test", connect: async () => service })).toEqual([
      { id: "dev-a", online: true },
      { id: "dev-b", online: false },
    ])
    expect(closed).toBe(1)
  })
})
