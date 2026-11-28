import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  GitMemoryRepo,
  buildIdentityPaths,
  createLockRecord,
  memoryMaintenanceLockPath,
  withLock,
} from "@oh-my-opencode/memory-core"

import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext } from "./context"
import { createMemoryMaintenance } from "./memory-maintenance"
import { rmEfaultTolerant } from "./teardown.test-support"

// These cases drive real git end to end; loaded CI runners need more than the 20 s default.
setDefaultTimeout(60_000)

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })),
  )
})

function packs(dir: string): number {
  const output = execFileSync("git", ["count-objects", "-v"], { cwd: dir, encoding: "utf8" })
  return Number(/^packs: (\d+)$/m.exec(output)?.[1] ?? Number.NaN)
}

/** A bound identity plus a foreign one (no session binds it) whose repo holds 16 packs. */
async function hostWithForeignPackedRepo() {
  const memoryRoot = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-host-repo-")))
  roots.push(memoryRoot)
  const boundPaths = buildIdentityPaths(memoryRoot, "bound-agent")
  await new GitMemoryRepo({ dir: boundPaths.repo, agentId: "bound-agent" }).init()
  const context = createMemoryIdentityContext({
    identity: "bound-agent",
    identityPaths: boundPaths,
    binding: createMemoryBinding({ identity: "bound-agent", repoPath: boundPaths.repo, boundAt: 1 }),
  })
  const foreign = buildIdentityPaths(memoryRoot, "foreign-agent")
  await new GitMemoryRepo({ dir: foreign.repo, agentId: "foreign-agent" }).init()
  await mkdir(foreign.runtime, { recursive: true })
  const git = (...args: string[]) => execFileSync("git", args, { cwd: foreign.repo, stdio: "pipe" })
  for (let round = 0; round < 16; round += 1) {
    await writeFile(join(foreign.repo, `note-${round}.md`), `note ${round}\n`)
    git("add", "-A")
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.org", "commit", "-qm", `note ${round}`)
    git("repack", "-q")
  }
  expect(packs(foreign.repo)).toBe(16)
  return { memoryRoot, context, foreign }
}

describe("host sweep repo maintenance for unbound identities (#15419)", () => {
  test("#given a foreign identity whose repo holds 16 packs #when a bound session's pass runs the host sweep #then the foreign repo's packs are folded", async () => {
    const { context, foreign } = await hostWithForeignPackedRepo()
    const maintenance = createMemoryMaintenance({ delayMs: 0, hostSweep: () => ({}) })

    maintenance.schedule(context)
    await maintenance.settled()

    expect(packs(foreign.repo)).toBeLessThan(16)
  })

  test("#given another runner holds the foreign identity's maintenance lock #when the host sweep visits it #then its repo is left alone and the round still completes", async () => {
    const { memoryRoot, context, foreign } = await hostWithForeignPackedRepo()
    const maintenance = createMemoryMaintenance({ delayMs: 0, hostSweep: () => ({}) })
    const holder = await createLockRecord("memory-maintenance", { runId: "other-runner" })

    await withLock(memoryMaintenanceLockPath(foreign.locks), holder, async () => {
      maintenance.schedule(context)
      await maintenance.settled()
    })

    expect(packs(foreign.repo)).toBe(16)
    expect(existsSync(join(memoryRoot, "runtime-sweep.json"))).toBe(true)
  })
})
