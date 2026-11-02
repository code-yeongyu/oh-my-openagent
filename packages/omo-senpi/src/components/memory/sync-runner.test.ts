import { afterEach, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { existsSync, type FSWatcher } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import type { DeviceSync, EngineStatus, SyncSession } from "@oh-my-opencode/memory-core/sync-engine"

import { lazyCliAccountSource } from "./device-session/account-runtime-loader"
import { createDeviceSessionResolver } from "./device-session/resolver"
import { SYNC_CLOSE_WAIT_EXCEEDED, SYNC_CONFIG_INVALID, SYNC_IDLE_NO_DEVICE_SESSION, SYNC_UNAVAILABLE, createSyncRunner, watchHeadLog } from "./sync-runner"

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

test("an unloadable device account sidecar reports sync-unavailable with its reason, like the engine sidecar", async () => {
  const paths = await identity()
  const warned: { message: string; code: unknown }[] = []
  const errors: string[] = []
  const missing = Object.assign(new Error("Cannot find module '#omo-device-account-runtime'"), { code: "ERR_MODULE_NOT_FOUND" })
  const runner = createSyncRunner({
    logger: {
      info: () => undefined,
      warn: (message: string, meta?: Record<string, unknown>) => warned.push({ message, code: meta?.code }),
      error: (message: string) => errors.push(message),
    },
    resolveSession: createDeviceSessionResolver({
      source: lazyCliAccountSource({ env: {} }, async () => {
        throw missing
      }),
      pinDir: join(paths.runtime, "pins"),
      loadRuntime: () => Promise.reject(new Error("the engine sidecar is not reached when the account cannot load")),
    }),
    watchHead: () => () => undefined,
  })
  await runner.acquire("agent", paths, { enabled: true })
  const status = await runner.status(paths.repo)
  expect(status?.kind).toBe(SYNC_UNAVAILABLE)
  expect(status !== null && "reason" in status ? status.reason : "").toContain("#omo-device-account-runtime")
  expect(warned.map((w) => w.code)).toEqual([SYNC_UNAVAILABLE])
  expect(errors).toEqual([])
  await runner.release(paths.repo)
})

test("an invalid OMO_SERVICE_API_URL is reported as a configuration error naming the variable, not as an unavailable sidecar", async () => {
  const paths = await identity()
  const warned: unknown[] = []
  const errors: { message: string; code: unknown; variable: unknown }[] = []
  const runner = createSyncRunner({
    logger: {
      info: () => undefined,
      warn: (_message: string, meta?: Record<string, unknown>) => warned.push(meta?.code),
      error: (message: string, meta?: Record<string, unknown>) => errors.push({ message, code: meta?.code, variable: meta?.variable }),
    },
    resolveSession: createDeviceSessionResolver({
      source: lazyCliAccountSource({ env: { OMO_SERVICE_API_URL: "not a url" } }),
      pinDir: join(paths.runtime, "pins"),
      loadRuntime: () => Promise.reject(new Error("the engine sidecar is not reached when the account cannot be built")),
    }),
    watchHead: () => () => undefined,
  })
  await runner.acquire("agent", paths, { enabled: true })
  const status = await runner.status(paths.repo)
  expect(status?.kind).toBe(SYNC_CONFIG_INVALID)
  expect(status !== null && "variable" in status ? status.variable : undefined).toBe("OMO_SERVICE_API_URL")
  expect(warned).toEqual([])
  expect(errors).toHaveLength(1)
  expect(errors[0]?.code).toBe(SYNC_CONFIG_INVALID)
  expect(errors[0]?.variable).toBe("OMO_SERVICE_API_URL")
  expect(errors[0]?.message).toContain("OMO_SERVICE_API_URL")
  expect(errors[0]?.message).not.toContain("sidecar")
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

test("a running engine whose device signs out (or is revoked) closes and leaves the runner idle", async () => {
  const paths = await identity()
  const fake = fakeOpen()
  const lines: string[] = []
  let wentIdle: () => void = () => undefined
  const idle = new Promise<void>((resolve) => {
    wentIdle = resolve
  })
  const recording = {
    info: (m: string) => {
      lines.push(m)
      if (m === SYNC_IDLE_NO_DEVICE_SESSION) wentIdle()
    },
    warn: () => undefined,
    error: () => undefined,
  }
  let endSignIn: () => void = () => undefined
  const runner = createSyncRunner({
    logger: recording,
    resolveSession: async () => ({ ...session, onEnded: (notify) => { endSignIn = notify } }),
    open: fake.open,
    watchHead: () => () => undefined,
  })
  await runner.acquire("agent", paths, { enabled: true })
  expect(fake.opened).toEqual([paths.repo])
  endSignIn()
  await Promise.race([idle, new Promise((_, reject) => setTimeout(() => reject(new Error("waited 5s for the runner to go idle after sign-out")), 5_000))])
  expect(fake.closed).toEqual([paths.repo])
  expect(await runner.status(paths.repo)).toBeNull()
  expect(lines).toEqual([SYNC_IDLE_NO_DEVICE_SESSION])
  await runner.release(paths.repo)
  expect(fake.closed).toEqual([paths.repo])
})

test("the runner reports a status change with the repository it belongs to (omo #10637 review L2)", async () => {
  const paths = await identity()
  let forwarded: (() => void) | undefined
  const changed: string[] = []
  const runner = createSyncRunner({
    logger,
    resolveSession: async () => session,
    onStatusChange: (repo) => changed.push(repo),
    open: async (o) => {
      forwarded = o.onStatusChange
      return {
        engine: { start: () => undefined } as unknown as DeviceSync["engine"],
        status: async (): Promise<EngineStatus> => ({ kind: "never_synced" }),
        notifyLocalCommit: () => undefined,
        close: async () => undefined,
      }
    },
    watchHead: () => () => undefined,
  })
  await runner.acquire("agent", paths, { enabled: true })
  forwarded?.()
  expect(changed).toEqual([paths.repo])
  await runner.release(paths.repo)
})
