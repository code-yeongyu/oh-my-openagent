import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import { createIsolationRuntime } from "../isolation"
import { cleanupIsolationProjects, releaseSandboxes, tempGitRepo } from "./__fixtures__/isolation-fakes"

afterEach(cleanupIsolationProjects)

// `fuse-overlayfs` keeps the sandbox mounted until its own `stop` runs, so deleting a tree that still
// contains one fails EBUSY - four isolation tests died that way on the ubuntu CI shard while passing
// on macOS. Teardown must go through the recorded backend, never a plain recursive delete.
describe("isolation fixture teardown", () => {
  test("#given a retained sandbox #when the fixture releases it #then its backend tore the sandbox down", async () => {
    const fixture = tempGitRepo()
    const runtime = createIsolationRuntime({ homeDir: fixture.homeDir })
    const handle = await runtime.ensure({ repoRoot: fixture.repoRoot, id: "st_release1", preferred: "auto" })
    const retained = await runtime.retain(handle, "not-applied")
    const worktrees = join(fixture.homeDir, ".omo", "wt")

    expect(existsSync(retained)).toBe(true)
    expect(readdirSync(worktrees).length).toBeGreaterThan(0)

    await releaseSandboxes(fixture.homeDir)

    expect(existsSync(retained)).toBe(false)
    expect(readdirSync(worktrees)).toEqual([])
  })

  test("#given a sandbox that was never retained #when the fixture releases it #then it is torn down too", async () => {
    const fixture = tempGitRepo()
    const runtime = createIsolationRuntime({ homeDir: fixture.homeDir })
    const handle = await runtime.ensure({ repoRoot: fixture.repoRoot, id: "st_release2", preferred: "auto" })
    const worktrees = join(fixture.homeDir, ".omo", "wt")

    expect(existsSync(handle.baseDir)).toBe(true)

    await releaseSandboxes(fixture.homeDir)

    expect(existsSync(handle.baseDir)).toBe(false)
    expect(readdirSync(worktrees)).toEqual([])
  })
})
