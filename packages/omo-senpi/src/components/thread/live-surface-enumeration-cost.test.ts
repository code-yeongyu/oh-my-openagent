// Every thread tool call awaits one host view. The view's endpoint enumeration used to spawn the engine's
// `host status --all --include-workers --json`, a full diagnostic pass (a /proc walk per endpoint, crash records,
// stale-engine checks) that took 8.4-8.7 s on a host with 49 endpoints, so a local-only thread_list took 9.3 s.
// The enumeration now reads the endpoint registry on disk and never starts a process. The test counts what the
// view does instead of timing it: every child-process entry point (node:child_process and Bun.spawn/spawnSync) is
// spied, so a spawn is seen whether or not the view waits for it, and a registry spy counts the reads.
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import * as childProcess from "node:child_process"
import { createLiveThreadSurface } from "./live-surface"

const SPAWN_ENTRY_POINTS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const

const restores: Array<() => void> = []
afterEach(() => {
  for (const restore of restores.splice(0)) restore()
})

function spawnSpy(): readonly string[] {
  const started: string[] = []
  for (const name of SPAWN_ENTRY_POINTS) {
    const spy = spyOn(childProcess, name).mockImplementation(((...args: unknown[]) => {
      started.push(`${name} ${String(args[0])}`)
      const callback = args.findLast((arg) => typeof arg === "function")
      if (typeof callback === "function") callback(new Error("spawn blocked by the test"), "", "")
      return undefined
    }) as never)
    restores.push(() => spy.mockRestore())
  }
  for (const name of ["spawn", "spawnSync"] as const) {
    const spy = spyOn(Bun, name).mockImplementation(((...args: unknown[]) => {
      started.push(`Bun.${name} ${String(args[0])}`)
      return { pid: 0, exitCode: 1, exited: Promise.resolve(1), kill: () => undefined }
    }) as never)
    restores.push(() => spy.mockRestore())
  }
  return started
}

describe("live thread surface enumeration cost", () => {
  test("#given an engine CLI on the launch path #when a view is listed #then the registry is read once and no process is started", async () => {
    // given
    const started = spawnSpy()
    let registryReads = 0
    const surface = createLiveThreadSurface({} as never, {
      env: { ...process.env, SENPI_RPC_SOCKET: "/tmp/omo-enum-cost-missing.sock" },
      exists: () => false,
      registry: async () => {
        registryReads += 1
        return []
      },
    })

    // when
    await surface.listView({ offline: true })

    // then
    expect(started).toEqual([])
    expect(registryReads).toBe(1)
  })
})
