import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitMemoryRepo, type GitCommitAuthor } from "../git"
import { settlesWithin } from "../git/settles-within.test-support"
import { buildIdentityPaths } from "../identity"
import { createLockRecord, memoryWriterLockPath, withLock } from "../locks"
import { probeUntil } from "../locks/process-liveness.test-support"
import { runMemoryTool, type MemoryToolLock } from "./memory"
import { removeTree } from "../../../../test-support/remove-tree"

// omo #10199 delta review MEDIUM: a real memory write whose post-commit hook leaves a child holding
// git's pipe must return and release the writer lock, so the next write gets it. Before the exit
// drain, the write never settled and kept the lock while the child lived.

const AUTHOR: GitCommitAuthor = { agentId: "pipe-holder", authorName: "Pipe Holder" }

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
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

async function memoryRepoWithPipeHoldingHook() {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-pipe-holder-")))
  roots.push(root)
  const paths = buildIdentityPaths(root, AUTHOR.agentId)
  await mkdir(paths.locks, { recursive: true })
  const repo = new GitMemoryRepo({ dir: paths.repo, agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName })
  const holderPids = join(root, "holder.pids")
  const hook = join(paths.repo, ".git", "hooks", "post-commit")
  await mkdir(join(paths.repo, ".git", "hooks"), { recursive: true })
  await writeFile(hook, `#!/bin/sh\nsleep 300 &\necho $! >> "${holderPids}"\nexit 0\n`, "utf8")
  await chmod(hook, 0o755)
  const writerLock = memoryWriterLockPath(paths.locks)
  const lock: MemoryToolLock = async (_domain, operation) =>
    withLock(writerLock, await createLockRecord("memory-write"), operation, { waitTimeoutMs: 5_000, retryDelayMs: 5 })
  return { repo, lock, writerLock, holderPids }
}

function write(setup: Awaited<ReturnType<typeof memoryRepoWithPipeHoldingHook>>, file: string) {
  return runMemoryTool({
    repo: setup.repo,
    lock: setup.lock,
    params: { command: "create", reason: `write ${file}`, file_path: file, description: "Fact", file_text: "a fact", author: AUTHOR },
  })
}

async function trackHolders(holderPids: string, count: number): Promise<void> {
  expect(await probeUntil(async () => (await readFile(holderPids, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).length >= count, 20_000)).toBe(true)
  for (const line of (await readFile(holderPids, "utf8")).trim().split("\n")) {
    const pid = Number(line)
    if (!holders.includes(pid)) holders.push(pid)
  }
}

describe("a memory write whose post-commit hook leaves a child holding git's pipe (omo #10199)", () => {
  test.skipIf(process.platform === "win32")("#given the hook child still holds the pipe #when a memory write commits #then it returns, releases the writer lock, and the next write gets the lock", async () => {
    // #given
    const setup = await memoryRepoWithPipeHoldingHook()

    // #when
    const first = await settlesWithin(write(setup, "system/first.md"), 30_000)
    await trackHolders(setup.holderPids, 1)

    // #then
    expect(first.kind).toBe("settled")
    if (first.kind === "settled") expect(first.value.commit?.affectedPaths).toEqual(["system/first.md"])
    expect(existsSync(setup.writerLock)).toBe(false)
    const second = await settlesWithin(write(setup, "system/second.md"), 30_000)
    await trackHolders(setup.holderPids, 2)
    expect(second.kind).toBe("settled")
    if (second.kind === "settled") expect(second.value.commit?.affectedPaths).toEqual(["system/second.md"])
    expect(await setup.repo.status()).toBe("")
  }, 90_000)
})
