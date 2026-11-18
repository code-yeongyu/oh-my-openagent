import { afterEach, expect, jest, test } from "bun:test"

import type { DeviceSync } from "@oh-my-opencode/memory-core/sync-engine"

import { createSyncRunner } from "./sync-runner"
import { identity, removeIdentities, session, stubDevice, within } from "./sync-start.test-support"

// Starts replaced at their deadline (#13701) and still running: they never block status()/release(), never pile up,
// and the lease they may hold is attributed to them only when they reached the engine open (#13706 review).
afterEach(removeIdentities)

const IDLE = "memory sync idle: another OmO process on this device is syncing this memory"

const logs = () => {
  const warnings: string[] = []
  const infos: string[] = []
  return {
    warnings,
    infos,
    logger: {
      info: (message: string) => infos.push(message),
      warn: (message: string) => warnings.push(message),
      error: () => undefined,
    },
  }
}

test("#given a first start replaced at its deadline and still running #when the next start is stuck too #then status() settles by that start's deadline and a third start waits until one of them ends (review M2)", async () => {
  const paths = await identity()
  const { warnings, logger } = logs()
  const hanging: (() => void)[] = []
  const started: number[] = []
  let reads = 0
  let onThirdRead: () => void = () => undefined
  const thirdRead = new Promise<void>((resolve) => {
    onThirdRead = resolve
  })
  const runner = createSyncRunner({
    logger,
    resolveSession: async () => {
      reads += 1
      if (reads <= 2) await new Promise<void>((resolve) => hanging.push(resolve))
      else onThirdRead()
      return session
    },
    open: async (): Promise<DeviceSync> => stubDevice(1, started),
    watchHead: () => () => undefined,
    startPassDeadlineMs: 1_000,
    deferredRetryMs: 1_000,
  })
  jest.useFakeTimers()
  try {
    const acquiring = runner.acquire("agent", paths, { enabled: true })
    jest.advanceTimersByTime(1_000)
    await within(acquiring, "the first start to reach its deadline")
    jest.advanceTimersByTime(1_000)
    expect(reads).toBe(2)
    jest.advanceTimersByTime(1_000)
    expect(await within(runner.status(paths.repo), "status() while two starts are stuck")).toBeNull()

    jest.advanceTimersByTime(2_000)
    expect(reads).toBe(2)
    expect(warnings.at(-1)).toContain("the next start waits for one of them to finish")

    hanging[0]?.()
    await within(thirdRead, "the waiting start to run once a replaced start ended")
    await within(runner.status(paths.repo), "status() of the third start")
    expect(started).toEqual([1])
  } finally {
    jest.useRealTimers()
    for (const finish of hanging) finish()
    await runner.release(paths.repo)
  }
})

test("#given a start replaced while its engine open holds the lease #when the session releases and acquires again #then the new start retries instead of going idle, and exactly one engine starts (review L4)", async () => {
  const paths = await identity()
  const { warnings, infos, logger } = logs()
  const started: number[] = []
  let lease: number | null = null
  let opens = 0
  let finishSlowOpen: () => void = () => undefined
  let onFirstClose: () => void = () => undefined
  const firstClosed = new Promise<void>((resolve) => {
    onFirstClose = resolve
  })
  const runner = createSyncRunner({
    logger,
    resolveSession: async () => session,
    // The engine lease is a no-wait lock: a second open while the first holds it gets null.
    open: async (): Promise<DeviceSync | null> => {
      opens += 1
      const id = opens
      if (lease !== null) return null
      lease = id
      if (id === 1) await new Promise<void>((resolve) => (finishSlowOpen = resolve))
      return stubDevice(id, started, () => {
        if (lease === id) lease = null
        if (id === 1) onFirstClose()
      })
    },
    watchHead: () => () => undefined,
    startPassDeadlineMs: 1_000,
    deferredRetryMs: 1_000,
  })
  jest.useFakeTimers()
  try {
    const acquiring = runner.acquire("agent", paths, { enabled: true })
    jest.advanceTimersByTime(1_000)
    await within(acquiring, "the first start to reach its deadline")
    await within(runner.release(paths.repo), "the release")
    await within(runner.acquire("agent", paths, { enabled: true }), "the second acquire")
    expect(opens).toBe(2)
    expect(infos).not.toContain(IDLE)
    expect(warnings.at(-1)).toContain("an earlier start of this memory's sync is still finishing")

    finishSlowOpen()
    await within(firstClosed, "the replaced start to close its late engine")
    jest.advanceTimersByTime(1_000)
    await within(runner.status(paths.repo), "status() of the retried start")
    expect(started).toEqual([3])
  } finally {
    jest.useRealTimers()
    finishSlowOpen()
    await runner.release(paths.repo)
  }
})

test("#given a start replaced while still reading the account #when another process holds the engine lease #then the next start reports idle instead of blaming the replaced start (review L6)", async () => {
  const paths = await identity()
  const { warnings, infos, logger } = logs()
  let reads = 0
  let finishFirstRead: () => void = () => undefined
  const runner = createSyncRunner({
    logger,
    resolveSession: async () => {
      reads += 1
      if (reads === 1) await new Promise<void>((resolve) => (finishFirstRead = resolve))
      return session
    },
    open: async () => null,
    watchHead: () => () => undefined,
    startPassDeadlineMs: 1_000,
    deferredRetryMs: 1_000,
  })
  jest.useFakeTimers()
  try {
    const acquiring = runner.acquire("agent", paths, { enabled: true })
    jest.advanceTimersByTime(1_000)
    await within(acquiring, "the first start to reach its deadline")
    jest.advanceTimersByTime(1_000)
    await within(runner.status(paths.repo), "status() of the second start")
    expect(reads).toBe(2)
    expect(infos).toContain(IDLE)
    expect(warnings.filter((line) => line.includes("still finishing"))).toEqual([])
  } finally {
    jest.useRealTimers()
    finishFirstRead()
    await runner.release(paths.repo)
  }
})

test("#given fake timers #when the awaited work never settles #then the circuit breaker still fails the wait on real time (review L5)", async () => {
  jest.useFakeTimers()
  try {
    await expect(within(new Promise<never>(() => undefined), "nothing", 200)).rejects.toThrow(
      "waited 0.2s for nothing, never happened",
    )
  } finally {
    jest.useRealTimers()
  }
})
