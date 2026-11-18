import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import type { DeviceKeyring } from "@oh-my-opencode/memory-core/keyring"
import { GitSpaceConfig, listRemotes, repoHasCommit, resolveSpace } from "@oh-my-opencode/memory-core/sync-engine"

import { createMemoryIdentityContext, getMemoryRepo } from "../context"
import { prepareMemoryEngineSession } from "../engine-session"
import { createSyncRunner } from "../sync-runner"
import { isSyncSessionDeferred } from "../sync-session-deferred"
import type { CliDeviceAccount } from "./account-source"
import { joinedDeviceRepoCreator } from "./joined-repo"
import { createDeviceSessionResolver, type DeviceSessionRuntime } from "./resolver"
import { rmEfaultTolerant } from "../teardown.test-support"

// omo#14094 (LEAD ruling: option A with limits): a device that has sync on and has joined the account gets its memory
// repository from the existing first-write seam, so the account's memory arrives with no write on this device. Every
// other path keeps #13493's rule: reads, a sync-off device and a device that has not joined create no identity storage.

const dirs: string[] = []
// A child can still hold a handle inside its scratch root when teardown runs; on Windows that makes
// a bare rm fail and leaks the root into the OS temp dir (the #9766 unnamed teardown red). The
// bounded, release-aware house helper rides out exactly those transient holders.
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rmEfaultTolerant(dir, { recursive: true, force: true })
})

async function freshDevice() {
  const root = await mkdtemp(join(tmpdir(), "omo-joined-repo-"))
  dirs.push(root)
  return { root, paths: buildIdentityPaths(root, "agent"), projectDir: root }
}

function commitCount(repo: string): number {
  const result = spawnSync("git", ["-C", repo, "rev-list", "--count", "HEAD"], { encoding: "utf8" })
  return Number(result.stdout.trim())
}

function signedInCli(): CliDeviceAccount {
  return {
    kind: "cli",
    signal: new AbortController().signal,
    api: "http://127.0.0.1:9",
    accountId: "account",
    accessToken: async () => "token",
    isCurrent: async () => true,
    signedOut: async () => false,
    keyring: async () => ({}) as DeviceKeyring,
  } as unknown as CliDeviceAccount
}

function realSpaceRuntime(opened: string[]): DeviceSessionRuntime {
  return {
    GitSpaceConfig,
    listRemotes,
    repoHasCommit,
    resolveSpace,
    deviceKeyringFromMaterial: async () => ({}) as DeviceKeyring,
    isDeviceSyncOff: async () => false,
    openAccountSession: async (options) => {
      opened.push(Buffer.from(options.spaceId).toString("hex"))
      return { ok: false, reason: "not_member" } as never
    },
  }
}

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined }

function recordingLogger() {
  const info: string[] = []
  return { info, logger: { ...silent, info: (message: string) => void info.push(message) } }
}

async function settle(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (rejection: unknown) => rejection,
  )
}

