import { afterEach, expect, jest, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import type { DeviceSync, EngineStatus, SyncSession } from "@oh-my-opencode/memory-core/sync-engine"

import { createSyncRunner } from "./sync-runner"

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function identity() {
  const root = await mkdtemp(join(tmpdir(), "omo-sync-start-retry-"))
  dirs.push(root)
  const paths = buildIdentityPaths(root, "agent")
  await mkdir(join(paths.repo, ".git", "logs"), { recursive: true })
  await writeFile(join(paths.repo, ".git", "logs", "HEAD"), "")
  return paths
}

const session = {} as SyncSession

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

test("a start pass still running at its deadline is named at warn and replaced by a retry; when it finishes late, the engine it opened is closed, so the repo never runs two (#13701)", async () => {
  const paths = await identity()
  const engine = engines()
  const warnings: string[] = []
  let attempts = 0
  let finishFirst: (resolved: SyncSession) => void = () => undefined
  const runner = createSyncRunner({
    logger: { info: () => undefined, warn: (message) => warnings.push(message), error: () => undefined },
    resolveSession: async () => {
      attempts += 1
      if (attempts > 1) return session
      return new Promise<SyncSession>((resolve) => {
        finishFirst = resolve
      })
    },
    open: engine.open,
    watchHead: () => () => undefined,
    startPassDeadlineMs: 1_000,
    deferredRetryMs: 1_000,
  })
  jest.useFakeTimers()
  try {
    const acquiring = runner.acquire("agent", paths, { enabled: true })
    jest.advanceTimersByTime(1_000)
    await acquiring
    expect(warnings).toEqual([expect.stringContaining("memory sync start is stuck at the account read after 1 s")])
    expect(engine.started).toEqual([])

    jest.advanceTimersByTime(1_000)
    await runner.status(paths.repo)
    expect(attempts).toBe(2)
    expect(engine.started).toEqual([1])

    jest.useRealTimers()
    let breaker: ReturnType<typeof setTimeout> | undefined
    const neverClosed = new Promise<never>((_resolve, reject) => {
      breaker = setTimeout(
        () => reject(new Error("waited 5s for the late pass to close its engine, never closed")),
        5_000,
      )
    })
    finishFirst(session)
    await Promise.race([engine.firstClose, neverClosed]).finally(() => clearTimeout(breaker))
    expect(engine.closed).toEqual([2])
    expect(engine.started).toEqual([1])
  } finally {
    jest.useRealTimers()
    await runner.release(paths.repo)
  }
})
