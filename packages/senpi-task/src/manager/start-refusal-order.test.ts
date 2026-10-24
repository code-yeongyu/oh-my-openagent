import type { ChildProcess } from "node:child_process"
import { expect, jest, test } from "bun:test"
import { setImmediate } from "node:timers/promises"

import { RpcProcessRunner } from "../runners/rpc-process"
import { spawnFakeChild } from "../runners/rpc/__fixtures__/spawn-fake"
import { baseSpec, cleanupProjects, makeManager } from "./__fixtures__/manager-fakes"
import { createRpcManagedRunner } from "./runner"

test("#given a delayed first-write refusal #when teardown holds its live child #then start reports start_failed", async () => {
  const writing = Promise.withResolvers<(error: Error) => void>()
  const terminating = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const terminated = Promise.withResolvers<void>()
  const startSettled = Promise.withResolvers<void>()
  const watchdog = Promise.withResolvers<never>()
  const watchdogTimer = setTimeout(() => watchdog.reject(new Error("start-refusal ordering did not settle within 2s")), 2_000)
  let child: ChildProcess | undefined
  let terminationStarted = false
  let settledKind: string | undefined
  const rpcRunner = new RpcProcessRunner({
    modelAdmission: async () => {},
    buildSpawn: (spec) => ({ command: process.execPath, args: [], cwd: spec.cwd, env: process.env }),
    spawnChild: () => {
      const spawned = spawnFakeChild()
      child = spawned
      if (spawned.stdin === null) throw new Error("fake child stdin was not piped")
      Object.defineProperty(spawned.stdin, "write", {
        value: (...args: unknown[]): boolean => {
          const callback = args.findLast((value): value is (error: Error) => void => typeof value === "function")
          if (callback === undefined) throw new Error("first prompt write omitted its callback")
          writing.resolve(callback)
          return false
        },
      })
      return spawned
    },
    terminateChild: async (spawned) => {
      terminationStarted = true
      terminating.resolve()
      await release.promise
      const exited = new Promise<void>((resolve) => spawned.once("exit", () => resolve()))
      spawned.kill("SIGTERM")
      await exited
      terminated.resolve()
    },
  })
  const { manager, store } = makeManager({ process: createRpcManagedRunner(rpcRunner) })
  jest.useFakeTimers()
  try {
    const starting = manager.start(baseSpec({ execution_mode: "process" }))
    void starting.then(
      (result) => {
        settledKind = result.kind
        startSettled.resolve()
      },
      (error: unknown) => watchdog.reject(error),
    )
    // manager.start reports a provisional result after a 250 ms settledWithin window. Freezing that
    // timer prevents a slow real child spawn from producing `started` before the write is observed;
    // such a flake would throw here or fail the final kind assertion instead of proving the ordering.
    const rejectWrite = await Promise.race([
      writing.promise,
      starting.then((result) => { throw new Error(`start settled before its first write: ${result.kind}`) }),
      watchdog.promise,
    ])
    rejectWrite(new Error("synthetic delayed first prompt refusal"))
    await Promise.race([terminating.promise, watchdog.promise])
    // A check-phase turn drains the rejection's promise jobs. Fixed code has now settled from the
    // rejection alone; unfixed code is still held in teardown until the virtual report window fires.
    await Promise.race([setImmediate(), watchdog.promise])
    if (settledKind === undefined) {
      expect(settledKind).toBeUndefined()
      jest.advanceTimersByTime(250)
      await Promise.race([startSettled.promise, watchdog.promise])
    }
    const result = await Promise.race([starting, watchdog.promise])
    expect(child?.exitCode).toBeNull()
    expect(child?.signalCode).toBeNull()
    expect(result.kind).toBe("start_failed")
    if (result.kind !== "start_failed") throw new Error(`unexpected start result: ${result.kind}`)
    const record = store.load(result.task_id)
    expect(record?.status).toBe("error")
    expect(result.failure_kind).toBe("child-prompt-failed")
  } finally {
    jest.useRealTimers()
    release.resolve()
    if (child !== undefined) {
      const activeChild = child
      if (terminationStarted) {
        await Promise.race([terminated.promise, watchdog.promise])
      } else if (activeChild.exitCode === null && activeChild.signalCode === null) {
        const exited = new Promise<void>((resolve) => activeChild.once("exit", () => resolve()))
        activeChild.kill("SIGTERM")
        await Promise.race([exited, watchdog.promise])
      }
    }
    // Both dev's awaited teardown and the fixed detached teardown must settle
    // before fixture directories are removed.
    await manager.settleLaunchesForShutdown?.(2_000)
    clearTimeout(watchdogTimer)
    cleanupProjects()
  }
}, 10_000)
