import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"

import { GitMemoryRepo } from "../git"
import { createNodeGitExec, type GitExec } from "../git/exec"
import { sweepStrandedGitLockFiles } from "../git/repo-lock-sweep"
import { exitedWithin, probeUntil } from "../locks/process-liveness.test-support"
import { git } from "./two-process-kit.test-support"

// omo #10177 root cause: every `git commit`/`git merge` ends with `git maintenance run --auto
// --detach`. When git decides a gc is due, that detached child writes a cruft pack and deletes the
// loose objects it packed, in the background and outside every memory lock, while the next writer
// commits and readers (fsck, cat-file) look objects up as loose files: "unable to mmap ... No such
// file or directory". The commit path must never start it; packing belongs to `maintain()` under
// the maintenance lock. GIT_TRACE2_EVENT records each git process's own start and child_start
// events synchronously, so the assertion needs no timing: a spawned auto-maintenance is in the log.

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function tracingExec(traceDir: string): GitExec {
  const real = createNodeGitExec()
  return {
    run: (argv, options) => real.run(argv, { ...options, env: { ...(options.env ?? process.env), GIT_TRACE2_EVENT: traceDir } }),
  }
}

async function tracedArgvs(traceDir: string): Promise<string[]> {
  const argvs: string[] = []
  for (const name of await readdir(traceDir)) {
    for (const line of (await readFile(join(traceDir, name), "utf8")).split("\n")) {
      if (!line.includes("\"argv\"")) continue
      const event = JSON.parse(line) as { readonly argv?: readonly string[] }
      if (event.argv !== undefined) argvs.push(event.argv.join(" "))
    }
  }
  return argvs
}

describe("memory commit path and git auto-maintenance (omo #10177)", () => {
  test("#given a memory repo whose git config asks for aggressive auto gc #when the commit path commits and merges #then no git auto-maintenance or auto gc is ever spawned", async () => {
    // #given: raw git init like the two-process fixture, plus gc.auto=1 so git would gc on any commit
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-auto-maintenance-")))
    roots.push(root)
    const dir = join(root, "repo")
    const traceDir = join(root, "trace2")
    await mkdir(dir, { recursive: true })
    await mkdir(traceDir, { recursive: true })
    await git(dir, ["init", "-b", "main"])
    await git(dir, ["config", "commit.gpgsign", "false"])
    await git(dir, ["config", "gc.auto", "1"])
    // Production repos get a repo-local identity from GitMemoryRepo.init -> ensureIdentity; this
    // raw fixture must set the same, or `merge` cannot resolve a committer on hosts with no
    // global git identity (CI runners, clean boxes).
    await git(dir, ["config", "user.name", "Auto Maintenance"])
    await git(dir, ["config", "user.email", "auto-maintenance@omo.local"])
    const repo = new GitMemoryRepo({ dir, agentId: "auto-maintenance", exec: tracingExec(traceDir) })
    const author = { agentId: "auto-maintenance", authorName: "Auto Maintenance" }

    // #when
    for (let index = 0; index < 3; index += 1) {
      await mkdir(join(dir, "notes"), { recursive: true })
      await writeFile(join(dir, "notes", `n-${index}.md`), `---\ndescription: note ${index}\n---\nbody ${index}\n`)
      await repo.commitWrite([`notes/n-${index}.md`], `note ${index}`, author)
    }
    await git(dir, ["checkout", "-q", "-b", "side"])
    await writeFile(join(dir, "notes", "side.md"), "---\ndescription: side\n---\nside\n")
    await repo.commitWrite(["notes/side.md"], "side note", author)
    await git(dir, ["checkout", "-q", "main"])
    await repo.merge("side", { message: "merge side" })

    // #then
    const argvs = await tracedArgvs(traceDir)
    expect(argvs.some((argv) => / commit /.test(` ${argv} `))).toBe(true)
    expect(argvs.filter((argv) => /\bmaintenance run\b.*--auto|\bgc\b.*--auto/.test(argv))).toEqual([])
  }, 30_000)

  test.skipIf(process.platform === "win32")("#given a LIVE git holding .git/index.lock with an unchanging mtime #when the stranded-lock sweep runs #then the live lock survives, and after the holder dies the debris is KEPT (unknown ownership)", async () => {
    // #given: `git update-index --stdin` creates index.lock at startup and holds the fd while it
    // waits for input, writing nothing - exactly a slow live writer whose lock mtime never moves.
    // The sweep must leave it live (omo #10199 review HIGH 1), and must STILL leave it after the
    // holder dies: a killed git holder's debris has unknown ownership here (no memory-write lock
    // takeover proved a dead previous owner), so reclamation is reported, not performed.
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-live-lock-")))
    roots.push(root)
    const dir = join(root, "repo")
    await mkdir(dir, { recursive: true })
    await git(dir, ["init", "-b", "main"])
    const lockPath = join(dir, ".git", "index.lock")
    const holder = spawn("git", ["-C", dir, "update-index", "--stdin"], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true })
    try {
      expect(await probeUntil(() => existsSync(lockPath), 10_000)).toBe(true)

      // #when
      const whileLive = await sweepStrandedGitLockFiles(dir, 50)

      // #then
      expect(whileLive).toEqual({ removed: [], kept: [{ path: lockPath, reason: "owner-not-proven-dead" }] })
      expect(existsSync(lockPath)).toBe(true)
    } finally {
      holder.kill("SIGKILL")
      expect(await exitedWithin(holder, 5_000)).toBe(true)
    }
    const afterDeath = await sweepStrandedGitLockFiles(dir, 50)
    expect(afterDeath).toEqual({ removed: [], kept: [{ path: lockPath, reason: "owner-not-proven-dead" }] })
    expect(existsSync(lockPath)).toBe(true)
  }, 30_000)
})
