import { afterEach, describe, expect, jest, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import { createCredentialStore, quietNotice } from "@oh-my-opencode/omo-opencode/service-auth"

import { readMemoryStatusSegments } from "../status"
import { createSyncRunner } from "../sync-runner"
import { SyncSessionDeferredError } from "../sync-session-deferred"
import { createCliAccountSource } from "./account-source"
import { createDeviceSessionResolver } from "./resolver"

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function identity() {
  const root = await mkdtemp(join(tmpdir(), "omo-keychain-pending-"))
  dirs.push(root)
  const paths = buildIdentityPaths(root, "agent")
  await mkdir(join(paths.repo, ".git", "logs"), { recursive: true })
  await writeFile(join(paths.repo, ".git", "logs", "HEAD"), "")
  return paths
}

// The keychain approval dialog nobody has answered (#11262): the OS read never settles.
function unansweredKeychainStore() {
  let gets = 0
  const store = createCredentialStore("http://127.0.0.1:9", { secrets: { get: () => { gets += 1; return new Promise<string | null>(() => undefined) }, set: async () => undefined, delete: async () => true }, platform: "darwin", lockProbe: async () => "unlocked", notice: quietNotice, wait: { kind: "bounded", deadlineMs: 50 } })
  return { store, gets: () => gets }
}

type Outcome<T> = { readonly state: "resolved"; readonly value: T } | { readonly state: "rejected"; readonly error: unknown } | { readonly state: "hung" }

// The test's own bound: a call that has not settled by then is the hang this file guards against.
async function settled<T>(work: Promise<T>, ms = 2_000): Promise<Outcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const hung = new Promise<Outcome<T>>((resolve) => {
    timer = setTimeout(() => resolve({ state: "hung" }), ms)
  })
  try {
    return await Promise.race([work.then((value): Outcome<T> => ({ state: "resolved", value }), (error: unknown): Outcome<T> => ({ state: "rejected", error })), hung])
  } finally {
    clearTimeout(timer)
  }
}

const noRuntime = async () => {
  throw new Error("a deferred session must not load the sync runtime")
}

