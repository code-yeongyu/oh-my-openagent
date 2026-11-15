import { afterEach, describe, expect, jest, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import type { DeviceKeyring } from "@oh-my-opencode/memory-core/keyring"
import { GitSpaceConfig, listRemotes, repoHasCommit, resolveSpace } from "@oh-my-opencode/memory-core/sync-engine"

import { createSyncRunner } from "../sync-runner"
import { isSyncSessionDeferred } from "../sync-session-deferred"
import type { CliDeviceAccount } from "./account-source"
import { createDeviceSessionResolver, type DeviceSessionRuntime } from "./resolver"

// #13486: on a newly enabled or joined device the first session starts sync before its memory repository exists
// (the repository is created at the first memory write). Writing the space binding to that repository then failed,
// and the runner logged "memory sync failed to start" once and never retried.

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function freshDevice() {
  const root = await mkdtemp(join(tmpdir(), "omo-first-session-"))
  dirs.push(root)
  return { paths: buildIdentityPaths(root, "agent"), projectDir: root }
}

function git(repo: string, ...args: string[]) {
  expect(spawnSync("git", ["-C", repo, ...args]).status).toBe(0)
}

function firstCommit(repo: string) {
  git(repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "--allow-empty", "-m", "first")
}

// Counts account-source passes: a pass reads the OS keychain and calls the account service.
function countingSource() {
  let passes = 0
  const source = async () => {
    passes++
    return signedInCli()
  }
  return { source, passes: () => passes }
}

function signedInCli(): CliDeviceAccount {
  return {
    kind: "cli",
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
    openAccountSession: async (options) => {
      opened.push(Buffer.from(options.spaceId).toString("hex"))
      return { ok: false, reason: "not_member" } as never
    },
  }
}

describe("the first session on a new device (#13486)", () => {
  test("a resolver asked before the memory repository exists defers, and its retries ask the account nothing", async () => {
    const { paths, projectDir } = await freshDevice()
    const opened: string[] = []
    const account = countingSource()
    const resolve = createDeviceSessionResolver({
      source: account.source,
      pinDir: join(projectDir, "pins"),
      loadRuntime: async () => realSpaceRuntime(opened),
    })

    const pass = () =>
      resolve({ identity: "agent", paths, space: { profile: null, projectDir } }).then(
        () => null,
        (rejection: unknown) => rejection,
      )

    expect(isSyncSessionDeferred(await pass())).toBe(true)
    expect(isSyncSessionDeferred(await pass())).toBe(true)
    expect(opened).toEqual([])
    // Only the first pass reads the account. A retry that read it again would hit the OS keychain and the account
    // service every time; on macOS an "Allow" (not "Always Allow") answer would prompt on every retry.
    expect(account.passes()).toBe(1)
  })

  test("a repository that is initialised but has no first commit yet defers and gets no space binding", async () => {
    const { paths, projectDir } = await freshDevice()
    git(projectDir, "init", "-q", paths.repo)
    const opened: string[] = []
    const account = countingSource()
    const resolve = createDeviceSessionResolver({
      source: account.source,
      pinDir: join(projectDir, "pins"),
      loadRuntime: async () => realSpaceRuntime(opened),
    })

    const error = await resolve({ identity: "agent", paths, space: { profile: null, projectDir } }).then(
      () => null,
      (rejection: unknown) => rejection,
    )

    // The memory repo's creation writes its own config between `git init` and the first commit; a binding written in
    // that window can collide with it and stop sync for good.
    expect(isSyncSessionDeferred(error)).toBe(true)
    expect(new GitSpaceConfig(paths.repo).get("omo.sync.space")).toBeNull()
    expect(opened).toEqual([])
  })

  test("sync started before the repository exists waits, then starts once the repository is created", async () => {
    const { paths, projectDir } = await freshDevice()
    const opened: string[] = []
    const errors: string[] = []
    const warnings: string[] = []
    const account = countingSource()
    const runner = createSyncRunner({
      logger: {
        info: () => undefined,
        warn: (message) => warnings.push(message),
        error: (message) => errors.push(message),
      },
      resolveSession: createDeviceSessionResolver({
        source: account.source,
        pinDir: join(projectDir, "pins"),
        loadRuntime: async () => realSpaceRuntime(opened),
      }),
    })
    jest.useFakeTimers()
    try {
      await runner.acquire("agent", paths, { enabled: true }, { profile: null, projectDir })
      await runner.status(paths.repo)
      expect(errors).toEqual([])
      expect(warnings).toHaveLength(1)
      expect(opened).toEqual([])

      git(projectDir, "init", "-q", paths.repo)
      jest.advanceTimersByTime(15_000)
      await runner.status(paths.repo)
      expect(opened).toEqual([])
      expect(account.passes()).toBe(1)

      firstCommit(paths.repo)
      jest.advanceTimersByTime(30_000)
      await runner.status(paths.repo)

      expect(opened).toHaveLength(1)
      expect(account.passes()).toBe(2)
      expect(errors).toEqual([])
    } finally {
      jest.useRealTimers()
      await runner.release(paths.repo)
    }
  })
})
