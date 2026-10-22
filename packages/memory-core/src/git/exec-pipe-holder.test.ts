import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createNodeGitExec } from "./exec"
import { settlesWithin } from "./settles-within.test-support"
import { probeUntil } from "../locks/process-liveness.test-support"

// omo #10199 review LOW 1: git that exits NORMALLY while a hook's background child still holds the
// inherited stdout/stderr pipe must not keep the write waiting on that child. Before the fix the
// result waited for `close`, which never came while the child lived (not even at the timeout).

const roots: string[] = []
const holders: number[] = []
afterEach(async () => {
  for (const pid of holders.splice(0)) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // already gone
    }
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function repoWithPipeHoldingHook(): Promise<{ readonly repo: string; readonly holderPid: string }> {
  const repo = realpathSync.native(await mkdtemp(join(tmpdir(), "git-pipe-holder-")))
  roots.push(repo)
  execFileSync("git", ["init", "-q", "-b", "main", repo])
  execFileSync("git", ["-C", repo, "config", "user.email", "t@example.invalid"])
  execFileSync("git", ["-C", repo, "config", "user.name", "t"])
  execFileSync("git", ["-C", repo, "config", "core.hooksPath", join(repo, ".git", "hooks")])
  const holderPid = join(repo, "holder.pid")
  // The background child inherits the hook's stdout (git routes it to its own stderr pipe) and
  // keeps it open; it records its pid so the test can end it.
  const hook = join(repo, ".git", "hooks", "post-commit")
  await writeFile(hook, `#!/bin/sh\nsleep 300 &\necho $! > "${holderPid}"\nexit 0\n`, "utf8")
  await chmod(hook, 0o755)
  return { repo, holderPid }
}

describe("a git whose hook leaves a child holding its pipe (omo #10199 review LOW 1)", () => {
  test.skipIf(process.platform === "win32")("#given a post-commit hook that backgrounds a pipe holder #when the commit finishes normally #then the write settles with git's own result, without waiting for the holder", async () => {
    // #given
    const { repo, holderPid } = await repoWithPipeHoldingHook()
    const exec = createNodeGitExec()

    // #when
    const outcome = exec.run(["commit", "--allow-empty", "-q", "-m", "first"], { cwd: repo, timeoutMs: 10_000, exitDrainMs: 500 })
    expect(await probeUntil(() => existsSync(holderPid), 20_000)).toBe(true)
    holders.push(Number((await readFile(holderPid, "utf8")).trim()))
    const settled = await settlesWithin(outcome, 20_000)

    // #then
    expect(settled.kind).toBe("settled")
    if (settled.kind === "settled") expect(settled.value.code).toBe(0)
    expect(execFileSync("git", ["-C", repo, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim()).toBe("1")
  }, 60_000)

  test.skipIf(process.platform === "win32")("#given a git that exits normally and closes its pipes #when it finishes #then its full output is returned as before", async () => {
    // #given
    const { repo } = await repoWithPipeHoldingHook()
    const exec = createNodeGitExec()

    // #when
    const result = await exec.run(["rev-parse", "--show-toplevel"], { cwd: repo, timeoutMs: 10_000, exitDrainMs: 500 })

    // #then
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe(repo)
  }, 60_000)
})
