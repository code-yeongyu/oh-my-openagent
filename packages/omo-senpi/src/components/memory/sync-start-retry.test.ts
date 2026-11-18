import { afterEach, expect, jest, test } from "bun:test"

import type { DeviceSync, EngineStatus } from "@oh-my-opencode/memory-core/sync-engine"

import { createSyncRunner } from "./sync-runner"
import { identity, removeIdentities, session, within } from "./sync-start.test-support"

afterEach(removeIdentities)

function engines() {
  const started: number[] = []
  const closed: number[] = []
  let opened = 0
  let onClose: () => void = () => undefined
  const firstClose = new Promise<void>((resolve) => {
    onClose = resolve
  })
  const open = async (): Promise<DeviceSync> => {
    opened += 1
    const id = opened
    return {
      engine: { start: () => started.push(id) } as unknown as DeviceSync["engine"],
      status: async (): Promise<EngineStatus> => ({ kind: "never_synced" }),
      notifyLocalCommit: () => undefined,
      close: async () => {
        closed.push(id)
        onClose()
      },
    }
  }
  return { open, started, closed, firstClose }
}

test("a start pass that fails on a credential-lock wait is retried on the deferral backoff, and the engine starts once the lock is free (#13701)", async () => {
  const paths = await identity()
  const engine = engines()
  const warnings: string[] = []
  let attempts = 0
  const runner = createSyncRunner({
    logger: { info: () => undefined, warn: (message) => warnings.push(message), error: () => undefined },
    resolveSession: async () => {
      attempts += 1
      if (attempts === 1) throw new Error("Timed out acquiring lock: /home/u/.omo/session-locks/origin.lock")
      return session
    },
    open: engine.open,
    watchHead: () => () => undefined,
  })
  jest.useFakeTimers()
  try {
    await runner.acquire("agent", paths, { enabled: true })
    expect(engine.started).toEqual([])
    expect(warnings).toEqual([expect.stringContaining("memory sync failed to start: Error: Timed out acquiring lock")])

    jest.advanceTimersByTime(15_000)
    await runner.status(paths.repo)

    expect(attempts).toBe(2)
    expect(engine.started).toEqual([1])
    expect(warnings.at(-1)).toBe("memory sync started after 1 failed attempts")
  } finally {
    jest.useRealTimers()
    await runner.release(paths.repo)
  }
})

test("a session's first engine start is reported at warn, so a log without OMO_DEBUG shows that sync started (#13701)", async () => {
  const paths = await identity()
  const engine = engines()
  const warnings: string[] = []
  const runner = createSyncRunner({
    logger: { info: () => undefined, warn: (message) => warnings.push(message), error: () => undefined },
    resolveSession: async () => session,
    open: engine.open,
    watchHead: () => () => undefined,
  })
  try {
    await runner.acquire("agent", paths, { enabled: true })

    expect(engine.started).toEqual([1])
    expect(warnings).toEqual(["memory sync started"])
  } finally {
    await runner.release(paths.repo)
  }
})

test("a start pass still running at its deadline is named at warn and replaced by a retry; when it finishes late, the engine it opened is closed before it starts, so the repo never runs two (#13701)", async () => {
  const paths = await identity()
  const warnings: string[] = []
  const started: number[] = []
  const closed: number[] = []
  let opens = 0
  let finishSlowOpen: () => void = () => undefined
  let onFirstClose: () => void = () => undefined
  const firstClosed = new Promise<void>((resolve) => {
    onFirstClose = resolve
  })
  const runner = createSyncRunner({
    logger: { info: () => undefined, warn: (message) => warnings.push(message), error: () => undefined },
    resolveSession: async () => session,
    open: async (): Promise<DeviceSync> => {
      opens += 1
      const id = opens
      if (id === 1)
        await new Promise<void>((resolve) => {
          finishSlowOpen = resolve
        })
      return {
        engine: { start: () => started.push(id) } as unknown as DeviceSync["engine"],
        status: async (): Promise<EngineStatus> => ({ kind: "never_synced" }),
        notifyLocalCommit: () => undefined,
        close: async () => {
          closed.push(id)
          if (id === 1) onFirstClose()
        },
      }
    },
    watchHead: () => () => undefined,
    startPassDeadlineMs: 1_000,
    deferredRetryMs: 1_000,
  })
  jest.useFakeTimers()
  try {
    const acquiring = runner.acquire("agent", paths, { enabled: true })
    jest.advanceTimersByTime(1_000)
    await acquiring
    expect(warnings).toEqual([expect.stringContaining("memory sync start is stuck at the engine open after 1 s")])
    expect(started).toEqual([])

    jest.advanceTimersByTime(1_000)
    await runner.status(paths.repo)
    expect(started).toEqual([2])

    finishSlowOpen()
    await within(firstClosed, "the replaced start to close its late engine")
    expect(closed).toEqual([1])
    expect(started).toEqual([2])
  } finally {
    jest.useRealTimers()
    await runner.release(paths.repo)
  }
})

test("a start replaced while its engine open still holds the lease does not leave the repo without an engine: the refused pass retries and exactly one engine starts (#13701 review M1, L1)", async () => {
  const paths = await identity()
  const warnings: string[] = []
  const started: number[] = []
  const closed: number[] = []
  let lease: number | null = null
  let opens = 0
  let finishSlowOpen: () => void = () => undefined
  let onFirstClose: () => void = () => undefined
  const firstClosed = new Promise<void>((resolve) => {
    onFirstClose = resolve
  })
  const runner = createSyncRunner({
    logger: { info: () => undefined, warn: (message) => warnings.push(message), error: () => undefined },
    resolveSession: async () => session,
    // The engine lease is a no-wait lock: a second open while the first holds it gets null.
    open: async (): Promise<DeviceSync | null> => {
      opens += 1
      const id = opens
      if (lease !== null) return null
      lease = id
      if (id === 1)
        await new Promise<void>((resolve) => {
          finishSlowOpen = resolve
        })
      return {
        engine: { start: () => started.push(id) } as unknown as DeviceSync["engine"],
        status: async (): Promise<EngineStatus> => ({ kind: "never_synced" }),
        notifyLocalCommit: () => undefined,
        close: async () => {
          if (lease === id) lease = null
          closed.push(id)
          if (id === 1) onFirstClose()
        },
      }
    },
    watchHead: () => () => undefined,
    startPassDeadlineMs: 1_000,
    deferredRetryMs: 1_000,
  })
  jest.useFakeTimers()
  try {
    const acquiring = runner.acquire("agent", paths, { enabled: true })
    jest.advanceTimersByTime(1_000)
    await acquiring
    expect(warnings).toEqual([expect.stringContaining("memory sync start is stuck at the engine open after 1 s")])

    jest.advanceTimersByTime(1_000)
    await runner.status(paths.repo)
    expect(opens).toBe(2)
    expect(warnings.at(-1)).toContain("an earlier start of this memory's sync is still finishing")

    finishSlowOpen()
    await within(firstClosed, "the replaced start to close its late engine")
    expect(closed).toEqual([1])
    expect(lease).toBeNull()

    jest.advanceTimersByTime(2_000)
    await runner.status(paths.repo)
    expect(started).toEqual([3])
    expect(warnings.filter((line) => line.startsWith("memory sync failed to start"))).toEqual([])
    expect(warnings.at(-1)).toBe("memory sync started after 1 failed attempts")
  } finally {
    jest.useRealTimers()
    await runner.release(paths.repo)
  }
})
