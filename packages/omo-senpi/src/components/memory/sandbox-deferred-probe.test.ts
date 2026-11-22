import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SandboxUnavailableError, type SandboxPolicy } from "./sandbox-contracts"
import { buildPathSandboxTransform, type SandboxUsability } from "./sandbox-platform"
import { rmSyncEfaultTolerant } from "./teardown.test-support"
import type { ReflectionSpawnArgs } from "./worker/spawn"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0))
    rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

function buildDeferred(policy: SandboxPolicy, verdicts: readonly SandboxUsability[]) {
  const root = mkdtempSync(join(tmpdir(), "omo-sandbox-deferred-"))
  roots.push(root)
  const worktree = join(root, "worktree")
  mkdirSync(worktree)
  let calls = 0
  const transform = buildPathSandboxTransform<ReflectionSpawnArgs>({
    surface: "reflection",
    policy,
    writableDirs: [worktree],
    payloadPaths: [],
    fallbackDir: worktree,
    command: "/bin/sh",
    env: { PATH: "" },
    platform: "linux",
    which: () => "/usr/bin/bwrap",
    // the build-time call only learns that the probe is async; each later call is one spawn
    probe: async () => verdicts[Math.min(Math.max(calls++ - 1, 0), verdicts.length - 1)] ?? { usable: true },
  })
  const spawnArgs = {
    command: "/bin/sh",
    args: ["-c", "exit 0"],
    cwd: worktree,
    env: {},
  } as unknown as ReflectionSpawnArgs
  return { transform, spawnArgs }
}

describe("deferred (async) bwrap probe", () => {
  test("#given auto policy and a probe that is unusable for one spawn and usable for the next #when each spawn is transformed #then wasSandboxed and the warning describe that spawn", async () => {
    // given
    const { transform, spawnArgs } = buildDeferred("auto", [
      { usable: false, reason: "smoke test timed out after 3000ms" },
      { usable: true },
    ])

    // when
    const first = await transform(spawnArgs)
    const firstState = { wasSandboxed: transform.wasSandboxed, warning: transform.warning }
    const second = await transform(spawnArgs)

    // then
    expect(first).toBe(spawnArgs)
    expect(firstState.wasSandboxed).toBe(false)
    expect(firstState.warning).toBe(
      "reflection sandbox unavailable on linux: bwrap cannot create a sandbox: smoke test timed out after 3000ms; running unsandboxed because policy is auto",
    )
    expect(second.command).toBe("/usr/bin/bwrap")
    expect(transform.wasSandboxed).toBe(true)
    expect(transform.warning).toBeUndefined()
  }, 30_000)

  test("#given required policy and a deferred probe that says unusable #when a spawn is transformed #then it fails closed with a typed error", async () => {
    // given
    const { transform, spawnArgs } = buildDeferred("required", [
      { usable: false, reason: "smoke test timed out after 3000ms" },
    ])

    // when
    const outcome = await Promise.resolve(transform(spawnArgs)).then(
      () => undefined,
      (error: unknown) => error,
    )

    // then
    expect(outcome).toBeInstanceOf(SandboxUnavailableError)
  }, 30_000)
})
