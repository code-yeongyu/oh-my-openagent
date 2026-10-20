import { afterEach, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { existsSync, type FSWatcher } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import type { DeviceSync, EngineStatus, SyncSession } from "@oh-my-opencode/memory-core/sync-engine"

import { SYNC_CLOSE_WAIT_EXCEEDED, SYNC_IDLE_NO_DEVICE_SESSION, SYNC_UNAVAILABLE, createSyncRunner, watchHeadLog } from "./sync-runner"

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function identity() {
  const root = await mkdtemp(join(tmpdir(), "omo-sync-runner-"))
  dirs.push(root)
  const paths = buildIdentityPaths(root, "agent")
  await mkdir(join(paths.repo, ".git", "logs"), { recursive: true })
  await writeFile(join(paths.repo, ".git", "logs", "HEAD"), "")
  return paths
}

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined }
const session = {} as SyncSession

function fakeOpen() {
  const opened: string[] = []
  const closed: string[] = []
  const started: string[] = []
  let commits = 0
  const open = async (o: { repoDir: string }): Promise<DeviceSync> => {
    opened.push(o.repoDir)
    return {
      engine: { start: () => started.push(o.repoDir) } as unknown as DeviceSync["engine"],
      status: async (): Promise<EngineStatus> => ({ kind: "never_synced" }),
      notifyLocalCommit: () => {
        commits += 1
      },
      close: async () => {
        closed.push(o.repoDir)
      },
    }
  }
  return { open, opened, closed, started, commits: () => commits }
}

test("sessions sharing a repository share one engine, started once and closed with the last session", async () => {
  const paths = await identity()
  const fake = fakeOpen()
  const runner = createSyncRunner({ logger, resolveSession: async () => session, open: fake.open, watchHead: () => () => undefined })
  await runner.acquire("agent", paths, { enabled: true })
  await runner.acquire("agent", paths, { enabled: true })
  expect([fake.opened, fake.started]).toEqual([[paths.repo], [paths.repo]])
  await runner.release(paths.repo)
  expect(fake.closed).toEqual([])
  expect(await runner.status(paths.repo)).toEqual({ kind: "never_synced" })
  await runner.release(paths.repo)
  expect(fake.closed).toEqual([paths.repo])
  expect(await runner.status(paths.repo)).toBeNull()
})

test("without a device session the production runner is a no-op: one typed idle line, no engine, nothing written", async () => {
  const paths = await identity()
  const lines: string[] = []
  const recording = { info: (m: string) => lines.push(m), warn: (m: string) => lines.push(`warn ${m}`), error: (m: string) => lines.push(`error ${m}`) }
  const runner = createSyncRunner({ logger: recording })
  await runner.acquire("agent", paths, { enabled: true })
  await runner.acquire("agent", paths, { enabled: true })
  expect(lines).toEqual([SYNC_IDLE_NO_DEVICE_SESSION])
  expect(await runner.status(paths.repo)).toBeNull()
  expect(existsSync(join(paths.repo, ".git", "omo-sync"))).toBe(false)
  await runner.release(paths.repo)
  await runner.release(paths.repo)
})

test("memory.sync.enabled false, or no signed-in device session, opens nothing", async () => {
  const paths = await identity()
  const fake = fakeOpen()
  const off = createSyncRunner({ logger, resolveSession: async () => session, open: fake.open, watchHead: () => () => undefined })
  await off.acquire("agent", paths, { enabled: false })
  const signedOut = createSyncRunner({ logger, resolveSession: async () => null, open: fake.open, watchHead: () => () => undefined })
  await signedOut.acquire("agent", paths, { enabled: true })
  expect(fake.opened).toEqual([])
  expect(await signedOut.status(paths.repo)).toBeNull()
  await signedOut.release(paths.repo)
})

test("a commit seen by the HEAD reflog watch starts a local-commit cycle, and one cycle follows arming", async () => {
  const paths = await identity()
  const fake = fakeOpen()
  let onChange: () => void = () => undefined
  let watched = ""
  let closed = false
  const runner = createSyncRunner({
    logger,
    resolveSession: async () => session,
    open: fake.open,
    watchHead: (gitDir, listener, warn) =>
      watchHeadLog(gitDir, listener, warn, (path, _options, fire) => {
        watched = path
        onChange = fire
        return Object.assign(new EventEmitter(), { close: () => { closed = true } }) as unknown as FSWatcher
      }),
  })
  await runner.acquire("agent", paths, { enabled: true })
  expect(watched).toBe(join(paths.repo, ".git", "logs", "HEAD"))
  expect(fake.commits()).toBe(1)
  onChange()
  expect(fake.commits()).toBe(2)
  await runner.release(paths.repo)
  expect(closed).toBe(true)
})