describe("a joined device with sync on and no memory repository (#14094)", () => {
  test("#given a joined device that never wrote #when sync resolves #then the repository is created through the seam and the session opens", async () => {
    // given
    const { paths, projectDir } = await freshDevice()
    const opened: string[] = []
    const { info, logger } = recordingLogger()
    const resolve = createDeviceSessionResolver({
      source: async () => signedInCli(),
      pinDir: join(projectDir, "pins"),
      loadRuntime: async () => realSpaceRuntime(opened),
      joinedRepo: { joined: async (account) => account === "account", create: joinedDeviceRepoCreator(logger) },
    })

    // when
    await resolve({ identity: "agent", paths, space: { profile: null, projectDir } })

    // then
    expect(repoHasCommit(paths.repo)).toBe(true)
    expect(opened).toHaveLength(1)
    expect(info.filter((line) => line.includes("created this device's memory repository"))).toHaveLength(1)
  })

  test("#given a device that has not joined #when sync resolves #then it defers and creates no identity storage", async () => {
    // given
    const { root, paths, projectDir } = await freshDevice()
    const opened: string[] = []
    const resolve = createDeviceSessionResolver({
      source: async () => signedInCli(),
      pinDir: join(projectDir, "pins"),
      loadRuntime: async () => realSpaceRuntime(opened),
      joinedRepo: { joined: async () => false, create: joinedDeviceRepoCreator(silent) },
    })

    // when
    const error = await settle(resolve({ identity: "agent", paths, space: { profile: null, projectDir } }))

    // then
    expect(isSyncSessionDeferred(error)).toBe(true)
    expect(existsSync(paths.repo)).toBe(false)
    expect(existsSync(paths.locks)).toBe(false)
    expect(existsSync(join(root, "agents"))).toBe(false)
    expect(opened).toEqual([])
  })

  test("#given a device that joins while sync already waits #when the next retry runs #then it creates the repository without reading the account again", async () => {
    // given
    const { paths, projectDir } = await freshDevice()
    let joined = false
    let accountReads = 0
    const opened: string[] = []
    const resolve = createDeviceSessionResolver({
      source: async () => {
        accountReads++
        return signedInCli()
      },
      pinDir: join(projectDir, "pins"),
      loadRuntime: async () => realSpaceRuntime(opened),
      joinedRepo: { joined: async () => joined, create: joinedDeviceRepoCreator(silent) },
    })
    const request = { identity: "agent", paths, space: { profile: null, projectDir } }
    expect(isSyncSessionDeferred(await settle(resolve(request)))).toBe(true)

    // when
    joined = true
    await settle(resolve(request))

    // then
    expect(repoHasCommit(paths.repo)).toBe(true)
    // The retry that created the repository reads the account once more to open the session; the waiting retry did not.
    expect(accountReads).toBe(2)
    expect(opened).toHaveLength(1)
  })

  test("#given sync off #when a session acquires the runner #then the resolver never runs and nothing is created", async () => {
    // given
    const { root, paths, projectDir } = await freshDevice()
    let resolved = 0
    const runner = createSyncRunner({
      logger: silent,
      resolveSession: async () => {
        resolved++
        return null
      },
    })

    // when
    await runner.acquire("agent", paths, { enabled: false }, { profile: null, projectDir })

    // then
    expect(resolved).toBe(0)
    expect(existsSync(join(root, "agents"))).toBe(false)
  })

  test("#given an identity context #when its memory repository is only read #then no identity storage exists", async () => {
    // given
    const { root, paths } = await freshDevice()

    // when
    const context = createMemoryIdentityContext({
      identity: "agent",
      identityPaths: paths,
      binding: undefined as never,
    })
    const access = getMemoryRepo(context)

    // then
    expect(access.path).toBe(paths.repo)
    expect(existsSync(join(root, "agents"))).toBe(false)
  })

  test("#given a first sync and a first write at the same moment #when both reach the seam #then the repository is created once and logged once", async () => {
    // given
    const { paths } = await freshDevice()
    const { info, logger } = recordingLogger()
    const create = joinedDeviceRepoCreator(logger)
    const request = { identity: "agent", paths, space: { profile: null, projectDir: paths.root } }

    // when
    await Promise.all([create(request), create(request), prepareMemoryEngineSession("agent", paths)])

    // then
    expect(commitCount(paths.repo)).toBe(1)
    expect(info.filter((line) => line.includes("created this device's memory repository")).length).toBeLessThanOrEqual(
      1,
    )
  })

  test("#given two first syncs at the same moment #when both reach the seam #then exactly one creates and logs", async () => {
    // given
    const { paths } = await freshDevice()
    const { info, logger } = recordingLogger()
    const create = joinedDeviceRepoCreator(logger)
    const request = { identity: "agent", paths, space: { profile: null, projectDir: paths.root } }

    // when
    await Promise.all([create(request), create(request)])

    // then
    expect(commitCount(paths.repo)).toBe(1)
    expect(info.filter((line) => line.includes("created this device's memory repository"))).toHaveLength(1)
  })
})
