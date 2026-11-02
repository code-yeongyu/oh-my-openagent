import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { scanProcFdHolders } from "./open-file-holders"
import { scanProcCwdUsers } from "./repo-in-use"

// Platform contract (omo #10199 r5 LOW 4 / LOW 5 / HIGH 1): the Linux /proc scans fail closed.
// A /proc that lists no processes (present but not mounted, a sandbox) or that does not list this
// very process is UNAVAILABLE, never "no holders"; a per-entry error other than "it vanished" is
// INDETERMINATE. No real host can produce an unmounted /proc on demand, so these drive the scan
// over a synthetic proc tree with the same shape: <pid>/fd/<n> and <pid>/cwd symlinks.

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const SELF = 4242
const OTHER = 777
const UID = process.getuid?.() ?? 0

async function sandbox(): Promise<{ readonly proc: string; readonly repo: string; readonly lock: string }> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-proc-scan-")))
  roots.push(root)
  const proc = join(root, "proc")
  const repo = join(root, "repo")
  await mkdir(join(repo, ".git"), { recursive: true })
  await mkdir(proc)
  const lock = join(repo, ".git", "index.lock")
  await writeFile(lock, "", "utf8")
  return { proc, repo, lock }
}

async function processEntry(proc: string, pid: number, fds: Readonly<Record<string, string>> = {}, cwd?: string): Promise<void> {
  await mkdir(join(proc, String(pid), "fd"), { recursive: true })
  for (const [fd, target] of Object.entries(fds)) await symlink(target, join(proc, String(pid), "fd", fd))
  if (cwd !== undefined) await symlink(cwd, join(proc, String(pid), "cwd"))
}

const view = (root: string) => ({ root, selfPid: SELF, selfUid: UID })

describe("/proc fd holder scan fails closed", () => {
  test("#given a /proc with no process entries #then the scan is unavailable, not 'no holders'", async () => {
    const { proc, lock } = await sandbox()
    expect(await scanProcFdHolders(lock, view(proc))).toEqual({ kind: "unavailable" })
  })

  test("#given a /proc that does not list this process #then the scan is unavailable", async () => {
    const { proc, lock } = await sandbox()
    await processEntry(proc, OTHER, { "0": "/dev/null" })
    expect(await scanProcFdHolders(lock, view(proc))).toEqual({ kind: "unavailable" })
  })

  test("#given an fd entry that cannot be read as a link #then the scan is indeterminate", async () => {
    const { proc, lock } = await sandbox()
    await processEntry(proc, SELF)
    await processEntry(proc, OTHER)
    await writeFile(join(proc, String(OTHER), "fd", "3"), "", "utf8")
    expect(await scanProcFdHolders(lock, view(proc))).toEqual({ kind: "indeterminate" })
  })

  test("#given a listed process holding the lock and one holding nothing relevant #then exactly the holder is reported", async () => {
    const { proc, lock } = await sandbox()
    await processEntry(proc, SELF, { "0": "/dev/null" })
    await processEntry(proc, OTHER, { "0": "/dev/null", "7": lock })
    expect(await scanProcFdHolders(lock, view(proc))).toEqual({ kind: "holders", pids: [OTHER] })
  })
})

describe("/proc cwd scan finds live processes working in the repository", () => {
  test("#given a process whose cwd is inside the repository #then it is reported and this process never is", async () => {
    const { proc, repo } = await sandbox()
    await processEntry(proc, SELF, {}, repo)
    await processEntry(proc, OTHER, {}, join(repo, ".git"))
    await processEntry(proc, OTHER + 1, {}, tmpdir())
    expect(await scanProcCwdUsers(repo, view(proc))).toEqual({ kind: "holders", pids: [OTHER] })
  })

  test("#given a sibling directory sharing the repository's name prefix #then it is not inside the repository", async () => {
    const { proc, repo } = await sandbox()
    await mkdir(`${repo}-other`)
    await processEntry(proc, SELF)
    await processEntry(proc, OTHER, {}, `${repo}-other`)
    expect(await scanProcCwdUsers(repo, view(proc))).toEqual({ kind: "holders", pids: [] })
  })

  test("#given an empty /proc #then the cwd scan is unavailable", async () => {
    const { proc, repo } = await sandbox()
    expect(await scanProcCwdUsers(repo, view(proc))).toEqual({ kind: "unavailable" })
  })

  test("#given a cwd entry that cannot be read as a link #then the cwd scan is indeterminate", async () => {
    const { proc, repo } = await sandbox()
    await processEntry(proc, SELF)
    await processEntry(proc, OTHER)
    await writeFile(join(proc, String(OTHER), "cwd"), "", "utf8")
    expect(await scanProcCwdUsers(repo, view(proc))).toEqual({ kind: "indeterminate" })
  })
})