describe("memory sync while the keychain waits for approval", () => {
  test("deferred retries back off to five minutes and warn once per escalation", async () => {
    const paths = await identity()
    let attempts = 0
    const warnings: unknown[] = []
    const runner = createSyncRunner({
      logger: { info: () => undefined, warn: (_message, detail) => warnings.push(detail), error: () => undefined },
      resolveSession: async () => {
        attempts += 1
        throw new SyncSessionDeferredError("approval pending", undefined)
      },
    })
    jest.useFakeTimers()
    try {
      await runner.acquire("agent", paths, { enabled: true })
      expect(attempts).toBe(1)
      for (const delay of [15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
        const before = attempts
        jest.advanceTimersByTime(delay - 1)
        expect(attempts).toBe(before)
        jest.advanceTimersByTime(1)
        await runner.status(paths.repo)
        expect(attempts).toBe(before + 1)
      }
      expect(warnings).toHaveLength(6)
      expect(warnings).toMatchObject([15_000, 30_000, 60_000, 120_000, 240_000, 300_000].map(retryMs => ({ retryMs })))
      await runner.release(paths.repo)
      jest.advanceTimersByTime(300_000)
      expect(attempts).toBe(8)
    } finally {
      jest.useRealTimers()
      await runner.release(paths.repo)
    }
  })

  test("a zero or negative deferredRetryMs is clamped to at least 1 s so the retry cannot tight-loop", async () => {
    const paths = await identity()
    let attempts = 0
    const runner = createSyncRunner({
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      resolveSession: async () => {
        attempts += 1
        throw new SyncSessionDeferredError("approval pending", undefined)
      },
      deferredRetryMs: 0,
    })
    jest.useFakeTimers()
    try {
      await runner.acquire("agent", paths, { enabled: true })
      expect(attempts).toBe(1)
      jest.advanceTimersByTime(999)
      expect(attempts).toBe(1)
      jest.advanceTimersByTime(1)
      await runner.status(paths.repo)
      expect(attempts).toBe(2)
    } finally {
      jest.useRealTimers()
      await runner.release(paths.repo)
    }
  })

  test("at the five-minute cap one 'still waiting' line is logged per 15 minutes", async () => {
    const paths = await identity()
    const messages: string[] = []
    const runner = createSyncRunner({
      logger: { info: () => undefined, warn: (message) => messages.push(message), error: () => undefined },
      resolveSession: async () => {
        throw new SyncSessionDeferredError("approval pending", undefined)
      },
    })
    jest.useFakeTimers()
    try {
      await runner.acquire("agent", paths, { enabled: true })
      for (const delay of [15_000, 30_000, 60_000, 120_000, 240_000]) {
        jest.advanceTimersByTime(delay)
        await runner.status(paths.repo)
      }
      const stillWaiting = () => messages.filter((line) => line.includes("still waiting")).length
      for (let pass = 1; pass <= 9; pass += 1) {
        jest.advanceTimersByTime(300_000)
        await runner.status(paths.repo)
        expect(stillWaiting()).toBe(Math.floor(pass / 3))
      }
    } finally {
      jest.useRealTimers()
      await runner.release(paths.repo)
    }
  })

  test("#given an unanswered keychain dialog #when the device account is resolved #then it defers with the actionable keychain message instead of hanging or reading as signed out", async () => {
    const { store } = unansweredKeychainStore()
    const outcome = await settled(createCliAccountSource({ api: "http://127.0.0.1:9", store })())
    expect(outcome.state).toBe("rejected")
    const error = outcome.state === "rejected" ? outcome.error : undefined
    expect((error as { code?: unknown } | undefined)?.code).toBe("sync-session-deferred")
    expect(String(error)).toContain("wants to access key omo-cli")
  })

  test("#given an unanswered keychain dialog #when the memory tool reads the sync status #then it answers promptly and sync logs why it is waiting", async () => {
    const paths = await identity()
    const warnings: string[] = []
    const { store } = unansweredKeychainStore()
    const runner = createSyncRunner({
      logger: { info: () => undefined, warn: (message) => warnings.push(message), error: () => undefined },
      resolveSession: createDeviceSessionResolver({ source: createCliAccountSource({ api: "http://127.0.0.1:9", store }), pinDir: join(paths.root, "pins"), loadRuntime: noRuntime }),
      watchHead: () => () => undefined,
    })
    void runner.acquire("agent", paths, { enabled: true })
    const repo = { head: async () => "", headCommitTimestamp: async () => 0, lsTree: async () => [], show: async () => "", status: async () => "" }
    const context = { identityPaths: paths } as Parameters<typeof readMemoryStatusSegments>[1]
    const segments = await settled(readMemoryStatusSegments(repo, context, undefined, (target) => runner.status(target)))
    expect(segments.state === "resolved" ? segments.value.syncBlocked : segments).toBe(false)
    expect(warnings.some((line) => line.includes("wants to access key omo-cli"))).toBe(true)
    await runner.release(paths.repo)
  })

  test("#given a sync pass deferred by the keychain #when the retry delay passes #then sync resolves the device session again", async () => {
    const paths = await identity()
    const { store } = unansweredKeychainStore()
    const source = createCliAccountSource({ api: "http://127.0.0.1:9", store })
    let resolves = 0
    let secondResolve: () => void = () => undefined
    const retried = new Promise<void>((resolve) => {
      secondResolve = resolve
    })
    const runner = createSyncRunner({
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      resolveSession: async (request) => {
        resolves += 1
        if (resolves === 2) secondResolve()
        return createDeviceSessionResolver({ source, pinDir: join(paths.root, "pins"), loadRuntime: noRuntime })(request)
      },
      watchHead: () => () => undefined,
      deferredRetryMs: 20,
    })
    void runner.acquire("agent", paths, { enabled: true })
    expect((await settled(retried)).state).toBe("resolved")
    await runner.release(paths.repo)
  })
})
