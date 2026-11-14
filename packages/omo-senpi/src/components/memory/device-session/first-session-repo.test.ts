import { afterEach, describe, expect, jest, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import type { DeviceKeyring } from "@oh-my-opencode/memory-core/keyring"
import { GitSpaceConfig, listRemotes, resolveSpace } from "@oh-my-opencode/memory-core/sync-engine"

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
    resolveSpace,
    deviceKeyringFromMaterial: async () => ({}) as DeviceKeyring,
    openAccountSession: async (options) => {
      opened.push(Buffer.from(options.spaceId).toString("hex"))
      return { ok: false, reason: "not_member" } as never
    },
  }
}

describe("the first session on a new device (#13486)", () => {
  test("a resolver asked before the memory repository exists defers instead of failing", async () => {
    const { paths, projectDir } = await freshDevice()
    const opened: string[] = []
    const resolve = createDeviceSessionResolver({
      source: async () => signedInCli(),
      pinDir: join(projectDir, "pins"),
      loadRuntime: async () => realSpaceRuntime(opened),
    })

    const error = await resolve({ identity: "agent", paths, space: { profile: null, projectDir } }).then(
      () => null,
      (rejection: unknown) => rejection,
    )

    expect(isSyncSessionDeferred(error)).toBe(true)
    expect(opened).toEqual([])
  })

  test("sync started before the repository exists waits, then starts once the repository is created", async () => {
    const { paths, projectDir } = await freshDevice()
    const opened: string[] = []
    const errors: string[] = []
    const warnings: string[] = []
    const runner = createSyncRunner({
      logger: {
        info: () => undefined,
        warn: (message) => warnings.push(message),
        error: (message) => errors.push(message),
      },
      resolveSession: createDeviceSessionResolver({
        source: async () => signedInCli(),
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

      expect(spawnSync("git", ["init", "-q", paths.repo]).status).toBe(0)
      jest.advanceTimersByTime(15_000)
      await runner.status(paths.repo)

      expect(opened).toHaveLength(1)
      expect(errors).toEqual([])
    } finally {
      jest.useRealTimers()
      await runner.release(paths.repo)
    }
  })
})
