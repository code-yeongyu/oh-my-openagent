import { describe, expect, test } from "bun:test"

import { reconcileThroughStaleLockReaper } from "./reflection-stale-active"

describe("reconcileThroughStaleLockReaper", () => {
  test("#given the commands sidecar fails to load #when the session reconciles #then the load failure is reported and reconcile still runs once", async () => {
    const calls: string[] = []
    const failures: unknown[] = []
    const loadError = new Error("Cannot find module omo-memory-commands.js")

    await reconcileThroughStaleLockReaper({
      runtimeDir: "/nonexistent/runtime",
      reconcile: async () => {
        calls.push("reconcile")
      },
      onLoadFailure: (error) => failures.push(error),
      loadRuntime: () => Promise.reject(loadError),
    })

    expect(calls).toEqual(["reconcile"])
    expect(failures).toEqual([loadError])
  })

  test("#given the sidecar loads #when the session reconciles #then the reaper runs with settleAlways and the session's reconcile as settle", async () => {
    const calls: string[] = []
    const seen: Array<{ runtimeDir: string; settleAlways?: boolean }> = []

    await reconcileThroughStaleLockReaper({
      runtimeDir: "/tmp/identity/runtime",
      reconcile: async () => {
        calls.push("reconcile")
      },
      onLoadFailure: () => calls.push("load-failure"),
      loadRuntime: async () => ({
        runStaleLockReaper: (async (options: {
          runtimeDir: string
          settle?: () => Promise<void>
          settleAlways?: boolean
        }) => {
          seen.push({ runtimeDir: options.runtimeDir, settleAlways: options.settleAlways })
          await options.settle?.()
          return {} as never
        }) as never,
      }),
    })

    expect(seen).toEqual([{ runtimeDir: "/tmp/identity/runtime", settleAlways: true }])
    expect(calls).toEqual(["reconcile"])
  })
})
