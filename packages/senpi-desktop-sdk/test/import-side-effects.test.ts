import childProcess from "node:child_process"
import net from "node:net"
import { afterEach, describe, expect, it, vi } from "vitest"

// The SDK is imported by the kernels' host and the service: importing it must start nothing (DESIGN §4).
describe("importing the sdk", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("#given spawn, net and timer spies #when the sdk entry is imported fresh #then none is touched and no global appears", async () => {
    const spies = [
      vi.spyOn(childProcess, "spawn"),
      vi.spyOn(childProcess, "spawnSync"),
      vi.spyOn(childProcess, "exec"),
      vi.spyOn(childProcess, "execFile"),
      vi.spyOn(childProcess, "fork"),
      vi.spyOn(net, "connect"),
      vi.spyOn(net, "createConnection"),
      vi.spyOn(net, "createServer"),
    ]
    vi.useFakeTimers()
    const globals = new Set(Object.keys(globalThis))
    vi.resetModules()

    const sdk = await import("../src/index")

    expect(typeof sdk.connect).toBe("function")
    expect(spies.map((spy) => spy.mock.calls.length)).toEqual(spies.map(() => 0))
    expect(vi.getTimerCount()).toBe(0)
    expect(Object.keys(globalThis).filter((key) => !globals.has(key))).toEqual([])
  })
})
