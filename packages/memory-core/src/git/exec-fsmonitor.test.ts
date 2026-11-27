import { describe, expect, onTestFinished, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createNodeGitExec } from "./exec"
import { removeTreeSync } from "../../../../test-support/remove-tree"

// The builtin fsmonitor daemon exists on macOS and Windows only; on Linux `core.fsmonitor=true`
// starts nothing, so the positive control below could not fail there (#10391 design, T9(a')).
const BUILTIN_FSMONITOR = process.platform === "darwin" || process.platform === "win32"

// The clean-tree check every memory write runs first (`GitMemoryRepo` status in `repo.ts`).
const CLEAN_TREE_STATUS = ["-c", "core.quotePath=false", "status", "--porcelain", "--untracked-files=all"]

interface FsmonitorFixture {
  readonly repo: string
  readonly env: NodeJS.ProcessEnv
}

function createFsmonitorFixture(): FsmonitorFixture {
  const root = mkdtempSync(join(tmpdir(), "omo-git-fsmonitor-"))
  const globalConfig = join(root, "gitconfig")
  writeFileSync(globalConfig, "[core]\n\tfsmonitor = true\n")
  const env = { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: "1" }
  const repo = join(root, "repo")
  mkdirSync(repo)
  runGit(repo, env, ["init", "--quiet"])
  onTestFinished(() => {
    // A daemon left running would hold the fixture directory open; stop it whatever the verdict.
    spawnSync("git", ["fsmonitor--daemon", "stop"], { cwd: repo, env, stdio: "ignore", timeout: GIT_CALL_BOUND_MS })
    removeTreeSync(root, { maxRetries: 10, retryDelay: 200 })
  })
  return { repo, env }
}

// Circuit breaker only: every call returns as soon as git exits. A status that autostarts the daemon
// waits for it to listen, which was measured at 176 s once on a host at load ~100.
const GIT_CALL_BOUND_MS = 300_000

function runGit(cwd: string, env: NodeJS.ProcessEnv, argv: readonly string[]) {
  const result = spawnSync("git", [...argv], { cwd, env, encoding: "utf8", timeout: GIT_CALL_BOUND_MS })
  if (result.error !== undefined) throw result.error
  return result
}

// A daemon this command starts inherits its stdio; captured pipes would never reach EOF.
function runGitDetachedStdio(cwd: string, env: NodeJS.ProcessEnv, argv: readonly string[]): number | null {
  const result = spawnSync("git", [...argv], { cwd, env, stdio: "ignore", timeout: GIT_CALL_BOUND_MS })
  if (result.error !== undefined) throw result.error
  return result.status
}

function daemonStatus(fixture: FsmonitorFixture): string {
  return runGit(fixture.repo, fixture.env, ["fsmonitor--daemon", "status"]).stdout.trim()
}

describe.skipIf(!BUILTIN_FSMONITOR)("createNodeGitExec fsmonitor", () => {
  test("#given core.fsmonitor=true in the global config #when git status runs without the exec boundary #then the daemon starts (positive control)", () => {
    const fixture = createFsmonitorFixture()

    const status = runGitDetachedStdio(fixture.repo, fixture.env, CLEAN_TREE_STATUS)

    expect(status).toBe(0)
    expect(daemonStatus(fixture)).toContain("is watching")
  }, 360_000)

  test("#given core.fsmonitor=true in the global config #when the clean-tree status runs through createNodeGitExec #then no fsmonitor daemon starts", async () => {
    const fixture = createFsmonitorFixture()
    const exec = createNodeGitExec()

    const status = await exec.run(CLEAN_TREE_STATUS, { cwd: fixture.repo, timeoutMs: 30_000, env: fixture.env })

    expect(status.code).toBe(0)
    expect(daemonStatus(fixture)).toContain("is not watching")
  }, 60_000)
})
