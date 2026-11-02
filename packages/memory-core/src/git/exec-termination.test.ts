import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitCommandError } from "./errors"
import { createNodeGitExec } from "./exec"
import { commandError } from "./repo-arguments"

// #11943: a git child that exits non-zero without writing anything used to surface as a bare
// "exit code 1", which cannot tell a real silent failure from a child killed by something else.
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "git-exec-termination-"))
  tempDirs.push(dir)
  const init = await createNodeGitExec().run(["init", "-q"], { cwd: dir, timeoutMs: 30_000 })
  expect(init.code).toBe(0)
  return dir
}

describe("git child termination", () => {
  test("#given a git command that fails without output #when it runs #then the result records how the child ended and the error names it", async () => {
    // given
    const dir = await initRepo()
    const argv = ["rev-parse", "--verify", "--quiet", "refs/heads/missing"]

    // when
    const result = await createNodeGitExec().run(argv, { cwd: dir, timeoutMs: 30_000 })

    // then
    expect(result.code).toBe(1)
    expect(result.stdout + result.stderr).toBe("")
    expect(result.termination?.signal).toBeNull()
    expect(result.termination?.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(commandError(argv, result).message).toContain("with no output (no signal, after ")
  })

  test("#given a child ended by an external signal #when the error is built #then the signal is in the message", () => {
    const error = new GitCommandError(["add", "-A"], 1, "", "", { signal: "SIGKILL", elapsedMs: 34_226 })

    expect(error.message).toBe("git add -A failed: exit code 1 with no output (signal SIGKILL, after 34226ms)")
  })

  test("#given git wrote stderr #when the error is built #then stderr stays the detail", () => {
    const error = new GitCommandError(["add"], 128, "", "fatal: bad\n", { signal: null, elapsedMs: 3 })

    expect(error.message).toBe("git add failed: fatal: bad")
  })
})
