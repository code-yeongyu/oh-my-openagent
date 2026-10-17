import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { existsSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitTimeoutError } from "./errors"
import { createNodeGitExec } from "./exec"
import { GitMemoryRepo } from "./repo"
import { exitedWithin, probeUntil } from "../locks/process-liveness.test-support"

// omo #10199 field incident: a slow `git commit` was SIGKILLed by the 30 s timeout right after it
// updated HEAD, which stranded HEAD.lock, and the write was reported failed although it was on
// HEAD. A timeout now sends SIGTERM first (git removes its own locks), SIGKILL only after a
// bounded grace, and a commit that timed out is judged by what landed.

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function scratch(prefix: string): Promise<string> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), prefix)))
  roots.push(root)
  return root
}

// A stand-in `git` on PATH that creates a lock like git does, then never finishes on its own.
async function fakeGit(root: string, onTerm: "remove-lock-and-exit" | "ignore"): Promise<{ readonly bin: string; readonly lock: string; readonly started: string }> {
  const bin = join(root, "bin")
  await mkdir(bin, { recursive: true })
  const lock = join(root, "HEAD.lock")
  const started = join(root, "started")
  const trap = onTerm === "ignore" ? "trap '' TERM" : `trap 'rm -f "${lock}"; exit 143' TERM`
  await writeFile(join(bin, "git"), `#!/bin/sh\n[ "$1" = warm ] && exit 0\n${trap}\n: > "${lock}"\n: > "${started}"\nwhile :; do sleep 1; done\n`, "utf8")
  await chmod(join(bin, "git"), 0o755)
  // The first exec of a freshly written executable can stall while the OS vets it (seconds under
  // load on macOS), which would let the timeout fire before the trap exists. Run it once first.
  const warm = spawn(join(bin, "git"), ["warm"], { stdio: "ignore" })
  expect(await exitedWithin(warm, 60_000)).toBe(true)
  return { bin, lock, started }
}

describe("a timed-out git (omo #10199 field incident)", () => {
  test.skipIf(process.platform === "win32")("#given git cleans up on SIGTERM #when it outlives its timeout #then it gets SIGTERM first and its lock is gone", async () => {
    // #given
    const root = await scratch("git-timeout-term-")
    const git = await fakeGit(root, "remove-lock-and-exit")
    const exec = createNodeGitExec()

    // #when
    const failure = exec.run(["commit"], { cwd: root, timeoutMs: 5_000, killGraceMs: 30_000, env: { ...process.env, PATH: `${git.bin}:${process.env.PATH ?? ""}` } }).catch((error: unknown) => error)
    expect(await probeUntil(() => existsSync(git.started), 10_000)).toBe(true)

    // #then
    expect(await failure).toBeInstanceOf(GitTimeoutError)
    expect(existsSync(git.lock)).toBe(false)
  }, 60_000)

  test.skipIf(process.platform === "win32")("#given git ignores SIGTERM #when it outlives its timeout #then SIGKILL follows after the bounded grace", async () => {
    // #given
    const root = await scratch("git-timeout-kill-")
    const git = await fakeGit(root, "ignore")
    const exec = createNodeGitExec()

    // #when
    const failure = exec.run(["commit"], { cwd: root, timeoutMs: 5_000, killGraceMs: 500, env: { ...process.env, PATH: `${git.bin}:${process.env.PATH ?? ""}` } }).catch((error: unknown) => error)
    expect(await probeUntil(() => existsSync(git.started), 10_000)).toBe(true)

    // #then
    expect(await failure).toBeInstanceOf(GitTimeoutError)
    expect(existsSync(git.lock)).toBe(true)
  }, 60_000)

  test.skipIf(process.platform === "win32")("#given a commit whose post-commit hook outlives the commit budget #when the commit times out after HEAD moved #then it is reported committed with that commit, without waiting for the hook", async () => {
    // #given
    const root = await scratch("git-timeout-landed-")
    const repo = new GitMemoryRepo({ dir: join(root, "repo"), agentId: "timeout", commitTimeoutMs: 3_000 })
    await repo.init({ authorName: "Timeout" })
    const hook = join(repo.dir, ".git", "hooks", "post-commit")
    await mkdir(join(repo.dir, ".git", "hooks"), { recursive: true })
    await writeFile(hook, `#!/bin/sh\nexec sleep 30\n`, "utf8")
    await chmod(hook, 0o755)
    await writeFile(join(repo.dir, "fact.md"), "---\ndescription: Fact\n---\nfact\n", "utf8")

    // #when
    const startedAt = Date.now()
    const result = await repo.commitWrite(["fact.md"], "write slower than its budget", { agentId: "timeout", authorName: "Timeout" })

    // #then: reported once git exits, not when the hook that still holds its output finishes
    expect(Date.now() - startedAt).toBeLessThan(25_000)
    expect(result.sha).toBe((await repo.head()) ?? "")
    expect((await repo.log({ limit: 1 }))[0]?.subject).toBe("write slower than its budget")
    expect(existsSync(join(repo.dir, ".git", "HEAD.lock"))).toBe(false)
  }, 60_000)
})