test("watchHeadLog reports a missing reflog instead of silently never firing", () => {
  const warnings: string[] = []
  const stop = watchHeadLog("/nonexistent/.git", () => undefined, (m) => warnings.push(m))
  stop()
  expect(warnings).toHaveLength(1)
})

test("a missing sync sidecar leaves the runner idle with a typed sync-unavailable status, not a crash", async () => {
  const paths = await identity()
  const warned: { message: string; code: unknown }[] = []
  const errors: string[] = []
  const missing = Object.assign(new Error("Cannot find module '#omo-memory-sync-runtime'"), { code: "ERR_MODULE_NOT_FOUND" })
  const runner = createSyncRunner({
    logger: {
      info: () => undefined,
      warn: (message: string, meta?: Record<string, unknown>) => warned.push({ message, code: meta?.code }),
      error: (message: string) => errors.push(message),
    },
    resolveSession: async () => session,
    loadRuntime: async () => {
      throw missing
    },
    watchHead: () => () => undefined,
  })
  await runner.acquire("agent", paths, { enabled: true })
  const status = await runner.status(paths.repo)
  expect(status?.kind).toBe(SYNC_UNAVAILABLE)
  expect(status !== null && "reason" in status ? status.reason : "").toContain("#omo-memory-sync-runtime")
  expect(warned.map((w) => w.code)).toEqual([SYNC_UNAVAILABLE])
  expect(errors).toEqual([])
  await runner.release(paths.repo)
})

test("a release followed at once by an acquire of the same repo waits for the close and keeps sync running", async () => {
  const paths = await identity()
  let leased = false
  const infos: string[] = []
  let started = 0
  const open = async (): Promise<DeviceSync | null> => {
    if (leased) return null
    leased = true
    return {
      engine: { start: () => { started += 1 } } as unknown as DeviceSync["engine"],
      status: async (): Promise<EngineStatus> => ({ kind: "never_synced" }),
      notifyLocalCommit: () => undefined,
      close: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        leased = false
      },
    }
  }
  const runner = createSyncRunner({
    logger: { info: (m: string) => infos.push(m), warn: () => undefined, error: () => undefined },
    resolveSession: async () => session,
    open,
    watchHead: () => () => undefined,
  })
  await runner.acquire("agent", paths, { enabled: true })
  void runner.release(paths.repo)
  await runner.acquire("agent", paths, { enabled: true })
  expect(started).toBe(2)
  expect(await runner.status(paths.repo)).toEqual({ kind: "never_synced" })
  expect(infos.filter((m) => m.includes("another OmO process"))).toEqual([])
  await runner.release(paths.repo)
})

test("an acquire waiting on a close that never finishes gives up after the bound with a clear error", async () => {
  const paths = await identity()
  const errors: { message: string; code: unknown }[] = []
  let opens = 0
  const runner = createSyncRunner({
    logger: { info: () => undefined, warn: () => undefined, error: (message: string, meta?: Record<string, unknown>) => errors.push({ message, code: meta?.code }) },
    resolveSession: async () => session,
    open: async (): Promise<DeviceSync | null> => {
      opens += 1
      return {
        engine: { start: () => undefined } as unknown as DeviceSync["engine"],
        status: async (): Promise<EngineStatus> => ({ kind: "never_synced" }),
        notifyLocalCommit: () => undefined,
        close: () => new Promise<void>(() => undefined),
      }
    },
    watchHead: () => () => undefined,
    closeWaitMs: 30,
  })
  await runner.acquire("agent", paths, { enabled: true })
  void runner.release(paths.repo)
  await runner.acquire("agent", paths, { enabled: true })
  expect(errors.map((e) => e.code)).toEqual([SYNC_CLOSE_WAIT_EXCEEDED])
  expect(errors[0]?.message).toContain("did not close")
  expect(opens).toBe(2)
})

test("the runner answers device names from the session its resolver returned, and nothing before a session exists", async () => {
  const paths = await identity()
  const fake = fakeOpen()
  const runner = createSyncRunner({
    logger,
    resolveSession: async () => ({ ...session, deviceName: (principal: string) => (principal === "device:dev-mini" ? "Mac mini" : undefined) }),
    open: fake.open,
    watchHead: () => () => undefined,
  })
  expect(runner.deviceName("device:dev-mini")).toBeUndefined()
  await runner.acquire("agent", paths, { enabled: true })
  expect(runner.deviceName("device:dev-mini")).toBe("Mac mini")
  expect(runner.deviceName("device:other")).toBeUndefined()
  await runner.release(paths.repo)
})
